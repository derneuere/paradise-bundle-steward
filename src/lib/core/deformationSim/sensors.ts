// How one contact impulse crushes the sensors. The hit sensor absorbs part of
// the impulse along each crush direction the impulse has a component on and
// moves inward by it; half of what it absorbed is passed down that
// direction's sensor chain (nextSensor), each link crushing by its own
// absorption until the chain ends at the car body.
//
// A chain names its links by scene slot: slot 0 is the car body, and slot n
// is the sensor whose sceneIndex is n (the game registers each sensor at its
// sceneIndex, a later one taking over a slot an earlier one had).

import type { ParsedDeformationSpec, Vec3 } from '../deformationSpec';
import { add, dot, scale, sub, type SimState } from './state';
import {
	ABSORPTION, COMPRESSION_LIMIT_FACTOR, CRASH_BUDGET, CRASH_LIMIT_PAD, DIRECTIONS, DIRECTION_SPEED_SCALE, DRIVE_BUDGET,
} from './tables';

// A crashing car may use its whole crush budget and absorption, measured
// from its current deformed shape; a knock below crash speed gets a fifth of
// both, inside the car's fixed drive-time limits.
const allowance = (s: SimState) => (s.vehicle.crashing ? CRASH_BUDGET : DRIVE_BUDGET);

const MAX_CHAIN = 25;
const NO_SENSOR = -1;

export function sensorAtSlot(spec: ParsedDeformationSpec, slot: number): number {
	if (slot <= 0) return NO_SENSOR;
	for (let i = spec.numDeformationSensors - 1; i >= 0; i--) if (spec.sensors[i].sceneIndex === slot) return i;
	return NO_SENSOR;
}

export type SensorImpulse = {
	sensor: number;
	direction: Vec3;     // unit impulse direction, into the car, body axes
	magnitude: number;   // shaped impulse, N·s
	closingSpeed: number; // |relative velocity along the contact normal|, m/s
	invMass: number;     // 1/m + n·((I⁻¹(r×n))×r) at the contact (the inverse effective mass)
	dt: number;
};

// Per-direction crush limit: a sensor may only be pushed along +X while it
// sits within (radius + pad) of the limit box's -X face, and so on. A crash
// is limited by the car's deformable box, a knock by its drive-time box (both
// body frame; the sensors live in the spec frame).
function limitRow(s: SimState, d: number, radius: number): Vec3 {
	const crashing = s.vehicle.crashing;
	const box = crashing ? s.vehicle.aabb : s.driveBox;
	const inset = radius + (crashing ? CRASH_LIMIT_PAD : 0);
	const row: Vec3 = d % 2 === 0
		? [box.min[0] + inset, box.min[1] + inset, box.min[2] + inset]
		: [box.max[0] - inset, box.max[1] - inset, box.max[2] - inset];
	return add(row, s.com);
}

const budget = (s: SimState, sensor: number, d: number) =>
	Math.max(s.spec.sensors[sensor].directionParams[d], 0.01) * COMPRESSION_LIMIT_FACTOR[s.absorptionSet] * allowance(s);

const used = (s: SimState, sensor: number, axis: Vec3) =>
	Math.max(dot(axis, sub(s.sensors[sensor], s.spec.sensors[sensor].initialOffset)), 0);

function crushHead(s: SimState, imp: SensorImpulse, d: number, magnitude: number): number {
	const spec = s.spec.sensors[imp.sensor];
	const row = ABSORPTION[s.absorptionSet][spec.absorbtionLevel] ?? ABSORPTION[s.absorptionSet][0];
	const axis = DIRECTIONS[d];
	const c = s.sensors[imp.sensor];
	const toLimit = dot(sub(limitRow(s, d, spec.radius), c), axis);
	const room = Math.max(Math.min(budget(s, imp.sensor, d) - used(s, imp.sensor, axis), toLimit), 0);
	const ratio = Math.min(imp.closingSpeed / (row.speedForMax * DIRECTION_SPEED_SCALE[d]), 1);
	const base = Math.min(allowance(s), row.absorption * (1 - row.proportion) + row.absorption * row.proportion * ratio);
	const absorbed = magnitude * Math.pow(base, 60 * imp.dt);
	const move = Math.min(absorbed * imp.invMass * imp.dt, room);
	s.sensors[imp.sensor] = [c[0] + axis[0] * move, c[1] + axis[1] * move, c[2] + axis[2] * move];
	return absorbed;
}

