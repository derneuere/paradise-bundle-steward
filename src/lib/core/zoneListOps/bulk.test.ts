// Unit tests for zoneListOps — single-entity translate, bulk translate,
// bulk yaw rotate, axes intersection contribution.

import { describe, it, expect } from 'vitest';
import type { ParsedZoneList, Zone } from '../zoneList';
import {
	ZONE_POINT_AXES,
	bulkRotateZoneEntitiesYaw,
	bulkTranslateZoneEntities,
	bulkZoneListAxes,
	translateZonePointRigid,
	translateZoneRigid,
	zoneListSelectionPivot,
	type ZoneListEntityRef,
} from '.';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makePoint(x: number, y: number) {
	// Vec2Padded with deliberately non-zero pad slots so we can pin
	// "padding survives a translate / rotate" in assertions.
	return { x, y, _padA: 0.5, _padB: -0.25 };
}

function makeZone(opts: { id: bigint; points: { x: number; y: number }[] }): Zone {
	return {
		muZoneId: opts.id,
		miZoneType: 0,
		miNumPoints: opts.points.length,
		muFlags: 0,
		points: opts.points.map((p) => makePoint(p.x, p.y)),
		safeNeighbours: [],
		unsafeNeighbours: [],
		_pad0C: 0,
		_pad24: [0, 0, 0],
		_trailingNeighbourPad: new Uint8Array(0),
	};
}

function makeModel(zones: Zone[]): ParsedZoneList {
	return { zones };
}

const PADS = { _padA: 0.5, _padB: -0.25 };

// ---------------------------------------------------------------------------
// Single-entity translate
// ---------------------------------------------------------------------------

describe('translateZonePointRigid', () => {
	it('shifts the addressed point by (dx, dz) and preserves padding', () => {
		const model = makeModel([
			makeZone({
				id: 0xA00n,
				points: [
					{ x: 0, y: 0 },
					{ x: 10, y: 0 },
					{ x: 10, y: 10 },
					{ x: 0, y: 10 },
				],
			}),
		]);
		const next = translateZonePointRigid(model, 0, 1, { x: 3, z: -2 });
		const moved = next.zones[0].points[1];
		expect(moved.x).toBe(13);
		expect(moved.y).toBe(-2);
		expect(moved._padA).toBe(0.5);
		expect(moved._padB).toBe(-0.25);
		// Other points are referentially identical.
		expect(next.zones[0].points[0]).toBe(model.zones[0].points[0]);
		expect(next.zones[0].points[2]).toBe(model.zones[0].points[2]);
		expect(next.zones[0].points[3]).toBe(model.zones[0].points[3]);
	});

	it('returns the original model on a (0, 0) offset', () => {
		const model = makeModel([makeZone({ id: 0n, points: [{ x: 0, y: 0 }] })]);
		expect(translateZonePointRigid(model, 0, 0, { x: 0, z: 0 })).toBe(model);
	});

	it('throws RangeError for out-of-range indices', () => {
		const model = makeModel([makeZone({ id: 0n, points: [{ x: 0, y: 0 }] })]);
		expect(() => translateZonePointRigid(model, 5, 0, { x: 1, z: 0 })).toThrow(RangeError);
		expect(() => translateZonePointRigid(model, 0, 5, { x: 1, z: 0 })).toThrow(RangeError);
	});
});

describe('translateZoneRigid', () => {
	it('shifts every point of the addressed zone by the same offset', () => {
		const model = makeModel([
			makeZone({
				id: 1n,
				points: [
					{ x: 0, y: 0 },
					{ x: 10, y: 0 },
					{ x: 10, y: 10 },
					{ x: 0, y: 10 },
				],
			}),
		]);
		const next = translateZoneRigid(model, 0, { x: 5, z: 5 });
		expect(next.zones[0].points.map((p) => [p.x, p.y])).toEqual([
			[5, 5], [15, 5], [15, 15], [5, 15],
		]);
	});
});

