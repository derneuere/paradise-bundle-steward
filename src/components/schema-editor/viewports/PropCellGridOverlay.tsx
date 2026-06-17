// PropCellGridOverlay — WorldViewport overlay drawing the prop streaming grid.
//
// Prop instances are partitioned into 100 m × 100 m cells (see propCellGrid.ts);
// a cell's id is its (x, z) grid index, derived from world position via
// (pos + 5000) / 100. This overlay superimposes that grid on the world — the
// prop analogue of TrafficData's PVS grid (PvsGridOverlay) — so the user can
// read a prop's cell id off the map and confirm a PropCell's muX/muZ is right.
//
// What it draws (over the bounding region of this zone's populated cells):
//   - thin border lines for every cell in the region,
//   - a tinted fill + an id label on each POPULATED cell (one that owns props),
//   - a bright outline on the selected instance's containing cell and on the
//     selected cell.
// Clicking a populated cell selects it (['cells', i]); a checkbox in the chrome
// HTML slot toggles the whole grid (on by default), mirroring the PVS grid.

import { useCallback, useMemo, useState } from 'react';
import { Html } from '@react-three/drei';
import { type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { ParsedPropInstanceData, PropCell } from '@/lib/core/propInstanceData';
import { PROP_CELL_SIZE, propCellId, propCellRect } from '@/lib/core/propCellGrid';
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
export function cellRegionBounds(cells: PropCell[]): { minX: number; maxX: number; minZ: number; maxZ: number } | null {
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

function buildBorderGeometry(bounds: { minX: number; maxX: number; minZ: number; maxZ: number }, y: number): THREE.BufferGeometry {
	const { minX, maxX, minZ, maxZ } = bounds;
	const x0 = minX * PROP_CELL_SIZE - 5000;
	const z0 = minZ * PROP_CELL_SIZE - 5000;
	const nx = maxX - minX + 1;
	const nz = maxZ - minZ + 1;
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

	const y = useMemo(() => gridPlaneY(data), [data]);
	const bounds = useMemo(() => cellRegionBounds(cells), [cells]);
	const borderGeo = useMemo(() => (bounds ? buildBorderGeometry(bounds, y + BORDER_DY) : null), [bounds, y]);
	const fillGeo = useMemo(() => (cells.length ? buildFillGeometry(cells, y + FILL_DY) : null), [cells, y]);
	// These geometries are passed to R3F by reference (not declarative children),
	// so R3F won't auto-dispose them — free the old GPU buffers when the memo
	// re-runs. The two outline geometries below churn on every selection change.
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

	// Click a populated cell → select it. Convert the world hit point to a cell
	// id, then find the matching cell (cells are keyed by their (muX, muZ)).
	const onClick = useCallback((e: ThreeEvent<MouseEvent>) => {
		e.stopPropagation();
		if (isDragRelease(e.nativeEvent.clientX, e.nativeEvent.clientY)) return;
		const { muX, muZ } = propCellId(e.point.x, e.point.z);
		const idx = cells.findIndex((c) => c.muX === muX && c.muZ === muZ);
		if (idx >= 0) onSelect(['cells', idx] as NodePath);
	}, [cells, onSelect]);

	// Toggle checkbox in the chrome HTML slot — only while this overlay owns the
	// active selection, so sibling overlays don't stack toggles (issue #24).
	const htmlNode = useMemo(
		() =>
			bounds ? (
				<label
					style={{
						position: 'absolute', top: 8, right: 8,
						background: 'rgba(0,0,0,0.7)', color: '#cdd', padding: '4px 8px',
						borderRadius: 4, fontSize: 11, fontFamily: 'monospace',
						display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
						userSelect: 'none', pointerEvents: 'auto',
					}}
				>
					<input type="checkbox" checked={show} onChange={(ev) => setShow(ev.target.checked)} style={{ margin: 0 }} />
					Prop cell grid ({cells.length} cell{cells.length === 1 ? '' : 's'})
				</label>
			) : null,
		[bounds, show, cells.length],
	);
	useWorldViewportHtmlSlot(isActive ? htmlNode : null);

	if (!bounds || !show) return null;

	return (
		<>
			{fillGeo && (
				<mesh geometry={fillGeo} material={gridFillMat} renderOrder={1} onClick={onClick} />
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
			{/* Cell-id labels on populated cells. Prop zones are spatially local, so
			    the count stays small (a handful per track unit). */}
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
