// 3D viewport for TriggerData — renders BoxRegion volumes as wireframe boxes,
// spawn locations as arrows, roaming locations as dots.  Replaces the 2D
// Leaflet map with an actual 3D view of the trigger volumes.

import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Canvas, useThree, ThreeEvent } from '@react-three/fiber';
import { OrbitControls, Grid, Html, Line } from '@react-three/drei';
import * as THREE from 'three';
import type {
	ParsedTriggerData, Landmark, GenericRegion, Blackspot, VFXBoxRegion,
	RoamingLocation, SpawnLocation, BoxRegion, Vector4,
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
// Color mapping
// ---------------------------------------------------------------------------

function genericColor(type: GenericRegionType): string {
	// Shops = blue, jumps/stunts = purple, smash/crash = red, road/structural = grey
	if (type <= 5 || type === 17 || type === 18) return '#4488cc'; // shops
	if (type === 6 || type === 8 || type === 32) return '#9944cc';  // jumps/stunts/ramp
	if (type === 7 || type === 9 || type === 10 || type === 11) return '#cc4444'; // killzone/smash/crash
	if (type === 12) return '#888888'; // road limit
	if (type >= 13 && type <= 16) return '#44cc88'; // overdrive
	if (type >= 19 && type <= 31) return '#777777'; // structural/pass
	return '#aaaaaa';
}

const REGION_COLORS = {
	landmark: '#44cc44',
	blackspot: '#cc2222',
	vfx: '#cc44cc',
} as const;

// ---------------------------------------------------------------------------
// Scene bounds
// ---------------------------------------------------------------------------

function computeBounds(data: ParsedTriggerData): { center: THREE.Vector3; radius: number } {
	const box = new THREE.Box3();
	let hasPoints = false;

	const addBox = (b: BoxRegion) => {
		box.expandByPoint(new THREE.Vector3(b.positionX, b.positionY, b.positionZ));
		hasPoints = true;
	};
	const addVec = (v: Vector4) => {
		box.expandByPoint(new THREE.Vector3(v.x, v.y, v.z));
		hasPoints = true;
	};

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

function AutoFit({ center, radius }: { center: THREE.Vector3; radius: number }) {
	const { camera } = useThree();
	const fitted = useRef(false);
	useEffect(() => {
		if (fitted.current) return;
		fitted.current = true;
		const d = radius * 1.8;
		camera.position.set(center.x + d * 0.7, center.y + d, center.z + d * 0.7);
		camera.lookAt(center);
	}, [camera, center, radius]);
	return null;
}

// ---------------------------------------------------------------------------
// Wireframe box from BoxRegion
// ---------------------------------------------------------------------------

const wireBoxGeo = new THREE.BoxGeometry(1, 1, 1);
const wireBoxEdges = new THREE.EdgesGeometry(wireBoxGeo);

// Cache fill materials by color+opacity key to avoid creating thousands of instances
const fillMatCache = new Map<string, THREE.MeshBasicMaterial>();
function getFillMat(color: string, opacity: number): THREE.MeshBasicMaterial {
	const key = `${color}|${opacity}`;
	let mat = fillMatCache.get(key);
	if (!mat) {
		mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false });
		fillMatCache.set(key, mat);
	}
	return mat;
}

const edgeMatCache = new Map<string, THREE.LineBasicMaterial>();
function getEdgeMat(color: string): THREE.LineBasicMaterial {
	let mat = edgeMatCache.get(color);
	if (!mat) {
		mat = new THREE.LineBasicMaterial({ color });
		edgeMatCache.set(color, mat);
	}
	return mat;
}

const RegionBox = React.memo(function RegionBox({
	box, color, label, isSelected, isHovered, onClick, onHover,
}: {
	box: BoxRegion;
	color: string;
	label: string;
	isSelected: boolean;
	isHovered: boolean;
	onClick: () => void;
	onHover: (h: boolean) => void;
}) {
	const euler = useMemo(() => new THREE.Euler(box.rotationX, box.rotationY, box.rotationZ), [box.rotationX, box.rotationY, box.rotationZ]);
	const displayColor = isSelected ? '#ffaa33' : isHovered ? '#66aaff' : color;
	const opacity = isSelected ? 0.3 : isHovered ? 0.2 : 0.1;
	const fillMat = getFillMat(displayColor, opacity);
	const edgeMat = getEdgeMat(displayColor);

	return (
		<group
			position={[box.positionX, box.positionY, box.positionZ]}
			rotation={euler}
			scale={[box.dimensionX || 1, box.dimensionY || 1, box.dimensionZ || 1]}
		>
			<mesh
				geometry={wireBoxGeo}
				material={fillMat}
				onClick={(e) => { e.stopPropagation(); onClick(); }}
				onPointerOver={(e) => { e.stopPropagation(); onHover(true); document.body.style.cursor = 'pointer'; }}
				onPointerOut={(e) => { e.stopPropagation(); onHover(false); document.body.style.cursor = 'auto'; }}
			/>
			<lineSegments geometry={wireBoxEdges} material={edgeMat} />
			{(isSelected || isHovered) && (
				<Html center distanceFactor={300} style={{ pointerEvents: 'none' }}>
					<div style={{
						background: 'rgba(0,0,0,0.8)', color: displayColor, padding: '2px 6px',
						borderRadius: 4, fontSize: 10, whiteSpace: 'nowrap', fontFamily: 'monospace',
					}}>
						{label}
					</div>
				</Html>
			)}
		</group>
	);
});

