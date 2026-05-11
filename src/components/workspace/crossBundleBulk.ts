// Pure helpers for the cross-Bundle bulk transform path (issue #80).
//
// A bulk Selection that spans multiple Bundles (e.g. a marquee dragged
// across two adjacent track-unit Bundles) produces one rigid gizmo gesture
// that translates / rotates every selected entity around a single shared
// pivot, applied per-Bundle. Each affected Bundle dirties independently
// (CONTEXT.md / "Workspace", "Bundle addressing") and the entire gesture
// commits as ONE Workspace-undo entry — a `{ kind: 'multi', entries }`
// HistoryCommit (ADR-0006 + the multi-Bundle extension in
// `WorkspaceContext.types.ts`).
//
// Design decision (a) vs (b) from the issue brief: we picked **(b) —
// group refs by Bundle in the dispatch layer**. The AISectionEntityRef
// shape stays single-Bundle (no `bundleId` field on every variant), the
// existing single-Bundle ops (`bulkTranslateEntities`,
// `bulkRotateEntitiesYaw`, `bulkSelectionPivot`) keep working unchanged,
// and the cross-Bundle plumbing collects N per-Bundle ref lists, calls
// the existing op once per Bundle, then dispatches every result as ONE
// `setResourcesMulti` to the workspace. That call pushes one multi-Bundle
// HistoryCommit so undo reverts the whole gesture atomically.
//
// What this module owns:
//   - Walking the workspace bulks + filtering by visibility to produce
//     a per-Bundle `(bundleId, index, refs)` triple list.
//   - Computing the cross-Bundle pivot — the per-axis median of every
//     spatial point every ref addresses, across every affected Bundle.
//   - Building the `setResourcesMulti` write list from a delta: one
//     write per (bundleId, index) with the new model produced by running
//     the existing bulk ops against that Bundle's per-Bundle refs.

import {
	bulkRotateEntitiesYaw,
	bulkSelectionPivot,
	bulkTranslateEntities,
	type AISectionEntityRef,
} from '@/lib/core/aiSectionsOps';
import type { ParsedAISectionsV12 } from '@/lib/core/aiSections';
import { resolveSectionYs } from '@/lib/core/aiSectionY';
import type { BundleId, VisibilityNode } from '@/context/WorkspaceContext.types';
import { parseSectionPathKey } from './aiSectionsBulk';

// ---------------------------------------------------------------------------
// Per-Bundle bulk slice
// ---------------------------------------------------------------------------

/**
 * One Bundle's slice of a cross-Bundle bulk Selection — the (bundleId,
 * index) addressing plus the flat per-Bundle `AISectionEntityRef[]` the
 * existing single-Bundle bulk ops consume. The cross-Bundle dispatch
 * iterates these and runs the same op per slice.
 */
export type CrossBundleBulkSlice = {
	bundleId: BundleId;
	index: number;
	model: ParsedAISectionsV12;
	refs: readonly AISectionEntityRef[];
};

// ---------------------------------------------------------------------------
// Build slices from the workspace bulk summaries
// ---------------------------------------------------------------------------

/** Input shape from `WorkspaceAISectionsBulkValue.summaries` — we only
 *  need the (bundleId, index, pathKeys) triple here. */
export type WorkspaceBulkSummaryInput = {
	bundleId: BundleId;
	index: number;
	pathKeys: ReadonlySet<string>;
};

/** Input shape for resolving a parsed AI Sections model by (bundleId,
 *  index). The composition feeds this via `getResources('aiSections')`. */
export type ResolveModel = (
	bundleId: BundleId,
	index: number,
) => ParsedAISectionsV12 | null;

