// 3D viewport for TrafficData — renders ALL hulls simultaneously.
// Active hull is bright (speed-colored), inactive hulls are dimmed.
// Clicking any hull's geometry selects that hull + sub-item, which
// filters the table tabs below.
//
// PERFORMANCE: Batches all 60k+ rungs across all hulls into TWO
// LineSegments draw calls (rungs + lane connections). Junctions,
// triggers, and static vehicles use InstancedMesh with global
// instance-to-hull mappings for picking.

import { useEffect, useMemo, useRef, useCallback } from 'react';
import { Canvas, useThree, ThreeEvent } from '@react-three/fiber';
import { OrbitControls, Html } from '@react-three/drei';
import * as THREE from 'three';
import type { ParsedTrafficData, TrafficHull } from '@/lib/core/trafficData';
import type { TrafficDataSelection } from './useTrafficSelection';
import { buildRungToSectionMap, speedToRGB } from './constants';

type Props = {
	data: ParsedTrafficData;
	activeHullIndex: number;
	selected: TrafficDataSelection;
	onSelect: (sel: TrafficDataSelection) => void;
	activeTab: string;
};

// ---------------------------------------------------------------------------
// Scene bounds (all hulls)
// ---------------------------------------------------------------------------

function computeAllBounds(hulls: TrafficHull[]): { center: THREE.Vector3; radius: number } {
	const box = new THREE.Box3();
	let hasPoints = false;
	for (const hull of hulls) {
		for (const rung of hull.rungs) {
			for (const pt of rung.maPoints) {
				box.expandByPoint(new THREE.Vector3(pt.x, pt.y, pt.z));
				hasPoints = true;
			}
		}
	}
	if (!hasPoints) return { center: new THREE.Vector3(), radius: 100 };
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
		const d = radius * 1.5;
		camera.position.set(center.x, d, center.z + d * 0.3);
		camera.lookAt(center);
	}, [camera, center, radius]);
	return null;
}

// ---------------------------------------------------------------------------
// Batched rung lines for ALL hulls (one draw call)
// ---------------------------------------------------------------------------

type AllRungBatch = {
	geometry: THREE.BufferGeometry;
	/** For each line segment: [hullIndex, sectionIndexWithinHull] */
	segToHullSection: Int32Array; // interleaved: [hull0, sec0, hull1, sec1, ...]
};

function buildAllRungLines(hulls: TrafficHull[], activeHullIndex: number): AllRungBatch {
	let totalRungs = 0;
	for (const hull of hulls) totalRungs += hull.rungs.length;

	const positions = new Float32Array(totalRungs * 2 * 3);
	const colors = new Float32Array(totalRungs * 2 * 3);
	const segToHullSection = new Int32Array(totalRungs * 2); // pairs

	let seg = 0;
	for (let hi = 0; hi < hulls.length; hi++) {
		const hull = hulls[hi];
		if (hull.rungs.length === 0) continue;
		const rungToSection = buildRungToSectionMap(hull);
		const isActive = hi === activeHullIndex;

		for (let i = 0; i < hull.rungs.length; i++) {
			const rung = hull.rungs[i];
			const a = rung.maPoints[0];
			const b = rung.maPoints[1];

			const si = rungToSection[i];
			const sec = si >= 0 ? hull.sections[si] : null;

			let rgb: [number, number, number];
			if (isActive) {
				rgb = sec ? speedToRGB(sec.mfSpeed) : [0.4, 0.4, 0.4];
			} else {
				// Dim inactive hulls
				rgb = [0.25, 0.28, 0.35];
			}

			const off = seg * 6;
			positions[off] = a.x; positions[off + 1] = a.y; positions[off + 2] = a.z;
			positions[off + 3] = b.x; positions[off + 4] = b.y; positions[off + 5] = b.z;
			colors[off] = rgb[0]; colors[off + 1] = rgb[1]; colors[off + 2] = rgb[2];
			colors[off + 3] = rgb[0]; colors[off + 4] = rgb[1]; colors[off + 5] = rgb[2];

			segToHullSection[seg * 2] = hi;
			segToHullSection[seg * 2 + 1] = si;
			seg++;
		}
	}

	const geo = new THREE.BufferGeometry();
	geo.setAttribute('position', new THREE.BufferAttribute(positions.subarray(0, seg * 6), 3));
	geo.setAttribute('color', new THREE.BufferAttribute(colors.subarray(0, seg * 6), 3));
	geo.computeBoundingSphere();

	return { geometry: geo, segToHullSection: segToHullSection.subarray(0, seg * 2) };
}

