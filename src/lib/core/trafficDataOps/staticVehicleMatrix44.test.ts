// Static-traffic-vehicle Matrix44 rigid ops — unit tests (issue #78).
//
// Covers the single-entity translate/rotate path, the `===`-identity
// no-op contract that keeps BND2 byte-for-byte writeback alive, and the
// cross-validation against the Vector3+Euler representation that ships
// with `triggerDataOps` — the only sanity check on the sandwich-multiply
// order (a wrong T(P)/R/T(-P) ordering produces visibly correct math on
// isolated cases but fails the cross-validation as soon as the pivot ≠
// the entity's own position).

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import type {
	ParsedTrafficDataRetail,
	TrafficHull,
	TrafficStaticVehicle,
} from '../trafficData';
import {
	rotateStaticVehicleMatrix44,
	rotateStaticVehicleRigid,
	STATIC_VEHICLE_DELTA_EULER_ORDER,
	translateStaticVehicleMatrix44,
	translateStaticVehicleRigid,
	_internalForTests,
} from './staticVehicleMatrix44';

// =============================================================================
// Fixtures
// =============================================================================

/**
 * Build a `TrafficStaticVehicle` from a position + Euler rotation. The
 * matrix is composed via `THREE.Matrix4.compose` so the storage layout
 * matches what `readMatrix` consumes (column-major translation at indices
 * [12], [13], [14]). Pad slots [3], [7], [11], [15] are forced to zero
 * to mirror the on-disk Matrix44Affine convention.
 */
