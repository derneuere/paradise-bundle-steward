// Engine and gearbox. A flywheel is pulled toward the driven wheels' speed
// through the clutch and pushed by the torque curve; its rpm picks the gear.
// The drive torque goes straight into the wheels' torque accumulators, and
// the tyres turn wheel spin into road force (tyres.ts). Gear changes are
// instant for every shipped car (GearChangeTime 0). There is no engine
// braking: a released throttle only lets the wheels freewheel down.
//
// Gear 0 is reverse; the attribs give gears 0-2 and 3-5 as two vectors.

import { dot } from '../deformationSim/state';
import type { VehicleParams } from './params';
import type { Controls, EngineState, VehicleState } from './vehicleState';

export const RAD_PER_SEC_TO_RPM = 9.54929638;
const RPM_TO_RAD_PER_SEC = 0.104719755;
export const IDLE_FLYWHEEL = 104.719757;   // 1000 rpm in rad/s
const TOP_GEAR = 5;
const EPS = 1.1920929e-7;

type EngineParams = VehicleParams['engine'];

// De Casteljau on three control points: lerp(lerp(a,b,t), lerp(b,c,t), t),
// t not clamped.
export const bezier3 = ([a, b, c]: readonly number[], t: number) => {
	const ab = a + (b - a) * t, bc = b + (c - b) * t;
	return ab + (bc - ab) * t;
};

const wheelRpm = (e: EngineParams, omega: number, gear: number) => Math.abs(omega * e.ratios[gear] * e.differential * RAD_PER_SEC_TO_RPM);

// The gear a wheel speed belongs in: the lowest forward gear whose shift-up
// rpm it doesn't exceed, reverse when rolling backwards.
export function computeGear(e: EngineParams, omega: number): number {
	if (!(omega >= -0.0099999998)) return 0;
	let g = 1;
	while (wheelRpm(e, omega, g) > e.upRpm[g] && g < TOP_GEAR) g++;
	return g;
}

export function engineReset(s: EngineState, e: EngineParams, omega: number): void {
	s.drive = 0; s.clutch = 0; s.fly = IDLE_FLYWHEEL;
	s.gear = computeGear(e, omega);
	s.rpm = wheelRpm(e, omega, s.gear);
	s.allowUp = s.allowDown = true;
	s.timer = 10;
}

// The redline in wheel rad/s for the current gear: the driven wheels are
// clamped to it, which is what makes a gear "rev out".
export function maxWheelOmega(s: EngineState, e: EngineParams): number {
	const d = e.ratios[s.gear] * e.differential * RAD_PER_SEC_TO_RPM;
	return d !== 0 ? e.maxRpm / d : 0;
}

export type EngineInput = {
	wheelOmega: number; gas: number; brake: number; handBrake: boolean; steering: number;
	allowReverse: boolean; forwardSpeed: number; dt: number;
};

