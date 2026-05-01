// Sync R3F's `useThree()` camera + viewport size out of the <Canvas> tree
// into a parent ref, so React code outside the canvas (HTML overlays,
// marquee selectors, click handlers that need camera math) can read the
// live camera without ad-hoc context plumbing.
//
// The ref's `current` is `null` until R3F mounts and fires the effect —
// consumers that read on pointerdown won't see the issue (drag happens
// after mount), but anything reading during the first render must guard.
//
// Restricted to PerspectiveCamera because every viewport here uses one and
// downstream marquee math depends on it.

import { useEffect } from 'react';
import * as THREE from 'three';

export type CameraBridgeData = {
	camera: THREE.PerspectiveCamera;
	size: { width: number; height: number };
};

export function useCameraBridgeSync(
	bridge: React.MutableRefObject<CameraBridgeData | null>,
	camera: THREE.Camera,
	size: { width: number; height: number },
): void {
	useEffect(() => {
		if ((camera as THREE.PerspectiveCamera).isPerspectiveCamera) {
			bridge.current = { camera: camera as THREE.PerspectiveCamera, size };
		}
		return () => { bridge.current = null; };
	}, [camera, size, bridge]);
}
