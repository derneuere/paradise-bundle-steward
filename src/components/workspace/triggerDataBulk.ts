// Pure helpers for the TriggerData bulk-select state.
//
// Lives in `.ts` (no React) so the unit tests under `__tests__/` can drive
// the bulk reducer behaviour without dragging in the React + r3f graph that
// `TriggerDataBulkProvider` imports. Mirrors `aiSectionsBulk.ts`.
//
// Domain notes (load-bearing for future agents):
//   - TriggerData has SIX bulk-eligible top-level lists in the parsed model:
//       landmarks / genericRegions / blackspots / vfxBoxRegions
//       spawnLocations / roamingLocations
//     Each entry is addressed by its containing list key + numeric index,
//     e.g. `['landmarks', 3]` or `['roamingLocations', 5]`. Sub-paths under
//     an entry (a position field, a box dimension) collapse to the parent
//     entry path before they enter the bulk Set — bulk granularity is one
//     entry, never a sub-field.
//   - Player-start singletons (`['playerStartPosition']` /
//     `['playerStartDirection']`) are NOT bulk-eligible — there's exactly
//     one of each per resource so a "set of player-starts" is degenerate.
//     Tree-row Ctrl/Shift on those paths falls through to plain selection.
//   - Bulk Set keys are ALWAYS the schema-path string `parts.join('/')`
//     so a single Set can mix entry kinds (`'landmarks/3'`,
//     `'roamingLocations/5'`). The hierarchy tree paints rows whose
//     `schemaPath.join('/')` is in the Set; the 3D overlay translates the
//     subset its hooks care about into Selection-keyed shapes.

import type { NodePath } from '@/lib/schema/walk';

/** The six top-level lists whose entries can enter the bulk. Player-start
 *  singletons are intentionally absent — see file header. */
const BULK_LIST_KEYS = new Set<string>([
	'landmarks',
	'genericRegions',
	'blackspots',
	'vfxBoxRegions',
	'spawnLocations',
	'roamingLocations',
]);

/** Discriminated address of a bulk-eligible entry inside a TriggerData
 *  resource. The `listKey` is the parsed-model field name (matches the
 *  schema path's first segment); `index` is the position in that list. */
export type EntryAddress = {
	listKey: string;
	index: number;
};

/**
 * Normalise an arbitrary schema path inside a TriggerData resource to the
 * containing entry path. Returns null when the path doesn't address a bulk-
 * eligible entry (or anything underneath one) — those paths are not bulk-
 * eligible and the caller should fall through to plain navigation.
 *
 * Examples:
 *   ['landmarks', 3]                              → ['landmarks', 3]
 *   ['landmarks', 3, 'box', 'position', 'x']      → ['landmarks', 3]
 *   ['roamingLocations', 5]                       → ['roamingLocations', 5]
 *   ['roamingLocations', 5, 'position']           → ['roamingLocations', 5]
 *   ['playerStartPosition']                       → null   (singleton)
 *   ['header', 'flags']                           → null
 */
export function normaliseToEntryPath(path: NodePath): NodePath | null {
	const addr = parseEntryAddress(path);
	if (!addr) return null;
	return [addr.listKey, addr.index];
}

/**
 * Decode the entry address (listKey + index) from any schema path inside a
 * TriggerData resource. Sub-paths under an entry collapse to the entry
 * itself. Returns null when the path doesn't address a bulk-eligible list
 * — the caller should treat that as "not bulk-eligible".
 */
export function parseEntryAddress(path: NodePath): EntryAddress | null {
	if (path.length < 2) return null;
	const head = path[0];
	if (typeof head !== 'string') return null;
	if (!BULK_LIST_KEYS.has(head)) return null;
	const idx = path[1];
	if (typeof idx !== 'number') return null;
	return { listKey: head, index: idx };
}

/** Stable string key for the bulk `Set<string>`. Identity = `path.join('/')`. */
export function entryPathKey(path: NodePath): string {
	return path.join('/');
}

