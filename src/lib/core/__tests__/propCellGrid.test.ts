// Coverage for the prop cell-grid math (propCellGrid.ts). The worked example
// is the one the user verified by hand against the map textures:
//   -1400 ≤ x < -1300 and -2000 ≤ z < -1900  →  cell (muX=36, muZ=30).

import { describe, it, expect } from 'vitest';
import {
	PROP_CELL_SIZE,
	PROP_GRID_ORIGIN,
	propCellIndex,
	propCellId,
	propCellMin,
	propCellRect,
} from '../propCellGrid';

describe('propCellGrid', () => {
	it('maps the user-verified worked example', () => {
		expect(propCellId(-1400, -2000)).toEqual({ muX: 36, muZ: 30 });
		// Anywhere inside the half-open cell resolves to the same id.
		expect(propCellId(-1301, -1901)).toEqual({ muX: 36, muZ: 30 });
	});

	it('puts the grid origin at index 0 and is half-open at the upper edge', () => {
		expect(propCellIndex(PROP_GRID_ORIGIN)).toBe(0);
		expect(propCellIndex(PROP_GRID_ORIGIN + PROP_CELL_SIZE - 0.001)).toBe(0);
		expect(propCellIndex(PROP_GRID_ORIGIN + PROP_CELL_SIZE)).toBe(1);
	});

	it('handles the world centre and positive coordinates', () => {
		expect(propCellId(0, 0)).toEqual({ muX: 50, muZ: 50 });
		expect(propCellId(4999, 4999)).toEqual({ muX: 99, muZ: 99 });
	});

	it('round-trips id → world rect → id', () => {
		const { muX, muZ } = propCellId(2025.59, -1292.24); // gold instance[10]
		const rect = propCellRect(muX, muZ);
		expect(rect.x0).toBe(propCellMin(muX));
		expect(rect.x1 - rect.x0).toBe(PROP_CELL_SIZE);
		// The rect's lower corner sits in the same cell.
		expect(propCellId(rect.x0, rect.z0)).toEqual({ muX, muZ });
	});
});
