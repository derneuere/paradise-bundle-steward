// PolygonSoupList picker labels: the triangle count is memoised per model
// object, so an edit (which always yields a new model) must relabel while
// re-reading the same model must not recount.

import { describe, it, expect } from 'vitest';
import type { ParsedPolygonSoupList, PolygonSoup } from '@/lib/core/polygonSoupList';
import { polygonSoupListHandler } from '../polygonSoupList';

const soup = (quads: number, tris: number): PolygonSoup => ({
	vertexOffsets: [0, 0, 0],
	comprGranularity: 1,
	numQuads: quads,
	padding: [0, 0, 0],
	vertices: [{ x: 0, y: 0, z: 0 }],
	polygons: [
		...Array.from({ length: quads }, () => ({ collisionTag: 0, vertexIndices: [0, 0, 0, 0] as [number, number, number, number], edgeCosines: [0, 0, 0, 0] as [number, number, number, number] })),
		...Array.from({ length: tris }, () => ({ collisionTag: 0, vertexIndices: [0, 0, 0, 0xFF] as [number, number, number, number], edgeCosines: [0, 0, 0, 0] as [number, number, number, number] })),
	],
	min: { x: 0, y: 0, z: 0 },
	max: { x: 0, y: 0, z: 0 },
	offset: 0,
	verticesOffset: 0,
	polygonsOffset: 0,
	dataSize: 0,
});

const model = (soups: PolygonSoup[]): ParsedPolygonSoupList => ({
	overallMin: { x: 0, y: 0, z: 0 },
	overallMinPadding: 0,
	overallMax: { x: 0, y: 0, z: 0 },
	overallMaxPadding: 0,
	soups,
	rowValidMasks: [],
	dataSize: 0,
	totalSize: 0,
	chunkPointerStart: 0,
	boxListStart: 0,
});

const label = (m: ParsedPolygonSoupList) =>
	polygonSoupListHandler.picker!.labelOf(m, { name: 'TRK_COL_1', index: 0 } as never).secondary;

describe('polygonSoupList picker labels', () => {
	it('counts quads as two triangles', () => {
		expect(label(model([soup(2, 1)]))).toBe('1 soup · 5 tris');
	});

	it('relabels an edited model (new object) instead of reusing the cached count', () => {
		const before = model([soup(2, 1)]);
		expect(label(before)).toBe('1 soup · 5 tris');
		const after = { ...before, soups: [...before.soups, soup(0, 3)] };
		expect(label(after)).toBe('2 soups · 8 tris');
		expect(label(before)).toBe('1 soup · 5 tris');
	});
});
