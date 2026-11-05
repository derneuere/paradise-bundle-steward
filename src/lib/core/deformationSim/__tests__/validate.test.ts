// How a car that is not crashing filters and bends its world contacts: road
// contacts under a moving car are re-pointed onto the front-left hub's plane
// (so they never close), walls never are, and anything outside the car's box
// grown by one step's travel is dropped once the car is past 25 mph.

import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../../deformationSpec';
import { toWorld } from '../../vehicleSim/body';
import { MPS_TO_MPH } from '../../vehicleSim/vehicleState';
import { dot, normalize, sub } from '../state';
import { cullHeight, validateWorldContact, validateWorldContacts } from '../validate';
import type { PotentialContact } from '../world';
import { makeSim } from './fixture';

const DT = 1 / 60;

// A level car driving +z at `kmh` on the ground plane, its wheels on the road.
function driving(kmh: number) {
	const s = makeSim({ crashing: false }).state;
	const v = s.vehicle, speed = kmh / 3.6;
	s.body.v = [0, 0, speed];
	v.speedMag = speed;
	v.speedMph = speed * MPS_TO_MPH;
	v.wheelPlane = { valid: true, pos: [s.body.pos[0], 0, s.body.pos[2]], height: 0 };
	v.aboveGround = { valid: true, pos: [s.body.pos[0], 0, s.body.pos[2]], normal: [0, 1, 0], verticalDistance: s.body.pos[1] };
	return s;
}

const local = (s: ReturnType<typeof driving>, p: Vec3) => toWorld(s.body, p);

// A road contact under body point (x, z): the sphere's lowest point 5 cm up.
function road(s: ReturnType<typeof driving>, x: number, z: number): PotentialContact {
	const pB = local(s, [x, 0, z]);
	pB[1] = 0;
	return { sphere: 2, pA: [pB[0], 0.05, pB[2]], pB, n: [0, 1, 0], surface: 'ground' };
}

// A wall contact ahead of the nose: the wall `gap` metres past the box front.
function wall(s: ReturnType<typeof driving>, gap: number, x = 0, n: Vec3 = [0, 0, -1]): PotentialContact {
	const front = s.vehicle.aabb.max[2];
	const pB = local(s, [x, 0.2, front + gap]);
	return { sphere: 0, pA: local(s, [x, 0.2, front]), pB, n, surface: 'obstacle' };
}

describe('ground cull height', () => {
	it('grows from nothing at 10 mph to 0.4 m at 25 mph', () => {
		expect(cullHeight(10)).toBe(0);
		expect(cullHeight(17.5)).toBeCloseTo(0.2, 12);
		expect(cullHeight(25)).toBe(0.4);
		expect(cullHeight(90)).toBe(0.4);
	});
});

describe('a car that is not crashing', () => {
	it('keeps every contact as it is below 10 mph', () => {
		const s = driving(15);
		const c = road(s, 0.5, 1);
		const before = structuredClone(c);
		expect(validateWorldContact(s.vehicle, c, DT)).toBe(true);
		expect(c).toEqual(before);
	});

	it('re-points a road contact under a moving car onto the front-left hub plane, along its up', () => {
		const s = driving(60);
		const c = road(s, 0.5, 1);
		const pB = [...c.pB];
		expect(validateWorldContact(s.vehicle, c, DT)).toBe(true);
		expect(c.n).toEqual(s.body.axes[1]);
		expect(c.pB).toEqual(pB);
		const hub = toWorld(s.body, s.vehicle.params.wheels[0].streamed);
		expect(dot(sub(c.pA, hub), s.body.axes[1])).toBeCloseTo(0, 12);
		// A hub's height above the road: it can never close this step.
		expect(dot(sub(c.pA, c.pB), c.n)).toBeGreaterThan(0.2);
	});

	it('never culls a wall, and makes a near-horizontal normal level', () => {
		const s = driving(60);
		const c = wall(s, 0.1, 0, normalize([0, 0.3, -1]));
		expect(validateWorldContact(s.vehicle, c, DT)).toBe(true);
		expect(c.n).toEqual([0, 0, -1]);
		expect(c.pA).toEqual(wall(s, 0.1).pA);
	});

	it('drops a wall further ahead than one step of travel once past 25 mph, and keeps it slower', () => {
		const fast = driving(100);   // 0.46 m a step
		expect(validateWorldContact(fast.vehicle, wall(fast, 0.4), DT)).toBe(true);
		expect(validateWorldContact(fast.vehicle, wall(fast, 0.6), DT)).toBe(false);
		const slow = driving(35);
		expect(validateWorldContact(slow.vehicle, wall(slow, 1.5), DT)).toBe(true);
	});

	it('drops anything beside the car beyond 0.2 m of its box, at any speed past 10 mph', () => {
		const s = driving(35);
		const box = s.vehicle.aabb;
		expect(validateWorldContact(s.vehicle, wall(s, -1, box.max[0] + 0.15, [-1, 0, 0]), DT)).toBe(true);
		expect(validateWorldContact(s.vehicle, wall(s, -1, box.max[0] + 0.25, [-1, 0, 0]), DT)).toBe(false);
	});

	it('tests local Y against all three lower bounds of the box, as the game does', () => {
		// Far behind the car, but level with it: kept at 100 km/h.
		const s = driving(100);
		const c = wall(s, 0, 0, [0, 0, 1]);
		c.pB = local(s, [0, 0.2, s.vehicle.aabb.min[2] - 3]);
		expect(validateWorldContact(s.vehicle, c, DT)).toBe(true);
	});

	it('leaves a crashing car its contacts untouched', () => {
		const s = driving(100);
		s.vehicle.crashing = true;
		s.potential = [road(s, 0.5, 1), wall(s, 1.5)];
		const before = structuredClone(s.potential);
		validateWorldContacts(s, DT);
		expect(s.potential).toEqual(before);
		s.vehicle.crashing = false;
		validateWorldContacts(s, DT);
		expect(s.potential).toHaveLength(1);
		expect(s.potential[0].surface).toBe('ground');
	});
});