function makeStaticVehicle(
	pos: { x: number; y: number; z: number },
	euler: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 },
): TrafficStaticVehicle {
	const mat = new THREE.Matrix4().compose(
		new THREE.Vector3(pos.x, pos.y, pos.z),
		new THREE.Quaternion().setFromEuler(
			new THREE.Euler(euler.x, euler.y, euler.z, STATIC_VEHICLE_DELTA_EULER_ORDER),
		),
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

function makeHull(vehicles: TrafficStaticVehicle[]): TrafficHull {
	return {
		muNumSections: 0,
		muNumSectionSpans: 0,
		muNumJunctions: 0,
		muNumStoplines: 0,
		muNumNeighbours: 0,
		muNumStaticTraffic: vehicles.length,
		muNumVehicleAssets: 0,
		_pad07: 0,
		muNumRungs: 0,
		muFirstTrafficLight: 0,
		muLastTrafficLight: 0,
		muNumLightTriggers: 0,
		muNumLightTriggersStartData: 0,
		sections: [],
		rungs: [],
		cumulativeRungLengths: [],
		neighbours: [],
		sectionSpans: [],
		staticTrafficVehicles: vehicles,
		sectionFlows: [],
		junctions: [],
		stopLines: [],
		lightTriggers: [],
		lightTriggerStartData: [],
		lightTriggerJunctionLookup: [],
		mauVehicleAssets: [],
	};
}

function makeModel(hulls: TrafficHull[]): ParsedTrafficDataRetail {
	return {
		kind: 'v45',
		muDataVersion: 45,
		muSizeInBytes: 0,
		pvs: {
			mGridMin: { x: 0, y: 0, z: 0, w: 0 },
			mCellSize: { x: 1, y: 1, z: 1, w: 0 },
			mRecipCellSize: { x: 1, y: 1, z: 1, w: 0 },
			muNumCells_X: 0,
			muNumCells_Z: 0,
			muNumCells: 0,
			hullPvsSets: [],
		},
		hulls,
		flowTypes: [],
		killZoneIds: [],
		killZones: [],
		vehicleTypes: [],
		vehicleTypesUpdate: [],
		vehicleAssets: [],
		vehicleTraits: [],
		killZoneRegions: [],
		trafficLights: {
			posAndYRotations: [],
			instanceIDs: [],
			instanceTypes: [],
			trafficLightTypes: [],
			coronaTypes: [],
			coronaPositions: [],
			mauInstanceHashOffsets: [],
			instanceHashTable: [],
			instanceHashToIndexLookup: [],
		},
		paintColours: [],
	};
}

/**
 * Read the translation column out of a `mTransform`.
 */
function translationOf(v: TrafficStaticVehicle) {
	return {
		x: v.mTransform[12],
		y: v.mTransform[13],
		z: v.mTransform[14],
	};
}

/**
 * Read the upper-left 3×3 rotation portion of a `mTransform` and return
 * the world-space `+X` direction it maps a local `(1, 0, 0)` to. That
 * vector IS the vehicle's "facing direction" in the editor's Y-up frame
 * — what the cross-validation test pins against the Vector3+Euler path.
 */
function facingOf(v: TrafficStaticVehicle): { x: number; y: number; z: number } {
	const m = new THREE.Matrix4().fromArray(v.mTransform);
	// Force the homogeneous w to 1 so the rotation portion is read clean
	// (same patch the renderer applies — pad slots in the storage layout
	// are zero, not the homogeneous 1).
	const e = m.elements;
	e[3] = 0; e[7] = 0; e[11] = 0; e[15] = 1;
	const dir = new THREE.Vector3(1, 0, 0).transformDirection(m);
	return { x: dir.x, y: dir.y, z: dir.z };
}

// =============================================================================
// translateStaticVehicleMatrix44
// =============================================================================

describe('translateStaticVehicleMatrix44', () => {
	it('updates the translation column and preserves the rotation portion', () => {
		const v = makeStaticVehicle(
			{ x: 10, y: 20, z: 30 },
			{ x: 0.1, y: 0.5, z: 0.0 },
		);
		const before = v.mTransform.slice(0, 12); // rotation/scale portion
		const next = translateStaticVehicleMatrix44(v, { x: 1, y: 2, z: 3 });
		expect(translationOf(next)).toEqual({ x: 11, y: 22, z: 33 });
		// Rotation portion (cols 0..2, slots [0..11]) untouched.
		for (let i = 0; i < 12; i++) {
			expect(next.mTransform[i]).toBe(before[i]);
		}
	});

	it('returns the input vehicle reference (===) on identity offset', () => {
		const v = makeStaticVehicle({ x: 0, y: 0, z: 0 });
		expect(translateStaticVehicleMatrix44(v, { x: 0, y: 0, z: 0 })).toBe(v);
	});

	it('preserves the on-disk pad layout (zero at indices 3, 7, 11, 15)', () => {
		const v = makeStaticVehicle({ x: 5, y: 0, z: 0 });
		const next = translateStaticVehicleMatrix44(v, { x: 1, y: 1, z: 1 });
		expect(next.mTransform[3]).toBe(0);
		expect(next.mTransform[7]).toBe(0);
		expect(next.mTransform[11]).toBe(0);
		expect(next.mTransform[15]).toBe(0);
	});
});

// =============================================================================
// rotateStaticVehicleMatrix44
// =============================================================================

describe('rotateStaticVehicleMatrix44', () => {
	it('rotation around the vehicle\'s own position leaves the translation column unchanged', () => {
		const pos = { x: 7, y: 3, z: -5 };
		const v = makeStaticVehicle(pos);
		const next = rotateStaticVehicleMatrix44(v, pos, { x: 0, y: Math.PI / 4, z: 0 });
		const t = translationOf(next);
		expect(t.x).toBeCloseTo(pos.x, 6);
		expect(t.y).toBeCloseTo(pos.y, 6);
		expect(t.z).toBeCloseTo(pos.z, 6);
	});

	it('yaw-rotates the facing direction by exactly the delta', () => {
		// Vehicle at origin, identity facing (+X). After Ry(π/2) under
		// three.js's right-hand convention, facing should map to -Z (the
		// trigger-box adapter uses this same convention — see
		// `triggerDataOps/translateRigid.test.ts` for the matching
		// expectation: applyQuaternion of (1,0,0) by yaw(pi/2) → (0,0,-1)).
		const v = makeStaticVehicle({ x: 0, y: 0, z: 0 });
		const next = rotateStaticVehicleMatrix44(
			v,
			{ x: 0, y: 0, z: 0 },
			{ x: 0, y: Math.PI / 2, z: 0 },
		);
		const facing = facingOf(next);
		expect(facing.x).toBeCloseTo(0, 5);
		expect(facing.y).toBeCloseTo(0, 5);
		expect(facing.z).toBeCloseTo(-1, 5);
	});

	it('rotation around an external pivot orbits the translation column', () => {
		// Vehicle at (10, 0, 0), pivot at origin, yaw π/2 under three.js's
		// right-hand convention: position lands at (0, 0, -10) (positive
		// yaw rotates +X towards -Z).
		const v = makeStaticVehicle({ x: 10, y: 0, z: 0 });
		const next = rotateStaticVehicleMatrix44(
			v,
			{ x: 0, y: 0, z: 0 },
			{ x: 0, y: Math.PI / 2, z: 0 },
		);
		const t = translationOf(next);
		expect(t.x).toBeCloseTo(0, 5);
		expect(t.y).toBeCloseTo(0, 5);
		expect(t.z).toBeCloseTo(-10, 5);
	});

	it('rotation around an external pivot composes the rotation portion (facing rotates by delta)', () => {
		// Vehicle at (10, 0, 0) with identity facing (+X). Yaw π/2 around
		// origin under three.js's right-hand convention: position → (0, 0,
		// -10), facing → (0, 0, -1). Vehicle orbits AND its own forward
		// vector rotates by the same delta.
		const v = makeStaticVehicle({ x: 10, y: 0, z: 0 });
		const next = rotateStaticVehicleMatrix44(
			v,
			{ x: 0, y: 0, z: 0 },
			{ x: 0, y: Math.PI / 2, z: 0 },
		);
		const facing = facingOf(next);
		expect(facing.x).toBeCloseTo(0, 5);
		expect(facing.z).toBeCloseTo(-1, 5);
	});

	it('returns the input vehicle reference (===) on identity rotate', () => {
		const v = makeStaticVehicle({ x: 5, y: 5, z: 5 });
		expect(
			rotateStaticVehicleMatrix44(v, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }),
		).toBe(v);
	});

	it('no-op rotate produces a byte-identical mTransform on a fresh-built vehicle', () => {
		// Composed via THREE.Matrix4.compose so the storage layout is
		// already canonical; a no-op rotate returns ===-identity (asserted
		// above), so the mTransform array is the SAME reference.
		const v = makeStaticVehicle(
			{ x: 1.5, y: 2.5, z: 3.5 },
			{ x: 0.1, y: 0.2, z: 0.3 },
		);
		const next = rotateStaticVehicleMatrix44(
			v,
			{ x: 0, y: 0, z: 0 },
			{ x: 0, y: 0, z: 0 },
		);
		expect(next.mTransform).toBe(v.mTransform);
	});

	it('preserves pairwise distances across a synthetic two-vehicle bulk rotate', () => {
		// Two vehicles at (0,0,0) and (20,0,0). Rotate each around the
		// midpoint pivot (10,0,0) by yaw π/3. Their separation must stay
		// at 20 (rigid-body invariant).
		const pivot = { x: 10, y: 0, z: 0 };
		const a = makeStaticVehicle({ x: 0, y: 0, z: 0 });
		const b = makeStaticVehicle({ x: 20, y: 0, z: 0 });
		const a2 = rotateStaticVehicleMatrix44(a, pivot, { x: 0, y: Math.PI / 3, z: 0 });
		const b2 = rotateStaticVehicleMatrix44(b, pivot, { x: 0, y: Math.PI / 3, z: 0 });
		const ta = translationOf(a2);
		const tb = translationOf(b2);
		const dist = Math.hypot(tb.x - ta.x, tb.y - ta.y, tb.z - ta.z);
		expect(dist).toBeCloseTo(20, 4);
	});
});

// =============================================================================
// Cross-validation against Vector3 + Euler representation
// =============================================================================
//
// The most load-bearing test in this file. The Matrix44 rotate-around-
// pivot rule is `M' = T(P) · R(delta) · T(-P) · M`. The Vector3+Euler
// rule from `triggerDataOps` is:
//
//   newPos   = (oldPos - pivot).applyQuaternion(deltaQuat) + pivot
//   newQuat  = deltaQuat · oldQuat
//
// Both representations describe the SAME rigid transform — for a vehicle
// authored as `(pos, eulerXYZ)`, transforming it through either path
// should produce identical world position AND facing direction. Wrong
// sandwich-multiply order (e.g. `T(-P) · R · T(P) · M` or `M · T(-P) · R
// · T(P)`) breaks this — the two paths drift apart as soon as `pivot ≠
// pos`, which is exactly the bulk-rotate case.

describe('Matrix44 path equals Vector3+Euler path (cross-validation)', () => {
	// A "facing direction" is the world-space image of the local +X unit
	// vector under the rotation portion. We compare both paths' resulting
	// facing directions and translation columns.

	function rotateViaEuler(
		pos: { x: number; y: number; z: number },
		euler: { x: number; y: number; z: number },
		pivot: { x: number; y: number; z: number },
		delta: { x: number; y: number; z: number },
	): {
		pos: { x: number; y: number; z: number };
		facing: { x: number; y: number; z: number };
	} {
		const deltaQuat = new THREE.Quaternion().setFromEuler(
			new THREE.Euler(delta.x, delta.y, delta.z, STATIC_VEHICLE_DELTA_EULER_ORDER),
		);
		const ownQuat = new THREE.Quaternion().setFromEuler(
			new THREE.Euler(euler.x, euler.y, euler.z, STATIC_VEHICLE_DELTA_EULER_ORDER),
		);
		const pivotVec = new THREE.Vector3(pivot.x, pivot.y, pivot.z);
		const newPos = new THREE.Vector3(pos.x, pos.y, pos.z)
			.sub(pivotVec)
			.applyQuaternion(deltaQuat)
			.add(pivotVec);
		const newQuat = deltaQuat.clone().multiply(ownQuat);
		const facing = new THREE.Vector3(1, 0, 0).applyQuaternion(newQuat);
		return {
			pos: { x: newPos.x, y: newPos.y, z: newPos.z },
			facing: { x: facing.x, y: facing.y, z: facing.z },
		};
	}

	const cases: Array<{
		name: string;
		pos: { x: number; y: number; z: number };
		euler: { x: number; y: number; z: number };
		pivot: { x: number; y: number; z: number };
		delta: { x: number; y: number; z: number };
	}> = [
		{
			name: 'identity rotation does nothing',
			pos: { x: 7, y: 11, z: 13 },
			euler: { x: 0.1, y: 0.2, z: 0.3 },
			pivot: { x: 0, y: 0, z: 0 },
			delta: { x: 0, y: 0, z: 0 },
		},
		{
			name: 'yaw π/2 around origin, identity-facing vehicle at (10, 0, 0)',
			pos: { x: 10, y: 0, z: 0 },
			euler: { x: 0, y: 0, z: 0 },
			pivot: { x: 0, y: 0, z: 0 },
			delta: { x: 0, y: Math.PI / 2, z: 0 },
		},
		{
			name: 'yaw π/3 around external pivot, pre-rotated vehicle',
			pos: { x: 25, y: 5, z: -10 },
			euler: { x: 0, y: 0.5, z: 0 },
			pivot: { x: 5, y: 0, z: 0 },
			delta: { x: 0, y: Math.PI / 3, z: 0 },
		},
		{
			name: 'pitch + yaw mix around external 3D pivot',
			pos: { x: 12, y: 8, z: -4 },
			euler: { x: 0.2, y: 0.6, z: -0.1 },
			pivot: { x: 3, y: 2, z: 1 },
			delta: { x: 0.4, y: -0.3, z: 0.0 },
		},
		{
			name: 'full 3-axis delta around the vehicle\'s own position (pure spin)',
			pos: { x: -8, y: 4, z: 16 },
			euler: { x: 0.0, y: 0.0, z: 0.0 },
			pivot: { x: -8, y: 4, z: 16 },
			delta: { x: 0.2, y: 0.4, z: 0.6 },
		},
		{
			name: 'full 3-axis delta around a far external pivot',
			pos: { x: 100, y: 0, z: 0 },
			euler: { x: 0.1, y: 0.2, z: 0.3 },
			pivot: { x: 0, y: 0, z: 0 },
			delta: { x: 0.3, y: 0.7, z: -0.4 },
		},
	];

	for (const c of cases) {
		it(c.name, () => {
			const v = makeStaticVehicle(c.pos, c.euler);
			const m44 = rotateStaticVehicleMatrix44(v, c.pivot, c.delta);
			const m44Pos = translationOf(m44);
			const m44Facing = facingOf(m44);
			const euler = rotateViaEuler(c.pos, c.euler, c.pivot, c.delta);
			expect(m44Pos.x).toBeCloseTo(euler.pos.x, 4);
			expect(m44Pos.y).toBeCloseTo(euler.pos.y, 4);
			expect(m44Pos.z).toBeCloseTo(euler.pos.z, 4);
			expect(m44Facing.x).toBeCloseTo(euler.facing.x, 4);
			expect(m44Facing.y).toBeCloseTo(euler.facing.y, 4);
			expect(m44Facing.z).toBeCloseTo(euler.facing.z, 4);
		});
	}
});

// =============================================================================
// ParsedTrafficDataRetail-scope wrappers
// =============================================================================

describe('translateStaticVehicleRigid (model-scope)', () => {
	it('updates the addressed vehicle and preserves sibling references', () => {
		const a = makeStaticVehicle({ x: 0, y: 0, z: 0 });
		const b = makeStaticVehicle({ x: 5, y: 5, z: 5 });
		const model = makeModel([makeHull([a, b])]);
		const next = translateStaticVehicleRigid(model, 0, 0, { x: 1, y: 2, z: 3 });
		expect(translationOf(next.hulls[0].staticTrafficVehicles[0])).toEqual({
			x: 1, y: 2, z: 3,
		});
		// Sibling (===) untouched.
		expect(next.hulls[0].staticTrafficVehicles[1]).toBe(b);
	});

	it('returns the input model (===) on identity offset', () => {
		const v = makeStaticVehicle({ x: 0, y: 0, z: 0 });
		const model = makeModel([makeHull([v])]);
		expect(translateStaticVehicleRigid(model, 0, 0, { x: 0, y: 0, z: 0 })).toBe(model);
	});

	it('throws RangeError on out-of-range hull index', () => {
		const model = makeModel([makeHull([makeStaticVehicle({ x: 0, y: 0, z: 0 })])]);
		expect(() => translateStaticVehicleRigid(model, 99, 0, { x: 1, y: 0, z: 0 }))
			.toThrow(RangeError);
	});

	it('throws RangeError on out-of-range vehicle index', () => {
		const model = makeModel([makeHull([makeStaticVehicle({ x: 0, y: 0, z: 0 })])]);
		expect(() => translateStaticVehicleRigid(model, 0, 99, { x: 1, y: 0, z: 0 }))
			.toThrow(RangeError);
	});
});

describe('rotateStaticVehicleRigid (model-scope)', () => {
	it('returns the input model (===) on identity rotation', () => {
		const v = makeStaticVehicle({ x: 0, y: 0, z: 0 });
		const model = makeModel([makeHull([v])]);
		expect(
			rotateStaticVehicleRigid(model, 0, 0, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }),
		).toBe(model);
	});

	it('addresses the right vehicle and leaves siblings untouched', () => {
		const a = makeStaticVehicle({ x: 5, y: 0, z: 0 });
		const b = makeStaticVehicle({ x: 0, y: 0, z: 5 });
		const model = makeModel([makeHull([a, b])]);
		const next = rotateStaticVehicleRigid(
			model,
			0,
			1,
			{ x: 0, y: 0, z: 0 },
			{ x: 0, y: Math.PI / 2, z: 0 },
		);
		expect(next.hulls[0].staticTrafficVehicles[0]).toBe(a);
		const t = translationOf(next.hulls[0].staticTrafficVehicles[1]);
		expect(t.x).toBeCloseTo(5, 5);
		expect(t.z).toBeCloseTo(0, 5);
	});
});

// =============================================================================
// Internal helpers (exposed for the writeback contract)
// =============================================================================

describe('_internalForTests.writeMatrix', () => {
	it('emits 16 elements with the pad slots [3], [7], [11], [15] forced to zero', () => {
		const mat = new THREE.Matrix4().identity();
		const arr = _internalForTests.writeMatrix(mat);
		expect(arr.length).toBe(16);
		expect(arr[3]).toBe(0);
		expect(arr[7]).toBe(0);
		expect(arr[11]).toBe(0);
		expect(arr[15]).toBe(0);
	});
});
