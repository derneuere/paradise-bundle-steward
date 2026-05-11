// Bulk-transform ops for the traffic-data resource family — yaw-packed
// boxes + lane rungs (issue #79) + static traffic vehicles (issue #78).
//
// Cardinality ≥ 1 entry points for the unified Bulk-transform gizmo. A
// **Selection** of any combination of traffic-data entities is treated as
// one rigid body: every member orbits the same pivot, and each member
// composes the gesture rotation according to its own representation:
//
//   - Yaw-packed boxes (junctions / light triggers / light instances /
//     coronas): position orbits the pivot in XZ; the `.w` slot picks up
//     the gesture's yaw delta. ADR-0011 yaw-only contributor — pitch/roll
//     auto-disable for any Selection that includes one of these.
//   - Lane rungs: both endpoints orbit the pivot in XZ. `.w` preserved
//     verbatim (rung endpoints don't carry yaw). Yaw-only contributor.
//   - Static vehicles (`mTransform` Matrix44): position orbits the pivot
//     AND the matrix is pre-multiplied by the gesture's rotation matrix.
//     Full 3D contributor — translates and rotates all three axes when
//     the Selection is purely static-vehicle (or mixed with another full
//     3D family like trigger boxes).
//
// The full-3D rotation path applies to static vehicles even when the
// Selection contains a yaw-only sibling — but the auto-disable rule from
// ADR-0011 (`intersectTransformAxes`) means the gizmo's pitch and roll
// rings only render interactive when every contributor agrees. So in
// practice a mixed Selection's rotate gesture only carries a yaw delta,
// and that yaw delta still pre-multiplies the static vehicle's matrix.

import type {
	ParsedTrafficDataRetail,
	TrafficHull,
	TrafficJunctionLogicBox,
	TrafficLaneRung,
	TrafficLightCollection,
	TrafficLightTrigger,
	TrafficStaticVehicle,
	Vec4,
} from '../trafficData';
import {
	TRANSFORM_AXES_FULL_3D,
	intersectTransformAxes,
	type TransformAxes,
} from '../transformAxes';
import {
	rotateStaticVehicleMatrix44,
	translateStaticVehicleMatrix44,
} from './staticVehicleMatrix44';
import { TRAFFIC_YAW_PACKED_AXES } from './transformAxes';

// =============================================================================
// Entity references
// =============================================================================

/**
 * Discriminated reference to a single spatial datum in a
 * ParsedTrafficDataRetail.
 *
 * Lane rungs are addressed as a single ref (NOT per-endpoint): both
 * endpoints move together so the rung remains a single segment. Selecting
 * one endpoint at a time would tear the lane topology — see the comment in
 * `translateLaneRungRigid` for the rationale.
 *
 * Static vehicles are the only Matrix44 (full-3D) contributor — every
 * other kind is yaw-only per ADR-0011. The axis intersection in
 * `bulkTrafficDataAxes` collapses mixed selections back to yaw-only as
 * soon as a yaw-packed sibling joins.
 */
export type TrafficDataEntityRef =
	| { kind: 'junction'; hullIdx: number; junctionIdx: number }
	| { kind: 'lightTrigger'; hullIdx: number; triggerIdx: number }
	| { kind: 'lightInstance'; instanceIdx: number }
	| { kind: 'corona'; coronaIdx: number }
	| { kind: 'laneRung'; hullIdx: number; rungIdx: number }
	| { kind: 'staticVehicle'; hullIdx: number; vehicleIdx: number };

// =============================================================================
// Helpers
// =============================================================================

