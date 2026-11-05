// The car against the world, one 60 Hz step, as the game runs it for a race
// car:
//
// 1. generateContacts, at the pose the step starts from: every collision
//    sphere (the deformation sensors plus a small sphere on each wheel hub)
//    is tested against the world; each sphere/surface pair that touches or
//    is near gives one candidate. Last step's latches and stores are cleared.
// 2. latchContacts, with the velocity the car has once its own update ran:
//    each sensor's centre motion this step is taken from that velocity, and
//    each candidate is stored for the penetration solve and offered to its
//    sensor's latch, which keeps the earliest contact that closes during the
//    step. A wheel hub's candidates belong to the hub's nearest sensor.
// 3. applyContactImpulses: the latched contacts, most head-on first, are
//    sized one after another from the body's LIVE velocity at the contact
//    point. Each impulse is half the inelastic one; the sensor absorbs part of
//    it, the body receives only the unabsorbed remainder plus the slide
//    friction, at the contact point, and the body is drained after each
//    contact, so a later contact sees what the earlier ones did.
//
// updateContacts runs 2 and 3. The penetration solve (penetration.ts) runs
// after the pose has been integrated.

import type { Vec3 } from '../deformationSpec';
import { drain, invEffectiveMass, toBody, toBodyDir, toWorld, toWorldDir, velocityAt } from '../vehicleSim/body';
import { bankWorldImpulse } from './bodyImpulse';
import { applyContactFriction } from './friction';
import { applySensorImpulse } from './sensors';
import { add, cross, dot, normalize, scale, sub, DISARMED, type ImpulseRecord, type SimState } from './state';
import { DIRECTIONS, IMPULSE_SHAPING } from './tables';
import { sphereVsGround, sphereVsObstacle, type PotentialContact } from './world';

// The game stops harvesting a car's contacts at this many per step.
export const MAX_POTENTIAL_CONTACTS = 199;
const STORE_SLOTS = 3;

// A sensor's centre in the body (centre-of-mass) frame.
export const sensorLocal = (s: SimState, i: number): Vec3 => sub(s.sensors[i], s.com);

// The wheel hub sphere: the wheel's x/z, its streamed (suspension-neutral)
// height lifted by a quarter of the wheel scale, radius half the scale. The
// scale is the x of the spec wheel's second vector (parsed as `direction`).
export function hubSphere(s: SimState, w: number): { local: Vec3; radius: number } {
	const sc = s.spec.wheels[w].direction[0];
	const p = s.wheelPos[w];
	return { local: [p[0], s.wheelStreamedY[w] + sc * 0.25, p[2]], radius: sc * 0.5 };
}

// Every collision sphere in the world, sensors first, then the four hubs.
export function collisionSpheres(s: SimState): { centre: Vec3; radius: number }[] {
	const out: { centre: Vec3; radius: number }[] = [];
	for (let i = 0; i < s.spec.numDeformationSensors; i++) {
		out.push({ centre: toWorld(s.body, sensorLocal(s, i)), radius: s.spec.sensors[i].radius });
	}
	for (let w = 0; w < 4; w++) {
		const h = hubSphere(s, w);
		out.push({ centre: toWorld(s.body, h.local), radius: h.radius });
	}
	return out;
}

// Which sensor a sphere's contacts belong to.
export const owningSensor = (s: SimState, sphere: number) =>
	sphere < s.spec.numDeformationSensors ? sphere : s.wheelToSensor[sphere - s.spec.numDeformationSensors];

// Each wheel hub reports through the sensor nearest the wheel (the first one
// on a tie).
export function nearestSensors(s: SimState): number[] {
	return s.wheelPos.map((p) => {
		let best = Infinity, index = 0;
		for (let i = 0; i < s.spec.numDeformationSensors; i++) {
			const d = sub(sensorLocal(s, i), p);
			const dist = Math.sqrt(dot(d, d));
			if (dist < best) { best = dist; index = i; }
		}
		return index;
	});
}

const disarmed = (): ImpulseRecord => ({ pA: [0, 0, 0], pB: [0, 0, 0], n: [0, 0, 0], t: DISARMED, surface: 'ground' });

export function clearContacts(s: SimState): void {
	const n = s.spec.numDeformationSensors;
	s.records = Array.from({ length: n }, disarmed);
	s.stored = Array.from({ length: n }, () => []);
	s.disp = Array.from({ length: n }, () => [0, 0, 0] as Vec3);
	s.potential = [];
}

// Candidates from the current pose. Surfaces are harvested one after another,
// each against every sphere in order.
export function generateContacts(s: SimState): PotentialContact[] {
	clearContacts(s);
	const spheres = collisionSpheres(s);
	const surfaces: { surface: 'ground' | 'obstacle'; hit: (c: Vec3, r: number) => ReturnType<typeof sphereVsGround> }[] = [
		{ surface: 'ground', hit: sphereVsGround },
	];
	const o = s.obstacle;
	if (o) surfaces.push({ surface: 'obstacle', hit: (c, r) => sphereVsObstacle(c, r, o) });
	for (const { surface, hit } of surfaces) {
		spheres.forEach(({ centre, radius }, sphere) => {
			const h = hit(centre, radius);
			if (h && s.potential.length < MAX_POTENTIAL_CONTACTS) s.potential.push({ sphere, surface, ...h });
		});
	}
	return s.potential;
}

