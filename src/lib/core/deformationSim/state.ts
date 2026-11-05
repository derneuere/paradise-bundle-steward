// Mutable state of one simulated car. Sensor, tag and driven-point positions
// are in the spec's own handling-body frame (car-local). The car itself is
// the race car's driving state (vehicleSim): its rigid body's origin is the
// centre of mass, `com` in that frame, so a spec point p sits at
// `body.pos + R (p - com)` in the world, where the ground is y = 0.

import type { ParsedDeformationSpec, Vec3 } from '../deformationSpec';
import type { RigidBody } from '../vehicleSim/body';
import type { Box } from '../vehicleSim/params';
import type { VehicleState } from '../vehicleSim/vehicleState';
import type { Driver } from './absorption';
import { AbsorptionSet } from './tables';
import type { CrashEvents } from './events';
import type { PaneState } from './glass';
import type { CrashRun } from './scenario';
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
// A part knocked clean off flies on its own in the world: `pos` is where its
// pivot (`origin`, the part's mesh-frame locator origin) is, `rotation` its
// world orientation (row-major 3x3).
export type FreePart = { pos: Vec3; vel: Vec3; spin: Vec3; rotation: number[]; origin: Vec3 };

export type Obstacle = {
	kind: 'wall' | 'pole';
	point: Vec3;   // on the obstacle's surface, world
	normal: Vec3;  // unit, from the car into the obstacle (the wall's face points the other way)
	poleAxis: Vec3;
	poleRadius: number;
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

export type SimState = {
	spec: ParsedDeformationSpec;
	driver: Driver;
	absorptionSet: AbsorptionSet;  // the table in use this step (absorption.ts)
	// The car's driving and crashing state: its crashing flag decides which
	// crush rules apply (a crash or a knock), its counters count the contact
	// impulses, and its deformable box is the crash limit box.
	vehicle: VehicleState;
	body: RigidBody;           // the vehicle's own body (the same object)
	com: Vec3;                 // centre of mass in the spec frame (the vehicle params')
	sensors: Vec3[];         // live local sphere centres
	latch: number[];         // biggest impulse felt this step, per sensor
	scratch: number[];       // paint scratch per sensor, 0..0.75 (see scratch.ts)
	tags: Vec3[];
	driven: Vec3[];
	drivenNormal: Vec3[];
	driveBox: Box;           // crush limits for knocks (body frame)
	partState: PartState[];
	hinges: Map<number, Hinge>;
	free: Map<number, FreePart>;
	physicalParts: number;
	attachedExhausts: number;
	// A wheel hub's contacts are the contacts of its nearest sensor.
	wheelToSensor: number[];
	potential: PotentialContact[];  // this step's candidate contacts, in harvest order
	records: ImpulseRecord[];       // per sensor
	stored: StoredContact[][];      // per sensor, up to 3
	disp: Vec3[];                   // per sensor: its centre's motion this step
	obstacle: Obstacle | null;
	run: CrashRun | null;           // the drive into the obstacle, once a hit has started one
	deformedThisStep: boolean;
	rows: Float32Array;      // 128 x vec4 skin offsets, the renderer's deformation rows
	time: number;
	glass: PaneState[];      // per spec glass pane
	events: CrashEvents;     // this step's contacts, loosened parts and glass breaks
};
