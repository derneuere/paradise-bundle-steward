// Polygon-soup overlay skip-highlight spec — issue #82.
//
// When the Selection is mixed (1+ AI section in the workspace AI bulk +
// 1+ polygon-soup polys in the PSL bulk), the PSL overlay's bulk paint
// switches from amber to a red-tinted dim variant so the user can see
// which polys are being SKIPPED by the Bulk transform gizmo.
//
// `applyHighlight` mutates per-vertex colors in place on a THREE
// `BufferGeometry`. The test fakes a 2-triangle geometry, runs the
// highlight in both regimes, and inspects the resulting color array.
// The repo's vitest env is `node` (no jsdom) so we never touch a real
// canvas — `BufferGeometry` works fine without a GL context for in-memory
// attribute reads.

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
	applyHighlight,
	SOUP_PAINT_AMBER,
	SOUP_PAINT_SKIPPED,
} from '../PolygonSoupListOverlay';
import { encodeSoupPoly } from '../polygonSoupListContext';

/** Build a tiny 2-triangle geometry mock: one model with 2 triangles, one
 *  soup, one polygon (one quad → 2 tris). Vertex colors start at a neutral
 *  grey so the highlight paint stands out. */
function buildHarness() {
	const triangleCount = 2;
	const positions = new Float32Array(triangleCount * 9);
	const colors = new Float32Array(triangleCount * 9);
	const baseColors = new Float32Array(triangleCount * 9);
	for (let i = 0; i < triangleCount * 9; i++) {
		colors[i] = 0.5;
		baseColors[i] = 0.5;
	}
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
	geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
	// Both triangles belong to the same (modelIdx=0, soupIdx=0, polyIdx=0).
	const faceToLocation = new Int32Array([0, 0, 0, 0, 0, 0]);
	const ranges = [{ start: 0, count: triangleCount }];
	return { geometry, baseColors, faceToLocation, ranges };
}

describe('PolygonSoupListOverlay.applyHighlight — skip-paint regime (issue #82)', () => {
	it('paints amber when the Selection is PSL-only (no transformable sibling)', () => {
		const { geometry, baseColors, faceToLocation, ranges } = buildHarness();
		const bulkSet = new Set<number>([encodeSoupPoly(0, 0)]);
		applyHighlight(geometry, ranges, baseColors, faceToLocation, 0, bulkSet, false);
		const colors = (geometry.getAttribute('color') as THREE.BufferAttribute).array as Float32Array;
		// Read vertex 0 of triangle 0 — it should match the amber triple.
		expect(colors[0]).toBeCloseTo(SOUP_PAINT_AMBER[0], 4);
		expect(colors[1]).toBeCloseTo(SOUP_PAINT_AMBER[1], 4);
		expect(colors[2]).toBeCloseTo(SOUP_PAINT_AMBER[2], 4);
	});

	it('paints red-tinted dim when the Selection is mixed (skipped by bulk transform)', () => {
		const { geometry, baseColors, faceToLocation, ranges } = buildHarness();
		const bulkSet = new Set<number>([encodeSoupPoly(0, 0)]);
		applyHighlight(geometry, ranges, baseColors, faceToLocation, 0, bulkSet, true);
		const colors = (geometry.getAttribute('color') as THREE.BufferAttribute).array as Float32Array;
		expect(colors[0]).toBeCloseTo(SOUP_PAINT_SKIPPED[0], 4);
		expect(colors[1]).toBeCloseTo(SOUP_PAINT_SKIPPED[1], 4);
		expect(colors[2]).toBeCloseTo(SOUP_PAINT_SKIPPED[2], 4);
	});

	it('amber and skipped paints are distinct so the user can tell the regimes apart', () => {
		// Pin the contract that the two paints are NOT the same — a future
		// palette refactor that accidentally collapses them would silently
		// remove the issue #82 visual feedback.
		expect(SOUP_PAINT_AMBER).not.toEqual(SOUP_PAINT_SKIPPED);
	});

	it('repaints non-selected polys back to the brightened base (not amber, not skipped)', () => {
		// Two triangles in the geometry but only the first poly is in the bulk
		// — wait, both tris share the same poly so they both get paint. Use a
		// fresh harness where the second triangle belongs to a poly NOT in the
		// bulk set.
		const triangleCount = 2;
		const positions = new Float32Array(triangleCount * 9);
		const colors = new Float32Array(triangleCount * 9);
		const baseColors = new Float32Array(triangleCount * 9);
		for (let i = 0; i < triangleCount * 9; i++) {
			colors[i] = 0.5;
			baseColors[i] = 0.5;
		}
		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
		geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
		// Triangle 0 = (0,0,0); triangle 1 = (0,0,1) — different polys.
		const faceToLocation = new Int32Array([0, 0, 0, 0, 0, 1]);
		const ranges = [{ start: 0, count: triangleCount }];
		const bulkSet = new Set<number>([encodeSoupPoly(0, 0)]);
		applyHighlight(geometry, ranges, baseColors, faceToLocation, 0, bulkSet, true);
		const arr = (geometry.getAttribute('color') as THREE.BufferAttribute).array as Float32Array;
		// Tri 0 (poly 0) is in bulk → painted SKIPPED.
		expect(arr[0]).toBeCloseTo(SOUP_PAINT_SKIPPED[0], 4);
		// Tri 1 (poly 1) is NOT in bulk → keeps the brightened base.
		// applyHighlight brightens with colors[i] = min(1, base * 1.6 + 0.15)
		const expectedBrightened = Math.min(1, 0.5 * 1.6 + 0.15);
		expect(arr[9]).toBeCloseTo(expectedBrightened, 4);
	});
});
