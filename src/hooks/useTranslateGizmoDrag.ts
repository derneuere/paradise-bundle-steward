// Window-level pointer + key drag listeners for the TranslateGizmo, only
// mounted while a drag is in flight.
//
// R3F's per-mesh pointer events stop firing once the cursor leaves the
// arrow mesh, which would freeze the preview as soon as the user drags
// far enough to fall off the hit cylinder. Listening on the window
// sidesteps that while still letting us cleanly tear down on release.
//
// During the drag we also disable OrbitControls (so camera orbit doesn't
// compete with the gesture) and force `document.body.style.cursor`. Both
// are restored on cleanup, which fires either on pointerup, on Escape, or
// on unmount.

import { useEffect } from 'react';
import * as THREE from 'three';
import type { GizmoOffset } from '@/components/common/three/TranslateGizmo';

type Axis = 'x' | 'z' | 'free';

export type TranslateGizmoDragOptions = {
	active: Axis | null;
	camera: THREE.Camera;
	canvas: HTMLCanvasElement;
	/** OrbitControls instance from `useThree().controls`, if present. */
	controls: { enabled: boolean } | null;
	/** Y of the ground plane the gizmo drags on. */
	planeY: number;
	dragStart: React.MutableRefObject<{ axis: Axis; world: THREE.Vector3 } | null>;
	onTranslate: (offset: GizmoOffset) => void;
	onCommit: (offset: GizmoOffset) => void;
	onCancel?: () => void;
	/** Setter for the drag's `active` axis — cleared on commit / cancel. */
	setActive: (a: Axis | null) => void;
};

export function useTranslateGizmoDrag({
	active,
	camera,
	canvas,
	controls,
	planeY,
	dragStart,
	onTranslate,
	onCommit,
	onCancel,
	setActive,
}: TranslateGizmoDragOptions): void {
	useEffect(() => {
		if (!active) return;

		const prevEnabled = controls?.enabled ?? true;
		if (controls) controls.enabled = false;

		const handleMove = (e: PointerEvent) => {
			const drag = dragStart.current;
			if (!drag) return;
			const world = unprojectToGroundPlane(e.clientX, e.clientY, camera, canvas, planeY);
			if (!world) return;
			onTranslate(constrainToAxis(drag.axis, drag.world, world));
		};

		const handleUp = (e: PointerEvent) => {
			const drag = dragStart.current;
			if (!drag) return;
			const world = unprojectToGroundPlane(e.clientX, e.clientY, camera, canvas, planeY);
			const offset = world
				? constrainToAxis(drag.axis, drag.world, world)
				: { x: 0, z: 0 };
			dragStart.current = null;
			setActive(null);
			onCommit(offset);
		};

		const handleKey = (e: KeyboardEvent) => {
			if (e.key !== 'Escape') return;
			dragStart.current = null;
			setActive(null);
			onTranslate({ x: 0, z: 0 });
			onCancel?.();
		};

		window.addEventListener('pointermove', handleMove);
		window.addEventListener('pointerup', handleUp);
		window.addEventListener('keydown', handleKey);
		return () => {
			window.removeEventListener('pointermove', handleMove);
			window.removeEventListener('pointerup', handleUp);
			window.removeEventListener('keydown', handleKey);
			if (controls) controls.enabled = prevEnabled;
			document.body.style.cursor = 'auto';
		};
	}, [active, camera, canvas, controls, planeY, dragStart, onTranslate, onCommit, onCancel, setActive]);
}

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

function constrainToAxis(
	axis: Axis,
	start: THREE.Vector3,
	current: THREE.Vector3,
): GizmoOffset {
	const dx = current.x - start.x;
	const dz = current.z - start.z;
	if (axis === 'x') return { x: dx, z: 0 };
	if (axis === 'z') return { x: 0, z: dz };
	return { x: dx, z: dz };
}
