// 2D translate gizmo (XZ plane) for any R3F viewport.
//
// Renders Blender-style coloured axis arrows (X red, Z blue) and a centre
// sphere for free 2-axis drag. Designed for ground-plane editors where
// world-Y is fixed: the gizmo never moves the dragged thing vertically.
//
// Usage pattern: the consumer owns the source-of-truth model and supplies
// callbacks. We report the pointer offset from drag start continuously
// via `onTranslate` (for preview rendering), then once on release via
// `onCommit` (the only point at which the consumer should mutate the
// model and push to undo history). `onCancel` fires on Escape mid-drag.
//
// While the drag is active, OrbitControls are disabled so camera
// movement doesn't compete with the gesture, and a window-level pointer
// listener tracks the cursor even when it leaves the arrow mesh.
//
// The gizmo is intentionally agnostic about what's being dragged. The
// AISection wiring lives in the viewport; this component just produces
// `{ x, z }` deltas.

import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { ThreeEvent, useFrame, useThree } from '@react-three/fiber';

// =============================================================================
// Types
// =============================================================================

type Axis = 'x' | 'z' | 'free';

export type GizmoOffset = { x: number; z: number };

export type TranslateGizmoProps = {
	/** World-space origin of the gizmo. */
	position: [number, number, number];
	/** Reported continuously during drag — use to render a live preview. */
	onTranslate: (offset: GizmoOffset) => void;
	/** Reported once on pointer release. The consumer should commit the
	 *  result to the model here (single undo entry). */
	onCommit: (offset: GizmoOffset) => void;
	/** Reported when the user presses Escape mid-drag — the consumer should
	 *  discard any preview state and resume the pre-drag value. */
	onCancel?: () => void;
	/**
	 * Approximate screen-space length (in CSS pixels) of one arrow. The gizmo
	 * rescales itself every frame against the camera distance + viewport
	 * height so it stays this size regardless of zoom — Blender / Unity-style
	 * "constant on-screen size" handles. Defaults to 90 px.
	 */
	pixelSize?: number;
};

// World-space "design size" the geometry is built at. The per-frame scale
// factor brings it to the requested pixel size on screen. Kept as a
// constant so the rebuild-on-prop-change cost stays at zero.
const DESIGN_SIZE = 30;

// =============================================================================
// Colours
// =============================================================================

const COLOR = {
	x: '#ff4040',
	xHot: '#ff9090',
	z: '#3070ff',
	zHot: '#90b0ff',
	free: '#ffd040',
	freeHot: '#ffffff',
} as const;

// =============================================================================
// Component
// =============================================================================

export const TranslateGizmo: React.FC<TranslateGizmoProps> = ({
	position,
	onTranslate,
	onCommit,
	onCancel,
	pixelSize = 90,
}) => {
	const { camera, gl, controls } = useThree();
	const [hover, setHover] = useState<Axis | null>(null);
	const [active, setActive] = useState<Axis | null>(null);
	const dragStart = useRef<{ axis: Axis; world: THREE.Vector3 } | null>(null);
	const groupRef = useRef<THREE.Group>(null);

	const planeY = position[1];

	// Per-frame scale: the gizmo group is built at DESIGN_SIZE world units;
	// each frame we read the camera's distance to the gizmo origin plus the
	// viewport height, derive the world-units-per-pixel at that distance
	// (perspective formula), and scale the group to land on the requested
	// pixel size. Result: arrows stay roughly the same screen size whether
	// the camera is up close or pulled way back, which is what stops them
	// from swallowing edges when the user zooms in to do edge ops.
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

	// Window-level listeners only mount while a drag is in flight. R3F's
	// per-mesh pointer events stop firing once the cursor leaves the arrow,
	// which would freeze the preview as soon as the user drags far enough
	// to fall off the hit cylinder. Listening on the window sidesteps that
	// while still letting us cleanly tear down on release.
	useEffect(() => {
		if (!active) return;

		// `controls` is `THREE.EventDispatcher | null` in r3f's typing, but
		// when Drei's <OrbitControls makeDefault /> is mounted (as it is in
		// every viewport in this repo) it's the live OrbitControls instance.
		const oc = controls as unknown as { enabled: boolean } | null;
		const prevEnabled = oc?.enabled ?? true;
		if (oc) oc.enabled = false;

		const handleMove = (e: PointerEvent) => {
			const drag = dragStart.current;
			if (!drag) return;
			const world = unprojectToGroundPlane(
				e.clientX,
				e.clientY,
				camera,
				gl.domElement,
				planeY,
			);
			if (!world) return;
			onTranslate(constrainToAxis(drag.axis, drag.world, world));
		};

		const handleUp = (e: PointerEvent) => {
			const drag = dragStart.current;
			if (!drag) return;
			const world = unprojectToGroundPlane(
				e.clientX,
				e.clientY,
				camera,
				gl.domElement,
				planeY,
			);
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
			// Tell the consumer to roll back any preview state.
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
			if (oc) oc.enabled = prevEnabled;
		};
	}, [active, camera, gl, controls, planeY, onTranslate, onCommit, onCancel]);

	const beginDrag = (axis: Axis) => (e: ThreeEvent<PointerEvent>) => {
		e.stopPropagation();
		const native = e.nativeEvent;
		const world = unprojectToGroundPlane(
			native.clientX,
			native.clientY,
			camera,
			gl.domElement,
			planeY,
		);
		if (!world) return;
		dragStart.current = { axis, world: world.clone() };
		setActive(axis);
		document.body.style.cursor = axis === 'free' ? 'move' : 'grabbing';
	};

	// Restore the cursor whenever the active drag releases.
	useEffect(() => {
		if (!active) document.body.style.cursor = 'auto';
	}, [active]);

	const xColor = active === 'x' || hover === 'x' ? COLOR.xHot : COLOR.x;
	const zColor = active === 'z' || hover === 'z' ? COLOR.zHot : COLOR.z;
	const fColor = active === 'free' || hover === 'free' ? COLOR.freeHot : COLOR.free;

	// We don't `{...rest}` any props onto Three.js elements here — see the
	// note on `Arrow` below for why. This component receives tagger-injected
	// `data-lov-*` props from its caller, but they never reach a `<group>`
	// because we only forward the named props above.
	return (
		<group ref={groupRef} position={position}>
			<Arrow
				axis="x"
				size={DESIGN_SIZE}
				color={xColor}
				onPointerDown={beginDrag('x')}
				onPointerOver={(e) => { e.stopPropagation(); setHover('x'); document.body.style.cursor = 'grab'; }}
				onPointerOut={(e) => { e.stopPropagation(); setHover((h) => (h === 'x' ? null : h)); if (!active) document.body.style.cursor = 'auto'; }}
			/>
			<Arrow
				axis="z"
				size={DESIGN_SIZE}
				color={zColor}
				onPointerDown={beginDrag('z')}
				onPointerOver={(e) => { e.stopPropagation(); setHover('z'); document.body.style.cursor = 'grab'; }}
				onPointerOut={(e) => { e.stopPropagation(); setHover((h) => (h === 'z' ? null : h)); if (!active) document.body.style.cursor = 'auto'; }}
			/>

			{/* Free-drag centre handle. */}
			<mesh
				onPointerDown={beginDrag('free')}
				onPointerOver={(e) => { e.stopPropagation(); setHover('free'); document.body.style.cursor = 'move'; }}
				onPointerOut={(e) => { e.stopPropagation(); setHover((h) => (h === 'free' ? null : h)); if (!active) document.body.style.cursor = 'auto'; }}
			>
				<sphereGeometry args={[DESIGN_SIZE * 0.1, 16, 12]} />
				<meshStandardMaterial color={fColor} emissive={fColor} emissiveIntensity={0.2} />
			</mesh>
		</group>
	);
};

