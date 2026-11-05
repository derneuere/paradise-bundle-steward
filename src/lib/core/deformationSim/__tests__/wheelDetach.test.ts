// The wheels follow the body's deformation: seated on their tag points, then
// (crashing) twisted and locked once the tag is pushed past its threshold,
// and shed at speed once the twist passes its limit.

import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../../deformationSpec';
import { hasFixture, loadCar } from '../../vehicleSim/__tests__/carFixture';
import { lowestGap } from '../freeParts';
import { applyImpact, createCrashSim, stepCrashSim } from '../sim';
import { add, sub, type SimState } from '../state';
import { updateWheelTags } from '../wheelDetach';
import { makeSim } from './fixture';

const FL_TAG = 5;

function frontLeftPushedBack(back: number, crashing: boolean): SimState {
	const s = makeSim({ crashing }).state;
	s.spec.tagPoints[FL_TAG].fDetachThresholdSquared = 0.01;
	s.tags[FL_TAG] = add(s.tags[FL_TAG], [0, 0, -back]);
	return s;
}

describe('wheel seating', () => {
	it('puts the hub\'s x and z on its tag point and keeps its own height', () => {
		const s = frontLeftPushedBack(0.3, false), w = s.vehicle.wheels[0];
		const y = w.pos[1];
		updateWheelTags(s);
		expect(w.pos).toEqual([s.tags[FL_TAG][0] - s.com[0], y, s.tags[FL_TAG][2] - s.com[2]]);
		expect(w.twisted).toBe(false);
	});

	it.skipIf(!hasFixture('PUSSC01'))('leaves an undented retail car\'s hubs where they were streamed', () => {
		const { spec, vault } = loadCar('PUSSC01');
		const s = createCrashSim(spec, { vault }).state;
		const before = s.vehicle.wheels.map((w) => [...w.pos]);
		updateWheelTags(s);
		s.vehicle.wheels.forEach((w, i) => [0, 2].forEach((k) => expect(w.pos[k]).toBeCloseTo(before[i][k], 4)));
	});
});

describe('crashing', () => {
	it('twists (and locks) a wheel whose tag is past its threshold, with a random limit up to 1.57 rad', () => {
		const s = frontLeftPushedBack(0.3, true), w = s.vehicle.wheels[0];
		w.omega = 40;
		updateWheelTags(s);
		expect(w.twisted).toBe(true);
		expect(w.omega).toBe(0);
		expect(s.brokenWheels).toBe(1);
		expect(s.wheelTwistLimit[0]).toBeGreaterThanOrEqual(0);
		expect(s.wheelTwistLimit[0]).toBeLessThan(1.57);
		expect(s.vehicle.wheels.slice(1).some((x) => x.twisted)).toBe(false);
	});

	it('leans a twisted wheel by 8 x its excess, up to the limit, and sheds it past the limit above 20 mph', () => {
		const s = frontLeftPushedBack(0.3, true), w = s.vehicle.wheels[0];
		updateWheelTags(s);
		s.wheelTwistLimit[0] = 0.5;            // excess (0.09 - 0.01) x 8 = 0.64
		s.vehicle.speedMag = 8.9;
		updateWheelTags(s);
		expect(w.twistAmount).toBeCloseTo(0.5, 9);
		expect(w.detached).toBe(false);
		s.vehicle.speedMag = 9;
		s.body.v = [1, 0, 9];
		s.body.w = [0, 0.5, 0];
		updateWheelTags(s);
		expect(w.detached).toBe(true);
		const loose = s.looseWheels[0];
		expect(loose.wheel).toBe(0);
		expect(loose.vel).toEqual([1, 0, 9]);
		expect(loose.spin).toEqual([0, 0, 0]);   // a twisted wheel no longer turns
		expect([loose.radius, loose.halfWidth]).toEqual([0.3, 0.15]);
	});

	it('does not twist a wheel within its threshold, and leaves a shed wheel alone', () => {
		const s = frontLeftPushedBack(0.05, true);
		updateWheelTags(s);
		expect(s.vehicle.wheels[0].twisted).toBe(false);
		s.vehicle.wheels[0].detached = true;
		const pos = [...s.vehicle.wheels[0].pos];
		s.tags[FL_TAG] = sub(s.tags[FL_TAG], [0, 0, 0.5] as Vec3);
		updateWheelTags(s);
		expect(s.vehicle.wheels[0].pos).toEqual(pos);
	});
});

describe.skipIf(!hasFixture('PUSSC01'))('PUSSC01 into a wall', () => {
	const run = (kmh: number) => {
		const { spec, vault } = loadCar('PUSSC01');
		const sim = createCrashSim(spec, { vault });
		const sh = spec.carModelSpaceToHandlingBodySpace[3];
		const front = Math.max(...spec.tagPoints.map((t) => t.initialPosition[2]));
		applyImpact(sim, { pointMesh: [-sh[0], 0.5 - sh[1], front - sh[2]], direction: [0, 0, -1], speed: kmh / 3.6 });
		const streamed = sim.state.vehicle.params.wheels.map((w) => w.streamed);
		for (let i = 0; i < 60 * 8; i++) stepCrashSim(sim);
		return { s: sim.state, streamed };
	};

	it('at 180 km/h locks both front wheels and pushes them back with the crumpled nose; the rears roll on', () => {
		const { s, streamed } = run(180);
		const [fl, fr, rl, rr] = s.vehicle.wheels;
		for (const w of [fl, fr]) expect(w.twisted && w.omega === 0).toBe(true);
		expect(streamed[0][2] - fl.pos[2]).toBeGreaterThan(0.15);
		expect(streamed[1][2] - fr.pos[2]).toBeGreaterThan(0.15);
		expect(rl.twisted || rr.twisted).toBe(false);
	});

	it('at 250 km/h sheds the front left wheel, which comes to rest on the road', () => {
		const { s } = run(250);
		expect(s.vehicle.wheels[0].detached).toBe(true);
		expect(s.vehicle.wheelPlane.valid).toBe(false);
		const loose = s.looseWheels.find((w) => w.wheel === 0)!;
		expect(loose.frozen).toBe(true);
		expect(Math.abs(lowestGap(loose))).toBeLessThan(1e-3);
	});
});