// The motion of each sensor's centre over this step at the body's velocity.
export function updateSensorDisplacements(s: SimState, dt: number): void {
	const b = s.body;
	for (let i = 0; i < s.spec.numDeformationSensors; i++) {
		s.disp[i] = scale(add(b.v, cross(b.w, toWorldDir(b, sensorLocal(s, i)))), dt);
	}
}

// Stores the candidate for the penetration solve (the three that will be
// closest after this step's motion win) and offers it to the sensor's latch.
// The latch takes it when the sensor's centre closes on the surface this step
// and the gap closes within the step, earlier than anything latched so far
// (an already overlapping contact closes at 0).
export function validateAndAddContact(s: SimState, sensor: number, c: PotentialContact): void {
	const n = normalize(c.n), disp = s.disp[sensor];
	let candidate = {
		localA: sub(toBody(s.body, c.pA), sensorLocal(s, sensor)), B: c.pB, n,
		projDist: dot(n, sub(add(c.pA, disp), c.pB)),
	};
	const store = s.stored[sensor];
	if (store.length >= STORE_SLOTS) {
		for (let k = 0; k < store.length; k++) {
			if (candidate.projDist < store[k].projDist) [store[k], candidate] = [candidate, store[k]];
		}
	} else store.push(candidate);

	const pen = dot(sub(c.pA, c.pB), n);
	const basis = -dot(disp, n);
	const ratio = basis !== 0 ? pen / basis : 0;
	const t = ratio > 0 || Number.isNaN(ratio) ? ratio : 0;
	const rec = s.records[sensor];
	if (basis > 0 && t <= 1 && t >= 0 && rec.t > t) {
		s.records[sensor] = { pA: c.pA, pB: c.pB, n, t, surface: c.surface };
	}
}

export function latchContacts(s: SimState, dt: number): void {
	updateSensorDisplacements(s, dt);
	for (const c of s.potential) validateAndAddContact(s, owningSensor(s, c.sphere), c);
}

export type ContactRow = { key: number; t: number; sensor: number };

// Contacts closing more than a tenth of a step apart go in time order; closer
// ones go by key (most head-on first). That is not a strict weak order, so
// the result depends on the exact insertion sort: a row that belongs before
// the first row is rotated straight to the front.
export const rowBefore = (a: ContactRow, b: ContactRow) =>
	!(Math.abs(a.t - b.t) > 0.1) ? a.key < b.key : a.t < b.t;

export function sortContactRows(rows: ContactRow[]): ContactRow[] {
	for (let i = 1; i < rows.length; i++) {
		const val = rows[i];
		if (rowBefore(val, rows[0])) {
			for (let k = i; k > 0; k--) rows[k] = rows[k - 1];
			rows[0] = val;
		} else {
			let hole = i;
			while (rowBefore(val, rows[hole - 1])) { rows[hole] = rows[hole - 1]; hole--; }
			rows[hole] = val;
		}
	}
	return rows;
}

// One latched contact. Returns false (and does nothing) when the contact
// point is already separating at the body's live velocity.
export function applyCarWorldImpulse(s: SimState, rec: ImpulseRecord, sensor: number, dt: number): boolean {
	const b = s.body;
	const relVel = velocityAt(b, rec.pA);
	const vn = dot(relVel, rec.n);
	if (vn >= 0) return false;
	// Restitution is 0 against the world; only half the solved impulse is used.
	const k = invEffectiveMass(b, rec.pA, rec.n);
	const magnitude = IMPULSE_SHAPING * Math.abs(-vn / k);
	const arrivals = applySensorImpulse(s, {
		sensor, direction: toBodyDir(b, rec.n), magnitude, closingSpeed: Math.abs(vn), invMass: k, dt,
	});
	for (const { d, rem } of arrivals) bankWorldImpulse(b, s.crashing, s.counters, scale(DIRECTIONS[d], rem), rec.pA, rec.n);
	const { slide, scratch } = applyContactFriction(s, b, sensor, relVel, rec.n, magnitude, rec.pA, dt);
	s.events.contacts.push({
		sensor, point: rec.pB, normal: rec.n, impulse: magnitude, closingSpeed: Math.abs(vn), slide, scratch, surface: rec.surface,
	});
	return true;
}

export function applyContactImpulses(s: SimState, dt: number): void {
	const dir = normalize(s.body.v);
	const rows: ContactRow[] = [];
	s.records.forEach((rec, sensor) => { if (!(rec.t > 1)) rows.push({ key: dot(dir, rec.n), t: rec.t, sensor }); });
	sortContactRows(rows);
	s.counters.numWorldCollisions = 0;
	for (const { sensor } of rows) {
		const rec = s.records[sensor];
		if (rec.t > 1) continue;
		if (applyCarWorldImpulse(s, rec, sensor, dt)) drain(s.body, dt);
	}
}

export function updateContacts(s: SimState, dt: number): void {
	latchContacts(s, dt);
	applyContactImpulses(s, dt);
}