const rungMaterial = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85 });

function AllRungLines({
	hulls, activeHullIndex,
}: {
	hulls: TrafficHull[];
	activeHullIndex: number;
}) {
	const batch = useMemo(() => buildAllRungLines(hulls, activeHullIndex), [hulls, activeHullIndex]);

	return (
		<lineSegments
			geometry={batch.geometry}
			material={rungMaterial}
		/>
	);
}

// ---------------------------------------------------------------------------
// Invisible picking plane — catches clicks in empty space and finds the
// nearest rung midpoint. Precomputes a flat Float32Array of midpoints
// + a parallel Int32Array of (hullIndex, sectionIndex) for O(n) lookup.
// ---------------------------------------------------------------------------

type PickingIndex = {
	midpoints: Float32Array;  // x,y,z triples
	hullSection: Int32Array;  // hullIndex, sectionIndex pairs
	count: number;
};

function buildPickingIndex(hulls: TrafficHull[]): PickingIndex {
	let total = 0;
	for (const h of hulls) total += h.rungs.length;

	const midpoints = new Float32Array(total * 3);
	const hullSection = new Int32Array(total * 2);
	let idx = 0;

	for (let hi = 0; hi < hulls.length; hi++) {
		const hull = hulls[hi];
		if (hull.rungs.length === 0) continue;
		const rungToSection = buildRungToSectionMap(hull);
		for (let ri = 0; ri < hull.rungs.length; ri++) {
			const a = hull.rungs[ri].maPoints[0];
			const b = hull.rungs[ri].maPoints[1];
			midpoints[idx * 3] = (a.x + b.x) / 2;
			midpoints[idx * 3 + 1] = (a.y + b.y) / 2;
			midpoints[idx * 3 + 2] = (a.z + b.z) / 2;
			hullSection[idx * 2] = hi;
			hullSection[idx * 2 + 1] = rungToSection[ri];
			idx++;
		}
	}

	return { midpoints: midpoints.subarray(0, idx * 3), hullSection: hullSection.subarray(0, idx * 2), count: idx };
}

const pickPlaneMat = new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide });

function PickingPlane({
	hulls, center, radius, onSelect,
}: {
	hulls: TrafficHull[];
	center: THREE.Vector3;
	radius: number;
	onSelect: (sel: TrafficDataSelection) => void;
}) {
	const index = useMemo(() => buildPickingIndex(hulls), [hulls]);

	const handleClick = useCallback((e: ThreeEvent<MouseEvent>) => {
		e.stopPropagation();
		const px = e.point.x, py = e.point.y, pz = e.point.z;
		let bestDist = Infinity;
		let bestIdx = -1;
		for (let i = 0; i < index.count; i++) {
			const dx = px - index.midpoints[i * 3];
			const dy = py - index.midpoints[i * 3 + 1];
			const dz = pz - index.midpoints[i * 3 + 2];
			const d = dx * dx + dy * dy + dz * dz;
			if (d < bestDist) { bestDist = d; bestIdx = i; }
		}
		if (bestIdx >= 0) {
			const hi = index.hullSection[bestIdx * 2];
			const si = index.hullSection[bestIdx * 2 + 1];
			if (si >= 0) {
				onSelect({ hullIndex: hi, sub: { type: 'section', index: si } });
			} else {
				onSelect({ hullIndex: hi });
			}
		}
	}, [index, onSelect]);

	// Large plane at y=0 spanning the entire scene
	const size = radius * 3;
	return (
		<mesh
			position={[center.x, 0, center.z]}
			rotation={[-Math.PI / 2, 0, 0]}
			material={pickPlaneMat}
			onClick={handleClick}
		>
			<planeGeometry args={[size, size]} />
		</mesh>
	);
}

