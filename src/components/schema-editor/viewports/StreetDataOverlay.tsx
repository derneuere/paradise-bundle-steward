// StreetDataOverlay — WorldViewport overlay for the StreetData resource.
//
// Renders roads as spheres, streets as speed-coloured cubes, and junctions
// as octahedrons — all batched through InstancedMesh so the per-type cost
// stays at one draw call regardless of count. Selection currency is the
// schema NodePath (ADR-0001): the overlay matches `['roads', i]`,
// `['streets', i]`, `['junctions', i]` directly.
//
// `onChange` is forwarded for in-scene edits but the StreetData scene has
// no drag handles today (the source viewport never invoked it either). The
// prop is preserved so future drag-to-move work plugs in without a contract
// change.
//
// The grid stays here rather than in the WorldViewport chrome — AI sections
// and ZoneList both deliberately omit it (z-fights with their dense polys),
// so it's a StreetData-specific decoration, not chrome default.

import { useMemo, useRef, useState, useCallback } from 'react';
import { ThreeEvent } from '@react-three/fiber';
import { Grid, Html } from '@react-three/drei';
import * as THREE from 'three';
import { useUpdateInstancedMesh } from '@/hooks/useUpdateInstancedMesh';
import type { ParsedStreetData } from '@/lib/core/streetData';
import type { NodePath } from '@/lib/schema/walk';
import type { WorldOverlayComponent } from './WorldViewport.types';

// ---------------------------------------------------------------------------
// Path → marker helpers (exported for tests)
// ---------------------------------------------------------------------------

export type StreetMarkerKind = 'street' | 'junction' | 'road';
export type StreetMarker = { kind: StreetMarkerKind; index: number } | null;

/**
 * Decode a schema path into the StreetData marker it points at, or null if
 * the path doesn't address a top-level street/junction/road. Sub-paths
 * collapse to "this marker is selected".
 */
export function streetPathMarker(path: NodePath): StreetMarker {
	if (path.length < 2) return null;
	const head = path[0];
	const idx = path[1];
	if (typeof idx !== 'number') return null;
	if (head === 'streets') return { kind: 'street', index: idx };
	if (head === 'junctions') return { kind: 'junction', index: idx };
	if (head === 'roads') return { kind: 'road', index: idx };
	return null;
}

/** Build the schema path for a marker. Inverse of `streetPathMarker`. */
export function streetMarkerPath(marker: StreetMarker): NodePath {
	if (!marker) return [];
	switch (marker.kind) {
		case 'street': return ['streets', marker.index];
		case 'junction': return ['junctions', marker.index];
		case 'road': return ['roads', marker.index];
	}
}

// ---------------------------------------------------------------------------
// Constants — shared geometries / materials kept module-scope so all overlay
// instances reuse the same GPU buffers.
// ---------------------------------------------------------------------------

// Marker sizes — sized to be legible from the WorldViewport chrome's fixed
// camera at ~15000 units up (roughly 10× the original tight-AutoFit values).
// Burnout-world spans ~10000 units across, so markers in the 50-80 range
// read clearly without crowding.
const ROAD_RADIUS = 80;
const STREET_SIZE = 50;
const JUNCTION_RADIUS = 60;

const roadGeo = new THREE.SphereGeometry(ROAD_RADIUS, 16, 12);
const streetGeo = new THREE.BoxGeometry(STREET_SIZE, STREET_SIZE, STREET_SIZE);
const junctionGeo = new THREE.OctahedronGeometry(JUNCTION_RADIUS);

const roadMat = new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.2 });
const streetMat = new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.15 });
const junctionMat = new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.2 });

const SEL_COLOR = new THREE.Color(0xffaa33);
const HOV_COLOR = new THREE.Color(0x66aaff);
const ROAD_COLOR = new THREE.Color(0x4488ff);
const JUNCTION_COLOR = new THREE.Color(0xeecc33);

/** Green→Red lerp based on speed 0-255 */
function speedColor(maxSpeed: number): THREE.Color {
	const t = Math.min(maxSpeed / 255, 1);
	return new THREE.Color().setRGB(t, 1 - t, 0.15);
}

// ---------------------------------------------------------------------------
// Scene bounds — kept overlay-local so the grid sizes itself sensibly. The
// chrome's camera is fixed (ADR-0003); this is purely for the grid extent.
// ---------------------------------------------------------------------------

function computeBounds(data: ParsedStreetData): { center: THREE.Vector3; radius: number } {
	if (data.roads.length === 0) return { center: new THREE.Vector3(), radius: 50 };
	const box = new THREE.Box3();
	for (const r of data.roads) {
		box.expandByPoint(new THREE.Vector3(r.mReferencePosition.x, r.mReferencePosition.y, r.mReferencePosition.z));
	}
	const sphere = new THREE.Sphere();
	box.getBoundingSphere(sphere);
	return { center: sphere.center, radius: Math.max(sphere.radius, 20) };
}

// ---------------------------------------------------------------------------
// Instanced markers
// ---------------------------------------------------------------------------

const _dummy = new THREE.Object3D();

type HoverState = StreetMarker;

