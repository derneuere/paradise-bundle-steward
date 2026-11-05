// The vehicle's pieces one at a time: grip curve, gearbox, wheel spin rules,
// road finding, steering, aero, freezing and the handbrake latch.

import { describe, expect, it } from 'vitest';
import { downForce } from '../aero';
import { toWorld } from '../body';
import { bezier3, computeGear, engineReset, engineUpdate, maxWheelOmega, IDLE_FLYWHEEL, type EngineInput } from '../engine';
import { addTractionPoint, calculateWheelPlane, flatGround, resetWheelFlags, tractionLine } from '../ground';
import { steeredDirection, updateSteering } from '../steering';
import { applyFrictionReaction, gripCurve } from '../tyres';
import { updateFreezing, updateHandBrake, updateInAirStats } from '../vehicle';
import { wheelUpdateVelocity } from '../wheels';
import { createVehicle, NO_INPUT, type WheelState } from '../vehicleState';
import { syntheticParams } from './carFixture';

const close = (a: readonly number[], b: readonly number[], d = 9) => b.forEach((x, i) => expect(a[i]).toBeCloseTo(x, d));
const car = () => createVehicle(syntheticParams(), [0, 0.335, 0]);

describe('grip curve', () => {
	const c = { peakSlip: 0.2, floorSlip: 1, peakCo: 1.5, fallCo: 0.7 };
	it('ramps to the peak, blends to the fall value, then holds it; sign follows slip', () => {
		expect(gripCurve(c, 0.1)).toBeCloseTo(0.75, 12);
		expect(gripCurve(c, 0.2)).toBeCloseTo(1.5, 12);
		expect(gripCurve(c, 0.6)).toBeCloseTo(1.1, 12);
		expect(gripCurve(c, 5)).toBeCloseTo(0.7, 12);
		expect(gripCurve(c, -0.1)).toBeCloseTo(-0.75, 12);
		expect(gripCurve({ ...c, peakSlip: 0 }, 0)).toBe(1.5);
	});
});

describe('engine', () => {
	const e = syntheticParams().engine;
	it('evaluates the three-point curve', () => {
		expect(bezier3([195, 779.75, 0], 0)).toBe(195);
		expect(bezier3([195, 779.75, 0], 0.5)).toBeCloseTo(0.25 * 195 + 0.5 * 779.75, 9);
		expect(bezier3([195, 779.75, 0], 1)).toBe(0);
	});

	it('puts a wheel speed in the lowest gear that is not past its shift rpm', () => {
		expect(computeGear(e, -1)).toBe(0);
		expect(computeGear(e, 0)).toBe(1);
		// 1st redlines (6200 rpm) at 6200 / (2.65 * 3.9 * 9.549) = 62.8 rad/s.
		expect(computeGear(e, 62)).toBe(1);
		expect(computeGear(e, 64)).toBe(2);
		expect(computeGear(e, 1000)).toBe(5);
	});

	it('resets onto the wheels\' gear with idle flywheel and an open clutch', () => {
		const v = car();
		engineReset(v.engine, e, 100);
		expect(v.engine).toMatchObject({ gear: 2, clutch: 0, drive: 0, fly: IDLE_FLYWHEEL, timer: 10 });
		expect(v.engine.rpm).toBeCloseTo(100 * 1.66 * 3.9 * 9.54929638, 6);
		expect(maxWheelOmega(v.engine, e)).toBeCloseTo(7000 / (1.66 * 3.9 * 9.54929638), 9);
	});

	it('closes the clutch once the revs pass a quarter of the shift point, then upshifts', () => {
		const v = car();
		engineReset(v.engine, e, 60);
		const inp: EngineInput = { wheelOmega: 60, gas: 1, brake: 0, handBrake: false, steering: 0, allowReverse: false, forwardSpeed: 20, dt: 1 / 60 };
		// The flywheel spins up from idle on its own first.
		let steps = 0;
		while (v.engine.clutch === 0 && steps < 10) { engineUpdate(v.engine, e, inp); steps++; }
		expect(steps).toBeLessThanOrEqual(3);
		expect(v.engine.drive).toBeGreaterThan(0);
		for (let i = 0; i < 60; i++) engineUpdate(v.engine, e, { ...inp, wheelOmega: 70 });
		expect(v.engine.gear).toBe(2);
	});

	it('holds first gear while braking slowly, with the clutch slipping', () => {
		const v = car();
		engineReset(v.engine, e, 40);
		v.engine.gear = 3;
		engineUpdate(v.engine, e, { wheelOmega: 10, gas: 0.5, brake: 0.5, handBrake: false, steering: 0, allowReverse: false, forwardSpeed: 4, dt: 1 / 60 });
		expect(v.engine.gear).toBe(1);
		expect(v.engine.allowUp).toBe(false);
	});
});