// ---------------------------------------------------------------------------
// Batched lane connection lines for ALL hulls (one draw call)
// ---------------------------------------------------------------------------

function buildAllLaneConnections(hulls: TrafficHull[], activeHullIndex: number): THREE.BufferGeometry {
	let totalSegs = 0;
	for (const hull of hulls) {
		for (const sec of hull.sections) {
			if (sec.muNumRungs > 1) totalSegs += (sec.muNumRungs - 1) * 2;
		}
	}

	const positions = new Float32Array(totalSegs * 2 * 3);
	const colors = new Float32Array(totalSegs * 2 * 3);
	let off = 0;
	let cOff = 0;

	for (let hi = 0; hi < hulls.length; hi++) {
		const hull = hulls[hi];
		const isActive = hi === activeHullIndex;
		const rgb: [number, number, number] = isActive ? [0.33, 0.33, 0.33] : [0.15, 0.16, 0.2];

		for (const sec of hull.sections) {
			for (let r = 0; r < sec.muNumRungs - 1; r++) {
				const ri = sec.muRungOffset + r;
				const rn = ri + 1;
				if (ri >= hull.rungs.length || rn >= hull.rungs.length) continue;

				const curA = hull.rungs[ri].maPoints[0];
				const nextA = hull.rungs[rn].maPoints[0];
				positions[off++] = curA.x; positions[off++] = curA.y; positions[off++] = curA.z;
				positions[off++] = nextA.x; positions[off++] = nextA.y; positions[off++] = nextA.z;
				colors[cOff++] = rgb[0]; colors[cOff++] = rgb[1]; colors[cOff++] = rgb[2];
				colors[cOff++] = rgb[0]; colors[cOff++] = rgb[1]; colors[cOff++] = rgb[2];

				const curB = hull.rungs[ri].maPoints[1];
				const nextB = hull.rungs[rn].maPoints[1];
				positions[off++] = curB.x; positions[off++] = curB.y; positions[off++] = curB.z;
				positions[off++] = nextB.x; positions[off++] = nextB.y; positions[off++] = nextB.z;
				colors[cOff++] = rgb[0]; colors[cOff++] = rgb[1]; colors[cOff++] = rgb[2];
				colors[cOff++] = rgb[0]; colors[cOff++] = rgb[1]; colors[cOff++] = rgb[2];
			}
		}
	}

	const geo = new THREE.BufferGeometry();
	geo.setAttribute('position', new THREE.BufferAttribute(positions.subarray(0, off), 3));
	geo.setAttribute('color', new THREE.BufferAttribute(colors.subarray(0, cOff), 3));
	geo.computeBoundingSphere();
	return geo;
}

const laneConnMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.35 });

function AllLaneConnections({ hulls, activeHullIndex }: { hulls: TrafficHull[]; activeHullIndex: number }) {
	const geo = useMemo(() => buildAllLaneConnections(hulls, activeHullIndex), [hulls, activeHullIndex]);
	return <lineSegments geometry={geo} material={laneConnMat} />;
}

// ---------------------------------------------------------------------------
// Section highlight (rungs belonging to selected section in active hull)
// ---------------------------------------------------------------------------

