// Crash simulator for one vehicle DeformationSpec, stepping the game's
// deformation model at its fixed 60 Hz: world contacts on the collision
// spheres -> impulses sized one after another from the car's live velocity ->
// sensor crush and chain passing -> detachment test -> IK (tag + driven
// points) -> skin rows.
//
// The car is a rigid body at its centre of mass (the mean of the four wheel
// positions in the spec), with gravity, sitting on the ground plane at y = 0.
// It meets the world the game's way (contacts.ts): only the part of each
// contact impulse the sensors did not absorb, plus the slide friction,
// reaches the body, at the contact point, and penetration is corrected by
// position alone. Until the vehicle's own wheels, suspension and crash clock
// drive it, the car stands on its sensor spheres (or wheel hub spheres,
// whichever reach lower) and a crash simply runs on until the ground's
// friction has stopped the car.

import type { ParsedDeformationSpec, Vec3 } from '../deformationSpec';
import { createBody, drain, integrate, rotationMatrix, toWorld, updateWorldInertia } from '../vehicleSim/body';
import { checkForDetachment, hingePoint, initialPartState, jointRotation, mul3, poseMatrix, updateFreeParts, updateHinges } from './parts';
import { driveTimeBox, updateDeformedBox } from './sensors';
import { drivenNormal, updateIK, updateSkinRows } from './ik';
import { clearContacts, collisionSpheres, generateContacts, hubSphere, nearestSensors, updateContacts } from './contacts';
import { solvePenetration } from './penetration';
import { clearEvents, emptyEvents, type CrashEvents } from './events';
import { freshPanes, updateGlass } from './glass';
import { add, cross, dot, normalize, scale, sub, type CarAttribs, type Obstacle, type SimState } from './state';
import { AbsorptionSet, STEP } from './tables';

export { AbsorptionSet } from './tables';
export type { CarAttribs } from './state';
export { GlassState } from './events';
export type { ContactEvent, CrashEvents, GlassEvent, PartEvent } from './events';

export type Impact = {
	pointMesh: Vec3;        // hit point on the body, mesh frame
	direction: Vec3;        // unit, into the car
	speed: number;          // closing speed, m/s
	obstacle?: 'wall' | 'pole';
	crash?: boolean;        // false: a knock below the car's crash speed
	// Degrees between the car's travel and the hit direction: 0 drives
	// straight into the obstacle, more slides the car along it (the obstacle
	// keeps facing the hit direction), which is what scratches the paint.
	glance?: number;
};
export type PartPose = { meshDelta: number[]; state: 'hinged' | 'detached' };

export type CrashSim = {
	readonly state: SimState;
	readonly rows: Float32Array;
	readonly partPoses: Map<number, PartPose>;   // keyed by GraphicsSpec part index
	readonly sensorCount: number;
	readonly tagCount: number;
	// The ground's height in the body mesh's frame while the car stands upright.
	readonly groundMesh: number;
	// Handling frame minus mesh frame: subtract it from a sim position to get
	// the body mesh's frame.
	readonly meshShift: Vec3;
	// What the last step produced (see events.ts).
	readonly events: CrashEvents;
	sensorPositionsMesh(): Vec3[];
	tagPositionsMesh(): Vec3[];
	obstacleMesh(): (Obstacle & { point: Vec3 }) | null;
};

const POLE_RADIUS = 0.15;
export const DEFAULT_ATTRIBS: CarAttribs = {
	mass: 1500, crashExtraLinearVelocity: 0.3, driveTimeLimits: [0.05, 0.2, 0.15, 0.4], comOffset: [0, 0, 0],
};

export const transpose = (m: number[]) => [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];

export function meshShift(spec: ParsedDeformationSpec): Vec3 {
	const t = spec.carModelSpaceToHandlingBodySpace[3];
	return [t[0], t[1], t[2]];
}

// The centre of mass in the spec frame: the mean of the four wheel positions
// plus the car's authored offset, whose x the game ignores.
export function centreOfMass(spec: ParsedDeformationSpec, comOffset: Vec3 = [0, 0, 0]): Vec3 {
	const mean = spec.wheels.reduce<Vec3>((a, w) => add(a, [w.position[0] / 4, w.position[1] / 4, w.position[2] / 4]), [0, 0, 0]);
	return add(mean, [0, comOffset[1], comOffset[2]]);
}

