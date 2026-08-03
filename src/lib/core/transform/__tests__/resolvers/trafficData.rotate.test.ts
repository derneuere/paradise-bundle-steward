// The traffic-data resolver's rotation half: how a gesture's `spin` lands in
// each of the resource's two orientation representations, and the pin that
// they can no longer disagree.
//
// Traffic data is the only resource that carries both representations in one
// gesture, and until the shared transform landed they counter-rotated: the
// yaw-packed `.w` boxes swung +X toward +Z while the Matrix44 vehicles swung
// +X toward -Z, so a mixed Selection visibly tore itself apart. Both now go
// through `rotatePointAboutPivot` for position and the same `spin` for
// orientation, and the true right-hand rule (+X -> -Z for a +Y rotation,
// matching `THREE.Matrix4.makeRotationFromEuler`) is the convention.

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';

import {
	trafficDataResolver as R,
	type TrafficDataRef,
} from '../../resolvers/trafficData';
import { transform } from '../../transform';
import { delta } from '../_helpers';
import {
	facingOf,
	makeHull,
	makeJunction,
	makeLights,
	makeModel,
	makeRung,
	makeStaticVehicle,
	translationOf,
	vec4,
	yawOf,
} from './_trafficFixtures';

const JUNCTION_0: TrafficDataRef = { kind: 'junction', hullIdx: 0, junctionIdx: 0 };
const RUNG_0: TrafficDataRef = { kind: 'laneRung', hullIdx: 0, rungIdx: 0 };
const VEHICLE_0: TrafficDataRef = { kind: 'staticVehicle', hullIdx: 0, vehicleIdx: 0 };
const ORIGIN = { x: 0, y: 0, z: 0 };

describe('yaw-packed Vec4 — .w carries the entity\'s heading', () => {
	it('orbits the position AND adds the gesture yaw to .w', () => {
		// Junction at (10, 0, 0), heading 0. +PI/2 about +Y under the true
		// right-hand rule sends +X toward -Z, so it lands at (0, 0, -10) and
		// ends up facing PI/2 — rigid body, not a point on a string.
		const model = makeModel({
			hulls: [makeHull({ junctions: [makeJunction(vec4(10, 0, 0, 0))] })],
		});
		const next = transform(
			model,
			[JUNCTION_0],
			delta({ rotate: { x: 0, y: Math.PI / 2, z: 0 }, pivot: ORIGIN }),
			R,
		);
		const p = next.hulls[0].junctions[0].mPosition;
		expect(p.x).toBeCloseTo(0, 10);
		expect(p.y).toBe(0);
		expect(p.z).toBeCloseTo(-10, 10);
		expect(p.w).toBeCloseTo(Math.PI / 2, 10);
	});

	it('sums the gesture yaw onto a pre-existing heading', () => {
		const model = makeModel({
			hulls: [makeHull({ junctions: [makeJunction(vec4(0, 0, 5, 1))] })],
		});
		const next = transform(
			model,
			[JUNCTION_0],
			delta({ rotate: { x: 0, y: 0.25, z: 0 }, pivot: ORIGIN }),
			R,
		);
		expect(next.hulls[0].junctions[0].mPosition.w).toBeCloseTo(1.25, 10);
	});

	it('adds the yaw to traffic-light instances and coronas too', () => {
		const model = makeModel({
			lights: makeLights({
				posAndYRotations: [vec4(10, 0, 0, 0.5)],
				coronaPositions: [vec4(10, 0, 0, 0.5)],
			}),
		});
		const next = transform(
			model,
			[{ kind: 'lightInstance', instanceIdx: 0 }, { kind: 'corona', coronaIdx: 0 }],
			delta({ rotate: { x: 0, y: 0.5, z: 0 }, pivot: ORIGIN }),
			R,
		);
		expect(next.trafficLights.posAndYRotations[0].w).toBeCloseTo(1, 10);
		expect(next.trafficLights.coronaPositions[0].w).toBeCloseTo(1, 10);
	});
});

describe('lane rung — two endpoints, opaque .w', () => {
	it('orbits both endpoints, echoes .w verbatim, keeps the segment length', () => {
		// A rung's `.w` is NOT a heading — it is an opaque authored slot, so a
		// rotate must leave it exactly as found even though the sibling
		// representations increment theirs.
		const model = makeModel({
			hulls: [makeHull({ rungs: [makeRung(vec4(10, 0, 0, 0.7), vec4(20, 0, 0, 0.8))] })],
		});
		const next = transform(
			model,
			[RUNG_0],
			delta({ rotate: { x: 0, y: Math.PI / 2, z: 0 }, pivot: ORIGIN }),
			R,
		);
		const pts = next.hulls[0].rungs[0].maPoints;
		expect(pts[0].x).toBeCloseTo(0, 10);
		expect(pts[0].z).toBeCloseTo(-10, 10);
		expect(pts[1].x).toBeCloseTo(0, 10);
		expect(pts[1].z).toBeCloseTo(-20, 10);
		expect(pts[0].w).toBe(0.7);
		expect(pts[1].w).toBe(0.8);
		expect(Math.hypot(pts[1].x - pts[0].x, pts[1].z - pts[0].z)).toBeCloseTo(10, 10);
	});
});

