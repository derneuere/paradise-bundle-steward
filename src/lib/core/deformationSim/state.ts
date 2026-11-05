// Mutable state of one simulated car. Sensor, tag and driven-point positions
// are in the spec's own handling-body frame (car-local). The car body is a
// rigid body whose origin is the centre of mass, `com` in that frame, so a
// spec point p sits at `body.pos + R (p - com)` in the world.

import type { ParsedDeformationSpec, Vec3 } from '../deformationSpec';
import type { RigidBody } from '../vehicleSim/body';
import { AbsorptionSet } from './tables';
import type { CrashEvents } from './events';
import type { PaneState } from './glass';
import type { PotentialContact } from './world';

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const length = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
export const normalize = (a: Vec3): Vec3 => { const l = length(a); return l > 1e-12 ? scale(a, 1 / l) : [0, 0, 0]; };

export enum PartState { Unused = 0, NonDetachable = 1, AttachedIK = 2, Hinged = 3, Detached = 4 }

export type Hinge = { joint: number; tag: number; rot: number; vel: number; storedVel: Vec3 };
export type FreePart = { pos: Vec3; vel: Vec3; spin: Vec3; rotation: number[]; origin: Vec3 };

export type Obstacle = {
	kind: 'wall' | 'pole';
	point: Vec3;   // on the obstacle's surface, world
	normal: Vec3;  // unit, from the car into the obstacle (the wall's face points the other way)
	poleAxis: Vec3;
	poleRadius: number;
};

// What the car's own attribs contribute to a crash.
export type CarAttribs = {
	mass: number;
	crashExtraLinearVelocity: number;     // horizontal velocity boost on crash entry
	driveTimeLimits: [number, number, number, number]; // side, -Y, +Z, -Z crush limits outside a crash
	comOffset: Vec3;                      // authored centre-of-mass tweak; its x is ignored
};

// A sensor's one world contact for this step: the earliest one that closes
// during the step. `t` is the fraction of the step at which it closes; a
// record left at DISARMED holds nothing.
export type ImpulseRecord = { pA: Vec3; pB: Vec3; n: Vec3; t: number; surface: 'ground' | 'obstacle' };
export const DISARMED = 100;

// A contact kept for the penetration solve: the car point relative to the
// sensor's centre (body frame, so a later dent of the sensor moves it), the
// world point, the normal, and how far apart they will be after this step's
// motion (the store keeps the three smallest).
export type StoredContact = { localA: Vec3; B: Vec3; n: Vec3; projDist: number };

// The vehicle's own counters the contact impulses bump: world contacts this
// step (reset when the contact impulses start), all collisions, and the
// seconds since the last wall contact (zeroed by every world impulse).
export type ContactCounters = { numWorldCollisions: number; numCollisions: number; secondsSinceWallContact: number };

export type SimState = {
	spec: ParsedDeformationSpec;
	attribs: CarAttribs;
	absorptionSet: AbsorptionSet;
	crashing: boolean;         // false = a knock below crash speed (drive-time budget)
	sensors: Vec3[];         // live local sphere centres
	latch: number[];         // biggest impulse felt this step, per sensor
	scratch: number[];       // paint scratch per sensor, 0..0.75 (see scratch.ts)
	tags: Vec3[];
	driven: Vec3[];
	drivenNormal: Vec3[];
	aabb: { min: Vec3; max: Vec3 };  // deformed sensor box (always contains the origin)
	driveBox: { min: Vec3; max: Vec3 }; // crush limits for knocks below crash speed
	partState: PartState[];
	hinges: Map<number, Hinge>;
	free: Map<number, FreePart>;
	physicalParts: number;
	attachedExhausts: number;
	body: RigidBody;
	com: Vec3;                 // centre of mass in the spec frame
	// The spec origin's pose, derived from the body (read-only views).
	readonly carPos: Vec3;
	readonly carRot: number[]; // row-major 3x3, car-local -> world
	readonly carVel: Vec3;     // the body's (centre-of-mass) velocity
	readonly carSpin: Vec3;    // world angular velocity
	counters: ContactCounters;
	// Wheels as the contact code sees them, body frame: the hub sphere sits
	// at (pos.x, streamedY + scale/4, pos.z) with radius scale/2. A hub's
	// contacts are the contacts of its nearest sensor.
	wheelPos: Vec3[];
	wheelStreamedY: number[];
	wheelToSensor: number[];
	potential: PotentialContact[];  // this step's candidate contacts, in harvest order
	records: ImpulseRecord[];       // per sensor
	stored: StoredContact[][];      // per sensor, up to 3
	disp: Vec3[];                   // per sensor: its centre's motion this step
	obstacle: Obstacle | null;
	deformedThisStep: boolean;
	rows: Float32Array;      // 128 x vec4 skin offsets, the renderer's deformation rows
	time: number;
	glass: PaneState[];      // per spec glass pane
	events: CrashEvents;     // this step's contacts, loosened parts and glass breaks
};
