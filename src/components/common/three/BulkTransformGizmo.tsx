// BulkTransformGizmo — the unified translate/rotate gizmo that owns every
// in-WorldViewport spatial manipulation gesture (per ADR-0010).
//
// Renders three Blender-style translate arrows (X red, Y green, Z blue) and
// three rotate rings (X red, Y green, Z blue) at a world-space pivot. The
// caller supplies a `TransformAxes` descriptor stating which translate axes
// and which rotate axes are interactive — disabled rings (e.g. X and Z for
// AI sections per ADR-0011) render visibly greyed-out and ignore pointer
// events so users see the affordance but can't drive it into a state the
// data model can't represent.
//
// Lifecycle (one gesture = one undo entry, per CONTEXT.md / "Bulk transform"):
//   - `onTransform(delta)` fires continuously during drag — consumer renders
//     a live preview but does NOT push to undo history.
//   - `onCommit(delta)` fires once on pointer release — consumer commits the
//     model change here, which is the *only* point at which a Workspace-undo
//     entry is pushed (one entry per gesture, not per drag-frame).
//   - `onCancel()` fires on Escape — consumer drops preview state. No commit.
//
// The translate axes drag in their corresponding screen-space planes (X &
// Z drag on the Y=pivot ground plane like the legacy 2D gizmo; Y drags on
// the X=pivot or Z=pivot plane perpendicular to Y, picking whichever is
// more camera-facing). The rotate rings drag with screen-space angle around
// the pivot — yaw is straightforward; pitch and roll use the screen-projected
// axis as the rotation axis. The math lives in `useBulkTransformDrag`.