/**
 * Translate the workspace's per-(bundleId, index) bulk path-key Sets into
 * the per-Bundle slice list the cross-Bundle dispatch operates on.
 * Visibility-filtering is applied to the OUTER bundle key — an invisible
 * (loaded-but-toggled-off) Bundle / resource / instance is dropped from
 * the slice list so its sections never participate in the bulk, even if
 * their path-keys still live in the workspace bulk store (the user can
 * curate a bulk in one Bundle then toggle it off; the gizmo must ignore
 * those entities). The acceptance criterion "invisible Bundles are not
 * affected by the transform" hinges on this filter.
 *
 * Only V12 sections are emitted today; legacy V4/V6 bulks (variant
 * `legacy`) are silently skipped because the legacy overlay is read-only
 * and `bulkTranslateEntities` / `bulkRotateEntitiesYaw` only accept
 * V12-shaped roots. Adding a legacy editable path is a separate issue.
 */
export function buildCrossBundleSlices(
	summaries: readonly WorkspaceBulkSummaryInput[],
	resolveModel: ResolveModel,
	isVisible: (node: VisibilityNode) => boolean,
): CrossBundleBulkSlice[] {
	const out: CrossBundleBulkSlice[] = [];
	for (const summary of summaries) {
		if (summary.pathKeys.size === 0) continue;
		// Visibility is checked at the instance scope — same convention
		// `filterOverlaysByVisibility` uses in WorldViewportComposition.
		// An invisible Bundle / resource type cascades hidden to its
		// instances, so this single check is enough.
		const visible = isVisible({
			bundleId: summary.bundleId,
			resourceKey: 'aiSections',
			index: summary.index,
		});
		if (!visible) continue;
		const model = resolveModel(summary.bundleId, summary.index);
		if (!model) continue;
		const refs: AISectionEntityRef[] = [];
		for (const key of summary.pathKeys) {
			const addr = parseSectionPathKey(key);
			if (!addr) continue;
			if (addr.variant !== 'v12') continue;
			if (addr.sectionIndex < 0 || addr.sectionIndex >= model.sections.length) continue;
			refs.push({ kind: 'section', sectionIdx: addr.sectionIndex });
		}
		if (refs.length === 0) continue;
		out.push({
			bundleId: summary.bundleId,
			index: summary.index,
			model,
			refs,
		});
	}
	return out;
}

// ---------------------------------------------------------------------------
// Cross-Bundle pivot
// ---------------------------------------------------------------------------

/**
 * Compute the cross-Bundle bulk Pivot — the per-axis median of every
 * spatial point every selected entity addresses, across every slice.
 *
 * Implementation note: we re-derive the per-slice section Ys here because
 * the existing `bulkSelectionPivot` takes a `sectionY` resolver scoped to
 * a single model. For the cross-Bundle case we walk each slice with its
 * own Y-resolver, concatenate the spatial samples, and take the per-axis
 * median across the union. Same median (not centroid) convention as the
 * single-Bundle pivot — CONTEXT.md / "Pivot".
 *
 * Returns `null` when there are no slices, or when every slice's refs
 * point at out-of-range entities (defensive — shouldn't happen if
 * buildCrossBundleSlices filtered range).
 */
