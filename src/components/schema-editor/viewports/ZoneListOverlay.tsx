// ZoneListOverlay — WorldViewport overlay for the streaming-PVS zones.
//
// Pure function of `(data, selectedPath, onSelect)`: renders all zones as a
// batched fill+outline mesh, picks zone-on-click, draws a yellow highlight
// for the selected zone, and a green/orange/red neighbour graph from the
// selected zone's centroid to its safe / unsafe / IMMEDIATE neighbours.
//
// Selection currency is the schema NodePath (ADR-0001). The overlay matches
// `['zones', i, ...]` paths for highlight and emits `['zones', i]` paths on
// click. Anything outside `['zones', ...]` reads as "no selection".
//
// Performance notes mirror ZoneListViewport: every zone is fan-triangulated
// into one merged BufferGeometry (2 draw calls) with a face-index → zone
// mapping for click picking.

import { useMemo, useState, useCallback } from 'react';
import { ThreeEvent } from '@react-three/fiber';
import { Html, Line } from '@react-three/drei';
import * as THREE from 'three';
import {
	type ParsedZoneList,
	type Zone,
	NEIGHBOUR_FLAGS,
} from '@/lib/core/zoneList';
import type { NodePath } from '@/lib/schema/walk';
import type { WorldOverlayComponent } from './WorldViewport.types';
import { defineSelectionCodec, SELECTION_THEME, type Selection } from './selection';

// ---------------------------------------------------------------------------
// Path ↔ Selection codec (exported for tests)
// ---------------------------------------------------------------------------

/**
 * Codec for the streaming-PVS zones. Sub-paths inside a zone (e.g.
 * `['zones', i, 'safeNeighbours', n]`) collapse to "this zone is selected".
 * The merged BatchedGeometry paint loop stays inline — `useBatchedSelection`
 * is a deferred follow-up; only the codec + theme migrate cleanly here.
 */
export const zoneSelectionCodec = defineSelectionCodec({
	pathToSelection: (path: NodePath): Selection | null => {
		if (path.length < 2) return null;
		if (path[0] !== 'zones') return null;
		const idx = path[1];
		if (typeof idx !== 'number') return null;
		return { kind: 'zone', indices: [idx] };
	},
	selectionToPath: (sel: Selection): NodePath => {
		if (sel.kind !== 'zone') return [];
		return ['zones', sel.indices[0]];
	},
});

/**
 * Back-compat alias retained for callers (and tests) that consume a bare
 * zone index. Returns -1 for paths the codec rejects so existing
 * "no selection" guards keep working.
 */
export function zonePathIndex(path: NodePath): number {
	const sel = zoneSelectionCodec.pathToSelection(path);
	return sel ? sel.indices[0] : -1;
}

/** Back-compat alias retained for tests. */
export function zoneIndexPath(zoneIndex: number): NodePath {
	return zoneSelectionCodec.selectionToPath({ kind: 'zone', indices: [zoneIndex] });
}

// ---------------------------------------------------------------------------
// Colors — matches Bundle-Manager's cyan-grid screenshot.
// ---------------------------------------------------------------------------

const ZONE_TYPE_RGB: Record<number, [number, number, number]> = {
	0: [0.32, 0.78, 0.94], // cyan, like Bundle-Manager
};
const FALLBACK_RGB: [number, number, number] = [0.6, 0.6, 0.6];

const SELECTED_COLOR = '#' + SELECTION_THEME.primary.getHexString();
const HOVERED_COLOR = '#' + SELECTION_THEME.hover.getHexString();
const SAFE_LINE_COLOR = '#7af07a';
const UNSAFE_LINE_COLOR = '#ff8a4a';
const IMMEDIATE_LINE_COLOR = '#ff3030';

// ---------------------------------------------------------------------------
// Batched zone geometry
// ---------------------------------------------------------------------------

export type BatchedZoneScene = {
	fillGeo: THREE.BufferGeometry;
	outlineGeo: THREE.BufferGeometry;
	/** triangle index → zone index */
	faceToZone: Int32Array;
	/** XZ centroids for adjacency lines (3 floats per zone) */
	centroids: Float32Array;
};