// ---------------------------------------------------------------------------
// All region boxes
// ---------------------------------------------------------------------------

function RegionBoxes({
	data, selected, hovered, onSelect, onHover,
}: {
	data: ParsedTriggerData;
	selected: TriggerSelection;
	hovered: TriggerSelection;
	onSelect: (sel: TriggerSelection) => void;
	onHover: (sel: TriggerSelection) => void;
}) {
	return (
		<>
			{/* Landmarks */}
			{data.landmarks.map((lm, i) => (
				<RegionBox
					key={`lm-${i}`}
					box={lm.box}
					color={REGION_COLORS.landmark}
					label={`Landmark #${i} (id=${lm.id})`}
					isSelected={selected?.kind === 'landmark' && selected.index === i}
					isHovered={hovered?.kind === 'landmark' && hovered.index === i}
					onClick={() => onSelect({ kind: 'landmark', index: i })}
					onHover={(h) => onHover(h ? { kind: 'landmark', index: i } : null)}
				/>
			))}

			{/* Generic regions */}
			{data.genericRegions.map((gr, i) => (
				<RegionBox
					key={`gr-${i}`}
					box={gr.box}
					color={genericColor(gr.genericType)}
					label={`Generic #${i} type=${GenericRegionType[gr.genericType] ?? gr.genericType}`}
					isSelected={selected?.kind === 'generic' && selected.index === i}
					isHovered={hovered?.kind === 'generic' && hovered.index === i}
					onClick={() => onSelect({ kind: 'generic', index: i })}
					onHover={(h) => onHover(h ? { kind: 'generic', index: i } : null)}
				/>
			))}

			{/* Blackspots */}
			{data.blackspots.map((bs, i) => (
				<RegionBox
					key={`bs-${i}`}
					box={bs.box}
					color={REGION_COLORS.blackspot}
					label={`Blackspot #${i} (score=${bs.scoreAmount})`}
					isSelected={selected?.kind === 'blackspot' && selected.index === i}
					isHovered={hovered?.kind === 'blackspot' && hovered.index === i}
					onClick={() => onSelect({ kind: 'blackspot', index: i })}
					onHover={(h) => onHover(h ? { kind: 'blackspot', index: i } : null)}
				/>
			))}

			{/* VFX regions */}
			{data.vfxBoxRegions.map((vfx, i) => (
				<RegionBox
					key={`vfx-${i}`}
					box={vfx.box}
					color={REGION_COLORS.vfx}
					label={`VFX #${i}`}
					isSelected={selected?.kind === 'vfx' && selected.index === i}
					isHovered={hovered?.kind === 'vfx' && hovered.index === i}
					onClick={() => onSelect({ kind: 'vfx', index: i })}
					onHover={(h) => onHover(h ? { kind: 'vfx', index: i } : null)}
				/>
			))}
		</>
	);
}

// ---------------------------------------------------------------------------
// Spawn arrows (cone + line for direction)
// ---------------------------------------------------------------------------

const coneGeo = new THREE.ConeGeometry(3, 8, 8);
const spawnMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0.2 });
const spawnSelMat = new THREE.MeshStandardMaterial({ color: 0xffaa33, roughness: 0.4, metalness: 0.2, emissive: 0x664400, emissiveIntensity: 0.5 });