describe('wheel spin', () => {
	const wheel = (omega: number, torque = 0): WheelState => ({ ...car().wheels[2], omega, torque });

	it('integrates torque, freewheels down with the gas off, and clamps to the redline', () => {
		const w = wheel(100, 300);
		wheelUpdateVelocity(w, 1 / 60, 1000, 0, true, false);
		expect(w.omega).toBeCloseTo(100 + 300 / 60 / 30 - 500 / 60 / 30, 9);
		expect(w.torque).toBe(0);
		const capped = wheel(100);
		wheelUpdateVelocity(capped, 1 / 60, 50, 0, false, false);
		expect(capped.omega).toBe(50);
	});

	it('locks a wheel the brake can hold and drops its inertia for the step', () => {
		const w = wheel(1);
		wheelUpdateVelocity(w, 1 / 60, 1000, 1, false, false);
		expect(w.omega).toBe(0);
		expect(w.invInertia).toBe(0);
		const fast = wheel(100);
		wheelUpdateVelocity(fast, 1 / 60, 1000, 1, false, false);
		expect(fast.omega).toBeCloseTo(100 - 1000 / 60 / 30, 9);
		expect(fast.invInertia).toBeCloseTo(1 / 30, 12);
	});

	it('never spins backwards outside reverse', () => {
		const w = wheel(-5);
		wheelUpdateVelocity(w, 1 / 60, 1000, 0, false, false);
		expect(w.omega).toBe(0);
	});

	it('pulls toward free rolling under friction but never past it', () => {
		const w = wheel(10);
		applyFrictionReaction(w, 0.5, -30000, 2.5, 1 / 60);
		expect(w.omega).toBe(5);
		const w2 = wheel(30);
		applyFrictionReaction(w2, 0.5, -30, 10, 1 / 60);
		expect(w2.omega).toBeCloseTo(30 - 1 / 60, 9);
	});
});

