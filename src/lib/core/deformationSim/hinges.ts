// A hinged panel: a pendulum hanging off the car on one of its joints. Every
// step, after the car has moved:
//
// - its box (built afresh, so it follows the dent) is tested against the
//   world where the car was at the start of the step, within 5 cm, and each
//   contact is carried along with the car's motion; how far that pushes the
//   box into the surface is the panel's penetration, the deepest one kept;
// - the swing: the hinge anchor's speed along the panel's lever (squared,
//   clamped to 0.5 m/s), gravity along the lever and the anchor's
//   acceleration along it drive the angle, which bounces softly (-0.1) off
//   its two stops (closed at 0, fully open at -maxAngle) and loses 2.5 % of its
//   speed a step; the penetration along the lever pushes the panel back
//   (weaker past 1 m from the hinge), and twice its length is the joint's
//   stress.
//
// A joint breaks (the panel flies off) when it has swung at least 30 % open,
// is not a bonnet, its sensors' impulse sits in the part's detach band, and
// either 1.5 x the stress or 0.4 x the car's speed along the hinge axis (while
// something presses along that axis) exceeds the joint's detach threshold. A
// threshold at or below -0.9 never breaks.

import type { Vec3 } from '../deformationSpec';
import { rotationMatrix, toBody, toBodyDir, toWorldDir, velocityAt } from '../vehicleSim/body';
import { makeFreePart } from './freeParts';
import { pointContact, worldSurfaces } from './looseBody';
import { boxCorners, partBox } from './partBox';
import { meshShift, meshToWorld, specToWorld } from './pose';
import { jointRotation, mul3, mulMat3 } from './rotation';
import { add, dot, length, scale, sub, type SimState } from './state';
import {
	ANCHOR_CLAMP, GRAVITY, JOINT_BOUNCE, JOINT_NEVER_BREAKS, JOINT_RELAX, JOINT_ROTATION_GATE,
	MAX_IMPULSE_FOR_DETACHMENT, MAX_IMPULSE_FOR_DETACHMENT_TOUGH, MIN_IMPULSE_FOR_DETACHMENT, TOUGHENED_PARTS,
} from './tables';

const HINGE_PAD = 0.05;
const RESOLVE_FALLOFF_RADIUS = 1;
const RESOLVE_FALLOFF_SCALE = 3;
const LIMIT_STRESS_SCALE = 2;
const PENETRATION_STRESS = 1.5;
const AXIS_FORCE = 0.4;
const NEVER_BREAKING_PART = 3;   // the bonnet
const FLT_EPSILON = 1.1920929e-7;

const xyz = (v: readonly number[]): Vec3 => [v[0], v[1], v[2]];
const distSq = (a: Vec3, b: Vec3) => { const d = sub(a, b); return dot(d, d); };

// The hinge point follows the dent of its tag point (spec frame).
export function hingePoint(s: SimState, p: number): Vec3 | null {
	const h = s.hinges.get(p);
	const js = h && s.spec.ikParts[p].jointSpecs[h.joint];
	if (!h || !js) return null;
	const tag = s.spec.tagPoints[h.tag];
	return add(xyz(js.position), sub(s.tags[h.tag], tag.initialPosition));
}

// The panel's swing as a mesh-frame map (rotation about the hinge point).
function swing(s: SimState, p: number): ((m: Vec3) => Vec3) | null {
	const h = s.hinges.get(p), J = hingePoint(s, p);
	if (!h || !J) return null;
	const R = jointRotation(xyz(s.spec.ikParts[p].jointSpecs[h.joint].axis), h.rot);
	const Jm = sub(J, meshShift(s.spec));
	return (m) => add(mul3(R, sub(m, Jm)), Jm);
}

function collectContacts(s: SimState, p: number): void {
	const h = s.hinges.get(p)!, at = swing(s, p);
	h.pen = [0, 0, 0];
	h.contact = null;
	if (!at) return;
	const box = partBox(s, p), shift = meshShift(s.spec);
	const prev = s.prevCar ?? { pos: s.body.pos, axes: s.body.axes };
	const prevWorld = (m: Vec3): Vec3 => {
		const b = sub(add(m, shift), s.com);
		return add(prev.pos, add(add(scale(prev.axes[0], b[0]), scale(prev.axes[1], b[1])), scale(prev.axes[2], b[2])));
	};
	const surfaces = worldSurfaces(s.obstacle);
	const partPos = meshToWorld(s, at(box.centre));
	for (const corner of boxCorners(box)) {
		const m = at(add(box.centre, corner)), now = meshToWorld(s, m);
		for (const hit of pointContact(prevWorld(m), surfaces, HINGE_PAD)) {
			const pen = scale(hit.n, Math.min(dot(sub(now, hit.onSurface), hit.n), 0));
			if (dot(pen, pen) >= dot(h.pen, h.pen)) h.pen = pen;
			if (!h.contact || distSq(partPos, now) >= distSq(partPos, h.contact)) h.contact = now;
		}
	}
}

