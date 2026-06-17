// PropCellGridOverlay — WorldViewport overlay drawing the prop streaming grid.
//
// Prop instances are partitioned into 100 m × 100 m cells (see propCellGrid.ts);
// a cell's id is its (x, z) grid index, derived from world position via
// (pos + 5000) / 100. This overlay superimposes that grid on the world — the
// prop analogue of TrafficData's PVS grid (PvsGridOverlay) — so the user can
// read a prop's cell id off the map and confirm a PropCell's muX/muZ is right.
//
// Two modes (chrome HTML-slot checkboxes, only while propInstanceData is the
// active selection so sibling overlays don't fight for the slot):
//   - default: the grid spans the bounding region of this zone's populated cells.
//   - "show all cells": the full 100×100 world grid, so the user can read off
//     the cell id anywhere — even where no props are placed yet.
// What it draws: thin cell borders over the active region, a tinted fill + id
// label on each POPULATED cell, a bright outline on the selected instance's
// containing cell and on the selected cell. A transparent picking plane over the
// region turns a click into a cell id — the clicked cell is pinned with its
// (x, z) label (and selected if it's a populated PropCell), so the user never
// has to hand-calculate a coordinate.

import { useCallback, useMemo, useState } from 'react';
import { Html } from '@react-three/drei';
import { type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { ParsedPropInstanceData, PropCell } from '@/lib/core/propInstanceData';
import { PROP_CELL_SIZE, PROP_GRID_AXIS_CELLS, propCellId, propCellRect } from '@/lib/core/propCellGrid';
import { useDisposeOnDepsChange } from '@/hooks/useDisposeOnDepsChange';
import type { NodePath } from '@/lib/schema/walk';
import type { WorldOverlayComponent } from './WorldViewport.types';
import { useWorldViewportHtmlSlot } from './WorldViewport';
import { SELECTION_THEME, isDragRelease } from './selection';

// Sits just above the grid Y to avoid z-fighting between the fill and borders.
const FILL_DY = 0;
const BORDER_DY = 0.3;
const OUTLINE_DY = 0.6;

const gridFillMat = new THREE.MeshBasicMaterial({
	color: 0x33ddaa, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false,
});
const gridBorderMat = new THREE.LineBasicMaterial({
	color: 0xffffff, transparent: true, opacity: 0.18, depthWrite: false,
});
const selectedCellMat = new THREE.LineBasicMaterial({
	color: 0xffaa33, transparent: true, opacity: 0.95, depthTest: false,
});
const instanceCellMat = new THREE.LineBasicMaterial({
	color: '#' + SELECTION_THEME.primary.getHexString(), transparent: true, opacity: 0.9, depthTest: false,
});
const pinnedCellMat = new THREE.LineBasicMaterial({
	color: 0x66ffff, transparent: true, opacity: 0.95, depthTest: false,
});
// Invisible-but-pickable plane catching clicks over the whole grid region — the
// same trick TrafficData's PickingPlane uses. opacity 0 keeps it from drawing.
const pickPlaneMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });

// A click within this XZ radius (m²) of a placed prop is treated as "meant for
// the prop", so the picking plane lets it fall through to prop selection instead
// of pinning a cell — TrafficData's PickingPlane has the same open-space guard
// (findNearestRung). Coordinate-pinning is for empty ground / empty cells.
const PROP_PICK_SNAP_SQ = 5 * 5;

export type CellBounds = { minX: number; maxX: number; minZ: number; maxZ: number };

// ---------------------------------------------------------------------------
// Pure helpers (exported for tests)
// ---------------------------------------------------------------------------

/** Mean world Y of the placed props, so the flat grid floats near them rather
 *  than at sea level (Paradise terrain spans a wide altitude range). */
export function gridPlaneY(data: ParsedPropInstanceData): number {
	const n = data.instances.length;
	if (n === 0) return 0;
	let sum = 0;
	for (const inst of data.instances) sum += inst.mWorldTransform[13] ?? 0;
	return sum / n;
}

/** Inclusive (minX, maxX, minZ, maxZ) cell-index bounds of the populated cells,
 *  padded by one cell for context. Null when there are no cells. */
