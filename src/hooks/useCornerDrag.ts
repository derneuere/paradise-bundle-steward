// Window-level pointer + key drag listeners for the AISection corner
// handles, only mounted while a drag is in flight.
//
// Mirrors the pattern in `useTranslateGizmoDrag` — R3F's per-mesh pointer
// events stop firing once the cursor leaves the handle sphere, so we
// listen on the window during a drag to keep the preview live as the
// user roams off the mesh. OrbitControls are disabled for the duration
// (no orbit-vs-drag fight) and the cursor is restored on cleanup, which
// fires on pointerup, on Escape, or on unmount.
//
// `dragRef` carries the corner being moved and the world XZ at pointer-
// down — held in a ref instead of state so the listeners read it without
// retriggering effect re-mounts mid-drag.

import { useEffect } from 'react';
import * as THREE from 'three';
import { unprojectToGroundPlane } from '@/lib/three/groundPlane';
import type { CornerDragOffset } from '@/components/aisections/CornerHandles';

export type CornerDragOptions = {
	active: number | null;
	camera: THREE.Camera;
	canvas: HTMLCanvasElement;
	/** OrbitControls instance from `useThree().controls`, if present. */
	controls: { enabled: boolean } | null;
	dragRef: React.MutableRefObject<{
		cornerIdx: number;
		startWorld: { x: number; z: number };
	} | null>;
	onDrag: (cornerIdx: number, offset: CornerDragOffset) => void;
	onCommit: (cornerIdx: number, offset: CornerDragOffset) => void;
	onCancel?: () => void;
	setActive: (a: number | null) => void;
};

export function useCornerDrag({
	active,
	camera,
	canvas,
	controls,
	dragRef,
	onDrag,
	onCommit,
	onCancel,
	setActive,
}: CornerDragOptions): void {
	useEffect(() => {
		if (active === null) return;

		const prevEnabled = controls?.enabled ?? true;
		if (controls) controls.enabled = false;

		const handleMove = (e: PointerEvent) => {
			const drag = dragRef.current;
			if (!drag) return;
			const world = unprojectToGroundPlane(e.clientX, e.clientY, camera, canvas, 0);
			if (!world) return;
			onDrag(drag.cornerIdx, {
				x: world.x - drag.startWorld.x,
				z: world.z - drag.startWorld.z,
			});
		};

		const handleUp = (e: PointerEvent) => {
			const drag = dragRef.current;
			if (!drag) return;
			const world = unprojectToGroundPlane(e.clientX, e.clientY, camera, canvas, 0);
			const offset = world
				? { x: world.x - drag.startWorld.x, z: world.z - drag.startWorld.z }
				: { x: 0, z: 0 };
			dragRef.current = null;
			setActive(null);
			onCommit(drag.cornerIdx, offset);
		};

		const handleKey = (e: KeyboardEvent) => {
			if (e.key !== 'Escape') return;
			const drag = dragRef.current;
			if (!drag) return;
			dragRef.current = null;
			setActive(null);
			onDrag(drag.cornerIdx, { x: 0, z: 0 });
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
	}, [active, camera, canvas, controls, dragRef, onDrag, onCommit, onCancel, setActive]);
}
