// 3D viewport for ZoneList — renders the streaming-PVS zones on the XZ
// plane plus the safe / unsafe neighbour graph as adjacency lines. Clicking
// a zone selects it; the inspector then jumps to `zones[i]`.
//
// PERFORMANCE: All ~370 zones (X360 prototype) / ~430 zones (retail) are
// batched into a single merged BufferGeometry (2 draw calls: fills +
// outlines), with face-index → zone-index mapping for picking. Mirrors the
// AISectionsViewport pattern.
//
// COLOR ENCODING: zoneType → fill colour. Retail / prototype data has every
// zone at type 0, so today the fill is monochrome (a desaturated cyan that
// matches Bundle-Manager's PVS editor screenshot). Authoring tools that
// paint type values onto zones will get a colour split for free.

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Canvas, useThree, ThreeEvent } from '@react-three/fiber';
import { OrbitControls, Html, Line } from '@react-three/drei';
import * as THREE from 'three';
import { CameraBridge, type CameraBridgeData } from '@/components/common/three/CameraBridge';
import { MarqueeSelector } from '@/components/common/three/MarqueeSelector';
import { useSchemaBulkSelection } from '@/components/schema-editor/bulkSelectionContext';
import {
	type ParsedZoneList,
	type Zone,
	NEIGHBOUR_FLAGS,
} from '@/lib/core/zoneList';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ZoneSelection = {
	zoneIndex: number;
} | null;

type Props = {
	data: ParsedZoneList;
	selected: ZoneSelection;
	onSelect: (sel: ZoneSelection) => void;
	/** When true, draw lines from each selected zone to its safe + unsafe
	 *  neighbours so the streaming graph is visible at a glance. */
	showNeighbourGraph?: boolean;
};

// ---------------------------------------------------------------------------
// Colors — matches Bundle-Manager's cyan-grid screenshot.
// ---------------------------------------------------------------------------

// Zone type → fill RGB. Retail has only type 0; we leave a fallback palette
// for prototype builds that may use higher values.
const ZONE_TYPE_RGB: Record<number, [number, number, number]> = {
	0: [0.32, 0.78, 0.94], // cyan, like Bundle-Manager
};
const FALLBACK_RGB: [number, number, number] = [0.6, 0.6, 0.6];

const SELECTED_COLOR = '#fff066';   // bright yellow — selection
const HOVERED_COLOR  = '#74d4ff';   // light cyan — hover
const SAFE_LINE_COLOR    = '#7af07a'; // green
const UNSAFE_LINE_COLOR  = '#ff8a4a'; // orange
const IMMEDIATE_LINE_COLOR = '#ff3030'; // red — IMMEDIATE flag is the strongest signal

// ---------------------------------------------------------------------------
// Scene bounds
// ---------------------------------------------------------------------------

function computeBounds(data: ParsedZoneList): { center: THREE.Vector3; radius: number } {
	if (data.zones.length === 0) return { center: new THREE.Vector3(), radius: 100 };
	const box = new THREE.Box3();
	for (const z of data.zones) {
		for (const p of z.points) {
			box.expandByPoint(new THREE.Vector3(p.x, 0, p.y));
		}
	}
	const sphere = new THREE.Sphere();
	box.getBoundingSphere(sphere);
	return { center: sphere.center, radius: Math.max(sphere.radius, 50) };
}

// ---------------------------------------------------------------------------
// Auto-fit camera (one-shot on mount)
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
// Batched zone geometry
// ---------------------------------------------------------------------------

type BatchedResult = {
	fillGeo: THREE.BufferGeometry;
	outlineGeo: THREE.BufferGeometry;
	/** triangle index → zone index */
	faceToZone: Int32Array;
	/** convenient cached centroids (XZ) for adjacency lines */
	centroids: Float32Array;
};

