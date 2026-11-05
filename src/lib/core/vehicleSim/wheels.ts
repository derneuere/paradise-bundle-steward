// The per-step wheel update: wheel inertia (and the handbrake's axle lock),
// re-seeding the spin of a wheel that just landed, drive torque into spin,
// brakes, the "magic brake" (a direct retarding force on the body that does
// most of the stopping), the rear differential, then the tyre forces. The
// body is drained between stages, exactly where the game drains, so each
// stage sees the velocity the previous one produced.

import type { Vec3 } from '../deformationSpec';
import { cross, dot, sub } from '../deformationSim/state';
import { addLocalSpaceForce, dampPitchYawRoll, drain, toWorldDir } from './body';
import { bezier3, counterSteeringAtLowSpeed, maxWheelOmega } from './engine';
import { steeredDirection } from './steering';
import { crashScrub, wheelPairFriction } from './tyres';
import { downForce } from './aero';
import { WHEEL_INERTIA, type Controls, type VehicleState, type WheelState } from './vehicleState';

const BURNOUT_INERTIA = 200;
const SPIN_CLAMP = 9000;
const FREEWHEEL_DECEL = 500;
const BRAKE_CAPACITY = 100;
const BRAKE_DECEL = 1000;
const UNDRIVEN_MAX_SPIN = 10000;
const EPS = 1.1920928955078125e-7;
const REAR_FIRST: readonly number[] = [2, 3, 0, 1];
const INTEGRATE_ORDER: readonly number[] = [1, 0, 3, 2];

function updateBurnout(v: VehicleState, ctl: Controls): void {
	const [fl, fr, rl, rr] = v.wheels;
	const delta = Math.max((rl.omega + rr.omega) * 0.5 - (fl.omega + fr.omega) * 0.5, 0);
	if (!(ctl.gas > 0.97 && ctl.brake > 0.97) || !(rl.omega > 0 && rr.omega > 0) || !(delta > 1)) { v.doingBurnout = false; return; }
	if (v.doingBurnout || dot(v.body.v, v.body.v) < 0.25) {
		if (70 > fl.omega) { rl.omega *= 1.03; rr.omega *= 1.03; }
		v.doingBurnout = true;
	}
}

function updateWheelInertia(v: VehicleState): void {
	const set = (w: WheelState, I: number) => { w.inertia = I; w.invInertia = I ? 1 / I : 0; };
	for (const w of v.wheels) set(w, WHEEL_INERTIA);
	if (v.doingBurnout) { for (const w of v.wheels) set(w, BURNOUT_INERTIA); return; }
	if (!v.handBrake) return;
	v.doingBurnout = false;
	const speed = Math.hypot(...v.body.v);
	const lockRear = speed < 5 ? v.params.base.powerToRear !== 0 : v.engine.gear !== 0;
	for (const i of lockRear ? [2, 3] : [0, 1]) { v.wheels[i].omega = 0; set(v.wheels[i], 0); }
}

// The brake pedal ramps a brake scale up over TimeForFullBrake (down
// instantly) and a curve maps it to a braking factor. In reverse the gas
// pedal brakes; the handbrake brakes harder the straighter the wheels.
function brakeFactor(v: VehicleState, ctl: Controls, dt: number): number {
	const released = ctl.gas < 0.1 && ctl.brake < 0.1;
	let pedal: number;
	if (v.handBrake) {
		if (v.hasAir) return 0;
		// The handbrake bleeds yaw rate.
		dampPitchYawRoll(v.body, 0, v.params.base.handbrakeYawDamping, 0, dt);
		pedal = 1 - Math.abs(ctl.steering);
	} else if (v.engine.gear !== 0) {
		if (0 > v.speedMph) return 0;
		pedal = ctl.brake;
		if (v.speedMph > v.params.base.minSpeedForDriftMph && v.numWorldCollisions > 0) v.brakeScale = Math.min(v.brakeScale, 0.2);
		if (5 > v.speedMph && released) v.brakeScale = 0.2;
	} else {
		if (v.speedMph > 0) return 0;
		pedal = ctl.gas;
		if (v.speedMph > -5 && released) v.brakeScale = 0.2;
	}
	if (pedal <= 0.1) { v.brakeScale = 0; return 0; }
	v.brakeScale = pedal > v.brakeScale ? v.brakeScale + dt * pedal * v.params.base.invTimeForFullBrake : pedal;
	v.brakeScale = Math.min(v.brakeScale, 1);
	return bezier3(v.params.base.brakeCurve, v.brakeScale);
}