// Chain links take the passed impulse at full strength (it is not attenuated
// down the chain) and have no limit-row or floor: a link already past its
// budget is pulled back to it.
function crushLink(s: SimState, sensor: number, d: number, passed: number, imp: SensorImpulse): void {
	const spec = s.spec.sensors[sensor];
	const row = ABSORPTION[s.absorptionSet][spec.absorbtionLevel] ?? ABSORPTION[s.absorptionSet][0];
	const axis = DIRECTIONS[d];
	const amount = Math.min(
		passed * Math.min(row.absorption, allowance(s)) * imp.invMass * imp.dt,
		budget(s, sensor, d) - used(s, sensor, axis),
	);
	const c = s.sensors[sensor];
	s.sensors[sensor] = [c[0] + axis[0] * amount, c[1] + axis[1] * amount, c[2] + axis[2] * amount];
}

// A remainder that reached the car body: the chain of direction `d` ended at
// the body (slot 0) carrying `rem`, the impulse the hit sensor did not absorb.
export type BodyArrival = { d: number; rem: number };

// Crushes the hit sensor and its chains; returns, per crush direction the
// impulse pushes along, what the sensor did not absorb (it absorbs its share
// even once it has no crush room left). Every chain passes the head's
// absorbed half down unattenuated and hands the head's remainder to the body
// when it ends.
export function applySensorImpulse(s: SimState, imp: SensorImpulse): BodyArrival[] {
	s.latch[imp.sensor] = Math.max(s.latch[imp.sensor], imp.magnitude);
	const impulse = scale(imp.direction, imp.magnitude);
	const arrivals: BodyArrival[] = [];
	for (let d = 0; d < 6; d++) {
		const proj = dot(impulse, DIRECTIONS[d]);
		if (proj <= 0) continue;
		s.deformedThisStep = true;
		const absorbed = crushHead(s, imp, d, proj);
		let next = s.spec.sensors[imp.sensor].nextSensor[d];
		for (let hops = 0, link = sensorAtSlot(s.spec, next); link !== NO_SENSOR && hops < MAX_CHAIN; hops++) {
			crushLink(s, link, d, absorbed * 0.5, imp);
			next = s.spec.sensors[link].nextSensor[d];
			link = sensorAtSlot(s.spec, next);
		}
		if (next === 0) arrivals.push({ d, rem: proj - absorbed });
	}
	return arrivals;
}

// The box over the sensor spheres in the body frame (centre-of-mass origin),
// grown from that origin, so it always contains the centre of mass.
function sensorSphereBox(s: SimState, centre: (i: number) => Vec3): { min: Vec3; max: Vec3 } {
	const min: Vec3 = [0, 0, 0], max: Vec3 = [0, 0, 0];
	for (let i = 0; i < s.spec.numDeformationSensors; i++) {
		const c = sub(centre(i), s.com), r = s.spec.sensors[i].radius;
		for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], c[k] - r); max[k] = Math.max(max[k], c[k] + r); }
	}
	return { min, max };
}

// Drive-time limits: the rest sensor box pulled in by the car's
// DriveTimeDeformLimit attribs (side, -Y, +Z, -Z).
export function driveTimeBox(s: SimState): { min: Vec3; max: Vec3 } {
	const { min, max } = sensorSphereBox(s, (i) => s.spec.sensors[i].initialOffset);
	const [side, negY, posZ, negZ] = s.vehicle.params.base.driveTimeLimits;
	return { min: [min[0] + side, min[1], min[2] + posZ], max: [max[0] - side, max[1] - negY, max[2] - negZ] };
}

// The deformed box over the live sensor spheres becomes the car's deformable
// box (what the crash rules and the crash limit rows read).
export function updateDeformedBox(s: SimState): void {
	s.vehicle.aabb = sensorSphereBox(s, (i) => s.sensors[i]);
}
