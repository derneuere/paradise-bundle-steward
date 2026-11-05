// The whole simulation as one: the race car's own frame (vehicleSim) with the
// deformation model as its contact side. One body, one crashing flag, one set
// of counters; a car driving on its wheels never scrapes the road; a retail
// car driven into a wall at 180 km/h crashes head-on and comes to rest.

import { describe, expect, it } from 'vitest';
import type { ParsedAttribSys } from '../../attribSys';
import type { ParsedDeformationSpec, Vec3 } from '../../deformationSpec';
import { hasFixture, loadCar } from '../../vehicleSim/__tests__/carFixture';
import { flatGround } from '../../vehicleSim/ground';
import { stepVehicle } from '../../vehicleSim/step';
import { applyImpact, contactHooks, createCrashSim, resetCrashSim, stepCrashSim, type CrashSim } from '../sim';
import { makeSpec } from './fixture';

const finite = (sim: CrashSim) => [...sim.state.body.pos, ...sim.state.body.v, ...sim.state.body.w, ...sim.rows].every(Number.isFinite);

// A hit on the middle of the nose, mesh frame.
function noseHit(spec: ParsedDeformationSpec) {
	const sh = spec.carModelSpaceToHandlingBodySpace[3];
	const front = Math.max(...spec.tagPoints.map((t) => t.initialPosition[2]));
	return { pointMesh: [-sh[0], 0.5 - sh[1], front - sh[2]] as Vec3, direction: [0, 0, -1] as Vec3 };
}

// Started at `kmh` with the throttle pinned, the obstacle taken away, for
// `seconds`; dropped from `drop` metres above its rest height, so it lands
// on its wheels with the body's spheres moving at the road.
function cruise(spec: ParsedDeformationSpec, vault: ParsedAttribSys | undefined, kmh: number, seconds: number, drop = 0) {
	const sim = createCrashSim(spec, { vault });
	applyImpact(sim, { ...noseHit(spec), speed: kmh / 3.6 });
	sim.state.obstacle = null;
	sim.state.body.pos[1] += drop;
	const rest = sim.state.sensors.map((c) => [...c]);
	let groundContacts = 0, worldCollisions = 0;
	for (let i = 0; i < seconds * 60; i++) {
		stepCrashSim(sim);
		groundContacts += sim.events.contacts.length;
		worldCollisions += sim.state.vehicle.numWorldCollisions;
	}
	return { sim, rest, groundContacts, worldCollisions };
}

describe('one simulation', () => {
	it('drives the deformation sim with the vehicle\'s own body, crashing flag and counters', () => {
		const sim = createCrashSim(makeSpec());
		const same = () => expect(sim.state.body).toBe(sim.state.vehicle.body);
		same();
		applyImpact(sim, { pointMesh: [0, 0.5, 2.4], direction: [0, 0, -1], speed: 30, forceCrash: true });
		same();
		for (let i = 0; i < 40; i++) stepCrashSim(sim);
		same();
		expect(sim.state.vehicle.crashing).toBe(true);
		resetCrashSim(sim);
		same();
		expect(sim.state.vehicle.crashing).toBe(false);
	});

	it('hands the contact side empty body accumulators and a zeroed world-collision count', () => {
		const sim = createCrashSim(makeSpec());
		applyImpact(sim, { pointMesh: [0, 0.5, 2.4], direction: [0, 0, -1], speed: 30, forceCrash: true });
		const s = sim.state, hooks = contactHooks(s);
		let calls = 0;
		const wrapped = {
			...hooks,
			updateContacts: (v: typeof s.vehicle, dt: number) => {
				calls++;
				for (const acc of [v.body.F, v.body.Tq, v.body.J, v.body.L]) expect(acc).toEqual([0, 0, 0]);
				expect(v.numWorldCollisions).toBe(0);
				hooks.updateContacts!(v, dt);
			},
		};
		for (let i = 0; i < 120; i++) stepVehicle(s.vehicle, flatGround(0), 1 / 60, { gas: 1, brake: 0, handBrake: 0, steering: 0 }, wrapped, {});
		expect(calls).toBe(120);
	});

	it('cruises a toy car on its wheels without touching the road with its body', () => {
		const { sim, rest, groundContacts } = cruise(makeSpec(), undefined, 60, 3);
		expect(groundContacts).toBe(0);
		expect(sim.state.sensors).toEqual(rest);
		expect(sim.state.vehicle.crashing).toBe(false);
	});
});

describe.each(['PUSSC01', 'PUSMC01'])('%s on flat ground', (car) => {
	it.skipIf(!hasFixture(car))('drives 3 s at 60 km/h, landing from 30 cm, without a road contact reaching the sensors', () => {
		const { spec, vault } = loadCar(car);
		const { sim, rest, groundContacts, worldCollisions } = cruise(spec, vault, 60, 3, 0.3);
		expect(groundContacts).toBe(0);
		expect(worldCollisions).toBe(0);
		expect(sim.state.sensors).toEqual(rest);
		expect(Array.from(sim.rows).every((x) => x === 0)).toBe(true);
		expect(sim.state.free.size + sim.state.hinges.size).toBe(0);
		// Still driving straight on all four wheels.
		expect(sim.state.vehicle.wheels.every((w) => w.onGround)).toBe(true);
		expect(sim.state.body.v[2]).toBeGreaterThan(60 / 3.6);
	});
});

describe.skipIf(!hasFixture('PUSSC01'))('PUSSC01 into a wall at 180 km/h', () => {
	it('crashes head-on, crumples, and comes to rest within the crash clock', () => {
		const { spec, vault } = loadCar('PUSSC01');
		const sim = createCrashSim(spec, { vault });
		applyImpact(sim, { ...noseHit(spec), speed: 180 / 3.6 });
		const run = sim.state.run!;
		let crashedAt = -1;
		for (let i = 0; i < 60 * 12 && !run.end; i++) {
			stepCrashSim(sim);
			expect(finite(sim)).toBe(true);
			if (run.crash && crashedAt < 0) crashedAt = run.elapsed;
		}
		expect(run.crash).toBe('headOn');
		expect(run.closingSpeed).toBeGreaterThan(40.5);
		// The crash clock runs 4 to 11.5 s from the crash; the wreck freezes first.
		expect(run.end).toBe('frozen');
		expect(run.elapsed - crashedAt).toBeLessThan(11.5);
		expect(sim.state.body.v).toEqual([0, 0, 0]);
		expect(Math.max(...Array.from(sim.rows).map(Math.abs))).toBeGreaterThan(0.2);
		expect(sim.state.hinges.size + sim.state.free.size).toBeGreaterThan(0);
		// It ends on the ground, not in it.
		expect(sim.state.body.pos[1]).toBeGreaterThan(0.1);
	});
});
