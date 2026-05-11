// useCrossBundleBulkController — workspace-level coordination for the
// cross-Bundle bulk transform path (issue #80).
//
// The active AISections overlay owns the gizmo (per ADR-0010: exactly one
// gizmo on screen). This hook reads the WORKSPACE-wide AI sections bulk
// summaries (every (bundleId, index) with a non-empty bulk Set), filters
// them by visibility, and exposes:
//
//   - `slices` — per-Bundle `(bundleId, index, model, refs)` triples for
//     every loaded + visible AI sections instance whose bulk is non-empty.
//     The overlay uses this list to:
//       * compute the cross-Bundle Pivot (median of every spatial point
//         across every slice — `crossBundleBulkPivot`)
//       * iterate slices when committing a delta — one model write per
//         slice, all funneled through `setResourcesMulti` as one
//         multi-Bundle HistoryCommit (ADR-0006 + the multi-Bundle
//         extension in WorkspaceContext.types.ts)
//
//   - `commitDelta(pivot, delta)` — convenience: builds the
//     `setResourcesMulti` write list via `buildCrossBundleWrites` and
//     dispatches in one call. The whole gesture becomes ONE Workspace-undo
//     entry that reverts every affected Bundle atomically.
//
//   - `marqueeDispatch(hits)` — when the user drags a marquee that spans
//     multiple Bundles, the overlay walks ITS OWN sections for hits but
//     needs to dispatch hits in OTHER bundles too. This hook walks every
//     loaded + visible AI sections instance, runs the same containsPoint
//     test, and dispatches per-Bundle via `onBulkApplyPaths`. Single
//     visibility check: invisible Bundles are excluded.
//
// Invisible Bundles are filtered at the outer (bundleId, index) scope —
// any cascade up the visibility tree (Bundle off, resource off, instance
// off) drops the slice from `slices` and the dispatch from
// `marqueeDispatch`. This is what makes the issue's
// "invisible-Bundle isolation" acceptance criterion hold.

import { useCallback, useMemo } from 'react';
import * as THREE from 'three';
import { useWorkspace } from '@/context/WorkspaceContext';
import {
	useWorkspaceAISectionsBulk,
} from './AISectionsBulkProvider';
import {
	buildCrossBundleSlices,
	buildCrossBundleWrites,
	crossBundleBulkPivot,
	type CrossBundleBulkSlice,
	type CrossBundleDelta,
} from './crossBundleBulk';
import type { ParsedAISectionsV12 } from '@/lib/core/aiSections';
import type { NodePath } from '@/lib/schema/walk';

export type CrossBundleBulkController = {
	/** Per-Bundle slices for every loaded + visible AI sections instance
	 *  with a non-empty bulk. Empty when no cross-Bundle bulk exists —
	 *  caller falls back to the single-Bundle path. */
	slices: readonly CrossBundleBulkSlice[];

	/** True when the bulk spans 2+ distinct Bundles (cardinality measured
	 *  at the Bundle level, not the entity level). Drives the overlay's
	 *  decision of "should the gizmo treat this as cross-Bundle?" */
	isCrossBundle: boolean;

	/** Cross-Bundle Pivot (median of every spatial point across every
	 *  slice). `null` when `slices` is empty. Computed lazily off the
	 *  slice list — the overlay snapshots this at gesture start to avoid
	 *  drift mid-rotate. */
	pivot: { x: number; y: number; z: number } | null;

	/** Apply a single delta to every slice and dispatch as ONE workspace
	 *  multi-write — one HistoryCommit covers the whole gesture (issue
	 *  #80). The `pivot` here is the XZ slice of the gesture-start
	 *  snapshot (see CONTEXT.md / "Pivot": rotation is around the
	 *  fixed-from-gesture-start pivot). Returns the number of Bundles
	 *  that actually received a write — zero means the delta was no-op
	 *  across the board, no history entry pushed. */
	commitDelta: (
		pivot: { x: number; z: number },
		delta: CrossBundleDelta,
	) => number;

	/** Dispatch a marquee's frustum across every loaded + visible AI
	 *  sections instance. Walks each Bundle's sections, runs the same
	 *  XZ-centroid containsPoint test the single-Bundle marquee uses,
	 *  and dispatches per-Bundle via `onBulkApplyPaths`. Mode follows
	 *  the user's alt-on-pointerup decision (`'add' | 'remove'`). */
	marqueeDispatch: (
		frustum: THREE.Frustum,
		mode: 'add' | 'remove',
	) => void;
};

