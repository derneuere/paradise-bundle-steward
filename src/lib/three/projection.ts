// World ↔ screen projection helpers shared by the BulkTransformGizmo and its
// drag hook. Lives in `src/lib/three/` (not `components/common/three/`) so
// the hook can import without creating a circular import boundary back into
// the gizmo component.

import * as THREE from 'three';

/**
 * Project a world point onto screen (CSS-pixel) coordinates. Used to derive
 * the screen-space angle between the cursor and the gizmo's pivot for
 * rotate drags. Returns null if the point is behind the camera (NDC z out
 * of [-1, 1]).
 */
export function projectToScreen(
	world: THREE.Vector3,
	camera: THREE.Camera,
	canvas: HTMLCanvasElement,
): { x: number; y: number } | null {
	const ndc = world.clone().project(camera);
	if (ndc.z > 1 || ndc.z < -1) return null;
	const rect = canvas.getBoundingClientRect();
	return {
		x: rect.left + ((ndc.x + 1) / 2) * rect.width,
		y: rect.top + ((-ndc.y + 1) / 2) * rect.height,
	};
}

/**
 * Unproject a viewport-space pointer event onto an arbitrary plane through
 * `pivot` with the supplied `normal`. Returns null when the ray is parallel
 * to the plane (no intersection). Generalisation of `unprojectToGroundPlane`
 * for non-Y-up planes — used by the BulkTransformGizmo's Y-axis translate
 * handle when the ground plane is parallel to the cursor's view ray.
 */
export function unprojectToPlane(
	clientX: number,
	clientY: number,
	camera: THREE.Camera,
	canvas: HTMLCanvasElement,
	pivot: THREE.Vector3,
	normal: THREE.Vector3,
): THREE.Vector3 | null {
	const rect = canvas.getBoundingClientRect();
	const ndc = new THREE.Vector2(
		((clientX - rect.left) / rect.width) * 2 - 1,
		-((clientY - rect.top) / rect.height) * 2 + 1,
	);
	const raycaster = new THREE.Raycaster();
	raycaster.setFromCamera(ndc, camera);
	// THREE.Plane is defined by `normal · x + constant = 0`. To make the
	// plane pass through `pivot`, set constant = -normal·pivot.
	const constant = -normal.clone().dot(pivot);
	const plane = new THREE.Plane(normal.clone().normalize(), constant);
	const hit = new THREE.Vector3();
	const ok = raycaster.ray.intersectPlane(plane, hit);
	return ok ? hit : null;
}
