// The absorption table follows the crash, step by step: normal while the car
// is not crashing, then by who drives and how fast the crash began.

import { describe, expect, it } from 'vitest';
import type { ParsedDeformationSpec, Vec3 } from '../../deformationSpec';
import { hasFixture, loadCar, syntheticParams } from '../../vehicleSim/__tests__/carFixture';
import { createVehicle } from '../../vehicleSim/vehicleState';
import { absorptionSetFor, type Driver } from '../absorption';
import { applyImpact, createCrashSim, stepCrashSim } from '../sim';
import { AbsorptionSet } from '../tables';

function vehicle(crashing: boolean, crashMph = 0) {
	const v = createVehicle(syntheticParams());
	v.crashing = crashing;
	v.speedOnLastCrashMph = crashMph;
	return v;
}

describe('absorption table', () => {
	it('is the normal one for any car that is not crashing', () => {
		for (const d of ['player', 'rival', 'rivalFreeRoam'] as Driver[]) {
			expect(absorptionSetFor(d, vehicle(false, 500))).toBe(AbsorptionSet.Normal);
		}
	});

	it("is the extreme one for the player's crash begun within 5 mph of top speed", () => {
		const top = syntheticParams().base.maxSpeedMph;
		expect(absorptionSetFor('player', vehicle(true, top - 5))).toBe(AbsorptionSet.Normal);
		expect(absorptionSetFor('player', vehicle(true, top - 4.9))).toBe(AbsorptionSet.PlayerExtremeCrash);
	});

	it("is the rival one for a rival's crash in an event, the shut-down one outside", () => {
		expect(absorptionSetFor('rival', vehicle(true, 10))).toBe(AbsorptionSet.AiCrashing);
		expect(absorptionSetFor('rivalFreeRoam', vehicle(true, 10))).toBe(AbsorptionSet.Shutdown);
	});
});

function noseHit(spec: ParsedDeformationSpec) {
	const sh = spec.carModelSpaceToHandlingBodySpace[3];
	const front = Math.max(...spec.tagPoints.map((t) => t.initialPosition[2]));
	return { pointMesh: [-sh[0], 0.5 - sh[1], front - sh[2]] as Vec3, direction: [0, 0, -1] as Vec3 };
}

function wallRun(car: string, kmh: number, driver: Driver) {
	const { spec, vault } = loadCar(car);
	const sim = createCrashSim(spec, { vault, driver });
	applyImpact(sim, { ...noseHit(spec), speed: kmh / 3.6 });
	for (let i = 0; i < 60 * 12 && !sim.state.run!.end; i++) stepCrashSim(sim);
	const crush = Math.max(...sim.state.sensors.map((c, i) => Math.hypot(...c.map((x, k) => x - spec.sensors[i].initialOffset[k]))));
	return { sim, crush };
}

describe.skipIf(!hasFixture('PUSMC01'))('PUSMC01 (top speed 105 mph) into a wall', () => {
	it('crushes far deeper at 180 km/h, a crash begun near top speed', () => {
		const { sim, crush } = wallRun('PUSMC01', 180, 'player');
		expect(sim.state.run!.crash).toBe('headOn');
		expect(sim.state.run!.absorption).toBe(AbsorptionSet.PlayerExtremeCrash);
		// The normal table stops this crash at about 0.6 m.
		expect(crush).toBeGreaterThan(0.9);
		expect(crush).toBeLessThan(1.05);
	});

	it('dents a rival exactly like the player on a knock', () => {
		const player = wallRun('PUSMC01', 100, 'player'), rival = wallRun('PUSMC01', 100, 'rival');
		expect(rival.sim.state.run!.crash).toBe(null);
		expect(rival.sim.state.run!.absorption).toBe(AbsorptionSet.Normal);
		expect(Array.from(rival.sim.rows)).toEqual(Array.from(player.sim.rows));
	});
});