import React, { useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { ThreeEvent } from '@react-three/fiber';
import { useFrame, useThree } from '@react-three/fiber';
import {
	type BulkTransformDelta,
	type GizmoHandleAxis,
	type GizmoHandleKind,
	useBulkTransformDrag,
} from '@/hooks/useBulkTransformDrag';
import {
	type TransformAxes,
	TRANSFORM_AXES_FULL_3D,
} from '@/lib/core/transformAxes';
import { projectToScreen, unprojectToPlane } from '@/lib/three/projection';

// =============================================================================
// Types
// =============================================================================

export type BulkTransformGizmoProps = {
	/** World-space pivot for the gizmo. The translate arrows extend from this
	 *  point; the rotate rings are centred here. */
	position: [number, number, number];

	/** Per-axis enable flags for translate and rotate. Disabled handles render
	 *  greyed-out and ignore pointer events. Defaults to full 3-axis. */
	axes?: TransformAxes;

	/** Continuous live-drag callback. Consumer renders the preview but does
	 *  NOT push undo history here. Delta accumulates from the gesture's
	 *  start; on a fresh drag it begins at the identity (translate=0, yaw=0). */
	onTransform: (delta: BulkTransformDelta) => void;

	/** Drag-released — commit the final delta to the model and push exactly
	 *  one Workspace-undo entry for the whole gesture. */
	onCommit: (delta: BulkTransformDelta) => void;

	/** Escape pressed mid-drag — consumer drops preview state without
	 *  committing. */
	onCancel?: () => void;

	/**
	 * Approximate screen-space length (in CSS pixels) of one arrow. The gizmo
	 * rescales itself every frame against camera distance + viewport height
	 * so handles stay this size regardless of zoom — mirrors the legacy
	 * TranslateGizmo's per-frame pixel-size scaling. Defaults to 90 px.
	 */
	pixelSize?: number;

	/**
	 * Pivot drag-reposition handle (issue #76). Renders a small distinct
	 * sphere at the pivot point that the user can grab to move the gizmo
	 * in world space — **without** affecting the Selection.
	 *
	 * - `onPivotMove(world)` — continuous live position during the drag.
	 *   Consumer updates the gizmo `position` (it's a controlled prop) so
	 *   the handle rides the cursor. Must NOT mutate the Selection or push
	 *   to undo history.
	 * - `onPivotCommit(world)` — fired once on pointer release. Consumer
	 *   stores the new pivot so subsequent translate/rotate gestures anchor
	 *   there. Pivot reposition is **not** a Workspace-undo step
	 *   (CONTEXT.md / "Pivot": pure UI state, no data mutation).
	 * - `onPivotCancel?(world)` — Escape pressed mid-pivot-drag. Restores
	 *   the pre-gesture pivot. Optional.
	 *
	 * The handle is only rendered when `onPivotMove` is provided — overlays
	 * that don't yet support pivot reposition keep the old "fixed pivot"
	 * behaviour with zero visual change.
	 */
	onPivotMove?: (worldPos: { x: number; y: number; z: number }) => void;
	onPivotCommit?: (worldPos: { x: number; y: number; z: number }) => void;
	onPivotCancel?: (worldPos: { x: number; y: number; z: number }) => void;
};

// World-space "design size" the geometry is built at. The per-frame scale
// factor brings it to the requested pixel size on screen.
const DESIGN_SIZE = 30;

// =============================================================================
// Colours
// =============================================================================

const COLOR = {
	x: '#ff4040',
	xHot: '#ff9090',
	y: '#40d040',
	yHot: '#90ff90',
	z: '#3070ff',
	zHot: '#90b0ff',
	disabled: '#555555',
	// **Cascade** visual cue: a magenta-ish accent that tints the handles
	// when Shift is held at gesture start. Distinct from the per-axis hues
	// so it reads as "different mode", not "different axis" (issue #75 +
	// CONTEXT.md / "Cascade").
	cascade: '#ff66cc',
	cascadeHot: '#ffaadd',
	// **Pivot** drag-reposition handle (issue #76). Neutral white-ish so it
	// reads as "axis-less" — translate arrows are coloured per-axis, the
	// pivot handle is everything-at-once. Hot tint when hovered or active.
	pivot: '#f5f5f5',
	pivotHot: '#fff7a0',
} as const;

const RING_OPACITY_ENABLED = 0.75;
const RING_OPACITY_DISABLED = 0.25;
const CASCADE_HALO_OPACITY = 0.35;

// =============================================================================
// Component
// =============================================================================

export const BulkTransformGizmo: React.FC<BulkTransformGizmoProps> = ({
	position,
	axes = TRANSFORM_AXES_FULL_3D,
	onTransform,
	onCommit,
	onCancel,
	pixelSize = 90,
	onPivotMove,
	onPivotCommit,
	onPivotCancel,
}) => {
	const { camera, gl, controls } = useThree();
	const groupRef = useRef<THREE.Group>(null);
	const [hover, setHover] = useState<{ kind: GizmoHandleKind; axis: GizmoHandleAxis } | null>(null);
	const [active, setActive] = useState<{ kind: GizmoHandleKind; axis: GizmoHandleAxis } | null>(null);
	const dragStartRef = useRef<{
		kind: GizmoHandleKind;
		axis: GizmoHandleAxis;
		pivot: THREE.Vector3;
		// Translate-specific: pointer-down world position on the drag plane.
		anchorWorld?: THREE.Vector3;
		// Rotate-specific: pointer-down screen-space angle relative to the
		// pivot's screen projection, in radians.
		anchorAngle?: number;
		// Rotate-specific: rotation axis in world space — used to invert when
		// the camera looks at it from the opposite side, so dragging right
		// always rotates clockwise from the user's perspective.
		rotationAxisWorld?: THREE.Vector3;
		// **Cascade** opt-in captured at pointer-down. See `BulkTransformDelta.cascade`
		// and CONTEXT.md / "Cascade" for the semantics: Shift held at gesture
		// start enables cascade for the lifetime of that gesture; pressing or
		// releasing Shift mid-drag does NOT switch modes.
		cascade?: boolean;
		// Pivot-drag-specific (issue #76): screen-aligned plane normal at
		// gesture start. The per-frame mover unprojects every cursor sample
		// to this plane so the handle stays on the camera-facing slab the
		// user grabbed it on — same trick as the legacy `unprojectToPlane`
		// for axis-less gizmos.
		pivotPlaneNormal?: THREE.Vector3;
	} | null>(null);
	// Tracks the cascade flag for the active gesture so the visual tint stays
	// stable across re-renders (the ref above is mutable). Pure render state.
	const [activeCascade, setActiveCascade] = useState(false);

	const pivotVec = useMemo(
		() => new THREE.Vector3(position[0], position[1], position[2]),
		[position],
	);

	// Per-frame scale: keeps the gizmo at a constant on-screen pixel size by
	// scaling the design-size group against the camera's perspective. Same
	// math the legacy TranslateGizmo uses — see that file for the derivation.
	useFrame(({ camera: c, size: viewport }) => {
		const group = groupRef.current;
		if (!group) return;
		const cam = c as THREE.PerspectiveCamera;
		if (!cam.isPerspectiveCamera) return;
		const distance = cam.position.distanceTo(group.position);
		const fovRad = (cam.fov * Math.PI) / 180;
		const worldPerPixel = (2 * distance * Math.tan(fovRad / 2)) / viewport.height;
		const targetWorldSize = pixelSize * worldPerPixel;
		group.scale.setScalar(targetWorldSize / DESIGN_SIZE);
	});

	// Wrap setActive so clearing the active gesture also clears the local
	// cascade-tint state — keeps the gizmo colour back at the no-cascade
	// default between gestures.
	const setActiveAndCascade = (a: { kind: GizmoHandleKind; axis: GizmoHandleAxis } | null) => {
		setActive(a);
		if (a === null) setActiveCascade(false);
	};

	useBulkTransformDrag({
		active,
		camera,
		canvas: gl.domElement,
		controls: controls as unknown as { enabled: boolean } | null,
		pivot: pivotVec,
		dragStart: dragStartRef,
		onTransform,
		onCommit,
		onCancel,
		setActive: setActiveAndCascade,
		onPivotMove,
		onPivotCommit,
		onPivotCancel,
	});

	// Begin a drag — capture the pointer-down world position (translate) or
	// screen-space angle (rotate) so the per-frame mover can derive a delta.
	// Also captures the cascade modifier (Shift) at gesture start; the value
	// is pinned for the lifetime of the gesture so users don't accidentally
	// flip modes by tapping Shift mid-drag (per ADR-0009 + issue #75).
	const beginTranslate = (axis: GizmoHandleAxis) => (e: ThreeEvent<PointerEvent>) => {
		if (!isAxisInteractive('translate', axis, axes)) return;
		e.stopPropagation();
		// Pointer-down world: project the pointer onto the chosen drag plane.
		const planeNormal = translatePlaneNormalFor(axis, camera, pivotVec);
		const world = unprojectToPlane(
			e.nativeEvent.clientX,
			e.nativeEvent.clientY,
			camera,
			gl.domElement,
			pivotVec,
			planeNormal,
		);
		if (!world) return;
		const cascade = e.nativeEvent.shiftKey === true;
		dragStartRef.current = {
			kind: 'translate',
			axis,
			pivot: pivotVec.clone(),
			anchorWorld: world.clone(),
			cascade,
		};
		setActiveCascade(cascade);
		setActive({ kind: 'translate', axis });
		document.body.style.cursor = 'grabbing';
	};

	// Begin a **Pivot** drag (issue #76). The handle isn't axis-locked — the
	// user drags it freely on a screen-aligned plane through the pivot. The
	// per-frame mover unprojects every cursor sample back to that plane and
	// reports the new world position as the absolute pivot — NOT a Selection-
	// affecting delta. Consumer wires `onPivotMove` / `onPivotCommit`, with
	// `onPivotCommit` storing the new pivot for subsequent gestures.
	const beginPivot = (e: ThreeEvent<PointerEvent>) => {
		// Only respond when the consumer opted in. Without `onPivotMove`
		// there's nowhere for the new pivot to land, so we silently no-op.
		if (!onPivotMove) return;
		e.stopPropagation();
		// Screen-aligned plane normal — points back at the camera so the
		// drag plane is whatever slab the user sees the handle on. Mirrors
		// Blender's "free transform" gizmo behaviour.
		const planeNormal = new THREE.Vector3();
		camera.getWorldDirection(planeNormal);
		planeNormal.multiplyScalar(-1).normalize();
		const world = unprojectToPlane(
			e.nativeEvent.clientX,
			e.nativeEvent.clientY,
			camera,
			gl.domElement,
			pivotVec,
			planeNormal,
		);
		if (!world) return;
		dragStartRef.current = {
			kind: 'pivot',
			axis: 'y',
			pivot: pivotVec.clone(),
			anchorWorld: world.clone(),
			pivotPlaneNormal: planeNormal.clone(),
		};
		setActive({ kind: 'pivot', axis: 'y' });
		document.body.style.cursor = 'grabbing';
	};

	const beginRotate = (axis: GizmoHandleAxis) => (e: ThreeEvent<PointerEvent>) => {
		if (!isAxisInteractive('rotate', axis, axes)) return;
		e.stopPropagation();
		// Screen-space angle of the pointer relative to the projected pivot.
		const pivotScreen = projectToScreen(pivotVec, camera, gl.domElement);
		if (!pivotScreen) return;
		const dx = e.nativeEvent.clientX - pivotScreen.x;
		const dy = e.nativeEvent.clientY - pivotScreen.y;
		const anchorAngle = Math.atan2(dy, dx);
		const rotationAxisWorld = rotationAxisVector(axis);
		const cascade = e.nativeEvent.shiftKey === true;
		dragStartRef.current = {
			kind: 'rotate',
			axis,
			pivot: pivotVec.clone(),
			anchorAngle,
			rotationAxisWorld,
			cascade,
		};
		setActiveCascade(cascade);
		setActive({ kind: 'rotate', axis });
		document.body.style.cursor = 'grabbing';
	};

	const isHover = (kind: GizmoHandleKind, axis: GizmoHandleAxis) =>
		hover?.kind === kind && hover.axis === axis;
	const isActiveHandle = (kind: GizmoHandleKind, axis: GizmoHandleAxis) =>
		active?.kind === kind && active.axis === axis;

	const arrowColor = (axis: GizmoHandleAxis) => {
		if (!axes.translate[axis]) return COLOR.disabled;
		const hot = isHover('translate', axis) || isActiveHandle('translate', axis);
		const base = axis === 'x' ? COLOR.x : axis === 'y' ? COLOR.y : COLOR.z;
		const hotC = axis === 'x' ? COLOR.xHot : axis === 'y' ? COLOR.yHot : COLOR.zHot;
		return hot ? hotC : base;
	};

	const ringColor = (axis: GizmoHandleAxis) => {
		if (!axes.rotate[axis]) return COLOR.disabled;
		const hot = isHover('rotate', axis) || isActiveHandle('rotate', axis);
		const base = axis === 'x' ? COLOR.x : axis === 'y' ? COLOR.y : COLOR.z;
		const hotC = axis === 'x' ? COLOR.xHot : axis === 'y' ? COLOR.yHot : COLOR.zHot;
		return hot ? hotC : base;
	};

	return (
		<group ref={groupRef} position={position}>
			{/* Cascade visual cue — a translucent magenta halo encircling the
			    gizmo when Shift was held at gesture start. Reads as "the
			    transform will drag connected outside geometry along" per
			    CONTEXT.md / "Cascade" + ADR-0009. Renders on top of the
			    gizmo's normal handles, no depth test, so it's visible from
			    any camera angle. */}
			{activeCascade && (
				<>
					<mesh rotation={[Math.PI / 2, 0, 0]}>
						<torusGeometry args={[DESIGN_SIZE * 0.95, DESIGN_SIZE * 0.025, 8, 64]} />
						<meshBasicMaterial
							color={COLOR.cascade}
							transparent
							opacity={CASCADE_HALO_OPACITY}
							depthTest={false}
						/>
					</mesh>
					<mesh>
						<sphereGeometry args={[DESIGN_SIZE * 0.06, 12, 12]} />
						<meshBasicMaterial
							color={COLOR.cascade}
							transparent
							opacity={CASCADE_HALO_OPACITY * 1.5}
							depthTest={false}
						/>
					</mesh>
				</>
			)}

			{/* Translate arrows */}
			<TranslateArrow
				axis="x"
				color={arrowColor('x')}
				enabled={axes.translate.x}
				onPointerDown={beginTranslate('x')}
				onPointerOver={() => setHover({ kind: 'translate', axis: 'x' })}
				onPointerOut={() => setHover((h) => (h?.kind === 'translate' && h.axis === 'x' ? null : h))}
			/>
			<TranslateArrow
				axis="y"
				color={arrowColor('y')}
				enabled={axes.translate.y}
				onPointerDown={beginTranslate('y')}
				onPointerOver={() => setHover({ kind: 'translate', axis: 'y' })}
				onPointerOut={() => setHover((h) => (h?.kind === 'translate' && h.axis === 'y' ? null : h))}
			/>
			<TranslateArrow
				axis="z"
				color={arrowColor('z')}
				enabled={axes.translate.z}
				onPointerDown={beginTranslate('z')}
				onPointerOver={() => setHover({ kind: 'translate', axis: 'z' })}
				onPointerOut={() => setHover((h) => (h?.kind === 'translate' && h.axis === 'z' ? null : h))}
			/>

			{/* Rotate rings */}
			<RotateRing
				axis="x"
				color={ringColor('x')}
				enabled={axes.rotate.x}
				onPointerDown={beginRotate('x')}
				onPointerOver={() => setHover({ kind: 'rotate', axis: 'x' })}
				onPointerOut={() => setHover((h) => (h?.kind === 'rotate' && h.axis === 'x' ? null : h))}
			/>
			<RotateRing
				axis="y"
				color={ringColor('y')}
				enabled={axes.rotate.y}
				onPointerDown={beginRotate('y')}
				onPointerOver={() => setHover({ kind: 'rotate', axis: 'y' })}
				onPointerOut={() => setHover((h) => (h?.kind === 'rotate' && h.axis === 'y' ? null : h))}
			/>
			<RotateRing
				axis="z"
				color={ringColor('z')}
				enabled={axes.rotate.z}
				onPointerDown={beginRotate('z')}
				onPointerOver={() => setHover({ kind: 'rotate', axis: 'z' })}
				onPointerOut={() => setHover((h) => (h?.kind === 'rotate' && h.axis === 'z' ? null : h))}
			/>

			{/* **Pivot** drag-reposition handle (issue #76).
			    Only rendered when the consumer wires `onPivotMove` — overlays
			    that don't yet support pivot reposition keep the old "fixed
			    pivot" behaviour. The handle sits dead-centre at the gizmo's
			    origin, visually distinct from the per-axis translate arrows
			    (neutral white sphere with a yellow hot tint vs. the per-axis
			    red/green/blue), and is rendered after the rotate rings so it
			    paints on top of the central hub. Per CONTEXT.md / "Pivot":
			    dragging this handle moves the gizmo only — the Selection is
			    untouched and no Workspace-undo entry is pushed. */}
			{onPivotMove && (
				<PivotHandle
					color={
						isHover('pivot', 'y') || isActiveHandle('pivot', 'y')
							? COLOR.pivotHot
							: COLOR.pivot
					}
					onPointerDown={beginPivot}
					onPointerOver={() => setHover({ kind: 'pivot', axis: 'y' })}
					onPointerOut={() => setHover((h) => (h?.kind === 'pivot' ? null : h))}
				/>
			)}
		</group>
	);
};

// =============================================================================
// Sub-components — Arrow, Ring
// =============================================================================
//
// Handlers are passed explicitly rather than via `{...rest}` because the
// `lovable-tagger` Vite plugin injects `data-lov-*` props on every JSX call
// to a non-host React component. A rest-spread would forward those onto a
// `<group>`, and R3F's `applyProps` interprets dashed prop names as nested
// property paths (`data-lov-id` → `target.data.lov.id`) which crashes when
// `target.data` is undefined. Same caveat as TranslateGizmo's Arrow.

type HandlerProps = {
	axis: GizmoHandleAxis;
	color: string;
	enabled: boolean;
	onPointerDown: (e: ThreeEvent<PointerEvent>) => void;
	onPointerOver: () => void;
	onPointerOut: () => void;
};

const TranslateArrow: React.FC<HandlerProps> = ({ axis, color, enabled, onPointerDown, onPointerOver, onPointerOut }) => {
	const size = DESIGN_SIZE;
	// Default cylinder/cone axis is +Y. For X we tip towards +X; for Z we
	// tip towards +Z. The Y arrow uses the default orientation.
	const rotation: [number, number, number] =
		axis === 'x' ? [0, 0, -Math.PI / 2]
			: axis === 'z' ? [Math.PI / 2, 0, 0]
				: [0, 0, 0];

	const cylLength = size * 0.85;
	const coneLength = size * 0.15;

	const along = (t: number): [number, number, number] => {
		if (axis === 'x') return [t, 0, 0];
		if (axis === 'y') return [0, t, 0];
		return [0, 0, t];
	};
	const cylinderCentre = along(cylLength / 2);
	const coneCentre = along(cylLength + coneLength / 2);
	const hitCentre = along(size / 2);

	const radius = size * 0.025;
	const hitRadius = size * 0.12;

	const handleOver = (e: ThreeEvent<PointerEvent>) => {
		if (!enabled) return;
		e.stopPropagation();
		onPointerOver();
		document.body.style.cursor = 'grab';
	};
	const handleOut = (e: ThreeEvent<PointerEvent>) => {
		e.stopPropagation();
		onPointerOut();
		document.body.style.cursor = 'auto';
	};
	const handleDown = (e: ThreeEvent<PointerEvent>) => {
		if (!enabled) return;
		onPointerDown(e);
	};

	return (
		<group
			onPointerDown={handleDown}
			onPointerOver={handleOver}
			onPointerOut={handleOut}
		>
			<mesh position={cylinderCentre} rotation={rotation}>
				<cylinderGeometry args={[radius, radius, cylLength, 16]} />
				<meshBasicMaterial color={color} depthTest={false} transparent opacity={enabled ? 1 : 0.4} />
			</mesh>
			<mesh position={coneCentre} rotation={rotation}>
				<coneGeometry args={[radius * 3.5, coneLength, 16]} />
				<meshBasicMaterial color={color} depthTest={false} transparent opacity={enabled ? 1 : 0.4} />
			</mesh>
			{/* Invisible thicker hit volume — only present on enabled axes so
			    disabled handles are visually present but unclickable. */}
			{enabled && (
				<mesh position={hitCentre} rotation={rotation}>
					<cylinderGeometry args={[hitRadius, hitRadius, size * 1.05, 8]} />
					<meshBasicMaterial transparent opacity={0} depthTest={false} />
				</mesh>
			)}
		</group>
	);
};

const RotateRing: React.FC<HandlerProps> = ({ axis, color, enabled, onPointerDown, onPointerOver, onPointerOut }) => {
	const radius = DESIGN_SIZE * 0.7;
	const tubeRadius = DESIGN_SIZE * 0.012;
	const hitTube = DESIGN_SIZE * 0.05;

	// TorusGeometry's tube lives in the XY plane, normal +Z. Rotate so the
	// tube ends up perpendicular to the labelled axis:
	//   - X axis ring: normal is +X → rotate the +Z-normal torus around +Y by 90°.
	//   - Y axis ring: normal is +Y → rotate around +X by 90°.
	//   - Z axis ring: normal is +Z → no rotation.
	const rotation: [number, number, number] =
		axis === 'x' ? [0, Math.PI / 2, 0]
			: axis === 'y' ? [Math.PI / 2, 0, 0]
				: [0, 0, 0];

	const handleOver = (e: ThreeEvent<PointerEvent>) => {
		if (!enabled) return;
		e.stopPropagation();
		onPointerOver();
		document.body.style.cursor = 'grab';
	};
	const handleOut = (e: ThreeEvent<PointerEvent>) => {
		e.stopPropagation();
		onPointerOut();
		document.body.style.cursor = 'auto';
	};
	const handleDown = (e: ThreeEvent<PointerEvent>) => {
		if (!enabled) return;
		onPointerDown(e);
	};

	return (
		<group
			onPointerDown={handleDown}
			onPointerOver={handleOver}
			onPointerOut={handleOut}
			rotation={rotation}
		>
			{/* Visible thin torus */}
			<mesh>
				<torusGeometry args={[radius, tubeRadius, 8, 64]} />
				<meshBasicMaterial
					color={color}
					transparent
					opacity={enabled ? RING_OPACITY_ENABLED : RING_OPACITY_DISABLED}
					depthTest={false}
				/>
			</mesh>
			{/* Invisible thicker hit torus — only present on enabled axes
			    so disabled rings are visually present but unclickable. */}
			{enabled && (
				<mesh>
					<torusGeometry args={[radius, hitTube, 6, 32]} />
					<meshBasicMaterial transparent opacity={0} depthTest={false} />
				</mesh>
			)}
		</group>
	);
};

// =============================================================================
// Pivot handle (issue #76)
// =============================================================================

type PivotHandleProps = {
	color: string;
	onPointerDown: (e: ThreeEvent<PointerEvent>) => void;
	onPointerOver: () => void;
	onPointerOut: () => void;
};

// Small distinct sphere at the gizmo's origin. Visually it reads as a
// "handle" (slightly bigger than the cascade halo's centre dot, with a
// dark outline so it pops against any underlying scene) without competing
// with the per-axis translate arrows for screen real estate.
//
// Hit volume is a larger invisible sphere — same trick the corner pickers
// in AISectionsOverlay use — so picking remains forgiving at far camera
// distances.
const PivotHandle: React.FC<PivotHandleProps> = ({ color, onPointerDown, onPointerOver, onPointerOut }) => {
	const radius = DESIGN_SIZE * 0.08;
	const hitRadius = DESIGN_SIZE * 0.16;
	const outlineRadius = DESIGN_SIZE * 0.095;

	const handleOver = (e: ThreeEvent<PointerEvent>) => {
		e.stopPropagation();
		onPointerOver();
		document.body.style.cursor = 'grab';
	};
	const handleOut = (e: ThreeEvent<PointerEvent>) => {
		e.stopPropagation();
		onPointerOut();
		document.body.style.cursor = 'auto';
	};

	return (
		<group onPointerDown={onPointerDown} onPointerOver={handleOver} onPointerOut={handleOut}>
			{/* Dark outline ring — gives the handle a clear silhouette against
			    pale scene backgrounds. Slightly larger than the fill sphere
			    so it shows through as a thin border. */}
			<mesh>
				<sphereGeometry args={[outlineRadius, 16, 12]} />
				<meshBasicMaterial color="#1a1a1a" transparent opacity={0.85} depthTest={false} />
			</mesh>
			{/* Fill sphere */}
			<mesh>
				<sphereGeometry args={[radius, 16, 12]} />
				<meshBasicMaterial color={color} depthTest={false} />
			</mesh>
			{/* Invisible larger hit volume */}
			<mesh>
				<sphereGeometry args={[hitRadius, 12, 10]} />
				<meshBasicMaterial transparent opacity={0} depthTest={false} />
			</mesh>
		</group>
	);
};

// =============================================================================
// Internal helpers
// =============================================================================

function isAxisInteractive(
	kind: GizmoHandleKind,
	axis: GizmoHandleAxis,
	axes: TransformAxes,
): boolean {
	return kind === 'translate' ? axes.translate[axis] : axes.rotate[axis];
}

/**
 * Pick a drag-plane normal for a translate axis. The plane must contain the
 * dragged axis and be reasonably perpendicular to the camera so the
 * pointer's world-space projection is well-defined.
 *
 *   - X axis: drag on the Y=pivot ground plane (normal +Y) when the camera
 *     looks down at the scene; this matches the legacy 2D gizmo's behaviour.
 *   - Z axis: same — drag on the ground plane.
 *   - Y axis: pick the plane whose normal is more camera-facing — either
 *     +X (the YZ plane) or +Z (the YX plane). This avoids the degenerate
 *     "looking along the plane normal" case.
 */
function translatePlaneNormalFor(
	axis: GizmoHandleAxis,
	camera: THREE.Camera,
	pivot: THREE.Vector3,
): THREE.Vector3 {
	if (axis === 'x' || axis === 'z') {
		return new THREE.Vector3(0, 1, 0);
	}
	// Y: choose plane normal between +X and +Z based on camera angle.
	const camDir = new THREE.Vector3();
	camera.getWorldDirection(camDir);
	const dotX = Math.abs(camDir.x);
	const dotZ = Math.abs(camDir.z);
	return dotX > dotZ
		? new THREE.Vector3(1, 0, 0)
		: new THREE.Vector3(0, 0, 1);
}

/**
 * The world-space rotation axis for a rotate ring. Pure helper so the drag
 * hook can apply the screen-space angle delta around a single fixed axis.
 */
function rotationAxisVector(axis: GizmoHandleAxis): THREE.Vector3 {
	if (axis === 'x') return new THREE.Vector3(1, 0, 0);
	if (axis === 'y') return new THREE.Vector3(0, 1, 0);
	return new THREE.Vector3(0, 0, 1);
}

// `projectToScreen` and `unprojectToPlane` live in `@/lib/three/projection` —
// the drag hook imports them from there as well, sidestepping a circular
// import via this component module.
