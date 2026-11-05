// Mutable state of one simulated car. Every position is in the spec's own
// handling-body frame (car-local); the car itself only translates.

import type { ParsedDeformationSpec, Vec3 } from '../deformationSpec';
import { AbsorptionSet } from './tables';

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
	point: Vec3;   // on the obstacle's surface, handling frame at the moment of the hit
	normal: Vec3;  // unit, out of the obstacle toward the car
	poleAxis: Vec3;
	poleRadius: number;
};

// What the car's own attribs contribute to a crash.
export type CarAttribs = {
	mass: number;
	crashExtraLinearVelocity: number;     // horizontal velocity boost on crash entry
	driveTimeLimits: [number, number, number, number]; // side, -Y, +Z, -Z crush limits outside a crash
};

export type SimState = {
	spec: ParsedDeformationSpec;
	attribs: CarAttribs;
	invInertia: Vec3;          // body-local diagonal, solid box over the handling dimensions
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
	carPos: Vec3;
	carRot: number[];          // row-major 3x3, car-local -> world
	carVel: Vec3;
	carSpin: Vec3;             // world angular velocity
	obstacle: Obstacle | null;
	deformedThisStep: boolean;
	rows: Float32Array;      // 128 x vec4 skin offsets, the renderer's deformation rows
	time: number;
};