function buildBatchedZones(zones: Zone[]): BatchedResult {
	let totalFillVerts = 0;
	let totalFillIndices = 0;
	let totalOutlineVerts = 0;
	for (const z of zones) {
		const n = z.points.length;
		if (n < 3) continue;
		totalFillVerts += n;
		totalFillIndices += (n - 2) * 3;
		totalOutlineVerts += n * 2; // edges as line segments
	}

	const positions = new Float32Array(totalFillVerts * 3);
	const colors = new Float32Array(totalFillVerts * 3);
	const indices = new Uint32Array(totalFillIndices);
	const faceToZone = new Int32Array(totalFillIndices / 3);
	const outPositions = new Float32Array(totalOutlineVerts * 3);
	const centroids = new Float32Array(zones.length * 3);

	let vOff = 0, iOff = 0, fOff = 0, oOff = 0;
	for (let zi = 0; zi < zones.length; zi++) {
		const z = zones[zi];
		const n = z.points.length;
		// Centroid: average of all points (ok for convex quads).
		let cx = 0, cy = 0;
		for (const p of z.points) { cx += p.x; cy += p.y; }
		cx /= n || 1; cy /= n || 1;
		centroids[zi * 3] = cx;
		centroids[zi * 3 + 1] = 0;
		centroids[zi * 3 + 2] = cy;

		if (n < 3) continue;
		const rgb = ZONE_TYPE_RGB[z.miZoneType] ?? FALLBACK_RGB;
		const baseVert = vOff / 3;

		for (let pi = 0; pi < n; pi++) {
			positions[vOff] = z.points[pi].x;
			positions[vOff + 1] = 0.1;
			positions[vOff + 2] = z.points[pi].y;
			colors[vOff] = rgb[0];
			colors[vOff + 1] = rgb[1];
			colors[vOff + 2] = rgb[2];
			vOff += 3;
		}

		// Fan triangulation
		const numTris = n - 2;
		for (let t = 0; t < numTris; t++) {
			indices[iOff] = baseVert;
			indices[iOff + 1] = baseVert + t + 1;
			indices[iOff + 2] = baseVert + t + 2;
			iOff += 3;
			faceToZone[fOff++] = zi;
		}

		// Outline: each edge as a pair of verts (LineSegments)
		for (let pi = 0; pi < n; pi++) {
			const next = (pi + 1) % n;
			outPositions[oOff++] = z.points[pi].x;
			outPositions[oOff++] = 0.5;
			outPositions[oOff++] = z.points[pi].y;
			outPositions[oOff++] = z.points[next].x;
			outPositions[oOff++] = 0.5;
			outPositions[oOff++] = z.points[next].y;
		}
	}

	const fillGeo = new THREE.BufferGeometry();
	fillGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
	fillGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
	fillGeo.setIndex(new THREE.BufferAttribute(indices, 1));
	fillGeo.computeBoundingSphere();

	const outlineGeo = new THREE.BufferGeometry();
	outlineGeo.setAttribute('position', new THREE.BufferAttribute(outPositions.subarray(0, oOff), 3));
	outlineGeo.computeBoundingSphere();

	return { fillGeo, outlineGeo, faceToZone, centroids };
}

// ---------------------------------------------------------------------------
// Shared materials
// ---------------------------------------------------------------------------

const fillMaterial = new THREE.MeshBasicMaterial({
	vertexColors: true,
	transparent: true,
	opacity: 0.18,
	side: THREE.DoubleSide,
	depthWrite: false,
	polygonOffset: true,
	polygonOffsetFactor: 1,
	polygonOffsetUnits: 1,
});

const outlineMaterial = new THREE.LineBasicMaterial({ color: 0x4ad0e8, transparent: true, opacity: 0.55 });

// ---------------------------------------------------------------------------
// Batched zones scene (2 draw calls)
// ---------------------------------------------------------------------------

function BatchedZones({
	data, onSelect, onHover,
}: {
	data: ParsedZoneList;
	onSelect: (sel: ZoneSelection) => void;
	onHover: (sel: ZoneSelection) => void;
}) {
	const batched = useMemo(() => buildBatchedZones(data.zones), [data.zones]);

	const handleClick = useCallback((e: ThreeEvent<MouseEvent>) => {
		e.stopPropagation();
		if (e.faceIndex == null) return;
		const zi = batched.faceToZone[e.faceIndex];
		if (zi != null && zi >= 0) onSelect({ zoneIndex: zi });
	}, [batched.faceToZone, onSelect]);

	const handlePointerMove = useCallback((e: ThreeEvent<PointerEvent>) => {
		e.stopPropagation();
		if (e.faceIndex == null) { onHover(null); return; }
		const zi = batched.faceToZone[e.faceIndex];
		if (zi != null && zi >= 0) {
			onHover({ zoneIndex: zi });
			document.body.style.cursor = 'pointer';
		}
	}, [batched.faceToZone, onHover]);

	const handlePointerOut = useCallback(() => {
		onHover(null);
		document.body.style.cursor = 'auto';
	}, [onHover]);

	return (
		<>
			<mesh
				geometry={batched.fillGeo}
				material={fillMaterial}
				onClick={handleClick}
				onPointerMove={handlePointerMove}
				onPointerOut={handlePointerOut}
			/>
			<lineSegments geometry={batched.outlineGeo} material={outlineMaterial} />
		</>
	);
}

