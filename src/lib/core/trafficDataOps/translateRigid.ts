// Traffic-data rigid single-entity translate ops.
//
// Yaw-packed boxes (`TrafficJunctionLogicBox.mPosition`,
// `TrafficLightTrigger.mPosPlusYRot`, `TrafficLightCollection.posAndYRotations[]`,
// `TrafficLightCollection.coronaPositions[]`) all carry their position in
// the XYZ slots of a `Vec4`, with the W slot reserved for the per-box yaw
// (Y rotation). A translate gesture shifts only the position — the yaw is
// preserved verbatim. A rotate gesture is a *bulk* concern (a point can't
// rotate around itself) and lives in `./bulk.ts` so the position orbits a
// shared pivot AND the W slot picks up the gesture's yaw delta.
//
// Lane rungs (`TrafficLaneRung.maPoints[2]`) are pairs of `Vec4` endpoints
// that form a single horizontal segment. Translate moves both endpoints by
// the same delta; yaw rotate (in `./bulk.ts`) orbits each endpoint around
// the pivot. The pair is the unit of selection — there's no "select a
// single rung endpoint" affordance, because doing so would tear the segment.

import type {
	ParsedTrafficDataRetail,
	TrafficHull,
	TrafficJunctionLogicBox,
	TrafficLaneRung,
	TrafficLightCollection,
	TrafficLightTrigger,
	Vec4,
} from '../trafficData';

// =============================================================================
// Helpers
// =============================================================================

function replaceHull(
	model: ParsedTrafficDataRetail,
	hullIdx: number,
	next: TrafficHull,
): ParsedTrafficDataRetail {
	const hulls = model.hulls.map((h, i) => (i === hullIdx ? next : h));
	return { ...model, hulls };
}

function translateVec4Xyz(v: Vec4, dx: number, dy: number, dz: number): Vec4 {
	return { x: v.x + dx, y: v.y + dy, z: v.z + dz, w: v.w };
}

// =============================================================================
// Junction logic box — `mPosition` Vec4 with yaw in `.w`
// =============================================================================

/**
 * Translate a single junction logic box's `mPosition` by a 3D offset.
 * Touches only `mPosition.{x,y,z}` — the W slot (yaw) is preserved verbatim.
 *
 * Returns the original `model` reference when `(dx, dy, dz) === (0, 0, 0)`
 * so byte-for-byte BND2 writeback is preserved on a no-op gesture.
 *
 * @throws RangeError if any index is out of range.
 */
export function translateJunctionRigid(
	model: ParsedTrafficDataRetail,
	hullIdx: number,
	junctionIdx: number,
	offset: { x: number; y: number; z: number },
): ParsedTrafficDataRetail {
	if (hullIdx < 0 || hullIdx >= model.hulls.length) {
		throw new RangeError(`hullIdx ${hullIdx} out of range [0, ${model.hulls.length})`);
	}
	const hull = model.hulls[hullIdx];
	if (junctionIdx < 0 || junctionIdx >= hull.junctions.length) {
		throw new RangeError(`junctionIdx ${junctionIdx} out of range [0, ${hull.junctions.length})`);
	}
	const dx = offset.x;
	const dy = offset.y;
	const dz = offset.z;
	if (dx === 0 && dy === 0 && dz === 0) return model;

	const src = hull.junctions[junctionIdx];
	const next: TrafficJunctionLogicBox = {
		...src,
		mPosition: translateVec4Xyz(src.mPosition, dx, dy, dz),
	};
	const junctions = hull.junctions.map((j, i) => (i === junctionIdx ? next : j));
	return replaceHull(model, hullIdx, { ...hull, junctions });
}

// =============================================================================
// Light trigger — `mPosPlusYRot` Vec4 with yaw in `.w`
// =============================================================================

/**
 * Translate a single light trigger's `mPosPlusYRot` by a 3D offset.
 * Touches only the XYZ slots; the W slot (yaw) is preserved verbatim.
 *
 * Returns the original `model` reference on identity offset.
 *
 * @throws RangeError if any index is out of range.
 */
export function translateLightTriggerRigid(
	model: ParsedTrafficDataRetail,
	hullIdx: number,
	triggerIdx: number,
	offset: { x: number; y: number; z: number },
): ParsedTrafficDataRetail {
	if (hullIdx < 0 || hullIdx >= model.hulls.length) {
		throw new RangeError(`hullIdx ${hullIdx} out of range [0, ${model.hulls.length})`);
	}
	const hull = model.hulls[hullIdx];
	if (triggerIdx < 0 || triggerIdx >= hull.lightTriggers.length) {
		throw new RangeError(`triggerIdx ${triggerIdx} out of range [0, ${hull.lightTriggers.length})`);
	}
	const dx = offset.x;
	const dy = offset.y;
	const dz = offset.z;
	if (dx === 0 && dy === 0 && dz === 0) return model;

	const src = hull.lightTriggers[triggerIdx];
	const next: TrafficLightTrigger = {
		...src,
		mPosPlusYRot: translateVec4Xyz(src.mPosPlusYRot, dx, dy, dz),
	};
	const lightTriggers = hull.lightTriggers.map((t, i) => (i === triggerIdx ? next : t));
	return replaceHull(model, hullIdx, { ...hull, lightTriggers });
}

