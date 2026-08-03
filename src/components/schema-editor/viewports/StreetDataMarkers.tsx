// StreetDataMarkers — the drawn half of the StreetData overlay.
//
// Roads render as spheres, streets as speed-coloured cubes, and junctions as
// octahedrons, all batched through InstancedMesh so the per-type cost stays at
// one draw call regardless of count. Each mesh drives its per-instance paint +
// click + hover through the shared `useInstancedSelection` hook.
//
// Split out of `StreetDataOverlay.tsx` so that file is only the codec plus the
// gizmo/transform wiring: the two halves change for unrelated reasons (marker
// looks vs. edit semantics) and together they exceeded the repo's file-size
// rule.

import { useCallback, useRef } from 'react';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import type { ParsedStreetData } from '@/lib/core/streetData';
import { useInstancedSelection, type Selection } from './selection';

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
// Instanced markers
// ---------------------------------------------------------------------------

type InstancesProps = {
	data: ParsedStreetData;
	primary: Selection | null;
	hovered: Selection | null;
	onPick: (sel: Selection) => void;
	onHover: (sel: Selection | null) => void;
};

export function RoadInstances({ data, primary, hovered, onPick, onHover }: InstancesProps) {
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

export function StreetInstances({ data, primary, hovered, onPick, onHover }: InstancesProps) {
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

export function JunctionInstances({ data, primary, hovered, onPick, onHover }: InstancesProps) {
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

export function SelectedLabel({
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
