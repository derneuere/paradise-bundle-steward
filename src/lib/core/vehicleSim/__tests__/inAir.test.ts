// The airborne attitude control: what a driving car's spin does on the step
// it leaves the ground, on later airborne steps, and off a real ledge.

import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../../deformationSpec';
import { dot } from '../../deformationSim/state';
import { restPose } from '../driver';
import { flatGround, type World } from '../ground';
import { updateInAirBehaviour } from '../inAir';
import { stepVehicle, DT } from '../step';
import { resetVehicle } from '../vehicle';
import { createVehicle, NO_INPUT, type VehicleState } from '../vehicleState';
import { syntheticParams } from './carFixture';

const close = (a: readonly number[], b: readonly number[], d = 9) => b.forEach((x, i) => expect(a[i]).toBeCloseTo(x, d));
const rates = (v: VehicleState): Vec3 => v.body.axes.map((a) => dot(v.body.w, a)) as Vec3;

// A car flying level, on the step it left the ground.
function takingOff(w: Vec3, vel: Vec3 = [0, 0, 20]): VehicleState {
	const v = createVehicle(syntheticParams(), [0, 2, 0]);
	v.body.v = vel;
	v.body.w = w;
	v.hasAir = true;
	v.hadAir = false;
	return v;
}

// Rolled about At by `a` radians: Right tips toward world -Y.
function rolled(v: VehicleState, a: number): void {
	const c = Math.cos(a), s = Math.sin(a);
	v.body.axes = [[c, -s, 0], [s, c, 0], [0, 0, 1]];
}

describe('take-off step', () => {
	it('keeps 5% of the pitch rate, all the yaw and none of the roll of a level car', () => {
		const v = takingOff([2, 1, 3], [0, 0, 0]);
		updateInAirBehaviour(v, 0, DT);
		// PitchDampingOnTakeOff 0.95; yaw is never damped; roll damping 1.
		close(rates(v), [0.1, 1, 0]);
		close(v.takeOff.rates, [0.1, 1, 0]);
		expect(v.takeOff.rollBleed).toBeCloseTo(0.05, 9);
		// Flying forward level counts as diving: the nose-down rate left over
		// then loses dt/0.1 of itself on the same step.
		const fast = takingOff([2, 1, 3]);
		updateInAirBehaviour(fast, 0, DT);
		close(rates(fast), [0.1 * (1 - DT / 0.1), 1, 0]);
	});

	it('leaves a car that took off on its side its roll, capped at RollLimitOnTakeOff turns/s', () => {
		const v = takingOff([0, 0, 9]);
		rolled(v, 0.5);   // |Right.y| = 0.48, past the no-damping tilt
		updateInAirBehaviour(v, 0, DT);
		expect(rates(v)[2]).toBeCloseTo(2 * Math.PI, 9);
		expect(v.takeOff.rollBleed).toBeCloseTo(0.01, 9);
	});

	it('ramps the roll damping with the take-off tilt', () => {
		// |Right.y| = 0.1875 is halfway between the full- and no-damping tilts:
		// roll factor 0.65, so 35% of the roll is removed.
		const v = takingOff([0, 0, 1]);
		rolled(v, Math.asin(0.1875));
		updateInAirBehaviour(v, 0, DT);
		expect(rates(v)[2]).toBeCloseTo(0.65, 9);
	});

	it('forgets the jump once a wheel is down', () => {
		const v = takingOff([0, 0, 0]);
		v.takeOff = { rates: [1, 2, 3], rollBleed: 0.05, rolling: true };
		v.hasAir = false;
		updateInAirBehaviour(v, 0, DT);
		expect(v.takeOff.rates).toEqual([0, 0, 0]);
		expect(v.takeOff.rolling).toBe(false);
	});
});

