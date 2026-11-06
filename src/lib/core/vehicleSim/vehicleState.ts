// The race car's whole simulation state: the rigid body, four wheels with
// their suspension springs and road contacts, the engine, and the timers and
// flags the game keeps between steps. Plain data; the step functions mutate it.
//
// Wheel order is the game's: 0 front left, 1 front right, 2 rear left,
// 3 rear right. Wheel positions are body-frame (centre of mass origin); only
// the hub's y moves, between the params' yMin and yMax.

import type { Vec3 } from '../deformationSpec';
import { createBody, GRAVITY, type RigidBody } from './body';
import type { Box, VehicleParams } from './params';

export const WHEEL_INERTIA = 30;
export const UNSPRUNG_MASS = 30;
export const MPS_TO_MPH = 2.2369363;

// The pad, as the game's driver controls hand it to the physics. Pedals are
// 0..1; steering is -1..1 with positive steering toward the car's left (-x).
export type Controls = { gas: number; brake: number; handBrake: number; steering: number };
export const NO_INPUT: Controls = { gas: 0, brake: 0, handBrake: 0, steering: 0 };

export type Surface = { grip: number; roughness: number; linearDrag: number };
export const DEFAULT_SURFACE: Surface = { grip: 1, roughness: 0, linearDrag: 0 };

export type Spring = { k: number; c: number; m: number; pos: number; vel: number; acc: number; ext: number };

export type WheelState = {
	pos: Vec3;               // hub, body frame
	omega: number;           // spin, rad/s
	torque: number;          // drive/brake torque accumulated this step
	inertia: number; invInertia: number;
	contact: { pos: Vec3; normal: Vec3; lineDist: number; surface: Surface };
	onGround: boolean; wasOnGround: boolean; closeToGround: boolean; lineValid: boolean; hasTraction: boolean;
	broken: boolean;         // past the adhesive cone last step (dynamic friction)
	massOnWheel: number;
	bodyPointVel: Vec3;
	spring: Spring;
	// A wheel the crush has bent out of line is twisted: it no longer turns
	// (its spin is held at 0) and leans by twistAmount radians. A twisted wheel
	// pushed further at speed comes off the car (detached) and stops being a
	// wheel: no road contact, spring or tyre forces.
	twisted: boolean;
	twistAmount: number;
	detached: boolean;
};

export type EngineState = {
	gear: number; rpm: number; fly: number; clutch: number; drive: number; timer: number;
	allowUp: boolean; allowDown: boolean; gearDownRpm: number;
};

export type CrashClock = { secs: number; extensions: number; maxExtensions: number; stillFor: number; elapsed: number; over: boolean };

export type VehicleState = {
	params: VehicleParams;
	body: RigidBody;
	wheels: [WheelState, WheelState, WheelState, WheelState];
	engine: EngineState;
	speedMph: number;              // signed forward speed, refreshed at fixed points of the step
	speedMag: number;              // |v| cached at the end of each vehicle update
	hasAir: boolean; hadAir: boolean; timeWithoutTraction: number; timeWithTraction: number;
	// The jump in progress: the pitch, yaw and roll rates (body axes) the car
	// left the ground with, the per-step roll bleed it set, and whether the
	// car has rolled past the landing-assist threshold since.
	takeOff: { rates: Vec3; rollBleed: number; rolling: boolean };
	// How long the car has sat stopped against a wall with a wheel off the
	// road; from half a second on, a wheel close to the road counts as on it.
	beachedTime: number;
	timeStandingStill: number; coolDown: number; frozen: boolean;
	handBrake: boolean; handBrakeOnTime: number; timeSinceLastHandBrake: number;
	brakeScale: number;
	steerAngle: number; steering: number; prevSteering: number; maxSteerDeg: number; steerDir: Vec3;
	timeSinceHardLanding: number;
	secondsSinceLastWallContact: number; contactingWall: boolean;
	numWorldCollisions: number; numCollisions: number;
	aboveGround: { valid: boolean; pos: Vec3; normal: Vec3; verticalDistance: number; surface: Surface };
	wheelPlane: { valid: boolean; pos: Vec3; height: number };
	allWheelsOnGround: boolean; doingBurnout: boolean;
	crashing: boolean; crashedThisFrame: boolean; timeCrashing: number; speedOnLastCrashMph: number;
	crashNormal: Vec3; crashPointBody: Vec3;
	crashClock: CrashClock | null;
	aabb: Box;                     // live deformable box (body frame); the contact side may grow it
};

const v0 = (): Vec3 => [0, 0, 0];

function createWheel(p: VehicleParams, i: number): WheelState {
	const w = p.wheels[i];
	return {
		pos: [...w.streamed] as Vec3, omega: 0, torque: 0, inertia: WHEEL_INERTIA, invInertia: 1 / WHEEL_INERTIA,
		contact: { pos: v0(), normal: v0(), lineDist: 0, surface: DEFAULT_SURFACE },
		onGround: false, wasOnGround: false, closeToGround: false, lineValid: false, hasTraction: false, broken: false,
		massOnWheel: 0, bodyPointVel: v0(),
		spring: { k: (p.mass * w.scaler * GRAVITY) / p.susp.restDisp, c: p.susp.dampening, m: w.scaler * p.mass, pos: 0, vel: 0, acc: 0, ext: 0 },
		twisted: false, twistAmount: 0, detached: false,
	};
}

// A car at rest at `pos` (centre of mass, world) facing +z. Use
// `resetVehicle` to start it moving.
export function createVehicle(params: VehicleParams, pos: Vec3 = [0, 0, 0]): VehicleState {
	return {
		params, body: createBody(params.mass, params.halfExtent, pos),
		wheels: [0, 1, 2, 3].map((i) => createWheel(params, i)) as VehicleState['wheels'],
		engine: { gear: 1, rpm: 0, fly: 0, clutch: 0, drive: 0, timer: 10, allowUp: true, allowDown: true, gearDownRpm: 0 },
		speedMph: 0, speedMag: 0,
		hasAir: false, hadAir: false, takeOff: { rates: v0(), rollBleed: 0, rolling: false }, beachedTime: 0,
		timeWithoutTraction: 0, timeWithTraction: 0, timeStandingStill: 0, coolDown: 0, frozen: false,
		handBrake: false, handBrakeOnTime: 0, timeSinceLastHandBrake: 10000, brakeScale: 0,
		steerAngle: 0, steering: 0, prevSteering: 0, maxSteerDeg: 0, steerDir: [0, 0, 1],
		// Long past any landing: the landing damping only follows a real hard landing.
		timeSinceHardLanding: 100, secondsSinceLastWallContact: 0.4, contactingWall: false,
		numWorldCollisions: 0, numCollisions: 0,
		aboveGround: { valid: false, pos: v0(), normal: v0(), verticalDistance: 0, surface: DEFAULT_SURFACE },
		wheelPlane: { valid: false, pos: v0(), height: 0 },
		allWheelsOnGround: false, doingBurnout: false,
		crashing: false, crashedThisFrame: false, timeCrashing: 0, speedOnLastCrashMph: 0,
		crashNormal: v0(), crashPointBody: v0(), crashClock: null,
		aabb: { min: [...params.aabb.min] as Vec3, max: [...params.aabb.max] as Vec3 },
	};
}

