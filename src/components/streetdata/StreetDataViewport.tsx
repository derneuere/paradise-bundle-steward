// 3D viewport for StreetData — renders roads as spheres, streets as speed-colored
// cubes, and junctions as octahedrons.
//
// PERFORMANCE: Uses InstancedMesh for each marker type (1 draw call per type)
// instead of individual <mesh> per item. Custom raycasting via instanceId.

import { useMemo, useRef, useState, useCallback } from 'react';
import { Canvas, ThreeEvent } from '@react-three/fiber';
import { OrbitControls, Grid, Html } from '@react-three/drei';
import * as THREE from 'three';
import type { ParsedStreetData } from '@/lib/core/streetData';
import { AutoFit } from '@/components/common/three/AutoFit';
import { useUpdateInstancedMesh } from '@/hooks/useUpdateInstancedMesh';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type StreetDataSelection = {
	type: 'street' | 'junction' | 'road';
	index: number;
} | null;

type Props = {
	data: ParsedStreetData;
	onChange: (next: ParsedStreetData) => void;
	selected: StreetDataSelection;
	onSelect: (sel: StreetDataSelection) => void;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ROAD_RADIUS = 8;
const STREET_SIZE = 5;
const JUNCTION_RADIUS = 6;

// Shared geometries
const roadGeo = new THREE.SphereGeometry(ROAD_RADIUS, 16, 12);
const streetGeo = new THREE.BoxGeometry(STREET_SIZE, STREET_SIZE, STREET_SIZE);
const junctionGeo = new THREE.OctahedronGeometry(JUNCTION_RADIUS);

// Shared materials for instanced meshes
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
// Scene bounds
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
// Camera auto-fit
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// Instanced road markers
// ---------------------------------------------------------------------------

const _dummy = new THREE.Object3D();
const _color = new THREE.Color();

function RoadInstances({
	data, selected, hovered, onSelect, onHover,
}: {
	data: ParsedStreetData;
	selected: StreetDataSelection;
	hovered: StreetDataSelection;
	onSelect: (s: StreetDataSelection) => void;
	onHover: (s: StreetDataSelection) => void;
}) {
	const meshRef = useRef<THREE.InstancedMesh>(null!);
	const count = data.roads.length;

	// Set instance transforms and colors
	useUpdateInstancedMesh(
		meshRef,
		count,
		(mesh) => {
			for (let i = 0; i < count; i++) {
				const r = data.roads[i];
				_dummy.position.set(r.mReferencePosition.x, r.mReferencePosition.y, r.mReferencePosition.z);
				_dummy.updateMatrix();
				mesh.setMatrixAt(i, _dummy.matrix);

				const isSel = selected?.type === 'road' && selected.index === i;
				const isHov = hovered?.type === 'road' && hovered.index === i;
				mesh.setColorAt(i, isSel ? SEL_COLOR : isHov ? HOV_COLOR : ROAD_COLOR);
			}
		},
		[data.roads, count, selected, hovered],
	);

	const handleClick = useCallback((e: ThreeEvent<MouseEvent>) => {
		e.stopPropagation();
		if (e.instanceId != null) onSelect({ type: 'road', index: e.instanceId });
	}, [onSelect]);

	const handlePointerMove = useCallback((e: ThreeEvent<PointerEvent>) => {
		e.stopPropagation();
		if (e.instanceId != null) {
			onHover({ type: 'road', index: e.instanceId });
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

// ---------------------------------------------------------------------------
// Instanced street markers
// ---------------------------------------------------------------------------

function StreetInstances({
	data, selected, hovered, onSelect, onHover,
}: {
	data: ParsedStreetData;
	selected: StreetDataSelection;
	hovered: StreetDataSelection;
	onSelect: (s: StreetDataSelection) => void;
	onHover: (s: StreetDataSelection) => void;
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

				const isSel = selected?.type === 'street' && selected.index === i;
				const isHov = hovered?.type === 'street' && hovered.index === i;
				mesh.setColorAt(i, isSel ? SEL_COLOR : isHov ? HOV_COLOR : speedColor(street.mAiInfo.muMaxSpeedMPS));
			}
		},
		[data.streets, data.roads, count, selected, hovered],
	);

	const handleClick = useCallback((e: ThreeEvent<MouseEvent>) => {
		e.stopPropagation();
		if (e.instanceId != null) onSelect({ type: 'street', index: e.instanceId });
	}, [onSelect]);

	const handlePointerMove = useCallback((e: ThreeEvent<PointerEvent>) => {
		e.stopPropagation();
		if (e.instanceId != null) {
			onHover({ type: 'street', index: e.instanceId });
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

// ---------------------------------------------------------------------------
// Instanced junction markers
// ---------------------------------------------------------------------------

function JunctionInstances({
	data, selected, hovered, onSelect, onHover,
}: {
	data: ParsedStreetData;
	selected: StreetDataSelection;
	hovered: StreetDataSelection;
	onSelect: (s: StreetDataSelection) => void;
	onHover: (s: StreetDataSelection) => void;
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

				const isSel = selected?.type === 'junction' && selected.index === i;
				const isHov = hovered?.type === 'junction' && hovered.index === i;
				mesh.setColorAt(i, isSel ? SEL_COLOR : isHov ? HOV_COLOR : JUNCTION_COLOR);
			}
		},
		[data.junctions, data.roads, count, selected, hovered],
	);

	const handleClick = useCallback((e: ThreeEvent<MouseEvent>) => {
		e.stopPropagation();
		if (e.instanceId != null) onSelect({ type: 'junction', index: e.instanceId });
	}, [onSelect]);

	const handlePointerMove = useCallback((e: ThreeEvent<PointerEvent>) => {
		e.stopPropagation();
		if (e.instanceId != null) {
			onHover({ type: 'junction', index: e.instanceId });
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
// Selected item label (only 1 at a time)
// ---------------------------------------------------------------------------

function SelectedLabel({ data, selected, hovered }: { data: ParsedStreetData; selected: StreetDataSelection; hovered: StreetDataSelection }) {
	const pick = selected ?? hovered;
	if (!pick) return null;

	let pos: [number, number, number] | null = null;
	let label = '';
	let color = '#fff';

	if (pick.type === 'road') {
		const road = data.roads[pick.index];
		if (!road) return null;
		pos = [road.mReferencePosition.x, road.mReferencePosition.y + ROAD_RADIUS + 3, road.mReferencePosition.z];
		label = `${road.macDebugName.replace(/\0+$/, '')} #${pick.index}`;
		color = '#4488ff';
	} else if (pick.type === 'junction') {
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
// Main viewport component
// ---------------------------------------------------------------------------

export const StreetDataViewport: React.FC<Props> = ({ data, onChange, selected, onSelect }) => {
	const [hovered, setHovered] = useState<StreetDataSelection>(null);
	const { center, radius } = useMemo(() => computeBounds(data), [data]);
	const camDistance = radius * 2;

	return (
		<div style={{ height: '40vh', background: '#1a1d23', borderRadius: 8, minWidth: 0 }}>
			<Canvas
				camera={{
					position: [center.x + camDistance, center.y + camDistance * 0.5, center.z + camDistance],
					fov: 45,
					near: 0.1,
					far: Math.max(camDistance * 20, 1000),
				}}
				gl={{ antialias: true }}
				onPointerMissed={() => onSelect(null)}
			>
				<color attach="background" args={['#1a1d23']} />
				<AutoFit
					center={center}
					radius={radius}
					distanceFactor={2}
					offsetFactor={{ x: 1, y: 0.6, z: 1 }}
					setFar={false}
				/>
				<ambientLight intensity={0.5} />
				<hemisphereLight args={['#b1c8e8', '#4a3f2f', 0.4]} />
				<directionalLight position={[10, 10, 5]} intensity={1.0} />
				<directionalLight position={[-8, 5, -10]} intensity={0.5} />
				<Grid
					position={[center.x, center.y - radius, center.z]}
					args={[Math.max(radius * 4, 100), Math.max(radius * 4, 100)]}
					cellSize={50}
					cellThickness={0.5}
					sectionSize={200}
					sectionThickness={1}
					fadeDistance={camDistance * 4}
					infiniteGrid
				/>
				<RoadInstances data={data} selected={selected} hovered={hovered} onSelect={onSelect} onHover={setHovered} />
				<StreetInstances data={data} selected={selected} hovered={hovered} onSelect={onSelect} onHover={setHovered} />
				<JunctionInstances data={data} selected={selected} hovered={hovered} onSelect={onSelect} onHover={setHovered} />
				<SelectedLabel data={data} selected={selected} hovered={hovered} />
				<OrbitControls
					target={[center.x, center.y, center.z]}
					enableDamping
					dampingFactor={0.1}
					makeDefault
				/>
			</Canvas>
		</div>
	);
};

export default StreetDataViewport;
