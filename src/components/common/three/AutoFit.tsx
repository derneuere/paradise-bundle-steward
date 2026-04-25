// Camera auto-fit — positions the active perspective camera to frame a
// sphere of `radius` around `center` once on mount, then steps out of the
// way so OrbitControls / user input owns the camera afterwards. Every
// resource viewport in this codebase had a near-identical copy of this;
// shared here so they all behave the same and stay in sync.
//
// Latches via `fitted.current` so subsequent prop changes (e.g. the user
// switching resources, which produces a new center/radius) don't snap the
// camera back to the fit position mid-edit. If a viewport actually wants
// to refit on prop change, it can mount a fresh `<AutoFit key={resourceId} />`.

import { useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';

export type AutoFitProps = {
	center: THREE.Vector3;
	radius: number;
	/** Multiplier applied to `radius` for the camera distance. The default
	 *  (1.5×) gives a comfortable margin around the scene without zooming
	 *  out so far that small features become unreadable. */
	distanceFactor?: number;
	/** Multiplier applied to `radius` for the camera's `far` plane. Default
	 *  10× radius keeps depth precision reasonable while still rendering
	 *  the whole scene. */
	farFactor?: number;
};

export function AutoFit({ center, radius, distanceFactor = 1.5, farFactor = 10 }: AutoFitProps) {
	const { camera } = useThree();
	const fitted = useRef(false);
	useEffect(() => {
		if (fitted.current) return;
		fitted.current = true;
		const d = radius * distanceFactor;
		camera.position.set(center.x, center.y + d, center.z + d * 0.3);
		camera.lookAt(center);
		if ('far' in camera) {
			(camera as THREE.PerspectiveCamera).far = radius * farFactor;
			(camera as THREE.PerspectiveCamera).updateProjectionMatrix();
		}
	}, [camera, center, radius, distanceFactor, farFactor]);
	return null;
}
