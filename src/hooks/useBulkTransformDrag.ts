// Window-level pointer + key drag listeners for the BulkTransformGizmo,
// only mounted while a drag is in flight.
//
// R3F's per-mesh pointer events stop firing once the cursor leaves the
// handle mesh, so we listen on the window so the preview keeps updating
// even when the user drags far past the gizmo. The active drag also
// disables OrbitControls (so camera orbit doesn't compete with the
// gesture) and forces `document.body.style.cursor`. Cleanup restores both
// on pointerup, on Escape, or on unmount.
//
// One gesture = one undo entry. The hook calls `onTransform` continuously
// (preview-only) and `onCommit` exactly once on pointer release. Escape
// fires `onCancel` and resets the preview without committing.
//
// Translate math: a 3D pointer offset on the drag plane is projected onto
// the chosen axis vector, so off-axis cursor motion doesn't leak into the
// translate. Rotate math: a screen-space angle delta around the projected
// pivot is applied around the world-space rotation axis. Both deltas are
// cumulative from the gesture's start so the consumer can render a live
// preview from the identity each frame.

import { useEffect } from 'react';
import * as THREE from 'three';
import { projectToScreen, unprojectToPlane } from '@/lib/three/projection';

// =============================================================================
// Types
// =============================================================================

export type GizmoHandleKind = 'translate' | 'rotate' | 'pivot';
export type GizmoHandleAxis = 'x' | 'y' | 'z';

/**
 * Pseudo-axis used by the **Pivot** drag handle (issue #76). The pivot
 * handle is not axis-locked — it drags freely on a screen-aligned plane
 * through the pivot — so we collapse "no axis lock" onto the 'y' tag for
 * the `GizmoHandleAxis` discriminator. Callers check `kind === 'pivot'`
 * before reading axis.
 */
export const PIVOT_AXIS: GizmoHandleAxis = 'y';

/**
 * One gesture's accumulated delta. Translate is a `(dx, dy, dz)` offset in
 * world space; rotate is a per-axis Euler angle in radians applied around
 * the gizmo's pivot. Pitch/roll are present in the type so future slices
 * (trigger box gizmo) get the same shape — for the AI section MVP only
 * `rotate.y` is ever non-zero (ADR-0011 yaw-lock).
 *
 * `cascade` is the **Cascade** opt-in flag (CONTEXT.md / "Cascade", ADR-0009
 * and issue #75). Captured at gesture START — pressing or releasing the
 * cascade modifier mid-drag does NOT flip the mode for consistent gesture
 * semantics. When true, consumers should route to the cascade-on op variants
 * (`translateSectionWithLinks`, `rotateSectionWithLinksYaw`, etc.) that drag
 * outside-neighbour reverse portals and shared corners along with the
 * selection; when false (the ADR-0009 default), consumers run the rigid /
 * no-cascade ops and outside neighbours stay put.
 */
export type BulkTransformDelta = {
	translate: { x: number; y: number; z: number };
	rotate: { x: number; y: number; z: number };
	cascade: boolean;
};