export function cellRegionBounds(cells: PropCell[]): CellBounds | null {
	if (cells.length === 0) return null;
	let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
	for (const c of cells) {
		if (c.muX < minX) minX = c.muX;
		if (c.muX > maxX) maxX = c.muX;
		if (c.muZ < minZ) minZ = c.muZ;
		if (c.muZ > maxZ) maxZ = c.muZ;
	}
	return { minX: minX - 1, maxX: maxX + 1, minZ: minZ - 1, maxZ: maxZ + 1 };
}

/** The full world grid: every cell of the canonical ±5000 / 100 m grid. Used by
 *  the "show all cells" mode so the user can read off a coordinate anywhere. */
export function fullGridBounds(): CellBounds {
	return { minX: 0, maxX: PROP_GRID_AXIS_CELLS - 1, minZ: 0, maxZ: PROP_GRID_AXIS_CELLS - 1 };
}

/** World-space XZ rectangle (+ centre/size) a cell-index region covers. */
export function regionWorldRect(b: CellBounds): { x0: number; z0: number; x1: number; z1: number; cx: number; cz: number; width: number; depth: number } {
	const x0 = b.minX * PROP_CELL_SIZE - 5000;
	const z0 = b.minZ * PROP_CELL_SIZE - 5000;
	const x1 = (b.maxX + 1) * PROP_CELL_SIZE - 5000;
	const z1 = (b.maxZ + 1) * PROP_CELL_SIZE - 5000;
	return { x0, z0, x1, z1, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, width: x1 - x0, depth: z1 - z0 };
}

/** A unit-cell rectangle outline as 4 line segments (8 vertices) at height y. */
function cellOutlinePositions(muX: number, muZ: number, y: number): Float32Array {
	const r = propCellRect(muX, muZ);
	return new Float32Array([
		r.x0, y, r.z0, r.x1, y, r.z0,
		r.x1, y, r.z0, r.x1, y, r.z1,
		r.x1, y, r.z1, r.x0, y, r.z1,
		r.x0, y, r.z1, r.x0, y, r.z0,
	]);
}

// ---------------------------------------------------------------------------
// Geometry builders
// ---------------------------------------------------------------------------

function buildBorderGeometry(bounds: CellBounds, y: number): THREE.BufferGeometry {
	const { x0, z0 } = regionWorldRect(bounds);
	const nx = bounds.maxX - bounds.minX + 1;
	const nz = bounds.maxZ - bounds.minZ + 1;
	const segs: number[] = [];
	for (let i = 0; i <= nx; i++) {
		const x = x0 + i * PROP_CELL_SIZE;
		segs.push(x, y, z0, x, y, z0 + nz * PROP_CELL_SIZE);
	}
	for (let j = 0; j <= nz; j++) {
		const z = z0 + j * PROP_CELL_SIZE;
		segs.push(x0, y, z, x0 + nx * PROP_CELL_SIZE, y, z);
	}
	const geo = new THREE.BufferGeometry();
	geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(segs), 3));
	return geo;
}

function buildFillGeometry(cells: PropCell[], y: number): THREE.BufferGeometry {
	const pos = new Float32Array(cells.length * 6 * 3);
	let p = 0;
	for (const c of cells) {
		const r = propCellRect(c.muX, c.muZ);
		const verts: [number, number][] = [
			[r.x0, r.z0], [r.x1, r.z0], [r.x1, r.z1],
			[r.x0, r.z0], [r.x1, r.z1], [r.x0, r.z1],
		];
		for (const [vx, vz] of verts) { pos[p++] = vx; pos[p++] = y; pos[p++] = vz; }
	}
	const geo = new THREE.BufferGeometry();
	geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
	geo.computeBoundingSphere();
	return geo;
}

// ---------------------------------------------------------------------------
// Overlay
// ---------------------------------------------------------------------------

