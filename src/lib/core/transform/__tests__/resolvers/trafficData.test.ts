// The traffic-data resolver: slot expansion, Vec4 / Matrix44 packing, field
// preservation, reference identity, and the axis profile.
//
// Ported from the deleted `trafficDataOps/{bulk,staticVehicleMatrix44}.test.ts`.
// Assertions that only re-verified median / pivot / rotate-about-pivot /
// no-op-guard maths are deliberately NOT ported — those live once in
// `__tests__/math.test.ts` and `__tests__/transform.test.ts` now. Rotation
// behaviour lives next door in `trafficData.rotate.test.ts`.

import { describe, it, expect } from 'vitest';

import {
	trafficDataResolver as R,
	type TrafficDataRef,
} from '../../resolvers/trafficData';
import { selectionPivot, transform } from '../../transform';
import { TRANSFORM_AXES_FULL_3D, TRANSFORM_AXES_XZ_PACKED } from '../../../transformAxes';
import { delta } from '../_helpers';
import {
	makeHull,
	makeJunction,
	makeLightTrigger,
	makeLights,
	makeModel,
	makeRung,
	makeStaticVehicle,
	translationOf,
	vec4,
} from './_trafficFixtures';

const JUNCTION_0: TrafficDataRef = { kind: 'junction', hullIdx: 0, junctionIdx: 0 };
const RUNG_0: TrafficDataRef = { kind: 'laneRung', hullIdx: 0, rungIdx: 0 };
const VEHICLE_0: TrafficDataRef = { kind: 'staticVehicle', hullIdx: 0, vehicleIdx: 0 };

describe('trafficDataResolver — slots', () => {
	it('expands a lane rung into its TWO endpoint slots', () => {
		// A rung is a segment, not a point: both `maPoints` have to move, and
		// each carries its own pivot-sampling weight for free.
		const slots = R.expand(makeModel({}), RUNG_0);
		expect(slots).toHaveLength(2);
		expect(slots.map((s) => R.key(s))).toEqual([
			'laneRungPoint:0:0:0',
			'laneRungPoint:0:0:1',
		]);
	});

	it('expands every other ref to exactly itself', () => {
		const model = makeModel({});
		for (const ref of [
			JUNCTION_0,
			VEHICLE_0,
			{ kind: 'lightTrigger', hullIdx: 0, triggerIdx: 1 } as const,
			{ kind: 'lightInstance', instanceIdx: 2 } as const,
			{ kind: 'corona', coronaIdx: 3 } as const,
		]) {
			expect(R.expand(model, ref)).toEqual([ref]);
		}
	});

	it('resolves each storage representation to its world position', () => {
		const model = makeModel({
			hulls: [
				makeHull({
					junctions: [makeJunction(vec4(1, 2, 3, 0.5))],
					lightTriggers: [makeLightTrigger(vec4(4, 5, 6, 1.5))],
					rungs: [makeRung(vec4(7, 8, 9, 0), vec4(10, 11, 12, 0))],
					staticVehicles: [makeStaticVehicle({ x: 13, y: 14, z: 15 })],
				}),
			],
			lights: makeLights({
				posAndYRotations: [vec4(16, 17, 18, 2)],
				coronaPositions: [vec4(19, 20, 21, 3)],
			}),
		});
		expect(R.resolve(model, JUNCTION_0)).toEqual({ x: 1, y: 2, z: 3 });
		expect(R.resolve(model, { kind: 'lightTrigger', hullIdx: 0, triggerIdx: 0 }))
			.toEqual({ x: 4, y: 5, z: 6 });
		expect(R.resolve(model, { kind: 'laneRungPoint', hullIdx: 0, rungIdx: 0, pointIdx: 1 }))
			.toEqual({ x: 10, y: 11, z: 12 });
		// A static vehicle's position is its Matrix44 translation column.
		expect(R.resolve(model, VEHICLE_0)).toEqual({ x: 13, y: 14, z: 15 });
		expect(R.resolve(model, { kind: 'lightInstance', instanceIdx: 0 }))
			.toEqual({ x: 16, y: 17, z: 18 });
		expect(R.resolve(model, { kind: 'corona', coronaIdx: 0 }))
			.toEqual({ x: 19, y: 20, z: 21 });
	});

	it('resolves out-of-range refs to null instead of throwing', () => {
		const model = makeModel({ hulls: [makeHull({})] });
		expect(R.resolve(model, JUNCTION_0)).toBeNull();
		expect(R.resolve(model, { kind: 'junction', hullIdx: 9, junctionIdx: 0 })).toBeNull();
		expect(R.resolve(model, VEHICLE_0)).toBeNull();
		expect(R.resolve(model, { kind: 'corona', coronaIdx: 4 })).toBeNull();
		// End to end: a stale Selection is a no-op, not a crash.
		expect(transform(model, [JUNCTION_0], delta({ translate: { x: 1, y: 0, z: 0 } }), R))
			.toBe(model);
	});

	it('samples BOTH rung endpoints into the pivot', () => {
		const model = makeModel({
			hulls: [
				makeHull({
					junctions: [makeJunction(vec4(0, 0, 0, 0))],
					rungs: [makeRung(vec4(10, 0, 0, 0), vec4(20, 0, 0, 0))],
				}),
			],
		});
		// x samples are {0, 10, 20} -> median 10, which is only true because
		// the rung contributed two of them.
		expect(selectionPivot(model, [JUNCTION_0, RUNG_0], R)).toEqual({ x: 10, y: 0, z: 0 });
	});
});