function RoadInstances({
	data, selected, hovered, onPick, onHover,
}: {
	data: ParsedStreetData;
	selected: StreetMarker;
	hovered: HoverState;
	onPick: (marker: StreetMarker) => void;
	onHover: (s: HoverState) => void;
}) {
	const meshRef = useRef<THREE.InstancedMesh>(null!);
	const count = data.roads.length;

	useUpdateInstancedMesh(
		meshRef,
		count,
		(mesh) => {
			for (let i = 0; i < count; i++) {
				const r = data.roads[i];
				_dummy.position.set(r.mReferencePosition.x, r.mReferencePosition.y, r.mReferencePosition.z);
				_dummy.updateMatrix();
				mesh.setMatrixAt(i, _dummy.matrix);

				const isSel = selected?.kind === 'road' && selected.index === i;
				const isHov = hovered?.kind === 'road' && hovered.index === i;
				mesh.setColorAt(i, isSel ? SEL_COLOR : isHov ? HOV_COLOR : ROAD_COLOR);
			}
		},
		[data.roads, count, selected, hovered],
	);

	const handleClick = useCallback((e: ThreeEvent<MouseEvent>) => {
		e.stopPropagation();
		if (e.instanceId != null) onPick({ kind: 'road', index: e.instanceId });
	}, [onPick]);

	const handlePointerMove = useCallback((e: ThreeEvent<PointerEvent>) => {
		e.stopPropagation();
		if (e.instanceId != null) {
			onHover({ kind: 'road', index: e.instanceId });
			document.body.style.cursor = 'pointer';
		}
	}, [onHover]);

	const handlePointerOut = useCallback(() => {
		onHover(null);
		document.body.style.cursor = 'auto';
	}, [onHover]);

	if (count === 0) return null;

	return (
		<instancedMesh
			ref={meshRef}
			args={[roadGeo, roadMat, count]}
			onClick={handleClick}
			onPointerMove={handlePointerMove}
			onPointerOut={handlePointerOut}
		/>
	);
}

function StreetInstances({
	data, selected, hovered, onPick, onHover,
}: {
	data: ParsedStreetData;
	selected: StreetMarker;
	hovered: HoverState;
	onPick: (marker: StreetMarker) => void;
	onHover: (s: HoverState) => void;
}) {
	const meshRef = useRef<THREE.InstancedMesh>(null!);
	const count = data.streets.length;

	useUpdateInstancedMesh(
		meshRef,
		count,
		(mesh) => {
			for (let i = 0; i < count; i++) {
				const street = data.streets[i];
				const road = data.roads[street.superSpanBase.miRoadIndex];
				if (road) {
					_dummy.position.set(
						road.mReferencePosition.x + ROAD_RADIUS + STREET_SIZE * 0.8,
						road.mReferencePosition.y + (i % 3) * STREET_SIZE * 1.2,
						road.mReferencePosition.z,
					);
				} else {
					_dummy.position.set(0, -9999, 0); // hide invalid
				}
				_dummy.updateMatrix();
				mesh.setMatrixAt(i, _dummy.matrix);

				const isSel = selected?.kind === 'street' && selected.index === i;
				const isHov = hovered?.kind === 'street' && hovered.index === i;
				mesh.setColorAt(i, isSel ? SEL_COLOR : isHov ? HOV_COLOR : speedColor(street.mAiInfo.muMaxSpeedMPS));
			}
		},
		[data.streets, data.roads, count, selected, hovered],
	);

	const handleClick = useCallback((e: ThreeEvent<MouseEvent>) => {
		e.stopPropagation();
		if (e.instanceId != null) onPick({ kind: 'street', index: e.instanceId });
	}, [onPick]);

	const handlePointerMove = useCallback((e: ThreeEvent<PointerEvent>) => {
		e.stopPropagation();
		if (e.instanceId != null) {
			onHover({ kind: 'street', index: e.instanceId });
			document.body.style.cursor = 'pointer';
		}
	}, [onHover]);

	const handlePointerOut = useCallback(() => {
		onHover(null);
		document.body.style.cursor = 'auto';
	}, [onHover]);

	if (count === 0) return null;

	return (
		<instancedMesh
			ref={meshRef}
			args={[streetGeo, streetMat, count]}
			onClick={handleClick}
			onPointerMove={handlePointerMove}
			onPointerOut={handlePointerOut}
		/>
	);
}

