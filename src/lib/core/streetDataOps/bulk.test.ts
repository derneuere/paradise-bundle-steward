// Unit tests for streetDataOps — single-entity translate, bulk translate,
// bulk yaw rotate, axes intersection contribution.

import { describe, it, expect } from 'vitest';
import type { ParsedStreetData, Road } from '../streetData';
import {
	STREET_REF_POSITION_AXES,
	STREET_REF_POSITION_BULK_AXES,
	bulkRotateRoadRefsYaw,
	bulkStreetDataAxes,
	bulkTranslateRoadRefs,
	streetDataSelectionPivot,
	translateRoadRefPositionRigid,
	type StreetDataEntityRef,
} from '.';

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
		challengeParScores: [],
	};
}

describe('translateRoadRefPositionRigid', () => {
	it('shifts mReferencePosition by (dx, dy, dz)', () => {
		const model = makeModel([makeRoad({ id: 0n, pos: { x: 1, y: 2, z: 3 } })]);
		const next = translateRoadRefPositionRigid(model, 0, { x: 4, y: 5, z: 6 });
		expect(next.roads[0].mReferencePosition).toEqual({ x: 5, y: 7, z: 9 });
		// Other fields on the road untouched.
		expect(next.roads[0].mId).toBe(0n);
	});

	it('returns the original model on identity offset', () => {
		const model = makeModel([makeRoad({ id: 0n, pos: { x: 1, y: 2, z: 3 } })]);
		expect(
			translateRoadRefPositionRigid(model, 0, { x: 0, y: 0, z: 0 }),
		).toBe(model);
	});

	it('throws RangeError for out-of-range index', () => {
		const model = makeModel([makeRoad({ id: 0n, pos: { x: 0, y: 0, z: 0 } })]);
		expect(() => translateRoadRefPositionRigid(model, 9, { x: 1, y: 0, z: 0 })).toThrow(
			RangeError,
		);
	});
});

describe('bulkTranslateRoadRefs', () => {
	function makeTrio(): ParsedStreetData {
		return makeModel([
			makeRoad({ id: 1n, pos: { x: 0, y: 0, z: 0 } }),
			makeRoad({ id: 2n, pos: { x: 100, y: 0, z: 0 } }),
			makeRoad({ id: 3n, pos: { x: 200, y: 0, z: 0 } }),
		]);
	}

	it('translates every selected road by the same delta', () => {
		const model = makeTrio();
		const refs: StreetDataEntityRef[] = [
			{ kind: 'road', roadIdx: 0 },
			{ kind: 'road', roadIdx: 2 },
		];
		const next = bulkTranslateRoadRefs(model, refs, { x: 10, y: 20, z: 30 });
		expect(next.roads[0].mReferencePosition).toEqual({ x: 10, y: 20, z: 30 });
		expect(next.roads[2].mReferencePosition).toEqual({ x: 210, y: 20, z: 30 });
		expect(next.roads[1]).toBe(model.roads[1]); // unselected untouched
	});

	it('returns the original model on identity offset', () => {
		const model = makeTrio();
		expect(
			bulkTranslateRoadRefs(model, [{ kind: 'road', roadIdx: 0 }], { x: 0, y: 0, z: 0 }),
		).toBe(model);
	});

	it('returns the original model on empty refs', () => {
		const model = makeTrio();
		expect(bulkTranslateRoadRefs(model, [], { x: 1, y: 0, z: 0 })).toBe(model);
	});
});

describe('bulkRotateRoadRefsYaw', () => {
	it('orbits a road around the pivot by theta on the XZ plane', () => {
		const model = makeModel([makeRoad({ id: 1n, pos: { x: 10, y: 7, z: 0 } })]);
		const next = bulkRotateRoadRefsYaw(
			model,
			[{ kind: 'road', roadIdx: 0 }],
			{ x: 0, z: 0 },
			Math.PI / 2,
		);
		const p = next.roads[0].mReferencePosition;
		expect(p.x).toBeCloseTo(0, 5);
		expect(p.y).toBe(7); // Y untouched
		expect(p.z).toBeCloseTo(10, 5);
	});

	it('returns the original model on theta === 0', () => {
		const model = makeModel([makeRoad({ id: 1n, pos: { x: 1, y: 1, z: 1 } })]);
		expect(
			bulkRotateRoadRefsYaw(model, [{ kind: 'road', roadIdx: 0 }], { x: 0, z: 0 }, 0),
		).toBe(model);
	});
});

describe('streetDataSelectionPivot', () => {
	it('returns the median XYZ across roads', () => {
		const model = makeModel([
			makeRoad({ id: 1n, pos: { x: 0, y: 0, z: 0 } }),
			makeRoad({ id: 2n, pos: { x: 100, y: 50, z: 50 } }),
			makeRoad({ id: 3n, pos: { x: 200, y: 100, z: 100 } }),
		]);
		const pivot = streetDataSelectionPivot(model, [
			{ kind: 'road', roadIdx: 0 },
			{ kind: 'road', roadIdx: 1 },
			{ kind: 'road', roadIdx: 2 },
		]);
		expect(pivot).toEqual({ x: 100, y: 50, z: 50 });
	});

	it('returns null for empty refs', () => {
		expect(streetDataSelectionPivot(makeModel([]), [])).toBeNull();
	});
});

describe('bulkStreetDataAxes', () => {
	it('reports all 3 axes for translate AND rotate so it does not veto pitch / roll', () => {
		const axes = bulkStreetDataAxes([{ kind: 'road', roadIdx: 0 }]);
		expect(axes).toEqual(STREET_REF_POSITION_BULK_AXES);
		expect(axes?.rotate.x).toBe(true);
		expect(axes?.rotate.y).toBe(true);
		expect(axes?.rotate.z).toBe(true);
	});

	it('returns null for empty refs', () => {
		expect(bulkStreetDataAxes([])).toBeNull();
	});

	it('single-entity STREET_REF_POSITION_AXES disables rotation rings (single point)', () => {
		expect(STREET_REF_POSITION_AXES.rotate.x).toBe(false);
		expect(STREET_REF_POSITION_AXES.rotate.y).toBe(false);
		expect(STREET_REF_POSITION_AXES.rotate.z).toBe(false);
	});
});
