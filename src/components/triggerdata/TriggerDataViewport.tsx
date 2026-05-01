// 3D viewport for TriggerData — renders BoxRegion volumes as wireframe boxes,
// spawn locations as arrows, roaming locations as dots.
//
// PERFORMANCE: All box regions are rendered via a single InstancedMesh (1 draw
// call) with per-instance color. Picking uses instanceId. Wireframe edges are
// only rendered for the selected/hovered box.

import React, { useMemo, useRef, useState, useCallback } from 'react';
import { Canvas, ThreeEvent } from '@react-three/fiber';
import { OrbitControls, Html, Line } from '@react-three/drei';
import { AutoFit } from '@/components/common/three/AutoFit';
import { CameraBridge, type CameraBridgeData } from '@/components/common/three/CameraBridge';
import { MarqueeSelector } from '@/components/common/three/MarqueeSelector';
import { useUpdateInstancedMesh } from '@/hooks/useUpdateInstancedMesh';
import { useSchemaBulkSelection } from '@/components/schema-editor/bulkSelectionContext';
import type { NodePath } from '@/lib/schema/walk';
import * as THREE from 'three';
import type {
	ParsedTriggerData, BoxRegion, Vector4,
} from '@/lib/core/triggerData';
import { GenericRegionType } from '@/lib/core/triggerData';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TriggerSelection = {
	kind: 'landmark' | 'generic' | 'blackspot' | 'vfx' | 'spawn' | 'roaming' | 'playerStart';
	index: number;
} | null;

type Props = {
	data: ParsedTriggerData;
	onChange: (next: ParsedTriggerData) => void;
	selected: TriggerSelection;
	onSelect: (sel: TriggerSelection) => void;
};

// ---------------------------------------------------------------------------
// Flat region entry — one per box, used by InstancedMesh
// ---------------------------------------------------------------------------

type RegionEntry = {
	kind: 'landmark' | 'generic' | 'blackspot' | 'vfx';
	index: number;     // index within that kind's array
	box: BoxRegion;
	color: THREE.Color;
	label: string;
};

// ---------------------------------------------------------------------------
// Color mapping
// ---------------------------------------------------------------------------

function genericColorObj(type: GenericRegionType): THREE.Color {
	if (type <= 5 || type === 17 || type === 18) return new THREE.Color('#4488cc');
	if (type === 6 || type === 8 || type === 32) return new THREE.Color('#9944cc');
	if (type === 7 || type === 9 || type === 10 || type === 11) return new THREE.Color('#cc4444');
	if (type === 12) return new THREE.Color('#888888');
	if (type >= 13 && type <= 16) return new THREE.Color('#44cc88');
	if (type >= 19 && type <= 31) return new THREE.Color('#777777');
	return new THREE.Color('#aaaaaa');
}

const LANDMARK_COLOR = new THREE.Color('#44cc44');
const BLACKSPOT_COLOR = new THREE.Color('#cc2222');
const VFX_COLOR = new THREE.Color('#cc44cc');
const SEL_COLOR = new THREE.Color('#ffaa33');
const HOV_COLOR = new THREE.Color('#66aaff');

// ---------------------------------------------------------------------------
// Build flat region list (memoized)
// ---------------------------------------------------------------------------

function buildRegionList(data: ParsedTriggerData): RegionEntry[] {
	const out: RegionEntry[] = [];
	for (let i = 0; i < data.landmarks.length; i++) {
		const lm = data.landmarks[i];
		out.push({ kind: 'landmark', index: i, box: lm.box, color: LANDMARK_COLOR, label: `Landmark #${i} (id=${lm.id})` });
	}
	for (let i = 0; i < data.genericRegions.length; i++) {
		const gr = data.genericRegions[i];
		out.push({ kind: 'generic', index: i, box: gr.box, color: genericColorObj(gr.genericType), label: `Generic #${i} ${GenericRegionType[gr.genericType] ?? gr.genericType}` });
	}
	for (let i = 0; i < data.blackspots.length; i++) {
		const bs = data.blackspots[i];
		out.push({ kind: 'blackspot', index: i, box: bs.box, color: BLACKSPOT_COLOR, label: `Blackspot #${i} (score=${bs.scoreAmount})` });
	}
	for (let i = 0; i < data.vfxBoxRegions.length; i++) {
		out.push({ kind: 'vfx', index: i, box: data.vfxBoxRegions[i].box, color: VFX_COLOR, label: `VFX #${i}` });
	}
	return out;
}

