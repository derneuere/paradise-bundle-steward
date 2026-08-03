// The street-data half of the shared **Bulk transform**.
//
// A Road's only spatial datum is `mReferencePosition`, a plain Vector3 — full
// 3D, no XZ packing, no orientation field, and no linked topology to drag
// along (a Road's structural pointers to Streets / Junctions / Spans /
// Challenges are graph edges by index, not geometric joins, so moving the
// anchor leaves them semantically intact). Streets and Junctions are indexed
// off a parent Road via `superSpanBase.miRoadIndex` and share its anchor in
// the overlay, so the Road is the transform target; if they ever acquire
// world-space positions of their own they fold in here as new ref kinds.
//
// That makes this the simplest resolver in the codebase and the ADR-0011
// pure-3D canary: it vetoes no rotate axis, so any Selection that mixes a road
// with an XZ-packed contributor (zone point, AI-section corner, traffic yaw
// box, lane rung) gets pitch/roll AND-ed off by the *other* contributor.

import type { ParsedStreetData, Road } from '../../streetData';
import { TRANSFORM_AXES_FULL_3D } from '../../transformAxes';
import type { Point, Resolver } from '../types';

/**
 * Discriminated reference to a single spatial datum in a `ParsedStreetData`.
 * One kind today; the union shape is kept so a future Street/Junction anchor
 * is an additive change rather than a signature change.
 */
export type StreetDataRef = { kind: 'road'; roadIdx: number };

/** Narrowed alias so call sites can name the resolver's type. Slots are refs:
 *  a road addresses exactly one position, so nothing expands. */
export type StreetDataResolverT = Resolver<ParsedStreetData, StreetDataRef, StreetDataRef>;

export const streetDataResolver: StreetDataResolverT = {
	id: 'streetData',

	// A road IS its own leaf spatial datum, so expansion is the identity.
	// Out-of-range refs are deliberately NOT filtered here — `resolve` returns
	// null for them and `resolveSlots` drops them, keeping one silent-skip path
	// rather than two. (The old `translateRoadRefPositionRigid` threw a
	// RangeError; nothing in production ever range-guarded before calling it.)
	expand(_model, ref) {
		return [ref];
	},

	key(slot) {
		return `road:${slot.roadIdx}`;
	},

	resolve(model, slot) {
		const road = model.roads[slot.roadIdx];
		if (!road) return null;
		const p = road.mReferencePosition;
		// Copied rather than aliased: the caller holds this point for the whole
		// gesture, and it must not be a live handle into the pre-gesture model.
		return { x: p.x, y: p.y, z: p.z };
	},

	/**
	 * Batched, single-pass write. `spin` is ignored on purpose: a Road stores a
	 * bare position and no basis, so there is nothing for a rotation delta to
	 * compose into — the orbit is already baked into `point` by the shared math.
	 *
	 * Reference identity (BND2 byte-for-byte writeback, not a perf tweak):
	 * unselected roads come back by reference, and a write whose points all
	 * equal what is already stored returns the INPUT model so the overlay's
	 * `next !== data` gate never dirties the Bundle.
	 */
	write(model, writes) {
		if (writes.length === 0) return model;

		const byRoad = new Map<number, Point>();
		for (const w of writes) byRoad.set(w.slot.roadIdx, w.point);

		let changed = false;
		const roads = model.roads.map((road, idx) => {
			const p = byRoad.get(idx);
			if (!p) return road;
			const cur = road.mReferencePosition;
			if (cur.x === p.x && cur.y === p.y && cur.z === p.z) return road;
			changed = true;
			const next: Road = { ...road, mReferencePosition: { x: p.x, y: p.y, z: p.z } };
			return next;
		});

		if (!changed) return model;
		return { ...model, roads };
	},

	/**
	 * Pure 3D: all three translate arrows and all three rotate rings. Null for
	 * an empty refs list so the caller renders no gizmo at all.
	 *
	 * Deliberately NOT cardinality-dependent (design §4). A lone road used to
	 * get its rotate rings disabled on the grounds that "a point rotating about
	 * itself is a no-op"; with a drag-repositionable pivot that is false — a
	 * single point orbits wherever the user put the pivot.
	 */
	axes(refs) {
		return refs.length === 0 ? null : TRANSFORM_AXES_FULL_3D;
	},
};
