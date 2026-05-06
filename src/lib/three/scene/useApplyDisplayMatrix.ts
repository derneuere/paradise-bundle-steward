// Apply a 4x4 display matrix to a pair of three.js objects (mesh +
// edges) every time the matrix value changes.
//
// Used by RotationVisualizer's PreviewBox to drive the box and its
// edge-overlay from the schema's matrix value. We disable
// `matrixAutoUpdate` so three.js doesn't re-derive matrix from
// position/rotation/scale — the schema matrix IS the source of truth,
// including any non-uniform scale or shear.

import { useEffect } from 'react';
import * as THREE from 'three';

export function useApplyDisplayMatrix(
	meshRef: React.MutableRefObject<THREE.Object3D | null>,
	edgesRef: React.MutableRefObject<THREE.Object3D | null>,
	matrix: THREE.Matrix4,
): void {
	useEffect(() => {
		if (meshRef.current) {
			meshRef.current.matrixAutoUpdate = false;
			meshRef.current.matrix.copy(matrix);
		}
		if (edgesRef.current) {
			edgesRef.current.matrixAutoUpdate = false;
			edgesRef.current.matrix.copy(matrix);
		}
	}, [matrix, meshRef, edgesRef]);
}
