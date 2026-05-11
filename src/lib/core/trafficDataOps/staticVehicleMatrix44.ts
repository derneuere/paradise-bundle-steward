// Static-traffic-vehicle Matrix44 rigid ops (issue #78).
//
// Static traffic vehicles (`TrafficStaticVehicle.mTransform`) are the ONLY
// WorldViewport resource family today whose pose is stored as a full 4×4
// `Matrix44Affine` — every other resource is `Vector3 + Euler` (trigger
// boxes) or yaw-packed in a Vec4's `.w` slot (junctions, light triggers,
// lane rungs). Static vehicles are therefore fully 3D-rotation-capable
// (pitch + yaw + roll), just like trigger boxes from issue #77.
//
// Matrix layout (load-bearing). The on-disk format is Criterion's
// Matrix44Affine: 16 sequential f32s. Elements [12], [13], [14] hold the
// translation column, with [15] = 1 (the homogeneous w). That places the
// array in **column-major** order from three.js's perspective — and
// `THREE.Matrix4.fromArray(mTransform)` maps it directly. The renderer at
// `TrafficDataViewport.tsx` already relies on this (`mat.fromArray(...)`
// followed by reading translation from `.elements[12..14]`). We adopt the
// same convention here so the gizmo math composes directly against the
// representation the viewport draws.
//
// Multiplication order (load-bearing). The rotate-around-pivot rule from
// issue #78 is:
//
//   M' = T(P) · R(delta) · T(-P) · M
//
// i.e. **pre-multiply** the existing pose `M` by `T(P) · R(delta) · T(-P)`.
// This rotates the vehicle's translation AROUND the pivot (orbiting) AND
// pre-multiplies the existing rotation portion by `R(delta)` (so the
// vehicle's facing direction picks up the gesture's rotation). The "pre"
// part matters: `R(delta) · M` rotates the world that `M` lives in, not
// `M`'s local frame. That's the convention three.js uses for
// `Matrix4.premultiply(other)` and the rigid-body interpretation matches
// the trigger-box adapter (`bulkRotateTriggerBoxes` from issue #77).
//
// Coordinate frame. Editor and viewport both use a Y-up, right-handed
// frame (three.js convention). The in-memory `mTransform` is already in
// that frame — the parser at `trafficData.ts:readStaticVehicle` reads
// f32s 1:1 with no axis swap, and the renderer feeds the array straight
// into `THREE.Matrix4.fromArray`. The `swapYZ: true` flag on the
// `mTransform` field metadata is for the **inspector form** only (which
// slot the form labels "Y" vs "Z"); it does NOT alter the in-memory
// layout. So our matrix math operates in editor frame and writes back
// the same float layout the parser produced — a no-op gesture trivially
// round-trips byte-for-byte because we hand back the **same array
// reference** (`===`-identity preserved).
//
// No-op contract. Both ops return the input `TrafficStaticVehicle`
// reference verbatim on an identity gesture (translate zero / rotate
// identity). The bulk wrapper in `./bulk.ts` then returns the input
// `ParsedTrafficDataRetail` reference unchanged, so `trafficData.write`
// emits bytes identical to the source file. This is the BND2 byte-for-
// byte writeback invariant per ADR-0010.

import * as THREE from 'three';
import type {
	ParsedTrafficDataRetail,
	TrafficHull,
	TrafficStaticVehicle,
} from '../trafficData';

// =============================================================================
// Constants
// =============================================================================

/**
 * Euler rotation order for the gesture's `(rx, ry, rz)` triple. Pinned to
 * three.js's default 'XYZ' (intrinsic Tait–Bryan), same as the trigger-box
 * adapter — every WorldViewport gizmo speaks the same Euler convention so
 * a mixed Selection (static vehicle + trigger box) composes consistently.
 *
 * Note: this is the order for building the **delta** rotation matrix from
 * a gesture, NOT the order for decomposing the result back. The Matrix44
 * path doesn't decompose anything — we multiply 4×4 matrices and write
 * the 16 floats back, sidestepping the Euler-representation collapse that
 * the trigger-box compose-then-decompose path has.
 */
export const STATIC_VEHICLE_DELTA_EULER_ORDER: THREE.EulerOrder = 'XYZ';

// =============================================================================
// Helpers — Matrix44Affine ↔ THREE.Matrix4
// =============================================================================