export function buildBatchedZones(zones: Zone[]): BatchedZoneScene {
	let totalFillVerts = 0;
	let totalFillIndices = 0;
	let totalOutlineVerts = 0;
	for (const z of zones) {
		const n = z.points.length;
		if (n < 3) continue;
		totalFillVerts += n;
		totalFillIndices += (n - 2) * 3;
		totalOutlineVerts += n * 2;
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

		const numTris = n - 2;
		for (let t = 0; t < numTris; t++) {
			indices[iOff] = baseVert;
			indices[iOff + 1] = baseVert + t + 1;
			indices[iOff + 2] = baseVert + t + 2;
			iOff += 3;
			faceToZone[fOff++] = zi;
		}

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
// Shared materials (kept module-scope so all overlay instances share GPU state)
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

const outlineMaterial = new THREE.LineBasicMaterial({
	color: 0x4ad0e8,
	transparent: true,
	opacity: 0.55,
});

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

type HoverState = { zoneIndex: number } | null;

function BatchedZones({
	scene,
	onPick,
	onHover,
}: {
	scene: BatchedZoneScene;
	onPick: (zoneIndex: number) => void;
	onHover: (state: HoverState) => void;
}) {
	const handleClick = useCallback((e: ThreeEvent<MouseEvent>) => {
		e.stopPropagation();
		if (e.faceIndex == null) return;
		const zi = scene.faceToZone[e.faceIndex];
		if (zi != null && zi >= 0) onPick(zi);
	}, [scene.faceToZone, onPick]);

	const handlePointerMove = useCallback((e: ThreeEvent<PointerEvent>) => {
		e.stopPropagation();
		if (e.faceIndex == null) { onHover(null); return; }
		const zi = scene.faceToZone[e.faceIndex];
		if (zi != null && zi >= 0) {
			onHover({ zoneIndex: zi });
			document.body.style.cursor = 'pointer';
		}
	}, [scene.faceToZone, onHover]);

	const handlePointerOut = useCallback(() => {
		onHover(null);
		document.body.style.cursor = 'auto';
	}, [onHover]);

	return (
		<>
			<mesh
				geometry={scene.fillGeo}
				material={fillMaterial}
				onClick={handleClick}
				onPointerMove={handlePointerMove}
				onPointerOut={handlePointerOut}
			/>
			<lineSegments geometry={scene.outlineGeo} material={outlineMaterial} />
		</>
	);
}

function ZoneOverlayMesh({ zone, color }: { zone: Zone; color: string }) {
	const geometry = useMemo(() => {
		if (zone.points.length < 3) return null;
		const shape = new THREE.Shape();
		shape.moveTo(zone.points[0].x, zone.points[0].y);
		for (let i = 1; i < zone.points.length; i++) {
			shape.lineTo(zone.points[i].x, zone.points[i].y);
		}
		shape.closePath();
		const geo = new THREE.ShapeGeometry(shape);
		// ShapeGeometry sits on XY; rotate +π/2 around X to land on the XZ
		// plane at world (x, 0, y) — matching the outline `<Line>` below.
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

	type LineSpec = { from: [number, number, number]; to: [number, number, number]; color: string; width: number };
	const lines: LineSpec[] = [];

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
// Overlay
// ---------------------------------------------------------------------------

type Props = {
	data: ParsedZoneList;
	selectedPath: NodePath;
	onSelect: (path: NodePath) => void;
	/** When true (default), draw lines from each selected zone to its safe +
	 *  unsafe neighbours so the streaming graph is visible at a glance. */
	showNeighbourGraph?: boolean;
};

export const ZoneListOverlay: WorldOverlayComponent<ParsedZoneList> = ({
	data,
	selectedPath,
	onSelect,
	showNeighbourGraph = true,
}: Props) => {
	const scene = useMemo(() => buildBatchedZones(data.zones), [data.zones]);
	const [hovered, setHovered] = useState<HoverState>(null);

	const selectedZoneIndex = useMemo(() => {
		const idx = zonePathIndex(selectedPath);
		return idx >= 0 && idx < data.zones.length ? idx : -1;
	}, [selectedPath, data.zones.length]);

	const handlePick = useCallback(
		(zoneIndex: number) => onSelect(zoneIndexPath(zoneIndex)),
		[onSelect],
	);

	const selectedZone = selectedZoneIndex >= 0 ? data.zones[selectedZoneIndex] : null;
	const hoveredZone =
		hovered && hovered.zoneIndex >= 0 && hovered.zoneIndex < data.zones.length
			? data.zones[hovered.zoneIndex]
			: null;

	return (
		<>
			<BatchedZones scene={scene} onPick={handlePick} onHover={setHovered} />

			{selectedZone && <ZoneOverlayMesh zone={selectedZone} color={SELECTED_COLOR} />}
			{hoveredZone && hovered?.zoneIndex !== selectedZoneIndex && (
				<ZoneOverlayMesh zone={hoveredZone} color={HOVERED_COLOR} />
			)}
			{selectedZone && (
				<ZoneLabel zone={selectedZone} index={selectedZoneIndex} color={SELECTED_COLOR} />
			)}
			{showNeighbourGraph && selectedZoneIndex >= 0 && (
				<NeighbourGraph data={data} zoneIndex={selectedZoneIndex} centroids={scene.centroids} />
			)}
		</>
	);
};

export default ZoneListOverlay;