export const PropCellGridOverlay: WorldOverlayComponent<ParsedPropInstanceData> = ({
	data, selectedPath, onSelect, isActive = true,
}) => {
	const cells = data?.cells ?? [];
	const [show, setShow] = useState(true);
	const [showAll, setShowAll] = useState(false);
	// The last cell the user clicked — pinned with its (x, z) so they don't have
	// to hand-calculate the coordinate. Independent of the inspector selection.
	const [pinned, setPinned] = useState<{ muX: number; muZ: number } | null>(null);

	const y = useMemo(() => gridPlaneY(data), [data]);
	const populatedBounds = useMemo(() => cellRegionBounds(cells), [cells]);
	// "Show all" expands the grid to the whole world; otherwise it hugs the
	// populated cells. Null only when neither mode has anything to draw.
	const region = useMemo(
		() => (showAll ? fullGridBounds() : populatedBounds),
		[showAll, populatedBounds],
	);

	const borderGeo = useMemo(() => (region ? buildBorderGeometry(region, y + BORDER_DY) : null), [region, y]);
	const fillGeo = useMemo(() => (cells.length ? buildFillGeometry(cells, y + FILL_DY) : null), [cells, y]);
	// These geometries are passed to R3F by reference (not declarative children),
	// so R3F won't auto-dispose them — free the old GPU buffers when the memo
	// re-runs. The outline geometries below churn on every selection/click.
	useDisposeOnDepsChange(() => borderGeo?.dispose(), [borderGeo]);
	useDisposeOnDepsChange(() => fillGeo?.dispose(), [fillGeo]);

	// Selected cell (a ['cells', i] selection) and the selected instance's
	// containing cell (a ['instances', i] selection → computed from position).
	const selectedCellOutline = useMemo(() => {
		if (selectedPath[0] !== 'cells' || typeof selectedPath[1] !== 'number') return null;
		const c = cells[selectedPath[1]];
		if (!c) return null;
		const geo = new THREE.BufferGeometry();
		geo.setAttribute('position', new THREE.BufferAttribute(cellOutlinePositions(c.muX, c.muZ, y + OUTLINE_DY), 3));
		return geo;
	}, [cells, selectedPath, y]);
	useDisposeOnDepsChange(() => selectedCellOutline?.dispose(), [selectedCellOutline]);

	const instanceCellOutline = useMemo(() => {
		if (selectedPath[0] !== 'instances' || typeof selectedPath[1] !== 'number') return null;
		const inst = data.instances[selectedPath[1]];
		if (!inst) return null;
		const { muX, muZ } = propCellId(inst.mWorldTransform[12] ?? 0, inst.mWorldTransform[14] ?? 0);
		const geo = new THREE.BufferGeometry();
		geo.setAttribute('position', new THREE.BufferAttribute(cellOutlinePositions(muX, muZ, y + OUTLINE_DY + 0.1), 3));
		return geo;
	}, [data, selectedPath, y]);
	useDisposeOnDepsChange(() => instanceCellOutline?.dispose(), [instanceCellOutline]);

	const pinnedOutline = useMemo(() => {
		if (!pinned) return null;
		const geo = new THREE.BufferGeometry();
		geo.setAttribute('position', new THREE.BufferAttribute(cellOutlinePositions(pinned.muX, pinned.muZ, y + OUTLINE_DY + 0.2), 3));
		return geo;
	}, [pinned, y]);
	useDisposeOnDepsChange(() => pinnedOutline?.dispose(), [pinnedOutline]);

	// Click anywhere on the grid → pin that cell's (x, z). If it's a populated
	// PropCell, also select it so the inspector tracks. Convert the world hit
	// point to a cell id via the shared formula.
	const onPick = useCallback((e: ThreeEvent<MouseEvent>) => {
		if (isDragRelease(e.nativeEvent.clientX, e.nativeEvent.clientY)) return;
		const px = e.point.x, pz = e.point.z;
		// Don't swallow clicks meant for a placed prop: if the hit is within a
		// prop's footprint, fall through (NO stopPropagation) so the prop overlay's
		// own onClick selects the instance. Pinning is for open ground / empty cells.
		for (const inst of data.instances) {
			const dx = (inst.mWorldTransform[12] ?? 0) - px;
			const dz = (inst.mWorldTransform[14] ?? 0) - pz;
			if (dx * dx + dz * dz <= PROP_PICK_SNAP_SQ) return;
		}
		e.stopPropagation();
		const { muX, muZ } = propCellId(px, pz);
		setPinned({ muX, muZ });
		const idx = cells.findIndex((c) => c.muX === muX && c.muZ === muZ);
		if (idx >= 0) onSelect(['cells', idx] as NodePath);
	}, [cells, data.instances, onSelect]);

	// Two checkboxes in the chrome HTML slot — only while this overlay owns the
	// active selection, so sibling overlays don't stack toggles (issue #24).
	const htmlNode = useMemo(
		() => (
			<div
				style={{
					position: 'absolute', top: 8, right: 8,
					background: 'rgba(0,0,0,0.7)', color: '#cdd', padding: '6px 8px',
					borderRadius: 4, fontSize: 11, fontFamily: 'monospace',
					display: 'flex', flexDirection: 'column', gap: 4,
					userSelect: 'none', pointerEvents: 'auto',
				}}
			>
				<label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
					<input type="checkbox" checked={show} onChange={(ev) => setShow(ev.target.checked)} style={{ margin: 0 }} />
					Prop cell grid ({cells.length} cell{cells.length === 1 ? '' : 's'})
				</label>
				<label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: show ? 'pointer' : 'default', opacity: show ? 1 : 0.5 }}>
					<input type="checkbox" checked={showAll} disabled={!show} onChange={(ev) => setShowAll(ev.target.checked)} style={{ margin: 0 }} />
					Show all cells
				</label>
				{pinned && (
					<div style={{ color: '#9ff', borderTop: '1px solid rgba(255,255,255,0.15)', paddingTop: 4 }}>
						cell ({pinned.muX}, {pinned.muZ})
					</div>
				)}
			</div>
		),
		[show, showAll, cells.length, pinned],
	);
	useWorldViewportHtmlSlot(isActive ? htmlNode : null);

	if (!show || !region) return null;

	const rect = regionWorldRect(region);

	return (
		<>
			{/* Transparent picking plane over the whole region — turns any click
			    into a cell id (works on empty cells too, the whole point of
			    "show all"). Only the ACTIVE bundle's plane is interactive, so
			    background bundles' grids never hijack a click; the near-prop guard
			    in onPick keeps real props selectable. Drawn below the visible grid. */}
			{isActive && (
				<mesh
					position={[rect.cx, y, rect.cz]}
					rotation={[-Math.PI / 2, 0, 0]}
					material={pickPlaneMat}
					onClick={onPick}
					renderOrder={0}
				>
					<planeGeometry args={[rect.width, rect.depth]} />
				</mesh>
			)}
			{fillGeo && (
				<mesh geometry={fillGeo} material={gridFillMat} renderOrder={1} raycast={() => undefined as unknown as void} />
			)}
			{borderGeo && (
				<lineSegments geometry={borderGeo} material={gridBorderMat} renderOrder={2} raycast={() => undefined as unknown as void} />
			)}
			{instanceCellOutline && (
				<lineSegments geometry={instanceCellOutline} material={instanceCellMat} renderOrder={6} />
			)}
			{selectedCellOutline && (
				<lineSegments geometry={selectedCellOutline} material={selectedCellMat} renderOrder={7} />
			)}
			{pinnedOutline && (
				<lineSegments geometry={pinnedOutline} material={pinnedCellMat} renderOrder={8} />
			)}
			{/* The clicked cell's coordinate, pinned in the world at that cell. */}
			{pinned && (() => {
				const r = propCellRect(pinned.muX, pinned.muZ);
				return (
					<Html position={[(r.x0 + r.x1) / 2, y + OUTLINE_DY + 0.3, (r.z0 + r.z1) / 2]} center style={{ pointerEvents: 'none' }}>
						<div style={{
							background: 'rgba(0,40,40,0.85)', color: '#9ff', padding: '2px 6px',
							borderRadius: 3, fontSize: 11, whiteSpace: 'nowrap', fontFamily: 'monospace', fontWeight: 'bold',
						}}>
							{pinned.muX}, {pinned.muZ}
						</div>
					</Html>
				);
			})()}
			{/* Cell-id labels on populated cells. Prop zones are spatially local, so
			    the count stays small (a handful per track unit) even in show-all. */}
			{cells.map((c, i) => {
				const r = propCellRect(c.muX, c.muZ);
				return (
					<Html
						key={`${c.muX}:${c.muZ}:${i}`}
						position={[(r.x0 + r.x1) / 2, y + OUTLINE_DY, (r.z0 + r.z1) / 2]}
						center
						style={{ pointerEvents: 'none' }}
					>
						<div style={{
							background: 'rgba(0,0,0,0.6)', color: '#9fe', padding: '1px 4px',
							borderRadius: 3, fontSize: 9, whiteSpace: 'nowrap', fontFamily: 'monospace',
						}}>
							{c.muX}, {c.muZ}
						</div>
					</Html>
				);
			})}
		</>
	);
};
