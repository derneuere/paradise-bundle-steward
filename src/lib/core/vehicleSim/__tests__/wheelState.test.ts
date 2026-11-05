// A wheel the crash has bent or shed: a twisted wheel holds its spin at 0
// whatever drives or brakes it; a detached one is no longer a wheel, and the
// springs after it take the previous wheel's share of the car's weight.

import { describe, expect, it } from 'vitest';
import { GRAVITY } from '../body';
import { updateSuspension } from '../suspension';
import { applyFrictionReaction } from '../tyres';
import { updateWheels, wheelUpdateVelocity } from '../wheels';
import { createVehicle, NO_INPUT } from '../vehicleState';
import { syntheticParams } from './carFixture';

const DT = 1 / 60;
const car = () => createVehicle(syntheticParams(), [0, 0.335, 0]);

describe('twisted wheel', () => {
	it('does not spin under drive torque, braking or the tyre reaction', () => {
		const v = car(), w = v.wheels[2];
		w.twisted = true;
		w.torque = 5000;
		wheelUpdateVelocity(w, DT, 1000, 0, false, false);
		expect(w.omega).toBe(0);
		applyFrictionReaction(w, 0.3, 3000, 20, DT);
		expect(w.omega).toBe(0);
		const free = car().wheels[2];
		free.torque = 5000;
		wheelUpdateVelocity(free, DT, 1000, 0, false, false);
		expect(free.omega).toBeGreaterThan(0);
	});

	it('stays locked through the whole wheel update with the throttle pinned', () => {
		const v = car();
		for (const w of v.wheels) {
			w.onGround = w.wasOnGround = w.hasTraction = w.closeToGround = true;
			w.contact = { ...w.contact, pos: [w.pos[0], 0, w.pos[2]], normal: [0, 1, 0] };
			w.massOnWheel = 300;
		}
		v.wheels[2].twisted = true;
		for (let i = 0; i < 30; i++) {
			v.wheels[2].torque = v.wheels[3].torque = 2000;   // the engine's drive
			updateWheels(v, { ...NO_INPUT, gas: 1 }, DT);
		}
		expect(v.wheels[2].omega).toBe(0);
		expect(v.wheels[3].omega).not.toBe(0);
	});
});

describe('detached wheel', () => {
	it('skips its spring, and the springs after it take the previous wheel\'s mass share', () => {
		const v = car(), P = v.params;
		[0.1, 0.2, 0.3, 0.4].forEach((x, i) => { P.wheels[i].scaler = x; });
		v.wheels[0].detached = true;
		const k0 = v.wheels[0].spring.k;
		updateSuspension(v, DT);
		const k = (share: number) => (P.mass * share * GRAVITY) / P.susp.restDisp;
		expect(v.wheels[0].spring.k).toBe(k0);
		expect(v.wheels[1].spring.k).toBeCloseTo(k(0.1), 6);
		expect(v.wheels[2].spring.k).toBeCloseTo(k(0.2), 6);
		expect(v.wheels[3].spring.k).toBeCloseTo(k(0.3), 6);
	});

	it('leaves every spring its own share while all four wheels are on', () => {
		const v = car(), P = v.params;
		[0.1, 0.2, 0.3, 0.4].forEach((x, i) => { P.wheels[i].scaler = x; });
		updateSuspension(v, DT);
		[0.1, 0.2, 0.3, 0.4].forEach((x, i) => expect(v.wheels[i].spring.k).toBeCloseTo((P.mass * x * GRAVITY) / P.susp.restDisp, 6));
	});
});
