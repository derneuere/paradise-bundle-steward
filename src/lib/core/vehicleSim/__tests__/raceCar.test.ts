// The race car's own rules on top of the shared vehicle update: the beached
// promotion of close wheels, steering while frozen, and where the surface
// drag is sampled.

import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../../deformationSpec';
import { applyLinearDrag } from '../aero';
import { toWorld } from '../body';
import { addTractionPoint, resetWheelFlags, type LineHit } from '../ground';
import { updateBeachedTime, updateVehicle } from '../vehicle';
import { createVehicle, DEFAULT_SURFACE, NO_INPUT, type VehicleState } from '../vehicleState';
import { syntheticParams } from './carFixture';

const DT = 1 / 60;

// A car stopped against a wall, its front-left wheel just out of reach of
// the road: on the ground it is not, close to it it is.
function beached(): { v: VehicleState; hit: LineHit } {
	const v = createVehicle(syntheticParams(), [0, 0.4, 0]);
	const w = v.wheels[0], p = v.params.wheels[0];
	const reach = w.pos[1] - p.yMin + p.radius;
	const hub = toWorld(v.body, w.pos);
	const hit: LineHit = { pos: [hub[0], hub[1] - reach - 0.05, hub[2]] as Vec3, normal: [0, 1, 0], surface: DEFAULT_SURFACE };
	v.contactingWall = true;
	v.speedMph = 0;
	v.wheels.forEach((x, i) => { x.hasTraction = i !== 0; });
	return { v, hit };
}

describe('beached car', () => {
	it('counts a close wheel as on the ground after half a second stopped at a wall', () => {
		const { v, hit } = beached();
		resetWheelFlags(v);
		addTractionPoint(v, 0, hit);
		expect(v.wheels[0].closeToGround).toBe(true);
		expect(v.wheels[0].onGround).toBe(false);
		v.wheels.forEach((x, i) => { x.hasTraction = i !== 0; });
		for (let i = 0; i < 31; i++) updateBeachedTime(v, DT);
		expect(v.beachedTime).toBeGreaterThanOrEqual(0.5);
		resetWheelFlags(v);
		addTractionPoint(v, 0, hit);
		expect(v.wheels[0].onGround).toBe(true);
		// Only the ground flag: the wheel still has no traction.
		expect(v.wheels[0].hasTraction).toBe(false);
	});

	it('is not beached while moving, airborne, crashing, clear of walls or with every wheel gripping', () => {
		const cases: ((v: VehicleState) => void)[] = [
			(v) => { v.speedMph = 3; },
			(v) => { v.hasAir = true; },
			(v) => { v.crashing = true; },
			(v) => { v.contactingWall = false; },
			(v) => { v.wheels[0].hasTraction = true; },
		];
		for (const breakIt of cases) {
			const { v } = beached();
			v.beachedTime = 0.4;
			breakIt(v);
			updateBeachedTime(v, DT);
			expect(v.beachedTime).toBe(0);
		}
		// Reversing at any speed counts as stopped: the test reads the signed speed.
		const { v } = beached();
		v.speedMph = -20;
		updateBeachedTime(v, DT);
		expect(v.beachedTime).toBeCloseTo(DT, 12);
	});
});

describe('frozen car', () => {
	it('still turns its front wheels', () => {
		const v = createVehicle(syntheticParams(), [0, 0.4, 0]);
		v.coolDown = 2;
		updateVehicle(v, { ...NO_INPUT, steering: 1 }, DT);
		expect(v.frozen).toBe(true);
		expect(v.steering).toBeGreaterThan(0);
		expect(v.steerAngle).toBeLessThan(0);
	});
});

describe('surface drag', () => {
	it('takes the drag of the surface under the centre of mass, not the wheels', () => {
		const v = createVehicle(syntheticParams(), [0, 0.4, 0]);
		v.body.v = [0, 0, 10];
		v.allWheelsOnGround = true;
		v.wheels.forEach((w) => { w.contact.surface = { ...DEFAULT_SURFACE, linearDrag: 5 }; });
		v.aboveGround.surface = { ...DEFAULT_SURFACE, linearDrag: 2 };
		applyLinearDrag(v);
		const d = v.params.base.linearDrag + 2 * v.params.base.surfaceDrag;
		expect(v.body.F[2]).toBeCloseTo(-d * 10 * 10, 9);
	});
});