export type BulkTransformDragOptions = {
	active: { kind: GizmoHandleKind; axis: GizmoHandleAxis } | null;
	camera: THREE.Camera;
	canvas: HTMLCanvasElement;
	/** OrbitControls instance from `useThree().controls`, if present. */
	controls: { enabled: boolean } | null;
	/** Gizmo's world-space pivot — translate planes pass through it; rotate
	 *  rings are centred on it. */
	pivot: THREE.Vector3;
	/** Drag-start state captured by the gizmo on pointerdown. */
	dragStart: React.MutableRefObject<{
		kind: GizmoHandleKind;
		axis: GizmoHandleAxis;
		pivot: THREE.Vector3;
		anchorWorld?: THREE.Vector3;
		anchorAngle?: number;
		rotationAxisWorld?: THREE.Vector3;
		/** **Cascade** opt-in flag captured at pointer-down. Stays fixed for
		 *  the lifetime of the gesture — pressing or releasing the modifier
		 *  mid-drag does NOT switch modes. See `BulkTransformDelta.cascade`. */
		cascade?: boolean;
		/** Pivot-drag-specific: screen-aligned plane normal captured at pointer-
		 *  down so the per-frame mover unprojects to the same plane the user
		 *  started on (issue #76). */
		pivotPlaneNormal?: THREE.Vector3;
	} | null>;
	onTransform: (delta: BulkTransformDelta) => void;
	onCommit: (delta: BulkTransformDelta) => void;
	onCancel?: () => void;
	setActive: (a: { kind: GizmoHandleKind; axis: GizmoHandleAxis } | null) => void;
	/**
	 * Pivot drag-reposition (issue #76). When the user drags the dedicated
	 * pivot handle, this fires continuously with the new absolute pivot
	 * world position — NOT a delta of the Selection. The handler must NOT
	 * mutate the Selection; it only updates UI state for where the gizmo
	 * lives. Optional so existing consumers that don't ship the pivot
	 * handle keep compiling.
	 */
	onPivotMove?: (worldPos: { x: number; y: number; z: number }) => void;
	/**
	 * Pivot drag-reposition committed (issue #76). Fires once on pointer
	 * release with the final pivot position. Consumers persist the new
	 * pivot here so subsequent transforms anchor at it. This is NOT a
	 * Workspace-undo step — pivot is pure UI state (CONTEXT.md / "Pivot").
	 */
	onPivotCommit?: (worldPos: { x: number; y: number; z: number }) => void;
	/**
	 * Pivot drag cancelled mid-gesture (Escape). Fires once with the
	 * pivot's pre-gesture position. Consumers should restore the
	 * gizmo to that location. Optional.
	 */
	onPivotCancel?: (worldPos: { x: number; y: number; z: number }) => void;
};

// =============================================================================
// Hook
// =============================================================================

