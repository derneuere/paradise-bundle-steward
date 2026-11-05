// One vehicle update (step G5 of the frame): freezing, the handbrake latch,
// then either the driving update or the crashing update. Both accumulate
// forces and drain them into the body several times; neither moves the body
// (gravity and the pose integrate come later in the frame, see step.ts).
//
// Driving: aero, engine, steering, high-speed yaw damping, suspension,
// wheels and tyres, linear drag. Crashing: the same machinery with the body
// damped 0.5% per step, each body-axis spin clamped to 6.5 rad/s, the engine
// on half gas, aero pushing along the car's own down, the crash scrub on, and
// no drag, no yaw damping, no airborne rules.

import type { Vec3 } from '../deformationSpec';
import { dot, length, scale, sub } from '../deformationSim/state';
import { addLocalSpaceForce, drain, toBodyDir, toWorldDir, updateWorldInertia, velocityAt } from './body';
import { applyLinearDrag, downForce, updateDownForce } from './aero';
import { engineReset, updateEngine } from './engine';
import { calculateWheelPlane } from './ground';
import { steeredDirection, updateSteering } from './steering';
import { groundDistanceCheck, updateSuspension } from './suspension';
import { updateWheels } from './wheels';
import { MPS_TO_MPH, type Controls, type VehicleState } from './vehicleState';

export const MAX_CRASH_ANGULAR_VELOCITY = 6.5;
const CRASH_DAMPING = 0.995;
const EPS = 1.1920929e-7;

const forwardMph = (v: VehicleState) => dot(v.body.v, v.body.axes[2]) * MPS_TO_MPH;

export function updateVehicle(v: VehicleState, ctl: Controls, dt: number): void {
	updateFreezing(v, ctl, dt);
	updateHandBrake(v, ctl.handBrake, dt);
	if (v.frozen) {
		updateEngine(v, ctl, dt);
		v.timeCrashing = v.crashing ? v.timeCrashing + dt : 0;
	} else {
		if (v.crashing) updateCrashing(v, ctl, dt);
		else updateDriving(v, ctl, dt);
		v.speedMag = length(v.body.v);
	}
	v.numCollisions = 0;
}

// The game's only rest state: after a second with the wheels and body all
// but still and no pedal held, the car freezes (v = w = 0, no integration)
// until something moves it or a pedal wakes it.
export function updateFreezing(v: VehicleState, ctl: Controls, dt: number): void {
	const b = v.body;
	const spin = Math.max(...v.wheels.map((w) => Math.abs(w.omega)));
	const q = dot(b.v, b.v) + dot(b.w, b.w);
	v.timeStandingStill = !(Math.abs(q) > 0.5) ? v.timeStandingStill + dt : 0;
	let keepAwake = false;
	if (!(Math.abs(spin + q) > 0.25)) {
		v.coolDown += dt;
		if (ctl.brake + ctl.gas > 0.25 && ctl.handBrake > 0.15) keepAwake = true;
	} else v.coolDown = 0;
	if (Math.abs(ctl.brake + ctl.gas) > 0.25 && !keepAwake) v.coolDown = 0;
	v.frozen = v.coolDown > 1;
	if (v.frozen) { b.v = [0, 0, 0]; b.w = [0, 0, 0]; }
}

export function updateHandBrake(v: VehicleState, input: number, dt: number): void {
	if (v.handBrake) {
		v.handBrakeOnTime = Math.min(v.handBrakeOnTime + dt, 10000);
		if (input < 0.1 && (v.handBrakeOnTime > 0.275 || !(Math.abs(v.speedMph) > EPS))) {
			v.handBrake = false;
			v.handBrakeOnTime = 0;
			v.timeSinceLastHandBrake = 0;
		}
	} else if (input <= 0.1) v.timeSinceLastHandBrake = Math.min(v.timeSinceLastHandBrake + dt, 10000);
	else { v.handBrake = true; v.handBrakeOnTime = 0; }
}

// Airborne means no wheel down, moving faster than 1.8 m/s, and not resting
// a body contact on the ground.
export function updateInAirStats(v: VehicleState, dt: number): void {
	let air = !v.wheels.some((w) => w.onGround);
	if (air && v.numWorldCollisions !== 0 && v.aboveGround.valid && v.aboveGround.verticalDistance <= groundDistanceCheck(v)) air = false;
	if (air && !(Math.abs(v.speedMag) > 1.8)) air = false;
	if (air) { v.timeWithoutTraction += dt; v.timeWithTraction = 0; }
	else { v.timeWithoutTraction = 0; v.timeWithTraction += dt; }
	v.hasAir = air;
	v.engine.allowUp = v.engine.allowDown = !air;
}