function SectionHighlight({ hull, sectionIndex }: { hull: TrafficHull; sectionIndex: number }) {
	const sec = hull.sections[sectionIndex];
	if (!sec) return null;

	const geo = useMemo(() => {
		const count = sec.muNumRungs;
		const positions = new Float32Array(count * 2 * 3);
		for (let r = 0; r < count; r++) {
			const ri = sec.muRungOffset + r;
			if (ri >= hull.rungs.length) continue;
			const rung = hull.rungs[ri];
			const off = r * 6;
			positions[off] = rung.maPoints[0].x; positions[off + 1] = rung.maPoints[0].y + 0.2; positions[off + 2] = rung.maPoints[0].z;
			positions[off + 3] = rung.maPoints[1].x; positions[off + 4] = rung.maPoints[1].y + 0.2; positions[off + 5] = rung.maPoints[1].z;
		}
		const g = new THREE.BufferGeometry();
		g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
		g.computeBoundingSphere();
		return g;
	}, [hull, sec, sectionIndex]);

	return (
		<lineSegments geometry={geo}>
			<lineBasicMaterial color={0xffaa33} linewidth={2} />
		</lineSegments>
	);
}

// ---------------------------------------------------------------------------
// All junctions across all hulls (single InstancedMesh)
// ---------------------------------------------------------------------------

const junctionGeo = new THREE.OctahedronGeometry(4);
const junctionMat = new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.2 });

type InstanceMapping = { hullIndex: number; localIndex: number }[];

function AllJunctionInstances({
	hulls, activeHullIndex, selected, onSelect,
}: {
	hulls: TrafficHull[];
	activeHullIndex: number;
	selected: TrafficDataSelection;
	onSelect: (sel: TrafficDataSelection) => void;
}) {
	const meshRef = useRef<THREE.InstancedMesh>(null!);

	let totalCount = 0;
	for (const h of hulls) totalCount += h.junctions.length;

	const mapping = useMemo<InstanceMapping>(() => {
		const m: InstanceMapping = [];
		for (let hi = 0; hi < hulls.length; hi++) {
			for (let ji = 0; ji < hulls[hi].junctions.length; ji++) {
				m.push({ hullIndex: hi, localIndex: ji });
			}
		}
		return m;
	}, [hulls]);

	const dummy = useMemo(() => new THREE.Object3D(), []);
	const activeColor = new THREE.Color(0xeecc33);
	const inactiveColor = new THREE.Color(0x555544);
	const selectedColor = new THREE.Color(0xffaa33);

	useMemo(() => {
		if (!meshRef.current || totalCount === 0) return;
		const mesh = meshRef.current;
		for (let i = 0; i < mapping.length; i++) {
			const { hullIndex, localIndex } = mapping[i];
			const j = hulls[hullIndex].junctions[localIndex];
			dummy.position.set(j.mPosition.x, j.mPosition.y, j.mPosition.z);
			dummy.updateMatrix();
			mesh.setMatrixAt(i, dummy.matrix);

			const isSel = selected?.hullIndex === hullIndex && selected.sub?.type === 'junction' && selected.sub.index === localIndex;
			const color = isSel ? selectedColor : (hullIndex === activeHullIndex ? activeColor : inactiveColor);
			mesh.setColorAt(i, color);
		}
		mesh.instanceMatrix.needsUpdate = true;
		if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
	}, [hulls, mapping, totalCount, dummy, activeHullIndex, selected, activeColor, inactiveColor, selectedColor]);

	const handleClick = useCallback((e: ThreeEvent<MouseEvent>) => {
		e.stopPropagation();
		if (e.instanceId != null && e.instanceId < mapping.length) {
			const { hullIndex, localIndex } = mapping[e.instanceId];
			onSelect({ hullIndex, sub: { type: 'junction', index: localIndex } });
		}
	}, [mapping, onSelect]);

	if (totalCount === 0) return null;

	return (
		<instancedMesh
			ref={meshRef}
			args={[junctionGeo, junctionMat, totalCount]}
			onClick={handleClick}
		/>
	);
}

// ---------------------------------------------------------------------------
// All light trigger volumes across all hulls (single InstancedMesh)
// ---------------------------------------------------------------------------