export function engineUpdate(s: EngineState, e: EngineParams, inp: EngineInput): void {
	const { gas, brake, handBrake, steering, forwardSpeed: fwd, dt } = inp;
	let gear = s.gear, allowUp = s.allowUp;
	let timer = Math.min(s.timer + dt, 10);
	// Last step's rpm against twice the fall-off rpm: the curve peaks near the
	// fall-off rpm and reaches 0 at twice it.
	let torque = bezier3(e.torqueCurve, s.rpm / (2 * e.torqueFallOffRpm)) * e.torqueScale[gear] * gas;
	const wheelW = wheelRpm(e, inp.wheelOmega, gear) * RPM_TO_RAD_PER_SEC;

	let clutch = s.clutch;
	if (wheelW < IDLE_FLYWHEEL && gear === 1 && gas < 0.1) clutch = 0;
	if (Math.abs(gas) <= EPS && brake > 0.95 && gear !== 0) clutch = 0;
	if (handBrake && fwd <= 5) clutch = 0;
	if (e.gearChangeTime > timer) clutch = 0;
	if (clutch === 0 && gear > 1 && wheelW < 2 * IDLE_FLYWHEEL) gear = 1;

	// Below 8 m/s while steering, braking or rolling back, the box holds 1st
	// and the clutch slips (a burnout launch); rolling backwards doubles torque.
	let burn = 0;
	if (fwd < 8 && gear !== 0 && (Math.abs(steering) > 0.2 || brake > 0.1 || fwd < 0)) {
		gear = 1;
		allowUp = false;
		s.allowUp = false;
		if (fwd > 0) burn = 1 - fwd * 0.125;
		else { burn = 0.9; torque *= 2; }
	}

	let fly = s.fly;
	if (timer >= e.gearChangeTime) {
		// Not dt-scaled: the flywheel closes this share of the gap every step.
		fly += (wheelW - fly) * (1 - burn) * e.transmissionEfficiency * clutch;
		fly += (torque / e.flyWheelInertia) * dt;
		const sgn = fly > 0 ? 1 : fly < 0 ? -1 : 0;
		fly -= Math.min(fly * sgn, e.flyWheelFriction * sgn * dt);
	}
	fly = Math.min(e.maxRpm * RPM_TO_RAD_PER_SEC, Math.max(IDLE_FLYWHEEL, fly));
	const rpm = fly * RAD_PER_SEC_TO_RPM;

	let gearDownRpm = s.gearDownRpm;
	if (gear > 0) gearDownRpm = (e.upRpm[gear] * e.ratios[gear]) / e.ratios[gear - 1] - 50 * e.ratios[gear - 1];

	if (gear === 0 && brake > 0.1 && fwd > -5) { gear = 1; timer = 0; }
	else if (gear === 1 && inp.allowReverse && brake > 0.6 && gas * brake < 0.1) {
		gear = 0; timer = 0;
		if (!handBrake) clutch = 1;
	} else if (clutch <= EPS && clutch >= -EPS) {
		if (rpm > e.upRpm[gear] * 0.25 && !handBrake) clutch = 1;
	} else if (rpm > e.upRpm[gear] && gear >= 1 && gear < TOP_GEAR && allowUp) { gear++; timer = 0; }
	else if (gearDownRpm > rpm && gear > 1 && s.allowDown) { gear--; timer = 0; }

	s.drive = torque * clutch * e.ratios[gear] * e.differential;
	s.gear = gear; s.gearDownRpm = gearDownRpm; s.rpm = rpm; s.fly = fly; s.clutch = clutch; s.timer = timer;
}

// The vehicle side of the engine: pedal shaping, the reverse pedal swap, the
// low-speed counter-steer throttle cut, then drive torque into the wheels.
// Above MaxSpeed (start-of-step forward mph) the drive is cut: that bang-bang
// is the game's top-speed governor.
export function updateEngine(v: VehicleState, ctl: Controls, dt: number): void {
	const b = v.body, P = v.params;
	const gas = Math.min(Math.max(ctl.gas, 0), 1);
	const fwd = dot(b.axes[2], b.v);
	let driveScale = 1;
	if (counterSteeringAtLowSpeed(v, fwd, ctl.steering, gas)) {
		const yaw = Math.min(Math.max(Math.abs(b.w[1]) * 0.5, 0.25), 1);
		driveScale = 1 - P.base.lowSpeedThrottleTractionControl * 0.01 * yaw;
	}
	const reverse = v.engine.gear === 0;
	engineUpdate(v.engine, P.engine, {
		wheelOmega: Math.min(v.wheels[2].omega, v.wheels[3].omega),
		gas: reverse ? ctl.brake : gas, brake: reverse ? gas : ctl.brake,
		handBrake: v.handBrake, steering: ctl.steering,
		allowReverse: v.timeStandingStill > 0.25 || v.speedMph < -0.2,
		forwardSpeed: fwd, dt,
	});
	if (v.frozen) return;
	let d = v.engine.drive * driveScale;
	if (v.speedMph > P.base.maxSpeedMph) d = 0;
	const [fl, fr, rl, rr] = v.wheels;
	if (v.handBrake && !(5 > fwd)) { rl.torque += d; rr.torque += d; return; }
	rl.torque += d * P.base.powerToRear; rr.torque += d * P.base.powerToRear;
	fl.torque += d * P.base.powerToFront; fr.torque += d * P.base.powerToFront;
}

// Slow, on the throttle, and steering against a yaw: the game then trades
// throttle for tyre grip to help the car out of a spin.
export function counterSteeringAtLowSpeed(v: VehicleState, fwd: number, steering: number, gas: number): boolean {
	const yaw = v.body.w[1];
	return fwd < 20 && gas > 0.2 && ((yaw > 0.5 && steering >= -0.1) || (yaw < -0.5 && steering <= 0.1));
}