const AI_KEY = 'aiSections';

export function useCrossBundleBulkController(): CrossBundleBulkController {
	const { bundles, isVisible, setResourcesMulti } = useWorkspace();
	const workspaceBulk = useWorkspaceAISectionsBulk();

	// Resolve a parsed AI sections model by (bundleId, index). Pulled out
	// into a closed-over helper so both the slice builder and the marquee
	// dispatcher share one lookup path.
	const resolveModel = useCallback(
		(bundleId: string, index: number): ParsedAISectionsV12 | null => {
			const b = bundles.find((x) => x.id === bundleId);
			if (!b) return null;
			const list = b.parsedResourcesAll.get(AI_KEY);
			const model = list?.[index];
			if (!model || typeof model !== 'object') return null;
			// V12 is the only editable shape; legacy V4/V6 has a `legacy`
			// wrapper and isn't yet wired through the bulk ops (the legacy
			// overlay is read-only).
			if ('legacy' in (model as object)) return null;
			return model as ParsedAISectionsV12;
		},
		[bundles],
	);

	const slices = useMemo<readonly CrossBundleBulkSlice[]>(() => {
		const summaries = workspaceBulk?.summaries ?? [];
		return buildCrossBundleSlices(summaries, resolveModel, isVisible);
	}, [workspaceBulk?.summaries, resolveModel, isVisible]);

	const isCrossBundle = useMemo(() => {
		const distinctBundles = new Set<string>();
		for (const slice of slices) distinctBundles.add(slice.bundleId);
		return distinctBundles.size >= 2;
	}, [slices]);

	const pivot = useMemo(() => crossBundleBulkPivot(slices), [slices]);

	const commitDelta = useCallback(
		(
			snapshotPivot: { x: number; z: number },
			delta: CrossBundleDelta,
		): number => {
			const writes = buildCrossBundleWrites(slices, snapshotPivot, delta);
			if (writes.length === 0) return 0;
			setResourcesMulti(writes);
			return writes.length;
		},
		[slices, setResourcesMulti],
	);

	const marqueeDispatch = useCallback(
		(frustum: THREE.Frustum, mode: 'add' | 'remove') => {
			if (!workspaceBulk) return;
			// Iterate every loaded Bundle's aiSections instances. The
			// visibility check drops invisible (bundle / resource-type /
			// instance) entries — same gate the slice builder uses, so
			// "marquee can't pick up hidden Bundle's sections" is one-and-
			// the-same with "hidden Bundle is not in the bulk".
			for (const bundle of bundles) {
				const list = bundle.parsedResourcesAll.get(AI_KEY);
				if (!list || list.length === 0) continue;
				for (let index = 0; index < list.length; index++) {
					const model = list[index];
					if (!model || typeof model !== 'object') continue;
					if ('legacy' in (model as object)) continue;
					if (!isVisible({ bundleId: bundle.id, resourceKey: AI_KEY, index })) continue;
					const v12 = model as ParsedAISectionsV12;
					const hits: NodePath[] = [];
					const pt = new THREE.Vector3();
					for (let i = 0; i < v12.sections.length; i++) {
						const corners = v12.sections[i].corners;
						if (corners.length === 0) continue;
						let sx = 0, sy = 0;
						for (const c of corners) { sx += c.x; sy += c.y; }
						const n = corners.length;
						pt.set(sx / n, 0, sy / n);
						if (frustum.containsPoint(pt)) hits.push(['sections', i]);
					}
					if (hits.length === 0) continue;
					workspaceBulk.onBulkApplyPaths(bundle.id, index, hits, mode);
				}
			}
		},
		[bundles, isVisible, workspaceBulk],
	);

	return { slices, isCrossBundle, pivot, commitDelta, marqueeDispatch };
}
