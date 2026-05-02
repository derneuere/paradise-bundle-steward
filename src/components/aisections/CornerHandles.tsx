// Corner-drag handles for the selected AISection.
//
// One small clickable sphere per polygon corner. Grab one and drag — the
// component reports a live `(dx, dz)` offset relative to the pointer-down
// world position, and a final offset on release. The viewport runs the
// `translateCornerWithShared` op on that offset so coincident corners and
// boundary-line endpoints elsewhere in the model follow along.
//
// Corner storage differs across V12 (`Vector2[]` with y → world Z) and
// V4/V6 (parallel `cornersX[]` + `cornersZ[]`) — both project onto the
// shared `Corner = { x, z }` shape, which is what this component takes.
// The caller does the V12-or-legacy projection once in render so this
// component stays format-agnostic and can be wired into either overlay.
//
// Drag mechanics mirror TranslateGizmo: the active drag installs window-
// level pointermove / pointerup / keydown listeners (so the cursor can
// roam off the sphere mid-drag without the preview freezing) and disables
// OrbitControls so camera motion doesn't fight the gesture. Escape cancels
// and rolls back any preview state.
//
// Pointer-handler props on the inner `<mesh>` are passed explicitly rather
// than via `{...rest}` — the lovable-tagger Vite plugin injects `data-lov-*`
// attributes on JSX calls of any non-host component, and a rest-spread
// would forward those onto a Three.js intrinsic where R3F's applyProps
// crashes on the dashed prop names. See note in TranslateGizmo.tsx.

import React, { useRef, useState } from 'react';
import * as THREE from 'three';
import { ThreeEvent, useFrame, useThree } from '@react-three/fiber';
import { useCornerDrag } from '@/hooks/useCornerDrag';
import { unprojectToGroundPlane } from '@/lib/three/groundPlane';
import type { Corner } from '@/components/aisections/shared';

// =============================================================================
// Types
// =============================================================================

export type CornerDragOffset = { x: number; z: number };

type Props = {
	/** Polygon corners to render handles for. Pass the previewed corners
	 *  during a drag so each handle tracks the live offset. */
	corners: readonly Corner[];
	/**
	 * Approximate on-screen radius (in CSS pixels) of each corner sphere.
	 * The component rescales itself per-frame against camera distance so
	 * the handles stay this size regardless of zoom, just like the
	 * TranslateGizmo. Defaults to 8 px.
	 */
	pixelSize?: number;
	/**
	 * Resolved Y for the section the corners belong to (issue #27). Each
	 * handle sits at `baseY + 0.8` so it floats just above the section's
	 * fill mesh regardless of where the section was placed in world Y.
	 * Defaults to 0 — same as pre-#27 behaviour.
	 */
	baseY?: number;
	/** Continuous report during drag — use to update preview state. */
	onDrag: (cornerIdx: number, offset: CornerDragOffset) => void;
	/** One-shot final offset on pointer release — commit point. */
	onCommit: (cornerIdx: number, offset: CornerDragOffset) => void;
	/** Escape pressed mid-drag — consumer should drop preview state. */
	onCancel?: () => void;
};

// World-space "design radius" the sphere geometry is built at; the per-
// frame scale brings each mesh to the requested pixel size.
const DESIGN_RADIUS = 1;

// Scratch vector reused across `useFrame` calls to avoid per-frame
// allocations in the distance probe.
const scratchVec = new THREE.Vector3();

// =============================================================================
// Component
// =============================================================================

export const CornerHandles: React.FC<Props> = ({
	corners,
	pixelSize = 8,
	baseY = 0,
	onDrag,
	onCommit,
	onCancel,
}) => {
	const { camera, gl, controls } = useThree();
	const [hover, setHover] = useState<number | null>(null);
	const [active, setActive] = useState<number | null>(null);

	// Holds the drag context across the lifetime of one drag — the corner
	// being moved and the world XZ position the pointer was at on press.
	// useRef instead of useState because the window-level event listeners
	// below need to read it without retriggering effect re-mounts.
	const dragRef = useRef<{ cornerIdx: number; startWorld: { x: number; z: number } } | null>(null);

	// One mesh ref per corner for per-frame scaling. Each handle sits at a
	// different world point so we can't share a single uniform scale across
	// the whole component — the camera distance to each corner can vary
	// (e.g., the camera is closer to the right edge than the left).
	const meshRefs = useRef<(THREE.Mesh | null)[]>([]);

	useFrame(({ camera: c, size: viewport }) => {
		const cam = c as THREE.PerspectiveCamera;
		if (!cam.isPerspectiveCamera) return;
		const fovRad = (cam.fov * Math.PI) / 180;
		const tanHalfFov = Math.tan(fovRad / 2);
		// Reuse one Vector3 for the distance probe rather than allocating
		// per-corner per-frame. R3F's frame loop can churn through GC if we
		// allocate carelessly.
		const probe = scratchVec;
		for (let i = 0; i < corners.length; i++) {
			const mesh = meshRefs.current[i];
			if (!mesh) continue;
			const c2d = corners[i];
			probe.set(c2d.x, baseY + 0.8, c2d.z);
			const distance = cam.position.distanceTo(probe);
			const worldPerPixel = (2 * distance * tanHalfFov) / viewport.height;
			const targetWorldRadius = pixelSize * worldPerPixel;
			mesh.scale.setScalar(targetWorldRadius / DESIGN_RADIUS);
		}
		// Trim the ref array if the corner count shrank between frames
		// (happens when the user picks a different section).
		if (meshRefs.current.length > corners.length) {
			meshRefs.current.length = corners.length;
		}
	});

	useCornerDrag({
		active,
		camera,
		canvas: gl.domElement,
		controls: controls as unknown as { enabled: boolean } | null,
		dragRef,
		onDrag,
		onCommit,
		onCancel,
		setActive,
	});

	const beginDrag = (cornerIdx: number) => (e: ThreeEvent<PointerEvent>) => {
		e.stopPropagation();
		const native = e.nativeEvent;
		const world = unprojectToGroundPlane(
			native.clientX,
			native.clientY,
			camera,
			gl.domElement,
			0,
		);
		if (!world) return;
		dragRef.current = { cornerIdx, startWorld: { x: world.x, z: world.z } };
		setActive(cornerIdx);
		document.body.style.cursor = 'grabbing';
	};

	const overHandler = (i: number) => (e: ThreeEvent<PointerEvent>) => {
		e.stopPropagation();
		setHover(i);
		if (active === null) document.body.style.cursor = 'grab';
	};
	const outHandler = (i: number) => (e: ThreeEvent<PointerEvent>) => {
		e.stopPropagation();
		setHover((h) => (h === i ? null : h));
		if (active === null) document.body.style.cursor = 'auto';
	};

	return (
		<>
			{corners.map((c, i) => {
				const isHover = hover === i;
				const isActive = active === i;
				const color = isActive ? '#ffffff' : isHover ? '#ffd470' : '#ff8833';
				return (
					<mesh
						key={`corner-${i}`}
						ref={(el) => { meshRefs.current[i] = el; }}
						position={[c.x, baseY + 0.8, c.z]}
						onPointerDown={beginDrag(i)}
						onPointerOver={overHandler(i)}
						onPointerOut={outHandler(i)}
					>
						<sphereGeometry args={[DESIGN_RADIUS, 16, 12]} />
						<meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.25} />
					</mesh>
				);
			})}
		</>
	);
};