// The spec origin's pose, for code that still thinks of the car as a
// spec-frame object moved through the world.
const POSE_VIEWS: PropertyDescriptorMap = {
	carPos: { get(this: SimState) { return sub(this.body.pos, mul3(rotationMatrix(this.body), this.com)); } },
	carRot: { get(this: SimState) { return rotationMatrix(this.body); } },
	carVel: { get(this: SimState) { return this.body.v; } },
	carSpin: { get(this: SimState) { return this.body.w; } },
};

function freshState(spec: ParsedDeformationSpec, attribs: CarAttribs, absorptionSet: AbsorptionSet): SimState {
	const dims = spec.handlingBodyDimensions;
	const com = centreOfMass(spec, attribs.comOffset);
	const wheelPos = spec.wheels.map((w) => sub([w.position[0], w.position[1], w.position[2]], com));
	const s = {
		spec, attribs, absorptionSet, crashing: true,
		sensors: spec.sensors.map((x) => [...x.initialOffset] as Vec3),
		latch: spec.sensors.map(() => 0),
		scratch: spec.sensors.map(() => 0),
		tags: spec.tagPoints.map((t) => [...t.initialPosition] as Vec3),
		driven: spec.drivenPoints.map((d) => [...d.initialPos] as Vec3),
		drivenNormal: [],
		aabb: { min: [0, 0, 0], max: [0, 0, 0] }, driveBox: { min: [0, 0, 0], max: [0, 0, 0] },
		partState: [], hinges: new Map(), free: new Map(), physicalParts: 0,
		attachedExhausts: spec.ikParts.filter((p) => p.partType === 84 || p.partType === 85).length,
		body: createBody(attribs.mass, [dims[0], dims[1], dims[2]]), com,
		counters: { numWorldCollisions: 0, numCollisions: 0, secondsSinceWallContact: 0 },
		wheelPos, wheelStreamedY: wheelPos.map((p) => p[1]), wheelToSensor: [],
		potential: [], records: [], stored: [], disp: [],
		obstacle: null, deformedThisStep: false, rows: new Float32Array(512), time: 0,
		glass: [], events: emptyEvents(),
	} as unknown as SimState;  // TODO(types): the pose views are added just below
	Object.defineProperties(s, POSE_VIEWS);
	s.wheelToSensor = nearestSensors(s);
	clearContacts(s);
	s.glass = freshPanes(s);
	s.drivenNormal = spec.drivenPoints.map((_, i) => drivenNormal(s, i));
	s.partState = spec.ikParts.map((_, p) => initialPartState(s, p));
	updateDeformedBox(s);
	s.driveBox = driveTimeBox(s);
	placeAtRest(s);
	return s;
}

// Upright and still, the lowest collision sphere resting on the ground,
// centred over the world origin.
function placeAtRest(s: SimState): void {
	const b = s.body;
	b.axes = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
	b.v = [0, 0, 0]; b.w = [0, 0, 0];
	b.F = [0, 0, 0]; b.Tq = [0, 0, 0]; b.J = [0, 0, 0]; b.L = [0, 0, 0];
	updateWorldInertia(b);
	let lowest = Infinity;
	for (let i = 0; i < s.spec.numDeformationSensors; i++) lowest = Math.min(lowest, s.sensors[i][1] - s.spec.sensors[i].radius);
	for (let w = 0; w < 4; w++) { const h = hubSphere(s, w); lowest = Math.min(lowest, h.local[1] + s.com[1] - h.radius); }
	b.pos = [s.com[0], s.com[1] - lowest, s.com[2]];
}

export function createCrashSim(
	spec: ParsedDeformationSpec, opts: { attribs?: Partial<CarAttribs>; absorptionSet?: AbsorptionSet } = {},
): CrashSim {
	const shift = meshShift(spec);
	const toMesh = (p: Vec3) => sub(p, shift);
	const attribs = { ...DEFAULT_ATTRIBS, ...opts.attribs };
	return {
		state: freshState(spec, attribs, opts.absorptionSet ?? AbsorptionSet.Normal),
		partPoses: new Map<number, PartPose>(),
		sensorCount: spec.numDeformationSensors,
		tagCount: spec.tagPoints.length,
		get groundMesh() { return -this.state.carPos[1] - shift[1]; },
		meshShift: shift,
		get events() { return this.state.events; },
		get rows() { return this.state.rows; },
		sensorPositionsMesh() { return this.state.sensors.slice(0, spec.numDeformationSensors).map(toMesh); },
		tagPositionsMesh() { return this.state.tags.map(toMesh); },
		// The view keeps the car still, so the obstacle is drawn in the car's
		// frame (a car that tips sees the obstacle tip the other way).
		obstacleMesh() {
			const s = this.state, o = s.obstacle;
			if (!o) return null;
			const inv = transpose(s.carRot);
			return {
				...o,
				point: toMesh(mul3(inv, sub(o.point, s.carPos))),
				normal: mul3(inv, o.normal),
				poleAxis: mul3(inv, o.poleAxis),
			};
		},
	};
}

