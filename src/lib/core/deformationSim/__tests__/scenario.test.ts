// Where a run puts the car and the obstacle, how the car is sent in, and how
// the game's crash test and the pedals play out over the run.

import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../../deformationSpec';
import { pitchedAxes, restPose } from '../../vehicleSim/driver';
import { collisionSpheres } from '../contacts';
import { launchFor, startRun } from '../scenario';
import { applyImpact, createCrashSim, stepCrashSim } from '../sim';
import { add, dot, length, sub } from '../state';
import { makeSpec, stepUntilHit } from './fixture';

const NOSE: Vec3 = [0, 0.5, 2.4];
const IN_NOSE: Vec3 = [0, 0, -1];
const sim = () => createCrashSim(makeSpec());

describe('launch', () => {
	it('drives a front hit in, launches a side or rear hit sliding and drops a roof hit', () => {
		expect(launchFor([0, 0, 1])).toBe('drive');
		expect(launchFor([0.8, 0.2, 0.6])).toBe('drive');      // within 60° of the nose
		expect(launchFor([1, 0, 0.4])).toBe('slide');
		expect(launchFor([0, 0, -1])).toBe('slide');
		expect(launchFor([0, 0.9, 0.1])).toBe('roof');
	});
});

describe('placing a run', () => {
	it('starts the car on its wheels at rest at the origin, nose on, along its heading at the start speed', () => {
		const c = sim();
		const run = startRun(c.state, { pointMesh: NOSE, direction: IN_NOSE, speed: 20 });
		const b = c.state.body, rest = restPose(c.state.vehicle.params);
		expect(run.launch).toBe('drive');
		expect(b.pos).toEqual([0, rest.height, 0]);
		expect(b.axes).toEqual(pitchedAxes(rest.pitch));
		expect(b.v[0]).toBe(0);
		expect(b.v[2]).toBeCloseTo(20, 9);
		expect(run.driving.gas).toBe(1);
		expect(run.crashInput).toBe('release');
	});

	it('puts the wall square to the travel a quarter second of driving ahead of the picked point', () => {
		const c = sim();
		startRun(c.state, { pointMesh: NOSE, direction: IN_NOSE, speed: 20 });
		const o = c.state.obstacle!;
		expect(o.kind).toBe('wall');
		expect(o.normal).toEqual([0, 0, 1]);
		const picked = add(c.state.body.pos, sub(NOSE, c.state.com));
		expect(o.point[2] - picked[2]).toBeCloseTo(5, 2);
		for (const { centre, radius } of collisionSpheres(c.state)) expect(dot(sub(o.point, centre), o.normal) - radius).toBeGreaterThan(0.09);
	});

	it('turns the wall by the glance, and moves it out of reach of every sphere', () => {
		const c = sim();
		startRun(c.state, { pointMesh: NOSE, direction: IN_NOSE, speed: 4, glance: 45 });
		const o = c.state.obstacle!;
		expect(o.normal[0]).toBeCloseTo(Math.SQRT1_2, 9);
		expect(o.normal[2]).toBeCloseTo(Math.SQRT1_2, 9);
		for (const { centre, radius } of collisionSpheres(c.state)) expect(dot(sub(o.point, centre), o.normal) - radius).toBeGreaterThan(0.09);
	});

	it('launches a side hit sliding along the hit direction, close to the obstacle, off the pedals', () => {
		const c = sim();
		const run = startRun(c.state, { pointMesh: [1.2, 0.5, 0], direction: [-1, 0, 0], speed: 15 });
		expect(run.launch).toBe('slide');
		expect(run.driving.gas).toBe(0);
		expect(c.state.body.v[0]).toBeCloseTo(15, 9);
		expect(c.state.body.v[2]).toBeCloseTo(0, 9);
		const o = c.state.obstacle!;
		expect(o.normal).toEqual([1, 0, 0]);
		expect(o.point[0] - c.state.body.pos[0]).toBeLessThan(2);
	});

	it('stands a pole clear of the car, its face on the picked point\'s line of travel', () => {
		const c = sim();
		startRun(c.state, { pointMesh: [0.3, 0.5, 2.4], direction: IN_NOSE, speed: 10, obstacle: 'pole' });
		const o = c.state.obstacle!;
		expect(o.kind).toBe('pole');
		const picked = add(c.state.body.pos, sub([0.3, 0.5, 2.4], c.state.com));
		expect(o.point[0]).toBeCloseTo(picked[0], 9);
		const axis = add(o.point, [0, 0, o.poleRadius]);
		for (const { centre, radius } of collisionSpheres(c.state)) {
			expect(Math.hypot(centre[0] - axis[0], centre[2] - axis[2])).toBeGreaterThanOrEqual(radius + o.poleRadius + 0.1 - 1e-9);
		}
	});

	it('drops a roof hit upside down just above the ground, with nothing else to hit', () => {
		const c = sim();
		const run = startRun(c.state, { pointMesh: [0, 1.2, 0], direction: [0, -1, 0], speed: 10 });
		expect(run.launch).toBe('roof');
		expect(c.state.obstacle).toBeNull();
		expect(c.state.body.axes[1][1]).toBe(-1);
		const lowest = Math.min(...collisionSpheres(c.state).map(({ centre, radius }) => centre[1] - radius));
		expect(lowest).toBeCloseTo(0.2, 9);
	});

	it('keeps the dents but starts a fresh car for the next run', () => {
		const c = sim();
		applyImpact(c, { pointMesh: NOSE, direction: IN_NOSE, speed: 30, forceCrash: true });
		for (let i = 0; i < 60; i++) stepCrashSim(c);
		const dented = c.state.sensors.map((p) => [...p]);
		expect(c.state.vehicle.crashing).toBe(true);
		startRun(c.state, { pointMesh: NOSE, direction: IN_NOSE, speed: 10 });
		expect(c.state.sensors).toEqual(dented);
		expect(c.state.vehicle.crashing).toBe(false);
		expect(c.state.body).toBe(c.state.vehicle.body);
		expect(c.state.body.pos[0]).toBe(0);
	});
});

