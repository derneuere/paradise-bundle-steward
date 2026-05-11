// Unit tests for trafficDataOps — single-entity translate, bulk translate,
// bulk yaw rotate (with rigid-body .w composition for yaw-packed boxes),
// bulk Matrix44 rotate (full 3-axis for static vehicles), axes intersection.

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
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
	TRAFFIC_STATIC_VEHICLE_AXES,
	TRAFFIC_YAW_PACKED_AXES,
	bulkRotateTrafficEntitiesMatrix44,
	bulkRotateTrafficEntitiesYaw,
	bulkTrafficDataAxes,
	bulkTranslateTrafficEntities,
	trafficDataRefAxes,
	trafficDataSelectionPivot,
	translateCoronaRigid,
	translateJunctionRigid,
	translateLaneRungRigid,
	translateLightInstanceRigid,
	translateLightTriggerRigid,
	type TrafficDataEntityRef,
} from '.';
import { intersectTransformAxes } from '../transformAxes';

// ---------------------------------------------------------------------------
// Fixtures — minimal valid retail model. Most arrays are empty; we only
// populate what each test exercises.
// ---------------------------------------------------------------------------

function vec4(x: number, y: number, z: number, w: number): Vec4 {
	return { x, y, z, w };
}

function makeJunction(pos: Vec4): TrafficJunctionLogicBox {
	return {
		muID: 0,
		mauStateTimings: new Array(16).fill(0),
		mauStoppedLightStates: new Array(16).fill(0),
		muNumStates: 0,
		muNumLights: 0,
		_pad36: [0, 0],
		muEventJunctionID: 0,
		miOfflineStartDataIndex: -1,
		miOnlineStartDataIndex: -1,
		miBikeStartDataIndex: -1,
		maTrafficLightControllers: [],
		_pad108: [],
		mPosition: pos,
	};
}

function makeLightTrigger(pos: Vec4): TrafficLightTrigger {
	return {
		mDimensions: vec4(1, 1, 1, 0),
		mPosPlusYRot: pos,
	};
}

function makeRung(a: Vec4, b: Vec4): TrafficLaneRung {
	return { maPoints: [a, b] };
}

/** Build a `TrafficStaticVehicle` from a translation + Euler rotation,
 *  composing via `THREE.Matrix4` so the storage layout (column-major) is
 *  the canonical one — same shape `readMatrix` consumes. */
function makeStaticVehicle(
	pos: { x: number; y: number; z: number },
	euler: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 },
): TrafficStaticVehicle {
	const mat = new THREE.Matrix4().compose(
		new THREE.Vector3(pos.x, pos.y, pos.z),
		new THREE.Quaternion().setFromEuler(new THREE.Euler(euler.x, euler.y, euler.z, 'XYZ')),
		new THREE.Vector3(1, 1, 1),
	);
	const arr = mat.toArray();
	arr[3] = 0; arr[7] = 0; arr[11] = 0; arr[15] = 0;
	return {
		mTransform: arr,
		mFlowTypeID: 0,
		mExistsAtAllChance: 0,
		muFlags: 0,
		_pad43: new Array(12).fill(0),
	};
}

function makeHull(opts: {
	junctions?: TrafficJunctionLogicBox[];
	lightTriggers?: TrafficLightTrigger[];
	rungs?: TrafficLaneRung[];
	staticVehicles?: TrafficStaticVehicle[];
} = {}): TrafficHull {
	return {
		muNumSections: 0,
		muNumSectionSpans: 0,
		muNumJunctions: opts.junctions?.length ?? 0,
		muNumStoplines: 0,
		muNumNeighbours: 0,
		muNumStaticTraffic: opts.staticVehicles?.length ?? 0,
		muNumVehicleAssets: 0,
		_pad07: 0,
		muNumRungs: opts.rungs?.length ?? 0,
		muFirstTrafficLight: 0,
		muLastTrafficLight: 0,
		muNumLightTriggers: opts.lightTriggers?.length ?? 0,
		muNumLightTriggersStartData: 0,
		sections: [],
		rungs: opts.rungs ?? [],
		cumulativeRungLengths: [],
		neighbours: [],
		sectionSpans: [],
		staticTrafficVehicles: opts.staticVehicles ?? [],
		sectionFlows: [],
		junctions: opts.junctions ?? [],
		stopLines: [],
		lightTriggers: opts.lightTriggers ?? [],
		lightTriggerStartData: [],
		lightTriggerJunctionLookup: [],
		mauVehicleAssets: [],
	};
}

