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
) => void;

export function useApplyPolygonSoupHighlight(
	apply: ApplyHighlightFn,
	geometry: THREE.BufferGeometry,
	ranges: { start: number; count: number }[],
	baseColorsRef: React.MutableRefObject<Float32Array | null>,
	faceToLocation: Int32Array,
	selectedModelIndex: number,
	selectedPolysInCurrentModel: ReadonlySet<number>,
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
		);
	}, [
		apply,
		geometry,
		ranges,
		baseColorsRef,
		faceToLocation,
		selectedModelIndex,
		selectedPolysInCurrentModel,
	]);
}