describe('static vehicle — Matrix44 basis', () => {
	it('leaves the translation column put when the pivot is the vehicle itself', () => {
		const pos = { x: 7, y: 3, z: -5 };
		const model = makeModel({ hulls: [makeHull({ staticVehicles: [makeStaticVehicle(pos)] })] });
		const next = transform(
			model,
			[VEHICLE_0],
			delta({ rotate: { x: 0, y: Math.PI / 4, z: 0 }, pivot: pos }),
			R,
		);
		const t = translationOf(next.hulls[0].staticTrafficVehicles[0]);
		expect(t.x).toBeCloseTo(pos.x, 10);
		expect(t.y).toBeCloseTo(pos.y, 10);
		expect(t.z).toBeCloseTo(pos.z, 10);
	});

	it('turns the car\'s facing by exactly the delta while it orbits', () => {
		const model = makeModel({
			hulls: [makeHull({ staticVehicles: [makeStaticVehicle({ x: 10, y: 0, z: 0 })] })],
		});
		const next = transform(
			model,
			[VEHICLE_0],
			delta({ rotate: { x: 0, y: Math.PI / 2, z: 0 }, pivot: ORIGIN }),
			R,
		);
		const moved = next.hulls[0].staticTrafficVehicles[0];
		expect(translationOf(moved).x).toBeCloseTo(0, 10);
		expect(translationOf(moved).z).toBeCloseTo(-10, 10);
		const facing = facingOf(moved);
		expect(facing.x).toBeCloseTo(0, 10);
		expect(facing.y).toBeCloseTo(0, 10);
		expect(facing.z).toBeCloseTo(-1, 10);
	});

	it('composes the whole 3-axis delta into the basis (elements [0..11] move)', () => {
		const v = makeStaticVehicle({ x: 0, y: 0, z: 0 });
		const model = makeModel({ hulls: [makeHull({ staticVehicles: [v] })] });
		const next = transform(
			model,
			[VEHICLE_0],
			delta({ rotate: { x: 0.3, y: 0.2, z: -0.1 }, pivot: ORIGIN }),
			R,
		);
		const m = next.hulls[0].staticTrafficVehicles[0].mTransform;
		let moved = 0;
		for (let i = 0; i < 12; i++) if (Math.abs(m[i] - v.mTransform[i]) > 1e-9) moved++;
		expect(moved).toBeGreaterThan(0);
	});
});

describe('the two representations agree (counter-rotation regression pin)', () => {
	it('a junction and a static vehicle in ONE gesture end up in the same place, facing the same way', () => {
		// Identical start pose in the two storage forms: a junction whose
		// heading lives in `.w`, and a car whose heading lives in its basis.
		// Before the merge these swung opposite ways for the same +Y drag.
		const startYaw = 0.4;
		const model = makeModel({
			hulls: [
				makeHull({
					junctions: [makeJunction(vec4(10, 2, 0, startYaw))],
					staticVehicles: [makeStaticVehicle({ x: 10, y: 2, z: 0 }, { x: 0, y: startYaw, z: 0 })],
				}),
			],
		});
		const theta = Math.PI / 3;
		const next = transform(
			model,
			[JUNCTION_0, VEHICLE_0],
			delta({ rotate: { x: 0, y: theta, z: 0 }, pivot: { x: 5, y: 0, z: -5 } }),
			R,
		);
		const j = next.hulls[0].junctions[0].mPosition;
		const car = next.hulls[0].staticTrafficVehicles[0];
		const t = translationOf(car);

		// Position: element for element.
		expect(j.x).toBeCloseTo(t.x, 10);
		expect(j.y).toBeCloseTo(t.y, 10);
		expect(j.z).toBeCloseTo(t.z, 10);
		// Heading: the junction's `.w` and the car's basis yaw are the same
		// angle, and both equal start + delta.
		expect(j.w).toBeCloseTo(startYaw + theta, 10);
		expect(yawOf(car)).toBeCloseTo(j.w, 10);
		// And the car's forward vector is the one `.w` describes: a yaw of w
		// maps local +X to (cos w, 0, -sin w).
		const facing = facingOf(car);
		expect(facing.x).toBeCloseTo(Math.cos(j.w), 10);
		expect(facing.z).toBeCloseTo(-Math.sin(j.w), 10);
	});

	it('keeps a mixed Selection rigid — pairwise distance is preserved', () => {
		const model = makeModel({
			hulls: [
				makeHull({
					junctions: [makeJunction(vec4(0, 0, 0, 0))],
					staticVehicles: [makeStaticVehicle({ x: 20, y: 0, z: 0 })],
				}),
			],
		});
		const next = transform(
			model,
			[JUNCTION_0, VEHICLE_0],
			delta({ rotate: { x: 0, y: Math.PI / 3, z: 0 }, pivot: { x: 10, y: 0, z: 0 } }),
			R,
		);
		const j = next.hulls[0].junctions[0].mPosition;
		const t = translationOf(next.hulls[0].staticTrafficVehicles[0]);
		expect(Math.hypot(t.x - j.x, t.z - j.z)).toBeCloseTo(20, 8);
	});
});

