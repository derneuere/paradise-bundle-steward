import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../../deformationSpec';
import { classifyWorldCrash, orderWorldContacts, predictWorldCrash } from '../crashArm';
import { createCrashSim } from '../sim';
import { add } from '../state';
import type { PotentialContact } from '../world';
import { makeSpec } from './fixture';

const DT = 1 / 60;

function car(v: Vec3) {
	const s = createCrashSim(makeSpec()).state;
	s.body.v = v;
	return s;
}

// A contact at `local` (body frame, from the centre of mass) whose surface
// faces `n`.
const at = (s: ReturnType<typeof car>, local: Vec3, n: Vec3, surface: PotentialContact['surface'] = 'obstacle'): PotentialContact => {
	const p = add(s.body.pos, local);
	return { sphere: 0, pA: p, pB: p, n, surface };
};

describe('world crash test', () => {
	it('calls a head-on crash on the front face at 40.5 m/s of closing, not below', () => {
		const nose: Vec3 = [0, 0.25, 2.4];
		expect(classifyWorldCrash(car([0, 0, 40.5]), at(car([0, 0, 40.5]), nose, [0, 0, -1]), DT)).toBe('headOn');
		expect(classifyWorldCrash(car([0, 0, 40.4]), at(car([0, 0, 40.4]), nose, [0, 0, -1]), DT)).toBeNull();
	});

	it('calls a side-on crash at 50 m/s of point closing, only above the centre of mass', () => {
		const s = car([50, 0, 0]);
		expect(classifyWorldCrash(s, at(s, [1.2, 0.1, 0], [-1, 0, 0]), DT)).toBe('sideOn');
		expect(classifyWorldCrash(s, at(s, [1.2, -0.1, 0], [-1, 0, 0]), DT)).toBeNull();
		const slow = car([49.9, 0, 0]);
		expect(classifyWorldCrash(slow, at(slow, [1.2, 0.1, 0], [-1, 0, 0]), DT)).toBeNull();
	});

	it('calls a rolled crash for a car past 80° off upright meeting a surface that faces up', () => {
		const s = car([0, 0, 0]);
		s.body.axes = [[1, 0, 0], [0, 0.17, 0.985], [0, -0.985, 0.17]];
		expect(classifyWorldCrash(s, at(s, [0, -0.5, 0], [0, 1, 0], 'ground'), DT)).toBe('rolled');
		s.body.axes = [[1, 0, 0], [0, 0.18, 0.984], [0, -0.984, 0.18]];
		expect(classifyWorldCrash(s, at(s, [0, -0.5, 0], [0, 1, 0], 'ground'), DT)).toBeNull();
	});

	it('ignores a contact the car will not reach this step', () => {
		const s = car([0, 0, 45]);
		const c = at(s, [0, 0.25, 2.4], [0, 0, -1]);
		c.pB = add(c.pB, [0, 0, 1]);
		expect(classifyWorldCrash(s, c, DT)).toBeNull();
	});
});

describe('ordering candidates for the crash test', () => {
	// A wall face 2.1 m ahead; the car point is `gap` short of it.
	const wall = (s: ReturnType<typeof car>, gap: number, x = 0, faceAt = 2.1): PotentialContact => {
		const pB = add(s.body.pos, [x, 0, faceAt]);
		return { sphere: 0, pA: add(pB, [0, 0, -gap]), pB, n: [0, 0, -1], surface: 'obstacle' };
	};

	it('puts the earliest first (ties in arrival order), the ground a step later, and keeps five', () => {
		const s = car([0, -1, 10]);
		const ground = at(s, [0, -0.25, 0], [0, 1, 0], 'ground');
		const ordered = orderWorldContacts(s, [ground, wall(s, 0.3), wall(s, 0.1), wall(s, 0.2, 0.5), wall(s, 0.2, -0.5), wall(s, 0.4)]);
		expect(ordered.map((c) => +(c.pB[2] - c.pA[2]).toFixed(9))).toEqual([0.1, 0.2, 0.2, 0.3, 0.4]);
		expect(ordered[1].pB[0] - s.body.pos[0]).toBe(0.5);
		expect(ordered).not.toContain(ground);
	});

	it("drops a later candidate lying behind an earlier one's surface", () => {
		const s = car([0, 0, 10]);
		const front = wall(s, 0.1), behind = wall(s, 0.5, 0, 3.1);
		expect(orderWorldContacts(s, [behind, front])).toEqual([front]);
	});

	it('reports the first contact that would crash the car', () => {
		const s = car([0, 0, 45]);
		s.potential = [at(s, [0, -0.25, 0], [0, 1, 0], 'ground'), at(s, [0, 0.25, 2.4], [0, 0, -1])];
		expect(predictWorldCrash(s, DT)?.kind).toBe('headOn');
	});
});