/**
 * Read the 16-float in-memory `mTransform` into a fresh `THREE.Matrix4`.
 * The array is column-major (translation at indices 12/13/14) so
 * `fromArray` maps elements directly. We force the bottom row to
 * `[0, 0, 0, 1]` because the Matrix44Affine layout stores zero in the
 * pad slots `[3], [7], [11], [15]` rather than the homogeneous `1`, and
 * leaving slot `[15]` at zero would give a degenerate `w` on the
 * homogeneous multiply (this matches the renderer's
 * `AllStaticVehicleInstances` patch).
 */
function readMatrix(mTransform: readonly number[]): THREE.Matrix4 {
	const m = new THREE.Matrix4().fromArray(mTransform);
	const e = m.elements;
	e[3] = 0;
	e[7] = 0;
	e[11] = 0;
	e[15] = 1;
	return m;
}

/**
 * Serialize a `THREE.Matrix4` back into a 16-element `number[]` for
 * storage. Preserves the column-major layout. The pad slots
 * (`[3], [7], [11]`) and the homogeneous `[15]` are forced to zero to
 * match the on-disk Matrix44Affine convention — the writer at
 * `writeStaticVehicle` emits 16 f32s linearly and the original file's
 * pad slots are zero. Patching slot 15 to zero is what keeps a no-op
 * rotate byte-identical on writeback (a non-zero w would corrupt the
 * bytes even if the rotation portion was unchanged).
 */
function writeMatrix(mat: THREE.Matrix4): number[] {
	const arr = mat.toArray();
	arr[3] = 0;
	arr[7] = 0;
	arr[11] = 0;
	arr[15] = 0;
	return arr;
}

/**
 * Build the 3-axis rotation delta matrix from a gesture's Euler triple,
 * in `STATIC_VEHICLE_DELTA_EULER_ORDER`. Returns the identity matrix
 * trivially when all three axes are zero — callers should short-circuit
 * before reaching this in the no-op path, but the trivial result is safe
 * to compose either way.
 */
function buildRotationDeltaMatrix(deltaEuler: {
	x: number;
	y: number;
	z: number;
}): THREE.Matrix4 {
	return new THREE.Matrix4().makeRotationFromEuler(
		new THREE.Euler(
			deltaEuler.x,
			deltaEuler.y,
			deltaEuler.z,
			STATIC_VEHICLE_DELTA_EULER_ORDER,
		),
	);
}

// =============================================================================
// Single-entity translate
// =============================================================================

/**
 * Translate one static vehicle's `mTransform` by `(dx, dy, dz)`. Only the
 * translation column (`[12], [13], [14]`) is updated; the rotation portion
 * (`[0..11]`) is preserved verbatim. Returns the input vehicle reference
 * verbatim on identity offset so byte-for-byte BND2 writeback survives.
 */
export function translateStaticVehicleMatrix44(
	vehicle: TrafficStaticVehicle,
	offset: { x: number; y: number; z: number },
): TrafficStaticVehicle {
	if (offset.x === 0 && offset.y === 0 && offset.z === 0) return vehicle;
	const next = vehicle.mTransform.slice();
	next[12] = (next[12] ?? 0) + offset.x;
	next[13] = (next[13] ?? 0) + offset.y;
	next[14] = (next[14] ?? 0) + offset.z;
	return { ...vehicle, mTransform: next };
}

/**
 * Rotate one static vehicle's `mTransform` around `pivot` by the delta
 * Euler `(rx, ry, rz)` in `STATIC_VEHICLE_DELTA_EULER_ORDER`. The math:
 *
 *   M' = T(P) · R(delta) · T(-P) · M
 *
 * which pre-multiplies the existing pose by the pivot-anchored rotation —
 * orbiting the translation column around `pivot` AND composing the
 * rotation delta into the vehicle's own facing direction. Returns the
 * input vehicle reference verbatim on an identity delta (all axes zero).
 *
 * Critical: the input vehicle is returned **by reference** on identity so
 * the BND2 byte-for-byte writeback invariant survives a no-op gesture.
 * Same contract as `translateStaticVehicleMatrix44` above.
 */