function median(values: number[]): number {
	const sorted = values.slice().sort((a, b) => a - b);
	const n = sorted.length;
	if (n === 0) return 0;
	const mid = n >> 1;
	return n % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function resolveYawBox(
	model: ParsedTrafficDataRetail,
	ref: TrafficDataEntityRef,
): Vec4 | null {
	switch (ref.kind) {
		case 'junction': {
			const hull = model.hulls[ref.hullIdx];
			return hull?.junctions[ref.junctionIdx]?.mPosition ?? null;
		}
		case 'lightTrigger': {
			const hull = model.hulls[ref.hullIdx];
			return hull?.lightTriggers[ref.triggerIdx]?.mPosPlusYRot ?? null;
		}
		case 'lightInstance':
			return model.trafficLights.posAndYRotations[ref.instanceIdx] ?? null;
		case 'corona':
			return model.trafficLights.coronaPositions[ref.coronaIdx] ?? null;
		case 'laneRung':
		case 'staticVehicle':
			return null;
	}
}

/**
 * Resolve a static vehicle ref to its `TrafficStaticVehicle` entry. Used
 * by the pivot, translate, and rotate ops in this file. Returns `null`
 * on out-of-range refs so the bulk ops can skip them silently (parity
 * with `resolveYawBox`).
 */
function resolveStaticVehicle(
	model: ParsedTrafficDataRetail,
	ref: TrafficDataEntityRef,
): TrafficStaticVehicle | null {
	if (ref.kind !== 'staticVehicle') return null;
	const hull = model.hulls[ref.hullIdx];
	return hull?.staticTrafficVehicles[ref.vehicleIdx] ?? null;
}

// =============================================================================
// Pivot
// =============================================================================

/**
 * Median (per-component) of every spatial point the Selection addresses.
 * Each yaw-packed box contributes its `(x, y, z)` (ignoring `.w`). Each
 * lane rung contributes BOTH endpoints (xyz × 2). Each static vehicle
 * contributes its `mTransform` translation column `(m[12], m[13], m[14])`.
 * Returns `null` for empty / out-of-range refs.
 */
export function trafficDataSelectionPivot(
	model: ParsedTrafficDataRetail,
	refs: readonly TrafficDataEntityRef[],
): { x: number; y: number; z: number } | null {
	const xs: number[] = [];
	const ys: number[] = [];
	const zs: number[] = [];
	for (const ref of refs) {
		if (ref.kind === 'laneRung') {
			const hull = model.hulls[ref.hullIdx];
			const rung = hull?.rungs[ref.rungIdx];
			if (!rung) continue;
			for (const v of rung.maPoints) {
				xs.push(v.x);
				ys.push(v.y);
				zs.push(v.z);
			}
			continue;
		}
		if (ref.kind === 'staticVehicle') {
			const sv = resolveStaticVehicle(model, ref);
			if (!sv) continue;
			xs.push(sv.mTransform[12] ?? 0);
			ys.push(sv.mTransform[13] ?? 0);
			zs.push(sv.mTransform[14] ?? 0);
			continue;
		}
		const box = resolveYawBox(model, ref);
		if (!box) continue;
		xs.push(box.x);
		ys.push(box.y);
		zs.push(box.z);
	}
	if (xs.length === 0) return null;
	return { x: median(xs), y: median(ys), z: median(zs) };
}

// =============================================================================
// Bucketing
// =============================================================================

type HullBucket = {
	junctionIdxs: Set<number>;
	lightTriggerIdxs: Set<number>;
	laneRungIdxs: Set<number>;
	staticVehicleIdxs: Set<number>;
};

type Buckets = {
	hulls: Map<number, HullBucket>;
	lightInstances: Set<number>;
	coronas: Set<number>;
};

function bucketRefs(refs: readonly TrafficDataEntityRef[]): Buckets {
	const hulls = new Map<number, HullBucket>();
	const lightInstances = new Set<number>();
	const coronas = new Set<number>();
	const getHull = (h: number): HullBucket => {
		let b = hulls.get(h);
		if (!b) {
			b = {
				junctionIdxs: new Set(),
				lightTriggerIdxs: new Set(),
				laneRungIdxs: new Set(),
				staticVehicleIdxs: new Set(),
			};
			hulls.set(h, b);
		}
		return b;
	};
	for (const ref of refs) {
		switch (ref.kind) {
			case 'junction':
				getHull(ref.hullIdx).junctionIdxs.add(ref.junctionIdx);
				break;
			case 'lightTrigger':
				getHull(ref.hullIdx).lightTriggerIdxs.add(ref.triggerIdx);
				break;
			case 'laneRung':
				getHull(ref.hullIdx).laneRungIdxs.add(ref.rungIdx);
				break;
			case 'staticVehicle':
				getHull(ref.hullIdx).staticVehicleIdxs.add(ref.vehicleIdx);
				break;
			case 'lightInstance':
				lightInstances.add(ref.instanceIdx);
				break;
			case 'corona':
				coronas.add(ref.coronaIdx);
				break;
		}
	}
	return { hulls, lightInstances, coronas };
}

// =============================================================================
// Translate
// =============================================================================

/**
 * Translate every entity in the Selection by the same `(dx, dy, dz)`
 * offset. Yaw-packed boxes' `.w` slots are preserved verbatim; lane rung
 * endpoints both shift by the same delta (rung stays a single segment);
 * static vehicles get their `mTransform` translation column shifted while
 * the rotation portion is preserved verbatim.
 *
 * Returns the original `model` reference on identity offset OR an empty
 * refs list so byte-for-byte BND2 writeback is preserved on a no-op
 * gesture.
 */
export function bulkTranslateTrafficEntities(
	model: ParsedTrafficDataRetail,
	refs: readonly TrafficDataEntityRef[],
	offset: { x: number; y: number; z: number },
): ParsedTrafficDataRetail {
	const dx = offset.x;
	const dy = offset.y;
	const dz = offset.z;
	if (dx === 0 && dy === 0 && dz === 0) return model;
	if (refs.length === 0) return model;

	const buckets = bucketRefs(refs);

	const shift = (v: Vec4): Vec4 => ({
		x: v.x + dx,
		y: v.y + dy,
		z: v.z + dz,
		w: v.w,
	});

	// Hull-scope updates: junctions, lightTriggers, laneRungs, staticVehicles.
	let hullsChanged = false;
	const nextHulls = model.hulls.map((hull, hullIdx): TrafficHull => {
		const bucket = buckets.hulls.get(hullIdx);
		if (!bucket) return hull;
		let touched = false;

		const nextJunctions = bucket.junctionIdxs.size
			? hull.junctions.map((j, i): TrafficJunctionLogicBox => {
					if (!bucket.junctionIdxs.has(i)) return j;
					touched = true;
					return { ...j, mPosition: shift(j.mPosition) };
				})
			: hull.junctions;

		const nextLightTriggers = bucket.lightTriggerIdxs.size
			? hull.lightTriggers.map((t, i): TrafficLightTrigger => {
					if (!bucket.lightTriggerIdxs.has(i)) return t;
					touched = true;
					return { ...t, mPosPlusYRot: shift(t.mPosPlusYRot) };
				})
			: hull.lightTriggers;

		const nextRungs = bucket.laneRungIdxs.size
			? hull.rungs.map((r, i): TrafficLaneRung => {
					if (!bucket.laneRungIdxs.has(i)) return r;
					touched = true;
					return { maPoints: [shift(r.maPoints[0]), shift(r.maPoints[1])] };
				})
			: hull.rungs;

		const nextStaticVehicles = bucket.staticVehicleIdxs.size
			? hull.staticTrafficVehicles.map((v, i): TrafficStaticVehicle => {
					if (!bucket.staticVehicleIdxs.has(i)) return v;
					const moved = translateStaticVehicleMatrix44(v, offset);
					if (moved !== v) touched = true;
					return moved;
				})
			: hull.staticTrafficVehicles;

		if (!touched) return hull;
		hullsChanged = true;
		return {
			...hull,
			junctions: nextJunctions,
			lightTriggers: nextLightTriggers,
			rungs: nextRungs,
			staticTrafficVehicles: nextStaticVehicles,
		};
	});

	// Top-level traffic-light collection: lightInstances + coronas.
	let tlcChanged = false;
	let nextTrafficLights: TrafficLightCollection = model.trafficLights;
	if (buckets.lightInstances.size || buckets.coronas.size) {
		const tlc = model.trafficLights;
		const nextPos = buckets.lightInstances.size
			? tlc.posAndYRotations.map((v, i) => {
					if (!buckets.lightInstances.has(i)) return v;
					tlcChanged = true;
					return shift(v);
				})
			: tlc.posAndYRotations;
		const nextCoronas = buckets.coronas.size
			? tlc.coronaPositions.map((v, i) => {
					if (!buckets.coronas.has(i)) return v;
					tlcChanged = true;
					return shift(v);
				})
			: tlc.coronaPositions;
		if (tlcChanged) {
			nextTrafficLights = {
				...tlc,
				posAndYRotations: nextPos,
				coronaPositions: nextCoronas,
			};
		}
	}

	if (!hullsChanged && !tlcChanged) return model;
	return {
		...model,
		...(hullsChanged ? { hulls: nextHulls } : {}),
		...(tlcChanged ? { trafficLights: nextTrafficLights } : {}),
	};
}

// =============================================================================
// Rotate (yaw) — rigid-body composition
// =============================================================================

/**
 * Yaw-rotate every entity in the Selection around `pivot` by `theta`
 * radians. The composition rule (per issue #79 + issue #78):
 *
 *   - Yaw-packed boxes: position `(x, y, z)` orbits the pivot in the XZ
 *     plane (Y unchanged); the W slot picks up `+ theta` (the gesture's
 *     yaw delta is added to the box's own stored yaw). This is the rigid-
 *     body interpretation — when you rotate a yaw-packed box around a
 *     pivot, both its world position AND its own facing rotate together.
 *
 *   - Lane rungs: both endpoints' positions orbit the pivot in the XZ
 *     plane (Y unchanged on each); the W slot on each endpoint is
 *     preserved verbatim (lane rungs don't carry their own yaw — W is an
 *     opaque slot here).
 *
 *   - Static vehicles: `mTransform` is pre-multiplied by `T(P) · Ry(theta)
 *     · T(-P)`, orbiting the translation column around the pivot in XZ
 *     AND pre-multiplying the rotation portion by a Y-axis rotation
 *     matrix. Pitch / roll of the existing matrix are preserved (a yaw
 *     delta doesn't touch them).
 *
 * Yaw direction follows the right-hand rule with thumb along world +Y, so
 * positive `theta` rotates +X towards +Z — same convention as the AI
 * sections bulk and three.js's `Object3D.rotation.y`.
 *
 * Returns the original `model` reference on `theta === 0` OR an empty refs
 * list.
 */
export function bulkRotateTrafficEntitiesYaw(
	model: ParsedTrafficDataRetail,
	refs: readonly TrafficDataEntityRef[],
	pivot: { x: number; z: number },
	theta: number,
): ParsedTrafficDataRetail {
	if (theta === 0) return model;
	if (refs.length === 0) return model;

	const cosT = Math.cos(theta);
	const sinT = Math.sin(theta);
	const cx = pivot.x;
	const cz = pivot.z;

	const orbit = (v: Vec4, addToW: boolean): Vec4 => {
		const ox = v.x - cx;
		const oz = v.z - cz;
		return {
			x: ox * cosT - oz * sinT + cx,
			y: v.y,
			z: ox * sinT + oz * cosT + cz,
			w: addToW ? v.w + theta : v.w,
		};
	};

	const buckets = bucketRefs(refs);
	// Y of the pivot doesn't affect a yaw rotation (the matrix is invariant
	// under translation along its own axis), but the Matrix44 path needs a
	// concrete 3D pivot to plug into `rotateStaticVehicleMatrix44`. Y=0 is
	// fine: a Y-axis rotation around `(x, 0, z)` produces the same matrix
	// as around `(x, any, z)`.
	const sv3DPivot = { x: cx, y: 0, z: cz };
	const sv3DEuler = { x: 0, y: theta, z: 0 };

	let hullsChanged = false;
	const nextHulls = model.hulls.map((hull, hullIdx): TrafficHull => {
		const bucket = buckets.hulls.get(hullIdx);
		if (!bucket) return hull;
		let touched = false;

		const nextJunctions = bucket.junctionIdxs.size
			? hull.junctions.map((j, i): TrafficJunctionLogicBox => {
					if (!bucket.junctionIdxs.has(i)) return j;
					touched = true;
					return { ...j, mPosition: orbit(j.mPosition, true) };
				})
			: hull.junctions;

		const nextLightTriggers = bucket.lightTriggerIdxs.size
			? hull.lightTriggers.map((t, i): TrafficLightTrigger => {
					if (!bucket.lightTriggerIdxs.has(i)) return t;
					touched = true;
					return { ...t, mPosPlusYRot: orbit(t.mPosPlusYRot, true) };
				})
			: hull.lightTriggers;

		const nextRungs = bucket.laneRungIdxs.size
			? hull.rungs.map((r, i): TrafficLaneRung => {
					if (!bucket.laneRungIdxs.has(i)) return r;
					touched = true;
					return {
						maPoints: [
							orbit(r.maPoints[0], false),
							orbit(r.maPoints[1], false),
						],
					};
				})
			: hull.rungs;

		const nextStaticVehicles = bucket.staticVehicleIdxs.size
			? hull.staticTrafficVehicles.map((v, i): TrafficStaticVehicle => {
					if (!bucket.staticVehicleIdxs.has(i)) return v;
					const moved = rotateStaticVehicleMatrix44(v, sv3DPivot, sv3DEuler);
					if (moved !== v) touched = true;
					return moved;
				})
			: hull.staticTrafficVehicles;

		if (!touched) return hull;
		hullsChanged = true;
		return {
			...hull,
			junctions: nextJunctions,
			lightTriggers: nextLightTriggers,
			rungs: nextRungs,
			staticTrafficVehicles: nextStaticVehicles,
		};
	});

	let tlcChanged = false;
	let nextTrafficLights: TrafficLightCollection = model.trafficLights;
	if (buckets.lightInstances.size || buckets.coronas.size) {
		const tlc = model.trafficLights;
		const nextPos = buckets.lightInstances.size
			? tlc.posAndYRotations.map((v, i) => {
					if (!buckets.lightInstances.has(i)) return v;
					tlcChanged = true;
					return orbit(v, true);
				})
			: tlc.posAndYRotations;
		const nextCoronas = buckets.coronas.size
			? tlc.coronaPositions.map((v, i) => {
					if (!buckets.coronas.has(i)) return v;
					tlcChanged = true;
					return orbit(v, true);
				})
			: tlc.coronaPositions;
		if (tlcChanged) {
			nextTrafficLights = {
				...tlc,
				posAndYRotations: nextPos,
				coronaPositions: nextCoronas,
			};
		}
	}

	if (!hullsChanged && !tlcChanged) return model;
	return {
		...model,
		...(hullsChanged ? { hulls: nextHulls } : {}),
		...(tlcChanged ? { trafficLights: nextTrafficLights } : {}),
	};
}

// =============================================================================
// Bulk full-3D rotate (Matrix44 path — issue #78)
// =============================================================================

/**
 * Rotate every entity in the Selection around `pivot` by the delta Euler
 * `(rx, ry, rz)` in `STATIC_VEHICLE_DELTA_EULER_ORDER` (XYZ). This is the
 * Matrix44 path for a Selection that supports full 3-axis rotation —
 * typically a pure-static-vehicle Selection or a mixed Selection with
 * another full-3D resource family (trigger boxes).
 *
 * Composition per kind:
 *
 *   - Static vehicles: `mTransform` is pre-multiplied by `T(P) · R(delta)
 *     · T(-P)` so the translation column orbits the pivot AND the matrix's
 *     rotation portion is composed with the gesture delta.
 *
 *   - Yaw-packed boxes (junction / lightTrigger / lightInstance / corona):
 *     position orbits the pivot (XZ); the `.w` slot picks up `+ delta.y`
 *     (the yaw component of the gesture). Pitch / roll are dropped on the
 *     box itself because there's no slot to land them in — but the
 *     auto-disable rule (`bulkTrafficDataAxes`) should already have grayed
 *     those rings out if any yaw-packed sibling is in the Selection, so in
 *     practice the gesture's `delta.x` / `delta.z` are zero anyway.
 *
 *   - Lane rungs: both endpoints rotate as a rigid pair through the full
 *     3-axis delta. `.w` preserved verbatim.
 *
 * Returns the original `model` reference on identity delta OR empty refs.
 */
export function bulkRotateTrafficEntitiesMatrix44(
	model: ParsedTrafficDataRetail,
	refs: readonly TrafficDataEntityRef[],
	pivot: { x: number; y: number; z: number },
	deltaEuler: { x: number; y: number; z: number },
): ParsedTrafficDataRetail {
	if (deltaEuler.x === 0 && deltaEuler.y === 0 && deltaEuler.z === 0) return model;
	if (refs.length === 0) return model;

	// For yaw-packed siblings: the in-plane orbit + `.w` increment is
	// driven by the Y component of the delta. The pitch/roll components are
	// representationally dropped (auto-disable enforces this at the gizmo
	// level — see `bulkTrafficDataAxes`).
	const theta = deltaEuler.y;
	const cosT = theta === 0 ? 1 : Math.cos(theta);
	const sinT = theta === 0 ? 0 : Math.sin(theta);
	const cx = pivot.x;
	const cz = pivot.z;

	const orbit = (v: Vec4, addToW: boolean): Vec4 => {
		if (theta === 0) return v;
		const ox = v.x - cx;
		const oz = v.z - cz;
		return {
			x: ox * cosT - oz * sinT + cx,
			y: v.y,
			z: ox * sinT + oz * cosT + cz,
			w: addToW ? v.w + theta : v.w,
		};
	};

	const buckets = bucketRefs(refs);

	let hullsChanged = false;
	const nextHulls = model.hulls.map((hull, hullIdx): TrafficHull => {
		const bucket = buckets.hulls.get(hullIdx);
		if (!bucket) return hull;
		let touched = false;

		const nextStaticVehicles = bucket.staticVehicleIdxs.size
			? hull.staticTrafficVehicles.map((v, i): TrafficStaticVehicle => {
					if (!bucket.staticVehicleIdxs.has(i)) return v;
					const moved = rotateStaticVehicleMatrix44(v, pivot, deltaEuler);
					if (moved !== v) touched = true;
					return moved;
				})
			: hull.staticTrafficVehicles;

		const nextJunctions = bucket.junctionIdxs.size && theta !== 0
			? hull.junctions.map((j, i): TrafficJunctionLogicBox => {
					if (!bucket.junctionIdxs.has(i)) return j;
					touched = true;
					return { ...j, mPosition: orbit(j.mPosition, true) };
				})
			: hull.junctions;

		const nextLightTriggers = bucket.lightTriggerIdxs.size && theta !== 0
			? hull.lightTriggers.map((t, i): TrafficLightTrigger => {
					if (!bucket.lightTriggerIdxs.has(i)) return t;
					touched = true;
					return { ...t, mPosPlusYRot: orbit(t.mPosPlusYRot, true) };
				})
			: hull.lightTriggers;

		const nextRungs = bucket.laneRungIdxs.size && theta !== 0
			? hull.rungs.map((r, i): TrafficLaneRung => {
					if (!bucket.laneRungIdxs.has(i)) return r;
					touched = true;
					return {
						maPoints: [
							orbit(r.maPoints[0], false),
							orbit(r.maPoints[1], false),
						],
					};
				})
			: hull.rungs;

		if (!touched) return hull;
		hullsChanged = true;
		return {
			...hull,
			junctions: nextJunctions,
			lightTriggers: nextLightTriggers,
			rungs: nextRungs,
			staticTrafficVehicles: nextStaticVehicles,
		};
	});

	// Top-level traffic-light collection (only yaw-axis composition applies
	// — these are yaw-packed Vec4s).
	let tlcChanged = false;
	let nextTrafficLights: TrafficLightCollection = model.trafficLights;
	if (theta !== 0 && (buckets.lightInstances.size || buckets.coronas.size)) {
		const tlc = model.trafficLights;
		const nextPos = buckets.lightInstances.size
			? tlc.posAndYRotations.map((v, i) => {
					if (!buckets.lightInstances.has(i)) return v;
					tlcChanged = true;
					return orbit(v, true);
				})
			: tlc.posAndYRotations;
		const nextCoronas = buckets.coronas.size
			? tlc.coronaPositions.map((v, i) => {
					if (!buckets.coronas.has(i)) return v;
					tlcChanged = true;
					return orbit(v, true);
				})
			: tlc.coronaPositions;
		if (tlcChanged) {
			nextTrafficLights = {
				...tlc,
				posAndYRotations: nextPos,
				coronaPositions: nextCoronas,
			};
		}
	}

	if (!hullsChanged && !tlcChanged) return model;
	return {
		...model,
		...(hullsChanged ? { hulls: nextHulls } : {}),
		...(tlcChanged ? { trafficLights: nextTrafficLights } : {}),
	};
}

// =============================================================================
// Axes intersection contribution
// =============================================================================

/**
 * Per-ref TransformAxes contribution. Static vehicles are the only Matrix44
 * (full-3D) contributor in this module; every other kind is XZ-packed and
 * contributes the yaw-only profile from `TRAFFIC_YAW_PACKED_AXES`. Used by
 * `bulkTrafficDataAxes` to AND-intersect across a multi-Selection, and
 * exported so the overlay can label individual refs in mixed contexts.
 */
export function trafficDataRefAxes(ref: TrafficDataEntityRef): TransformAxes {
	if (ref.kind === 'staticVehicle') return TRANSFORM_AXES_FULL_3D;
	return TRAFFIC_YAW_PACKED_AXES;
}

/**
 * Effective TransformAxes for a multi-Selection of traffic-data entities
 * covered by this module. Pure static-vehicle (Matrix44) Selections get
 * full 3-axis rotate. Any yaw-packed contributor (junction / lightTrigger
 * / lightInstance / corona / laneRung) AND-collapses the rotate to yaw-
 * only, per ADR-0011.
 *
 * Returns `null` for an empty refs list.
 */
export function bulkTrafficDataAxes(
	refs: readonly TrafficDataEntityRef[],
): TransformAxes | null {
	if (refs.length === 0) return null;
	return intersectTransformAxes(refs.map(trafficDataRefAxes));
}