// ---------------------------------------------------------------------------
// Cross-validation: Matrix44 vs Vector3+Euler
// ---------------------------------------------------------------------------
//
// Kept verbatim in spirit from the deleted `staticVehicleMatrix44.test.ts` —
// the six cases that were the only guard on the old hand-rolled
// `T(P) · R(delta) · T(-P) · M` sandwich. Retargeted at `transform()`, they
// now pin the split contract instead: the shared math owns the orbit and the
// resolver only pre-multiplies the basis. A wrong ordering looks fine on
// isolated cases and drifts the moment the pivot stops being the car's own
// position — which is exactly the bulk-rotate case.

describe('Matrix44 path equals the Vector3+Euler path (cross-validation)', () => {
	function rotateViaEuler(
		pos: { x: number; y: number; z: number },
		euler: { x: number; y: number; z: number },
		pivot: { x: number; y: number; z: number },
		d: { x: number; y: number; z: number },
	) {
		const deltaQuat = new THREE.Quaternion().setFromEuler(
			new THREE.Euler(d.x, d.y, d.z, 'XYZ'),
		);
		const ownQuat = new THREE.Quaternion().setFromEuler(
			new THREE.Euler(euler.x, euler.y, euler.z, 'XYZ'),
		);
		const pivotVec = new THREE.Vector3(pivot.x, pivot.y, pivot.z);
		const newPos = new THREE.Vector3(pos.x, pos.y, pos.z)
			.sub(pivotVec)
			.applyQuaternion(deltaQuat)
			.add(pivotVec);
		const facing = new THREE.Vector3(1, 0, 0)
			.applyQuaternion(deltaQuat.clone().multiply(ownQuat));
		return {
			pos: { x: newPos.x, y: newPos.y, z: newPos.z },
			facing: { x: facing.x, y: facing.y, z: facing.z },
		};
	}

	const cases = [
		{
			name: 'identity rotation does nothing',
			pos: { x: 7, y: 11, z: 13 }, euler: { x: 0.1, y: 0.2, z: 0.3 },
			pivot: { x: 0, y: 0, z: 0 }, d: { x: 0, y: 0, z: 0 },
		},
		{
			name: 'yaw PI/2 around origin, identity-facing car at (10, 0, 0)',
			pos: { x: 10, y: 0, z: 0 }, euler: { x: 0, y: 0, z: 0 },
			pivot: { x: 0, y: 0, z: 0 }, d: { x: 0, y: Math.PI / 2, z: 0 },
		},
		{
			name: 'yaw PI/3 around an external pivot, pre-rotated car',
			pos: { x: 25, y: 5, z: -10 }, euler: { x: 0, y: 0.5, z: 0 },
			pivot: { x: 5, y: 0, z: 0 }, d: { x: 0, y: Math.PI / 3, z: 0 },
		},
		{
			name: 'pitch + yaw mix around an external 3D pivot',
			pos: { x: 12, y: 8, z: -4 }, euler: { x: 0.2, y: 0.6, z: -0.1 },
			pivot: { x: 3, y: 2, z: 1 }, d: { x: 0.4, y: -0.3, z: 0 },
		},
		{
			name: 'full 3-axis delta around the car\'s own position (pure spin)',
			pos: { x: -8, y: 4, z: 16 }, euler: { x: 0, y: 0, z: 0 },
			pivot: { x: -8, y: 4, z: 16 }, d: { x: 0.2, y: 0.4, z: 0.6 },
		},
		{
			name: 'full 3-axis delta around a far external pivot',
			pos: { x: 100, y: 0, z: 0 }, euler: { x: 0.1, y: 0.2, z: 0.3 },
			pivot: { x: 0, y: 0, z: 0 }, d: { x: 0.3, y: 0.7, z: -0.4 },
		},
	];

	for (const c of cases) {
		it(c.name, () => {
			const model = makeModel({
				hulls: [makeHull({ staticVehicles: [makeStaticVehicle(c.pos, c.euler)] })],
			});
			const next = transform(model, [VEHICLE_0], delta({ rotate: c.d, pivot: c.pivot }), R);
			const car = next.hulls[0].staticTrafficVehicles[0];
			const want = rotateViaEuler(c.pos, c.euler, c.pivot, c.d);
			const got = translationOf(car);
			const gotFacing = facingOf(car);
			expect(got.x).toBeCloseTo(want.pos.x, 8);
			expect(got.y).toBeCloseTo(want.pos.y, 8);
			expect(got.z).toBeCloseTo(want.pos.z, 8);
			expect(gotFacing.x).toBeCloseTo(want.facing.x, 8);
			expect(gotFacing.y).toBeCloseTo(want.facing.y, 8);
			expect(gotFacing.z).toBeCloseTo(want.facing.z, 8);
		});
	}
});