// =============================================================================
// Traffic-light collection — top-level (not under hulls)
// =============================================================================

/**
 * Translate one `posAndYRotations[i]` (per-light position + yaw) by a 3D
 * offset. The W slot (yaw) is preserved verbatim.
 */
export function translateLightInstanceRigid(
	model: ParsedTrafficDataRetail,
	instanceIdx: number,
	offset: { x: number; y: number; z: number },
): ParsedTrafficDataRetail {
	const tlc = model.trafficLights;
	if (instanceIdx < 0 || instanceIdx >= tlc.posAndYRotations.length) {
		throw new RangeError(
			`instanceIdx ${instanceIdx} out of range [0, ${tlc.posAndYRotations.length})`,
		);
	}
	const dx = offset.x;
	const dy = offset.y;
	const dz = offset.z;
	if (dx === 0 && dy === 0 && dz === 0) return model;

	const next: TrafficLightCollection = {
		...tlc,
		posAndYRotations: tlc.posAndYRotations.map((v, i) =>
			i === instanceIdx ? translateVec4Xyz(v, dx, dy, dz) : v,
		),
	};
	return { ...model, trafficLights: next };
}

/**
 * Translate one `coronaPositions[i]` Vec4 by a 3D offset. The W slot is
 * preserved verbatim — it carries a corona-specific authored value (yaw or
 * scale, depending on light type) that the gizmo doesn't reinterpret.
 */
export function translateCoronaRigid(
	model: ParsedTrafficDataRetail,
	coronaIdx: number,
	offset: { x: number; y: number; z: number },
): ParsedTrafficDataRetail {
	const tlc = model.trafficLights;
	if (coronaIdx < 0 || coronaIdx >= tlc.coronaPositions.length) {
		throw new RangeError(
			`coronaIdx ${coronaIdx} out of range [0, ${tlc.coronaPositions.length})`,
		);
	}
	const dx = offset.x;
	const dy = offset.y;
	const dz = offset.z;
	if (dx === 0 && dy === 0 && dz === 0) return model;

	const next: TrafficLightCollection = {
		...tlc,
		coronaPositions: tlc.coronaPositions.map((v, i) =>
			i === coronaIdx ? translateVec4Xyz(v, dx, dy, dz) : v,
		),
	};
	return { ...model, trafficLights: next };
}

// =============================================================================
// Lane rung — pair of Vec4 endpoints, moved as a single segment
// =============================================================================

/**
 * Translate a single lane rung as a rigid segment. Both endpoints move by
 * the same `(dx, dy, dz)`; the W slot on each is preserved verbatim.
 *
 * The rung is the unit of selection (per the rung-integrity rule in issue
 * #79's spec) — there's no "select one rung endpoint" affordance, because
 * tearing a rung's endpoints apart breaks the lane segment it represents.
 *
 * Returns the original `model` reference on identity offset.
 *
 * @throws RangeError if any index is out of range.
 */
export function translateLaneRungRigid(
	model: ParsedTrafficDataRetail,
	hullIdx: number,
	rungIdx: number,
	offset: { x: number; y: number; z: number },
): ParsedTrafficDataRetail {
	if (hullIdx < 0 || hullIdx >= model.hulls.length) {
		throw new RangeError(`hullIdx ${hullIdx} out of range [0, ${model.hulls.length})`);
	}
	const hull = model.hulls[hullIdx];
	if (rungIdx < 0 || rungIdx >= hull.rungs.length) {
		throw new RangeError(`rungIdx ${rungIdx} out of range [0, ${hull.rungs.length})`);
	}
	const dx = offset.x;
	const dy = offset.y;
	const dz = offset.z;
	if (dx === 0 && dy === 0 && dz === 0) return model;

	const src = hull.rungs[rungIdx];
	const next: TrafficLaneRung = {
		maPoints: [
			translateVec4Xyz(src.maPoints[0], dx, dy, dz),
			translateVec4Xyz(src.maPoints[1], dx, dy, dz),
		],
	};
	const rungs = hull.rungs.map((r, i) => (i === rungIdx ? next : r));
	return replaceHull(model, hullIdx, { ...hull, rungs });
}
