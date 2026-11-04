// Per-resource PolygonSoupList chunk spec: geometry layout, the identity
// cache that keeps edits cheap, the highlight repaint, and marquee picking.

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import type { ParsedPolygonSoupList, PolygonSoupPoly } from '@/lib/core/polygonSoupList';
import {
	buildSoupChunk,
	getSoupChunk,
	paintSoupChunk,
	pickChunkPolysInFrustum,
	tagToColor,
	SOUP_PAINT_AMBER,
} from '../polygonSoupChunk';
import { encodeSoupPoly } from '../polygonSoupListContext';

const poly = (collisionTag: number, vertexIndices: PolygonSoupPoly['vertexIndices']): PolygonSoupPoly => ({
	collisionTag,
	vertexIndices,
	edgeCosines: [0, 0, 0, 0],
});

// One soup: a unit quad on the XZ plane (poly 0) plus a triangle off to the
// side (poly 1). Granularity 1 and zero offsets so packed == world coords.
function makeModel(): ParsedPolygonSoupList {
	return {
		overallMin: { x: 0, y: 0, z: 0 },
		overallMinPadding: 0,
		overallMax: { x: 0, y: 0, z: 0 },
		overallMaxPadding: 0,
		rowValidMasks: [],
		dataSize: 0,
		totalSize: 0,
		chunkPointerStart: 0,
		boxListStart: 0,
		soups: [{
			vertexOffsets: [0, 0, 0],
			comprGranularity: 1,
			numQuads: 1,
			padding: [0, 0, 0],
			vertices: [
				{ x: 0, y: 0, z: 0 },
				{ x: 1, y: 0, z: 0 },
				{ x: 1, y: 0, z: 1 },
				{ x: 0, y: 0, z: 1 },
				{ x: 10, y: 2, z: 10 },
			],
			polygons: [
				poly(0x00010002, [0, 1, 2, 3]),
				poly(0x00030004, [1, 4, 2, 0xFF]),
			],
			min: { x: 0, y: 0, z: 0 },
			max: { x: 10, y: 2, z: 10 },
			offset: 0,
			verticesOffset: 0,
			polygonsOffset: 0,
			dataSize: 0,
		}],
	};
}

const colorsOf = (g: THREE.BufferGeometry) =>
	(g.getAttribute('color') as THREE.BufferAttribute).array as Float32Array;

describe('buildSoupChunk', () => {
	it('emits two triangles per quad and one per triangle, mapped back to their polygon', () => {
		const chunk = buildSoupChunk(makeModel());
		expect(chunk.triangleCount).toBe(3);
		expect(chunk.soupCount).toBe(1);
		expect(Array.from(chunk.faceToPoly)).toEqual([0, 0, 0, 0, 0, 1]);
	});

	it('writes the quad as (a, b, c) + (d, c, b)', () => {
		const pos = (buildSoupChunk(makeModel()).geometry.getAttribute('position') as THREE.BufferAttribute)
			.array as Float32Array;
		expect(Array.from(pos.slice(0, 9))).toEqual([0, 0, 0, 1, 0, 0, 1, 0, 1]);
		expect(Array.from(pos.slice(9, 18))).toEqual([0, 0, 1, 1, 0, 1, 1, 0, 0]);
	});

	it('colors every vertex of a polygon from its collision tag', () => {
		const chunk = buildSoupChunk(makeModel());
		const expected: [number, number, number] = [0, 0, 0];
		tagToColor(0x00030004, expected);
		const tri2 = Array.from(colorsOf(chunk.geometry).slice(18, 27));
		for (let k = 0; k < 9; k += 3) {
			expect(tri2[k]).toBeCloseTo(expected[0], 6);
			expect(tri2[k + 1]).toBeCloseTo(expected[1], 6);
			expect(tri2[k + 2]).toBeCloseTo(expected[2], 6);
		}
	});

	it('carries no normal attribute (flat shading derives normals in the shader)', () => {
		expect(buildSoupChunk(makeModel()).geometry.getAttribute('normal')).toBeUndefined();
	});

	it('records world bounds and a bounding sphere for raycast culling', () => {
		const chunk = buildSoupChunk(makeModel());
		expect(chunk.bounds.min.toArray()).toEqual([0, 0, 0]);
		expect(chunk.bounds.max.toArray()).toEqual([10, 2, 10]);
		expect(chunk.geometry.boundingSphere).not.toBeNull();
	});

	it('clamps out-of-range vertex indices to vertex 0 instead of throwing', () => {
		const model = makeModel();
		model.soups[0].polygons = [poly(0, [0, 1, 99, 0xFF])];
		const pos = (buildSoupChunk(model).geometry.getAttribute('position') as THREE.BufferAttribute).array;
		expect(Array.from(pos.slice(6, 9))).toEqual([0, 0, 0]);
	});
});

