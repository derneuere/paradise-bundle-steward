// Apply a 4×4 matrix to a single three.js object every render where the
// matrix value changes. Disables `matrixAutoUpdate` so three.js doesn't
// re-derive the matrix from position/rotation/scale on top of our copy,
// and calls `updateMatrixWorld(true)` so the change is visible the same
// frame (without waiting for r3f's next animation step).
//
// Matched pair to `useApplyDisplayMatrix` — that one writes to a
// (mesh, edges) pair shared by RotationVisualizer's preview box; this
// one is the single-target variant for highlight overlays.

import { useEffect } from 'react';
import * as THREE from 'three';

export function useApplyMatrixToObject(
	ref: React.MutableRefObject<THREE.Object3D | null>,
	matrix: THREE.Matrix4 | null,
): void {
	useEffect(() => {
		if (!ref.current || !matrix) return;
		ref.current.matrix.copy(matrix);
		ref.current.matrixAutoUpdate = false;
		ref.current.updateMatrixWorld(true);
	}, [ref, matrix]);
}
