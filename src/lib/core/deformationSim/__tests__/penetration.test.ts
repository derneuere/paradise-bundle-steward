import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../../deformationSpec';
import { translate } from '../../vehicleSim/body';
import { generateContacts, latchContacts } from '../contacts';
import { cullStoredContacts, solvePenetration } from '../penetration';
import { createCrashSim } from '../sim';
import type { StoredContact } from '../state';
import { makeSpec } from './fixture';

const stored = (B: Vec3, n: Vec3, projDist: number): StoredContact => ({ localA: [0, 0, 0], B, n, projDist });

describe('penetration solve', () => {
	// Sensor 0's front is 0.6 m short of a wall at z = 3, sensor 1's 0.8 m;
	// the car is high above the ground.
	function nearWall() {
		const spec = makeSpec();
		spec.sensors[1] = { ...spec.sensors[1], initialOffset: [0, 0.5, 1.8] };
		const s = createCrashSim(spec).state;
		translate(s.body, [0, 10, 0]);
		s.obstacle = { kind: 'wall', point: [0, 10, 3], normal: [0, 0, 1], poleAxis: [0, 1, 0], poleRadius: 0.15 };
		generateContacts(s);
		latchContacts(s, 1 / 60);
		return s;
	}

	it('pushes the car out by the deepest overlap along the normal and leaves its velocity alone', () => {
		const s = nearWall();
		s.body.v = [0, 0, 7];
		translate(s.body, [0, 0, 0.9]);     // overlaps of 0.3 (sensor 0) and 0.1 (sensor 1)
		const before = s.body.pos[2];
		solvePenetration(s);
		expect(s.body.pos[2]).toBeCloseTo(before - 0.3, 12);
		expect(s.body.v).toEqual([0, 0, 7]);
	});

	it('asks for less push-out from a sensor that dented this step', () => {
		const s = nearWall();
		translate(s.body, [0, 0, 0.9]);
		s.sensors[0] = [0, 0.5, 1.85];          // 0.15 m crushed back
		const before = s.body.pos[2];
		solvePenetration(s);
		expect(s.body.pos[2]).toBeCloseTo(before - 0.15, 12);
	});

	it('pushes nothing for contacts that are still apart', () => {
		const s = nearWall();
		const before = [...s.body.pos];
		solvePenetration(s);
		expect(s.body.pos).toEqual(before);
	});
});

describe('stored-contact cull', () => {
	it('drops a later contact lying behind an earlier one\'s surface', () => {
		expect(cullStoredContacts([stored([0, 0, 0], [0, 1, 0], -0.1), stored([0, -0.5, 0], [0, 1, 0], 0.2)])).toEqual([0]);
	});

	it('drops an earlier contact when a closer later one lies in front of it', () => {
		expect(cullStoredContacts([stored([0, -0.5, 0], [0, 1, 0], 0.2), stored([0, 0, 0], [0, 1, 0], -0.1)])).toEqual([1]);
	});

	it('keeps contacts on surfaces at an angle (floor and wall)', () => {
		expect(cullStoredContacts([stored([0, 0, 0], [0, 1, 0], -0.1), stored([1, 0.5, 0], [-1, 0, 0], -0.1)])).toEqual([0, 1]);
	});
});