function makeLights(opts: {
	posAndYRotations?: Vec4[];
	coronaPositions?: Vec4[];
} = {}): TrafficLightCollection {
	return {
		posAndYRotations: opts.posAndYRotations ?? [],
		instanceIDs: [],
		instanceTypes: [],
		trafficLightTypes: [],
		coronaTypes: [],
		coronaPositions: opts.coronaPositions ?? [],
		mauInstanceHashOffsets: [],
		instanceHashTable: [],
		instanceHashToIndexLookup: [],
	};
}

function makeModel(opts: {
	hulls?: TrafficHull[];
	lights?: TrafficLightCollection;
} = {}): ParsedTrafficDataRetail {
	return {
		kind: 'v45',
		muDataVersion: 45,
		muSizeInBytes: 0,
		pvs: {
			mGridMin: vec4(0, 0, 0, 0),
			mCellSize: vec4(1, 1, 1, 0),
			mRecipCellSize: vec4(1, 1, 1, 0),
			muNumCells_X: 0,
			muNumCells_Z: 0,
			muNumCells: 0,
			hullPvsSets: [],
		},
		hulls: opts.hulls ?? [],
		flowTypes: [],
		killZoneIds: [],
		killZones: [],
		killZoneRegions: [],
		vehicleTypes: [],
		vehicleTypesUpdate: [],
		vehicleAssets: [],
		vehicleTraits: [],
		trafficLights: opts.lights ?? makeLights(),
		paintColours: [],
	};
}

// ---------------------------------------------------------------------------
// Single-entity translate ops
// ---------------------------------------------------------------------------

describe('translateJunctionRigid', () => {
	it('shifts mPosition.{x,y,z} and preserves .w (yaw)', () => {
		const model = makeModel({
			hulls: [makeHull({ junctions: [makeJunction(vec4(10, 20, 30, 1.5))] })],
		});
		const next = translateJunctionRigid(model, 0, 0, { x: 1, y: 2, z: 3 });
		expect(next.hulls[0].junctions[0].mPosition).toEqual({ x: 11, y: 22, z: 33, w: 1.5 });
	});

	it('returns the original model on identity offset', () => {
		const model = makeModel({
			hulls: [makeHull({ junctions: [makeJunction(vec4(0, 0, 0, 0))] })],
		});
		expect(translateJunctionRigid(model, 0, 0, { x: 0, y: 0, z: 0 })).toBe(model);
	});
});

describe('translateLightTriggerRigid', () => {
	it('shifts mPosPlusYRot.{x,y,z} and preserves .w', () => {
		const model = makeModel({
			hulls: [makeHull({ lightTriggers: [makeLightTrigger(vec4(0, 0, 0, 2.5))] })],
		});
		const next = translateLightTriggerRigid(model, 0, 0, { x: 5, y: 0, z: -5 });
		expect(next.hulls[0].lightTriggers[0].mPosPlusYRot).toEqual({ x: 5, y: 0, z: -5, w: 2.5 });
	});
});

describe('translateLightInstanceRigid', () => {
	it('shifts the addressed posAndYRotations Vec4 and preserves .w', () => {
		const model = makeModel({
			lights: makeLights({
				posAndYRotations: [vec4(1, 1, 1, 0.5), vec4(2, 2, 2, 1.0)],
			}),
		});
		const next = translateLightInstanceRigid(model, 1, { x: 10, y: 0, z: 0 });
		expect(next.trafficLights.posAndYRotations[1]).toEqual({ x: 12, y: 2, z: 2, w: 1.0 });
		// Sibling untouched (===).
		expect(next.trafficLights.posAndYRotations[0]).toBe(model.trafficLights.posAndYRotations[0]);
	});
});