// ---------------------------------------------------------------------------
// Bulk translate
// ---------------------------------------------------------------------------

describe('bulkTranslateZoneEntities', () => {
	function makeTrio(): ParsedZoneList {
		return makeModel([
			makeZone({ id: 1n, points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] }),
			makeZone({ id: 2n, points: [{ x: 20, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 10 }, { x: 20, y: 10 }] }),
			makeZone({ id: 3n, points: [{ x: 40, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 10 }, { x: 40, y: 10 }] }),
		]);
	}

	it('translates whole-zone refs by the same delta as a rigid body', () => {
		const model = makeTrio();
		const refs: ZoneListEntityRef[] = [
			{ kind: 'zone', zoneIdx: 0 },
			{ kind: 'zone', zoneIdx: 2 },
		];
		const next = bulkTranslateZoneEntities(model, refs, { x: 1, z: 2 });
		// Selected zones shifted.
		expect(next.zones[0].points[0]).toMatchObject({ x: 1, y: 2 });
		expect(next.zones[2].points[0]).toMatchObject({ x: 41, y: 2 });
		// Unselected zone untouched (===).
		expect(next.zones[1]).toBe(model.zones[1]);
	});

	it('translates point-scope refs without touching siblings on the same zone', () => {
		const model = makeTrio();
		const refs: ZoneListEntityRef[] = [
			{ kind: 'zonePoint', zoneIdx: 0, pointIdx: 0 },
			{ kind: 'zonePoint', zoneIdx: 0, pointIdx: 2 },
		];
		const next = bulkTranslateZoneEntities(model, refs, { x: 5, z: -5 });
		expect(next.zones[0].points[0]).toMatchObject({ x: 5, y: -5 });
		expect(next.zones[0].points[2]).toMatchObject({ x: 15, y: 5 });
		// Siblings untouched (===).
		expect(next.zones[0].points[1]).toBe(model.zones[0].points[1]);
		expect(next.zones[0].points[3]).toBe(model.zones[0].points[3]);
		// Sibling zones untouched (===).
		expect(next.zones[1]).toBe(model.zones[1]);
		expect(next.zones[2]).toBe(model.zones[2]);
	});

	it('returns the original model on an identity offset', () => {
		const model = makeTrio();
		expect(
			bulkTranslateZoneEntities(model, [{ kind: 'zone', zoneIdx: 0 }], { x: 0, z: 0 }),
		).toBe(model);
	});

	it('returns the original model on an empty refs list', () => {
		const model = makeTrio();
		expect(bulkTranslateZoneEntities(model, [], { x: 1, z: 1 })).toBe(model);
	});

	it('preserves padding (_padA, _padB) verbatim across the translate', () => {
		const model = makeTrio();
		const next = bulkTranslateZoneEntities(
			model,
			[{ kind: 'zonePoint', zoneIdx: 0, pointIdx: 0 }],
			{ x: 7, z: 7 },
		);
		expect(next.zones[0].points[0]._padA).toBe(PADS._padA);
		expect(next.zones[0].points[0]._padB).toBe(PADS._padB);
	});
});

// ---------------------------------------------------------------------------
// Bulk yaw rotate
// ---------------------------------------------------------------------------

