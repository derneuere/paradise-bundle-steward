// The zone-list resolver: XZ packing, slot expansion, pad-slot survival,
// reference identity (including the shared-point-pool aliasing hazard), and
// the XZ-packed axis profile.
//
// Ported from the deleted `zoneListOps/bulk.test.ts`. The assertions that only
// re-verified median / rotate-about-pivot / identity-delta / empty-refs
// behaviour are deliberately NOT ported — those live once in
// `__tests__/math.test.ts` and `__tests__/transform.test.ts` now, and the six
// per-resource copies drifting apart is what motivated the merge.
//
// Two behaviour changes are pinned here on purpose:
//   * yaw sign — `theta = +PI/2` takes (10,0,0) to (0,0,-10), the true
//     right-hand / three.js convention. The gizmo's `rotationSignForCameraSide`
//     absorbs the flip, so nothing changes on screen. See design §5(g).
//   * an out-of-range zone or point index is a silent skip, not a RangeError.

import { describe, it, expect } from 'vitest';

import type { ParsedZoneList, Zone } from '../../../zoneList';
import { zoneListResolver, type ZoneListRef } from '../../resolvers/zoneList';
import { selectionPivot, transform } from '../../transform';
import { TRANSFORM_AXES_XZ_PACKED } from '../../../transformAxes';
import { delta, expectPoint } from '../_helpers';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** `Vec2Padded` with deliberately non-zero pad slots, so "the opaque f32s
 *  survive an edit" is actually observable rather than vacuously true. */
function makePoint(x: number, y: number) {
	return { x, y, _padA: 0.5, _padB: -0.25 };
}

function makeZone(opts: { id: bigint; points: { x: number; y: number }[] }): Zone {
	return {
		muZoneId: opts.id,
		miZoneType: 0,
		miNumPoints: opts.points.length,
		muFlags: 0,
		points: opts.points.map((p) => makePoint(p.x, p.y)),
		safeNeighbours: [{ zoneIndex: 1, muFlags: 2, _padA: 0, _padB: 0 }],
		unsafeNeighbours: [],
		_pad0C: 0xdeadbeef,
		_pad24: [1, 2, 3],
		_trailingNeighbourPad: new Uint8Array([9, 9]),
	};
}

/** A unit quad, corners CCW from the origin. */
function quad(ox: number, oz: number, w = 10, d = 10) {
	return [
		{ x: ox, y: oz },
		{ x: ox + w, y: oz },
		{ x: ox + w, y: oz + d },
		{ x: ox, y: oz + d },
	];
}

function makeModel(zones: Zone[]): ParsedZoneList {
	return { zones, _finalPad: new Uint8Array([1, 2, 3, 4]) };
}

function makeTrio(): ParsedZoneList {
	return makeModel([
		makeZone({ id: 1n, points: quad(0, 0) }),
		makeZone({ id: 2n, points: quad(20, 0) }),
		makeZone({ id: 3n, points: quad(40, 0) }),
	]);
}

const ZONE_0: ZoneListRef = { kind: 'zone', zoneIdx: 0 };
const ZONE_2: ZoneListRef = { kind: 'zone', zoneIdx: 2 };

/** Corner coordinates as `[worldX, worldZ]` pairs — remember `.y` is world Z. */
function corners(zone: Zone): [number, number][] {
	return zone.points.map((p) => [p.x, p.y]);
}

// ---------------------------------------------------------------------------
// Slot expansion
// ---------------------------------------------------------------------------

