import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../../deformationSpec';
import { applyImpact, createCrashSim, resetCrashSim, stepCrashSim } from '../sim';
import { drivenScratch, scratchSensor, tagScratch } from '../scratch';
import { updateSkinRows } from '../ik';
import { makeSpec } from './fixture';

const DT = 1 / 60;
const N: Vec3 = [0, 0, 1];   // contact normal, out of the obstacle

function fresh(crashing = true) {
	const sim = createCrashSim(makeSpec());
	sim.state.crashing = crashing;
	return sim.state;
}

describe('sensor scratch', () => {
	it('leaves none for a head-on contact', () => {
		const s = fresh();
		expect(scratchSensor(s, 0, [0, 0, -20], N, 400, DT)).toBe(0);
		expect(s.scratch[0]).toBe(0);
	});

	it('adds slide speed x dt x 1.5e-4 x impulse, five times over in a crash', () => {
		const s = fresh();
		scratchSensor(s, 0, [3, 0, -10], N, 400, DT);
		expect(s.scratch[0]).toBeCloseTo(3 * DT * 1.5e-4 * 400 * 5, 12);
		const knock = fresh(false);
		scratchSensor(knock, 0, [3, 0, -10], N, 400, DT);
		expect(knock.scratch[0]).toBeCloseTo(3 * DT * 1.5e-4 * 400, 12);
	});

	it('scales the impulse by the slide speed below 1 m/s and caps it at 1000', () => {
		const slow = fresh(false);
		scratchSensor(slow, 0, [0.5, 0, -10], N, 400, DT);
		expect(slow.scratch[0]).toBeCloseTo(0.5 * DT * 1.5e-4 * 400 * 0.5, 12);
		const hard = fresh(false);
		scratchSensor(hard, 0, [3, 0, -10], N, 5000, DT);
		expect(hard.scratch[0]).toBeCloseTo(3 * DT * 1.5e-4 * 1000, 12);
	});

	it('ignores slides slower than 1 cm/s', () => {
		const s = fresh();
		expect(scratchSensor(s, 0, [0.0099, 0, -10], N, 1000, DT)).toBe(0);
		expect(scratchSensor(s, 0, [0.0101, 0, -10], N, 1000, DT)).toBeGreaterThan(0);
	});

	it('saturates at 0.75 and keeps a value already past it', () => {
		const s = fresh();
		for (let i = 0; i < 200; i++) scratchSensor(s, 0, [30, 0, -10], N, 1000, DT);
		expect(s.scratch[0]).toBe(0.75);
		s.scratch[1] = 0.9;
		scratchSensor(s, 1, [30, 0, -10], N, 1000, DT);
		expect(s.scratch[1]).toBe(0.9);
	});
});

describe('scratch on points and rows', () => {
	it('blends tags by their scalar weights and driven points by their place between two tags', () => {
		const s = fresh();
		s.scratch[0] = 0.4;
		s.scratch[1] = 0.2;
		const t = s.spec.tagPoints[0];
		Object.assign(t, { deformationSensorB: 1, fWeightA: 0.25, fWeightB: 0.75 });
		expect(tagScratch(s, 0)).toBeCloseTo(0.4 * 0.25 + 0.2 * 0.75, 12);
		// Driven point 0 hangs between tags 0 and 1 (sensor 1 only).
		const d = s.spec.drivenPoints[0];
		d.distanceFromA = 1;
		d.distanceFromB = 3;
		expect(drivenScratch(s, 0)).toBeCloseTo(0.75 * tagScratch(s, 0) + 0.25 * 0.2, 12);
	});

	it('carries tag and driven scratch in the rows\' w lane', () => {
		const s = fresh();
		s.scratch[0] = 0.5;
		updateSkinRows(s);
		expect(s.rows[0 * 4 + 3]).toBeCloseTo(0.5, 6);    // tag 0 (sensor 0)
		expect(s.rows[1 * 4 + 3]).toBe(0);                 // tag 1 (sensor 1)
		expect(s.rows[5 * 4 + 3]).toBeCloseTo(0.25, 6);   // driven point: halfway between tags 0 and 1
	});
});

describe('glancing hits', () => {
	const run = (glance: number) => {
		const sim = createCrashSim(makeSpec(), { attribs: { mass: 1500 } });
		applyImpact(sim, { pointMesh: [0, 0.5, 2.4], direction: [0, 0, -1], speed: 30, glance });
		for (let i = 0; i < 120; i++) stepCrashSim(sim);
		return sim;
	};

	it('turns the travel by the glance angle across the hit direction', () => {
		const sim = createCrashSim(makeSpec(), { attribs: { crashExtraLinearVelocity: 0 } });
		applyImpact(sim, { pointMesh: [0, 0.5, 2.4], direction: [0, 0, -1], speed: 10, glance: 30 });
		const [x, y, z] = sim.state.carVel;
		expect(Math.hypot(x, y, z)).toBeCloseTo(10, 9);
		expect(z).toBeCloseTo(10 * Math.cos(Math.PI / 6), 9);
		expect(Math.abs(x)).toBeCloseTo(5, 9);
		expect(y).toBeCloseTo(0, 9);
	});

	it('scratches the nose sliding along a wall but not driving straight into it', () => {
		expect(run(0).state.scratch[0]).toBe(0);
		const glancing = run(40);
		expect(glancing.state.scratch[0]).toBeGreaterThan(0);
		expect(glancing.rows[3]).toBeGreaterThan(0);
		resetCrashSim(glancing);
		expect(glancing.state.scratch.every((v) => v === 0)).toBe(true);
	});
});
