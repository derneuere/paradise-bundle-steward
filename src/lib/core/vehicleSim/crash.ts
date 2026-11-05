// When a race car crashes against the world, what crashing does to the body
// on entry, and how long the crash lasts.
//
// The arm reads each world contact before the vehicle update. A crash needs
// one of: a head-on hit on the front face of the car's box with the centre of
// mass closing on the surface at >= 40.5 m/s along its normal; a hit anywhere
// else above the centre of mass with that point closing at >= 50 m/s; or the
// car rolled past 80 degrees onto upward-facing ground. Anything less is a
// knock: the car keeps driving and the contact impulse is quartered (see
// applyContactImpulse). Those thresholds are high (about 91 mph straight
// into a wall), so callers may force a crash instead, as the game's own
// debug "force crash" does.
//
// Physics never ends a crash. The game's crash camera does: 4 s, extended to
// 1 s left each time it is about to run out while the car is still moving,
// at most 10 times, so 4 to 11.5 s in all.

import type { Vec3 } from '../deformationSpec';
import { add, cross, dot, length, scale, sub } from '../deformationSim/state';
import { addWorldAngImpulse, addWorldImpulse, impulsesFromLocal, toBody } from './body';
import { MPS_TO_MPH, type CrashClock, type VehicleState } from './vehicleState';

// A world contact as the arm sees it: `pointA` on the car, `pointB` on the
// world, `normal` pointing out of the world into the car. World frame.
export type ArmContact = { pointA: Vec3; pointB: Vec3; normal: Vec3 };
export type CrashKind = 'headOn' | 'side' | 'rolled' | 'forced';
export type CrashThresholds = { headOn: number; side: number };
export const CRASH_THRESHOLDS: CrashThresholds = { headOn: 40.5, side: 50 };

const HEAD_ON_SPEED_RANGE = 200;
const HEAD_ON_COS_STOPPED = -0.7;
const HEAD_ON_COS_AT_SPEED = -0.53;
const FRONT_FACE_DEPTH = 0.3;
const ROLLED_UP_COS = 0.17364818;   // cos 80 degrees
const ROLLED_MIN_NORMAL_Y = 0.1;

export type ArmResult = {
	kind: CrashKind | null;
	approaching: boolean;    // not separating within one step
	closingSpeed: number;    // COM speed into the surface (head-on rule's measure)
	pointClosingSpeed: number;
	onFrontFace: boolean;
};

export function worldCrashArm(v: VehicleState, c: ArmContact, dt: number, thresholds = CRASH_THRESHOLDS, vulnerability = 1): ArmResult {
	const b = v.body, n = c.normal;
	const pv = add(b.v, cross(b.w, sub(c.pointA, b.pos)));
	const closingSpeed = -dot(n, b.v), pointClosingSpeed = -dot(n, pv);
	const res: ArmResult = { kind: null, approaching: false, closingSpeed, pointClosingSpeed, onFrontFace: false };
	if (dot(sub(add(c.pointA, scale(pv, dt)), c.pointB), n) > 0) return res;
	res.approaching = true;
	const local = toBody(b, c.pointB);
	const fwd = Math.min(Math.max(dot(b.v, b.axes[2]), 0), HEAD_ON_SPEED_RANGE);
	// The cone narrows a little with speed: from 134 to 122 degrees off At.
	const cone = (fwd / HEAD_ON_SPEED_RANGE) * (HEAD_ON_COS_AT_SPEED - HEAD_ON_COS_STOPPED) + HEAD_ON_COS_STOPPED;
	const headOnDir = cone > dot(n, b.axes[2]);
	const box = v.aabb;
	res.onFrontFace = local[0] >= box.min[0] && box.max[0] >= local[0] && local[2] >= box.max[2] - FRONT_FACE_DEPTH;
	const headOn = res.onFrontFace && headOnDir && closingSpeed * vulnerability >= thresholds.headOn;
	const side = !res.onFrontFace && pointClosingSpeed * vulnerability >= thresholds.side && local[1] > 0;
	const rolled = ROLLED_UP_COS > b.axes[1][1] && n[1] > ROLLED_MIN_NORMAL_Y;
	res.kind = headOn ? 'headOn' : side ? 'side' : rolled ? 'rolled' : null;
	return res;
}