// ---------------------------------------------------------------------------
// Selection / hover overlay (one zone, drawn brighter)
// ---------------------------------------------------------------------------

function ZoneOverlay({ zone, color }: { zone: Zone; color: string }) {
	const geometry = useMemo(() => {
		if (zone.points.length < 3) return null;
		const shape = new THREE.Shape();
		shape.moveTo(zone.points[0].x, zone.points[0].y);
		for (let i = 1; i < zone.points.length; i++) {
			shape.lineTo(zone.points[i].x, zone.points[i].y);
		}
		shape.closePath();
		const geo = new THREE.ShapeGeometry(shape);
		// ShapeGeometry produces vertices on the XY plane at (x, y, 0). We
		// want them on the XZ plane at world (x, 0, y) — rotateX(+π/2) maps
		// (x, y, 0) → (x, 0, y). The negative-π/2 we used earlier reflected
		// the polygon through the world X axis (right-hand rule), which is
		// why the fill landed on the opposite side of the map from the
		// outline `<Line>` (whose points are placed directly on XZ).
		geo.rotateX(Math.PI / 2);
		return geo;
	}, [zone.points]);

	if (!geometry || zone.points.length < 3) return null;

	return (
		<>
			<mesh geometry={geometry} position={[0, 0.3, 0]}>
				<meshBasicMaterial color={color} transparent opacity={0.45} side={THREE.DoubleSide} depthWrite={false} />
			</mesh>
			<Line
				points={[
					...zone.points.map((p): [number, number, number] => [p.x, 0.4, p.y]),
					[zone.points[0].x, 0.4, zone.points[0].y],
				]}
				color={color}
				lineWidth={2.5}
			/>
		</>
	);
}

// ---------------------------------------------------------------------------
// Adjacency-graph rendering for the selected zone
// ---------------------------------------------------------------------------

function NeighbourGraph({
	data,
	zoneIndex,
	centroids,
}: {
	data: ParsedZoneList;
	zoneIndex: number;
	centroids: Float32Array;
}) {
	const zone = data.zones[zoneIndex];
	if (!zone) return null;

	const sourceXZ: [number, number, number] = [
		centroids[zoneIndex * 3],
		2,
		centroids[zoneIndex * 3 + 2],
	];

	type Line = { from: [number, number, number]; to: [number, number, number]; color: string; width: number };
	const lines: Line[] = [];

	const addLine = (n: { zoneIndex: number; muFlags: number }, base: string) => {
		if (n.zoneIndex < 0 || n.zoneIndex >= data.zones.length) return;
		const tx = centroids[n.zoneIndex * 3];
		const tz = centroids[n.zoneIndex * 3 + 2];
		const isImmediate = (n.muFlags & NEIGHBOUR_FLAGS.IMMEDIATE) !== 0;
		lines.push({
			from: sourceXZ,
			to: [tx, 2, tz],
			color: isImmediate ? IMMEDIATE_LINE_COLOR : base,
			width: isImmediate ? 2.5 : 1.5,
		});
	};
	for (const n of zone.safeNeighbours) addLine(n, SAFE_LINE_COLOR);
	for (const n of zone.unsafeNeighbours) addLine(n, UNSAFE_LINE_COLOR);

	return (
		<>
			{lines.map((ln, i) => (
				<Line key={i} points={[ln.from, ln.to]} color={ln.color} lineWidth={ln.width} />
			))}
		</>
	);
}

// ---------------------------------------------------------------------------
// Selection label
// ---------------------------------------------------------------------------

function ZoneLabel({ zone, index, color }: { zone: Zone; index: number; color: string }) {
	if (zone.points.length < 4) return null;
	const cx = (zone.points[0].x + zone.points[2].x) / 2;
	const cz = (zone.points[0].y + zone.points[2].y) / 2;
	return (
		<Html
			position={[cx, 4, cz]}
			center
			distanceFactor={300}
			style={{ pointerEvents: 'none' }}
		>
			<div style={{
				background: 'rgba(0,0,0,0.8)', color, padding: '2px 6px',
				borderRadius: 4, fontSize: 10, whiteSpace: 'nowrap', fontFamily: 'monospace',
			}}>
				Zone {index} | 0x{zone.muZoneId.toString(16).toUpperCase()}
				{` | ${zone.safeNeighbours.length}s/${zone.unsafeNeighbours.length}u`}
			</div>
		</Html>
	);
}