function JunctionInstances({
	data, selected, hovered, onPick, onHover,
}: {
	data: ParsedStreetData;
	selected: StreetMarker;
	hovered: HoverState;
	onPick: (marker: StreetMarker) => void;
	onHover: (s: HoverState) => void;
}) {
	const meshRef = useRef<THREE.InstancedMesh>(null!);
	const count = data.junctions.length;

	useUpdateInstancedMesh(
		meshRef,
		count,
		(mesh) => {
			for (let i = 0; i < count; i++) {
				const junc = data.junctions[i];
				const road = data.roads[junc.superSpanBase.miRoadIndex];
				if (road) {
					_dummy.position.set(
						road.mReferencePosition.x - ROAD_RADIUS - JUNCTION_RADIUS * 0.8,
						road.mReferencePosition.y,
						road.mReferencePosition.z + (i % 3) * JUNCTION_RADIUS * 1.5,
					);
				} else {
					_dummy.position.set(0, -9999, 0);
				}
				_dummy.updateMatrix();
				mesh.setMatrixAt(i, _dummy.matrix);

				const isSel = selected?.kind === 'junction' && selected.index === i;
				const isHov = hovered?.kind === 'junction' && hovered.index === i;
				mesh.setColorAt(i, isSel ? SEL_COLOR : isHov ? HOV_COLOR : JUNCTION_COLOR);
			}
		},
		[data.junctions, data.roads, count, selected, hovered],
	);

	const handleClick = useCallback((e: ThreeEvent<MouseEvent>) => {
		e.stopPropagation();
		if (e.instanceId != null) onPick({ kind: 'junction', index: e.instanceId });
	}, [onPick]);

	const handlePointerMove = useCallback((e: ThreeEvent<PointerEvent>) => {
		e.stopPropagation();
		if (e.instanceId != null) {
			onHover({ kind: 'junction', index: e.instanceId });
			document.body.style.cursor = 'pointer';
		}
	}, [onHover]);

	const handlePointerOut = useCallback(() => {
		onHover(null);
		document.body.style.cursor = 'auto';
	}, [onHover]);

	if (count === 0) return null;

	return (
		<instancedMesh
			ref={meshRef}
			args={[junctionGeo, junctionMat, count]}
			onClick={handleClick}
			onPointerMove={handlePointerMove}
			onPointerOut={handlePointerOut}
		/>
	);
}

// ---------------------------------------------------------------------------
// Selected / hovered label
// ---------------------------------------------------------------------------

function SelectedLabel({
	data, selected, hovered,
}: {
	data: ParsedStreetData;
	selected: StreetMarker;
	hovered: HoverState;
}) {
	const pick = selected ?? hovered;
	if (!pick) return null;

	let pos: [number, number, number] | null = null;
	let label = '';
	let color = '#fff';

	if (pick.kind === 'road') {
		const road = data.roads[pick.index];
		if (!road) return null;
		pos = [road.mReferencePosition.x, road.mReferencePosition.y + ROAD_RADIUS + 3, road.mReferencePosition.z];
		label = `${road.macDebugName.replace(/\0+$/, '')} #${pick.index}`;
		color = '#4488ff';
	} else if (pick.kind === 'junction') {
		const junc = data.junctions[pick.index];
		if (!junc) return null;
		const road = data.roads[junc.superSpanBase.miRoadIndex];
		if (!road) return null;
		pos = [road.mReferencePosition.x - ROAD_RADIUS - JUNCTION_RADIUS, road.mReferencePosition.y + JUNCTION_RADIUS + 3, road.mReferencePosition.z];
		label = `${junc.macName.replace(/\0+$/, '')} #${pick.index}`;
		color = '#eecc33';
	}

	if (!pos || !label) return null;

	return (
		<Html position={pos} center distanceFactor={200} style={{ pointerEvents: 'none' }}>
			<div style={{
				background: 'rgba(0,0,0,0.75)', color, padding: '2px 6px',
				borderRadius: 4, fontSize: 11, whiteSpace: 'nowrap', fontFamily: 'monospace',
			}}>
				{label}
			</div>
		</Html>
	);
}

// ---------------------------------------------------------------------------
// Overlay
// ---------------------------------------------------------------------------

type Props = {
	data: ParsedStreetData;
	selectedPath: NodePath;
	onSelect: (path: NodePath) => void;
	onChange?: (next: ParsedStreetData) => void;
};

export const StreetDataOverlay: WorldOverlayComponent<ParsedStreetData> = ({
	data,
	selectedPath,
	onSelect,
	// onChange — accepted to satisfy the WorldOverlayProps contract; unused
	// today because StreetData has no in-scene drag handles. Future drag work
	// will call it with the next root.
}: Props) => {
	const [hovered, setHovered] = useState<HoverState>(null);
	const { center, radius } = useMemo(() => computeBounds(data), [data]);

	const selected = useMemo(() => streetPathMarker(selectedPath), [selectedPath]);

	const handlePick = useCallback(
		(marker: StreetMarker) => onSelect(streetMarkerPath(marker)),
		[onSelect],
	);

	return (
		<>
			<Grid
				position={[center.x, center.y - radius, center.z]}
				args={[Math.max(radius * 4, 100), Math.max(radius * 4, 100)]}
				cellSize={50}
				cellThickness={0.5}
				sectionSize={200}
				sectionThickness={1}
				fadeDistance={radius * 8}
				infiniteGrid
			/>
			<RoadInstances data={data} selected={selected} hovered={hovered} onPick={handlePick} onHover={setHovered} />
			<StreetInstances data={data} selected={selected} hovered={hovered} onPick={handlePick} onHover={setHovered} />
			<JunctionInstances data={data} selected={selected} hovered={hovered} onPick={handlePick} onHover={setHovered} />
			<SelectedLabel data={data} selected={selected} hovered={hovered} />
		</>
	);
};

export default StreetDataOverlay;