// Crash entry. The wheels spin to the car's forward speed; the world-frame
// spin components and the horizontal velocity are boosted by the attribs'
// crash factors (spin is near zero here, so the real spin comes later from
// the contacts and the scrub); the deformable box is reset to the rest box.
// An already-crashing car is left alone.
export function setCrashing(v: VehicleState, normal: Vec3 = [0, 0, 0], pointBody: Vec3 = [0, 0, 0], shortCrash = false): boolean {
	if (v.crashing) return false;
	const b = v.body, P = v.params;
	v.crashing = v.crashedThisFrame = true;
	const fwd = dot(b.v, b.axes[2]);
	v.wheels.forEach((w, i) => { w.torque = 0; w.omega = fwd / P.wheels[i].radius; w.broken = false; });
	v.speedOnLastCrashMph = v.speedMag * MPS_TO_MPH;
	const f = P.base.crashExtraAngular;
	b.w = [b.w[0] * (1 + f[0]), b.w[1] * (1 + f[1]), b.w[2] * (1 + f[2])];
	const k = P.base.crashExtraLinear;
	b.v = [b.v[0] * (1 + k), b.v[1], b.v[2] * (1 + k)];
	v.aabb = { min: [...P.aabb.min] as Vec3, max: [...P.aabb.max] as Vec3 };
	v.crashNormal = normal;
	v.crashPointBody = pointBody;
	v.timeCrashing = 0;
	v.crashClock = createCrashClock(shortCrash);
	return true;
}

export const createCrashClock = (shortCrash = false, maxExtensions = 10): CrashClock =>
	({ secs: shortCrash ? 3 : 4, extensions: 0, maxExtensions, stillFor: 0, elapsed: 0, over: false });

// One frame of the crash clock. "Still" means forward speed within 6.5 mph
// and spin under 1.5 rad/s; a car still for a second gets no more extensions.
export function tickCrashClock(c: CrashClock, speedMph: number, w: Vec3, dt: number): boolean {
	if (c.over) return true;
	const before = c.secs;
	c.secs -= dt;
	c.elapsed += dt;
	c.stillFor += dt;
	if (Math.abs(speedMph) > 6.5 || length(w) > 1.5) c.stillFor = 0;
	if (c.secs < 0.25 && before >= 0.25 && c.extensions < c.maxExtensions && c.stillFor < 1) {
		c.secs = 1;
		c.extensions++;
	}
	c.over = c.secs < 0;
	return c.over;
}

// How a contact impulse reaches the body, by the car's state. `jBody` is the
// body-frame impulse, `pos` the contact point (world), `worldDir` the world
// contact normal (for the knock rule).
// - Crashing: applied in full at the point (car-car spin scaled by the
//   attribs).
// - Not crashing, against the world (a knock): quartered; on anything but a
//   floor-like normal the vertical part is dropped and the lever is pulled to
//   the centre-of-mass height and 70% of its length, so a knock shoves and
//   yaws the car but does not flip it.
// Car-car contacts while driving are not modelled.
export function applyContactImpulse(v: VehicleState, jBody: Vec3, pos: Vec3, worldContact: boolean, worldDir: Vec3): void {
	const b = v.body;
	v.numCollisions++;
	if (v.crashing) {
		const { linear, angular } = impulsesFromLocal(b, jBody, 'body', pos, 'world');
		if (worldContact) { v.numWorldCollisions++; v.secondsSinceLastWallContact = 0; }
		addWorldImpulse(b, linear);
		addWorldAngImpulse(b, worldContact ? angular : scale(angular, v.params.carAngularImpulseScale));
		return;
	}
	if (!worldContact) return;
	v.numWorldCollisions++;
	v.secondsSinceLastWallContact = 0;
	const j = scale(jBody, 0.25);
	const p = toBody(b, pos);
	if (worldDir[1] < 0.65) { j[1] = 0; p[1] = 0; p[2] *= 0.7; }
	const { linear, angular } = impulsesFromLocal(b, j, 'body', p, 'body');
	addWorldImpulse(b, linear);
	addWorldAngImpulse(b, angular);
}