export function useBulkTransformDrag({
	active,
	camera,
	canvas,
	controls,
	pivot,
	dragStart,
	onTransform,
	onCommit,
	onCancel,
	setActive,
	onPivotMove,
	onPivotCommit,
	onPivotCancel,
}: BulkTransformDragOptions): void {
	useEffect(() => {
		if (!active) return;

		const prevEnabled = controls?.enabled ?? true;
		if (controls) controls.enabled = false;

		const computeDelta = (clientX: number, clientY: number): BulkTransformDelta | null => {
			const start = dragStart.current;
			if (!start) return null;
			if (start.kind === 'translate') {
				return computeTranslateDelta(start, clientX, clientY, camera, canvas);
			}
			if (start.kind === 'rotate') {
				return computeRotateDelta(start, clientX, clientY, camera, canvas);
			}
			// Pivot drags don't produce a Selection-affecting delta; they
			// emit through `onPivotMove` / `onPivotCommit` instead. Returning
			// null here keeps `onTransform` / `onCommit` from firing during
			// a pivot gesture (the central correctness contract — pivot
			// reposition must NOT mutate the Selection).
			return null;
		};

		// Compute the new absolute world pivot for a pivot-drag gesture.
		// Returns null if the start state isn't a pivot drag, or if the
		// cursor unprojects outside the start plane.
		const computePivotPosition = (
			clientX: number,
			clientY: number,
		): { x: number; y: number; z: number } | null => {
			const start = dragStart.current;
			if (!start || start.kind !== 'pivot') return null;
			const planeNormal = start.pivotPlaneNormal;
			const anchor = start.anchorWorld;
			if (!planeNormal || !anchor) return null;
			const current = unprojectToPlane(clientX, clientY, camera, canvas, anchor, planeNormal);
			if (!current) return null;
			return { x: current.x, y: current.y, z: current.z };
		};

		const handleMove = (e: PointerEvent) => {
			const start = dragStart.current;
			if (start?.kind === 'pivot') {
				const next = computePivotPosition(e.clientX, e.clientY);
				if (next) onPivotMove?.(next);
				return;
			}
			const delta = computeDelta(e.clientX, e.clientY);
			if (!delta) return;
			onTransform(delta);
		};

		const handleUp = (e: PointerEvent) => {
			const start = dragStart.current;
			if (start?.kind === 'pivot') {
				const next = computePivotPosition(e.clientX, e.clientY)
					?? { x: start.pivot.x, y: start.pivot.y, z: start.pivot.z };
				dragStart.current = null;
				setActive(null);
				onPivotCommit?.(next);
				return;
			}
			const cascade = start?.cascade === true;
			const delta = computeDelta(e.clientX, e.clientY) ?? identityDelta(cascade);
			dragStart.current = null;
			setActive(null);
			onCommit(delta);
		};

		const handleKey = (e: KeyboardEvent) => {
			if (e.key !== 'Escape') return;
			const start = dragStart.current;
			if (start?.kind === 'pivot') {
				const restore = { x: start.pivot.x, y: start.pivot.y, z: start.pivot.z };
				dragStart.current = null;
				setActive(null);
				onPivotMove?.(restore);
				onPivotCancel?.(restore);
				return;
			}
			const cascade = start?.cascade === true;
			dragStart.current = null;
			setActive(null);
			onTransform(identityDelta(cascade));
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
	}, [
		active, camera, canvas, controls, dragStart,
		onTransform, onCommit, onCancel, setActive,
		onPivotMove, onPivotCommit, onPivotCancel,
	]);
}

// =============================================================================
// Delta math — translate
// =============================================================================

function computeTranslateDelta(
	start: NonNullable<BulkTransformDragOptions['dragStart']['current']>,
	clientX: number,
	clientY: number,
	camera: THREE.Camera,
	canvas: HTMLCanvasElement,
): BulkTransformDelta | null {
	const anchor = start.anchorWorld;
	if (!anchor) return null;
	const planeNormal = translatePlaneNormalForDelta(start.axis, camera);
	const current = unprojectToPlane(clientX, clientY, camera, canvas, start.pivot, planeNormal);
	if (!current) return null;
	const raw = current.clone().sub(anchor);
	// Project the off-axis cursor motion onto the chosen axis so the user
	// never accidentally drifts into a different axis while dragging.
	const axisVec = axisUnitVector(start.axis);
	const along = raw.dot(axisVec);
	const projected = axisVec.clone().multiplyScalar(along);
	return {
		translate: { x: projected.x, y: projected.y, z: projected.z },
		rotate: { x: 0, y: 0, z: 0 },
		cascade: start.cascade === true,
	};
}

// Mirrors `translatePlaneNormalFor` in BulkTransformGizmo.tsx but uses no
// pivot reference — only the camera direction matters for picking between
// the two Y-axis planes. (Imported helper would have created a circular
// import; this duplicate is two lines and stays in sync trivially.)
function translatePlaneNormalForDelta(
	axis: GizmoHandleAxis,
	camera: THREE.Camera,
): THREE.Vector3 {
	if (axis === 'x' || axis === 'z') {
		return new THREE.Vector3(0, 1, 0);
	}
	const camDir = new THREE.Vector3();
	camera.getWorldDirection(camDir);
	const dotX = Math.abs(camDir.x);
	const dotZ = Math.abs(camDir.z);
	return dotX > dotZ
		? new THREE.Vector3(1, 0, 0)
		: new THREE.Vector3(0, 0, 1);
}

function axisUnitVector(axis: GizmoHandleAxis): THREE.Vector3 {
	if (axis === 'x') return new THREE.Vector3(1, 0, 0);
	if (axis === 'y') return new THREE.Vector3(0, 1, 0);
	return new THREE.Vector3(0, 0, 1);
}

// =============================================================================
// Delta math — rotate
// =============================================================================

function computeRotateDelta(
	start: NonNullable<BulkTransformDragOptions['dragStart']['current']>,
	clientX: number,
	clientY: number,
	camera: THREE.Camera,
	canvas: HTMLCanvasElement,
): BulkTransformDelta | null {
	const anchorAngle = start.anchorAngle;
	const axisWorld = start.rotationAxisWorld;
	if (anchorAngle == null || !axisWorld) return null;
	const pivotScreen = projectToScreen(start.pivot, camera, canvas);
	if (!pivotScreen) return null;

	const dx = clientX - pivotScreen.x;
	const dy = clientY - pivotScreen.y;
	const currentAngle = Math.atan2(dy, dx);
	let theta = currentAngle - anchorAngle;
	// Normalise to [-π, π] so rotating across the screen-angle wrap doesn't
	// produce a sudden 2π jump in the preview.
	while (theta > Math.PI) theta -= 2 * Math.PI;
	while (theta < -Math.PI) theta += 2 * Math.PI;

	theta *= rotationSignForCameraSide(axisWorld, camera.position, start.pivot);

	return {
		translate: { x: 0, y: 0, z: 0 },
		rotate: {
			x: start.axis === 'x' ? theta : 0,
			y: start.axis === 'y' ? theta : 0,
			z: start.axis === 'z' ? theta : 0,
		},
		cascade: start.cascade === true,
	};
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Match the rotation direction to the cursor's screen motion regardless of
 * which side of the rotation axis the camera sits on. Three.js's positive
 * rotation around `+axisWorld` maps the next-axis-in-RH-order onto the
 * following one (e.g. `+Y` rotation maps `+X → +Z`); from a camera **looking
 * down** `-axisWorld`, that motion reads as clockwise on screen and matches
 * a positive `atan2(dy, dx)` from `(dx, dy)` measured in screen pixels.
 *
 * Concretely for the typical top-down map view: camera at `(_, +y, _)`,
 * pivot at origin, `axisWorld = (0, 1, 0)`. `cam → pivot = pivot - camera`
 * has `y < 0`, so `axisWorld · camToPivot < 0` ⇒ **no flip** (sign = +1).
 * The user drags the ring right, raw θ is positive, the geometry rotates
 * clockwise on screen — direction matches.
 *
 * When the camera is on the `+axisWorld` side instead (looking *up* the
 * axis from below), screen motion mirrors, so we flip the sign. The same
 * predicate generalises to pitch (X) and roll (Z) for cameras that ever
 * orbit there — though for AI sections in this codebase, pitch and roll
 * rings are auto-disabled per ADR-0011 and only yaw is exercisable.
 *
 * Pure function so the gizmo's sign convention can be regression-tested
 * without mounting an R3F context.
 */
export function rotationSignForCameraSide(
	axisWorld: THREE.Vector3,
	cameraPosition: THREE.Vector3,
	pivot: THREE.Vector3,
): 1 | -1 {
	const camToPivot = pivot.clone().sub(cameraPosition);
	return axisWorld.dot(camToPivot) >= 0 ? -1 : 1;
}

export function identityDelta(cascade = false): BulkTransformDelta {
	return {
		translate: { x: 0, y: 0, z: 0 },
		rotate: { x: 0, y: 0, z: 0 },
		cascade,
	};
}

export function isIdentityDelta(d: BulkTransformDelta): boolean {
	// `cascade` is metadata about *how* to apply the delta, not part of the
	// spatial change itself — a cascade=true delta with zero translate/rotate
	// is still a no-op gesture (nothing to push to the undo stack).
	return (
		d.translate.x === 0 &&
		d.translate.y === 0 &&
		d.translate.z === 0 &&
		d.rotate.x === 0 &&
		d.rotate.y === 0 &&
		d.rotate.z === 0
	);
}
