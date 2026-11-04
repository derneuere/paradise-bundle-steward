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
// group refs by Bundle in the dispatch layer**. `AISectionRef` stays
// single-Bundle (no `bundleId` field on every variant); the cross-Bundle
// plumbing collects N per-Bundle ref lists, runs the shared `transform`
// once per Bundle, then dispatches every result as ONE `setResourcesMulti`
// to the workspace. That call pushes one multi-Bundle HistoryCommit so undo
// reverts the whole gesture atomically.
//
// What this module owns:
//   - Walking the workspace bulks + filtering by visibility to produce
//     a per-Bundle `(bundleId, index, refs)` triple list.
//   - Computing the cross-Bundle pivot — one median over every slice's
//     spatial samples concatenated, via the shared `bindingsPivot`.
//   - Building the `setResourcesMulti` write list from a delta: one write
//     per (bundleId, index) with the model the shared `transform` produced
//     for that Bundle's refs.

import { bindTransform, bindingsPivot, transform, type Point } from '@/lib/core/transform';
import {
	createAISectionsResolver,
	type AISectionRef,
} from '@/lib/core/transform/resolvers/aiSections';
import type { ParsedAISectionsV12 } from '@/lib/core/aiSections';
import type { BundleId, VisibilityNode } from '@/context/WorkspaceContext.types';
import { parseSectionPathKey } from './aiSectionsBulk';

// ---------------------------------------------------------------------------
// Per-Bundle bulk slice
// ---------------------------------------------------------------------------

/**
 * One Bundle's slice of a cross-Bundle bulk Selection — the (bundleId,
 * index) addressing plus that Bundle's flat `AISectionRef[]`. The dispatch
 * iterates these and runs the same `transform` per slice.
 */
export type CrossBundleBulkSlice = {
	bundleId: BundleId;
	index: number;
	model: ParsedAISectionsV12;
	refs: readonly AISectionRef[];
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
 * and the AI-sections resolver only accepts V12-shaped roots. Adding a
 * legacy editable path is a separate issue.
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
		const refs: AISectionRef[] = [];
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
 * Compute the cross-Bundle bulk **Pivot** — the per-axis median of every
 * spatial point every selected entity addresses, across every slice.
 *
 * The median is taken over the CONCATENATION of every slice's samples, not
 * over the per-slice medians, so a Bundle contributing twenty sections weighs
 * twenty times a Bundle contributing one. Each slice binds its own resolver
 * (AI-section corner Y is derived per model), and the shared `bindingsPivot`
 * does the rest — the hand-rolled sampler and its private `median` that used
 * to live here were a verbatim copy of the single-Bundle one and drifted.
 *
 * Returns `null` when there are no slices, or when every slice's refs point at
 * out-of-range entities.
 */
export function crossBundleBulkPivot(
	slices: readonly CrossBundleBulkSlice[],
): Point | null {
	return bindingsPivot(
		slices.map((slice) =>
			bindTransform(createAISectionsResolver(slice.model), slice.model, slice.refs, () => {})),
	);
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
		// One `transform` per slice, with the SAME gesture-start pivot for
		// every Bundle — that is what makes a marquee spanning two track units
		// turn as one rigid body instead of two.
		const next = transform(
			slice.model,
			slice.refs,
			{
				translate: delta.translate,
				rotate: { x: 0, y: delta.rotateY, z: 0 },
				// `pivot.y` is irrelevant to a yaw and cancels out of the
				// orbit; AI sections expose no other rotate axis (ADR-0011).
				pivot: { x: pivot.x, y: 0, z: pivot.z },
			},
			createAISectionsResolver(slice.model),
		);
		// Skip slices whose transform returned the same model reference — the
		// resolver reports "nothing actually changed" by identity, so this
		// avoids dirtying a Bundle for a zero-op gesture.
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
