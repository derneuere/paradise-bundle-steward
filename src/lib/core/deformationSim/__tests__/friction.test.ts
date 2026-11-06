import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../../deformationSpec';
import { drain, mulMat } from '../../vehicleSim/body';
import { applyImpact, createCrashSim, stepCrashSim } from '../sim';
import { applyContactFriction, CRASH_FORCE_ROW, slideAcross } from '../friction';
import { add, cross, dot, length, scale, sub } from '../state';
import { makeSim, makeSpec, stepUntilHit } from './fixture';

const DT = 1 / 60;
const N: Vec3 = [0, 0, 1];   // contact normal, out of the surface
const close = (a: readonly number[], b: readonly number[], digits = 9) => a.forEach((v, k) => expect(v).toBeCloseTo(b[k], digits));

const fresh = (crashing = true, mass = 1500) => makeSim({ crashing, mass }).state;

// One contact's friction at an arm r from the centre of mass, drained.
function rub(relVel: Vec3, magnitude: number, crashing = true, r: Vec3 = [0, 0.2, 2]) {
	const s = fresh(crashing);
	const b = s.body, v0 = b.v, w0 = b.w;
	const out = applyContactFriction(s, b, 0, relVel, N, magnitude, add(b.pos, r), DT);
	drain(b, DT);
	return { s, out, dv: sub(b.v, v0), dw: sub(b.w, w0) };
}

describe('slide friction', () => {
	it('takes the slide across the surface, without the along-normal part', () => {
		const { slide, speed } = slideAcross([3, 0, -10], N);
		expect(slide).toEqual([3, 0, 0]);
		expect(speed).toBe(3);
	});

	it('brakes the slide by an impulse and a force at the contact point, which also turn the car', () => {
		// 2 m/s slide, 10 000 N·s contact: 10 000 x 1 x 5 / 60 = 833.3 N·s, plus
		// 2 x 1500 x 0.9 = 2700 N for one step (45 N·s), all against the slide.
		const { s, out, dv, dw } = rub([2, 0, -10], 10000);
		const along = 10000 * 5 * DT + 2 * 1500 * CRASH_FORCE_ROW * DT;
		expect(along).toBeCloseTo(878.333, 3);
		close(dv, [-along / 1500, 0, 0]);
		expect(dv[0]).toBeCloseTo(-0.5856, 4);
		close(dw, mulMat(s.body.invIWorld, cross([0, 0.2, 2], [-along, 0, 0])));
		close(out.slide, [2, 0, 0]);
		// 2 x (1/60) x 1.5e-4 x min(10 000, 1000) x 5
		expect(out.scratch).toBeCloseTo(0.025, 12);
		expect(s.scratch[0]).toBeCloseTo(0.025, 12);
	});

	it('scales the impulse by the slide speed below 1 m/s', () => {
		const { dv } = rub([0, 0.5, -10], 3000, true, [0, 0, 0]);
		expect(dv[1]).toBeCloseTo(-(3000 * 0.5 * 5 * DT / 1500 + 0.9 * 0.5 * DT), 12);
	});

	it('leaves a knock sliding freely (but scratched), and a head-on contact or a slide under 1 cm/s alone', () => {
		const knock = rub([3, 0, -10], 400, false);
		close(knock.dv, [0, 0, 0]);
		close(knock.dw, [0, 0, 0]);
		expect(knock.out.scratch).toBeGreaterThan(0);
		close(rub([0, 0, -20], 400).dv, [0, 0, 0]);
		close(rub([0.0099, 0, -10], 400).dv, [0, 0, 0]);
		expect(rub([0.0101, 0, -10], 400).dv[0]).toBeLessThan(0);
	});
});

describe('scraping along a wall', () => {
	// The wall is turned 40° off the car's travel; the car's speed along it,
	// from the step it first touches on.
	const scrape = (forceCrash: boolean) => {
		const sim = createCrashSim(makeSpec());
		applyImpact(sim, { pointMesh: [0, 0.5, 2.4], direction: [0, 0, -1], speed: 30, glance: 40, forceCrash });
		stepUntilHit(sim);
		const n = sim.state.obstacle!.normal;
		const along = () => { const v = sim.state.body.v; return length(sub(v, scale(n, dot(v, n)))); };
		const speeds = [along()];
		for (let i = 0; i < 60; i++) { stepCrashSim(sim); speeds.push(along()); }
		return { sim, speeds };
	};

	it('slows a crashing car sliding along the wall far faster than a knock', () => {
		const crash = scrape(true), knock = scrape(false);
		expect(crash.sim.state.vehicle.crashing).toBe(true);
		expect(knock.sim.state.vehicle.crashing).toBe(false);
		expect(crash.speeds[30]).toBeLessThan(knock.speeds[30] * 0.8);
	});

	it('lets a knock slide on', () => {
		const { speeds } = scrape(false);
		expect(speeds[10]).toBeGreaterThan(speeds[0] * 0.8);
	});
});
