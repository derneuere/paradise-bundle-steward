// The street-data resolver: field preservation, reference identity, the
// silent-skip range policy, and the pure-3D axis profile.
//
// Ported from the deleted `streetDataOps/bulk.test.ts`. The assertions that
// only re-verified median / pivot / rotate-about-pivot / no-op-guard maths are
// deliberately NOT ported — those live once in `__tests__/math.test.ts` and
// `__tests__/transform.test.ts` now, and duplicating them per resource is what
// let the six copies drift apart in the first place.
//
// Two behaviour changes are pinned here on purpose:
//   * yaw sign — `theta = +PI/2` now takes (10,0,0) to (0,0,-10), the true
//     right-hand / three.js convention. The old op rotated the other way; the
//     gizmo's `rotationSignForCameraSide` absorbs the flip, so nothing changes
//     on screen. See design §5(g).
//   * an out-of-range road index is a silent skip, not a RangeError.

import { describe, it, expect } from 'vitest';

import type { ParsedStreetData, Road } from '../../../streetData';
import { streetDataResolver, type StreetDataRef } from '../../resolvers/streetData';
import { selectionPivot, transform } from '../../transform';
import { TRANSFORM_AXES_FULL_3D } from '../../../transformAxes';
import { delta, expectPoint } from '../_helpers';

function makeRoad(opts: { id: bigint; pos: { x: number; y: number; z: number } }): Road {
	return {
		mReferencePosition: opts.pos,
		mpaSpans: 0,
		mId: opts.id,
		miRoadLimitId0: 0n,
		miRoadLimitId1: 0n,
		macDebugName: '',
		mChallenge: 0,
		miSpanCount: 0,
		unknown: 1,
		padding: [0, 0, 0, 0],
	};
}

function makeModel(roads: Road[]): ParsedStreetData {
	return {
		miVersion: 0,
		mpaStreets: 0,
		mpaJunctions: 0,
		mpaRoads: 0,
		mpaChallengeParScores: 0,
		streets: [],
		junctions: [],
		roads,
		challenges: [],
	};
}

function makeTrio(): ParsedStreetData {
	return makeModel([
		makeRoad({ id: 1n, pos: { x: 0, y: 0, z: 0 } }),
		makeRoad({ id: 2n, pos: { x: 100, y: 0, z: 0 } }),
		makeRoad({ id: 3n, pos: { x: 200, y: 0, z: 0 } }),
	]);
}

const ROAD_0: StreetDataRef = { kind: 'road', roadIdx: 0 };
const ROAD_2: StreetDataRef = { kind: 'road', roadIdx: 2 };

describe('streetDataResolver — slots', () => {
	it('expands a road ref to exactly itself (a road IS a leaf datum)', () => {
		const model = makeTrio();
		expect(streetDataResolver.expand(model, ROAD_0)).toEqual([ROAD_0]);
		expect(streetDataResolver.key(ROAD_0)).toBe('road:0');
		expect(streetDataResolver.key(ROAD_2)).not.toBe(streetDataResolver.key(ROAD_0));
	});

	it('resolves mReferencePosition as a copy, not a live handle into the model', () => {
		const model = makeTrio();
		const p = streetDataResolver.resolve(model, ROAD_2);
		expect(p).toEqual({ x: 200, y: 0, z: 0 });
		expect(p).not.toBe(model.roads[2].mReferencePosition);
	});

	it('resolves an out-of-range road to null instead of throwing', () => {
		const model = makeTrio();
		expect(streetDataResolver.resolve(model, { kind: 'road', roadIdx: 9 })).toBeNull();
		// End to end: the stale ref is dropped and the live one still moves.
		const next = transform(
			model,
			[{ kind: 'road', roadIdx: 9 }, ROAD_0],
			delta({ translate: { x: 5, y: 0, z: 0 } }),
			streetDataResolver,
		);
		expect(next.roads[0].mReferencePosition).toEqual({ x: 5, y: 0, z: 0 });
		expect(next.roads).toHaveLength(3);
	});

	it('drops the gesture entirely when every ref is out of range', () => {
		const model = makeTrio();
		const next = transform(
			model,
			[{ kind: 'road', roadIdx: 9 }],
			delta({ translate: { x: 5, y: 0, z: 0 } }),
			streetDataResolver,
		);
		expect(next).toBe(model);
	});
});

