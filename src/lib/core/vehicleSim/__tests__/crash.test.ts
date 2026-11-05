import { describe, expect, it } from 'vitest';
import { cross, dot } from '../../deformationSim/state';
import { drain, toBodyDir, toWorld, toWorldDir } from '../body';
import {
	applyContactImpulse, createCrashClock, setCrashing, tickCrashClock, worldCrashArm, type ArmContact,
} from '../crash';
import { flatGround } from '../ground';
import { stepVehicle, DT } from '../step';
import { crashScrub } from '../tyres';
import { resetVehicle, updateVehicle } from '../vehicle';
import { createVehicle, NO_INPUT, type VehicleState } from '../vehicleState';
import { hasFixture, loadCar, syntheticParams } from './carFixture';
import { postHooks } from './postHooks';

const world = flatGround(0);
const close = (a: readonly number[], b: readonly number[], d = 9) => b.forEach((x, i) => expect(a[i]).toBeCloseTo(x, d));

function carAt(speed: number): VehicleState {
	const v = createVehicle(syntheticParams(), [0, 0.33, 0]);
	resetVehicle(v, [0, 0, speed]);
	v.speedMag = speed;
	return v;
}

// A wall across the car's path, touching the middle of its nose.
const noseOnWall = (v: VehicleState): ArmContact => {
	const p = toWorld(v.body, [0, 0, v.aabb.max[2] - 0.1]);
	return { pointA: p, pointB: [p[0], p[1], p[2] + 0.05], normal: [0, 0, -1] };
};

describe('world crash arm', () => {
	it('lets a 30 m/s head-on wall hit through as a knock', () => {
		const r = worldCrashArm(carAt(30), noseOnWall(carAt(30)), DT);
		expect(r).toMatchObject({ kind: null, approaching: true, onFrontFace: true });
		expect(r.closingSpeed).toBeCloseTo(30, 9);
	});

	it('crashes head-on from 40.5 m/s along the wall normal', () => {
		expect(worldCrashArm(carAt(40.4), noseOnWall(carAt(40.4)), DT).kind).toBe(null);
		expect(worldCrashArm(carAt(40.5), noseOnWall(carAt(40.5)), DT).kind).toBe('headOn');
		expect(worldCrashArm(carAt(45), noseOnWall(carAt(45)), DT, { headOn: 20, side: 50 }).kind).toBe('headOn');
	});

	it('ignores a contact the car moves away from within the step', () => {
		const v = carAt(45);
		const c = noseOnWall(v);
		const r = worldCrashArm(v, { ...c, normal: [0, 0, 1], pointB: [c.pointA[0], c.pointA[1], c.pointA[2] - 0.05] }, DT);
		expect(r).toMatchObject({ kind: null, approaching: false });
	});

	it('crashes side-on at 50 m/s at the point, only above the centre of mass', () => {
		const v = carAt(0);
		v.body.v = [-52, 0, 0];
		const side = (y: number): ArmContact => {
			const p = toWorld(v.body, [v.aabb.min[0], y, 0]);
			return { pointA: p, pointB: [p[0] - 0.05, p[1], p[2]], normal: [1, 0, 0] };
		};
		expect(worldCrashArm(v, side(0.2), DT).kind).toBe('side');
		expect(worldCrashArm(v, side(-0.2), DT).kind).toBe(null);
	});

	it('crashes a car rolled past 80 degrees onto the ground', () => {
		const v = carAt(0);
		v.body.axes = [[1, 0, 0], [0, -1, 0], [0, 0, -1]];
		v.body.v = [0, -2, 0];
		const p = toWorld(v.body, [0, 0.5, 0]);
		const r = worldCrashArm(v, { pointA: p, pointB: [p[0], p[1] - 0.01, p[2]], normal: [0, 1, 0] }, DT);
		expect(r.kind).toBe('rolled');
	});
});

describe('crash entry', () => {
	it('boosts horizontal velocity and the world spin components by the attrib factors', () => {
		const v = carAt(45);
		v.body.v = [3, -1, 45];
		v.body.w = [0.1, 0.2, 0.3];
		expect(setCrashing(v)).toBe(true);
		close(v.body.v, [3.9, -1, 58.5]);
		close(v.body.w, [0.1, 0.26, 0.39]);
		v.wheels.forEach((w) => expect(w.omega).toBeCloseTo(45 / 0.325, 9));
		expect(v.crashClock?.secs).toBe(4);
		expect(setCrashing(v)).toBe(false);
	});

	it('enters on the arm inside the step, before the vehicle update', () => {
		const hit = (speed: number, forceCrash = false) => {
			const v = carAt(speed);
			const r = stepVehicle(v, world, DT, NO_INPUT, { crashArmContacts: () => [noseOnWall(v)] }, { forceCrash });
			return { r, v };
		};
		expect(hit(30).r.crashed).toBe(null);
		expect(hit(30).v.crashing).toBe(false);
		expect(hit(30, true).r.crashed).toBe('forced');
		const { r, v } = hit(45);
		expect(r.crashed).toBe('headOn');
		expect(v.crashing).toBe(true);
		// Entry x1.3, then one step of crash damping and road forces.
		expect(v.body.v[2]).toBeGreaterThan(45 * 1.3 * 0.99);
	});
});