// =============================================================================
// Arrow
// =============================================================================

type ArrowProps = {
	axis: 'x' | 'z';
	size: number;
	color: string;
	onPointerDown: (e: ThreeEvent<PointerEvent>) => void;
	onPointerOver: (e: ThreeEvent<PointerEvent>) => void;
	onPointerOut: (e: ThreeEvent<PointerEvent>) => void;
};

// Handlers are passed explicitly rather than via `{...rest}` because the
// `lovable-tagger` Vite plugin injects `data-lov-*` props on every JSX call
// to a non-host React component. A rest-spread would forward those onto a
// `<group>`, and R3F's `applyProps` interprets dashed prop names as nested
// property paths (`data-lov-id` → `target.data.lov.id`) which crashes
// when `target.data` is undefined. The skip-list covers Three.js intrinsics
// but not user components, so we have to keep tagger props from leaking
// into Three.js elements ourselves.
const Arrow: React.FC<ArrowProps> = ({
	axis,
	size,
	color,
	onPointerDown,
	onPointerOver,
	onPointerOut,
}) => {
	const isX = axis === 'x';

	// Default cylinder/cone axis is +Y. For the X arrow we tip it towards
	// world +X; for the Z arrow we tip it towards world +Z. The rotations
	// here are the canonical "lay this Y-up shape along that axis" pair.
	const rotation: [number, number, number] = isX
		? [0, 0, -Math.PI / 2]
		: [Math.PI / 2, 0, 0];

	const cylLength = size * 0.85;
	const coneLength = size * 0.15;

	const cylinderCentre: [number, number, number] = isX
		? [cylLength / 2, 0, 0]
		: [0, 0, cylLength / 2];
	const coneCentre: [number, number, number] = isX
		? [cylLength + coneLength / 2, 0, 0]
		: [0, 0, cylLength + coneLength / 2];
	const hitCentre: [number, number, number] = isX
		? [size / 2, 0, 0]
		: [0, 0, size / 2];

	const radius = size * 0.025;
	const hitRadius = size * 0.12;

	return (
		<group
			onPointerDown={onPointerDown}
			onPointerOver={onPointerOver}
			onPointerOut={onPointerOut}
		>
			{/* Visible cylinder */}
			<mesh position={cylinderCentre} rotation={rotation}>
				<cylinderGeometry args={[radius, radius, cylLength, 16]} />
				<meshBasicMaterial color={color} depthTest={false} />
			</mesh>
			{/* Visible cone tip */}
			<mesh position={coneCentre} rotation={rotation}>
				<coneGeometry args={[radius * 3.5, coneLength, 16]} />
				<meshBasicMaterial color={color} depthTest={false} />
			</mesh>
			{/* Invisible thick hit area — keeps clicks easy on a thin arrow. */}
			<mesh position={hitCentre} rotation={rotation}>
				<cylinderGeometry args={[hitRadius, hitRadius, size * 1.05, 8]} />
				<meshBasicMaterial transparent opacity={0} depthTest={false} />
			</mesh>
		</group>
	);
};

// =============================================================================
// Helpers
// =============================================================================

function unprojectToGroundPlane(
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