// Integrates the stored torque, then brakes (a wheel whose angular momentum
// the brake can absorb stops dead and takes no tyre torque this step), and
// clamps to the gear's redline. Gas released lets the wheel freewheel down.
export function wheelUpdateVelocity(w: WheelState, dt: number, maxOmega: number, factor: number, gasReleased: boolean, inReverse: boolean): void {
	const cand = Math.min(Math.max(w.omega + w.torque * dt * w.invInertia, -SPIN_CLAMP), SPIN_CLAMP);
	const sign = cand > 0 ? 1 : cand >= 0 ? 0 : -1;
	const keep = Math.abs(cand * w.inertia) > factor * BRAKE_CAPACITY;
	const decel = factor > 0 ? BRAKE_DECEL * factor : gasReleased ? FREEWHEEL_DECEL : 0;
	let res = keep ? sign * Math.max(Math.abs(cand) - decel * dt * w.invInertia, 0) : 0;
	if (!inReverse && res < 0) res = 0;
	res = maxOmega >= 0 ? Math.min(res, maxOmega) : Math.max(res, maxOmega);
	w.omega = res;
	w.torque = 0;
	if (!(keep || Math.abs(cand) < EPS)) { w.inertia = 0; w.invInertia = 0; }
}

function limitDifferential(a: WheelState, b: WheelState): void {
	const avg = (a.omega + b.omega) * 0.5, band = Math.abs(avg) * 0.1;
	const clamp = (x: number) => Math.min(Math.max(x, avg - band), avg + band);
	a.omega = clamp(a.omega); b.omega = clamp(b.omega);
}

function bodyPointVelocity(v: VehicleState, i: number): Vec3 {
	const w = v.wheels[i], B = v.body;
	const r = w.onGround ? sub(w.contact.pos, B.pos) : toWorldDir(B, [w.pos[0], w.pos[1] - v.params.wheels[i].radius, w.pos[2]]);
	const c = cross(B.w, r);
	return [B.v[0] + c[0], B.v[1] + c[1], B.v[2] + c[2]];
}

export function updateWheels(v: VehicleState, ctl: Controls, dt: number): void {
	const B = v.body, P = v.params, at = B.axes[2];
	updateBurnout(v, ctl);
	updateWheelInertia(v);
	v.steerDir = steeredDirection(B.axes[1], at, v.steerAngle);
	const inReverse = 0 > v.speedMph || v.engine.gear === 0;
	const gasReleased = ctl.gas < 0.1;
	for (const i of REAR_FIRST) v.wheels[i].bodyPointVel = bodyPointVelocity(v, i);
	for (const i of REAR_FIRST) {
		const w = v.wheels[i];
		if (!w.onGround || w.wasOnGround) continue;
		w.torque = 0;
		w.omega = dot(w.bodyPointVel, i < 2 ? v.steerDir : at) / P.wheels[i].radius;
		w.broken = false;
	}
	for (const i of INTEGRATE_ORDER) {
		const w = v.wheels[i];
		w.omega += w.torque * dt * w.invInertia;
		w.torque = 0;
	}
	const factor = brakeFactor(v, ctl, dt);
	if (!v.hasAir) {
		const t = Math.min(Math.abs(ctl.steering), 1);
		const blend = P.base.magicBrakeStraight + t * (P.base.magicBrakeTurning - P.base.magicBrakeStraight);
		const sgn = v.speedMph > 0 ? 1 : v.speedMph >= 0 ? 0 : -1;
		const fwdScale = Math.min(Math.abs(dot(B.v, at)), 1);
		addLocalSpaceForce(B, [0, 0, -factor * P.mass * blend * sgn * fwdScale]);
	}
	let front = factor;
	let rear = ctl.gas > 0 || ctl.brake < 0.9 ? Math.min(Math.max((v.speedMph - 60) / 10, 0), 0.75) * factor : factor;
	if (0.1 > P.base.powerToRear) [front, rear] = [rear, front];
	const [fl, fr, rl, rr] = v.wheels;
	if (fr.omega > rr.omega || fl.omega > rl.omega) rear = 0;
	const driven = maxWheelOmega(v.engine, P.engine);
	const frontMax = Math.abs(P.base.powerToFront) <= EPS ? UNDRIVEN_MAX_SPIN : driven;
	wheelUpdateVelocity(fr, dt, frontMax, front, gasReleased, inReverse);
	wheelUpdateVelocity(fl, dt, frontMax, front, gasReleased, inReverse);
	wheelUpdateVelocity(rr, dt, driven, rear, gasReleased, inReverse);
	wheelUpdateVelocity(rl, dt, driven, rear, gasReleased, inReverse);
	limitDifferential(rl, rr);
	const traction = v.wheels.filter((w) => w.onGround && w.hasTraction).length;
	drain(B, dt);

	const df = downForce(v);
	const fwd = dot(B.v, at);
	let rearGrip = df, frontGrip = df;
	if (counterSteeringAtLowSpeed(v, fwd, ctl.steering, ctl.gas)) {
		const boosted = (Math.abs(Math.min(B.w[1], 3)) * P.base.lowSpeedTyreTractionControl + 1) * df;
		rearGrip = fwd >= -5 ? boosted : df;
		frontGrip = boosted;
	}
	wheelPairFriction(v, 2, 3, at, rearGrip, traction > 2, dt);
	drain(B, dt);
	wheelPairFriction(v, 0, 1, v.steerDir, frontGrip, traction > 2, dt);
	drain(B, dt);
	// Accumulated only; the caller's next drain applies it.
	if (v.crashing && 3500 > P.mass) for (const i of REAR_FIRST) crashScrub(v, i);
}