describe('translateCoronaRigid', () => {
	it('shifts the addressed coronaPositions Vec4 and preserves .w', () => {
		const model = makeModel({
			lights: makeLights({ coronaPositions: [vec4(0, 0, 0, 3.14)] }),
		});
		const next = translateCoronaRigid(model, 0, { x: 1, y: 0, z: 0 });
		expect(next.trafficLights.coronaPositions[0]).toEqual({ x: 1, y: 0, z: 0, w: 3.14 });
	});
});

describe('translateLaneRungRigid', () => {
	it('shifts both endpoints by the same delta and preserves .w on each', () => {
		const model = makeModel({
			hulls: [
				makeHull({
					rungs: [makeRung(vec4(0, 0, 0, 0.1), vec4(10, 0, 0, 0.2))],
				}),
			],
		});
		const next = translateLaneRungRigid(model, 0, 0, { x: 5, y: 1, z: 2 });
		const rung = next.hulls[0].rungs[0];
		expect(rung.maPoints[0]).toEqual({ x: 5, y: 1, z: 2, w: 0.1 });
		expect(rung.maPoints[1]).toEqual({ x: 15, y: 1, z: 2, w: 0.2 });
		// Segment length preserved (rung remains a single segment).
		const before = Math.hypot(
			model.hulls[0].rungs[0].maPoints[1].x - model.hulls[0].rungs[0].maPoints[0].x,
			model.hulls[0].rungs[0].maPoints[1].z - model.hulls[0].rungs[0].maPoints[0].z,
		);
		const after = Math.hypot(
			rung.maPoints[1].x - rung.maPoints[0].x,
			rung.maPoints[1].z - rung.maPoints[0].z,
		);
		expect(after).toBeCloseTo(before, 6);
	});
});

// ---------------------------------------------------------------------------
// Bulk translate
// ---------------------------------------------------------------------------

describe('bulkTranslateTrafficEntities', () => {
	it('translates a mixed Selection (junction + lane rung + light instance) by the same delta', () => {
		const model = makeModel({
			hulls: [
				makeHull({
					junctions: [makeJunction(vec4(0, 0, 0, 0))],
					rungs: [makeRung(vec4(10, 0, 0, 0), vec4(20, 0, 0, 0))],
				}),
			],
			lights: makeLights({
				posAndYRotations: [vec4(100, 50, 100, 0.5)],
			}),
		});
		const refs: TrafficDataEntityRef[] = [
			{ kind: 'junction', hullIdx: 0, junctionIdx: 0 },
			{ kind: 'laneRung', hullIdx: 0, rungIdx: 0 },
			{ kind: 'lightInstance', instanceIdx: 0 },
		];
		const next = bulkTranslateTrafficEntities(model, refs, { x: 5, y: 0, z: -5 });

		expect(next.hulls[0].junctions[0].mPosition).toEqual({ x: 5, y: 0, z: -5, w: 0 });
		expect(next.hulls[0].rungs[0].maPoints[0]).toMatchObject({ x: 15, z: -5 });
		expect(next.hulls[0].rungs[0].maPoints[1]).toMatchObject({ x: 25, z: -5 });
		expect(next.trafficLights.posAndYRotations[0]).toEqual({ x: 105, y: 50, z: 95, w: 0.5 });
	});

	it('preserves .w on every yaw-packed box across the translate', () => {
		const model = makeModel({
			hulls: [makeHull({ junctions: [makeJunction(vec4(0, 0, 0, 2.7))] })],
		});
		const next = bulkTranslateTrafficEntities(
			model,
			[{ kind: 'junction', hullIdx: 0, junctionIdx: 0 }],
			{ x: 1, y: 1, z: 1 },
		);
		expect(next.hulls[0].junctions[0].mPosition.w).toBe(2.7);
	});

	it('returns the original model on identity offset', () => {
		const model = makeModel({
			hulls: [makeHull({ junctions: [makeJunction(vec4(0, 0, 0, 0))] })],
		});
		expect(
			bulkTranslateTrafficEntities(
				model,
				[{ kind: 'junction', hullIdx: 0, junctionIdx: 0 }],
				{ x: 0, y: 0, z: 0 },
			),
		).toBe(model);
	});

	it('returns the original model on empty refs list', () => {
		const model = makeModel({});
		expect(bulkTranslateTrafficEntities(model, [], { x: 1, y: 0, z: 0 })).toBe(model);
	});
});