describe('trafficDataResolver — translate packing', () => {
	it('shifts the XYZ slots of every yaw-packed Vec4 and echoes .w verbatim', () => {
		const model = makeModel({
			hulls: [
				makeHull({
					junctions: [makeJunction(vec4(10, 20, 30, 1.5))],
					lightTriggers: [makeLightTrigger(vec4(0, 0, 0, 2.5))],
				}),
			],
			lights: makeLights({
				posAndYRotations: [vec4(1, 1, 1, 0.5), vec4(2, 2, 2, 1)],
				coronaPositions: [vec4(0, 0, 0, 3.14)],
			}),
		});
		const next = transform(
			model,
			[
				JUNCTION_0,
				{ kind: 'lightTrigger', hullIdx: 0, triggerIdx: 0 },
				{ kind: 'lightInstance', instanceIdx: 1 },
				{ kind: 'corona', coronaIdx: 0 },
			],
			delta({ translate: { x: 1, y: 2, z: 3 } }),
			R,
		);
		expect(next.hulls[0].junctions[0].mPosition).toEqual({ x: 11, y: 22, z: 33, w: 1.5 });
		expect(next.hulls[0].lightTriggers[0].mPosPlusYRot).toEqual({ x: 1, y: 2, z: 3, w: 2.5 });
		expect(next.trafficLights.posAndYRotations[1]).toEqual({ x: 3, y: 4, z: 5, w: 1 });
		expect(next.trafficLights.coronaPositions[0]).toEqual({ x: 1, y: 2, z: 3, w: 3.14 });
		// Unselected sibling comes back by reference.
		expect(next.trafficLights.posAndYRotations[0])
			.toBe(model.trafficLights.posAndYRotations[0]);
	});

	it('moves both rung endpoints by the same delta, keeping the segment intact', () => {
		const model = makeModel({
			hulls: [makeHull({ rungs: [makeRung(vec4(0, 0, 0, 0.1), vec4(10, 0, 0, 0.2))] })],
		});
		const next = transform(model, [RUNG_0], delta({ translate: { x: 5, y: 1, z: 2 } }), R);
		const rung = next.hulls[0].rungs[0];
		expect(rung.maPoints[0]).toEqual({ x: 5, y: 1, z: 2, w: 0.1 });
		expect(rung.maPoints[1]).toEqual({ x: 15, y: 1, z: 2, w: 0.2 });
	});

	it('shifts a static vehicle\'s translation column and preserves its basis', () => {
		const v = makeStaticVehicle({ x: 10, y: 20, z: 30 }, { x: 0.1, y: 0.5, z: 0 });
		const model = makeModel({ hulls: [makeHull({ staticVehicles: [v] })] });
		const next = transform(model, [VEHICLE_0], delta({ translate: { x: 1, y: 2, z: 3 } }), R);
		const moved = next.hulls[0].staticTrafficVehicles[0];
		expect(translationOf(moved)).toEqual({ x: 11, y: 22, z: 33 });
		for (let i = 0; i < 12; i++) expect(moved.mTransform[i]).toBe(v.mTransform[i]);
	});

	it('keeps the Matrix44Affine pad slots at zero (3, 7, 11, 15)', () => {
		// On disk those four floats are 0, not the homogeneous [0,0,0,1]. A
		// stray 1 in slot 15 would change the bytes even on an unrotated car.
		const model = makeModel({
			hulls: [makeHull({ staticVehicles: [makeStaticVehicle({ x: 5, y: 0, z: 0 })] })],
		});
		const next = transform(
			model,
			[VEHICLE_0],
			delta({ translate: { x: 1, y: 1, z: 1 }, rotate: { x: 0, y: 0.3, z: 0 }, pivot: { x: 0, y: 0, z: 0 } }),
			R,
		);
		const m = next.hulls[0].staticTrafficVehicles[0].mTransform;
		expect(m).toHaveLength(16);
		for (const i of [3, 7, 11, 15]) expect(m[i]).toBe(0);
	});

	it('applies a duplicated ref exactly once', () => {
		// Marquee ∪ inspector routinely produces the same static vehicle twice;
		// with `spin` in play a double write would double-compose the rotation.
		const model = makeModel({
			hulls: [makeHull({ staticVehicles: [makeStaticVehicle({ x: 0, y: 0, z: 0 })] })],
		});
		const next = transform(
			model,
			[VEHICLE_0, { kind: 'staticVehicle', hullIdx: 0, vehicleIdx: 0 }],
			delta({ translate: { x: 7, y: 0, z: 0 } }),
			R,
		);
		expect(translationOf(next.hulls[0].staticTrafficVehicles[0]).x).toBe(7);
	});
});

