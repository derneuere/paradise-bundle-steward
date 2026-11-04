// The zone-list half of the shared **Bulk transform**.
//
// A zone is the streaming-PVS quad: `miNumPoints` (always 4 in retail)
// `Vec2Padded` entries on the ground plane. The packing is the thing to get
// right — on disk each point is a 16-byte stride of which only the first two
// f32s are coordinates, and those two are world **X and Z**, not X and Y.
// `Vec2Padded.y` therefore holds world Z (the same convention AI-section
// corners use), and the remaining two f32s (`_padA`, `_padB`) are opaque slots
// read verbatim so BND2 writeback stays byte-exact. A zone point has NO height
// storage at all, so `resolve` synthesises y = 0 and `write` discards
// `point.y` outright — the gizmo still renders its Y arrow (ADR-0011 keeps
// `translate.y` on so mixed selections can lift their 3D members), the zone
// simply has no slot to receive it.
//
// The load-bearing structural move is `expand`: a `zone` ref is NOT a leaf
// datum. It expands into one slot per corner, so a whole-zone rotate turns the
// quad about the shared pivot instead of sliding its centre around — and each
// corner independently contributes a pivot sample, which is what makes a
// single-zone gizmo anchor at the quad's median rather than at an arbitrary
// corner.
//
// No cascade: a zone's safe/unsafe neighbour lists are graph edges by index,
// not geometric joins, so moving a zone leaves the streaming graph
// semantically intact and its neighbours stay put.

import type { ParsedZoneList, Zone } from '../../zoneList';
import { TRANSFORM_AXES_XZ_PACKED } from '../../transformAxes';
import type { Point, Resolver } from '../types';

/**
 * Discriminated reference to a selectable zone-list entity. `zone` is a
 * container — the overlay's only selection today — and `zonePoint` addresses
 * one corner directly, for the per-point picking a later slice adds.
 */
export type ZoneListRef =
	/** The whole zone: every one of its corners transforms together. */
	| { kind: 'zone'; zoneIdx: number }
	/** A single corner (one of four in retail). */
	| { kind: 'zonePoint'; zoneIdx: number; pointIdx: number };

/**
 * Slots are corners, full stop. A `zone` ref expands to N of these, so the two
 * ref kinds collapse onto one storage address — which is exactly what makes a
 * whole-zone ref SUBSUME an individually-picked corner of the same zone rather
 * than moving it twice.
 */
export type ZoneListSlot = { kind: 'zonePoint'; zoneIdx: number; pointIdx: number };

/** Narrowed alias so call sites can name the resolver's type. */
export type ZoneListResolverT = Resolver<ParsedZoneList, ZoneListRef, ZoneListSlot>;

export const zoneListResolver: ZoneListResolverT = {
	id: 'zoneList',

	/**
	 * A `zone` becomes one slot per corner. `miNumPoints` is deliberately NOT
	 * consulted — the parser sizes `points` from the point-count table and the
	 * writer re-emits from `points.length`, so the array is the truth and a
	 * disagreeing header field must not make us address a corner that isn't
	 * there.
	 *
	 * Out-of-range refs expand to `[]` (whole-zone) or fall through to a null
	 * `resolve` (single corner); nothing throws. The old
	 * `translateZonePointRigid` raised a RangeError, but no overlay ever
	 * range-guarded before calling it, so a stale Selection was a crash waiting
	 * to happen rather than a silent skip.
	 */
	expand(model, ref) {
		const zone = model.zones[ref.zoneIdx];
		if (!zone) return [];
		if (ref.kind === 'zonePoint') {
			return [{ kind: 'zonePoint', zoneIdx: ref.zoneIdx, pointIdx: ref.pointIdx }];
		}
		return zone.points.map((_p, pointIdx) => ({
			kind: 'zonePoint' as const,
			zoneIdx: ref.zoneIdx,
			pointIdx,
		}));
	},

	key(slot) {
		return `zonePoint:${slot.zoneIdx}:${slot.pointIdx}`;
	},

	/**
	 * Unpacks the XZ storage into editor world space: `Vec2Padded.y` is world Z.
	 * `y` is synthetic — a zone point genuinely has no height — and it is 0
	 * rather than anything derived, so a zone in a mixed Selection contributes
	 * y = 0 samples to the shared pivot median exactly as the old
	 * `zoneListSelectionPivot` did.
	 */
	resolve(model, slot) {
		const zone = model.zones[slot.zoneIdx];
		if (!zone) return null;
		const p = zone.points[slot.pointIdx];
		if (!p) return null;
		return { x: p.x, y: 0, z: p.y };
	},

	/**
	 * Batched, single-pass write. `spin` is ignored: a corner is a bare
	 * coordinate pair with no orientation field, and the orbit is already baked
	 * into `point` by the shared math.
	 *
	 * Copy-on-write is a correctness requirement here, not a style choice. The
	 * parser slices every zone's `points` out of ONE shared pool by
	 * (start, count), so two zones whose point ranges overlap hold the *same*
	 * `Vec2Padded` objects. Mutating a point in place would silently drag the
	 * aliasing zone along with it.
	 *
	 * Reference identity (BND2 byte-for-byte writeback, not a perf tweak):
	 * untouched points, untouched zones and — when every write is a no-op — the
	 * input model itself all come back by reference, so the overlay's
	 * `next !== data` gate never dirties a Bundle that did not actually change.
	 * `_finalPad` rides along on the model spread.
	 */
	write(model, writes) {
		if (writes.length === 0) return model;

		const byZone = new Map<number, Map<number, Point>>();
		for (const w of writes) {
			let points = byZone.get(w.slot.zoneIdx);
			if (!points) {
				points = new Map<number, Point>();
				byZone.set(w.slot.zoneIdx, points);
			}
			points.set(w.slot.pointIdx, w.point);
		}

		let changed = false;
		const zones = model.zones.map((zone, zoneIdx) => {
			const wanted = byZone.get(zoneIdx);
			if (!wanted) return zone;

			let zoneTouched = false;
			const points = zone.points.map((p, pointIdx) => {
				const target = wanted.get(pointIdx);
				if (!target) return p;
				// `point.y` is dropped on the floor: no height storage exists.
				if (p.x === target.x && p.y === target.z) return p;
				zoneTouched = true;
				// Spread, so `_padA` / `_padB` survive verbatim.
				return { ...p, x: target.x, y: target.z };
			});

			if (!zoneTouched) return zone;
			changed = true;
			// Spread, so `muZoneId`, `miZoneType`, `miNumPoints`, `muFlags`, the
			// neighbour lists and `_pad0C` / `_pad24` / `_trailingNeighbourPad`
			// all survive by reference.
			return { ...zone, points } satisfies Zone;
		});

		if (!changed) return model;
		return { ...model, zones };
	},

	/**
	 * XZ-packed per ADR-0011: full 3-axis translate, yaw-only rotate. Corners
	 * have no Y to receive pitch (about X) or roll (about Z), so any Selection
	 * containing a zone AND-collapses those two rings for the whole gesture —
	 * including for any 3D sibling resource sharing the gizmo.
	 *
	 * Both ref kinds address the same XZ-packed storage, so the profile is a
	 * constant; it is also deliberately not cardinality-dependent (design §4).
	 * Null for an empty refs list so the caller renders no gizmo.
	 */
	axes(refs) {
		return refs.length === 0 ? null : TRANSFORM_AXES_XZ_PACKED;
	},
};
