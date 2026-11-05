// Whole-car driving on flat ground: settling on the springs, freezing,
// coasting, top speed and braking. The retail cars run when their fixtures are
// present; the synthetic coupe always runs.

import { beforeAll, describe, expect, it } from 'vitest';
import { dot } from '../../deformationSim/state';
import { flatGround } from '../ground';
import type { VehicleParams } from '../params';
import { stepVehicle, DT } from '../step';
import { resetVehicle } from '../vehicle';
import { createVehicle, MPS_TO_MPH, NO_INPUT, type Controls, type VehicleState } from '../vehicleState';
import { hasFixture, loadCar, syntheticParams } from './carFixture';

const world = flatGround(0);
const fwd = (v: VehicleState) => dot(v.body.v, v.body.axes[2]);
const pitchDeg = (v: VehicleState) => Math.asin(v.body.axes[2][1]) * (180 / Math.PI);
const headingDeg = (v: VehicleState) => Math.atan2(v.body.axes[2][0], v.body.axes[2][2]) * (180 / Math.PI);
const run = (v: VehicleState, steps: number, ctl: Controls = NO_INPUT) => { for (let i = 0; i < steps; i++) stepVehicle(v, world, DT, ctl); };

// Where the springs hold the car at rest: every hub at its streamed height,
// one tyre radius above the road, solved for height and pitch.
function restPose(p: VehicleParams) {
	const [f, , r] = [p.wheels[0], p.wheels[1], p.wheels[2]];
	let th = 0;
	for (let i = 0; i < 20; i++) {
		const g = (f.streamed[1] - r.streamed[1]) * Math.cos(th) + (f.streamed[2] - r.streamed[2]) * Math.sin(th) - (f.radius - r.radius);
		const dg = -(f.streamed[1] - r.streamed[1]) * Math.sin(th) + (f.streamed[2] - r.streamed[2]) * Math.cos(th);
		th -= g / dg;
	}
	return { y: f.radius - f.streamed[1] * Math.cos(th) - f.streamed[2] * Math.sin(th), pitchDeg: th * (180 / Math.PI) };
}

// A car settled on its springs and frozen, as a start line would leave it.
function parked(p: VehicleParams): VehicleState {
	const v = createVehicle(p, [0, restPose(p).y, 0]);
	resetVehicle(v, [0, 0, 0]);
	run(v, 90);
	return v;
}

