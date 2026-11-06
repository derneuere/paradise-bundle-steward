// The game's airborne attitude control, for a driving car only (a crashing
// car flies free). It is what makes a car land flat off a jump:
//   - on the step the car leaves the ground, pitch is damped by the car's
//     PitchDampingOnTakeOff share, yaw is kept, and roll is damped by how
//     level the car left: a level take-off loses all its roll, a car already
//     on its side keeps it (a barrel roll survives). The roll rate is then
//     capped at RollLimitOnTakeOff turns per second;
//   - on later airborne steps, the roll the car took off with bleeds off at a
//     small fixed rate, and once the car has rolled past a threshold and come
//     back, steering against the roll damps it further;
//   - every airborne step, a climbing car is torqued nose-first (and
//     wing-first) into its velocity, while a diving car instead loses that
//     axis' spin, including the torque and angular impulse already banked.
// Rates are about the body axes: pitch about Right, yaw about Up, roll about At.

import type { Vec3 } from '../deformationSpec';
import { cross, dot, scale, sub } from '../deformationSim/state';
import { addWorldTorque, dampPitchYawRoll, type RigidBody } from './body';
import type { VehicleState } from './vehicleState';

// |Right.y| at take-off: up to FULL the roll damping falls from 1 to 0.7,
// from FULL to NONE it falls on to 0, past NONE the roll is kept.
const FULL_DAMP_TILT = 0.125;
const NO_DAMP_TILT = 0.25;
const MIN_ROLL_FACTOR = 0.3;
// The roll bleed per step (at 60 Hz), from a level take-off to a tilted one.
const LEVEL_ROLL_BLEED = 0.05;
const TILTED_ROLL_BLEED = 0.01;
const LANDING_ASSIST_DAMPING = 0.14;
const MIN_TILT_FOR_ASSIST = 0.3;
const ALIGN_TORQUE_SCALE = 1;
const RATE_TORQUE_SCALE = 10;
const DIVE_BLEED_TIME = 0.1;
// A take-off this fast in roll is a deliberate barrel roll: no roll alignment.
const BARREL_ROLL_RATE = 0.25;

// +1, 0 at exactly zero, -1 below (and for NaN).
const sign = (x: number) => (x > 0 ? 1 : x >= 0 ? 0 : -1);

function takeOffRollFactor(tilt: number): number {
	if (FULL_DAMP_TILT >= tilt) return MIN_ROLL_FACTOR * (tilt / FULL_DAMP_TILT);
	if (tilt > FULL_DAMP_TILT && NO_DAMP_TILT >= tilt) {
		return (1 - MIN_ROLL_FACTOR) * ((tilt - FULL_DAMP_TILT) / (NO_DAMP_TILT - FULL_DAMP_TILT)) + MIN_ROLL_FACTOR;
	}
	return 1;
}

export function updateInAirBehaviour(v: VehicleState, steering: number, dt: number): void {
	const b = v.body, T = v.takeOff;
	if (!v.hasAir) {
		T.rates = [0, 0, 0];
		T.rolling = false;
		return;
	}
	const [right, up, at] = b.axes;
	const roll0 = dot(b.w, at);
	if (!v.hadAir) {
		const f = takeOffRollFactor(Math.abs(right[1]));
		T.rollBleed = ((TILTED_ROLL_BLEED - LEVEL_ROLL_BLEED) * f + LEVEL_ROLL_BLEED) * (60 * dt);
		dampPitchYawRoll(b, v.params.base.pitchDampingOnTakeOff, 0, 1 - f, dt);
		const maxRoll = v.params.base.rollLimitOnTakeOff * 2 * Math.PI;
		let roll = dot(b.w, at);
		if (Math.abs(roll) > maxRoll) {
			const capped = maxRoll * sign(roll);
			b.w = sub(b.w, scale(at, roll - capped));
			roll = capped;
		}
		T.rates = [dot(b.w, right), dot(b.w, up), roll];
	} else {
		const tilt = Math.abs(right[1]);
		if (tilt > MIN_TILT_FOR_ASSIST) T.rolling = true;
		if (T.rolling && MIN_TILT_FOR_ASSIST > tilt && up[1] > 0) {
			const steerSign = steering === 0 ? 0 : steering >= 0 ? 1 : -1;
			if (sign(roll0) !== steerSign) {
				const assist = Math.abs(steering) * LANDING_ASSIST_DAMPING * dt * 60;
				b.w = sub(b.w, scale(at, roll0 * assist));
			}
		}
		const roll = dot(b.w, at);
		if (sign(T.rates[2]) === sign(roll)) {
			const step = Math.min(T.rollBleed * dt * 60, Math.abs(roll)) * sign(roll);
			b.w = sub(b.w, scale(at, step));
		}
	}
	const vz = dot(b.v, at), vx = dot(b.v, right);
	alignOrBleed(b, right, at, vz, vx, vz, dt);
	if (BARREL_ROLL_RATE > Math.abs(T.rates[2])) alignOrBleed(b, at, right, vx, vz, vz, dt);
}

// One axis of the shared tail. While the velocity along `other` (the body
// axis this one tips) climbs, torque `axis` toward the velocity, minus a
// rate brake. Otherwise bleed `axis`' spin, banked torque and angular impulse
// by dt/0.1, each only while it has the sign of `gate`. The game gates the
// roll bleed on the forward speed too, not the sideways one.
function alignOrBleed(b: RigidBody, axis: Vec3, other: Vec3, along: number, across: number, gate: number, dt: number): void {
	if (other[1] * along > 0) {
		const dir = along >= 0 ? other : scale(other, -1);
		const inPlane = sub(b.v, scale(axis, across));
		const align = dot(cross(inPlane, axis), dir);
		const rate = dot(b.w, axis);
		addWorldTorque(b, sub(scale(axis, align * b.mass * ALIGN_TORQUE_SCALE), scale(axis, rate * b.mass * RATE_TORQUE_SCALE)));
		return;
	}
	const k = dt / DIVE_BLEED_TIME;
	const bleed = (x: Vec3) => {
		const c = dot(axis, x);
		return c * gate > 0 ? sub(x, scale(axis, c * k)) : x;
	};
	b.w = bleed(b.w);
	b.Tq = bleed(b.Tq);
	b.L = bleed(b.L);
}