const triggerGeo = new THREE.BoxGeometry(1, 1, 1);
const triggerMat = new THREE.MeshBasicMaterial({ color: 0x33cccc, wireframe: true, transparent: true, opacity: 0.6 });

function AllLightTriggerInstances({
	hulls, activeHullIndex, onSelect,
}: {
	hulls: TrafficHull[];
	activeHullIndex: number;
	onSelect: (sel: TrafficDataSelection) => void;
}) {
	const meshRef = useRef<THREE.InstancedMesh>(null!);

	let totalCount = 0;
	for (const h of hulls) totalCount += h.lightTriggers.length;

	const mapping = useMemo<InstanceMapping>(() => {
		const m: InstanceMapping = [];
		for (let hi = 0; hi < hulls.length; hi++) {
			for (let li = 0; li < hulls[hi].lightTriggers.length; li++) {
				m.push({ hullIndex: hi, localIndex: li });
			}
		}
		return m;
	}, [hulls]);

	const dummy = useMemo(() => new THREE.Object3D(), []);

	useMemo(() => {
		if (!meshRef.current || totalCount === 0) return;
		const mesh = meshRef.current;
		for (let i = 0; i < mapping.length; i++) {
			const { hullIndex, localIndex } = mapping[i];
			const lt = hulls[hullIndex].lightTriggers[localIndex];
			dummy.position.set(lt.mPosPlusYRot.x, lt.mPosPlusYRot.y, lt.mPosPlusYRot.z);
			dummy.rotation.set(0, lt.mPosPlusYRot.w, 0);
			dummy.scale.set(lt.mDimensions.x * 2, lt.mDimensions.y * 2, lt.mDimensions.z * 2);
			dummy.updateMatrix();
			mesh.setMatrixAt(i, dummy.matrix);
		}
		mesh.instanceMatrix.needsUpdate = true;
	}, [hulls, mapping, totalCount, dummy]);

	const handleClick = useCallback((e: ThreeEvent<MouseEvent>) => {
		e.stopPropagation();
		if (e.instanceId != null && e.instanceId < mapping.length) {
			const { hullIndex, localIndex } = mapping[e.instanceId];
			onSelect({ hullIndex, sub: { type: 'lightTrigger', index: localIndex } });
		}
	}, [mapping, onSelect]);

	if (totalCount === 0) return null;

	return (
		<instancedMesh
			ref={meshRef}
			args={[triggerGeo, triggerMat, totalCount]}
			onClick={handleClick}
		/>
	);
}

// ---------------------------------------------------------------------------
// All static vehicles across all hulls (single InstancedMesh)
// ---------------------------------------------------------------------------

const vehicleGeo = new THREE.BoxGeometry(3, 2, 5);
const vehicleMat = new THREE.MeshStandardMaterial({ color: 0xcc6633, roughness: 0.6, metalness: 0.1 });