describe('zoneListResolver — slots', () => {
	it('expands a whole-zone ref into one slot per corner', () => {
		// This is the quirk the whole resolver exists for: a zone is a container,
		// not a leaf, so its four corners each become an independently-orbiting
		// slot instead of the zone having a single anchor position.
		const model = makeTrio();
		expect(zoneListResolver.expand(model, ZONE_0)).toEqual([
			{ kind: 'zonePoint', zoneIdx: 0, pointIdx: 0 },
			{ kind: 'zonePoint', zoneIdx: 0, pointIdx: 1 },
			{ kind: 'zonePoint', zoneIdx: 0, pointIdx: 2 },
			{ kind: 'zonePoint', zoneIdx: 0, pointIdx: 3 },
		]);
	});

	it('sizes the expansion from points.length, not the miNumPoints header', () => {
		// The parser fills `points` from the point-count table and the writer
		// re-emits from `points.length`, so a disagreeing header must never make
		// us address a corner that does not exist.
		const model = makeModel([makeZone({ id: 1n, points: quad(0, 0) })]);
		model.zones[0].miNumPoints = 99;
		expect(zoneListResolver.expand(model, ZONE_0)).toHaveLength(4);
	});

	it('expands a single-corner ref to itself, and keys it to the same storage', () => {
		const model = makeTrio();
		const pointRef: ZoneListRef = { kind: 'zonePoint', zoneIdx: 0, pointIdx: 2 };
		expect(zoneListResolver.expand(model, pointRef)).toEqual([pointRef]);
		// Whole-zone expansion and the direct pick must collide on `key`, or a
		// Selection holding both would transform that corner twice.
		const fromZone = zoneListResolver.expand(model, ZONE_0)[2];
		expect(zoneListResolver.key(fromZone)).toBe(zoneListResolver.key(pointRef));
	});

	it('moves a corner once when the zone AND that corner are both selected', () => {
		const model = makeTrio();
		const next = transform(
			model,
			[ZONE_0, { kind: 'zonePoint', zoneIdx: 0, pointIdx: 1 }],
			delta({ translate: { x: 5, y: 0, z: 0 } }),
			zoneListResolver,
		);
		expect(corners(next.zones[0])).toEqual([[5, 0], [15, 0], [15, 10], [5, 10]]);
	});

	it('expands an out-of-range zone to nothing and resolves a bad corner to null', () => {
		const model = makeTrio();
		expect(zoneListResolver.expand(model, { kind: 'zone', zoneIdx: 9 })).toEqual([]);
		expect(
			zoneListResolver.resolve(model, { kind: 'zonePoint', zoneIdx: 0, pointIdx: 9 }),
		).toBeNull();
		// End to end: the stale refs drop out and the live one still moves.
		const next = transform(
			model,
			[
				{ kind: 'zone', zoneIdx: 9 },
				{ kind: 'zonePoint', zoneIdx: 0, pointIdx: 9 },
				ZONE_0,
			],
			delta({ translate: { x: 1, y: 0, z: 0 } }),
			zoneListResolver,
		);
		expect(next.zones).toHaveLength(3);
		expect(next.zones[0].points[0].x).toBe(1);
	});
});

// ---------------------------------------------------------------------------
// XZ packing
// ---------------------------------------------------------------------------

describe('zoneListResolver — XZ packing', () => {
	it('reads Vec2Padded.y as world Z and synthesises y = 0', () => {
		// The disk format stores (x, z) in the first two f32s of a 16-byte
		// stride. A zone corner has no height at all, so the third component is
		// manufactured here rather than read.
		const model = makeModel([makeZone({ id: 1n, points: [{ x: 7, y: -3 }] })]);
		expect(zoneListResolver.resolve(model, { kind: 'zonePoint', zoneIdx: 0, pointIdx: 0 }))
			.toEqual({ x: 7, y: 0, z: -3 });
	});

	it('writes world Z back into Vec2Padded.y and discards the Y delta', () => {
		// ADR-0011 keeps translate.y enabled on the gizmo so mixed selections can
		// still lift their 3D members; the zone silently has nowhere to put it.
		const model = makeModel([makeZone({ id: 1n, points: [{ x: 0, y: 0 }] })]);
		const next = transform(
			model,
			[ZONE_0],
			delta({ translate: { x: 3, y: 100, z: -2 } }),
			zoneListResolver,
		);
		const p = next.zones[0].points[0];
		expect(p.x).toBe(3);
		expect(p.y).toBe(-2);
		expect(Object.keys(p)).toEqual(['x', 'y', '_padA', '_padB']);
	});

	it('lands a rotated Z in .y, with +PI/2 about +Y taking +X toward -Z', () => {
		const model = makeModel([makeZone({ id: 1n, points: [{ x: 10, y: 0 }] })]);
		const next = transform(
			model,
			[ZONE_0],
			delta({ rotate: { x: 0, y: Math.PI / 2, z: 0 }, pivot: { x: 0, y: 0, z: 0 } }),
			zoneListResolver,
		);
		const p = next.zones[0].points[0];
		expect(p.x).toBeCloseTo(0, 10);
		expect(p.y).toBeCloseTo(-10, 10);
	});
});

// ---------------------------------------------------------------------------
// Whole-zone rotate — the quad must TURN
// ---------------------------------------------------------------------------