// ---------------------------------------------------------------------------
// Bulk yaw rotate — rigid-body composition (position orbit + .w increment)
// ---------------------------------------------------------------------------

describe('bulkRotateTrafficEntitiesYaw', () => {
	it('yaw-packed box: position orbits AND .w increments by theta (rigid composition)', () => {
		// Junction at (10, 0, 0) with initial yaw .w = 0.0. Rotate +π/2
		// around origin. Expected: position → (0, 0, 10), yaw → π/2.
		const model = makeModel({
			hulls: [makeHull({ junctions: [makeJunction(vec4(10, 0, 0, 0))] })],
		});
		const next = bulkRotateTrafficEntitiesYaw(
			model,
			[{ kind: 'junction', hullIdx: 0, junctionIdx: 0 }],
			{ x: 0, z: 0 },
			Math.PI / 2,
		);
		const p = next.hulls[0].junctions[0].mPosition;
		expect(p.x).toBeCloseTo(0, 5);
		expect(p.y).toBe(0);
		expect(p.z).toBeCloseTo(10, 5);
		// Critical: .w accumulates the gesture's yaw delta.
		expect(p.w).toBeCloseTo(Math.PI / 2, 6);
	});

	it('yaw-packed box: pre-existing .w sums with the gesture delta', () => {
		const initialYaw = 1.0;
		const delta = 0.25;
		const model = makeModel({
			hulls: [makeHull({ junctions: [makeJunction(vec4(0, 0, 5, initialYaw))] })],
		});
		const next = bulkRotateTrafficEntitiesYaw(
			model,
			[{ kind: 'junction', hullIdx: 0, junctionIdx: 0 }],
			{ x: 0, z: 0 },
			delta,
		);
		expect(next.hulls[0].junctions[0].mPosition.w).toBeCloseTo(initialYaw + delta, 6);
	});

	it('lane rung: both endpoints orbit the pivot AND rung remains a single segment', () => {
		// A rung from (10, 0) to (20, 0) — segment length 10. Rotate +π/2
		// around origin. Both endpoints should land in the +Z half-plane and
		// the segment length is preserved.
		const model = makeModel({
			hulls: [
				makeHull({
					rungs: [makeRung(vec4(10, 0, 0, 0.7), vec4(20, 0, 0, 0.8))],
				}),
			],
		});
		const next = bulkRotateTrafficEntitiesYaw(
			model,
			[{ kind: 'laneRung', hullIdx: 0, rungIdx: 0 }],
			{ x: 0, z: 0 },
			Math.PI / 2,
		);
		const rung = next.hulls[0].rungs[0];
		expect(rung.maPoints[0].x).toBeCloseTo(0, 5);
		expect(rung.maPoints[0].z).toBeCloseTo(10, 5);
		expect(rung.maPoints[1].x).toBeCloseTo(0, 5);
		expect(rung.maPoints[1].z).toBeCloseTo(20, 5);
		// .w on lane rung endpoints is opaque, preserved verbatim.
		expect(rung.maPoints[0].w).toBe(0.7);
		expect(rung.maPoints[1].w).toBe(0.8);
		// Segment length preserved.
		const segLen = Math.hypot(
			rung.maPoints[1].x - rung.maPoints[0].x,
			rung.maPoints[1].z - rung.maPoints[0].z,
		);
		expect(segLen).toBeCloseTo(10, 5);
	});

	it('preserves relative distances within the bulk after rotation', () => {
		// Two junctions — rotate as one rigid body around a midpoint pivot.
		const model = makeModel({
			hulls: [
				makeHull({
					junctions: [
						makeJunction(vec4(0, 0, 0, 0)),
						makeJunction(vec4(20, 0, 0, 0)),
					],
				}),
			],
		});
		const refs: TrafficDataEntityRef[] = [
			{ kind: 'junction', hullIdx: 0, junctionIdx: 0 },
			{ kind: 'junction', hullIdx: 0, junctionIdx: 1 },
		];
		const next = bulkRotateTrafficEntitiesYaw(model, refs, { x: 10, z: 0 }, Math.PI / 3);
		const a = next.hulls[0].junctions[0].mPosition;
		const b = next.hulls[0].junctions[1].mPosition;
		const dist = Math.hypot(b.x - a.x, b.z - a.z);
		expect(dist).toBeCloseTo(20, 4);
	});

	it('returns the original model on theta === 0', () => {
		const model = makeModel({});
		expect(bulkRotateTrafficEntitiesYaw(model, [], { x: 0, z: 0 }, 0)).toBe(model);
	});
});

