// 3D viewport for TrafficData — renders ALL hulls simultaneously.
// Active hull is bright (speed-colored), inactive hulls are dimmed.
// Clicking any hull's geometry selects that hull + sub-item, which
// filters the table tabs below.
//
// PERFORMANCE: Batches all 60k+ rungs across all hulls into TWO
// LineSegments draw calls (rungs + lane connections). Junctions,
// triggers, and static vehicles use InstancedMesh with global
// instance-to-hull mappings for picking.

import { useEffect, useMemo, useRef, useCallback, useState } from 'react';
import { Canvas, useThree, ThreeEvent } from '@react-three/fiber';
import { OrbitControls, Html } from '@react-three/drei';
import * as THREE from 'three';
import type { ParsedTrafficData, TrafficHull, TrafficPvs } from '@/lib/core/trafficData';
import {
	isPvsCellSelection,
	type TrafficDataSelection,
} from './useTrafficSelection';
import { buildRungToSectionMap, speedToRGB } from './constants';
import { CameraBridge, type CameraBridgeData } from '@/components/common/three/CameraBridge';
import { MarqueeSelector } from '@/components/common/three/MarqueeSelector';
import { useSchemaBulkSelection } from '@/components/schema-editor/bulkSelectionContext';
import type { NodePath } from '@/lib/schema/walk';

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