export function rotateStaticVehicleMatrix44(
	vehicle: TrafficStaticVehicle,
	pivot: { x: number; y: number; z: number },
	deltaEuler: { x: number; y: number; z: number },
): TrafficStaticVehicle {
	if (deltaEuler.x === 0 && deltaEuler.y === 0 && deltaEuler.z === 0) return vehicle;

	const M = readMatrix(vehicle.mTransform);
	const R = buildRotationDeltaMatrix(deltaEuler);

	// Sandwich: composed = T(P) · R · T(-P), then M' = composed · M.
	// three.js's Matrix4.premultiply(X) computes `X · this`, so calling
	// M.premultiply(T(-P)) yields T(-P) · M, then .premultiply(R) yields
	// R · T(-P) · M, then .premultiply(T(P)) yields T(P) · R · T(-P) · M.
	M.premultiply(new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z));
	M.premultiply(R);
	M.premultiply(new THREE.Matrix4().makeTranslation(pivot.x, pivot.y, pivot.z));

	return { ...vehicle, mTransform: writeMatrix(M) };
}

// =============================================================================
// ParsedTrafficDataRetail-scope rigid ops
// =============================================================================

/**
 * Translate one static vehicle's `mTransform` by `(dx, dy, dz)`. Returns
 * the input `model` reference on identity offset or out-of-range refs.
 *
 * @throws RangeError if any index is out of range.
 */
export function translateStaticVehicleRigid(
	model: ParsedTrafficDataRetail,
	hullIdx: number,
	vehicleIdx: number,
	offset: { x: number; y: number; z: number },
): ParsedTrafficDataRetail {
	if (hullIdx < 0 || hullIdx >= model.hulls.length) {
		throw new RangeError(
			`hullIdx ${hullIdx} out of range [0, ${model.hulls.length})`,
		);
	}
	const hull = model.hulls[hullIdx];
	if (vehicleIdx < 0 || vehicleIdx >= hull.staticTrafficVehicles.length) {
		throw new RangeError(
			`vehicleIdx ${vehicleIdx} out of range [0, ${hull.staticTrafficVehicles.length})`,
		);
	}
	if (offset.x === 0 && offset.y === 0 && offset.z === 0) return model;

	const src = hull.staticTrafficVehicles[vehicleIdx];
	const next = translateStaticVehicleMatrix44(src, offset);
	if (next === src) return model;
	const nextVehicles = hull.staticTrafficVehicles.map((v, i) =>
		i === vehicleIdx ? next : v,
	);
	const nextHull: TrafficHull = { ...hull, staticTrafficVehicles: nextVehicles };
	const nextHulls = model.hulls.map((h, i) => (i === hullIdx ? nextHull : h));
	return { ...model, hulls: nextHulls };
}

/**
 * Rotate one static vehicle's `mTransform` around `pivot` by the delta
 * Euler. Returns the input `model` reference on identity delta.
 *
 * @throws RangeError if any index is out of range.
 */
export function rotateStaticVehicleRigid(
	model: ParsedTrafficDataRetail,
	hullIdx: number,
	vehicleIdx: number,
	pivot: { x: number; y: number; z: number },
	deltaEuler: { x: number; y: number; z: number },
): ParsedTrafficDataRetail {
	if (hullIdx < 0 || hullIdx >= model.hulls.length) {
		throw new RangeError(
			`hullIdx ${hullIdx} out of range [0, ${model.hulls.length})`,
		);
	}
	const hull = model.hulls[hullIdx];
	if (vehicleIdx < 0 || vehicleIdx >= hull.staticTrafficVehicles.length) {
		throw new RangeError(
			`vehicleIdx ${vehicleIdx} out of range [0, ${hull.staticTrafficVehicles.length})`,
		);
	}
	if (deltaEuler.x === 0 && deltaEuler.y === 0 && deltaEuler.z === 0) return model;

	const src = hull.staticTrafficVehicles[vehicleIdx];
	const next = rotateStaticVehicleMatrix44(src, pivot, deltaEuler);
	if (next === src) return model;
	const nextVehicles = hull.staticTrafficVehicles.map((v, i) =>
		i === vehicleIdx ? next : v,
	);
	const nextHull: TrafficHull = { ...hull, staticTrafficVehicles: nextVehicles };
	const nextHulls = model.hulls.map((h, i) => (i === hullIdx ? nextHull : h));
	return { ...model, hulls: nextHulls };
}

// Internal-for-tests: expose the lowest-level matrix helpers so the
// cross-validation test (Vector3 + Euler ↔ Matrix44) can pin the
// representation conversion without re-implementing it.
export const _internalForTests = {
	readMatrix,
	writeMatrix,
	buildRotationDeltaMatrix,
};