export function updateDriving(v: VehicleState, ctl: Controls, dt: number): void {
	const b = v.body, P = v.params;
	v.speedMph = forwardMph(v);
	b.mass = P.mass;
	updateInAirStats(v, dt);
	updateWorldInertia(b);
	updateDownForce(v);
	updateEngine(v, ctl, dt);
	drain(b, dt);
	updateSteering(v, ctl.steering, ctl.gas, dt);
	// Above LowSpeedDrivingSpeed, yaw rate is bled off, up to the full
	// HighSpeedAngularDamping share per step at MaxSpeed (not dt-scaled).
	if (v.speedMph > P.base.lowSpeedDrivingMph && !v.handBrake) {
		const f = Math.min((v.speedMph - P.base.lowSpeedDrivingMph) / (P.base.maxSpeedMph - P.base.lowSpeedDrivingMph), 1);
		const up = b.axes[1];
		b.w = sub(b.w, scale(up, dot(up, b.w) * P.base.highSpeedAngularDamping * f));
	}
	updateSuspension(v, dt);
	v.allWheelsOnGround = v.wheels.every((w) => w.onGround);
	updateWheels(v, ctl, dt);
	drain(b, dt);
	if (!v.hasAir) applyLinearDrag(v);
	drain(b, dt);
	v.speedMph = forwardMph(v);
	v.crashedThisFrame = false;
	v.contactingWall = 0.4 > v.secondsSinceLastWallContact;
	v.secondsSinceLastWallContact += dt;
	calculateWheelPlane(v);
	v.timeCrashing = 0;
}

export function updateCrashing(v: VehicleState, ctl: Controls, dt: number): void {
	const b = v.body, P = v.params;
	const k = Math.pow(CRASH_DAMPING, 60 * dt);
	b.v = scale(b.v, k);
	b.w = scale(b.w, k);
	const wb = toBodyDir(b, b.w).map((x) => Math.min(Math.max(x, -MAX_CRASH_ANGULAR_VELOCITY), MAX_CRASH_ANGULAR_VELOCITY)) as Vec3;
	b.w = toWorldDir(b, wb);
	b.mass = P.mass;
	updateInAirStats(v, dt);
	const half: Controls = { ...ctl, gas: ctl.gas * 0.5 };
	updateWorldInertia(b);
	// Along the car's own down: an upside-down car is pushed up.
	addLocalSpaceForce(b, [0, -downForce(v), 0]);
	updateEngine(v, half, dt);
	drain(b, dt);
	updateSteering(v, half.steering, half.gas, dt);
	updateSuspension(v, dt);
	v.allWheelsOnGround = v.wheels.every((w) => w.onGround);
	updateWheels(v, ctl, dt);
	calculateWheelPlane(v);
	drain(b, dt);
	v.wheels.forEach((w, i) => { w.bodyPointVel = velocityAt(b, P.wheels[i].streamed, 'body'); });
	v.speedMph = forwardMph(v);
	v.crashedThisFrame = false;
	v.contactingWall = 0.4 > v.secondsSinceLastWallContact;
	v.secondsSinceLastWallContact += dt;
	v.timeCrashing += dt;
}

// The game's start-at-speed: give the body a velocity, then spin every wheel
// to roll freely at its hub's speed and pick the gear that speed belongs in.
// The yaw rate is dropped. Pose and wheel hubs are left as they are.
export function resetVehicle(v: VehicleState, velocity: Vec3, angular: Vec3 = [0, 0, 0]): void {
	const b = v.body, P = v.params;
	b.v = [...velocity] as Vec3;
	b.w = sub(angular, scale(b.axes[1], dot(angular, b.axes[1])));
	b.F = [0, 0, 0]; b.Tq = [0, 0, 0]; b.J = [0, 0, 0]; b.L = [0, 0, 0];
	v.steerAngle = v.steering = v.prevSteering = 0;
	const steer = steeredDirection(b.axes[1], b.axes[2], v.steerAngle);
	v.wheels.forEach((w, i) => {
		const pv = velocityAt(b, w.pos, 'body');
		w.torque = 0;
		w.omega = dot(pv, i < 2 ? steer : b.axes[2]) / P.wheels[i].radius;
		w.bodyPointVel = pv;
		w.broken = false;
		w.spring.pos = w.spring.vel = w.spring.acc = w.spring.ext = 0;
	});
	let sum = 0, n = 0;
	if (P.base.powerToRear !== 0) { sum += v.wheels[2].omega + v.wheels[3].omega; n += 2; }
	if (P.base.powerToFront !== 0) { sum += v.wheels[0].omega + v.wheels[1].omega; n += 2; }
	engineReset(v.engine, P.engine, sum / n);
	v.speedMph = 0; v.speedMag = 0;
	v.crashing = false; v.crashedThisFrame = false; v.crashClock = null; v.timeCrashing = 0; v.speedOnLastCrashMph = 0;
	v.brakeScale = 0; v.handBrake = false; v.hasAir = false; v.doingBurnout = false; v.frozen = false;
	v.timeStandingStill = v.coolDown = v.timeWithoutTraction = v.timeWithTraction = 0;
	v.handBrakeOnTime = 0; v.timeSinceLastHandBrake = 10000;
	v.numCollisions = 0; v.allWheelsOnGround = false;
	v.timeSinceHardLanding = 0;
	v.aabb = { min: [...P.aabb.min] as Vec3, max: [...P.aabb.max] as Vec3 };
}
