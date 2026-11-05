// Crash simulator for one vehicle DeformationSpec, stepping the game's
// deformation model at its fixed 60 Hz: obstacle contacts on the sensor
// spheres -> impulses solved at each contact point -> sensor crush and chain
// passing -> detachment test -> IK (tag + driven points) -> skin rows.
//
// The deformation maths is the game's, and so is the way the car meets the
// world: its collision shape is the sensor spheres, contacts are solved one
// after another, only the part of each impulse the sensor did not absorb
// reaches the car body, and penetration is corrected by position alone. Each
// contact is sized with the car's full effective mass (box inertia included),
// and a crashing car's slide along the obstacle is braked by every contact
// (friction.ts). What the editor leaves out of the full vehicle physics:
// gravity, tyres and ground, so the car body only translates (it would
// otherwise spin freely with nothing to stop it).

import type { ParsedDeformationSpec, Vec3 } from '../deformationSpec';
import { checkForDetachment, hingePoint, initialPartState, jointRotation, mul3, poseMatrix, updateFreeParts, updateHinges } from './parts';
import { applySensorImpulse, driveTimeBox, updateDeformedBox } from './sensors';
import { drivenNormal, updateIK, updateSkinRows } from './ik';
import { scratchSensor } from './scratch';
import { slideAcross, slideFriction } from './friction';
import { clearEvents, emptyEvents, type CrashEvents } from './events';
import { freshPanes, updateGlass } from './glass';
import { add, cross, dot, length, normalize, scale, sub, type CarAttribs, type Obstacle, type SimState } from './state';
import { AbsorptionSet, IMPULSE_SHAPING, STEP } from './tables';

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
const STOP_SPEED = 0.05;
// Slide friction alone leaves a long scrape still creeping after seconds; in the game
// the ground, the tyres and the end of the crash stop it. This cap stands in
// for them.
const MAX_CONTACT_TIME = 3;
export const DEFAULT_ATTRIBS: CarAttribs = { mass: 1500, crashExtraLinearVelocity: 0.3, driveTimeLimits: [0.05, 0.2, 0.15, 0.4] };
const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export const transpose = (m: number[]) => [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];

export function meshShift(spec: ParsedDeformationSpec): Vec3 {
	const t = spec.carModelSpaceToHandlingBodySpace[3];
	return [t[0], t[1], t[2]];
}

// Solid box over the handling dimensions (half extents), as the game builds it.
function boxInverseInertia(spec: ParsedDeformationSpec, mass: number): Vec3 {
	const e = [0, 1, 2].map((k) => 2 * spec.handlingBodyDimensions[k]);
	const I = [e[1] * e[1] + e[2] * e[2], e[0] * e[0] + e[2] * e[2], e[0] * e[0] + e[1] * e[1]].map((v) => (mass / 12) * v);
	return I.map((v) => (v > 0 ? 1 / v : 0)) as Vec3;
}

function freshState(spec: ParsedDeformationSpec, attribs: CarAttribs, absorptionSet: AbsorptionSet): SimState {
	const s: SimState = {
		spec, attribs, invInertia: boxInverseInertia(spec, attribs.mass), absorptionSet, crashing: true,
		sensors: spec.sensors.map((x) => [...x.initialOffset] as Vec3),
		latch: spec.sensors.map(() => 0),
		scratch: spec.sensors.map(() => 0),
		tags: spec.tagPoints.map((t) => [...t.initialPosition] as Vec3),
		driven: spec.drivenPoints.map((d) => [...d.initialPos] as Vec3),
		drivenNormal: [],
		aabb: { min: [0, 0, 0], max: [0, 0, 0] }, driveBox: { min: [0, 0, 0], max: [0, 0, 0] },
		partState: [], hinges: new Map(), free: new Map(), physicalParts: 0,
		attachedExhausts: spec.ikParts.filter((p) => p.partType === 84 || p.partType === 85).length,
		carPos: [0, 0, 0], carRot: [...IDENTITY], carVel: [0, 0, 0], carSpin: [0, 0, 0],
		obstacle: null, deformedThisStep: false, rows: new Float32Array(512), time: 0,
		glass: [], events: emptyEvents(),
	};
	s.glass = freshPanes(s);
	s.drivenNormal = spec.drivenPoints.map((_, i) => drivenNormal(s, i));
	s.partState = spec.ikParts.map((_, p) => initialPartState(s, p));
	updateDeformedBox(s);
	s.driveBox = driveTimeBox(s);
	return s;
}