export function resetCrashSim(sim: CrashSim): void {
	const s = sim.state;
	Object.assign(s, freshState(s.spec, s.attribs, s.absorptionSet));
	sim.partPoses.clear();
}

export function setAbsorptionSet(sim: CrashSim, set: AbsorptionSet): void { sim.state.absorptionSet = set; }

// Starts a new impact: the car, in its current deformed shape, stands upright
// at rest and is set moving at `speed` into an obstacle placed against the
// hit point, turned by `glance` toward the obstacle's surface direction (the
// wall's horizontal, or across the pole). A crash also gets the car's extra
// horizontal crash velocity, as the game adds on crash entry.
export function applyImpact(sim: CrashSim, impact: Impact): void {
	const s = sim.state;
	const out = normalize(scale(impact.direction, -1));
	const kind = impact.obstacle ?? 'wall';
	const axis: Vec3 = Math.abs(out[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
	s.crashing = impact.crash ?? true;
	s.time = 0;
	placeAtRest(s);
	clearContacts(s);
	const poleAxis = normalize(sub(axis, scale(out, dot(axis, out))));
	const g = ((impact.glance ?? 0) * Math.PI) / 180;
	const v = scale(add(scale(out, Math.cos(g)), scale(normalize(cross(poleAxis, out)), Math.sin(g))), impact.speed);
	if (s.crashing) { v[0] *= 1 + s.attribs.crashExtraLinearVelocity; v[2] *= 1 + s.attribs.crashExtraLinearVelocity; }
	s.body.v = v;
	const hit = toWorld(s.body, sub(add(impact.pointMesh, meshShift(s.spec)), s.com));
	s.obstacle = { kind, point: sub(hit, scale(out, firstTouch(s, hit, out))), normal: out, poleAxis, poleRadius: POLE_RADIUS };
}

// How far the car can still travel along `out` before its first collision
// sphere touches the plane through `point` (negative when it overlaps).
function firstTouch(s: SimState, point: Vec3, out: Vec3): number {
	let best = -Infinity;
	for (const { centre, radius } of collisionSpheres(s)) best = Math.max(best, dot(centre, out) + radius);
	return dot(point, out) - best;
}

// The car body's part of a step until the vehicle's own update runs it: the
// contacts from the pose the step starts at, their impulses, gravity and the
// pose, then the penetration correction.
export function stepCarBody(s: SimState, dt: number): void {
	generateContacts(s);
	updateContacts(s, dt);
	drain(s.body, dt);
	integrate(s.body, dt);
	solvePenetration(s);
	s.time += dt;
}

export function stepCrashSim(sim: CrashSim, dt = STEP): void {
	const s = sim.state;
	clearEvents(s.events, s.carPos, s.carVel);
	// Before the first hit the car stands still, untouched.
	if (s.obstacle) stepCarBody(s, dt);
	if (s.deformedThisStep) {
		checkForDetachment(s);
		updateIK(s);
		updateSkinRows(s);
		updateGlass(s);
		updateDeformedBox(s);
	}
	updateHinges(s, dt);
	updateFreeParts(s, dt, sim.groundMesh);
	s.latch.fill(0);
	s.deformedThisStep = false;
	refreshPoses(sim);
}

function refreshPoses(sim: CrashSim): void {
	const s = sim.state;
	const shift = meshShift(s.spec);
	sim.partPoses.clear();
	for (const [p, h] of s.hinges) {
		const part = s.spec.ikParts[p], js = part.jointSpecs[h.joint], J = hingePoint(s, p);
		if (!js || !J) continue;
		sim.partPoses.set(part.partGraphics, {
			state: 'hinged',
			meshDelta: poseMatrix(jointRotation([js.axis[0], js.axis[1], js.axis[2]], h.rot), sub(J, shift)),
		});
	}
	for (const [p, f] of s.free) {
		sim.partPoses.set(s.spec.ikParts[p].partGraphics, {
			state: 'detached', meshDelta: poseMatrix(f.rotation, f.origin, sub(f.pos, f.origin)),
		});
	}
}
