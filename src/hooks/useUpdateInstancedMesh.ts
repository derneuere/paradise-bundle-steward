// Imperatively update a `THREE.InstancedMesh`'s per-instance matrices
// and (optionally) colors when source data changes.
//
// `apply` is called once per dependency change; the caller iterates the
// `count` instances inside it and writes into `mesh.setMatrixAt(i, …)`
// and `mesh.setColorAt(i, …)`. The hook flips both `needsUpdate` flags
// after `apply` so three.js re-uploads the buffers next frame.
//
// Skips when `count === 0` (empty mesh) so consumers don't have to
// guard at the call site.

import { useEffect } from 'react';
import * as THREE from 'three';

export function useUpdateInstancedMesh(
	meshRef: React.MutableRefObject<THREE.InstancedMesh | null>,
	count: number,
	apply: (mesh: THREE.InstancedMesh) => void,
	deps: React.DependencyList,
): void {
	useEffect(() => {
		const mesh = meshRef.current;
		if (!mesh || count === 0) return;
		apply(mesh);
		mesh.instanceMatrix.needsUpdate = true;
		if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
		// Caller controls the dep array — typically the source arrays the
		// per-instance data is derived from.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, deps);
}