export function updateHinges(s: SimState, dt: number): void {
	const b = s.body;
	for (const [p, h] of s.hinges) {
		const js = s.spec.ikParts[p].jointSpecs[h.joint];
		const J = hingePoint(s, p);
		if (!js || !J) continue;
		collectContacts(s, p);
		const dW = mul3(jointRotation(xyz(js.axis), h.rot), xyz(js.defaultDirection));
		const anchor = toBodyDir(b, velocityAt(b, specToWorld(s, J)));
		const along = dot(anchor, dW);
		const clamped = Math.min(Math.max(along, -ANCHOR_CLAMP), ANCHOR_CLAMP);
		const accel = clamped * clamped + GRAVITY * toWorldDir(b, dW)[1] + (along - dot(h.storedVel, dW)) / dt;
		h.vel += accel * dt;
		if (h.rot > 0 || h.rot < -js.maxJointAngle) h.vel *= JOINT_BOUNCE;
		let rot = h.rot + h.vel * dt;
		h.vel *= JOINT_RELAX;
		const reach = length(sub(toBody(b, h.contact ?? [0, 0, 0]), sub(J, s.com)));
		const resolve = dot(toBodyDir(b, h.pen), dW) / (RESOLVE_FALLOFF_SCALE * Math.max(reach - RESOLVE_FALLOFF_RADIUS, 0) + 1);
		rot = Math.min(Math.max(rot + resolve, -js.maxJointAngle), 0);
		h.limitStress = length(h.pen) * LIMIT_STRESS_SCALE;
		if (resolve * h.vel < 0) h.vel -= h.vel * (1 - JOINT_BOUNCE);
		h.rot = rot;
		h.storedVel = anchor;
	}
	s.prevCar = { pos: [...b.pos] as Vec3, axes: b.axes.map((a) => [...a]) as [Vec3, Vec3, Vec3] };
}

// The biggest impulse any of a part's tag points' sensors felt this step.
export function peakImpulse(s: SimState, p: number): number {
	const part = s.spec.ikParts[p];
	let peak = 0;
	for (let k = 0; k < part.numberOfTagPoints; k++) {
		const tag = s.spec.tagPoints[part.startIndexOfTagPoints + k];
		peak = Math.max(peak, s.latch[tag.deformationSensorA] ?? 0, s.latch[tag.deformationSensorB] ?? 0);
	}
	return peak;
}

function sensorsAllowBreak(s: SimState, p: number): boolean {
	const peak = peakImpulse(s, p);
	return TOUGHENED_PARTS.has(s.spec.ikParts[p].partType)
		? MIN_IMPULSE_FOR_DETACHMENT <= peak && peak <= MAX_IMPULSE_FOR_DETACHMENT_TOUGH
		: peak <= MAX_IMPULSE_FOR_DETACHMENT;
}

// Where the hinged panel's centre of mass is (world) and its whole rotation.
function hingedBody(s: SimState, p: number) {
	const h = s.hinges.get(p)!, at = swing(s, p)!, box = partBox(s, p);
	const R = jointRotation(xyz(s.spec.ikParts[p].jointSpecs[h.joint].axis), h.rot);
	return { box, pos: meshToWorld(s, at(box.centre)), rotation: mulMat3(rotationMatrix(s.body), R) };
}

export function jointBreaks(s: SimState, p: number): boolean {
	const h = s.hinges.get(p), part = s.spec.ikParts[p];
	const js = h && part.jointSpecs[h.joint];
	if (!h || !js || !hingePoint(s, p)) return false;
	const threshold = js.jointDetachThreshold;
	if (threshold <= JOINT_NEVER_BREAKS) return false;
	// A joint with no swing range divides by zero here; the game's NaN passes the gate.
	if (h.rot / -js.maxJointAngle < JOINT_ROTATION_GATE) return false;
	if (part.partType === NEVER_BREAKING_PART || !sensorsAllowBreak(s, p)) return false;
	const vel = velocityAt(s.body, hingedBody(s, p).pos);
	const axis = toWorldDir(s.body, xyz(js.axis));
	const pressed = dot(axis, h.pen);
	if (axis.some((a) => Math.abs(a * pressed) > FLT_EPSILON) && Math.abs(dot(vel, axis)) * AXIS_FORCE > threshold) return true;
	return h.limitStress * PENETRATION_STRESS > threshold;
}

// The panel leaves its hinge with the velocity of its centre of mass on the
// car and the car's spin.
export function breakHinge(s: SimState, p: number): void {
	const { box, pos, rotation } = hingedBody(s, p);
	const vel = velocityAt(s.body, pos), part = s.spec.ikParts[p];
	s.hinges.delete(p);
	s.free.set(p, makeFreePart(box, rotation, pos, vel, [...s.body.w] as Vec3));
	s.events.parts.push({ part: p, gfx: part.partGraphics, partType: part.partType, state: 'detached', pos, vel });
}