describe('zoneListResolver — whole-zone rotate', () => {
	it('turns the quad about the shared pivot instead of moving its centre', () => {
		// A 20x10 rectangle: after a quarter turn it must measure 10 across X and
		// 20 across Z, with its centre unmoved. If `zone` were a leaf slot the
		// centre would swing around the pivot and the rectangle would keep its
		// original orientation — the exact bug slot expansion exists to prevent.
		const model = makeModel([makeZone({ id: 1n, points: quad(0, 0, 20, 10) })]);
		const next = transform(
			model,
			[ZONE_0],
			delta({ rotate: { x: 0, y: Math.PI / 2, z: 0 }, pivot: { x: 10, y: 0, z: 5 } }),
			zoneListResolver,
		);
		const xs = next.zones[0].points.map((p) => p.x);
		const zs = next.zones[0].points.map((p) => p.y);
		expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(10, 10);
		expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(20, 10);
		expect((Math.max(...xs) + Math.min(...xs)) / 2).toBeCloseTo(10, 10);
		expect((Math.max(...zs) + Math.min(...zs)) / 2).toBeCloseTo(5, 10);
		// Every corner actually moved — a "rotate" that left them in place would
		// pass the extent check above on a square.
		expect(corners(next.zones[0])).not.toEqual(corners(model.zones[0]));
	});

	it('keeps two zones rigid relative to each other through a shared rotate', () => {
		const model = makeModel([
			makeZone({ id: 1n, points: quad(0, 0) }),
			makeZone({ id: 2n, points: quad(20, 0) }),
		]);
		const before = Math.hypot(
			model.zones[1].points[0].x - model.zones[0].points[0].x,
			model.zones[1].points[0].y - model.zones[0].points[0].y,
		);
		const next = transform(
			model,
			[ZONE_0, { kind: 'zone', zoneIdx: 1 }],
			delta({ rotate: { x: 0, y: Math.PI / 3, z: 0 }, pivot: { x: 5, y: 0, z: 5 } }),
			zoneListResolver,
		);
		const after = Math.hypot(
			next.zones[1].points[0].x - next.zones[0].points[0].x,
			next.zones[1].points[0].y - next.zones[0].points[0].y,
		);
		expect(after).toBeCloseTo(before, 10);
	});

	it('anchors the gizmo at the median of the corners, not at a corner', () => {
		const model = makeModel([makeZone({ id: 1n, points: quad(0, 0) })]);
		// Median of [0, 0, 10, 10] is 5 on both axes; y is 0 because corners have
		// no height, which is what lets a zone mix into a 3D bulk's pivot.
		expect(selectionPivot(model, [ZONE_0], zoneListResolver)).toEqual({ x: 5, y: 0, z: 5 });
	});
});

// ---------------------------------------------------------------------------
// Padding, field preservation and reference identity
// ---------------------------------------------------------------------------

