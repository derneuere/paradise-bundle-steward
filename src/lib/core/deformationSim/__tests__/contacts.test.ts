// The per-contact impulse pipeline: each latched contact is sized from the
// body's live velocity, only the sensors' unabsorbed remainder (and the slide
// friction) reaches the body, at the contact point, and the body is drained
// after every contact. The numbers are worked by hand at m = 1500, 30 m/s,
// dt = 1/60, crashing, normal absorption set, no sensor chain, contact arm
// parallel to the normal (so the effective mass is the mass).

import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../../deformationSpec';
import { drain, mulMat } from '../../vehicleSim/body';
import { createCrashSim } from '../sim';
import {
	applyContactImpulses, clearContacts, generateContacts, latchContacts, nearestSensors, rowBefore, sortContactRows,
	hubSphere, validateAndAddContact, type ContactRow,
} from '../contacts';
import { add, cross, dot, normalize, sub, type ImpulseRecord, type SimState } from '../state';
import { makeSim, makeSpec } from './fixture';

const DT = 1 / 60;
const NOSE_IN: Vec3 = [0, 0, -1];   // out of the wall, toward a car driving +Z

// The first `levels.length` sensors all sit on the nose with no chains.
function nose(levels: number[]) {
	const spec = makeSpec();
	levels.forEach((absorbtionLevel, i) => {
		spec.sensors[i] = { ...spec.sensors[0], initialOffset: [0, 0.5, 2], nextSensor: [0, 0, 0, 0, 0, 0], absorbtionLevel };
	});
	const s = makeSim({ spec, mass: 1500 }).state;
	s.body.v = [0, 0, 30];
	clearContacts(s);
	return s;
}

const record = (s: SimState, arm: Vec3, n: Vec3 = NOSE_IN): ImpulseRecord => {
	const p = add(s.body.pos, arm);
	return { pA: p, pB: p, n, t: 0, surface: 'obstacle' };
};

describe('one contact', () => {
	it('level 0: half the inelastic impulse, 98 % absorbed, the rest slows the body', () => {
		const s = nose([0]);
		s.records[0] = record(s, [0, 0, 2]);
		applyContactImpulses(s, DT);
		expect(s.events.contacts[0].impulse).toBeCloseTo(22500, 6);
		expect(s.body.v[2]).toBeCloseTo(30 - 450 / 1500, 9);
		expect(2 - s.sensors[0][2]).toBeCloseTo(22050 / 1500 / 60, 9);   // 0.245 m, inside the 0.3 m budget
	});

	it('level 5: the absorption grows with the closing speed', () => {
		const s = nose([5]);
		s.records[0] = record(s, [0, 0, 2]);
		applyContactImpulses(s, DT);
		// base = 0.5 x 0.4 + 0.5 x 0.6 x 30/80 = 0.3125
		expect(s.body.v[2]).toBeCloseTo(30 - 15468.75 / 1500, 9);
		expect(2 - s.sensors[0][2]).toBeCloseTo(7031.25 / 1500 / 60, 9);
	});

	it('turns the car by the remainder at the contact point, and sizes the impulse with the full effective mass', () => {
		const s = makeSim({ mass: 1500 }).state;
		s.body.v = [0, 0, 30];
		clearContacts(s);
		const r: Vec3 = [0, 0.2, 2];
		s.records[0] = record(s, r);
		applyContactImpulses(s, DT);
		const k = 1 / 1500 + s.body.invILocal[0] * 0.04;
		const magnitude = 0.5 * 30 / k;
		expect(s.events.contacts[0].impulse).toBeCloseTo(magnitude, 6);
		// Level 0 and a chain that ends at the body: 2 % of it arrives, along -Z.
		const J: Vec3 = [0, 0, -0.02 * magnitude];
		expect(s.body.v[2]).toBeCloseTo(30 + J[2] / 1500, 9);
		const w = mulMat(s.body.invIWorld, cross(r, J));
		s.body.w.forEach((x, i) => expect(x).toBeCloseTo(w[i], 12));
		expect(s.vehicle.numWorldCollisions).toBe(1);
	});
});