describe('running', () => {
	it('lets a slow hit off as a knock and reports how hard it closed', () => {
		const c = sim();
		applyImpact(c, { pointMesh: NOSE, direction: IN_NOSE, speed: 20 });
		stepUntilHit(c);
		const run = c.state.run!;
		expect(run.crash).toBeNull();
		expect(run.touched).toBe(true);
		expect(run.closingSpeed).toBeGreaterThan(19);
		expect(run.closingSpeed).toBeLessThan(40.5);
	});

	it('crashes the same hit when forced', () => {
		const c = sim();
		applyImpact(c, { pointMesh: NOSE, direction: IN_NOSE, speed: 20, forceCrash: true });
		stepUntilHit(c);
		expect(c.state.run!.crash).toBe('headOn');
		expect(c.state.vehicle.crashing).toBe(true);
	});

	it('releases the pedals after the hit by default, so the car freezes; holding them keeps it going', () => {
		const end = (crashInput: 'hold' | 'release') => {
			const c = sim();
			applyImpact(c, { pointMesh: NOSE, direction: IN_NOSE, speed: 15, crashInput });
			for (let i = 0; i < 60 * 25 && !c.state.run!.end; i++) stepCrashSim(c);
			return c.state.run!;
		};
		const released = end('release'), held = end('hold');
		expect(released.end).toBe('frozen');
		expect(held.end).toBe('timeout');
		expect(held.elapsed).toBeCloseTo(20, 6);
	});

	it('stops stepping the car once the run is over', () => {
		const c = sim();
		applyImpact(c, { pointMesh: NOSE, direction: IN_NOSE, speed: 15 });
		for (let i = 0; i < 60 * 25 && !c.state.run!.end; i++) stepCrashSim(c);
		const pos = [...c.state.body.pos];
		for (let i = 0; i < 30; i++) stepCrashSim(c);
		expect(c.state.body.pos).toEqual(pos);
		expect(length(c.state.body.v)).toBe(0);
	});
});