export function crossBundleBulkPivot(
	slices: readonly CrossBundleBulkSlice[],
): { x: number; y: number; z: number } | null {
	const xs: number[] = [];
	const ys: number[] = [];
	const zs: number[] = [];
	for (const slice of slices) {
		const sectionYs = resolveSectionYs(slice.model);
		const yResolver = (idx: number) => (idx < sectionYs.length ? sectionYs[idx] : 0);
		// `bulkSelectionPivot` returns the *median per axis* of the slice's
		// samples — but we need the union median across all slices, so we
		// re-walk the refs here (a partial duplicate of bulkSelectionPivot,
		// kept here so the helper stays self-contained — extracting a
		// "samples-only" helper from the aiSectionsOps module is a
		// separate, lower-stakes refactor).
		for (const ref of slice.refs) {
			const sec = slice.model.sections[ref.sectionIdx];
			if (!sec) continue;
			const y = yResolver(ref.sectionIdx);
			if (ref.kind === 'section') {
				for (const c of sec.corners) {
					xs.push(c.x); ys.push(y); zs.push(c.y);
				}
				for (const p of sec.portals) {
					xs.push(p.position.x); ys.push(p.position.y); zs.push(p.position.z);
				}
				continue;
			}
			if (ref.kind === 'portal') {
				const p = sec.portals[ref.portalIdx];
				if (!p) continue;
				xs.push(p.position.x); ys.push(p.position.y); zs.push(p.position.z);
				continue;
			}
			if (ref.kind === 'boundaryLineEndpoint') {
				const p = sec.portals[ref.portalIdx];
				const bl = p?.boundaryLines[ref.lineIdx];
				if (!bl) continue;
				if (ref.end === 0) { xs.push(bl.verts.x); ys.push(y); zs.push(bl.verts.y); }
				else { xs.push(bl.verts.z); ys.push(y); zs.push(bl.verts.w); }
				continue;
			}
			if (ref.kind === 'noGoLineEndpoint') {
				const bl = sec.noGoLines[ref.lineIdx];
				if (!bl) continue;
				if (ref.end === 0) { xs.push(bl.verts.x); ys.push(y); zs.push(bl.verts.y); }
				else { xs.push(bl.verts.z); ys.push(y); zs.push(bl.verts.w); }
				continue;
			}
		}
	}
	if (xs.length === 0) return null;
	return { x: median(xs), y: median(ys), z: median(zs) };
}

function median(values: number[]): number {
	const sorted = values.slice().sort((a, b) => a - b);
	const n = sorted.length;
	if (n === 0) return 0;
	const mid = n >> 1;
	return n % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// ---------------------------------------------------------------------------
// Per-Bundle dispatch
// ---------------------------------------------------------------------------

/**
 * Cross-Bundle bulk-transform delta — the same shape `BulkTransformDelta`
 * carries, but flattened to the fields the cross-Bundle dispatch actually
 * uses (translate XYZ + yaw rotate around the shared pivot). Pulled into
 * a local type so this module doesn't depend on the React-side delta type.
 */
export type CrossBundleDelta = {
	translate: { x: number; y: number; z: number };
	rotateY: number;
};

/**
 * Apply a single delta to every Bundle slice, producing one
 * `setResourcesMulti` write per affected Bundle/instance pair. The
 * compose order mirrors the single-Bundle bulk path (translate, then yaw
 * rotate around the post-translate pivot) so the cross-Bundle preview and
 * commit agree frame-for-frame with what the user sees during the drag.
 *
 * Returns an empty array if every slice's op resolved to the identity
 * (no-op gesture) — the caller short-circuits on empty to keep the
 * history stack clean on a cancelled gesture.
 */
export function buildCrossBundleWrites(
	slices: readonly CrossBundleBulkSlice[],
	pivot: { x: number; z: number },
	delta: CrossBundleDelta,
): {
	bundleId: BundleId;
	resourceKey: string;
	index: number;
	value: unknown;
}[] {
	const writes: {
		bundleId: BundleId;
		resourceKey: string;
		index: number;
		value: unknown;
	}[] = [];
	for (const slice of slices) {
		let next: ParsedAISectionsV12 = slice.model;
		if (delta.translate.x !== 0 || delta.translate.y !== 0 || delta.translate.z !== 0) {
			next = bulkTranslateEntities(next, slice.refs, delta.translate);
		}
		if (delta.rotateY !== 0) {
			next = bulkRotateEntitiesYaw(
				next,
				slice.refs,
				{
					x: pivot.x + delta.translate.x,
					z: pivot.z + delta.translate.z,
				},
				delta.rotateY,
			);
		}
		// Skip slices whose op returned the same model reference — the
		// op short-circuits to `===` on no-op deltas, so this filters out
		// any slice that didn't actually change. Avoids dirtying a Bundle
		// for a zero-op transform.
		if (next === slice.model) continue;
		writes.push({
			bundleId: slice.bundleId,
			resourceKey: 'aiSections',
			index: slice.index,
			value: next,
		});
	}
	return writes;
}

// Re-export so tests can construct a slice via the same helper API.
export { bulkSelectionPivot };