// ---------------------------------------------------------------------------
// Scene bounds
// ---------------------------------------------------------------------------

function computeBounds(data: ParsedTriggerData): { center: THREE.Vector3; radius: number } {
	const box = new THREE.Box3();
	let hasPoints = false;
	const addBox = (b: BoxRegion) => { box.expandByPoint(new THREE.Vector3(b.position.x, b.position.y, b.position.z)); hasPoints = true; };
	const addVec = (v: Vector4) => { box.expandByPoint(new THREE.Vector3(v.x, v.y, v.z)); hasPoints = true; };
	for (const lm of data.landmarks) addBox(lm.box);
	for (const gr of data.genericRegions) addBox(gr.box);
	for (const bs of data.blackspots) addBox(bs.box);
	for (const vfx of data.vfxBoxRegions) addBox(vfx.box);
	for (const sp of data.spawnLocations) addVec(sp.position);
	for (const rl of data.roamingLocations) addVec(rl.position);
	addVec(data.playerStartPosition);
	if (!hasPoints) return { center: new THREE.Vector3(), radius: 200 };
	const sphere = new THREE.Sphere();
	box.getBoundingSphere(sphere);
	return { center: sphere.center, radius: Math.max(sphere.radius, 50) };
}

// ---------------------------------------------------------------------------
// Camera auto-fit
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Batched region boxes — single InstancedMesh for ALL box regions
// ---------------------------------------------------------------------------

const _dummy = new THREE.Object3D();
const boxGeo = new THREE.BoxGeometry(1, 1, 1);
const boxMat = new THREE.MeshBasicMaterial({
	transparent: true,
	opacity: 0.15,
	side: THREE.DoubleSide,
	depthWrite: false,
});

function BatchedRegionBoxes({
	regions, selected, hovered, onSelect, onHover,
}: {
	regions: RegionEntry[];
	selected: TriggerSelection;
	hovered: TriggerSelection;
	onSelect: (sel: TriggerSelection) => void;
	onHover: (sel: TriggerSelection) => void;
}) {
	const meshRef = useRef<THREE.InstancedMesh>(null!);
	const count = regions.length;

	// Set instance transforms + colors
	useUpdateInstancedMesh(
		meshRef,
		count,
		(mesh) => {
			for (let i = 0; i < count; i++) {
				const r = regions[i];
				_dummy.position.set(r.box.position.x, r.box.position.y, r.box.position.z);
				_dummy.rotation.set(r.box.rotation.x, r.box.rotation.y, r.box.rotation.z);
				_dummy.scale.set(r.box.dimensions.x || 1, r.box.dimensions.y || 1, r.box.dimensions.z || 1);
				_dummy.updateMatrix();
				mesh.setMatrixAt(i, _dummy.matrix);

				const isSel = selected?.kind === r.kind && selected.index === r.index;
				const isHov = hovered?.kind === r.kind && hovered.index === r.index;
				mesh.setColorAt(i, isSel ? SEL_COLOR : isHov ? HOV_COLOR : r.color);
			}
		},
		[regions, count, selected, hovered],
	);

	const handleClick = useCallback((e: ThreeEvent<MouseEvent>) => {
		e.stopPropagation();
		if (e.instanceId != null && e.instanceId < regions.length) {
			const r = regions[e.instanceId];
			onSelect({ kind: r.kind, index: r.index });
		}
	}, [regions, onSelect]);

	const handlePointerMove = useCallback((e: ThreeEvent<PointerEvent>) => {
		e.stopPropagation();
		if (e.instanceId != null && e.instanceId < regions.length) {
			const r = regions[e.instanceId];
			onHover({ kind: r.kind, index: r.index });
			document.body.style.cursor = 'pointer';
		}
	}, [regions, onHover]);

	const handlePointerOut = useCallback(() => {
		onHover(null);
		document.body.style.cursor = 'auto';
	}, [onHover]);

	if (count === 0) return null;

	return (
		<instancedMesh
			ref={meshRef}
			args={[boxGeo, boxMat, count]}
			onClick={handleClick}
			onPointerMove={handlePointerMove}
			onPointerOut={handlePointerOut}
		/>
	);
}

