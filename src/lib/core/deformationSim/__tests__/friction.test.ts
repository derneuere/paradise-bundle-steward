import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../../deformationSpec';
import { applyImpact, createCrashSim, stepCrashSim } from '../sim';
import { CRASH_FORCE_ROW, slideAcross, slideFriction, WORLD_CRASH_IMPULSE_ROW } from '../friction';
import { makeSpec } from './fixture';

const DT = 1 / 60;
const N: Vec3 = [0, 0, 1];   // contact normal, out of the obstacle
const len = (v: Vec3) => Math.hypot(v[0], v[1], v[2]);

function fresh(crashing = true, mass = 1500) {
	const sim = createCrashSim(makeSpec(), { attribs: { mass } });
	sim.state.crashing = crashing;
	return sim.state;
}

describe('slide friction', () => {
	it('takes the slide across the surface, without the along-normal part', () => {
		const { slide, speed } = slideAcross([3, 0, -10], N);
		expect(slide).toEqual([3, 0, 0]);
		expect(speed).toBe(3);
	});

	it('brakes the slide by impulse x 5 x dt plus 0.9 x slide x dt', () => {
		const dv = slideFriction(fresh(), slideAcross([3, 0, -10], N), 400, DT);
		expect(dv[0]).toBeCloseTo(-(400 * WORLD_CRASH_IMPULSE_ROW * DT / 1500 + CRASH_FORCE_ROW * 3 * DT), 12);
		expect(dv[1]).toBe(-0);
		expect(dv[2]).toBe(-0);
	});

	it('scales the impulse by the slide speed below 1 m/s', () => {
		const dv = slideFriction(fresh(), slideAcross([0, 0.5, -10], N), 3000, DT);
		expect(dv[1]).toBeCloseTo(-(3000 * 0.5 * 5 * DT / 1500 + 0.9 * 0.5 * DT), 12);
	});

	it('leaves a knock, a head-on contact and a slide under 1 cm/s alone', () => {
		expect(len(slideFriction(fresh(false), slideAcross([3, 0, -10], N), 400, DT))).toBe(0);
		expect(len(slideFriction(fresh(), slideAcross([0, 0, -20], N), 400, DT))).toBe(0);
		expect(len(slideFriction(fresh(), slideAcross([0.0099, 0, -10], N), 400, DT))).toBe(0);
		expect(len(slideFriction(fresh(), slideAcross([0.0101, 0, -10], N), 400, DT))).toBeGreaterThan(0);
	});
});

describe('scraping along a wall', () => {
	const scrape = (crash: boolean) => {
		const sim = createCrashSim(makeSpec(), { attribs: { mass: 1500, crashExtraLinearVelocity: 0 } });
		applyImpact(sim, { pointMesh: [0, 0.5, 2.4], direction: [0, 0, -1], speed: 30, glance: 40, crash });
		const across: number[] = [];
		for (let i = 0; i < 180; i++) { stepCrashSim(sim); across.push(Math.abs(sim.state.carVel[0])); }
		return across;
	};

	it('slows a crashing car sliding along the wall until the slide is under 1 cm/s', () => {
		const across = scrape(true);
		const start = 30 * Math.sin((40 * Math.PI) / 180);
		// The fixture's nose grinds on (it passes almost nothing to the body),
		// so the contact impulse stays big and brakes far harder than the
		// 0.9/s force alone would.
		expect(across[0]).toBeLessThan(start * Math.exp(-CRASH_FORCE_ROW * DT));
		for (let i = 1; across[i - 1] >= 0.01; i++) expect(across[i]).toBeLessThan(across[i - 1]);
		// Fast enough to throw sparks (15 mph) for a fraction of the 3 s contact cap.
		expect(across.findIndex((v) => v < 6.7)).toBeLessThan(20);
		expect(Math.max(...across.slice(40))).toBeLessThan(0.01);
	});

	it('lets a knock slide on', () => {
		const across = scrape(false);
		expect(across[119]).toBeCloseTo(30 * Math.sin((40 * Math.PI) / 180), 6);
	});
});

describe('a straight hit', () => {
	// Two sensors side by side across the nose, so the first contact's
	// off-centre impulse spins the solver before the second one is solved.
	function twinNose() {
		const spec = makeSpec();
		spec.sensors[0] = { ...spec.sensors[0], initialOffset: [-0.6, 0.5, 2], nextSensor: [0, 0, 0, 0, 0, 0] };
		spec.sensors[1] = { ...spec.sensors[0], initialOffset: [0.6, 0.5, 2] };
		return spec;
	}

	it('neither scratches nor brakes sideways', () => {
		const sim = createCrashSim(twinNose(), { attribs: { mass: 1500 } });
		applyImpact(sim, { pointMesh: [0, 0.5, 2.4], direction: [0, 0, -1], speed: 200 / 3.6 });
		let contacts = 0;
		for (let i = 0; i < 60; i++) {
			stepCrashSim(sim);
			contacts += sim.events.contacts.length;
			for (const c of sim.events.contacts) expect(len(c.slide)).toBe(0);
		}
		expect(contacts).toBeGreaterThan(1);
		expect(sim.state.scratch[0]).toBe(0);
		expect(sim.state.scratch[1]).toBe(0);
	});
});