describe('bulkRotateZoneEntitiesYaw', () => {
	it('rotates a point 90° around the world origin', () => {
		// A single point at (10, 0) → (0, 10) after +π/2 yaw around origin.
		const model = makeModel([
			makeZone({ id: 1n, points: [{ x: 10, y: 0 }] }),
		]);
		const next = bulkRotateZoneEntitiesYaw(
			model,
			[{ kind: 'zone', zoneIdx: 0 }],
			{ x: 0, z: 0 },
			Math.PI / 2,
		);
		const r = next.zones[0].points[0];
		expect(r.x).toBeCloseTo(0, 5);
		expect(r.y).toBeCloseTo(10, 5);
	});

	it('preserves relative distances within the bulk after rotation', () => {
		// Two zones — rotate as one rigid body around (5, 5). The distance
		// between the two centres must equal the pre-rotation distance.
		const model = makeModel([
			makeZone({ id: 1n, points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] }),
			makeZone({ id: 2n, points: [{ x: 20, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 10 }, { x: 20, y: 10 }] }),
		]);
		const refs: ZoneListEntityRef[] = [
			{ kind: 'zone', zoneIdx: 0 },
			{ kind: 'zone', zoneIdx: 1 },
		];
		const beforeC0 = avgPoint(model.zones[0].points);
		const beforeC1 = avgPoint(model.zones[1].points);
		const beforeDist = Math.hypot(beforeC1.x - beforeC0.x, beforeC1.z - beforeC0.z);
		const next = bulkRotateZoneEntitiesYaw(model, refs, { x: 5, z: 5 }, Math.PI / 3);
		const afterC0 = avgPoint(next.zones[0].points);
		const afterC1 = avgPoint(next.zones[1].points);
		const afterDist = Math.hypot(afterC1.x - afterC0.x, afterC1.z - afterC0.z);
		expect(afterDist).toBeCloseTo(beforeDist, 4);
	});

	it('returns the original model on theta === 0', () => {
		const model = makeModel([makeZone({ id: 1n, points: [{ x: 1, y: 1 }] })]);
		expect(
			bulkRotateZoneEntitiesYaw(
				model,
				[{ kind: 'zone', zoneIdx: 0 }],
				{ x: 0, z: 0 },
				0,
			),
		).toBe(model);
	});

	it('returns the original model on an empty refs list', () => {
		const model = makeModel([makeZone({ id: 1n, points: [{ x: 1, y: 1 }] })]);
		expect(bulkRotateZoneEntitiesYaw(model, [], { x: 0, z: 0 }, Math.PI)).toBe(model);
	});
});

function avgPoint(points: readonly { x: number; y: number }[]) {
	let sx = 0, sy = 0;
	for (const p of points) { sx += p.x; sy += p.y; }
	const n = points.length || 1;
	return { x: sx / n, z: sy / n };
}

// ---------------------------------------------------------------------------
// Pivot
// ---------------------------------------------------------------------------

describe('zoneListSelectionPivot', () => {
	it('returns the median XZ of the whole zone for a single whole-zone ref', () => {
		const model = makeModel([
			makeZone({ id: 1n, points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] }),
		]);
		const pivot = zoneListSelectionPivot(model, [{ kind: 'zone', zoneIdx: 0 }]);
		// Median of [0, 0, 10, 10] is (0+10)/2 = 5 for both X and Z.
		expect(pivot).toEqual({ x: 5, y: 0, z: 5 });
	});

	it('returns null on an empty / out-of-range refs list', () => {
		const model = makeModel([]);
		expect(zoneListSelectionPivot(model, [])).toBeNull();
		expect(
			zoneListSelectionPivot(
				makeModel([makeZone({ id: 1n, points: [{ x: 0, y: 0 }] })]),
				[{ kind: 'zone', zoneIdx: 99 }],
			),
		).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// Axes
// ---------------------------------------------------------------------------

describe('bulkZoneListAxes', () => {
	it('reports yaw-only for any non-empty zone-point Selection', () => {
		const axes = bulkZoneListAxes([{ kind: 'zone', zoneIdx: 0 }]);
		expect(axes).toEqual(ZONE_POINT_AXES);
		expect(axes?.rotate.x).toBe(false);
		expect(axes?.rotate.y).toBe(true);
		expect(axes?.rotate.z).toBe(false);
		// Translate Y still on — the gizmo renders the Y arrow and the
		// commit-side drops the delta.y for XZ-packed entities.
		expect(axes?.translate.y).toBe(true);
	});

	it('returns null for an empty refs list', () => {
		expect(bulkZoneListAxes([])).toBeNull();
	});
});