// ---------------------------------------------------------------------------
// Wireframe overlay for selected/hovered box (only 1-2 at a time)
// ---------------------------------------------------------------------------

const wireBoxEdges = new THREE.EdgesGeometry(boxGeo);
const selEdgeMat = new THREE.LineBasicMaterial({ color: '#ffaa33' });
const hovEdgeMat = new THREE.LineBasicMaterial({ color: '#66aaff' });

function BoxOverlay({ box, material }: { box: BoxRegion; material: THREE.LineBasicMaterial }) {
	return (
		<group
			position={[box.position.x, box.position.y, box.position.z]}
			rotation={[box.rotation.x, box.rotation.y, box.rotation.z]}
			scale={[box.dimensions.x || 1, box.dimensions.y || 1, box.dimensions.z || 1]}
		>
			<lineSegments geometry={wireBoxEdges} material={material} />
		</group>
	);
}

function BoxLabel({ box, label, color }: { box: BoxRegion; label: string; color: string }) {
	return (
		<Html
			position={[box.position.x, box.position.y + (box.dimensions.y || 1) * 0.6, box.position.z]}
			center distanceFactor={300}
			style={{ pointerEvents: 'none' }}
		>
			<div style={{
				background: 'rgba(0,0,0,0.8)', color, padding: '2px 6px',
				borderRadius: 4, fontSize: 10, whiteSpace: 'nowrap', fontFamily: 'monospace',
			}}>
				{label}
			</div>
		</Html>
	);
}

// ---------------------------------------------------------------------------
// Spawn arrows (typically few — keep individual)
// ---------------------------------------------------------------------------

const coneGeo = new THREE.ConeGeometry(3, 8, 8);
const spawnMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0.2 });
const spawnSelMat = new THREE.MeshStandardMaterial({ color: 0xffaa33, roughness: 0.4, metalness: 0.2, emissive: 0x664400, emissiveIntensity: 0.5 });

function SpawnArrows({
	data, selected, onSelect,
}: {
	data: ParsedTriggerData;
	selected: TriggerSelection;
	onSelect: (sel: TriggerSelection) => void;
}) {
	return (
		<>
			{data.spawnLocations.map((sp, i) => {
				const pos: [number, number, number] = [sp.position.x, sp.position.y, sp.position.z];
				const isSel = selected?.kind === 'spawn' && selected.index === i;
				const dir = new THREE.Vector3(sp.direction.x, sp.direction.y, sp.direction.z);
				if (dir.lengthSq() > 0.001) dir.normalize();
				const arrowEnd: [number, number, number] = [
					sp.position.x + dir.x * 15, sp.position.y + dir.y * 15, sp.position.z + dir.z * 15,
				];
				return (
					<group key={`spawn-${i}`}>
						<mesh
							geometry={coneGeo}
							material={isSel ? spawnSelMat : spawnMat}
							position={pos}
							onClick={(e) => { e.stopPropagation(); onSelect({ kind: 'spawn', index: i }); }}
						/>
						<Line points={[pos, arrowEnd]} color={isSel ? '#ffaa33' : '#ffffff'} lineWidth={2} />
						{isSel && (
							<Html position={pos} center distanceFactor={200} style={{ pointerEvents: 'none' }}>
								<div style={{
									background: 'rgba(0,0,0,0.8)', color: '#fff', padding: '2px 6px',
									borderRadius: 4, fontSize: 10, whiteSpace: 'nowrap', fontFamily: 'monospace',
								}}>
									Spawn #{i}
								</div>
							</Html>
						)}
					</group>
				);
			})}
		</>
	);
}

// ---------------------------------------------------------------------------
// Roaming dots (InstancedMesh — already optimized)
// ---------------------------------------------------------------------------

const roamGeo = new THREE.SphereGeometry(2, 8, 6);
const roamMat = new THREE.MeshStandardMaterial({ roughness: 0.6 });
const ROAM_COLOR = new THREE.Color(0x888888);
const ROAM_SEL_COLOR = new THREE.Color(0xffaa33);
const _roamDummy = new THREE.Object3D();