describe('two contacts in one step', () => {
	it('sizes the second from the velocity the first left (level 5)', () => {
		const s = nose([5, 5]);
		s.records[0] = record(s, [0, 0, 2]);
		s.records[1] = record(s, [0, 0, 2]);
		applyContactImpulses(s, DT);
		const [a, b] = s.events.contacts;
		expect(a.impulse).toBeCloseTo(22500, 6);
		expect(b.closingSpeed).toBeCloseTo(19.6875, 9);
		expect(b.impulse).toBeCloseTo(14765.625, 6);   // not 11 250: the full first impulse never reached the body
		// base = 0.2 + 0.3 x 19.6875/80; the remainder 10 722.38 N·s arrives.
		expect(s.body.v[2]).toBeCloseTo(12.539, 3);
	});

	it('crushes the second sensor from the live velocity too (level 0)', () => {
		const s = nose([0, 0]);
		s.records[0] = record(s, [0, 0, 2]);
		s.records[1] = record(s, [0, 0, 2]);
		applyContactImpulses(s, DT);
		expect(s.events.contacts[1].impulse).toBeCloseTo(22275, 6);
		expect(2 - s.sensors[1][2]).toBeCloseTo(21829.5 / 1500 / 60, 9);   // 0.2426 m
		expect(s.body.v[2]).toBeCloseTo(29.403, 3);
	});

	it('skips a contact the earlier ones have left separating: no latch, no crush, no impulse', () => {
		// Contact 1 sits off-centre (x = 1), so its remainder spins the car;
		// contact 2's point, across the nose, is then carried away from its
		// surface, although the car's own velocity still closes on it.
		const s = nose([9, 9]);
		const n2 = normalize([0.9, 0, -0.3]);
		s.records[0] = record(s, [1, 0, 2]);
		s.records[1] = record(s, [-1, 0, 2], n2);
		expect(s.body.v[2] * n2[2]).toBeLessThan(0);
		applyContactImpulses(s, DT);
		expect(s.events.contacts.map((c) => c.sensor)).toEqual([0]);
		expect(s.latch[1]).toBe(0);
		expect(s.sensors[1]).toEqual([0, 0.5, 2]);
		expect(s.vehicle.numWorldCollisions).toBe(1);
	});
});

describe('contact order', () => {
	it('rotates a row that belongs before the first straight to the front', () => {
		const A: ContactRow = { t: 0, key: 0, sensor: 0 };
		const B: ContactRow = { t: 0.15, key: -2, sensor: 1 };
		const C: ContactRow = { t: 0.08, key: -1, sensor: 2 };
		expect(rowBefore(C, A)).toBe(true);
		expect(rowBefore(C, B)).toBe(false);
		expect(sortContactRows([A, B, C]).map((r) => r.sensor)).toEqual([2, 0, 1]);
		// A plain insertion sort stops at B and leaves C last.
		const plain = [A, B, C];
		for (let i = 1; i < plain.length; i++) {
			const c = plain[i];
			let j = i - 1;
			while (j >= 0 && rowBefore(c, plain[j])) { plain[j + 1] = plain[j]; j--; }
			plain[j + 1] = c;
		}
		expect(plain.map((r) => r.sensor)).toEqual([0, 1, 2]);
	});

	it('orders contacts more than a tenth of a step apart by time, closer ones most head-on first', () => {
		const rows: ContactRow[] = [{ t: 0.5, key: -1, sensor: 0 }, { t: 0.1, key: 0, sensor: 1 }, { t: 0.15, key: -0.5, sensor: 2 }];
		expect(sortContactRows(rows).map((r) => r.sensor)).toEqual([2, 1, 0]);
		expect(rowBefore({ t: NaN, key: -1, sensor: 0 }, { t: 0, key: 0, sensor: 1 })).toBe(true);
	});
});

