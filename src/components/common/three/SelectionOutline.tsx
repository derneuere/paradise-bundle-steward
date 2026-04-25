// Reusable "selection outline" overlay for any R3F viewport that has a
// notion of "selected items" with extractable boundary edges.
//
// Single-triangle amber tint or a per-instance color shift is easy to
// lose in a dense scene; an outline pass on top with depthTest off makes
// the selection findable from any angle and through any geometry. PSL
// already wires this up for polygons; the same shape works for traffic
// section ribbons, AI section corners, trigger region boxes, etc.
//
// Two pieces:
//   - `buildLineSegmentsGeometry(edges)`: pure function. Takes an iterable
//     of [start, end] vec3 pairs, returns a BufferGeometry whose `position`
//     attribute holds the segments, ready to drop into <lineSegments>.
//   - `useLineSegmentsGeometry(builder, deps)`: convenience hook that
//     memoizes the geometry on `deps` and disposes on change. The builder
//     can return any iterable, including a generator function — yielding
//     each edge avoids building an intermediate array for large sets.
//
// The rendering itself is two lines of JSX (R3F's <lineSegments> + a
// <lineBasicMaterial>) so we don't wrap that — keeps the call site
// explicit about color, depthTest, renderOrder.

import { useEffect, useMemo, type DependencyList } from 'react';
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

/**
 * Hook: memoize the geometry on `deps`, dispose on rebuild / unmount.
 * Pass a builder closure that returns the edges — the closure is only
 * called when `deps` change, so inner work (vertex unpacking, edge
 * derivation, etc.) doesn't run every render.
 */
export function useLineSegmentsGeometry(
	buildEdges: () => Iterable<Edge>,
	deps: DependencyList,
): THREE.BufferGeometry {
	// eslint-disable-next-line react-hooks/exhaustive-deps
	const geometry = useMemo(() => buildLineSegmentsGeometry(buildEdges()), deps);
	useEffect(() => {
		const g = geometry;
		return () => { g.dispose(); };
	}, [geometry]);
	return geometry;
}