describe('trafficDataResolver — reference identity (BND2 writeback)', () => {
	it('returns the input model on an identity gesture and on empty refs', () => {
		const model = makeModel({
			hulls: [makeHull({ junctions: [makeJunction(vec4(0, 0, 0, 0))] })],
		});
		expect(transform(model, [JUNCTION_0], delta(), R)).toBe(model);
		expect(transform(model, [], delta({ translate: { x: 1, y: 0, z: 0 } }), R)).toBe(model);
	});

	it('hands back untouched hulls, entities and the light collection by reference', () => {
		const junction = makeJunction(vec4(0, 0, 0, 0));
		const trigger = makeLightTrigger(vec4(9, 9, 9, 0));
		const rung = makeRung(vec4(0, 0, 0, 0), vec4(1, 0, 0, 0));
		const lengths = [0, 1];
		const hullA = makeHull({
			junctions: [junction, makeJunction(vec4(5, 5, 5, 0))],
			lightTriggers: [trigger],
			rungs: [rung],
			cumulativeRungLengths: lengths,
		});
		const hullB = makeHull({ junctions: [makeJunction(vec4(1, 1, 1, 0))] });
		const model = makeModel({ hulls: [hullA, hullB], lights: makeLights({ coronaPositions: [vec4(0, 0, 0, 0)] }) });

		const next = transform(model, [JUNCTION_0], delta({ translate: { x: 1, y: 0, z: 0 } }), R);
		expect(next).not.toBe(model);
		expect(next.hulls[1]).toBe(hullB);
		expect(next.hulls[0].junctions[1]).toBe(hullA.junctions[1]);
		expect(next.hulls[0].lightTriggers).toBe(hullA.lightTriggers);
		expect(next.hulls[0].rungs).toBe(hullA.rungs);
		expect(next.hulls[0].staticTrafficVehicles).toBe(hullA.staticTrafficVehicles);
		expect(next.trafficLights).toBe(model.trafficLights);
		// The touched junction keeps every non-spatial field.
		expect(next.hulls[0].junctions[0].mauStateTimings).toBe(junction.mauStateTimings);
		expect(next.hulls[0].junctions[0].miBikeStartDataIndex).toBe(-1);
	});

	it('never recomputes cumulativeRungLengths when a rung moves', () => {
		// It is index-parallel authored data the game reads for lane arc-length
		// lookups; regenerating it from the new geometry would silently rewrite
		// the track's traffic tuning.
		const lengths = [0, 12.5, 40];
		const model = makeModel({
			hulls: [
				makeHull({
					rungs: [makeRung(vec4(0, 0, 0, 0), vec4(10, 0, 0, 0))],
					cumulativeRungLengths: lengths,
				}),
			],
		});
		const next = transform(model, [RUNG_0], delta({ translate: { x: 100, y: 0, z: 0 } }), R);
		expect(next.hulls[0].rungs[0].maPoints[0].x).toBe(100);
		expect(next.hulls[0].cumulativeRungLengths).toBe(lengths);
	});

	it('leaves the PVS grid and a light trigger\'s dimensions alone', () => {
		// `mGridMin` / `mCellSize` are a spatial-hash origin and stride, and
		// `mDimensions` is a half-extent — none of them is a slot, so a
		// gesture that moves the trigger must not drag them along.
		const dims = vec4(4, 5, 6, 0);
		const model = makeModel({
			hulls: [makeHull({ lightTriggers: [makeLightTrigger(vec4(0, 0, 0, 0), dims)] })],
		});
		const next = transform(
			model,
			[{ kind: 'lightTrigger', hullIdx: 0, triggerIdx: 0 }],
			delta({ translate: { x: 50, y: 0, z: 50 }, rotate: { x: 0, y: 1, z: 0 }, pivot: { x: 0, y: 0, z: 0 } }),
			R,
		);
		expect(next.hulls[0].lightTriggers[0].mDimensions).toBe(dims);
		expect(next.pvs).toBe(model.pvs);
	});
});

describe('trafficDataResolver — axes', () => {
	it('reports yaw-only for every XZ-packed kind', () => {
		for (const ref of [
			JUNCTION_0,
			RUNG_0,
			{ kind: 'lightTrigger', hullIdx: 0, triggerIdx: 0 } as const,
			{ kind: 'lightInstance', instanceIdx: 0 } as const,
			{ kind: 'corona', coronaIdx: 0 } as const,
		]) {
			expect(R.axes([ref])).toEqual(TRANSFORM_AXES_XZ_PACKED);
		}
	});

	it('reports full 3-axis rotate for a pure static-vehicle Selection', () => {
		expect(R.axes([VEHICLE_0])).toEqual(TRANSFORM_AXES_FULL_3D);
	});

	it('AND-collapses to yaw-only as soon as a yaw-packed sibling joins (ADR-0011)', () => {
		expect(R.axes([VEHICLE_0, JUNCTION_0])).toEqual(TRANSFORM_AXES_XZ_PACKED);
		expect(R.axes([VEHICLE_0, RUNG_0])).toEqual(TRANSFORM_AXES_XZ_PACKED);
	});

	it('returns null for an empty refs list so the caller renders no gizmo', () => {
		expect(R.axes([])).toBeNull();
	});
});
