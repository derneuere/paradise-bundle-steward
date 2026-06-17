// Spec coverage for the PropCellGridOverlay pure helpers — the geometry math
// that turns a prop zone's cells into a grid region + plane height. The React
// rendering itself is exercised in the browser; these pin the math.

import { describe, it, expect } from 'vitest';
import { gridPlaneY, cellRegionBounds } from '../PropCellGridOverlay';
import type { ParsedPropInstanceData, PropCell, PropInstance } from '@/lib/core/propInstanceData';

function inst(y: number): PropInstance {
	const m = new Array(16).fill(0);
	m[13] = y; m[15] = 1;
	return {
		mWorldTransform: m, typeId: 0, flags: 0, muInstanceID: 0,
		muAlternativeType: 0xffff, mn8RotSpeed: 0, mn8MaxAngle: 0, mn8MinAngle: 0,
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