describe('streetDataResolver — translate', () => {
	it('translates every selected road by the same delta', () => {
		const model = makeTrio();
		const next = transform(
			model,
			[ROAD_0, ROAD_2],
			delta({ translate: { x: 10, y: 20, z: 30 } }),
			streetDataResolver,
		);
		expect(next.roads[0].mReferencePosition).toEqual({ x: 10, y: 20, z: 30 });
		expect(next.roads[2].mReferencePosition).toEqual({ x: 210, y: 20, z: 30 });
	});

	it('returns unselected roads by reference and preserves every other field', () => {
		const model = makeTrio();
		const next = transform(model, [ROAD_0], delta({ translate: { x: 1, y: 2, z: 3 } }), streetDataResolver);
		// Structural sharing is the BND2 writeback contract, not a perf tweak:
		// an untouched road must re-encode to the exact bytes it was parsed from.
		expect(next.roads[1]).toBe(model.roads[1]);
		expect(next.roads[2]).toBe(model.roads[2]);
		expect(next.roads[0]).not.toBe(model.roads[0]);
		expect(next.roads[0].mId).toBe(1n);
		expect(next.roads[0].unknown).toBe(1);
		expect(next.roads[0].padding).toBe(model.roads[0].padding);
		// Sibling lists are shared wholesale.
		expect(next.streets).toBe(model.streets);
		expect(next.junctions).toBe(model.junctions);
		expect(next.challenges).toBe(model.challenges);
	});

	it('moves a duplicated ref exactly once', () => {
		const model = makeTrio();
		const next = transform(
			model,
			[ROAD_0, { kind: 'road', roadIdx: 0 }],
			delta({ translate: { x: 7, y: 0, z: 0 } }),
			streetDataResolver,
		);
		expect(next.roads[0].mReferencePosition).toEqual({ x: 7, y: 0, z: 0 });
	});
});

describe('streetDataResolver — rotate', () => {
	// A road's position is a full Vector3, so it orbits in 3D — but the yaw
	// ring is the one that has to be sign-correct, because four resources used
	// to disagree with three.js about which way +Y turns.
	it('orbits a road about the pivot on the XZ plane, leaving Y alone', () => {
		const model = makeModel([makeRoad({ id: 1n, pos: { x: 10, y: 7, z: 0 } })]);
		const next = transform(
			model,
			[ROAD_0],
			delta({ rotate: { x: 0, y: Math.PI / 2, z: 0 }, pivot: { x: 0, y: 0, z: 0 } }),
			streetDataResolver,
		);
		// +PI/2 about +Y takes +X toward -Z (right-hand rule / three.js).
		expectPoint(next.roads[0].mReferencePosition, { x: 0, y: 7, z: -10 });
	});

	it('takes pitch and roll too — nothing about a Vector3 anchor is XZ-locked', () => {
		const model = makeModel([makeRoad({ id: 1n, pos: { x: 0, y: 10, z: 0 } })]);
		const next = transform(
			model,
			[ROAD_0],
			delta({ rotate: { x: Math.PI / 2, y: 0, z: 0 }, pivot: { x: 0, y: 0, z: 0 } }),
			streetDataResolver,
		);
		// +PI/2 about +X takes +Y toward +Z.
		expectPoint(next.roads[0].mReferencePosition, { x: 0, y: 0, z: 10 });
	});

	it('rotates about the TRANSLATE-ADJUSTED pivot when a gesture mixes both', () => {
		// This is the compose order the overlay used to get wrong by hand:
		// translate first, then orbit about `pivot + translate`. A road sitting
		// on the pivot must therefore end up exactly on the moved pivot.
		const model = makeModel([
			makeRoad({ id: 1n, pos: { x: 0, y: 0, z: 0 } }),
			makeRoad({ id: 2n, pos: { x: 10, y: 0, z: 0 } }),
		]);
		const next = transform(
			model,
			[ROAD_0, { kind: 'road', roadIdx: 1 }],
			delta({
				translate: { x: 100, y: 0, z: 0 },
				rotate: { x: 0, y: Math.PI / 2, z: 0 },
				pivot: { x: 0, y: 0, z: 0 },
			}),
			streetDataResolver,
		);
		expectPoint(next.roads[0].mReferencePosition, { x: 100, y: 0, z: 0 });
		expectPoint(next.roads[1].mReferencePosition, { x: 100, y: 0, z: -10 });
	});
});

describe('streetDataResolver — pivot and axes', () => {
	it('anchors the gizmo at the per-component median of the selected roads', () => {
		const model = makeModel([
			makeRoad({ id: 1n, pos: { x: 0, y: 0, z: 0 } }),
			makeRoad({ id: 2n, pos: { x: 100, y: 50, z: 50 } }),
			makeRoad({ id: 3n, pos: { x: 200, y: 100, z: 100 } }),
		]);
		const pivot = selectionPivot(
			model,
			[ROAD_0, { kind: 'road', roadIdx: 1 }, ROAD_2],
			streetDataResolver,
		);
		expect(pivot).toEqual({ x: 100, y: 50, z: 50 });
	});

	it('reports full 3-axis translate AND rotate so it vetoes nothing in a mixed bulk', () => {
		const axes = streetDataResolver.axes([ROAD_0]);
		expect(axes).toEqual(TRANSFORM_AXES_FULL_3D);
	});

	it('reports the same profile for one road as for many (cardinality is not a factor)', () => {
		// The pivot is drag-repositionable, so a lone point genuinely orbits.
		expect(streetDataResolver.axes([ROAD_0])).toEqual(streetDataResolver.axes([ROAD_0, ROAD_2]));
	});

	it('returns null for an empty refs list so the caller renders no gizmo', () => {
		expect(streetDataResolver.axes([])).toBeNull();
		expect(selectionPivot(makeTrio(), [], streetDataResolver)).toBeNull();
	});
});