describe('road finding', () => {
	it('hits a flat plane only going down through it', () => {
		const g = flatGround(1);
		close(g.lineTest([0, 2, 0], [0, 0, 0])!.pos, [0, 1, 0]);
		expect(g.lineTest([0, 0, 0], [0, 2, 0])).toBe(null);
		expect(g.lineTest([0, 3, 0], [0, 2, 0])).toBe(null);
		expect(g.aboveGround([1, 5, 2])!.pos).toEqual([1, 1, 2]);
		expect(g.aboveGround([1, 0, 2])).toBe(null);
	});

	it('casts each wheel line from 0.4 m above the hub past full droop', () => {
		const v = car();
		const { start, end } = tractionLine(v, 0);
		const hub = toWorld(v.body, v.wheels[0].pos);
		close(start, [hub[0], hub[1] + 0.4, hub[2]]);
		close(end, [hub[0], hub[1] - (0.1 + 0.325 + 0.2 + 1), hub[2]]);
	});

	it('puts a wheel on the ground when its reach covers the hit, close within the slack', () => {
		const v = car();
		const hub = toWorld(v.body, v.wheels[0].pos);
		const reach = 0.1 + 0.325;
		addTractionPoint(v, 0, { pos: [hub[0], hub[1] - reach + 0.01, hub[2]], normal: [0, 1, 0], surface: { grip: 1, roughness: 0, linearDrag: 0 } });
		expect(v.wheels[0]).toMatchObject({ onGround: true, closeToGround: true, hasTraction: true, lineValid: true });
		const hub1 = toWorld(v.body, v.wheels[1].pos);
		addTractionPoint(v, 1, { pos: [hub1[0], hub1[1] - reach - 0.1, hub1[2]], normal: [0, 1, 0], surface: { grip: 1, roughness: 0, linearDrag: 0 } });
		expect(v.wheels[1]).toMatchObject({ onGround: false, closeToGround: true, hasTraction: false });
		resetWheelFlags(v);
		expect(v.wheels[0]).toMatchObject({ onGround: false, wasOnGround: true, lineValid: false });
	});

	it('reports how far the lowest airborne tyre hangs over its contact', () => {
		const v = car();
		v.wheels.forEach((w) => { w.lineValid = true; w.contact.pos = [0, -0.5, 0]; });
		calculateWheelPlane(v);
		expect(v.wheelPlane.valid).toBe(true);
		expect(v.wheelPlane.height).toBeCloseTo(0.335 - 0.01 - 0.325 + 0.5, 9);
		v.wheels[2].onGround = true;
		calculateWheelPlane(v);
		expect(v.wheelPlane.height).toBe(0);
	});
});

describe('steering', () => {
	it('turns At toward the left for positive steering', () => {
		close(steeredDirection([0, 1, 0], [0, 0, 1], -0.1), [-Math.sin(0.1), 0, Math.cos(0.1)]);
	});

	it('slews the wheel toward the input and locks at 1.5x MaxAngle at low speed', () => {
		const v = car();
		updateSteering(v, 1, 0, 1 / 60);
		expect(v.steering).toBeGreaterThan(0);
		expect(v.steering).toBeLessThan(1);
		for (let i = 0; i < 120; i++) updateSteering(v, 1, 0, 1 / 60);
		expect(v.steering).toBe(1);
		expect(v.steerAngle).toBeCloseTo(-1.5 * 11 * (Math.PI / 180), 6);
	});

	it('narrows the lock with speed', () => {
		const v = car();
		v.speedMph = 140;
		for (let i = 0; i < 300; i++) updateSteering(v, 1, 1, 1 / 60);
		expect(v.maxSteerDeg).toBeLessThan(11);
		expect(v.maxSteerDeg).toBeGreaterThan(1.8);
	});
});

describe('car state rules', () => {
	it('computes the aero load from speed squared and the lift coefficient', () => {
		const v = car();
		v.body.v = [0, 0, 40];
		expect(downForce(v)).toBeCloseTo(0.5 * 6.1 * 1.225 * 1600 * 0.25, 9);
	});

	it('freezes after a quiet second, unless a pedal is held', () => {
		const v = car();
		for (let i = 0; i < 61; i++) updateFreezing(v, NO_INPUT, 1 / 60);
		expect(v.frozen).toBe(true);
		updateFreezing(v, { ...NO_INPUT, gas: 1 }, 1 / 60);
		expect(v.frozen).toBe(false);
		expect(v.coolDown).toBe(0);
	});

	it('latches the handbrake until released after 0.275 s', () => {
		const v = car();
		v.speedMph = 30;
		updateHandBrake(v, 1, 1 / 60);
		expect(v.handBrake).toBe(true);
		updateHandBrake(v, 0, 1 / 60);
		expect(v.handBrake).toBe(true);
		for (let i = 0; i < 20; i++) updateHandBrake(v, 0, 1 / 60);
		expect(v.handBrake).toBe(false);
	});

	it('is airborne only with every wheel up and some speed', () => {
		const v = car();
		v.speedMag = 5;
		updateInAirStats(v, 1 / 60);
		expect(v.hasAir).toBe(true);
		expect(v.engine.allowUp).toBe(false);
		v.speedMag = 1;
		updateInAirStats(v, 1 / 60);
		expect(v.hasAir).toBe(false);
	});
});
