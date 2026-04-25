// Pure math: turn a screen-space rectangle into a 6-plane THREE.Frustum.
//
// Ported from three.js's `SelectionBox.updateFrustum()` (perspective branch
// at three/examples/jsm/interactive/SelectionBox.js, MIT). The stock class
// is mesh-granular — its `select()` walks scene.children and tests each
// mesh's bounding-sphere center, which is too coarse when a viewport draws
// its content as one big batched mesh of thousands or millions of items.
// Lifting just the frustum-build math lets each viewport run its own
// per-item containsPoint test downstream.
//
// `start` / `end` are NDC (-1..+1, y flipped — same convention as
// `camera.unproject`). `deep` is the far-plane distance from the camera in
// world units; in the original it defaults to MAX_VALUE ("everything in
// the cone, ignore occlusion"). Pass a value calibrated to your scene
// radius (e.g. 10× radius) — MAX_VALUE flirts with float precision.
//
// Orthographic cameras are out of scope here — every viewport in this
// codebase uses a PerspectiveCamera, and the orthographic branch in the
// original SelectionBox needs a different plane construction. If we
// gain an ortho viewport later we can port that branch too.

import { Frustum, Matrix4, PerspectiveCamera, Vector3 } from 'three';

export function buildMarqueeFrustum(
	camera: PerspectiveCamera,
	start: Vector3,
	end: Vector3,
	deep: number,
): Frustum {
	camera.updateProjectionMatrix();
	camera.updateMatrixWorld();

	// Avoid degenerate (zero-area) frustums — the math collapses to NaN
	// when start.x === end.x or start.y === end.y. EPSILON is enough to
	// keep the planes distinct without visibly shifting the rectangle.
	const sx = start.x === end.x ? start.x + Number.EPSILON : start.x;
	const sy = start.y === end.y ? start.y + Number.EPSILON : start.y;
	const ex = end.x;
	const ey = end.y;

	// Normalize the rectangle so (tmpX, tmpY) is the top-left and
	// (rectEndX, rectEndY) is the bottom-right in NDC (y axis inverted
	// relative to screen space, hence "max" for top-y).
	const tmpX = Math.min(sx, ex);
	const tmpY = Math.max(sy, ey);
	const rectEndX = Math.max(sx, ex);
	const rectEndY = Math.min(sy, ey);

	const near = new Vector3().setFromMatrixPosition(camera.matrixWorld);
	const topLeft = new Vector3(tmpX, tmpY, 0).unproject(camera);
	const topRight = new Vector3(rectEndX, tmpY, 0).unproject(camera);
	const downRight = new Vector3(rectEndX, rectEndY, 0).unproject(camera);
	const downLeft = new Vector3(tmpX, rectEndY, 0).unproject(camera);

	// Ray directions from the camera through the four rectangle corners,
	// then pushed out by `deep` to anchor the far cap.
	const dirTL = topLeft.clone().sub(near).normalize().multiplyScalar(deep).add(near);
	const dirTR = topRight.clone().sub(near).normalize().multiplyScalar(deep).add(near);
	const dirDR = downRight.clone().sub(near).normalize().multiplyScalar(deep).add(near);

	const frustum = new Frustum();
	const planes = frustum.planes;
	planes[0].setFromCoplanarPoints(near, topLeft, topRight);
	planes[1].setFromCoplanarPoints(near, topRight, downRight);
	planes[2].setFromCoplanarPoints(downRight, downLeft, near);
	planes[3].setFromCoplanarPoints(downLeft, topLeft, near);
	planes[4].setFromCoplanarPoints(topRight, downRight, downLeft);
	planes[5].setFromCoplanarPoints(dirDR, dirTR, dirTL);
	planes[5].normal.multiplyScalar(-1);
	return frustum;
}

// Helper for callers that already have viewport CSS-pixel coordinates of
// the marquee rectangle plus the canvas's bounding rect. Converts both
// corners to NDC (z = 0, mid-frustum) and forwards to buildMarqueeFrustum.
export function buildMarqueeFrustumFromPixels(
	camera: PerspectiveCamera,
	startPx: { x: number; y: number },
	endPx: { x: number; y: number },
	canvasRect: { left: number; top: number; width: number; height: number },
	deep: number,
): Frustum {
	const start = new Vector3(
		((startPx.x - canvasRect.left) / canvasRect.width) * 2 - 1,
		-((startPx.y - canvasRect.top) / canvasRect.height) * 2 + 1,
		0,
	);
	const end = new Vector3(
		((endPx.x - canvasRect.left) / canvasRect.width) * 2 - 1,
		-((endPx.y - canvasRect.top) / canvasRect.height) * 2 + 1,
		0,
	);
	return buildMarqueeFrustum(camera, start, end, deep);
}

// Re-export Matrix4 so consumers don't need a separate three import for the
// rare case they want to pre-bake transforms into a candidate position.
export { Matrix4 };