// ---------------------------------------------------------------------------
// Pivot
// ---------------------------------------------------------------------------

describe('trafficDataSelectionPivot', () => {
	it('returns the median XYZ across a mixed Selection', () => {
		const model = makeModel({
			hulls: [
				makeHull({
					junctions: [makeJunction(vec4(0, 0, 0, 0))],
					rungs: [makeRung(vec4(10, 0, 0, 0), vec4(20, 0, 0, 0))],
				}),
			],
		});
		// Refs contribute: junction (0,0,0) + rung endpoints (10,0,0)+(20,0,0).
		// Median of x ∈ {0,10,20} = 10; median of z = 0.
		const pivot = trafficDataSelectionPivot(model, [
			{ kind: 'junction', hullIdx: 0, junctionIdx: 0 },
			{ kind: 'laneRung', hullIdx: 0, rungIdx: 0 },
		]);
		expect(pivot?.x).toBe(10);
		expect(pivot?.z).toBe(0);
	});

	it('returns null on an empty refs list', () => {
		expect(trafficDataSelectionPivot(makeModel({}), [])).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// Axes
// ---------------------------------------------------------------------------

describe('bulkTrafficDataAxes', () => {
	it('reports yaw-only for a yaw-packed Selection', () => {
		const axes = bulkTrafficDataAxes([
			{ kind: 'junction', hullIdx: 0, junctionIdx: 0 },
		]);
		expect(axes).toEqual(TRAFFIC_YAW_PACKED_AXES);
		expect(axes?.rotate.x).toBe(false);
		expect(axes?.rotate.y).toBe(true);
		expect(axes?.rotate.z).toBe(false);
	});

	it('reports yaw-only for a lane-rung Selection (rung is XZ-packed too)', () => {
		const axes = bulkTrafficDataAxes([
			{ kind: 'laneRung', hullIdx: 0, rungIdx: 0 },
		]);
		expect(axes?.rotate.x).toBe(false);
		expect(axes?.rotate.y).toBe(true);
		expect(axes?.rotate.z).toBe(false);
	});

	it('reports full 3-axis rotate for a pure static-vehicle Selection (issue #78)', () => {
		const axes = bulkTrafficDataAxes([
			{ kind: 'staticVehicle', hullIdx: 0, vehicleIdx: 0 },
		]);
		expect(axes?.rotate.x).toBe(true);
		expect(axes?.rotate.y).toBe(true);
		expect(axes?.rotate.z).toBe(true);
	});

	it('AND-intersects: static vehicle + yaw-packed sibling → yaw-only (ADR-0011)', () => {
		const axes = bulkTrafficDataAxes([
			{ kind: 'staticVehicle', hullIdx: 0, vehicleIdx: 0 },
			{ kind: 'junction', hullIdx: 0, junctionIdx: 0 },
		]);
		expect(axes?.rotate.x).toBe(false);
		expect(axes?.rotate.y).toBe(true);
		expect(axes?.rotate.z).toBe(false);
	});

	it('AND-intersects: static vehicle + lane rung → yaw-only', () => {
		const axes = bulkTrafficDataAxes([
			{ kind: 'staticVehicle', hullIdx: 0, vehicleIdx: 0 },
			{ kind: 'laneRung', hullIdx: 0, rungIdx: 0 },
		]);
		expect(axes?.rotate.x).toBe(false);
		expect(axes?.rotate.y).toBe(true);
		expect(axes?.rotate.z).toBe(false);
	});

	it('returns null for empty refs', () => {
		expect(bulkTrafficDataAxes([])).toBeNull();
	});

	it('per-ref helper: trafficDataRefAxes(staticVehicle) reports full 3D', () => {
		expect(trafficDataRefAxes({ kind: 'staticVehicle', hullIdx: 0, vehicleIdx: 0 })).toEqual(
			TRAFFIC_STATIC_VEHICLE_AXES,
		);
	});

	it('per-ref helper: trafficDataRefAxes(junction) reports yaw-only', () => {
		expect(trafficDataRefAxes({ kind: 'junction', hullIdx: 0, junctionIdx: 0 })).toEqual(
			TRAFFIC_YAW_PACKED_AXES,
		);
	});

	it('cross-resource: static vehicle + simulated trigger-box (FULL_3D) → all 3 axes (issue #77 + #78)', () => {
		// Trigger boxes are full-3D; mixing them with a static vehicle should
		// keep the rotate rings interactive on all three axes.
		const svAxes = bulkTrafficDataAxes([
			{ kind: 'staticVehicle', hullIdx: 0, vehicleIdx: 0 },
		])!;
		const triggerAxes = { translate: { x: true, y: true, z: true }, rotate: { x: true, y: true, z: true } };
		const intersected = intersectTransformAxes([svAxes, triggerAxes]);
		expect(intersected.rotate.x).toBe(true);
		expect(intersected.rotate.y).toBe(true);
		expect(intersected.rotate.z).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Static vehicle — single + bulk + cross-validation (issue #78)
// ---------------------------------------------------------------------------

describe('bulkTranslateTrafficEntities — static vehicles', () => {
	it('shifts the translation column of every selected vehicle by the same delta', () => {
		const a = makeStaticVehicle({ x: 0, y: 0, z: 0 });
		const b = makeStaticVehicle({ x: 10, y: 0, z: 0 });
		const model = makeModel({ hulls: [makeHull({ staticVehicles: [a, b] })] });
		const next = bulkTranslateTrafficEntities(
			model,
			[
				{ kind: 'staticVehicle', hullIdx: 0, vehicleIdx: 0 },
				{ kind: 'staticVehicle', hullIdx: 0, vehicleIdx: 1 },
			],
			{ x: 1, y: 2, z: 3 },
		);
		const v0 = next.hulls[0].staticTrafficVehicles[0];
		const v1 = next.hulls[0].staticTrafficVehicles[1];
		expect(v0.mTransform[12]).toBe(1);
		expect(v0.mTransform[13]).toBe(2);
		expect(v0.mTransform[14]).toBe(3);
		expect(v1.mTransform[12]).toBe(11);
		expect(v1.mTransform[13]).toBe(2);
		expect(v1.mTransform[14]).toBe(3);
	});

	it('mixed Selection (static vehicle + junction): every entity moves by the delta', () => {
		const sv = makeStaticVehicle({ x: 5, y: 5, z: 5 });
		const model = makeModel({
			hulls: [
				makeHull({
					junctions: [makeJunction(vec4(0, 0, 0, 1.0))],
					staticVehicles: [sv],
				}),
			],
		});
		const next = bulkTranslateTrafficEntities(
			model,
			[
				{ kind: 'junction', hullIdx: 0, junctionIdx: 0 },
				{ kind: 'staticVehicle', hullIdx: 0, vehicleIdx: 0 },
			],
			{ x: 2, y: 0, z: -1 },
		);
		expect(next.hulls[0].junctions[0].mPosition).toEqual({ x: 2, y: 0, z: -1, w: 1.0 });
		const svNext = next.hulls[0].staticTrafficVehicles[0];
		expect(svNext.mTransform[12]).toBe(7);
		expect(svNext.mTransform[13]).toBe(5);
		expect(svNext.mTransform[14]).toBe(4);
	});

	it('returns the original model on identity offset', () => {
		const sv = makeStaticVehicle({ x: 0, y: 0, z: 0 });
		const model = makeModel({ hulls: [makeHull({ staticVehicles: [sv] })] });
		expect(
			bulkTranslateTrafficEntities(
				model,
				[{ kind: 'staticVehicle', hullIdx: 0, vehicleIdx: 0 }],
				{ x: 0, y: 0, z: 0 },
			),
		).toBe(model);
	});
});

describe('bulkRotateTrafficEntitiesMatrix44 — static vehicles', () => {
	it('rotates a single vehicle around its own position: position unchanged, facing rotates by delta', () => {
		const pos = { x: 7, y: 0, z: -5 };
		const v = makeStaticVehicle(pos);
		const model = makeModel({ hulls: [makeHull({ staticVehicles: [v] })] });
		const next = bulkRotateTrafficEntitiesMatrix44(
			model,
			[{ kind: 'staticVehicle', hullIdx: 0, vehicleIdx: 0 }],
			pos,
			{ x: 0, y: Math.PI / 2, z: 0 },
		);
		const m = next.hulls[0].staticTrafficVehicles[0].mTransform;
		expect(m[12]).toBeCloseTo(pos.x, 5);
		expect(m[13]).toBeCloseTo(pos.y, 5);
		expect(m[14]).toBeCloseTo(pos.z, 5);
	});

	it('rotates two vehicles around a common pivot: pairwise distance preserved', () => {
		const a = makeStaticVehicle({ x: 0, y: 0, z: 0 });
		const b = makeStaticVehicle({ x: 20, y: 0, z: 0 });
		const model = makeModel({ hulls: [makeHull({ staticVehicles: [a, b] })] });
		const next = bulkRotateTrafficEntitiesMatrix44(
			model,
			[
				{ kind: 'staticVehicle', hullIdx: 0, vehicleIdx: 0 },
				{ kind: 'staticVehicle', hullIdx: 0, vehicleIdx: 1 },
			],
			{ x: 10, y: 0, z: 0 },
			{ x: 0, y: Math.PI / 3, z: 0 },
		);
		const ta = next.hulls[0].staticTrafficVehicles[0].mTransform;
		const tb = next.hulls[0].staticTrafficVehicles[1].mTransform;
		const dist = Math.hypot(tb[12] - ta[12], tb[13] - ta[13], tb[14] - ta[14]);
		expect(dist).toBeCloseTo(20, 4);
	});

	it('returns the original model on identity rotation', () => {
		const sv = makeStaticVehicle({ x: 0, y: 0, z: 0 });
		const model = makeModel({ hulls: [makeHull({ staticVehicles: [sv] })] });
		expect(
			bulkRotateTrafficEntitiesMatrix44(
				model,
				[{ kind: 'staticVehicle', hullIdx: 0, vehicleIdx: 0 }],
				{ x: 0, y: 0, z: 0 },
				{ x: 0, y: 0, z: 0 },
			),
		).toBe(model);
	});

	it('no-op rotate returns the SAME mTransform reference (byte-for-byte writeback)', () => {
		// Critical invariant: byte-for-byte BND2 writeback survives a
		// no-op rotate gesture. The reference equality on `mTransform`
		// (not just deep-equality) is what guarantees the writer emits
		// identical bytes — and per the contract, `===` survives because
		// the op short-circuits on identity delta.
		const sv = makeStaticVehicle({ x: 12, y: 3, z: -4 }, { x: 0.1, y: 0.2, z: 0 });
		const model = makeModel({ hulls: [makeHull({ staticVehicles: [sv] })] });
		const next = bulkRotateTrafficEntitiesMatrix44(
			model,
			[{ kind: 'staticVehicle', hullIdx: 0, vehicleIdx: 0 }],
			{ x: 0, y: 0, z: 0 },
			{ x: 0, y: 0, z: 0 },
		);
		expect(next.hulls[0].staticTrafficVehicles[0].mTransform).toBe(sv.mTransform);
	});
});

describe('bulkRotateTrafficEntitiesYaw — static vehicles take the same yaw delta', () => {
	it('static vehicle position orbits the pivot AND its mTransform rotation portion picks up the yaw delta', () => {
		const sv = makeStaticVehicle({ x: 10, y: 0, z: 0 });
		const model = makeModel({ hulls: [makeHull({ staticVehicles: [sv] })] });
		const next = bulkRotateTrafficEntitiesYaw(
			model,
			[{ kind: 'staticVehicle', hullIdx: 0, vehicleIdx: 0 }],
			{ x: 0, z: 0 },
			Math.PI / 2,
		);
		const m = next.hulls[0].staticTrafficVehicles[0].mTransform;
		// Position orbits to (0, 0, -10) — three.js right-hand convention,
		// same as the trigger-box adapter (issue #77).
		expect(m[12]).toBeCloseTo(0, 5);
		expect(m[14]).toBeCloseTo(-10, 5);
	});

	it('static vehicle yaw rotate is identical to the Matrix44 path with delta.y only', () => {
		const sv = makeStaticVehicle({ x: 25, y: 5, z: -10 }, { x: 0, y: 0.4, z: 0 });
		const model1 = makeModel({ hulls: [makeHull({ staticVehicles: [sv] })] });
		const model2 = makeModel({ hulls: [makeHull({ staticVehicles: [sv] })] });
		const a = bulkRotateTrafficEntitiesYaw(
			model1,
			[{ kind: 'staticVehicle', hullIdx: 0, vehicleIdx: 0 }],
			{ x: 5, z: -5 },
			Math.PI / 6,
		);
		const b = bulkRotateTrafficEntitiesMatrix44(
			model2,
			[{ kind: 'staticVehicle', hullIdx: 0, vehicleIdx: 0 }],
			{ x: 5, y: 0, z: -5 },
			{ x: 0, y: Math.PI / 6, z: 0 },
		);
		const ma = a.hulls[0].staticTrafficVehicles[0].mTransform;
		const mb = b.hulls[0].staticTrafficVehicles[0].mTransform;
		for (let i = 0; i < 16; i++) {
			expect(ma[i]).toBeCloseTo(mb[i], 5);
		}
	});
});

describe('trafficDataSelectionPivot — static vehicles contribute their translation column', () => {
	it('median of three vehicles at x = {0, 10, 20} is x = 10', () => {
		const model = makeModel({
			hulls: [
				makeHull({
					staticVehicles: [
						makeStaticVehicle({ x: 0, y: 0, z: 0 }),
						makeStaticVehicle({ x: 10, y: 0, z: 0 }),
						makeStaticVehicle({ x: 20, y: 0, z: 0 }),
					],
				}),
			],
		});
		const pivot = trafficDataSelectionPivot(model, [
			{ kind: 'staticVehicle', hullIdx: 0, vehicleIdx: 0 },
			{ kind: 'staticVehicle', hullIdx: 0, vehicleIdx: 1 },
			{ kind: 'staticVehicle', hullIdx: 0, vehicleIdx: 2 },
		]);
		expect(pivot?.x).toBe(10);
		expect(pivot?.y).toBe(0);
		expect(pivot?.z).toBe(0);
	});

	it('mixed: static vehicle + junction contributes both', () => {
		const model = makeModel({
			hulls: [
				makeHull({
					junctions: [makeJunction(vec4(0, 0, 0, 0))],
					staticVehicles: [makeStaticVehicle({ x: 10, y: 5, z: 20 })],
				}),
			],
		});
		const pivot = trafficDataSelectionPivot(model, [
			{ kind: 'junction', hullIdx: 0, junctionIdx: 0 },
			{ kind: 'staticVehicle', hullIdx: 0, vehicleIdx: 0 },
		]);
		// Two samples: medians = the per-axis mean of the two values.
		expect(pivot?.x).toBeCloseTo(5, 6);
		expect(pivot?.y).toBeCloseTo(2.5, 6);
		expect(pivot?.z).toBeCloseTo(10, 6);
	});
});