describe('raycast picking', () => {
	// The chunk mesh maps a hit's faceIndex through faceToPoly; this pins
	// that three reports faceIndex as the non-indexed triangle number and
	// that the box-derived bounding sphere doesn't cull a real hit.
	const pick = (x: number, z: number) => {
		const chunk = buildSoupChunk(makeModel());
		const mesh = new THREE.Mesh(chunk.geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
		const hits = new THREE.Raycaster(new THREE.Vector3(x, 50, z), new THREE.Vector3(0, -1, 0)).intersectObject(mesh);
		if (hits.length === 0) return null;
		const f = hits[0].faceIndex!;
		return [chunk.faceToPoly[f * 2], chunk.faceToPoly[f * 2 + 1]];
	};

	it('resolves both quad triangles to the quad polygon', () => {
		expect(pick(0.8, 0.2)).toEqual([0, 0]);
		expect(pick(0.2, 0.8)).toEqual([0, 0]);
	});

	it('resolves the standalone triangle to its own polygon', () => {
		expect(pick(4, 3.6)).toEqual([0, 1]);
	});

	it('misses outside the geometry', () => {
		expect(pick(-5, -5)).toBeNull();
	});
});

describe('getSoupChunk', () => {
	it('returns the cached chunk for the same model object', () => {
		const model = makeModel();
		expect(getSoupChunk(model)).toBe(getSoupChunk(model));
	});

	it('rebuilds for a new model object, so an edit only rebuilds the edited resource', () => {
		const model = makeModel();
		const edited = { ...model, soups: [...model.soups] };
		expect(getSoupChunk(edited)).not.toBe(getSoupChunk(model));
	});
});

describe('paintSoupChunk', () => {
	it('brightens the selected resource and stamps bulk polys amber', () => {
		const chunk = buildSoupChunk(makeModel());
		paintSoupChunk(chunk, true, new Set([encodeSoupPoly(0, 1)]));
		const colors = colorsOf(chunk.geometry);
		expect(colors[0]).toBeCloseTo(Math.min(1, chunk.baseColors[0] * 1.6 + 0.15), 6);
		expect(Array.from(colors.slice(18, 21))).toEqual(SOUP_PAINT_AMBER.map(Math.fround));
		expect(chunk.painted).toBe(true);
	});

	it('restores base colors when the resource is deselected', () => {
		const chunk = buildSoupChunk(makeModel());
		paintSoupChunk(chunk, true, new Set([encodeSoupPoly(0, 0)]));
		paintSoupChunk(chunk, false, new Set());
		expect(Array.from(colorsOf(chunk.geometry))).toEqual(Array.from(chunk.baseColors));
		expect(chunk.painted).toBe(false);
	});

	it('leaves an unpainted, unselected chunk alone so it is not re-uploaded', () => {
		const chunk = buildSoupChunk(makeModel());
		const attr = chunk.geometry.getAttribute('color') as THREE.BufferAttribute;
		const version = attr.version;
		paintSoupChunk(chunk, false, new Set());
		expect(attr.version).toBe(version);
	});
});

describe('pickChunkPolysInFrustum', () => {
	it('reports each polygon once even when both quad triangles are inside', () => {
		const chunk = buildSoupChunk(makeModel());
		const box = new THREE.Frustum();
		const camera = new THREE.OrthographicCamera(-20, 20, 20, -20, 0.1, 100);
		camera.position.set(0, 50, 0);
		camera.lookAt(0, 0, 0);
		camera.updateMatrixWorld();
		box.setFromProjectionMatrix(
			new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
		);
		expect(pickChunkPolysInFrustum(chunk, box)).toEqual([
			{ soup: 0, poly: 0 },
			{ soup: 0, poly: 1 },
		]);
	});
});