function driveSuite(name: string, getParams: () => VehicleParams, topGear: number) {
	describe(name, () => {
		let p: VehicleParams;
		beforeAll(() => { p = getParams(); });

		it('settles from a 5 cm drop and freezes after a second of quiet', () => {
			const v = createVehicle(p, [0, restPose(p).y + 0.05, 0]);
			resetVehicle(v, [0, 0, 0]);
			let frozenAt = -1;
			for (let i = 0; i < 120; i++) {
				stepVehicle(v, world, DT, NO_INPUT);
				if (v.frozen && frozenAt < 0) frozenAt = (i + 1) * DT;
			}
			// The springs never let it move fast enough to count as awake.
			expect(frozenAt).toBeGreaterThan(0.99);
			expect(frozenAt).toBeLessThan(1.05);
			expect(v.body.v).toEqual([0, 0, 0]);
			expect(v.body.w).toEqual([0, 0, 0]);
			expect(Math.abs(v.body.pos[1] - restPose(p).y)).toBeLessThan(0.02);
		});

		it('comes to rest on its springs at the static ride height when kept awake', () => {
			const v = createVehicle(p, [0, restPose(p).y + 0.05, 0]);
			resetVehicle(v, [0, 0, 0]);
			for (let i = 0; i < 240; i++) { v.coolDown = 0; stepVehicle(v, world, DT, NO_INPUT); }
			const rest = restPose(p);
			expect(Math.abs(v.body.pos[1] - rest.y)).toBeLessThan(0.002);
			expect(Math.abs(pitchDeg(v) - rest.pitchDeg)).toBeLessThan(0.1);
			expect(Math.hypot(...v.body.w)).toBeLessThan(1e-3);
			v.wheels.forEach((w) => expect(w.hasTraction).toBe(true));
		});

		// A car that rests nose-down has its springs pushing it forward a little;
		// on the first steps that beats the tyres' freewheel drag, which takes a
		// few steps to build.
		it('coasts in a straight line, slowing every step once the tyres bite', () => {
			const v = parked(p);
			resetVehicle(v, [0, 0, 20]);
			run(v, 5);
			const h0 = headingDeg(v);
			const ground = () => Math.hypot(v.body.v[0], v.body.v[2]);
			let prev = ground(), maxLat = 0;
			for (let i = 0; i < 300; i++) {
				stepVehicle(v, world, DT, NO_INPUT);
				expect(ground()).toBeLessThan(prev);
				prev = ground();
				maxLat = Math.max(maxLat, Math.abs(dot(v.body.v, v.body.axes[0])));
			}
			expect(Math.abs(headingDeg(v) - h0)).toBeLessThan(0.1);
			expect(maxLat).toBeLessThan(0.01);
			expect(fwd(v)).toBeLessThan(15);
		});

		it('runs up to MaxSpeed, shifting up one gear at a time, and holds it there', () => {
			const v = parked(p);
			resetVehicle(v, [0, 0, 30]);
			const gears = [v.engine.gear];
			let reached = -1;
			for (let i = 0; i < 60 * 60 && reached < 0; i++) {
				stepVehicle(v, world, DT, { ...NO_INPUT, gas: 1 });
				if (v.engine.gear !== gears[gears.length - 1]) gears.push(v.engine.gear);
				if (fwd(v) * MPS_TO_MPH >= p.base.maxSpeedMph) reached = i;
			}
			expect(reached).toBeGreaterThan(0);
			gears.slice(1).forEach((g, i) => expect(g).toBe(gears[i] + 1));
			expect(gears[gears.length - 1]).toBe(topGear);
			let lo = Infinity, hi = -Infinity;
			for (let i = 0; i < 600; i++) {
				stepVehicle(v, world, DT, { ...NO_INPUT, gas: 1 });
				const mph = fwd(v) * MPS_TO_MPH;
				lo = Math.min(lo, mph); hi = Math.max(hi, mph);
			}
			expect(lo).toBeGreaterThan(p.base.maxSpeedMph - 0.5);
			expect(hi).toBeLessThan(p.base.maxSpeedMph + 0.5);
		});

		it('brakes from 100 km/h in a straight line, harder than the magic brake alone', () => {
			const v = parked(p);
			const v0 = 100 / 3.6;
			resetVehicle(v, [0, 0, v0]);
			let t = 0;
			while (fwd(v) > 0.05 && t < 10) { stepVehicle(v, world, DT, { ...NO_INPUT, brake: 1 }); t += DT; }
			const dist = v.body.pos[2];
			// The magic brake alone decelerates at about MagicBrakeStraight times
			// the brake curve's start (g-free: it is a force of factor*mass*5).
			const magicOnly = (v0 * v0) / (2 * p.base.magicBrakeStraight * p.base.brakeCurve[0]);
			expect(dist).toBeLessThan(magicOnly);
			expect(dist).toBeGreaterThan(magicOnly * 0.5);
			expect(Math.abs(v.body.pos[0])).toBeLessThan(0.01);
		});
	});
}

driveSuite('synthetic coupe', syntheticParams, 5);
describe.skipIf(!hasFixture('PUSSC01'))('PUSSC01 driving', () => driveSuite('retail coupe', () => loadCar('PUSSC01').params, 5));
describe.skipIf(!hasFixture('PUSMC01'))('PUSMC01 driving', () => driveSuite('retail muscle car', () => loadCar('PUSMC01').params, 5));
