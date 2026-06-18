// Spec coverage for the PropCellGridOverlay pure helpers — the geometry math
// that turns a prop zone's cells into a grid region + plane height. The React
// rendering itself is exercised in the browser; these pin the math.

import { describe, it, expect } from 'vitest';
import { gridPlaneY, cellRegionBounds, fullGridBounds, regionWorldRect } from '../PropCellGridOverlay';
import { PROP_GRID_AXIS_CELLS, propCellId } from '@/lib/core/propCellGrid';
import type { ParsedPropInstanceData, PropCell, PropInstance } from '@/lib/core/propInstanceData';

function inst(y: number): PropInstance {
	const m = new Array(16).fill(0);
	m[13] = y; m[15] = 1;
	return {
		mWorldTransform: m, typeId: 0, flags: 0, muInstanceID: 0,
		muAlternativeType: 0xffff, mRotationAxis: 0, mn8RotSpeed: 0, mn8MaxAngle: 0, mn8MinAngle: 0,
		_pad4D: [0, 0, 0],
	};
}

function cell(muX: number, muZ: number): PropCell {
	return { muX, muZ, muStartIndex: 0, muCount: 0, muNumberOfRespawnDifferent: 0, muNumberOfDontRespawn: 0 };
}

function pid(instances: PropInstance[], cells: PropCell[]): ParsedPropInstanceData {
	return { muZoneId: 0, muSizeInBytes: 0, muNumberOfInstances: instances.length, instances, cells, _trailingPad: new Uint8Array(0) };
}

describe('gridPlaneY', () => {
	it('averages the instance Y so the grid floats near the props', () => {
		expect(gridPlaneY(pid([inst(10), inst(20), inst(30)], []))).toBe(20);
	});
	it('is 0 for an empty zone', () => {
		expect(gridPlaneY(pid([], []))).toBe(0);
	});
});

describe('cellRegionBounds', () => {
	it('returns the populated-cell extent padded by one cell', () => {
		expect(cellRegionBounds([cell(36, 30), cell(40, 33), cell(38, 31)])).toEqual({
			minX: 35, maxX: 41, minZ: 29, maxZ: 34,
		});
	});
	it('is null when there are no cells', () => {
		expect(cellRegionBounds([])).toBeNull();
	});
});

describe('fullGridBounds (show-all mode)', () => {
	it('spans the whole canonical grid', () => {
		expect(fullGridBounds()).toEqual({ minX: 0, maxX: PROP_GRID_AXIS_CELLS - 1, minZ: 0, maxZ: PROP_GRID_AXIS_CELLS - 1 });
	});
});

describe('regionWorldRect', () => {
	it('maps a single-cell region to that cell\'s world rect', () => {
		const r = regionWorldRect({ minX: 36, maxX: 36, minZ: 30, maxZ: 30 });
		// cell 36 → x in [-1400, -1300); cell 30 → z in [-2000, -1900).
		expect(r).toMatchObject({ x0: -1400, x1: -1300, z0: -2000, z1: -1900, cx: -1350, cz: -1950, width: 100, depth: 100 });
	});

	it('covers the full world in show-all', () => {
		const r = regionWorldRect(fullGridBounds());
		expect(r).toMatchObject({ x0: -5000, z0: -5000, x1: 5000, z1: 5000, width: 10000, depth: 10000 });
	});

	it('a click anywhere in the region resolves to a cell inside it (picking-plane contract)', () => {
		const r = regionWorldRect(fullGridBounds());
		// The picking plane spans [x0,x1]×[z0,z1]; a hit at world (cx,cz) → centre cell.
		const { muX, muZ } = propCellId(r.cx, r.cz);
		expect(muX).toBe(50);
		expect(muZ).toBe(50);
	});
});
