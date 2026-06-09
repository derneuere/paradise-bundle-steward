// PropInstanceDataOverlay — WorldViewport overlay for prop instances.
//
// Renders every prop as a real-size box placed by its full world transform —
// the same approach TrafficData uses for static vehicles (AllStaticVehicleInstances
// in src/components/trafficdata/TrafficDataViewport.tsx). One InstancedMesh draws
// the whole zone; each box is positioned/oriented by the instance's Matrix44Affine
// and tinted by prop type. Click picks an instance; the selected one is painted the
// selection colour, gets a depth-test-off edge outline, and an Html label.
//
// Why the static-vehicle approach (vs a fixed-screen-size marker): props sit on the
// track surface at real scale, so a box driven by the instance's transform shows the
// prop's true footprint and facing direction and lands exactly where the prop is —
// which reads correctly once the track geometry renders beneath it. Consistency with
// static vehicles also means the same matrix-decode caveat applies (see below).
//
// Selection currency is the schema NodePath (ADR-0001): the overlay matches
// `['instances', i, ...]` for highlight and emits `['instances', i]` on click.

import { useCallback, useMemo, useRef } from 'react';
import { Html } from '@react-three/drei';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { ParsedPropInstanceData, PropInstance } from '@/lib/core/propInstanceData';
import { propTypeLabel } from '@/lib/core/propTypes';
import { useUpdateInstancedMesh } from '@/lib/three/scene/useUpdateInstancedMesh';
import { useFlyCameraToTarget } from '@/lib/three/scene/useFlyCameraToTarget';
import type { NodePath } from '@/lib/schema/walk';
import type { WorldOverlayComponent } from './WorldViewport.types';
import { defineSelectionCodec, SELECTION_THEME, isDragRelease, type Selection } from './selection';

const KIND = 'propInstance';

// ---------------------------------------------------------------------------
// Path ↔ Selection codec (exported for tests)
// ---------------------------------------------------------------------------

/** Sub-paths inside an instance (e.g. `['instances', i, 'mWorldTransform']`)
 *  collapse to "this instance is selected". */
export const propInstanceSelectionCodec = defineSelectionCodec({
	pathToSelection: (path: NodePath): Selection | null => {
		if (path.length < 2 || path[0] !== 'instances') return null;
		const idx = path[1];
		if (typeof idx !== 'number') return null;
		return { kind: KIND, indices: [idx] };
	},
	selectionToPath: (sel: Selection): NodePath =>
		sel.kind === KIND ? ['instances', sel.indices[0]] : [],
});

// ---------------------------------------------------------------------------
// Pure helpers (exported for tests)
// ---------------------------------------------------------------------------

/** World position of a prop — the translation row of its affine transform. */
export function propInstancePosition(inst: PropInstance): [number, number, number] {
	const t = inst.mWorldTransform;
	return [t[12] ?? 0, t[13] ?? 0, t[14] ?? 0];
}

/** Stable per-type tint so adjacent prop types are easy to tell apart. The
 *  golden-ratio hue step spreads neighbouring indices far apart on the wheel. */
export function propTypeColor(typeId: number): THREE.Color {
	const hue = ((typeId * 0.61803398875) % 1 + 1) % 1;
	return new THREE.Color().setHSL(hue, 0.7, 0.55);
}

/**
 * Load a prop's Matrix44Affine into a THREE.Matrix4. The on-disk layout is
 * four rows of (Vec3 + 4-byte pad) with translation at floats [12..14] — that
 * is column-major from THREE's perspective, so `fromArray` maps it directly.
 * The pad slots ([3],[7],[11],[15]) are zero on disk, which would leave a
 * degenerate w on the homogeneous multiply, so patch the bottom row to
 * [0,0,0,1]. Same handling as TrafficData's static vehicles. Exported for tests.
 */
export function propInstanceMatrix(inst: PropInstance, out: THREE.Matrix4): THREE.Matrix4 {
	out.fromArray(inst.mWorldTransform);
	const e = out.elements;
	e[3] = 0; e[7] = 0; e[11] = 0; e[15] = 1;
	return out;
}

// ---------------------------------------------------------------------------
// Shared GPU state — one geometry/material for every overlay instance.
// ---------------------------------------------------------------------------

// A modest upright box: most props are signs / posts a few metres tall, and a
// box driven by the instance matrix shows each prop's facing direction. Exported
// so the prop-mesh layer (<PropGeometry>) can reuse the exact same marker for
// the props whose Model didn't resolve — the box is the fallback for those.
export const MARKER_GEO = new THREE.BoxGeometry(3, 4, 1.2);
// White base so per-instance setColorAt tints cleanly; Standard so the boxes
// catch the WorldViewport lighting and read as solid 3D objects on the track.
export const MARKER_MAT = new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.05 });

// Selected-prop edge outline — depth-test off so it shows even when the box is
// coincident with the road surface.
const MARKER_EDGES_GEO = new THREE.EdgesGeometry(MARKER_GEO);
const MARKER_EDGES_MAT = new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true });

const SELECTED_COLOR = '#' + SELECTION_THEME.primary.getHexString();

// ---------------------------------------------------------------------------
// Selected-instance outline + label
// ---------------------------------------------------------------------------