describe('zoneListResolver — writeback fidelity', () => {
	it('preserves the opaque point pad slots verbatim', () => {
		const model = makeTrio();
		const next = transform(model, [ZONE_0], delta({ translate: { x: 7, y: 0, z: 7 } }), zoneListResolver);
		for (const p of next.zones[0].points) {
			expect(p._padA).toBe(0.5);
			expect(p._padB).toBe(-0.25);
		}
	});

	it('preserves every non-spatial zone field, sharing the by-reference ones', () => {
		const model = makeTrio();
		const next = transform(model, [ZONE_0], delta({ translate: { x: 1, y: 0, z: 1 } }), zoneListResolver);
		const before = model.zones[0];
		const after = next.zones[0];
		expect(after.muZoneId).toBe(1n);
		expect(after.miZoneType).toBe(before.miZoneType);
		expect(after.miNumPoints).toBe(before.miNumPoints);
		expect(after.muFlags).toBe(before.muFlags);
		expect(after._pad0C).toBe(0xdeadbeef);
		// The pad arrays and the neighbour lists are re-emitted straight from
		// these objects, so identity — not just equality — is the writeback
		// contract.
		expect(after._pad24).toBe(before._pad24);
		expect(after._trailingNeighbourPad).toBe(before._trailingNeighbourPad);
		expect(after.safeNeighbours).toBe(before.safeNeighbours);
		expect(after.unsafeNeighbours).toBe(before.unsafeNeighbours);
		// And the model-level trailing pad rides along on the spread.
		expect(next._finalPad).toBe(model._finalPad);
	});

	it('returns unselected zones and untouched sibling corners by reference', () => {
		const model = makeTrio();
		const next = transform(
			model,
			[{ kind: 'zonePoint', zoneIdx: 0, pointIdx: 1 }],
			delta({ translate: { x: 5, y: 0, z: -5 } }),
			zoneListResolver,
		);
		expect(next.zones[1]).toBe(model.zones[1]);
		expect(next.zones[2]).toBe(model.zones[2]);
		expect(next.zones[0]).not.toBe(model.zones[0]);
		expect(next.zones[0].points[0]).toBe(model.zones[0].points[0]);
		expect(next.zones[0].points[2]).toBe(model.zones[0].points[2]);
		expect(next.zones[0].points[3]).toBe(model.zones[0].points[3]);
		expect(next.zones[0].points[1]).toMatchObject({ x: 15, y: -5 });
	});

	it('returns the input model when the write lands on the values already stored', () => {
		// A 2*PI yaw is a real gesture that resolves to the same coordinates.
		// Returning `model` keeps the overlay's `next !== data` gate from
		// dirtying a Bundle whose bytes would be identical.
		const model = makeModel([makeZone({ id: 1n, points: quad(0, 0) })]);
		const writes = zoneListResolver.expand(model, ZONE_0).map((slot) => ({
			slot,
			point: zoneListResolver.resolve(model, slot)!,
			spin: null,
		}));
		expect(zoneListResolver.write(model, writes)).toBe(model);
		expect(zoneListResolver.write(model, [])).toBe(model);
	});

	it('never mutates a point object shared between zones by the point pool', () => {
		// The parser slices each zone's `points` out of ONE pool by
		// (start, count), so overlapping ranges hand two zones the SAME
		// `Vec2Padded` object. An in-place write would drag the aliasing zone
		// along with the selected one.
		const shared = makePoint(0, 0);
		const model = makeModel([
			{ ...makeZone({ id: 1n, points: [] }), points: [shared] },
			{ ...makeZone({ id: 2n, points: [] }), points: [shared] },
		]);
		const next = transform(model, [ZONE_0], delta({ translate: { x: 5, y: 0, z: 5 } }), zoneListResolver);
		expect(next.zones[0].points[0]).toMatchObject({ x: 5, y: 5 });
		expect(next.zones[1].points[0]).toBe(shared);
		expect(shared).toMatchObject({ x: 0, y: 0 });
	});
});

// ---------------------------------------------------------------------------
// Axes
// ---------------------------------------------------------------------------

describe('zoneListResolver — axes', () => {
	it('reports yaw-only rotate with translate still 3-axis', () => {
		const axes = zoneListResolver.axes([ZONE_0]);
		expect(axes).toEqual(TRANSFORM_AXES_XZ_PACKED);
		expect(axes?.rotate.x).toBe(false);
		expect(axes?.rotate.y).toBe(true);
		expect(axes?.rotate.z).toBe(false);
		// Translate Y stays on: the gizmo renders the arrow and `write` drops the
		// delta, rather than the profile hiding an affordance a mixed Selection
		// legitimately needs.
		expect(axes?.translate.y).toBe(true);
	});

	it('reports the same profile for both ref kinds and any cardinality', () => {
		const one = zoneListResolver.axes([ZONE_0]);
		expect(zoneListResolver.axes([ZONE_0, ZONE_2])).toEqual(one);
		expect(zoneListResolver.axes([{ kind: 'zonePoint', zoneIdx: 0, pointIdx: 0 }])).toEqual(one);
	});

	it('returns null for an empty refs list so the caller renders no gizmo', () => {
		expect(zoneListResolver.axes([])).toBeNull();
		expect(selectionPivot(makeTrio(), [], zoneListResolver)).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// Compose order (the overlay used to hand-roll this)
// ---------------------------------------------------------------------------

describe('zoneListResolver — translate + rotate in one gesture', () => {
	it('rotates about the TRANSLATE-ADJUSTED pivot', () => {
		const model = makeModel([makeZone({ id: 1n, points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] })]);
		const next = transform(
			model,
			[ZONE_0],
			delta({
				translate: { x: 100, y: 0, z: 0 },
				rotate: { x: 0, y: Math.PI / 2, z: 0 },
				pivot: { x: 0, y: 0, z: 0 },
			}),
			zoneListResolver,
		);
		// The corner sitting on the pivot lands exactly on the moved pivot; its
		// neighbour orbits it.
		expectPoint(
			{ x: next.zones[0].points[0].x, y: 0, z: next.zones[0].points[0].y },
			{ x: 100, y: 0, z: 0 },
		);
		expectPoint(
			{ x: next.zones[0].points[1].x, y: 0, z: next.zones[0].points[1].y },
			{ x: 100, y: 0, z: -10 },
		);
	});
});