function AllStaticVehicleInstances({
	hulls, onSelect,
}: {
	hulls: TrafficHull[];
	onSelect: (sel: TrafficDataSelection) => void;
}) {
	const meshRef = useRef<THREE.InstancedMesh>(null!);

	let totalCount = 0;
	for (const h of hulls) totalCount += h.staticTrafficVehicles.length;

	const mapping = useMemo<InstanceMapping>(() => {
		const m: InstanceMapping = [];
		for (let hi = 0; hi < hulls.length; hi++) {
			for (let vi = 0; vi < hulls[hi].staticTrafficVehicles.length; vi++) {
				m.push({ hullIndex: hi, localIndex: vi });
			}
		}
		return m;
	}, [hulls]);

	useMemo(() => {
		if (!meshRef.current || totalCount === 0) return;
		const mesh = meshRef.current;
		const mat = new THREE.Matrix4();
		for (let i = 0; i < mapping.length; i++) {
			const { hullIndex, localIndex } = mapping[i];
			const sv = hulls[hullIndex].staticTrafficVehicles[localIndex];
			// mTransform is an RwMatrix: four rows of (Vec3 + 4-byte pad),
			// translation at [12..14]. That layout is column-major from
			// THREE's perspective, so fromArray maps it directly — elements
			// [12..14] become THREE's translation column. We then patch the
			// bottom row to [0,0,0,1] because the pad slots ([3],[7],[11],
			// [15]) are zero in the source, which would give a degenerate
			// w on the homogeneous multiply.
			mat.fromArray(sv.mTransform);
			const e = mat.elements;
			e[3] = 0; e[7] = 0; e[11] = 0; e[15] = 1;
			mesh.setMatrixAt(i, mat);
		}
		mesh.instanceMatrix.needsUpdate = true;
	}, [hulls, mapping, totalCount]);

	const handleClick = useCallback((e: ThreeEvent<MouseEvent>) => {
		e.stopPropagation();
		if (e.instanceId != null && e.instanceId < mapping.length) {
			const { hullIndex, localIndex } = mapping[e.instanceId];
			onSelect({ hullIndex, sub: { type: 'staticVehicle', index: localIndex } });
		}
	}, [mapping, onSelect]);

	if (totalCount === 0) return null;

	return (
		<instancedMesh
			ref={meshRef}
			args={[vehicleGeo, vehicleMat, totalCount]}
			onClick={handleClick}
		/>
	);
}

// ---------------------------------------------------------------------------
// Traffic lights (global, shown when lights tab active)
// ---------------------------------------------------------------------------

const lightGeo = new THREE.SphereGeometry(2, 12, 8);
const lightMat = new THREE.MeshStandardMaterial({ color: 0x44ff44, roughness: 0.3, metalness: 0.3, emissive: 0x114411, emissiveIntensity: 0.5 });

function TrafficLightInstances({ data }: { data: ParsedTrafficData }) {
	const meshRef = useRef<THREE.InstancedMesh>(null!);
	const tl = data.trafficLights;
	const count = tl.posAndYRotations.length;

	const dummy = useMemo(() => new THREE.Object3D(), []);

	useMemo(() => {
		if (!meshRef.current || count === 0) return;
		const mesh = meshRef.current;
		for (let i = 0; i < count; i++) {
			const p = tl.posAndYRotations[i];
			dummy.position.set(p.x, p.y, p.z);
			dummy.updateMatrix();
			mesh.setMatrixAt(i, dummy.matrix);
		}
		mesh.instanceMatrix.needsUpdate = true;
	}, [tl.posAndYRotations, count, dummy]);

	if (count === 0) return null;

	return (
		<instancedMesh
			ref={meshRef}
			args={[lightGeo, lightMat, count]}
		/>
	);
}

// ---------------------------------------------------------------------------
// Selection label
// ---------------------------------------------------------------------------

function SelectionLabel({ hulls, selected }: { hulls: TrafficHull[]; selected: TrafficDataSelection }) {
	if (!selected?.sub) return null;
	const hull = hulls[selected.hullIndex];
	if (!hull) return null;

	let pos: [number, number, number] | null = null;
	let label = '';

	if (selected.sub.type === 'section') {
		const sec = hull.sections[selected.sub.index];
		if (sec && sec.muNumRungs > 0) {
			const midRung = hull.rungs[sec.muRungOffset + Math.floor(sec.muNumRungs / 2)];
			if (midRung) {
				const a = midRung.maPoints[0], b = midRung.maPoints[1];
				pos = [(a.x + b.x) / 2, (a.y + b.y) / 2 + 5, (a.z + b.z) / 2];
			}
		}
		label = `Hull ${selected.hullIndex} | Section ${selected.sub.index} | Speed: ${sec?.mfSpeed.toFixed(1)} | ${sec?.muNumRungs} rungs`;
	} else if (selected.sub.type === 'junction') {
		const j = hull.junctions[selected.sub.index];
		if (j) {
			pos = [j.mPosition.x, j.mPosition.y + 8, j.mPosition.z];
			label = `Hull ${selected.hullIndex} | Junction ${selected.sub.index} | ID: ${j.muID} | ${j.muNumStates} states`;
		}
	}

	if (!pos) return null;

	return (
		<Html position={pos} center distanceFactor={200} style={{ pointerEvents: 'none' }}>
			<div style={{
				background: 'rgba(0,0,0,0.8)', color: '#ffaa33', padding: '2px 6px',
				borderRadius: 4, fontSize: 10, whiteSpace: 'nowrap', fontFamily: 'monospace',
			}}>
				{label}
			</div>
		</Html>
	);
}

