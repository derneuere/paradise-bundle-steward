// Reusable "selection outline" geometry builder for any R3F viewport that
// has a notion of "selected items" with extractable boundary edges.
//
// Single-triangle amber tint or a per-instance color shift is easy to
// lose in a dense scene; an outline pass on top with depthTest off makes
// the selection findable from any angle and through any geometry. PSL
// already wires this up for polygons; the same shape works for traffic
// section ribbons, AI section corners, trigger region boxes, etc.
//
// This file is the pure-function half: `buildLineSegmentsGeometry` packs
// edges into a `THREE.BufferGeometry`. The React-integration half — a
// memoizing hook that owns the geometry's lifecycle — lives at
// `src/hooks/useLineSegmentsGeometry.ts`.
//
// The rendering itself is two lines of JSX (R3F's <lineSegments> + a
// <lineBasicMaterial>) so we don't wrap that — keeps the call site
// explicit about color, depthTest, renderOrder.

import * as THREE from 'three';

export type Vec3Tuple = [number, number, number];
export type Edge = readonly [Vec3Tuple, Vec3Tuple];

/**
 * Pure function: turn an iterable of edges into a BufferGeometry whose
 * `position` attribute is a tightly packed Float32Array of segment
 * endpoints. Empty geometry (no edges) is safe — produces a 0-length
 * attribute that <lineSegments> renders as nothing.
 *
 * Iteration model: we walk the iterable twice (once to count, once to
 * pack) when given an Array; for non-Array iterables we collect into an
 * array first since we can't cheaply size-probe a generator. Either way,
 * memory is O(edges) and CPU is linear.
 */
export function buildLineSegmentsGeometry(edges: Iterable<Edge>): THREE.BufferGeometry {
	const list = Array.isArray(edges) ? (edges as readonly Edge[]) : Array.from(edges);
	const geometry = new THREE.BufferGeometry();
	if (list.length === 0) {
		geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
		return geometry;
	}
	const positions = new Float32Array(list.length * 2 * 3);
	let i = 0;
	for (const [a, b] of list) {
		positions[i++] = a[0]; positions[i++] = a[1]; positions[i++] = a[2];
		positions[i++] = b[0]; positions[i++] = b[1]; positions[i++] = b[2];
	}
	geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
	return geometry;
}
