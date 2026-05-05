// Pure helpers for the AI Sections bulk-select state.
//
// Lives in `.ts` (no React) so the unit tests under `__tests__/` can drive
// the bulk reducer behaviour without dragging in the React + r3f graph that
// `AISectionsBulkProvider` imports.
//
// Domain notes (load-bearing for future agents):
//   - AI Sections in V12 live at the top-level NodePath `['sections', i]`.
//     Their portals / boundaryLines / noGoLines nest deeper under that
//     section. The bulk-select unit is the WHOLE SECTION — clicking a portal
//     row or a no-go-line row in the schema tree (or in the 3D overlay) must
//     normalise to the parent section path before going into the bulk Set.
//   - V4/V6 prototype AI Sections nest the same shape under a `legacy` wrapper:
//     `['legacy', 'sections', i]`. The wrapper exists because the V4 root is
//     a discriminated union — see the AISectionsLegacyOverlay module header.
//   - The bulk Set keys are ALWAYS the schema-path string `parts.join('/')`
//     so a single Set can hold mixed V12 + V4 entries (different prefixes).
//     The hierarchy tree paints rows whose `schemaPath.join('/')` is in the
//     Set; the 3D overlay derives a Selection-keyed Set<string> from this
//     for `useBatchedSelection`.

import type { NodePath } from '@/lib/schema/walk';

/** Discriminated address of a section inside a V12 / V4-V6 AI Sections root. */
export type SectionAddress =
	| { variant: 'v12'; sectionIndex: number }
	| { variant: 'legacy'; sectionIndex: number };

/**
 * Normalise an arbitrary schema path inside an AI Sections resource to the
 * containing section path. Returns null when the path doesn't address a
 * section (or anything underneath one) — those paths are not bulk-eligible
 * and the caller should fall through to plain navigation.
 *
 * Examples:
 *   ['sections', 5]                                → ['sections', 5]
 *   ['sections', 5, 'portals', 3]                  → ['sections', 5]
 *   ['sections', 5, 'portals', 3, 'boundaryLines', 1, 'verts', 'x']
 *                                                  → ['sections', 5]
 *   ['legacy', 'sections', 7]                      → ['legacy', 'sections', 7]
 *   ['legacy', 'sections', 7, 'noGoLines', 0]      → ['legacy', 'sections', 7]
 *   ['header', 'flags']                            → null
 */
export function normaliseToSectionPath(path: NodePath): NodePath | null {
	const addr = parseSectionAddress(path);
	if (!addr) return null;
	return addr.variant === 'v12'
		? ['sections', addr.sectionIndex]
		: ['legacy', 'sections', addr.sectionIndex];
}

/**
 * Decode the section address (variant + sectionIndex) from any schema path
 * inside an AI Sections resource. Sub-paths under a section collapse to the
 * section itself. Returns null when the path doesn't match either AI sections
 * shape — the caller should treat that as "not bulk-eligible".
 */
export function parseSectionAddress(path: NodePath): SectionAddress | null {
	if (path.length >= 2 && path[0] === 'sections' && typeof path[1] === 'number') {
		return { variant: 'v12', sectionIndex: path[1] };
	}
	if (
		path.length >= 3 &&
		path[0] === 'legacy' &&
		path[1] === 'sections' &&
		typeof path[2] === 'number'
	) {
		return { variant: 'legacy', sectionIndex: path[2] };
	}
	return null;
}

/** Stable string key for the bulk `Set<string>`. Identity = `path.join('/')`. */
export function sectionPathKey(path: NodePath): string {
	return path.join('/');
}

/** Inverse of `sectionPathKey` — parse a stored key back into the section
 *  address it represents. Returns null when the key isn't a section path
 *  (e.g. legacy data left over from a previous shape). */
export function parseSectionPathKey(key: string): SectionAddress | null {
	const parts = key.split('/');
	if (parts.length === 2 && parts[0] === 'sections') {
		const idx = Number(parts[1]);
		if (Number.isFinite(idx)) return { variant: 'v12', sectionIndex: idx };
	}
	if (parts.length === 3 && parts[0] === 'legacy' && parts[1] === 'sections') {
		const idx = Number(parts[2]);
		if (Number.isFinite(idx)) return { variant: 'legacy', sectionIndex: idx };
	}
	return null;
}

// ---------------------------------------------------------------------------
// Pure reducers — exported for unit tests under `__tests__/`.
// ---------------------------------------------------------------------------

/** Toggle a section's membership. Sub-paths are normalised to their parent
 *  section before the toggle. Non-section paths are no-ops (returns input). */
export function toggleSection(
	prev: ReadonlySet<string>,
	path: NodePath,
): Set<string> {
	const norm = normaliseToSectionPath(path);
	const next = new Set(prev);
	if (!norm) return next;
	const key = sectionPathKey(norm);
	if (next.has(key)) next.delete(key);
	else next.add(key);
	return next;
}

/** Add every section between `from` and `to` (inclusive) to the set, same
 *  variant only. Cross-variant or no-anchor pairs degrade gracefully to "just
 *  add the endpoint" so shift-click always produces at least one new entry.
 *  Mirrors `PSLBulkProvider.onBulkRange`'s same-soup-only semantics. */
export function rangeAddSections(
	prev: ReadonlySet<string>,
	from: NodePath,
	to: NodePath,
): Set<string> {
	const next = new Set(prev);
	const toAddr = parseSectionAddress(to);
	if (!toAddr) return next;
	const fromAddr = parseSectionAddress(from);
	// No anchor or cross-variant: just add the endpoint.
	if (!fromAddr || fromAddr.variant !== toAddr.variant) {
		next.add(sectionPathKey(normaliseToSectionPath(to)!));
		return next;
	}
	const lo = Math.min(fromAddr.sectionIndex, toAddr.sectionIndex);
	const hi = Math.max(fromAddr.sectionIndex, toAddr.sectionIndex);
	for (let i = lo; i <= hi; i++) {
		const path: NodePath =
			toAddr.variant === 'v12' ? ['sections', i] : ['legacy', 'sections', i];
		next.add(sectionPathKey(path));
	}
	return next;
}

/** Filter a bulk set to only entries whose section index is within `[0,
 *  maxIndex)` for the given variant. Used when the underlying model shrinks
 *  (e.g. a section was deleted) so stale keys don't paint rows that no
 *  longer exist. */
export function pruneStaleSections(
	prev: ReadonlySet<string>,
	variant: 'v12' | 'legacy',
	maxIndex: number,
): Set<string> {
	const next = new Set<string>();
	for (const key of prev) {
		const addr = parseSectionPathKey(key);
		if (!addr) continue;
		if (addr.variant === variant && addr.sectionIndex >= maxIndex) continue;
		next.add(key);
	}
	return next;
}
