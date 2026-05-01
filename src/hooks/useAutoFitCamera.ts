// One-shot camera auto-fit for an R3F viewport — positions the active
// perspective camera to frame a sphere of `radius` around `center` once
// on mount, then steps out of the way so OrbitControls / user input owns
// the camera afterwards.
//
// Latches via an internal ref so subsequent prop changes (e.g. the user
// switching resources, which produces a new center/radius) don't snap the
// camera back to the fit position mid-edit. To force a refit, mount a
// fresh `<AutoFit key={resourceId} />` (the `key` resets the ref).

import { useEffect, useRef } from 'react';
import * as THREE from 'three';

export type AutoFitCameraOptions = {
	camera: THREE.Camera;
	center: THREE.Vector3;
	radius: number;
	/** Multiplier applied to `radius` for the camera distance. */
	distanceFactor: number;
	/** Multiplier applied to `radius` for the camera's `far` plane. */
	farFactor: number;
	/** When false, leave the camera's `far` plane untouched. Useful when
	 *  the Canvas already sets a `far` value the viewport wants to keep. */
	setFar: boolean;
};

export function useAutoFitCamera({
	camera,
	center,
	radius,
	distanceFactor,
	farFactor,
	setFar,
}: AutoFitCameraOptions): void {
	const fitted = useRef(false);
	useEffect(() => {
		if (fitted.current) return;
		fitted.current = true;
		const d = radius * distanceFactor;
		camera.position.set(center.x, center.y + d, center.z + d * 0.3);
		camera.lookAt(center);
		if (setFar && 'far' in camera) {
			(camera as THREE.PerspectiveCamera).far = radius * farFactor;
			(camera as THREE.PerspectiveCamera).updateProjectionMatrix();
		}
	}, [camera, center, radius, distanceFactor, farFactor, setFar]);
}
