import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../../deformationSpec';
import { crashArmContacts, orderWorldContacts } from '../crashArm';
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

	it('hands the crash arm its contacts car point first', () => {
		const s = car([0, -1, 10]);
		s.potential = [at(s, [0, -0.25, 0], [0, 1, 0], 'ground'), wall(s, 0.1)];
		const arm = crashArmContacts(s);
		expect(arm).toHaveLength(2);
		expect(arm[0]).toMatchObject({ pointA: s.potential[1].pA, pointB: s.potential[1].pB, normal: [0, 0, -1] });
	});
});
