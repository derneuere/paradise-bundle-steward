// Pure point arithmetic for the shared **Bulk transform**. No three.js, no
// model knowledge — everything here is total and allocation-cheap because it
// runs once per slot per drag frame (a 500-section bulk is ~5,000 slots).

import type { Point, Rotation } from './types';

/** Median of a numeric list; 0 for an empty list so callers never branch.
 *  Even-length lists average the two middle samples. */
export function median(values: readonly number[]): number {
	if (values.length === 0) return 0;
	const s = values.slice().sort((a, b) => a - b);
	const mid = s.length >> 1;
	return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

/**
 * Per-component median — the **Pivot** rule from CONTEXT.md. Median rather
 * than centroid so a tight cluster plus a few far outliers anchors near the
 * cluster. Each axis is taken independently, so the result is generally NOT
 * any real point in the model; that is intended.
 */
export function medianPoint(points: readonly Point[]): Point | null {
	if (points.length === 0) return null;
	return {
		x: median(points.map((p) => p.x)),
		y: median(points.map((p) => p.y)),
		z: median(points.map((p) => p.z)),
	};
}

export function isZeroTranslate(t: Point): boolean {
	return t.x === 0 && t.y === 0 && t.z === 0;
}

export function isZeroRotation(r: Rotation): boolean {
	return r.x === 0 && r.y === 0 && r.z === 0;
}

export function addPoint(p: Point, d: Point): Point {
	return { x: p.x + d.x, y: p.y + d.y, z: p.z + d.z };
}

/**
 * THE rotation convention for the whole editor. Right-hand rule about each
 * world axis, composed in Euler order 'XYZ' so that
 *
 *     R = Rx(r.x) * Ry(r.y) * Rz(r.z)
 *
 * which is byte-identical to
 * `new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(x, y, z, 'XYZ'))`.
 * Applied to a vector that means: Rz first, then Ry, then Rx — which is the
 * order the three `if` blocks below run in.
 *
 * Yaw sanity check (the single most dangerous line in the merge): rotation
 * about +Y by +PI/2 takes +Z toward +X, i.e. (10,0,0) -> (0,0,-10).
 *
 * This sign is FORCED, not chosen. Prop instances, static traffic vehicles and
 * trigger boxes carry an orientation that the resolver composes with
 * `makeRotationFromEuler`; if the shared point math orbited the other way, a
 * prop would face one direction and sit on the opposite side of the pivot.
 * Four of the six resources' legacy ops rotated +X -> +Z, which is why a mixed
 * traffic selection counter-rotated (junctions one way, static vehicles the
 * other). The gizmo's `rotationSignForCameraSide` absorbs the flip, so the
 * four XZ families keep their on-screen behaviour unchanged.
 *
 * Each axis is skipped when its angle is exactly 0, which makes the yaw-only
 * case (every AI-section / zone / traffic-yaw gesture) a two-multiply fast
 * path rather than a separate 2D entry point.
 */
export function rotatePointAboutPivot(p: Point, pivot: Point, r: Rotation): Point {
	let x = p.x - pivot.x;
	let y = p.y - pivot.y;
	let z = p.z - pivot.z;

	if (r.z !== 0) {
		const c = Math.cos(r.z), s = Math.sin(r.z);
		const nx = x * c - y * s;
		const ny = x * s + y * c;
		x = nx; y = ny;
	}
	if (r.y !== 0) {
		const c = Math.cos(r.y), s = Math.sin(r.y);
		const nx = x * c + z * s;
		const nz = -x * s + z * c;
		x = nx; z = nz;
	}
	if (r.x !== 0) {
		const c = Math.cos(r.x), s = Math.sin(r.x);
		const ny = y * c - z * s;
		const nz = y * s + z * c;
		y = ny; z = nz;
	}
	return { x: x + pivot.x, y: y + pivot.y, z: z + pivot.z };
}