export function createCrashSim(
	spec: ParsedDeformationSpec, opts: { attribs?: Partial<CarAttribs>; absorptionSet?: AbsorptionSet } = {},
): CrashSim {
	const shift = meshShift(spec);
	const toMesh = (p: Vec3) => sub(p, shift);
	const wheelBottom = Math.min(...spec.wheels.map((w) => w.position[1] - w.direction[0]));
	const attribs = { ...DEFAULT_ATTRIBS, ...opts.attribs };
	return {
		state: freshState(spec, attribs, opts.absorptionSet ?? AbsorptionSet.Normal),
		partPoses: new Map<number, PartPose>(),
		sensorCount: spec.numDeformationSensors,
		tagCount: spec.tagPoints.length,
		groundMesh: Number.isFinite(wheelBottom) ? wheelBottom - shift[1] : -0.5,
		meshShift: shift,
		get events() { return this.state.events; },
		get rows() { return this.state.rows; },
		sensorPositionsMesh() { return this.state.sensors.slice(0, spec.numDeformationSensors).map(toMesh); },
		tagPositionsMesh() { return this.state.tags.map(toMesh); },
		// The view keeps the car still, so the obstacle is drawn in the car's frame.
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

// Starts a new impact: the car, in its current deformed shape, drives at
// `speed` into an obstacle placed against the hit point, turned by `glance`
// toward the obstacle's surface direction (the wall's horizontal, or across
// the pole). A crash also gets the car's extra horizontal crash velocity, as
// the game adds on crash entry.
export function applyImpact(sim: CrashSim, impact: Impact): void {
	const s = sim.state;
	const out = normalize(scale(impact.direction, -1));
	const kind = impact.obstacle ?? 'wall';
	const axis: Vec3 = Math.abs(out[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
	s.crashing = impact.crash ?? true;
	s.carPos = [0, 0, 0];
	s.carRot = [...IDENTITY];
	s.carSpin = [0, 0, 0];
	s.time = 0;
	const poleAxis = normalize(sub(axis, scale(out, dot(axis, out))));
	const g = ((impact.glance ?? 0) * Math.PI) / 180;
	const v = scale(add(scale(out, Math.cos(g)), scale(normalize(cross(poleAxis, out)), Math.sin(g))), impact.speed);
	if (s.crashing) { v[0] *= 1 + s.attribs.crashExtraLinearVelocity; v[2] *= 1 + s.attribs.crashExtraLinearVelocity; }
	s.carVel = v;
	s.obstacle = {
		kind, point: add(impact.pointMesh, meshShift(s.spec)), normal: out,
		poleAxis, poleRadius: POLE_RADIUS,
	};
	s.carPos = scale(out, firstTouch(s));
}

// How far the car can still travel along the hit normal before its first
// sensor sphere touches the obstacle plane (negative when it overlaps).
function firstTouch(s: SimState): number {
	const o = s.obstacle!;
	let best = -Infinity;
	for (let i = 0; i < s.spec.numDeformationSensors; i++) {
		best = Math.max(best, dot(s.sensors[i], o.normal) + s.spec.sensors[i].radius);
	}
	return dot(o.point, o.normal) - best;
}

type Contact = { sensor: number; t: number; depth: number; n: Vec3; point: Vec3; key: number };

const worldSensor = (s: SimState, i: number) => add(s.carPos, mul3(s.carRot, s.sensors[i]));
const pointVelocity = (v: Vec3, spin: Vec3, arm: Vec3) => add(v, cross(spin, arm));

function findContacts(s: SimState, dt: number): Contact[] {
	const o = s.obstacle;
	if (!o) return [];
	const heading = normalize(s.carVel);
	const out: Contact[] = [];
	for (let i = 0; i < s.spec.numDeformationSensors; i++) {
		const hit = sphereDepth(s, i);
		if (!hit) continue;
		const { depth, n } = hit;
		const point = sub(worldSensor(s, i), scale(n, s.spec.sensors[i].radius));
		const closing = -dot(pointVelocity(s.carVel, s.carSpin, sub(point, s.carPos)), n) * dt;
		if (closing <= 0 || depth + closing <= 0) continue;
		const t = depth >= 0 ? 0 : -depth / closing;
		if (t <= 1) out.push({ sensor: i, t, depth, n, point, key: dot(heading, n) });
	}
	// Earliest first; contacts within 0.1 of a step of each other go most
	// head-on first. Not a strict weak order, hence an insertion sort.
	for (let i = 1; i < out.length; i++) {
		const c = out[i];
		let j = i - 1;
		while (j >= 0 && (Math.abs(out[j].t - c.t) > 0.1 ? out[j].t > c.t : out[j].key > c.key)) { out[j + 1] = out[j]; j--; }
		out[j + 1] = c;
	}
	return out;
}

function resolveContacts(s: SimState, dt: number): void {
	const invMass = 1 / s.attribs.mass;
	const toLocal = transpose(s.carRot);
	// World inverse inertia: rotate into the body frame, scale by the diagonal, rotate back.
	const invI = (v: Vec3): Vec3 => {
		const l = mul3(toLocal, v);
		return mul3(s.carRot, [l[0] * s.invInertia[0], l[1] * s.invInertia[1], l[2] * s.invInertia[2]]);
	};
	let solveVel = s.carVel, solveSpin = s.carSpin;
	let bodyVel = s.carVel;
	const contacts = findContacts(s, dt);
	for (const c of contacts) {
		const arm = sub(c.point, s.carPos);
		const relVel = pointVelocity(solveVel, solveSpin, arm);
		const vn = dot(relVel, c.n);
		if (vn >= 0) continue;
		const rn = cross(arm, c.n);
		const k = invMass + dot(c.n, cross(invI(rn), arm));
		const magnitude = IMPULSE_SHAPING * Math.abs(vn / k);
		const rest = applySensorImpulse(s, {
			sensor: c.sensor, direction: mul3(toLocal, c.n), magnitude, closingSpeed: Math.abs(vn), invMass: k, dt,
		});
		// Slide, scratch and friction read the car body's own velocity as it
		// stands after the contacts before this one (the solver's mid-step
		// spin is not the body's), so a straight hit neither scratches nor brakes.
		const slide = slideAcross(bodyVel, c.n);
		const scratch = scratchSensor(s, c.sensor, bodyVel, c.n, magnitude, dt);
		s.events.contacts.push({
			sensor: c.sensor, point: c.point, normal: c.n, impulse: magnitude, closingSpeed: Math.abs(vn),
			slide: slide.slide, scratch,
		});
		const J = scale(c.n, magnitude);
		const friction = slideFriction(s, slide, magnitude, dt);
		solveVel = add(add(solveVel, scale(J, invMass)), friction);
		solveSpin = add(solveSpin, invI(cross(arm, J)));
		bodyVel = add(add(bodyVel, scale(mul3(s.carRot, rest), invMass)), friction);
	}
	s.carVel = bodyVel;
	s.carPos = add(s.carPos, scale(s.carVel, dt));
	// Penetration is resolved by moving the car, never by changing its velocity.
	solvePenetration(s);
	s.time += dt;
	if (length(s.carVel) < STOP_SPEED || s.time > MAX_CONTACT_TIME) s.carVel = [0, 0, 0];
}

// Position-only penetration solve over every sensor sphere: relax each
// overlap in turn, a few sweeps, so a narrow pole can't slip between spheres.
const PENETRATION_SWEEPS = 4;

function sphereDepth(s: SimState, i: number): { depth: number; n: Vec3 } | null {
	const o = s.obstacle!;
	const w = worldSensor(s, i), r = s.spec.sensors[i].radius;
	if (o.kind === 'wall') return { depth: dot(sub(w, o.point), o.normal) + r, n: scale(o.normal, -1) };
	const d = sub(w, add(o.point, scale(o.normal, o.poleRadius)));
	const perp = sub(d, scale(o.poleAxis, dot(d, o.poleAxis)));
	const dist = length(perp);
	return dist < 1e-6 ? null : { depth: o.poleRadius + r - dist, n: scale(perp, 1 / dist) };
}

function solvePenetration(s: SimState): void {
	if (!s.obstacle) return;
	for (let sweep = 0; sweep < PENETRATION_SWEEPS; sweep++) {
		let moved = false;
		for (let i = 0; i < s.spec.numDeformationSensors; i++) {
			const c = sphereDepth(s, i);
			if (!c || c.depth <= 1e-5) continue;
			s.carPos = add(s.carPos, scale(c.n, c.depth));
			moved = true;
		}
		if (!moved) return;
	}
}

export function stepCrashSim(sim: CrashSim, dt = STEP): void {
	const s = sim.state;
	clearEvents(s.events, s.carPos, s.carVel);
	if (length(s.carVel) > 0) resolveContacts(s, dt);
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
