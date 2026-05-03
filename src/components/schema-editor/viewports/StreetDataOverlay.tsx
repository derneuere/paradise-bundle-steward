// StreetDataOverlay — WorldViewport overlay for the StreetData resource.
//
// Renders roads as spheres, streets as speed-coloured cubes, and junctions
// as octahedrons — all batched through InstancedMesh so the per-type cost
// stays at one draw call regardless of count. Selection currency (the public
// contract per ADR-0001) is the schema NodePath: this overlay matches
// `['roads', i]`, `['streets', i]`, `['junctions', i]` directly.
//
// Internally each InstancedMesh now uses the shared `useInstancedSelection`
// hook from `./selection/`, so the per-instance paint + click + hover code
// lives in exactly one place across overlays. The path↔Selection codec is
// `streetSelectionCodec` below.
//
// `onChange` is forwarded for in-scene edits but the StreetData scene has
// no drag handles today (the source viewport never invoked it either). The
// prop is preserved so future drag-to-move work plugs in without a contract
// change.
//
// The grid stays here rather than in the WorldViewport chrome — AI sections
// and ZoneList both deliberately omit it (z-fights with their dense polys),
// so it's a StreetData-specific decoration, not chrome default.

import { useCallback, useMemo, useRef, useState } from 'react';
import { Grid, Html } from '@react-three/drei';
import * as THREE from 'three';
import type { ParsedStreetData } from '@/lib/core/streetData';
import type { NodePath } from '@/lib/schema/walk';
import type { WorldOverlayComponent } from './WorldViewport.types';
import {
	defineSelectionCodec,
	useInstancedSelection,
	type Selection,
} from './selection';

// ---------------------------------------------------------------------------
// Path ↔ Selection codec (exported for tests)
// ---------------------------------------------------------------------------

/** Selection kinds this overlay paints. */
export type StreetMarkerKind = 'street' | 'junction' | 'road';

/**
 * Codec for the three top-level StreetData lists. Sub-paths inside an entity
 * (e.g. drilling into `['streets', 5, 'mAiInfo', ...]`) collapse to "this
 * entity is selected" — the inspector can refine to a primitive but the 3D
 * overlay still highlights the parent.
 */
export const streetSelectionCodec = defineSelectionCodec({
	pathToSelection: (path: NodePath): Selection | null => {
		if (path.length < 2) return null;
		const head = path[0];
		const idx = path[1];
		if (typeof idx !== 'number') return null;
		if (head === 'streets') return { kind: 'street', indices: [idx] };
		if (head === 'junctions') return { kind: 'junction', indices: [idx] };
		if (head === 'roads') return { kind: 'road', indices: [idx] };
		return null;
	},
	selectionToPath: (sel: Selection): NodePath => {
		if (sel.kind === 'street') return ['streets', sel.indices[0]];
		if (sel.kind === 'junction') return ['junctions', sel.indices[0]];
		if (sel.kind === 'road') return ['roads', sel.indices[0]];
		return [];
	},
});

/** Back-compat alias retained for test imports — same as the codec direction. */
export const streetPathMarker = streetSelectionCodec.pathToSelection;
/** Back-compat alias retained for test imports — same as the codec direction. */
export const streetMarkerPath = (sel: Selection | null): NodePath =>
	sel ? streetSelectionCodec.selectionToPath(sel) : [];

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

const ROAD_COLOR = new THREE.Color(0x4488ff);
const JUNCTION_COLOR = new THREE.Color(0xeecc33);

/** Green→Red lerp based on speed 0-255. */
function speedColor(maxSpeed: number): THREE.Color {
	const t = Math.min(maxSpeed / 255, 1);
	return new THREE.Color().setRGB(t, 1 - t, 0.15);
}

// StreetData has no bulk-select use case yet — share one frozen empty Set so
// every Instances child below references the same identity (stable hook deps).
const EMPTY_BULK: ReadonlySet<string> = new Set();

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

type InstancesProps = {
	data: ParsedStreetData;
	primary: Selection | null;
	hovered: Selection | null;
	onPick: (sel: Selection) => void;
	onHover: (sel: Selection | null) => void;
};

function RoadInstances({ data, primary, hovered, onPick, onHover }: InstancesProps) {
	const meshRef = useRef<THREE.InstancedMesh>(null!);
	const count = data.roads.length;

	const setMatrix = useCallback((i: number, dummy: THREE.Object3D) => {
		const r = data.roads[i];
		dummy.position.set(r.mReferencePosition.x, r.mReferencePosition.y, r.mReferencePosition.z);
	}, [data.roads]);

	const baseColorFor = useCallback(() => ROAD_COLOR, []);

	const handlers = useInstancedSelection(meshRef, {
		kind: 'road',
		count,
		primary,
		bulk: EMPTY_BULK,
		hovered,
		setMatrix,
		baseColorFor,
		onPick,
		onHover,
	});

	if (count === 0) return null;
	return <instancedMesh ref={meshRef} args={[roadGeo, roadMat, count]} {...handlers} />;
}