describe('contact impulses into the body', () => {
	it('quarters a knock and keeps it from lifting or flipping the car', () => {
		const v = carAt(30);
		const p = toWorld(v.body, [0.5, 0.3, 2]);
		applyContactImpulse(v, [0, 400, -4000], p, true, [0, 0, -1]);
		expect(v.numWorldCollisions).toBe(1);
		expect(v.secondsSinceLastWallContact).toBe(0);
		const J = toWorldDir(v.body, [0, 0, -1000]);
		close(v.body.J, J);
		close(v.body.L, cross(toWorldDir(v.body, [0.5, 0, 1.4]), J));
	});

	it('applies a crashed contact in full at the point', () => {
		const v = carAt(30);
		v.crashing = true;
		const p = toWorld(v.body, [0.5, 0.3, 2]);
		applyContactImpulse(v, [0, 400, -4000], p, true, [0, 0, -1]);
		const J = toWorldDir(v.body, [0, 400, -4000]);
		close(v.body.J, J);
		close(v.body.L, cross(toWorldDir(v.body, [0.5, 0.3, 2]), J), 6);
	});
});

describe('crashing', () => {
	it('damps and clamps the spin to 6.5 rad/s about each body axis', () => {
		const v = carAt(0);
		v.body.pos = [0, 10, 0];
		v.crashing = true;
		v.body.w = toWorldDir(v.body, [10, -20, 3]);
		updateVehicle(v, NO_INPUT, DT);
		close(toBodyDir(v.body, v.body.w), [6.5, -6.5, 3 * 0.995], 6);
	});

	it('scrubs a sliding wreck so it rolls toward the slide', () => {
		const v = carAt(0);
		stepVehicle(v, world, DT, NO_INPUT);
		v.crashing = true;
		v.body.v = [8, 0, 0];
		v.body.w = [0, 0, 0];
		v.wheels.forEach((w) => expect(w.hasTraction).toBe(true));
		for (let i = 0; i < 4; i++) crashScrub(v, i);
		// Torque about At is negative: Up tips toward +x, the way the car slides.
		expect(dot(v.body.Tq, v.body.axes[2])).toBeLessThan(0);
		drain(v.body, DT);
		expect(dot(cross(v.body.w, v.body.axes[1]), [1, 0, 0])).toBeGreaterThan(0);
		expect(v.body.v[0]).toBeLessThan(8);
	});

	it('spins a wheel off the road down instead', () => {
		const v = carAt(0);
		v.crashing = true;
		v.wheels[0].omega = 100;
		crashScrub(v, 0);
		expect(v.wheels[0].omega).toBeCloseTo(95, 9);
		expect(v.body.Tq).toEqual([0, 0, 0]);
	});
});

describe('crash clock', () => {
	it('ends a still wreck after 4 s and a moving one after at most 11.5 s', () => {
		const until = (moving: boolean, short = false) => {
			const c = createCrashClock(short);
			let n = 0;
			while (!tickCrashClock(c, moving ? 20 : 0, [0, 0, 0], DT)) n++;
			return { t: (n + 1) * DT, ext: c.extensions };
		};
		expect(until(false).t).toBeCloseTo(4, 1);
		expect(until(false).ext).toBe(0);
		expect(until(true).t).toBeCloseTo(11.5, 1);
		expect(until(true).ext).toBe(10);
		expect(until(false, true).t).toBeCloseTo(3, 1);
	});

	it('keeps extending while the car spins in place', () => {
		const c = createCrashClock();
		for (let i = 0; i < 4.5 * 60; i++) tickCrashClock(c, 0, [0, 2, 0], DT);
		expect(c.extensions).toBe(1);
		expect(c.over).toBe(false);
	});
});

function postCrash(v: VehicleState, gas: number) {
	resetVehicle(v, [0, 0, 45]);
	const hooks = postHooks({ x: 0.6, face: 20, half: 0.3 });
	let kind = null as string | null, crashAt = 0, maxYaw = 0, t = 0;
	for (let i = 0; i < 60 * 15; i++) {
		const r = stepVehicle(v, world, DT, { ...NO_INPUT, gas }, hooks);
		t += DT;
		if (r.crashed) { kind = r.crashed; crashAt = t; }
		maxYaw = Math.max(maxYaw, Math.abs(dot(v.body.w, v.body.axes[1])));
		if (r.crashOver) return { kind, maxYaw, length: t - crashAt, v };
	}
	return { kind, maxYaw, length: Infinity, v };
}

function postSuite(name: string, params: () => Parameters<typeof createVehicle>[0]) {
	describe(name, () => {
		it('crashes head-on into an off-centre post, spins, and the clock ends it', () => {
			for (const gas of [0, 1]) {
				const r = postCrash(createVehicle(params(), [0, 0.33, 0]), gas);
				expect(r.kind).toBe('headOn');
				expect(r.maxYaw).toBeGreaterThan(3);
				expect(r.length).toBeGreaterThanOrEqual(4 - 1e-9);
				expect(r.length).toBeLessThanOrEqual(11.5 + 1e-9);
				// Gas released: the wreck freezes and gets no extension.
				if (gas === 0) { expect(r.v.frozen).toBe(true); expect(r.length).toBeCloseTo(4, 1); }
			}
		});
	});
}

postSuite('post crash, synthetic coupe', syntheticParams);
describe.skipIf(!hasFixture('PUSMC01'))('post crash, PUSMC01', () => postSuite('retail muscle car', () => loadCar('PUSMC01').params));