function SpawnArrows({
	data, selected, hovered, onSelect, onHover,
}: {
	data: ParsedTriggerData;
	selected: TriggerSelection;
	hovered: TriggerSelection;
	onSelect: (sel: TriggerSelection) => void;
	onHover: (sel: TriggerSelection) => void;
}) {
	return (
		<>
			{data.spawnLocations.map((sp, i) => {
				const pos: [number, number, number] = [sp.position.x, sp.position.y, sp.position.z];
				const isSel = selected?.kind === 'spawn' && selected.index === i;
				const isHov = hovered?.kind === 'spawn' && hovered.index === i;
				const mat = isSel ? spawnSelMat : spawnMat;

				// Direction arrow: line from position in direction
				const dir = new THREE.Vector3(sp.direction.x, sp.direction.y, sp.direction.z);
				if (dir.lengthSq() > 0.001) dir.normalize();
				const arrowEnd: [number, number, number] = [
					sp.position.x + dir.x * 15,
					sp.position.y + dir.y * 15,
					sp.position.z + dir.z * 15,
				];

				return (
					<group key={`spawn-${i}`}>
						<mesh
							geometry={coneGeo}
							material={mat}
							position={pos}
							onClick={(e) => { e.stopPropagation(); onSelect({ kind: 'spawn', index: i }); }}
							onPointerOver={(e) => { e.stopPropagation(); onHover({ kind: 'spawn', index: i }); document.body.style.cursor = 'pointer'; }}
							onPointerOut={(e) => { e.stopPropagation(); onHover(null); document.body.style.cursor = 'auto'; }}
						/>
						<Line points={[pos, arrowEnd]} color={isSel ? '#ffaa33' : '#ffffff'} lineWidth={2} />
						{(isSel || isHov) && (
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
// Roaming location dots
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

	useEffect(() => {
		const mesh = meshRef.current;
		if (!mesh || count === 0) return;
		for (let i = 0; i < count; i++) {
			const rl = data.roamingLocations[i];
			_roamDummy.position.set(rl.position.x, rl.position.y, rl.position.z);
			_roamDummy.updateMatrix();
			mesh.setMatrixAt(i, _roamDummy.matrix);
			const isSel = selected?.kind === 'roaming' && selected.index === i;
			mesh.setColorAt(i, isSel ? ROAM_SEL_COLOR : ROAM_COLOR);
		}
		mesh.instanceMatrix.needsUpdate = true;
		if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
	}, [data.roamingLocations, count, selected]);

	const handleClick = useCallback((e: ThreeEvent<MouseEvent>) => {
		e.stopPropagation();
		if (e.instanceId != null) onSelect({ kind: 'roaming', index: e.instanceId });
	}, [onSelect]);

	if (count === 0) return null;

	return (
		<instancedMesh ref={meshRef} args={[roamGeo, roamMat, count]} onClick={handleClick} />
	);
}

// ---------------------------------------------------------------------------
// Player start arrow (gold)
// ---------------------------------------------------------------------------

const playerMat = new THREE.MeshStandardMaterial({ color: 0xffcc00, roughness: 0.3, metalness: 0.4, emissive: 0x664400, emissiveIntensity: 0.3 });
const playerSelMat = new THREE.MeshStandardMaterial({ color: 0xffaa33, roughness: 0.3, metalness: 0.4, emissive: 0x664400, emissiveIntensity: 0.6 });
const playerConeGeo = new THREE.ConeGeometry(5, 12, 8);

function PlayerStartMarker({
	data, selected, onSelect,
}: {
	data: ParsedTriggerData;
	selected: TriggerSelection;
	onSelect: (sel: TriggerSelection) => void;
}) {
	const pos: [number, number, number] = [
		data.playerStartPosition.x, data.playerStartPosition.y, data.playerStartPosition.z,
	];
	const dir = new THREE.Vector3(
		data.playerStartDirection.x, data.playerStartDirection.y, data.playerStartDirection.z,
	);
	if (dir.lengthSq() > 0.001) dir.normalize();
	const arrowEnd: [number, number, number] = [
		pos[0] + dir.x * 25, pos[1] + dir.y * 25, pos[2] + dir.z * 25,
	];
	const isSel = selected?.kind === 'playerStart';

	return (
		<group>
			<mesh
				geometry={playerConeGeo}
				material={isSel ? playerSelMat : playerMat}
				position={pos}
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

	return (
		<div style={{ height: '45vh', background: '#1a1d23', borderRadius: 8, minWidth: 0 }}>
			<Canvas
				camera={{
					position: [center.x + camDistance * 0.7, center.y + camDistance, center.z + camDistance * 0.7],
					fov: 45,
					near: 0.1,
					far: Math.max(camDistance * 20, 5000),
				}}
				gl={{ antialias: true }}
				onPointerMissed={() => onSelect(null)}
			>
				<color attach="background" args={['#1a1d23']} />
				<AutoFit center={center} radius={radius} />
				<ambientLight intensity={0.5} />
				<hemisphereLight args={['#b1c8e8', '#4a3f2f', 0.3]} />
				<directionalLight position={[10, 20, 5]} intensity={0.9} />
				<directionalLight position={[-8, 15, -10]} intensity={0.4} />
				<Grid
					position={[center.x, center.y - radius, center.z]}
					args={[Math.max(radius * 4, 200), Math.max(radius * 4, 200)]}
					cellSize={50}
					cellThickness={0.5}
					sectionSize={200}
					sectionThickness={1}
					fadeDistance={camDistance * 4}
					infiniteGrid
				/>
				<RegionBoxes data={data} selected={selected} hovered={hovered} onSelect={onSelect} onHover={setHovered} />
				<SpawnArrows data={data} selected={selected} hovered={hovered} onSelect={onSelect} onHover={setHovered} />
				<RoamingDots data={data} selected={selected} onSelect={onSelect} />
				<PlayerStartMarker data={data} selected={selected} onSelect={onSelect} />
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

export default TriggerDataViewport;