describe('generating and latching contacts', () => {
	it('routes each wheel hub to its nearest sensor', () => {
		const s = createCrashSim(makeSpec()).state;
		expect(nearestSensors(s)).toEqual([2, 3, 4, 5]);
		expect(s.wheelToSensor).toEqual([2, 3, 4, 5]);
	});

	it('finds the ground under every sphere within reach, sensors first, then the hubs', () => {
		const s = createCrashSim(makeSpec()).state;
		const c = generateContacts(s);
		expect(c.map((x) => x.sphere)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
		expect(c.every((x) => x.surface === 'ground' && x.n[1] === 1)).toBe(true);
		// The wheels carry the car: its spheres clear the ground.
		expect(Math.min(...c.map((x) => x.pA[1]))).toBeGreaterThan(0);
	});

	it("puts each hub sphere at the live wheel's x/z and its streamed height plus a quarter of the wheel scale", () => {
		const s = createCrashSim(makeSpec()).state;
		const w = s.vehicle.wheels[1];
		w.pos = [w.pos[0], w.pos[1] + 0.05, w.pos[2]];
		const h = hubSphere(s, 1);
		expect(h.radius).toBeCloseTo(0.15, 12);
		expect(h.local).toEqual([w.pos[0], s.vehicle.params.wheels[1].streamed[1] + 0.075, w.pos[2]]);
	});

	it('latches the earliest contact that closes within the step and stores the three closest', () => {
		const s = createCrashSim(makeSpec()).state;
		clearContacts(s);
		s.disp[0] = [0, 0, 0.6];
		const offer = (gap: number) => validateAndAddContact(s, 0, {
			sphere: 0, pA: [0, 0, 1], pB: [0, 0, 1 + gap], n: NOSE_IN, surface: 'obstacle',
		});
		offer(0.3);
		expect(s.records[0].t).toBeCloseTo(0.5, 12);
		offer(0.12);
		expect(s.records[0].t).toBeCloseTo(0.2, 12);
		offer(0.9);                                  // would close only after the step
		expect(s.records[0].t).toBeCloseTo(0.2, 12);
		offer(-0.1);                                 // already overlapping: closes at once
		expect(s.records[0].t).toBe(0);
		expect(s.stored[0].map((c) => c.projDist).sort((a, b) => a - b).map((x) => +x.toFixed(9))).toEqual([-0.7, -0.48, -0.3]);
	});

	it('neither latches a sensor moving away nor drops it from the store', () => {
		const s = createCrashSim(makeSpec()).state;
		clearContacts(s);
		s.disp[0] = [0, 0, -0.6];
		validateAndAddContact(s, 0, { sphere: 0, pA: [0, 0, 1], pB: [0, 0, 1.1], n: NOSE_IN, surface: 'obstacle' });
		expect(s.records[0].t).toBeGreaterThan(1);
		expect(s.stored[0]).toHaveLength(1);
	});

	it('takes each sensor centre\'s motion from the body velocity, spin included', () => {
		const s = makeSim().state;
		s.body.v = [0, -1, 6];
		s.body.w = [0, 2, 0];
		generateContacts(s);
		latchContacts(s, DT);
		const arm = sub(s.sensors[0], s.com);
		const want = add(s.body.v, cross(s.body.w, arm)).map((x) => x * DT);
		s.disp[0].forEach((x, i) => expect(x).toBeCloseTo(want[i], 12));
		// A wheel hub's ground contact is stored with its sensor's own.
		expect(s.stored[2]).toHaveLength(2);
	});
});

describe('a knock (not crashing)', () => {
	it('crushes within a fifth of the budget and moves the car by a quarter of the rest, flat and without friction', () => {
		const s = makeSim({ mass: 1500, crashing: false }).state;
		s.body.v = [0, 0, 30];
		clearContacts(s);
		const n = normalize([0, 0.3, -1]);
		const arm: Vec3 = [0, 0, 2];
		s.records[0] = record(s, arm, n);
		applyContactImpulses(s, DT);
		const c = s.events.contacts[0];
		const k = 1 / 1500 + dot(n, cross(mulMat(s.body.invIWorld, cross(arm, n)), arm));
		expect(c.impulse).toBeCloseTo(0.5 * 30 * -n[2] / k, 6);
		// Level 0 would absorb 98 %; a knock absorbs at most 20 %. The +Y share
		// is dropped, the -Z share arrives at a quarter, on a lever along -Z.
		const rest = 0.8 * c.impulse * -n[2];
		s.body.v.forEach((x, i) => expect(x).toBeCloseTo([0, 0, 30 - 0.25 * rest / 1500][i], 9));
		s.body.w.forEach((x) => expect(x).toBeCloseTo(0, 9));
		expect(s.vehicle.numWorldCollisions).toBe(2);   // one arrival per crush direction
		expect(s.vehicle.secondsSinceLastWallContact).toBe(0);
		expect(c.scratch).toBeGreaterThan(0);            // it still slides up the wall
		drain(s.body, DT);
		expect(s.body.v[2]).toBeCloseTo(30 - 0.25 * rest / 1500, 9);
	});
});