function RoamingDots({
	data, selected, onSelect,
}: {
	data: ParsedTriggerData;
	selected: TriggerSelection;
	onSelect: (sel: TriggerSelection) => void;
}) {
	const meshRef = useRef<THREE.InstancedMesh>(null!);
	const count = data.roamingLocations.length;

	useUpdateInstancedMesh(
		meshRef,
		count,
		(mesh) => {
			for (let i = 0; i < count; i++) {
				const rl = data.roamingLocations[i];
				_roamDummy.position.set(rl.position.x, rl.position.y, rl.position.z);
				_roamDummy.updateMatrix();
				mesh.setMatrixAt(i, _roamDummy.matrix);
				const isSel = selected?.kind === 'roaming' && selected.index === i;
				mesh.setColorAt(i, isSel ? ROAM_SEL_COLOR : ROAM_COLOR);
			}
		},
		[data.roamingLocations, count, selected],
	);

	const handleClick = useCallback((e: ThreeEvent<MouseEvent>) => {
		e.stopPropagation();
		if (e.instanceId != null) onSelect({ kind: 'roaming', index: e.instanceId });
	}, [onSelect]);

	if (count === 0) return null;
	return <instancedMesh ref={meshRef} args={[roamGeo, roamMat, count]} onClick={handleClick} />;
}

// ---------------------------------------------------------------------------
// Player start arrow (gold)
// ---------------------------------------------------------------------------

const playerMat = new THREE.MeshStandardMaterial({ color: 0xffcc00, roughness: 0.3, metalness: 0.4, emissive: 0x664400, emissiveIntensity: 0.3 });
const playerSelMat = new THREE.MeshStandardMaterial({ color: 0xffaa33, roughness: 0.3, metalness: 0.4, emissive: 0x664400, emissiveIntensity: 0.6 });
const playerConeGeo = new THREE.ConeGeometry(5, 12, 8);

function PlayerStartMarker({ data, selected, onSelect }: {
	data: ParsedTriggerData; selected: TriggerSelection; onSelect: (sel: TriggerSelection) => void;
}) {
	const pos: [number, number, number] = [data.playerStartPosition.x, data.playerStartPosition.y, data.playerStartPosition.z];
	const dir = new THREE.Vector3(data.playerStartDirection.x, data.playerStartDirection.y, data.playerStartDirection.z);
	if (dir.lengthSq() > 0.001) dir.normalize();
	const arrowEnd: [number, number, number] = [pos[0] + dir.x * 25, pos[1] + dir.y * 25, pos[2] + dir.z * 25];
	const isSel = selected?.kind === 'playerStart';

	return (
		<group>
			<mesh geometry={playerConeGeo} material={isSel ? playerSelMat : playerMat} position={pos}
				onClick={(e) => { e.stopPropagation(); onSelect({ kind: 'playerStart', index: 0 }); }}
			/>
			<Line points={[pos, arrowEnd]} color="#ffcc00" lineWidth={3} />
			<Html position={[pos[0], pos[1] + 15, pos[2]]} center distanceFactor={200} style={{ pointerEvents: 'none' }}>
				<div style={{
					background: 'rgba(0,0,0,0.8)', color: '#ffcc00', padding: '2px 6px',
					borderRadius: 4, fontSize: 11, whiteSpace: 'nowrap', fontFamily: 'monospace', fontWeight: 'bold',
				}}>
					Player Start
				</div>
			</Html>
		</group>
	);
}

// ---------------------------------------------------------------------------
// Main viewport
// ---------------------------------------------------------------------------