export function SelectedPropDecor({
	inst,
	index,
	outline,
}: {
	inst: PropInstance;
	index: number;
	// Edges geometry to draw around the prop, in the prop's LOCAL frame (the
	// instance transform is applied here). When a prop renders as a real mesh,
	// PropGeometry passes the mesh's bounding-box edges so the outline matches the
	// actual shape; omitted (the marker box) for the box-fallback / no-mesh case.
	outline?: THREE.BufferGeometry;
}) {
	const matrix = useMemo(() => propInstanceMatrix(inst, new THREE.Matrix4()), [inst]);
	const [x, y, z] = propInstancePosition(inst);
	return (
		<>
			<lineSegments geometry={outline ?? MARKER_EDGES_GEO} material={MARKER_EDGES_MAT} matrixAutoUpdate={false} matrix={matrix} />
			{/* No distanceFactor: keep the label a constant screen size. With
			    distanceFactor it scales by factor/cameraDistance, so flying the
			    camera in close (FocusOnProp lands ~60 units away) ballooned it. */}
			<Html position={[x, y, z]} center style={{ pointerEvents: 'none' }}>
				<div style={{
					background: 'rgba(0,0,0,0.8)', color: SELECTED_COLOR, padding: '2px 6px',
					borderRadius: 4, fontSize: 10, whiteSpace: 'nowrap', fontFamily: 'monospace',
					transform: 'translateY(-22px)',
				}}>
					#{index} {propTypeLabel(inst.typeId)} | id {inst.muInstanceID}
				</div>
			</Html>
		</>
	);
}

// ---------------------------------------------------------------------------
// Camera auto-fit
// ---------------------------------------------------------------------------

// Props render at real scale but cluster into a tiny knot at the fixed
// whole-map camera, so a freshly-selected prop is effectively invisible until
// you hunt for it. When the selection lands on an instance, fly the camera over
// so the highlighted box is on-screen — same trick TrafficData's static
// vehicles use (FocusOnVehicle). Only reacts to instance selections so browsing
// other parts of the schema doesn't yank the camera.
export function FocusOnProp({ data, selectedPath }: { data: ParsedPropInstanceData; selectedPath: NodePath }) {
	const { camera, controls } = useThree() as { camera: THREE.Camera; controls: { target: THREE.Vector3; update: () => void } | null };
	const instances = data?.instances ?? [];
	const target = useMemo<THREE.Vector3 | null>(() => {
		if (selectedPath.length < 2 || selectedPath[0] !== 'instances') return null;
		const i = selectedPath[1];
		if (typeof i !== 'number' || i >= instances.length) return null;
		const t = instances[i].mWorldTransform;
		return new THREE.Vector3(t[12], t[13], t[14]);
	}, [instances, selectedPath]);
	useFlyCameraToTarget(camera, controls, target, 60);
	return null;
}

// ---------------------------------------------------------------------------
// Overlay
// ---------------------------------------------------------------------------

type Props = {
	data: ParsedPropInstanceData;
	selectedPath: NodePath;
	onSelect: (path: NodePath) => void;
};

export const PropInstanceDataOverlay: WorldOverlayComponent<ParsedPropInstanceData> = ({
	data, selectedPath, onSelect,
}: Props) => {
	const instances = data?.instances ?? [];
	const count = instances.length;
	const meshRef = useRef<THREE.InstancedMesh>(null!);

	const selIdx = useMemo(() => {
		const sel = propInstanceSelectionCodec.pathToSelection(selectedPath);
		return sel && sel.indices[0] < count ? sel.indices[0] : -1;
	}, [selectedPath, count]);

	// Place + paint every box from its world transform. An effect (not a memo)
	// because the mesh ref is null during render — useUpdateInstancedMesh runs
	// the writes after commit. Re-runs when the data or selection changes.
	useUpdateInstancedMesh(
		meshRef,
		count,
		(mesh) => {
			const mat = new THREE.Matrix4();
			for (let i = 0; i < count; i++) {
				propInstanceMatrix(instances[i], mat);
				mesh.setMatrixAt(i, mat);
				const color = i === selIdx ? SELECTION_THEME.primary : propTypeColor(instances[i].typeId);
				mesh.setColorAt(i, color);
			}
			if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
		},
		[instances, count, selIdx],
	);

	const onClick = useCallback((e: ThreeEvent<MouseEvent>) => {
		e.stopPropagation();
		// Don't select when the click ends a camera orbit (R3F fires onClick on
		// the object under the press even after a drag) — see dragGuard.
		if (isDragRelease(e.nativeEvent.clientX, e.nativeEvent.clientY)) return;
		if (e.instanceId == null) return;
		onSelect(propInstanceSelectionCodec.selectionToPath({ kind: KIND, indices: [e.instanceId] }));
	}, [onSelect]);

	if (count === 0) return null;

	const selInst = selIdx >= 0 ? instances[selIdx] : null;

	return (
		<>
			<FocusOnProp data={data} selectedPath={selectedPath} />
			<instancedMesh
				ref={meshRef}
				args={[MARKER_GEO, MARKER_MAT, count]}
				onClick={onClick}
			/>
			{selInst && <SelectedPropDecor inst={selInst} index={selIdx} />}
		</>
	);
};
