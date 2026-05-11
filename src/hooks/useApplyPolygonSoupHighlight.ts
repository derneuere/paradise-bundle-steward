// Repaint a batched-PolygonSoupList geometry's per-vertex colors so the
// selected-model and selected-polygons appear amber on top of the base
// colors stashed by `useCachedColorAttribute`. The actual color math
// lives in PolygonSoupListOverlay's local `applyHighlight` helper —
// this hook is just the imperative side-effect wrapper that schedules
// it whenever the inputs change.
//
// `applyHighlight` mutates the geometry attribute in place rather than
// allocating a new Float32Array per repaint — a typical bundle has
// ~10k highlightable verts and per-frame allocations would tank FPS
// during marquee drag.

import { useEffect } from 'react';
import * as THREE from 'three';

type ApplyHighlightFn = (
	geometry: THREE.BufferGeometry,
	ranges: { start: number; count: number }[],
	baseColors: Float32Array,
	faceToLocation: Int32Array,
	selectedModelIndex: number,
	selectedPolysInCurrentModel: ReadonlySet<number>,
	skippedByBulkTransform?: boolean,
) => void;

export function useApplyPolygonSoupHighlight(
	apply: ApplyHighlightFn,
	geometry: THREE.BufferGeometry,
	ranges: { start: number; count: number }[],
	baseColorsRef: React.MutableRefObject<Float32Array | null>,
	faceToLocation: Int32Array,
	selectedModelIndex: number,
	selectedPolysInCurrentModel: ReadonlySet<number>,
	/** When true, the bulk-paint colour switches to a red-tinted dim variant
	 *  so the user can visually distinguish polygon-soup polys that the Bulk
	 *  transform gizmo is SKIPPING (because the Selection also contains
	 *  transformable entities — issue #82). When false, the standard amber
	 *  paint is used. */
	skippedByBulkTransform: boolean = false,
): void {
	useEffect(() => {
		if (!baseColorsRef.current) return;
		apply(
			geometry,
			ranges,
			baseColorsRef.current,
			faceToLocation,
			selectedModelIndex,
			selectedPolysInCurrentModel,
			skippedByBulkTransform,
		);
	}, [
		apply,
		geometry,
		ranges,
		baseColorsRef,
		faceToLocation,
		selectedModelIndex,
		selectedPolysInCurrentModel,
		skippedByBulkTransform,
	]);
}