export const TriggerDataViewport: React.FC<Props> = ({ data, onChange, selected, onSelect }) => {
	const [hovered, setHovered] = useState<TriggerSelection>(null);
	const { center, radius } = useMemo(() => computeBounds(data), [data]);
	const camDistance = radius * 1.8;

	// Flat list of all box regions for the InstancedMesh
	const regions = useMemo(() => buildRegionList(data), [data]);

	// Find box for selected/hovered item (for wireframe overlay)
	const findEntry = (sel: TriggerSelection) =>
		sel ? regions.find(r => r.kind === sel.kind && r.index === sel.index) : undefined;
	const selEntry = findEntry(selected);
	const hovEntry = findEntry(hovered);

	// Marquee wiring: pick every region/spawn/roaming whose centroid is
	// inside the dragged rectangle and union/subtract their schema paths
	// into the bulk set. Boxes use box.position; vec-positioned items
	// (spawns, roams, playerStart) use their position field.
	const cameraBridge = useRef<CameraBridgeData | null>(null);
	const bulk = useSchemaBulkSelection();
	const handleMarquee = useCallback(
		(frustum: THREE.Frustum, mode: 'add' | 'remove') => {
			if (!bulk?.onBulkApplyPaths) return;
			const hits: NodePath[] = [];
			const pt = new THREE.Vector3();
			const tryBox = (listKey: string, list: { box: BoxRegion }[]) => {
				for (let i = 0; i < list.length; i++) {
					const p = list[i].box.position;
					pt.set(p.x, p.y, p.z);
					if (frustum.containsPoint(pt)) hits.push([listKey, i]);
				}
			};
			const tryVec = (listKey: string, list: { position: Vector4 }[]) => {
				for (let i = 0; i < list.length; i++) {
					const p = list[i].position;
					pt.set(p.x, p.y, p.z);
					if (frustum.containsPoint(pt)) hits.push([listKey, i]);
				}
			};
			tryBox('landmarks', data.landmarks);
			tryBox('genericRegions', data.genericRegions);
			tryBox('blackspots', data.blackspots);
			tryBox('vfxBoxRegions', data.vfxBoxRegions);
			tryVec('spawnLocations', data.spawnLocations);
			tryVec('roamingLocations', data.roamingLocations);
			if (hits.length === 0) return;
			bulk.onBulkApplyPaths(hits, mode);
		},
		[data, bulk],
	);

	return (
		<div style={{ height: '45vh', background: '#1a1d23', borderRadius: 8, minWidth: 0, position: 'relative' }}>
			<Canvas
				camera={{
					position: [center.x + camDistance * 0.7, center.y + camDistance, center.z + camDistance * 0.7],
					fov: 45,
					near: 0.1,
					far: Math.max(camDistance * 20, 5000),
				}}
				gl={{ antialias: true, logarithmicDepthBuffer: true }}
				onPointerMissed={() => onSelect(null)}
			>
				<color attach="background" args={['#1a1d23']} />
				<AutoFit
					center={center}
					radius={radius}
					distanceFactor={1.8}
					offsetFactor={{ x: 0.7, y: 1, z: 0.7 }}
					setFar={false}
				/>
				<ambientLight intensity={0.5} />
				<hemisphereLight args={['#b1c8e8', '#4a3f2f', 0.3]} />
				<directionalLight position={[10, 20, 5]} intensity={0.9} />
				<directionalLight position={[-8, 15, -10]} intensity={0.4} />
				{/* All box regions — single InstancedMesh draw call */}
				<BatchedRegionBoxes
					regions={regions}
					selected={selected}
					hovered={hovered}
					onSelect={onSelect}
					onHover={setHovered}
				/>

				{/* Wireframe edges only for selected/hovered (1-2 boxes max) */}
				{selEntry && <BoxOverlay box={selEntry.box} material={selEdgeMat} />}
				{hovEntry && hovEntry !== selEntry && <BoxOverlay box={hovEntry.box} material={hovEdgeMat} />}

				{/* Labels only for selected/hovered */}
				{selEntry && <BoxLabel box={selEntry.box} label={selEntry.label} color="#ffaa33" />}
				{hovEntry && hovEntry !== selEntry && <BoxLabel box={hovEntry.box} label={hovEntry.label} color="#66aaff" />}

				<SpawnArrows data={data} selected={selected} onSelect={onSelect} />
				<RoamingDots data={data} selected={selected} onSelect={onSelect} />
				<PlayerStartMarker data={data} selected={selected} onSelect={onSelect} />
				<CameraBridge bridge={cameraBridge} />
				<OrbitControls
					target={[center.x, center.y, center.z]}
					enableDamping
					dampingFactor={0.1}
					makeDefault
				/>
			</Canvas>
			<MarqueeSelector
				bridge={cameraBridge}
				far={Math.max(camDistance * 20, 5000)}
				onMarquee={handleMarquee}
				hintIdle="press B to box-select trigger regions"
			/>
		</div>
	);
};

export default TriggerDataViewport;