/** Inverse of `entryPathKey` — parse a stored key back into the entry
 *  address it represents. Returns null when the key isn't a bulk-eligible
 *  entry path (e.g. a malformed key from a previous shape). */
export function parseEntryPathKey(key: string): EntryAddress | null {
	const parts = key.split('/');
	if (parts.length !== 2) return null;
	const listKey = parts[0];
	if (!BULK_LIST_KEYS.has(listKey)) return null;
	const idx = Number(parts[1]);
	if (!Number.isFinite(idx)) return null;
	return { listKey, index: idx };
}

// ---------------------------------------------------------------------------
// Pure reducers — exported for unit tests under `__tests__/`.
// ---------------------------------------------------------------------------

/** Toggle an entry's membership. Sub-paths are normalised to their parent
 *  entry before the toggle. Non-entry paths are no-ops (returns input). */
export function toggleEntry(
	prev: ReadonlySet<string>,
	path: NodePath,
): Set<string> {
	const norm = normaliseToEntryPath(path);
	const next = new Set(prev);
	if (!norm) return next;
	const key = entryPathKey(norm);
	if (next.has(key)) next.delete(key);
	else next.add(key);
	return next;
}

/** Add every entry between `from` and `to` (inclusive) to the set, but only
 *  when both endpoints sit in the SAME list (`landmarks` to `landmarks`).
 *  Cross-list or no-anchor pairs degrade gracefully to "just add the
 *  endpoint" so shift-click always produces at least one new entry.
 *  Mirrors `aiSectionsBulk.rangeAddSections`'s same-variant-only semantics. */
export function rangeAddEntries(
	prev: ReadonlySet<string>,
	from: NodePath,
	to: NodePath,
): Set<string> {
	const next = new Set(prev);
	const toAddr = parseEntryAddress(to);
	if (!toAddr) return next;
	const fromAddr = parseEntryAddress(from);
	// No anchor or cross-list: just add the endpoint.
	if (!fromAddr || fromAddr.listKey !== toAddr.listKey) {
		next.add(entryPathKey(normaliseToEntryPath(to)!));
		return next;
	}
	const lo = Math.min(fromAddr.index, toAddr.index);
	const hi = Math.max(fromAddr.index, toAddr.index);
	for (let i = lo; i <= hi; i++) {
		next.add(entryPathKey([toAddr.listKey, i]));
	}
	return next;
}

/** Batch-apply a list of paths to the bulk set in one pass — `'add'` unions
 *  them in, `'remove'` subtracts them. Mirrors `toggleEntry`'s normalisation:
 *  each input path is collapsed to its containing entry before the
 *  membership change, and non-entry paths are silently skipped so the marquee
 *  can pass arbitrary `[listKey, i]`-shaped hits without per-element pre-
 *  validation. Single-pass collapse (vs. N `toggleEntry` calls) is the whole
 *  point — the 3D marquee can hit hundreds of entries in one drag and we
 *  want one Set rebuild, not N. */
export function applyPaths(
	prev: ReadonlySet<string>,
	paths: ReadonlyArray<NodePath>,
	mode: 'add' | 'remove',
): Set<string> {
	const next = new Set(prev);
	for (const p of paths) {
		const norm = normaliseToEntryPath(p);
		if (!norm) continue;
		const key = entryPathKey(norm);
		if (mode === 'add') next.add(key);
		else next.delete(key);
	}
	return next;
}

/** Filter a bulk set to only entries whose index is within `[0, maxIndex)`
 *  for the given list. Used when the underlying model shrinks (e.g. an entry
 *  was deleted) so stale keys don't paint rows that no longer exist. */
export function pruneStaleEntries(
	prev: ReadonlySet<string>,
	listKey: string,
	maxIndex: number,
): Set<string> {
	const next = new Set<string>();
	for (const key of prev) {
		const addr = parseEntryPathKey(key);
		if (!addr) continue;
		if (addr.listKey === listKey && addr.index >= maxIndex) continue;
		next.add(key);
	}
	return next;
}
