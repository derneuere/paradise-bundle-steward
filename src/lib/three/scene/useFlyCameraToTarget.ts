// Imperatively fly the camera to a target world position whenever
// `target` changes, preserving the current viewing direction so the
// motion is a fly-in (not a jump-cut to a hardcoded angle).
//
// Used to focus on a newly-selected scene element (a static traffic
// vehicle, a corner handle, etc.) — without this the user would have
// to re-aim the camera by hand whenever they pick a row in the
// inspector. `target === null` means "no focus right now"; the camera
// stays where it is.
//
// `controls` is the OrbitControls instance from `useThree().controls`
// (typed loosely to dodge r3f's `EventDispatcher | null` declared
// type). When present, we also retarget the orbit pivot so subsequent
// mouse drags spin around the new selection.

import { useEffect } from 'react';
import * as THREE from 'three';

type OrbitLikeControls = {
	target: THREE.Vector3;
	update: () => void;
} | null;

export function useFlyCameraToTarget(
	camera: THREE.Camera,
	controls: OrbitLikeControls,
	target: THREE.Vector3 | null,
	distanceFromTarget = 60,
): void {
	useEffect(() => {
		if (!target) return;
		// Pull camera back along its existing view direction so we keep the
		// user's current angle rather than jump-cutting.
		const dir = new THREE.Vector3()
			.subVectors(camera.position, controls?.target ?? target)
			.normalize();
		camera.position.copy(target).addScaledVector(dir, distanceFromTarget);
		if (controls) {
			controls.target.copy(target);
			controls.update();
		} else {
			camera.lookAt(target);
		}
	}, [camera, controls, target, distanceFromTarget]);
}
