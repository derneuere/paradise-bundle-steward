// ZoneListOverlay — WorldViewport overlay for the streaming-PVS zones.
//
// Pure function of `(data, selectedPath, onSelect)`: renders all zones as a
// batched fill+outline mesh, picks zone-on-click, paints the selected /
// hovered zone in-mesh via the shared `useBatchedSelection` hook, and draws
// a green/orange/red neighbour graph from the selected zone's centroid to
// its safe / unsafe / IMMEDIATE neighbours.
//
// Selection currency is the schema NodePath (ADR-0001). The overlay matches
// `['zones', i, ...]` paths for highlight and emits `['zones', i]` paths on
// click. Anything outside `['zones', ...]` reads as "no selection".
//
// Performance notes mirror ZoneListViewport: every zone is fan-triangulated
// into one merged BufferGeometry (2 draw calls) with a face-index → zone
// mapping for click picking. The merged-geometry `applyColor` rewrites the
// vertex colors for one zone at a time so a hover hop only touches the
// vertices that actually changed state.

import { useCallback, useMemo, useRef, useState } from 'react';
import { Html, Line } from '@react-three/drei';
import * as THREE from 'three';
import {
	type ParsedZoneList,
	type Zone,
	NEIGHBOUR_FLAGS,
} from '@/lib/core/zoneList';
import {
	ZONE_POINT_AXES,
	bulkRotateZoneEntitiesYaw,
	bulkTranslateZoneEntities,
	translateZoneRigid,
	zoneListSelectionPivot,
	type ZoneListEntityRef,
} from '@/lib/core/zoneListOps';
import { BulkTransformGizmo } from '@/components/common/three/BulkTransformGizmo';
import {
	type BulkTransformDelta,
	isIdentityDelta,
} from '@/hooks/useBulkTransformDrag';
import type { NodePath } from '@/lib/schema/walk';
import type { WorldOverlayComponent } from './WorldViewport.types';
import {
	defineSelectionCodec,
	SELECTION_THEME,
	useBatchedSelection,
	type Selection,
} from './selection';

// ---------------------------------------------------------------------------
// Path ↔ Selection codec (exported for tests)
// ---------------------------------------------------------------------------

/**
 * Codec for the streaming-PVS zones. Sub-paths inside a zone (e.g.
 * `['zones', i, 'safeNeighbours', n]`) collapse to "this zone is selected".
 */
export const zoneSelectionCodec = defineSelectionCodec({
	pathToSelection: (path: NodePath): Selection | null => {
		if (path.length < 2 || path[0] !== 'zones') return null;
		const idx = path[1];
		if (typeof idx !== 'number') return null;
		return { kind: 'zone', indices: [idx] };
	},
	selectionToPath: (sel: Selection): NodePath =>
		sel.kind === 'zone' ? ['zones', sel.indices[0]] : [],
});

/** Back-compat: returns -1 for paths the codec rejects. */
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
	/** First vertex slot for zone i in the fill color attribute. */
	zoneVertexStart: Int32Array;
	/** Vertex count for zone i in the fill color attribute (0 for invalid zones). */
	zoneVertexCount: Int32Array;
	/** Base RGB the paint loop restores for the `'none'` state. */
	zoneBaseRgb: Float32Array;
};