// ---------------------------------------------------------------------------
// Top-level viewport
// ---------------------------------------------------------------------------

export function ZoneListViewport({ data, selected, onSelect, showNeighbourGraph = true }: Props) {
	const bounds = useMemo(() => computeBounds(data), [data]);
	const batched = useMemo(() => buildBatchedZones(data.zones), [data.zones]);
	const [hovered, setHovered] = useState<ZoneSelection>(null);

	const cameraBridge = useRef<CameraBridgeData | null>(null);
	const bulk = useSchemaBulkSelection();

	const handleMarquee = useCallback((frustum: THREE.Frustum, mode: 'add' | 'remove') => {
		// Each zone's centroid drives membership. The schema bulk-selection
		// store wants a NodePath[] of `['zones', i]` tuples.
		const hits: (string | number)[][] = [];
		for (let zi = 0; zi < data.zones.length; zi++) {
			const cx = batched.centroids[zi * 3];
			const cy = batched.centroids[zi * 3 + 1];
			const cz = batched.centroids[zi * 3 + 2];
			if (frustum.containsPoint(new THREE.Vector3(cx, cy, cz))) {
				hits.push(['zones', zi]);
			}
		}
		bulk.onBulkApplyPaths(hits, mode);
	}, [data.zones.length, batched.centroids, bulk]);

	const selectedZone = selected != null && selected.zoneIndex >= 0 && selected.zoneIndex < data.zones.length
		? data.zones[selected.zoneIndex] : null;
	const hoveredZone = hovered != null && hovered.zoneIndex >= 0 && hovered.zoneIndex < data.zones.length
		? data.zones[hovered.zoneIndex] : null;

	return (
		<div className="relative w-full h-full" style={{ minHeight: 400 }}>
			<Canvas camera={{ position: [bounds.center.x, bounds.radius * 1.5, bounds.center.z], fov: 50, near: 1, far: bounds.radius * 10 }}>
				<color attach="background" args={['#0a0e14']} />
				<ambientLight intensity={0.7} />
				<directionalLight position={[bounds.radius, bounds.radius * 2, bounds.radius]} intensity={0.6} />

				<AutoFit center={bounds.center} radius={bounds.radius} />
				<CameraBridge bridge={cameraBridge} />

				<BatchedZones data={data} onSelect={onSelect} onHover={setHovered} />

				{selectedZone && <ZoneOverlay zone={selectedZone} color={SELECTED_COLOR} />}
				{hoveredZone && hovered?.zoneIndex !== selected?.zoneIndex && (
					<ZoneOverlay zone={hoveredZone} color={HOVERED_COLOR} />
				)}
				{selectedZone && (
					<ZoneLabel zone={selectedZone} index={selected!.zoneIndex} color={SELECTED_COLOR} />
				)}
				{showNeighbourGraph && selected != null && (
					<NeighbourGraph data={data} zoneIndex={selected.zoneIndex} centroids={batched.centroids} />
				)}

				<OrbitControls makeDefault enableDamping dampingFactor={0.1} />
			</Canvas>

			<MarqueeSelector
				bridge={cameraBridge}
				onMarquee={handleMarquee}
				// Marquee far-plane distance — 10× scene radius is the same
				// rule of thumb AISectionsViewport uses (occluded zones still
				// get picked, the camera's actual far plane is far further).
				far={bounds.radius * 10}
				hintIdle="Press B for box select"
			/>

			<div className="absolute top-2 left-2 text-xs text-white/70 bg-black/40 px-2 py-1 rounded select-none pointer-events-none font-mono">
				{data.zones.length} zones · click to select · drag with B held to marquee
			</div>
			<div className="absolute top-2 right-2 text-xs text-white/70 bg-black/40 px-2 py-1 rounded select-none pointer-events-none font-mono space-y-0.5">
				<div><span style={{ color: SAFE_LINE_COLOR }}>━</span> safe</div>
				<div><span style={{ color: UNSAFE_LINE_COLOR }}>━</span> unsafe</div>
				<div><span style={{ color: IMMEDIATE_LINE_COLOR }}>━</span> immediate</div>
			</div>
		</div>
	);
}

export default ZoneListViewport;