// ---------------------------------------------------------------------------
// Main viewport component
// ---------------------------------------------------------------------------

export const TrafficDataViewport: React.FC<Props> = ({ data, activeHullIndex, selected, onSelect, activeTab }) => {
	const hulls = data.hulls;
	if (hulls.length === 0) return <div className="h-[45vh] flex items-center justify-center text-muted-foreground">No hull data</div>;

	const { center, radius } = useMemo(() => computeAllBounds(hulls), [hulls]);
	const camDistance = radius * 1.5;

	const selectedHull = selected ? hulls[selected.hullIndex] : null;
	const selectedSectionIndex = selected?.sub?.type === 'section' ? selected.sub.index : -1;

	return (
		<div style={{ height: '45vh', background: '#1a1d23', borderRadius: 8, minWidth: 0 }}>
			<Canvas
				camera={{
					position: [center.x, camDistance, center.z + camDistance * 0.3],
					fov: 45,
					near: 0.1,
					far: Math.max(camDistance * 20, 50000),
				}}
				gl={{ antialias: true, logarithmicDepthBuffer: true }}
				onPointerMissed={() => { /* deselect only on clicks outside the canvas */ }}
			>
				<color attach="background" args={['#1a1d23']} />
				<AutoFit center={center} radius={radius} />
				<ambientLight intensity={0.5} />
				<hemisphereLight args={['#b1c8e8', '#4a3f2f', 0.4]} />
				<directionalLight position={[10, 20, 5]} intensity={0.9} />
				<directionalLight position={[-8, 15, -10]} intensity={0.4} />

				{/* Invisible picking plane — catches clicks anywhere and finds nearest rung */}
				<PickingPlane hulls={hulls} center={center} radius={radius} onSelect={onSelect} />

				{/* All lane connections (dim background lines) */}
				<AllLaneConnections hulls={hulls} activeHullIndex={activeHullIndex} />

				{/* All rung lines (active hull bright, others dimmed) */}
				<AllRungLines hulls={hulls} activeHullIndex={activeHullIndex} />

				{/* Section highlight for selected section */}
				{selectedHull && selectedSectionIndex >= 0 && (
					<SectionHighlight hull={selectedHull} sectionIndex={selectedSectionIndex} />
				)}

				{/* All junction markers */}
				<AllJunctionInstances
					hulls={hulls}
					activeHullIndex={activeHullIndex}
					selected={selected}
					onSelect={onSelect}
				/>

				{/* All light trigger volumes */}
				<AllLightTriggerInstances
					hulls={hulls}
					activeHullIndex={activeHullIndex}
					onSelect={onSelect}
				/>

				{/* All static vehicles */}
				<AllStaticVehicleInstances
					hulls={hulls}
					onSelect={onSelect}
				/>

				{/* Traffic lights (only on lights tab) */}
				{activeTab === 'lights' && (
					<TrafficLightInstances data={data} />
				)}

				{/* Selection label */}
				<SelectionLabel hulls={hulls} selected={selected} />

				<OrbitControls
					target={[center.x, 0, center.z]}
					enableDamping
					dampingFactor={0.1}
					makeDefault
				/>
			</Canvas>
		</div>
	);
};
