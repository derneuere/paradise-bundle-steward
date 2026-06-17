// Prop cell grid — the coarse XZ streaming grid that PropInstanceData (0x10011)
// partitions its instances into.
//
// Domain: prop instances are divided into 100 m × 100 m cells. A cell's id is
// its (x, z) grid index. The runtime derives the id from the instance's world
// position, but the editor must be able to compute and verify it too — some
// external tools require setting PropCell.muX / muZ by hand, and the cell-grid
// overlay needs cell↔world geometry.
//
// The mapping is `index = floor((pos + 5000) / 100)`, i.e. world coordinate
// -5000 maps to grid index 0. Worked example: for -1400 ≤ x < -1300 and
// -2000 ≤ z < -1900 the cell id is (muX=36, muZ=30). The reference map textures
// Criterion shipped are imperfectly scaled, so this formula — not the texture —
// is authoritative.
//
// Pure (no THREE / no React) so it can be unit-tested in node and shared by the
// schema labels and the 3D overlay alike.

/** Cell edge length in world metres. */
export const PROP_CELL_SIZE = 100;

/** World coordinate that maps to grid index 0 (both axes). */
export const PROP_GRID_ORIGIN = -5000;

/** Number of cells along each axis for the canonical ±5000 world (10000 / 100). */
export const PROP_GRID_AXIS_CELLS = 100;

export type PropCellId = { muX: number; muZ: number };

/** World axis coordinate → grid index along that axis: floor((pos + 5000) / 100). */
export function propCellIndex(pos: number): number {
	return Math.floor((pos - PROP_GRID_ORIGIN) / PROP_CELL_SIZE);
}

/** World (x, z) → cell id (muX, muZ). y is irrelevant — the grid is on the ground plane. */
export function propCellId(x: number, z: number): PropCellId {
	return { muX: propCellIndex(x), muZ: propCellIndex(z) };
}

/** Lowest world coordinate owned by the cell at this grid index along an axis. */
export function propCellMin(index: number): number {
	return index * PROP_CELL_SIZE + PROP_GRID_ORIGIN;
}

export type PropCellRect = { x0: number; z0: number; x1: number; z1: number };

/** World-space XZ rectangle a cell (muX, muZ) covers. */
export function propCellRect(muX: number, muZ: number): PropCellRect {
	const x0 = propCellMin(muX);
	const z0 = propCellMin(muZ);
	return { x0, z0, x1: x0 + PROP_CELL_SIZE, z1: z0 + PROP_CELL_SIZE };
}
