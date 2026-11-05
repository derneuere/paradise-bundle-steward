import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../../deformationSpec';
import { createBody, drain, mulMat } from '../../vehicleSim/body';
import { bankWorldImpulse } from '../bodyImpulse';
import { applyContactImpulses, clearContacts } from '../contacts';
import { createCrashSim } from '../sim';
import { add, cross, dot, normalize, type ContactCounters } from '../state';
import { makeSpec } from './fixture';

const DT = 1 / 60;
const counters = (): ContactCounters => ({ numWorldCollisions: 0, numCollisions: 0, secondsSinceWallContact: 2 });
const close = (a: readonly number[], b: readonly number[], digits = 9) => a.forEach((v, k) => expect(v).toBeCloseTo(b[k], digits));

// A body turned 90° about Y: body +Z (At) points along world +X.
function turnedBody() {
	const b = createBody(1500, [1, 0.5, 2], [5, 1, 0]);
	b.axes = [[0, 0, -1], [0, 1, 0], [1, 0, 0]];
	return b;
}

describe('banking a remainder on the car body', () => {
	it('gives a crashing car the whole impulse at the contact point, in body axes', () => {
		const b = turnedBody(), c = counters();
		const pA: Vec3 = [7, 1.3, 0.4];
		bankWorldImpulse(b, true, c, [0, 0, -100], pA, [-1, 0, 0]);
		close(b.J, [-100, 0, 0]);
		close(b.L, cross([2, 0.3, 0.4], [-100, 0, 0]));
		expect(c).toEqual({ numWorldCollisions: 1, numCollisions: 1, secondsSinceWallContact: 0 });
	});

	it('gives a knock a quarter, without the body-up part or its lever when the surface is a wall', () => {
		const b = turnedBody(), c = counters();
		// Lever in body axes: (−0.4, 0.3, 2) -> (−0.4, 0, 1.4).
		bankWorldImpulse(b, false, c, [10, 40, -100], [7, 1.3, 0.4], [-1, 0, 0]);
		const J: Vec3 = [-25, 0, -2.5];      // R x (2.5, 0, −25)
		close(b.J, J);
		close(b.L, cross([1.4, 0, 0.4], J));
		expect(c.numWorldCollisions).toBe(1);
	});

	it('keeps the body-up part of a knock off a surface that faces up', () => {
		const b = turnedBody(), c = counters();
		bankWorldImpulse(b, false, c, [0, 40, 0], [7, 1.3, 0.4], [0, 0.65, 0.76]);
		close(b.J, [0, 10, 0]);
		close(b.L, cross([2, 0.3, 0.4], [0, 10, 0]));
	});
});

describe('a knock below crash speed', () => {
	it('crushes within a fifth of the budget and moves the car by a quarter of the rest, flat and without friction', () => {
		const s = createCrashSim(makeSpec(), { attribs: { mass: 1500 } }).state;
		s.crashing = false;
		s.body.v = [0, 0, 30];
		clearContacts(s);
		const n = normalize([0, 0.3, -1]);
		const arm: Vec3 = [0, 0, 2];
		const pA = add(s.body.pos, arm);
		s.records[0] = { pA, pB: pA, n, t: 0, surface: 'obstacle' };
		applyContactImpulses(s, DT);
		const c = s.events.contacts[0];
		const k = 1 / 1500 + dot(n, cross(mulMat(s.body.invIWorld, cross(arm, n)), arm));
		expect(c.impulse).toBeCloseTo(0.5 * 30 * -n[2] / k, 6);
		// Level 0 would absorb 98 %; a knock absorbs at most 20 %. The +Y share
		// is dropped, the -Z share arrives at a quarter, on a lever along -Z.
		const rest = 0.8 * c.impulse * -n[2];
		close(s.body.v, [0, 0, 30 - 0.25 * rest / 1500]);
		close(s.body.w, [0, 0, 0]);
		expect(s.counters.numWorldCollisions).toBe(2);   // one arrival per crush direction
		expect(c.scratch).toBeGreaterThan(0);            // it still slides up the wall
		drain(s.body, DT);
		close(s.body.v, [0, 0, 30 - 0.25 * rest / 1500]);
	});
});
