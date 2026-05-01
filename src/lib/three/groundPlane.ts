// Unproject a viewport-space pointer event onto a horizontal ground plane
// at world `planeY`. Returns null when the pointer ray is parallel to the
// plane (camera looking horizontally — no intersection). Used by every
// XZ-plane drag gesture in the editor.

import * as THREE from 'three';

export function unprojectToGroundPlane(
	clientX: number,
	clientY: number,
	camera: THREE.Camera,
	canvas: HTMLCanvasElement,
	planeY: number,
): THREE.Vector3 | null {
	const rect = canvas.getBoundingClientRect();
	const ndc = new THREE.Vector2(
		((clientX - rect.left) / rect.width) * 2 - 1,
		-((clientY - rect.top) / rect.height) * 2 + 1,
	);
	const raycaster = new THREE.Raycaster();
	raycaster.setFromCamera(ndc, camera);
	const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -planeY);
	const hit = new THREE.Vector3();
	const ok = raycaster.ray.intersectPlane(plane, hit);
	return ok ? hit : null;
}
