// Polygon-soup overlay skip-highlight spec — issue #82.
//
// When the Selection is mixed (1+ AI section in the workspace AI bulk +
// 1+ polygon-soup polys in the PSL bulk), the PSL overlay's bulk paint
// switches from amber to a red-tinted dim variant so the user can see
// which polys are being SKIPPED by the Bulk transform gizmo.
//
// `paintSoupChunk` mutates per-vertex colors in place on a chunk's
// `BufferGeometry`. The test fakes a 2-triangle chunk, paints it in both
// regimes, and inspects the resulting color array. The repo's vitest env is
// `node` (no jsdom), and `BufferGeometry` works fine without a GL context
// for in-memory attribute reads.

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { paintSoupChunk, SOUP_PAINT_AMBER, SOUP_PAINT_SKIPPED, type SoupChunk } from '../polygonSoupChunk';
import { encodeSoupPoly } from '../polygonSoupListContext';

/** Two triangles at neutral grey; `faceToPoly` decides which polygon each
 *  triangle belongs to (soup 0 throughout). */
function buildChunk(faceToPoly: number[]): SoupChunk {
	const triangleCount = faceToPoly.length / 2;
	const colors = new Float32Array(triangleCount * 9).fill(0.5);
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(triangleCount * 9), 3));
	geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
	return {
		geometry,
		baseColors: colors.slice(),
		faceToPoly: new Int32Array(faceToPoly),
		triangleCount,
		soupCount: 1,
		bounds: new THREE.Box3(),
		painted: false,
	};
}

const colorsOf = (c: SoupChunk) => (c.geometry.getAttribute('color') as THREE.BufferAttribute).array as Float32Array;

describe('paintSoupChunk — skip-paint regime (issue #82)', () => {
	it('paints amber when the Selection is PSL-only (no transformable sibling)', () => {
		const chunk = buildChunk([0, 0, 0, 0]);
		paintSoupChunk(chunk, true, new Set([encodeSoupPoly(0, 0)]), false);
		const colors = colorsOf(chunk);
		expect(colors[0]).toBeCloseTo(SOUP_PAINT_AMBER[0], 4);
		expect(colors[1]).toBeCloseTo(SOUP_PAINT_AMBER[1], 4);
		expect(colors[2]).toBeCloseTo(SOUP_PAINT_AMBER[2], 4);
	});

	it('paints red-tinted dim when the Selection is mixed (skipped by bulk transform)', () => {
		const chunk = buildChunk([0, 0, 0, 0]);
		paintSoupChunk(chunk, true, new Set([encodeSoupPoly(0, 0)]), true);
		const colors = colorsOf(chunk);
		expect(colors[0]).toBeCloseTo(SOUP_PAINT_SKIPPED[0], 4);
		expect(colors[1]).toBeCloseTo(SOUP_PAINT_SKIPPED[1], 4);
		expect(colors[2]).toBeCloseTo(SOUP_PAINT_SKIPPED[2], 4);
	});

	it('amber and skipped paints are distinct so the user can tell the regimes apart', () => {
		expect(SOUP_PAINT_AMBER).not.toEqual(SOUP_PAINT_SKIPPED);
	});

	it('repaints non-selected polys back to the brightened base (not amber, not skipped)', () => {
		// Triangle 0 = poly 0 (in bulk), triangle 1 = poly 1 (not in bulk).
		const chunk = buildChunk([0, 0, 0, 1]);
		paintSoupChunk(chunk, true, new Set([encodeSoupPoly(0, 0)]), true);
		const colors = colorsOf(chunk);
		expect(colors[0]).toBeCloseTo(SOUP_PAINT_SKIPPED[0], 4);
		expect(colors[9]).toBeCloseTo(Math.min(1, 0.5 * 1.6 + 0.15), 4);
	});
});