export function buildBatchedZones(zones: Zone[]): BatchedZoneScene {
	let totalFillVerts = 0, totalFillIndices = 0, totalOutlineVerts = 0;
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
	const zoneVertexStart = new Int32Array(zones.length);
	const zoneVertexCount = new Int32Array(zones.length);
	const zoneBaseRgb = new Float32Array(zones.length * 3);

	let vOff = 0, iOff = 0, fOff = 0, oOff = 0;
	for (let zi = 0; zi < zones.length; zi++) {
		const z = zones[zi];
		const n = z.points.length;
		let cx = 0, cy = 0;
		for (const p of z.points) { cx += p.x; cy += p.y; }
		centroids[zi * 3] = cx / (n || 1);
		centroids[zi * 3 + 2] = cy / (n || 1);
		zoneVertexStart[zi] = vOff / 3;
		if (n < 3) continue;

		const rgb = ZONE_TYPE_RGB[z.miZoneType] ?? FALLBACK_RGB;
		zoneVertexCount[zi] = n;
		zoneBaseRgb[zi * 3] = rgb[0]; zoneBaseRgb[zi * 3 + 1] = rgb[1]; zoneBaseRgb[zi * 3 + 2] = rgb[2];
		const baseVert = vOff / 3;

		for (let pi = 0; pi < n; pi++) {
			positions[vOff] = z.points[pi].x;
			positions[vOff + 1] = 0.1;
			positions[vOff + 2] = z.points[pi].y;
			colors[vOff] = rgb[0]; colors[vOff + 1] = rgb[1]; colors[vOff + 2] = rgb[2];
			vOff += 3;
		}
		for (let t = 0; t < n - 2; t++) {
			indices[iOff++] = baseVert;
			indices[iOff++] = baseVert + t + 1;
			indices[iOff++] = baseVert + t + 2;
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

	return { fillGeo, outlineGeo, faceToZone, centroids, zoneVertexStart, zoneVertexCount, zoneBaseRgb };
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

const EMPTY_BULK: ReadonlySet<string> = new Set();

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function NeighbourGraph({ data, zoneIndex, centroids }: {
	data: ParsedZoneList; zoneIndex: number; centroids: Float32Array;
}) {
	const zone = data.zones[zoneIndex];
	if (!zone) return null;
	const src: [number, number, number] = [centroids[zoneIndex * 3], 2, centroids[zoneIndex * 3 + 2]];

	type LineSpec = { from: [number, number, number]; to: [number, number, number]; color: string; width: number };
	const lines: LineSpec[] = [];
	const addLine = (n: { zoneIndex: number; muFlags: number }, base: string) => {
		if (n.zoneIndex < 0 || n.zoneIndex >= data.zones.length) return;
		const isImmediate = (n.muFlags & NEIGHBOUR_FLAGS.IMMEDIATE) !== 0;
		lines.push({
			from: src,
			to: [centroids[n.zoneIndex * 3], 2, centroids[n.zoneIndex * 3 + 2]],
			color: isImmediate ? '#ff3030' : base,
			width: isImmediate ? 2.5 : 1.5,
		});
	};
	for (const n of zone.safeNeighbours) addLine(n, '#7af07a');
	for (const n of zone.unsafeNeighbours) addLine(n, '#ff8a4a');

	return <>{lines.map((ln, i) => (
		<Line key={i} points={[ln.from, ln.to]} color={ln.color} lineWidth={ln.width} />
	))}</>;
}

function ZoneLabel({ zone, index, color }: { zone: Zone; index: number; color: string }) {
	if (zone.points.length < 4) return null;
	const cx = (zone.points[0].x + zone.points[2].x) / 2;
	const cz = (zone.points[0].y + zone.points[2].y) / 2;
	return (
		<Html position={[cx, 4, cz]} center distanceFactor={300} style={{ pointerEvents: 'none' }}>
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
	/** Present when the parent route can apply edits — the Bulk-transform
	 *  gizmo emits the next root through this callback on commit. */
	onChange?: (next: ParsedZoneList) => void;
};

export const ZoneListOverlay: WorldOverlayComponent<ParsedZoneList> = ({
	data, selectedPath, onSelect, showNeighbourGraph = true, onChange,
}: Props) => {
	const scene = useMemo(() => buildBatchedZones(data.zones), [data.zones]);
	const [hovered, setHovered] = useState<Selection | null>(null);
	const primary = useMemo(() => zoneSelectionCodec.pathToSelection(selectedPath), [selectedPath]);
	const selectedZoneIndex = primary && primary.indices[0] < data.zones.length ? primary.indices[0] : -1;

	// Stamp the chosen color across every vertex of zone i in the merged
	// fill geometry. The hook decides which color to pass us per state.
	const applyColor = useCallback((i: number, color: THREE.Color) => {
		const attr = scene.fillGeo.getAttribute('color') as THREE.BufferAttribute | undefined;
		if (!attr) return;
		const arr = attr.array as Float32Array;
		const start = scene.zoneVertexStart[i];
		const end = start + scene.zoneVertexCount[i];
		for (let v = start; v < end; v++) {
			const o = v * 3;
			arr[o] = color.r; arr[o + 1] = color.g; arr[o + 2] = color.b;
		}
		attr.needsUpdate = true;
	}, [scene.fillGeo, scene.zoneVertexStart, scene.zoneVertexCount]);

	const baseColorFor = useCallback((i: number) => new THREE.Color(
		scene.zoneBaseRgb[i * 3], scene.zoneBaseRgb[i * 3 + 1], scene.zoneBaseRgb[i * 3 + 2],
	), [scene.zoneBaseRgb]);

	const faceToEntity = useCallback(
		(face: number) => face >= 0 && face < scene.faceToZone.length ? scene.faceToZone[face] : -1,
		[scene.faceToZone],
	);

	const handlers = useBatchedSelection({
		kind: 'zone',
		count: data.zones.length,
		primary,
		bulk: EMPTY_BULK,
		hovered,
		faceToEntity,
		applyColor,
		baseColorFor,
		onPick: useCallback((sel: Selection) => onSelect(zoneSelectionCodec.selectionToPath(sel)), [onSelect]),
		onHover: setHovered,
	});

	const selectedZone = selectedZoneIndex >= 0 ? data.zones[selectedZoneIndex] : null;
	// Strong outline ring drawn for the currently-selected zone — the underlying
	// batched mesh is also painted orange (via applyColor), but the outline ring
	// is what sells "this is selected" at a glance from any camera distance.
	const outlinePoints = useMemo<[number, number, number][] | null>(() => {
		if (!selectedZone || selectedZone.points.length < 3) return null;
		const pts: [number, number, number][] = selectedZone.points.map((p) => [p.x, 0.4, p.y]);
		pts.push([selectedZone.points[0].x, 0.4, selectedZone.points[0].y]);
		return pts;
	}, [selectedZone]);

	// =========================================================================
	// Bulk-transform gizmo (issue #79)
	//
	// Single-zone selection only in this slice — multi-zone bulk-select would
	// flow through the workspace bulk Set (mirrors AISections' pattern). The
	// gizmo anchors at the selected zone's median XZ; on commit we drop the
	// delta.y because zone points are `Vec2Padded` (XZ-only, ADR-0011).
	// =========================================================================
	const bulkRefs = useMemo<readonly ZoneListEntityRef[]>(
		() => (selectedZone ? [{ kind: 'zone', zoneIdx: selectedZoneIndex }] : []),
		[selectedZone, selectedZoneIndex],
	);
	// Snapshot the pivot at gesture start so it doesn't drift mid-rotate — see
	// the AISectionsOverlay comment for the rationale (re-deriving the median
	// against moving positions every frame produces a spiral instead of a
	// rigid rotate).
	const bulkPivotRef = useRef<{ x: number; y: number; z: number } | null>(null);
	const bulkPivotLive = useMemo(
		() => (bulkRefs.length > 0 ? zoneListSelectionPivot(data, bulkRefs) : null),
		[data, bulkRefs],
	);
	const [dragDelta, setDragDelta] = useState<BulkTransformDelta | null>(null);

	const gizmoPosition = useMemo<[number, number, number] | null>(() => {
		const pivot = bulkPivotRef.current ?? bulkPivotLive;
		if (!pivot) return null;
		const dx = dragDelta?.translate.x ?? 0;
		const dz = dragDelta?.translate.z ?? 0;
		// Lift slightly above the fill mesh so the gizmo is grabbable.
		return [pivot.x + dx, pivot.y + 1.5, pivot.z + dz];
	}, [bulkPivotLive, dragDelta]);

	const handleGizmoTransform = useCallback((delta: BulkTransformDelta) => {
		if (!bulkPivotRef.current && bulkPivotLive) {
			bulkPivotRef.current = bulkPivotLive;
		}
		setDragDelta(delta);
	}, [bulkPivotLive]);

	const handleGizmoCommit = useCallback((delta: BulkTransformDelta) => {
		setDragDelta(null);
		const pivot = bulkPivotRef.current;
		bulkPivotRef.current = null;
		if (!onChange) return;
		if (bulkRefs.length === 0) return;
		if (isIdentityDelta(delta)) return;
		let next = data;
		// Translate first, then yaw rotate around the post-translate pivot —
		// mirrors the AI sections gizmo's compose order so preview and commit
		// agree frame-for-frame. translate.y is discarded for the zone points
		// (XZ-packed per ADR-0011) — the gizmo's Y arrow still renders but
		// the model has no slot to receive it.
		if (delta.translate.x !== 0 || delta.translate.z !== 0) {
			// Whole-zone refs only in this slice — use the bulk op so the same
			// code path is hot when multi-zone bulk-select lands later.
			next = bulkTranslateZoneEntities(next, bulkRefs, {
				x: delta.translate.x,
				z: delta.translate.z,
			});
		}
		if (delta.rotate.y !== 0 && pivot) {
			next = bulkRotateZoneEntitiesYaw(
				next,
				bulkRefs,
				{ x: pivot.x + delta.translate.x, z: pivot.z + delta.translate.z },
				delta.rotate.y,
			);
		}
		if (next !== data) onChange(next);
	}, [data, onChange, bulkRefs]);

	const handleGizmoCancel = useCallback(() => {
		setDragDelta(null);
		bulkPivotRef.current = null;
	}, []);

	// Suppress unused warning — single-zone translate helper available for
	// future per-point selections; the bulk op covers today's whole-zone path.
	void translateZoneRigid;

	return (
		<>
			<mesh
				geometry={scene.fillGeo}
				material={fillMaterial}
				onClick={handlers.onClick}
				onPointerMove={handlers.onPointerMove}
				onPointerOut={handlers.onPointerOut}
			/>
			<lineSegments geometry={scene.outlineGeo} material={outlineMaterial} />
			{outlinePoints && <Line points={outlinePoints} color={SELECTED_COLOR} lineWidth={2.5} />}
			{selectedZone && <ZoneLabel zone={selectedZone} index={selectedZoneIndex} color={SELECTED_COLOR} />}
			{showNeighbourGraph && selectedZoneIndex >= 0 && (
				<NeighbourGraph data={data} zoneIndex={selectedZoneIndex} centroids={scene.centroids} />
			)}
			{onChange && gizmoPosition && (
				<BulkTransformGizmo
					position={gizmoPosition}
					axes={ZONE_POINT_AXES}
					onTransform={handleGizmoTransform}
					onCommit={handleGizmoCommit}
					onCancel={handleGizmoCancel}
				/>
			)}
		</>
	);
};