describe('later airborne steps', () => {
	const flying = (w: Vec3, takeOffRoll: number) => {
		const v = takingOff(w, [0, 0, 0]);
		v.hadAir = true;
		v.takeOff = { rates: [0, 0, takeOffRoll], rollBleed: 0.05, rolling: false };
		return v;
	};

	it('bleeds the take-off roll by the per-step rate while the car rolls the same way', () => {
		const v = flying([0, 0, 0.5], 1);
		updateInAirBehaviour(v, 0, DT);
		expect(rates(v)[2]).toBeCloseTo(0.45, 9);
		const back = flying([0, 0, -0.5], 1);
		updateInAirBehaviour(back, 0, DT);
		expect(rates(back)[2]).toBeCloseTo(-0.5, 9);
	});

	it('lets steering against the roll damp it once the car has rolled and come back', () => {
		const v = flying([0, 0, 1], -1);   // roll opposite the take-off: no bleed
		v.takeOff.rolling = true;
		rolled(v, 0.1);
		updateInAirBehaviour(v, -1, DT);
		expect(rates(v)[2]).toBeCloseTo(1 - 0.14, 9);
		const along = flying([0, 0, 1], -1);
		along.takeOff.rolling = true;
		rolled(along, 0.1);
		updateInAirBehaviour(along, 1, DT);
		expect(rates(along)[2]).toBeCloseTo(1, 9);
	});

	it('torques a climbing nose toward the velocity and brakes the pitch rate', () => {
		const v = flying([0.2, 0, 0], 0);
		const s = Math.sin(0.2), c = Math.cos(0.2);
		v.body.axes = [[1, 0, 0], [0, c, -s], [0, s, c]];   // nose up 0.2 rad
		v.body.v = [0, 0, 20];
		updateInAirBehaviour(v, 0, DT);
		const m = v.body.mass;
		// cross(v, Right) . At = 20 sin 0.2, so the torque about Right is
		// m (20 sin 0.2 - 10 * 0.2): nose down, against the climb.
		expect(dot(v.body.Tq, v.body.axes[0])).toBeCloseTo(m * (20 * s - 10 * 0.2), 6);
	});

	it('bleeds a nose-down spin out of a diving car, banked torque included', () => {
		const v = flying([1, 0, 0], 0);
		const s = Math.sin(0.2), c = Math.cos(0.2);
		v.body.axes = [[1, 0, 0], [0, c, s], [0, -s, c]];   // nose down
		v.body.v = [0, 0, 20];
		v.body.Tq = [100, 0, 0];
		updateInAirBehaviour(v, 0, DT);
		const k = 1 - DT / 0.1;
		expect(dot(v.body.w, v.body.axes[0])).toBeCloseTo(k, 9);
		expect(v.body.Tq[0]).toBeCloseTo(100 * k, 6);
		// A nose already coming up is left alone.
		const rising = flying([-1, 0, 0], 0);
		rising.body.axes = v.body.axes;
		rising.body.v = [0, 0, 20];
		updateInAirBehaviour(rising, 0, DT);
		expect(dot(rising.body.w, rising.body.axes[0])).toBeCloseTo(-1, 9);
	});
});

// The road ends at z = 0 and carries on a metre lower.
const ledge: World = (() => {
	const top = flatGround(0), bottom = flatGround(-1);
	const pick = (p: Vec3) => (p[2] < 0 ? top : bottom);
	return {
		lineTest: (start, end) => pick(end).lineTest(start, end) ?? pick(start).lineTest(start, end),
		aboveGround: (p) => pick(p).aboveGround(p),
	};
})();

describe('off a 1 m drop at 20 m/s', () => {
	const run = (pitchDamping: number) => {
		const p = syntheticParams();
		p.base.pitchDampingOnTakeOff = pitchDamping;
		const v = createVehicle(p, [0, restPose(p).height, -4]);
		resetVehicle(v, [0, 0, 20]);
		let takeOffs = 0, worstPitch = 0;
		for (let i = 0; i < 60; i++) {
			stepVehicle(v, ledge, DT, NO_INPUT);
			if (v.hasAir && !v.hadAir) takeOffs++;
			if (v.hasAir) worstPitch = Math.max(worstPitch, Math.abs(Math.asin(v.body.axes[2][1])));
		}
		return { v, takeOffs, worstPitch };
	};

	it('takes off once and lands on its wheels', () => {
		const { v, takeOffs } = run(0.95);
		expect(takeOffs).toBe(1);
		expect(v.hasAir).toBe(false);
		expect(v.body.axes[1][1]).toBeGreaterThan(0.99);
	});

	it('flies flatter with the take-off pitch damping than without it', () => {
		const damped = run(0.95).worstPitch, free = run(0).worstPitch;
		expect(damped).toBeLessThan(free);
	});
});
