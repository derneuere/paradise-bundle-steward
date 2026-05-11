// Bulk-transform ops for the traffic-data resource family — yaw-packed
// boxes + lane rungs (issue #79).
//
// Cardinality ≥ 1 entry points for the unified Bulk-transform gizmo. A
// **Selection** of any combination of traffic yaw-packed boxes and lane
// rungs is treated as one rigid body: every member orbits the same pivot,
// and every yaw-packed box's `.w` slot picks up the gesture's yaw delta in
// addition to the position orbit (rigid-body composition).
//
// Static traffic vehicles (Matrix44, full 3D) live in their own module —
// they're the subject of issue #78, blocked on issue #77's trigger-box
// work. Not folded into this file because their axis profile differs (full
// 3-axis vs yaw-only) and the rotate semantics aren't the same (a Matrix44
// composes with the rotation matrix; a Vec4 box composes only the W slot).

import type {
	ParsedTrafficDataRetail,
	TrafficHull,
	TrafficJunctionLogicBox,
	TrafficLaneRung,
	TrafficLightCollection,
	TrafficLightTrigger,
	Vec4,
} from '../trafficData';
import type { TransformAxes } from '../transformAxes';
import { TRAFFIC_YAW_PACKED_AXES } from './transformAxes';

// =============================================================================
// Entity references
// =============================================================================

/**
 * Discriminated reference to a single spatial datum in a
 * ParsedTrafficDataRetail. Static vehicles intentionally omitted — they
 * live in their own module and have a different axis profile.
 *
 * Lane rungs are addressed as a single ref (NOT per-endpoint): both
 * endpoints move together so the rung remains a single segment. Selecting
 * one endpoint at a time would tear the lane topology — see the comment in
 * `translateLaneRungRigid` for the rationale.
 */
export type TrafficDataEntityRef =
	| { kind: 'junction'; hullIdx: number; junctionIdx: number }
	| { kind: 'lightTrigger'; hullIdx: number; triggerIdx: number }
	| { kind: 'lightInstance'; instanceIdx: number }
	| { kind: 'corona'; coronaIdx: number }
	| { kind: 'laneRung'; hullIdx: number; rungIdx: number };

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
			return null;
	}
}

// =============================================================================
// Pivot
// =============================================================================

/**
 * Median (per-component) of every spatial point the Selection addresses.
 * Each yaw-packed box contributes its `(x, y, z)` (ignoring `.w`). Each
 * lane rung contributes BOTH endpoints (xyz × 2). Returns `null` for empty
 * / out-of-range refs.
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
 * endpoints both shift by the same delta (rung stays a single segment).
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

	// Hull-scope updates: junctions, lightTriggers, laneRungs.
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

		if (!touched) return hull;
		hullsChanged = true;
		return {
			...hull,
			junctions: nextJunctions,
			lightTriggers: nextLightTriggers,
			rungs: nextRungs,
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
 * radians. The composition rule (per issue #79):
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

		if (!touched) return hull;
		hullsChanged = true;
		return {
			...hull,
			junctions: nextJunctions,
			lightTriggers: nextLightTriggers,
			rungs: nextRungs,
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
// Axes intersection contribution
// =============================================================================

/**
 * Effective TransformAxes for a multi-Selection of traffic-data entities
 * covered by this module (junctions, lightTriggers, lightInstances,
 * coronas, laneRungs). All are XZ-packed per ADR-0011 — yaw-only.
 *
 * Returns `null` for an empty refs list.
 */
export function bulkTrafficDataAxes(
	refs: readonly TrafficDataEntityRef[],
): TransformAxes | null {
	if (refs.length === 0) return null;
	return TRAFFIC_YAW_PACKED_AXES;
}