function StreetInstances({ data, primary, hovered, onPick, onHover }: InstancesProps) {
	const meshRef = useRef<THREE.InstancedMesh>(null!);
	const count = data.streets.length;

	const setMatrix = useCallback((i: number, dummy: THREE.Object3D) => {
		const street = data.streets[i];
		const road = data.roads[street.superSpanBase.miRoadIndex];
		if (road) {
			dummy.position.set(
				road.mReferencePosition.x + ROAD_RADIUS + STREET_SIZE * 0.8,
				road.mReferencePosition.y + (i % 3) * STREET_SIZE * 1.2,
				road.mReferencePosition.z,
			);
		} else {
			dummy.position.set(0, -9999, 0); // hide invalid
		}
	}, [data.streets, data.roads]);

	const baseColorFor = useCallback(
		(i: number) => speedColor(data.streets[i].mAiInfo.muMaxSpeedMPS),
		[data.streets],
	);

	const handlers = useInstancedSelection(meshRef, {
		kind: 'street',
		count,
		primary,
		bulk: EMPTY_BULK,
		hovered,
		setMatrix,
		baseColorFor,
		onPick,
		onHover,
	});

	if (count === 0) return null;
	return <instancedMesh ref={meshRef} args={[streetGeo, streetMat, count]} {...handlers} />;
}

function JunctionInstances({ data, primary, hovered, onPick, onHover }: InstancesProps) {
	const meshRef = useRef<THREE.InstancedMesh>(null!);
	const count = data.junctions.length;

	const setMatrix = useCallback((i: number, dummy: THREE.Object3D) => {
		const junc = data.junctions[i];
		const road = data.roads[junc.superSpanBase.miRoadIndex];
		if (road) {
			dummy.position.set(
				road.mReferencePosition.x - ROAD_RADIUS - JUNCTION_RADIUS * 0.8,
				road.mReferencePosition.y,
				road.mReferencePosition.z + (i % 3) * JUNCTION_RADIUS * 1.5,
			);
		} else {
			dummy.position.set(0, -9999, 0);
		}
	}, [data.junctions, data.roads]);

	const baseColorFor = useCallback(() => JUNCTION_COLOR, []);

	const handlers = useInstancedSelection(meshRef, {
		kind: 'junction',
		count,
		primary,
		bulk: EMPTY_BULK,
		hovered,
		setMatrix,
		baseColorFor,
		onPick,
		onHover,
	});

	if (count === 0) return null;
	return <instancedMesh ref={meshRef} args={[junctionGeo, junctionMat, count]} {...handlers} />;
}

// ---------------------------------------------------------------------------
// Selected / hovered label
// ---------------------------------------------------------------------------

function SelectedLabel({
	data, primary, hovered,
}: {
	data: ParsedStreetData;
	primary: Selection | null;
	hovered: Selection | null;
}) {
	const pick = primary ?? hovered;
	if (!pick) return null;
	const idx = pick.indices[0];

	let pos: [number, number, number] | null = null;
	let label = '';
	let color = '#fff';

	if (pick.kind === 'road') {
		const road = data.roads[idx];
		if (!road) return null;
		pos = [road.mReferencePosition.x, road.mReferencePosition.y + ROAD_RADIUS + 3, road.mReferencePosition.z];
		label = `${road.macDebugName.replace(/\0+$/, '')} #${idx}`;
		color = '#4488ff';
	} else if (pick.kind === 'junction') {
		const junc = data.junctions[idx];
		if (!junc) return null;
		const road = data.roads[junc.superSpanBase.miRoadIndex];
		if (!road) return null;
		pos = [road.mReferencePosition.x - ROAD_RADIUS - JUNCTION_RADIUS, road.mReferencePosition.y + JUNCTION_RADIUS + 3, road.mReferencePosition.z];
		label = `${junc.macName.replace(/\0+$/, '')} #${idx}`;
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
	const [hovered, setHovered] = useState<Selection | null>(null);
	const { center, radius } = useMemo(() => computeBounds(data), [data]);

	const primary = useMemo(
		() => streetSelectionCodec.pathToSelection(selectedPath),
		[selectedPath],
	);

	const handlePick = useCallback(
		(sel: Selection) => onSelect(streetSelectionCodec.selectionToPath(sel)),
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
			<RoadInstances data={data} primary={primary} hovered={hovered} onPick={handlePick} onHover={setHovered} />
			<StreetInstances data={data} primary={primary} hovered={hovered} onPick={handlePick} onHover={setHovered} />
			<JunctionInstances data={data} primary={primary} hovered={hovered} onPick={handlePick} onHover={setHovered} />
			<SelectedLabel data={data} primary={primary} hovered={hovered} />
		</>
	);
};

export default StreetDataOverlay;