export function computeAllBounds(hulls: TrafficHull[]): { center: THREE.Vector3; radius: number } {
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

// When the selection changes to a static vehicle, fly the camera over so the
// highlighted box is actually on-screen. Without this, clicking a vehicle in
// the list leaves the viewport wherever it was last aimed and you never see
// the highlight. Only reacts to staticVehicle selections so browsing other
// sub-types (sections, junctions, etc.) doesn't move the camera.
export function FocusOnVehicle({ hulls, selected }: { hulls: TrafficHull[]; selected: TrafficDataSelection }) {
	const { camera, controls } = useThree() as { camera: THREE.Camera; controls: { target: THREE.Vector3; update: () => void } | null };
	useEffect(() => {
		if (selected?.sub?.type !== 'staticVehicle') return;
		const hull = hulls[selected.hullIndex];
		const sv = hull?.staticTrafficVehicles[selected.sub.index];
		if (!sv) return;
		// Translation at mT[12..14] (RwMatrix layout).
		const target = new THREE.Vector3(sv.mTransform[12], sv.mTransform[13], sv.mTransform[14]);
		// Pull camera back along its existing view direction so we keep the
		// user's current angle rather than jump-cutting. 60 units is ~10 car
		// lengths — close enough to see the selection scaling and the label.
		const dir = new THREE.Vector3().subVectors(camera.position, controls?.target ?? target).normalize();
		camera.position.copy(target).addScaledVector(dir, 60);
		if (controls) {
			controls.target.copy(target);
			controls.update();
		} else {
			camera.lookAt(target);
		}
	}, [hulls, selected, camera, controls]);
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

export function AllRungLines({
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

export function PickingPlane({
	hulls, center, radius, onSelect, pvs, pvsActive, onHoverCell,
}: {
	hulls: TrafficHull[];
	center: THREE.Vector3;
	radius: number;
	onSelect: (sel: TrafficDataSelection) => void;
	// PVS routing: when a click on the ground plane lands far from any rung
	// AND the grid is enabled, the click resolves to a PVS cell instead of
	// a hull. Hover events likewise produce a cell index for the tooltip.
	// Without these, clicks in open ocean / off-grid areas would select the
	// nearest hull — which is exactly what people don't want when they're
	// trying to inspect cell membership.
	pvs: TrafficPvs | null;
	pvsActive: boolean;
	onHoverCell: (cellIndex: number | null, world: THREE.Vector3 | null) => void;
}) {
	const index = useMemo(() => buildPickingIndex(hulls), [hulls]);

	// "Snap to road" radius — clicks closer than this to any rung midpoint
	// pick the hull/section; clicks farther away fall through to PVS cell
	// pick when the grid is on. 60 game-units is roughly half a road width
	// in Paradise scale, which keeps road clicks reliable without making
	// open patches between road segments unreachable.
	const RUNG_SNAP_DIST_SQ = 60 * 60;

	const findNearestRung = useCallback((px: number, py: number, pz: number) => {
		let bestDist = Infinity;
		let bestIdx = -1;
		for (let i = 0; i < index.count; i++) {
			const dx = px - index.midpoints[i * 3];
			const dy = py - index.midpoints[i * 3 + 1];
			const dz = pz - index.midpoints[i * 3 + 2];
			const d = dx * dx + dy * dy + dz * dz;
			if (d < bestDist) { bestDist = d; bestIdx = i; }
		}
		return { idx: bestIdx, distSq: bestDist };
	}, [index]);

	const handleClick = useCallback((e: ThreeEvent<MouseEvent>) => {
		e.stopPropagation();
		const { idx: bestIdx, distSq } = findNearestRung(e.point.x, e.point.y, e.point.z);
		// PVS cell wins when the grid is on AND the click is in open space.
		if (pvsActive && pvs && distSq > RUNG_SNAP_DIST_SQ) {
			const cellIdx = cellAt(pvs, e.point.x, e.point.z);
			if (cellIdx >= 0) {
				onSelect({ kind: 'pvsCell', cellIndex: cellIdx });
				return;
			}
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
	}, [findNearestRung, index, onSelect, pvs, pvsActive]);

	// Hover updates the PVS tooltip — only meaningful when the grid is on.
	const handlePointerMove = useCallback((e: ThreeEvent<PointerEvent>) => {
		if (!pvsActive || !pvs) {
			onHoverCell(null, null);
			return;
		}
		const idx = cellAt(pvs, e.point.x, e.point.z);
		onHoverCell(idx >= 0 ? idx : null, idx >= 0 ? e.point.clone() : null);
	}, [pvs, pvsActive, onHoverCell]);

	const handlePointerOut = useCallback(() => onHoverCell(null, null), [onHoverCell]);

	// Large plane at y=0 spanning the entire scene
	const size = radius * 3;
	return (
		<mesh
			position={[center.x, 0, center.z]}
			rotation={[-Math.PI / 2, 0, 0]}
			material={pickPlaneMat}
			onClick={handleClick}
			onPointerMove={handlePointerMove}
			onPointerOut={handlePointerOut}
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

export function AllLaneConnections({ hulls, activeHullIndex }: { hulls: TrafficHull[]; activeHullIndex: number }) {
	const geo = useMemo(() => buildAllLaneConnections(hulls, activeHullIndex), [hulls, activeHullIndex]);
	return <lineSegments geometry={geo} material={laneConnMat} />;
}

// ---------------------------------------------------------------------------
// Section highlight (rungs belonging to selected section in active hull)
// ---------------------------------------------------------------------------

export function SectionHighlight({ hull, sectionIndex }: { hull: TrafficHull; sectionIndex: number }) {
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

export function AllJunctionInstances({
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

export function AllLightTriggerInstances({
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
// White material so per-instance colors (setColorAt) render without tinting.
const vehicleMat = new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.1 });

const vehicleActiveColor = new THREE.Color(0xcc6633);
const vehicleInactiveColor = new THREE.Color(0x554433);
const vehicleSelectedColor = new THREE.Color(0xffee33);

// Edge outline used on the currently-selected vehicle only. Drawn with
// depthTest off so the border is visible even when the box is coincident
// with or behind the road geometry. Colour contrasts with the selected
// fill (yellow) so the outline actually reads as an outline.
const vehicleEdgesGeo = new THREE.EdgesGeometry(vehicleGeo);
const vehicleEdgesMat = new THREE.LineBasicMaterial({
	color: 0xffffff,
	depthTest: false,
	transparent: true,
});

export function AllStaticVehicleInstances({
	hulls, activeHullIndex, selected, onSelect,
}: {
	hulls: TrafficHull[];
	activeHullIndex: number;
	selected: TrafficDataSelection;
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

	// useEffect (not useMemo) so the ref is guaranteed attached. useMemo runs
	// during render, before commit, so meshRef.current is null on the initial
	// render and the early-return skips writing matrices/colors entirely —
	// leaving every vehicle parked at origin with the default white.
	useEffect(() => {
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

			const isSel =
				selected?.hullIndex === hullIndex &&
				selected.sub?.type === 'staticVehicle' &&
				selected.sub.index === localIndex;
			mesh.setMatrixAt(i, mat);

			const color = isSel
				? vehicleSelectedColor
				: hullIndex === activeHullIndex
					? vehicleActiveColor
					: vehicleInactiveColor;
			mesh.setColorAt(i, color);
		}
		mesh.instanceMatrix.needsUpdate = true;
		if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
	}, [hulls, mapping, totalCount, activeHullIndex, selected]);

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

// Colored wireframe outline drawn on top of the currently-selected static
// vehicle. Keeps the car at its true 3×2×5 footprint while still making the
// selection pop against the map (coloured fill + depth-test-off border).
export function SelectedVehicleOutline({ hulls, selected }: { hulls: TrafficHull[]; selected: TrafficDataSelection }) {
	const lineRef = useRef<THREE.LineSegments>(null!);

	const matrix = useMemo(() => {
		if (selected?.sub?.type !== 'staticVehicle') return null;
		const sv = hulls[selected.hullIndex]?.staticTrafficVehicles[selected.sub.index];
		if (!sv) return null;
		const mat = new THREE.Matrix4().fromArray(sv.mTransform);
		const e = mat.elements;
		e[3] = 0; e[7] = 0; e[11] = 0; e[15] = 1;
		return mat;
	}, [hulls, selected]);

	useEffect(() => {
		if (!lineRef.current || !matrix) return;
		lineRef.current.matrix.copy(matrix);
		lineRef.current.matrixAutoUpdate = false;
		lineRef.current.updateMatrixWorld(true);
	}, [matrix]);

	if (!matrix) return null;
	return (
		<lineSegments
			ref={lineRef}
			geometry={vehicleEdgesGeo}
			material={vehicleEdgesMat}
			renderOrder={10}
		/>
	);
}

// ---------------------------------------------------------------------------
// Traffic lights (global, shown when lights tab active)
// ---------------------------------------------------------------------------

const lightGeo = new THREE.SphereGeometry(2, 12, 8);
const lightMat = new THREE.MeshStandardMaterial({ color: 0x44ff44, roughness: 0.3, metalness: 0.3, emissive: 0x114411, emissiveIntensity: 0.5 });

export function TrafficLightInstances({ data }: { data: ParsedTrafficData }) {
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

export function SelectionLabel({ hulls, selected }: { hulls: TrafficHull[]; selected: TrafficDataSelection }) {
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
	} else if (selected.sub.type === 'staticVehicle') {
		const sv = hull.staticTrafficVehicles[selected.sub.index];
		if (sv) {
			// Translation lives at mTransform[12..14] (RwMatrix layout).
			pos = [sv.mTransform[12], sv.mTransform[13] + 6, sv.mTransform[14]];
			label = `Hull ${selected.hullIndex} | Vehicle ${selected.sub.index} | FlowType ${sv.mFlowTypeID}`;
		}
	}

	if (!pos) return null;

	return (
		// No distanceFactor — the label stays at a fixed screen size regardless
		// of camera distance. distanceFactor scales inversely with distance, so
		// after FocusOnVehicle pulls the camera to ~60 units the label was
		// rendering at 3× size and dominating the viewport.
		<Html position={pos} center style={{ pointerEvents: 'none' }}>
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
// PVS grid overlay
// ---------------------------------------------------------------------------
//
// Draws every PVS cell (uniform `mCellSize`, `muNumCells_X` × `muNumCells_Z`
// grid anchored at `mGridMin`) as a tinted quad on the X-Z plane. Cells are
// coloured by hull-count so the user can read at a glance which areas of the
// city have heavy traffic-AI visibility and which are sparse / empty.
//
// Cell index convention: `idx = i + j * X` where `i ∈ [0, X)` is the column
// (x axis) and `j ∈ [0, Z)` is the row (z axis). This matches the natural
// scanline order in which the writer emits `mpaHullPvs`.

// Map a hull-count (0..8) to an RGB tint. Cold for empty, warm for heavily-
// occupied cells. The gradient is calibrated so all eight steps are
// distinguishable through the 0.28-alpha fill — empty cells stay legible
// against the dark viewport background so the user can still read the grid.
function hullCountTint(count: number): [number, number, number] {
	if (count <= 0) return [0.30, 0.32, 0.38]; // empty — visible but cool
	const t = Math.min(1, count / 8);
	// Lerp blue → green → orange via 3-stop gradient.
	if (t < 0.5) {
		const u = t / 0.5;
		return [0.15 + 0.25 * u, 0.55 + 0.20 * u, 0.95 - 0.30 * u];
	}
	const u = (t - 0.5) / 0.5;
	return [0.40 + 0.55 * u, 0.75 - 0.25 * u, 0.65 - 0.45 * u];
}

// Cell index → world bounds (X-Z rectangle). Returns null when the index is
// out of range.
function cellRect(pvs: TrafficPvs, cellIndex: number) {
	const X = pvs.muNumCells_X;
	const Z = pvs.muNumCells_Z;
	if (X <= 0 || Z <= 0) return null;
	if (cellIndex < 0 || cellIndex >= X * Z) return null;
	const i = cellIndex % X;
	const j = Math.floor(cellIndex / X);
	const x0 = pvs.mGridMin.x + i * pvs.mCellSize.x;
	const z0 = pvs.mGridMin.z + j * pvs.mCellSize.z;
	return {
		i, j,
		x0, z0,
		x1: x0 + pvs.mCellSize.x,
		z1: z0 + pvs.mCellSize.z,
	};
}

// Inverse: world (x, z) → cell index. Returns -1 outside the grid.
function cellAt(pvs: TrafficPvs, x: number, z: number): number {
	const X = pvs.muNumCells_X;
	const Z = pvs.muNumCells_Z;
	if (X <= 0 || Z <= 0) return -1;
	const dx = pvs.mCellSize.x;
	const dz = pvs.mCellSize.z;
	if (dx === 0 || dz === 0) return -1;
	const i = Math.floor((x - pvs.mGridMin.x) / dx);
	const j = Math.floor((z - pvs.mGridMin.z) / dz);
	if (i < 0 || i >= X || j < 0 || j >= Z) return -1;
	return i + j * X;
}

const PVS_OVERLAY_Y = 0.5; // sits just above ground to avoid z-fighting

// Vertex-coloured quads for every cell. Built once per pvs-data change.
function buildPvsFillGeometry(pvs: TrafficPvs): THREE.BufferGeometry {
	const X = pvs.muNumCells_X;
	const Z = pvs.muNumCells_Z;
	const count = X * Z;
	const positions = new Float32Array(count * 6 * 3); // 2 tris × 3 verts × xyz
	const colors = new Float32Array(count * 6 * 3);
	let p = 0, c = 0;
	for (let j = 0; j < Z; j++) {
		for (let i = 0; i < X; i++) {
			const idx = i + j * X;
			const set = pvs.hullPvsSets[idx];
			const tint = hullCountTint(set ? set.muCount : 0);
			const x0 = pvs.mGridMin.x + i * pvs.mCellSize.x;
			const z0 = pvs.mGridMin.z + j * pvs.mCellSize.z;
			const x1 = x0 + pvs.mCellSize.x;
			const z1 = z0 + pvs.mCellSize.z;
			// Two triangles per quad: (x0,z0)-(x1,z0)-(x1,z1) and (x0,z0)-(x1,z1)-(x0,z1)
			const verts: [number, number][] = [
				[x0, z0], [x1, z0], [x1, z1],
				[x0, z0], [x1, z1], [x0, z1],
			];
			for (const [vx, vz] of verts) {
				positions[p++] = vx; positions[p++] = PVS_OVERLAY_Y; positions[p++] = vz;
				colors[c++] = tint[0]; colors[c++] = tint[1]; colors[c++] = tint[2];
			}
		}
	}
	const geo = new THREE.BufferGeometry();
	geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
	geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
	geo.computeBoundingSphere();
	return geo;
}

// Thin grid lines around every cell.
function buildPvsBorderGeometry(pvs: TrafficPvs): THREE.BufferGeometry {
	const X = pvs.muNumCells_X;
	const Z = pvs.muNumCells_Z;
	// (X+1) verticals × Z segs + (Z+1) horizontals × X segs, 2 endpoints each
	const totalSegs = (X + 1) * Z + (Z + 1) * X;
	const positions = new Float32Array(totalSegs * 2 * 3);
	let p = 0;
	const x0 = pvs.mGridMin.x;
	const z0 = pvs.mGridMin.z;
	const dx = pvs.mCellSize.x;
	const dz = pvs.mCellSize.z;
	// Vertical lines
	for (let i = 0; i <= X; i++) {
		const x = x0 + i * dx;
		positions[p++] = x; positions[p++] = PVS_OVERLAY_Y; positions[p++] = z0;
		positions[p++] = x; positions[p++] = PVS_OVERLAY_Y; positions[p++] = z0 + Z * dz;
	}
	// Horizontal lines
	for (let j = 0; j <= Z; j++) {
		const z = z0 + j * dz;
		positions[p++] = x0; positions[p++] = PVS_OVERLAY_Y; positions[p++] = z;
		positions[p++] = x0 + X * dx; positions[p++] = PVS_OVERLAY_Y; positions[p++] = z;
	}
	const geo = new THREE.BufferGeometry();
	geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
	geo.computeBoundingSphere();
	return geo;
}

// One quad outline at a specific cell — used for the selected / hovered cell
// and for the "containing cell of the selected static car" highlight.
function buildCellOutline(pvs: TrafficPvs, cellIndex: number, yOffset: number): THREE.BufferGeometry | null {
	const r = cellRect(pvs, cellIndex);
	if (!r) return null;
	const y = PVS_OVERLAY_Y + yOffset;
	const positions = new Float32Array([
		r.x0, y, r.z0, r.x1, y, r.z0,
		r.x1, y, r.z0, r.x1, y, r.z1,
		r.x1, y, r.z1, r.x0, y, r.z1,
		r.x0, y, r.z1, r.x0, y, r.z0,
	]);
	const geo = new THREE.BufferGeometry();
	geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
	geo.computeBoundingSphere();
	return geo;
}

// Materials shared across overlay components — created once.
const pvsFillMat = new THREE.MeshBasicMaterial({
	vertexColors: true,
	transparent: true,
	opacity: 0.28,
	side: THREE.DoubleSide,
	depthWrite: false,
});
const pvsBorderMat = new THREE.LineBasicMaterial({
	color: 0xffffff,
	transparent: true,
	opacity: 0.16,
	depthWrite: false,
});
const pvsSelectedOutlineMat = new THREE.LineBasicMaterial({
	color: 0xffaa33,
	transparent: true,
	opacity: 0.95,
	depthTest: false,
});
const pvsContainingCellOutlineMat = new THREE.LineBasicMaterial({
	color: 0x33ddff,
	transparent: true,
	opacity: 0.85,
	depthTest: false,
});
const pvsHullCellOutlineMat = new THREE.LineBasicMaterial({
	color: 0xff66aa,
	transparent: true,
	opacity: 0.55,
	depthTest: false,
});

// Cells whose `hullPvsSets[idx].mauItems.slice(0, muCount)` contains a given
// hull index. Used to light up the cells that reference the selected hull.
function findCellsListingHull(pvs: TrafficPvs, hullIndex: number): number[] {
	const out: number[] = [];
	const sets = pvs.hullPvsSets;
	for (let i = 0; i < sets.length; i++) {
		const s = sets[i];
		const n = Math.min(s.muCount, s.mauItems.length);
		for (let k = 0; k < n; k++) {
			if (s.mauItems[k] === hullIndex) {
				out.push(i);
				break;
			}
		}
	}
	return out;
}

export function PvsGridOverlay({
	pvs, hulls, selected,
}: {
	pvs: TrafficPvs;
	hulls: TrafficHull[];
	selected: TrafficDataSelection;
}) {
	const fillGeo = useMemo(() => buildPvsFillGeometry(pvs), [pvs]);
	const borderGeo = useMemo(() => buildPvsBorderGeometry(pvs), [pvs]);

	// Click + hover are routed through the PickingPlane so a single decision
	// (rung-near vs open-space) handles both road and cell picking. The
	// overlay itself is a passive visual.

	// Selected cell — drawn as a depth-test-off bright outline so it pops above
	// the road network even when the camera is angled in.
	const selectedCellOutline = useMemo(() => {
		if (!isPvsCellSelection(selected)) return null;
		return buildCellOutline(pvs, selected.cellIndex, 0.4);
	}, [pvs, selected]);

	// "Containing cell of the selected static car" — when a static-traffic
	// vehicle is selected, light up the cell its translation falls into so
	// the user can immediately see which PvsHullSet they need to edit.
	const containingCellOutline = useMemo(() => {
		if (!selected || isPvsCellSelection(selected)) return null;
		if (selected.sub?.type !== 'staticVehicle') return null;
		const sv = hulls[selected.hullIndex]?.staticTrafficVehicles[selected.sub.index];
		if (!sv) return null;
		const idx = cellAt(pvs, sv.mTransform[12] ?? 0, sv.mTransform[14] ?? 0);
		if (idx < 0) return null;
		return buildCellOutline(pvs, idx, 0.3);
	}, [pvs, hulls, selected]);

	// Inverse mapping: when a hull is the focus of selection (and no PVS cell
	// is selected), outline every cell that lists this hull. Capped at the
	// active hull index so it tracks the existing dim/bright treatment.
	const hullCellsOutline = useMemo(() => {
		if (!selected || isPvsCellSelection(selected)) return null;
		if (selected.sub?.type === 'staticVehicle') return null; // containing-cell wins
		const cells = findCellsListingHull(pvs, selected.hullIndex);
		if (cells.length === 0) return null;
		// One BufferGeometry of `cells.length × 8` line endpoints (4 segments per cell).
		const positions = new Float32Array(cells.length * 8 * 3);
		let p = 0;
		const y = PVS_OVERLAY_Y + 0.2;
		for (const ci of cells) {
			const r = cellRect(pvs, ci);
			if (!r) continue;
			const segs: [number, number, number, number][] = [
				[r.x0, r.z0, r.x1, r.z0],
				[r.x1, r.z0, r.x1, r.z1],
				[r.x1, r.z1, r.x0, r.z1],
				[r.x0, r.z1, r.x0, r.z0],
			];
			for (const [ax, az, bx, bz] of segs) {
				positions[p++] = ax; positions[p++] = y; positions[p++] = az;
				positions[p++] = bx; positions[p++] = y; positions[p++] = bz;
			}
		}
		const geo = new THREE.BufferGeometry();
		geo.setAttribute('position', new THREE.BufferAttribute(positions.subarray(0, p), 3));
		return geo;
	}, [pvs, selected]);

	// When a PVS cell is selected, also outline the hulls that cell references
	// (rungs of those hulls drawn in a magenta tint, depth-test off).
	const cellHullsRungGeo = useMemo(() => {
		if (!isPvsCellSelection(selected)) return null;
		const set = pvs.hullPvsSets[selected.cellIndex];
		if (!set) return null;
		const ids = set.mauItems.slice(0, Math.min(set.muCount, set.mauItems.length));
		if (ids.length === 0) return null;
		const segs: number[] = [];
		for (const hi of ids) {
			const hull = hulls[hi];
			if (!hull) continue;
			for (const rung of hull.rungs) {
				const a = rung.maPoints[0], b = rung.maPoints[1];
				segs.push(a.x, a.y + 0.6, a.z, b.x, b.y + 0.6, b.z);
			}
		}
		if (segs.length === 0) return null;
		const geo = new THREE.BufferGeometry();
		geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(segs), 3));
		return geo;
	}, [pvs, hulls, selected]);

	return (
		<>
			{/* Tinted fill — passive (clicks routed via PickingPlane) */}
			<mesh
				geometry={fillGeo}
				material={pvsFillMat}
				renderOrder={1}
				raycast={() => undefined as unknown as void}
			/>
			{/* Cell borders — passive */}
			<lineSegments geometry={borderGeo} material={pvsBorderMat} renderOrder={2} />
			{/* Cells listing the selected hull */}
			{hullCellsOutline && (
				<lineSegments geometry={hullCellsOutline} material={pvsHullCellOutlineMat} renderOrder={5} />
			)}
			{/* Containing cell of the selected static-traffic vehicle */}
			{containingCellOutline && (
				<lineSegments geometry={containingCellOutline} material={pvsContainingCellOutlineMat} renderOrder={6} />
			)}
			{/* Selected cell — drawn last so it always wins */}
			{selectedCellOutline && (
				<lineSegments geometry={selectedCellOutline} material={pvsSelectedOutlineMat} renderOrder={7} />
			)}
			{/* Hulls referenced by the selected cell */}
			{cellHullsRungGeo && (
				<lineSegments geometry={cellHullsRungGeo} renderOrder={8}>
					<lineBasicMaterial color={0xff66aa} transparent opacity={0.95} depthTest={false} />
				</lineSegments>
			)}
		</>
	);
}

// Floating tooltip that follows the mouse over the grid. Reads the cell's
// hull list from `pvs.hullPvsSets` so the user sees exactly which hulls a
// click would reference.
export function PvsCellTooltip({
	pvs, hoverCellIndex, hoverWorld,
}: {
	pvs: TrafficPvs;
	hoverCellIndex: number | null;
	hoverWorld: THREE.Vector3 | null;
}) {
	if (hoverCellIndex == null || !hoverWorld) return null;
	const set = pvs.hullPvsSets[hoverCellIndex];
	const r = cellRect(pvs, hoverCellIndex);
	const hulls = set ? set.mauItems.slice(0, Math.min(set.muCount, set.mauItems.length)) : [];
	const label = `Cell #${hoverCellIndex} (${r?.i},${r?.j}) · ${set?.muCount ?? 0} hulls${hulls.length ? `: ${hulls.join(', ')}` : ''}`;
	return (
		<Html position={[hoverWorld.x, PVS_OVERLAY_Y + 4, hoverWorld.z]} center style={{ pointerEvents: 'none' }}>
			<div style={{
				background: 'rgba(0,0,0,0.85)', color: '#33ddff', padding: '2px 8px',
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

	const selectedHull = selected && !isPvsCellSelection(selected) ? hulls[selected.hullIndex] : null;
	const selectedSectionIndex = selected && !isPvsCellSelection(selected) && selected.sub?.type === 'section' ? selected.sub.index : -1;

	// PVS overlay: visible by default whenever the resource has a populated
	// grid. Toggle gates click + tooltip too — we don't want the grid mesh
	// intercepting clicks meant for hulls / vehicles when it's hidden.
	const hasPvsGrid = data.pvs.muNumCells_X > 0 && data.pvs.muNumCells_Z > 0 && data.pvs.hullPvsSets.length > 0;
	const [showPvsGrid, setShowPvsGrid] = useState(hasPvsGrid);
	const [hoverCellIndex, setHoverCellIndex] = useState<number | null>(null);
	const [hoverWorld, setHoverWorld] = useState<THREE.Vector3 | null>(null);
	const handleHoverCell = useCallback((idx: number | null, w: THREE.Vector3 | null) => {
		setHoverCellIndex(idx);
		setHoverWorld(w);
	}, []);

	// Marquee wiring: pick static traffic vehicles inside the dragged
	// rectangle and union/subtract their schema paths into the bulk set.
	// Other pickable item kinds (junctions, light triggers) could be
	// added later — vehicles are the most common bulk-edit target.
	const cameraBridge = useRef<CameraBridgeData | null>(null);
	const bulk = useSchemaBulkSelection();
	const handleMarquee = useCallback(
		(frustum: THREE.Frustum, mode: 'add' | 'remove') => {
			if (!bulk?.onBulkApplyPaths) return;
			const hits: NodePath[] = [];
			const pt = new THREE.Vector3();
			for (let h = 0; h < hulls.length; h++) {
				const list = hulls[h].staticTrafficVehicles;
				for (let s = 0; s < list.length; s++) {
					const m = list[s].mTransform;
					// Translation column of the 4×4 (RwMatrix layout).
					pt.set(m[12] ?? 0, m[13] ?? 0, m[14] ?? 0);
					if (frustum.containsPoint(pt)) {
						hits.push(['hulls', h, 'staticTrafficVehicles', s]);
					}
				}
			}
			if (hits.length === 0) return;
			bulk.onBulkApplyPaths(hits, mode);
		},
		[hulls, bulk],
	);

	return (
		<div style={{ height: '45vh', background: '#1a1d23', borderRadius: 8, minWidth: 0, position: 'relative' }}>
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
				<FocusOnVehicle hulls={hulls} selected={selected} />
				<ambientLight intensity={0.5} />
				<hemisphereLight args={['#b1c8e8', '#4a3f2f', 0.4]} />
				<directionalLight position={[10, 20, 5]} intensity={0.9} />
				<directionalLight position={[-8, 15, -10]} intensity={0.4} />

				{/* Invisible picking plane — catches clicks anywhere, finds nearest
				    rung; falls through to PVS cell pick when the grid is on and
				    the click isn't near any road. */}
				<PickingPlane
					hulls={hulls}
					center={center}
					radius={radius}
					onSelect={onSelect}
					pvs={hasPvsGrid ? data.pvs : null}
					pvsActive={showPvsGrid && hasPvsGrid}
					onHoverCell={handleHoverCell}
				/>

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
					activeHullIndex={activeHullIndex}
					selected={selected}
					onSelect={onSelect}
				/>
				<SelectedVehicleOutline hulls={hulls} selected={selected} />

				{/* Traffic lights (only on lights tab) */}
				{activeTab === 'lights' && (
					<TrafficLightInstances data={data} />
				)}

				{/* PVS grid overlay — sits on top of road geometry, picks at the
				    XZ plane. Renders cells, the selected cell, and inverse
				    highlights ("which cell holds this static car", "which cells
				    list this hull"). */}
				{showPvsGrid && hasPvsGrid && (
					<>
						<PvsGridOverlay
							pvs={data.pvs}
							hulls={hulls}
							selected={selected}
						/>
						<PvsCellTooltip
							pvs={data.pvs}
							hoverCellIndex={hoverCellIndex}
							hoverWorld={hoverWorld}
						/>
					</>
				)}

				{/* Selection label */}
				<SelectionLabel hulls={hulls} selected={selected} />

				<CameraBridge bridge={cameraBridge} />
				<OrbitControls
					target={[center.x, 0, center.z]}
					enableDamping
					dampingFactor={0.1}
					makeDefault
				/>
			</Canvas>
			<MarqueeSelector
				bridge={cameraBridge}
				far={Math.max(camDistance * 20, 50000)}
				onMarquee={handleMarquee}
				hintIdle="press B to box-select static vehicles"
			/>
			{hasPvsGrid && (
				<label
					style={{
						position: 'absolute', top: 8, right: 8,
						background: 'rgba(0,0,0,0.7)', color: '#cdd', padding: '4px 8px',
						borderRadius: 4, fontSize: 11, fontFamily: 'monospace',
						display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
						userSelect: 'none',
					}}
				>
					<input
						type="checkbox"
						checked={showPvsGrid}
						onChange={(e) => setShowPvsGrid(e.target.checked)}
						style={{ margin: 0 }}
					/>
					PVS grid ({data.pvs.muNumCells_X}×{data.pvs.muNumCells_Z})
				</label>
			)}
		</div>
	);
};
