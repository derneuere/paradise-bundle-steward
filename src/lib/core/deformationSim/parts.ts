// Panels leaving the car: the detachment test run before every IK step, the
// hinge joint that swings a loosened panel, and free-flying detached parts.
// A hinged panel stays in the car's frame; a part knocked clean off leaves it
// and flies and lands in the world.

import type { Vec3 } from '../deformationSpec';
import { rotationMatrix, toBodyDir, velocityAt } from '../vehicleSim/body';
import { meshToWorld } from './pose';
import { add, dot, length, normalize, scale, sub, PartState, type SimState } from './state';
import { GROUND_Y } from './world';
import {
	ANCHOR_CLAMP, GRAVITY, JOINT_BOUNCE, JOINT_RELAX, MAX_IMPULSE_FOR_DETACHMENT, MAX_IMPULSE_FOR_DETACHMENT_TOUGH,
	MAX_PHYSICAL_PARTS, MIN_IMPULSE_FOR_DETACHMENT,
} from './tables';

const NEVER_DETACH_SQUARED = 9995;
const TOUGHENED = new Set([1, 2, 26, 27, 28, 29, 108, 109, 110, 111, 112, 113, 114, 115]);
const BANDED_TYPES = new Set([1, 2, 3]);
const EXHAUSTS = new Set([84, 85]);

export function initialPartState(s: SimState, p: number): PartState {
	const part = s.spec.ikParts[p];
	const tags = s.spec.tagPoints.slice(part.startIndexOfTagPoints, part.startIndexOfTagPoints + part.numberOfTagPoints);
	return tags.some((t) => t.fDetachThresholdSquared < NEVER_DETACH_SQUARED) ? PartState.AttachedIK : PartState.NonDetachable;
}

// A part comes loose once one of its tag points has been pushed further than
// its detach threshold. If it has a jointed tag it hinges on the least
// deformed one, otherwise it flies off. Bumpers, the bonnet and parts with
// no joint also need the impulse that hit them to sit in the detach band.
export function checkForDetachment(s: SimState): void {
	s.spec.ikParts.forEach((part, p) => {
		if (s.partState[p] !== PartState.AttachedIK) return;
		let largest = -Infinity, smallest = Infinity, candidate = -1, peak = 0;
		for (let k = 0; k < part.numberOfTagPoints; k++) {
			const i = part.startIndexOfTagPoints + k;
			const spec = s.spec.tagPoints[i];
			peak = Math.max(peak, s.latch[spec.deformationSensorA] ?? 0, s.latch[spec.deformationSensorB] ?? 0);
			const d = sub(s.tags[i], spec.initialPosition);
			const excess = dot(d, d) - spec.fDetachThresholdSquared;
			largest = Math.max(largest, excess);
			if (excess < smallest && spec.jointIndex !== -1) { smallest = excess; candidate = k; }
		}
		if (largest <= 0) return;
		if (candidate === -1 || BANDED_TYPES.has(part.partType)) {
			const max = TOUGHENED.has(part.partType) ? MAX_IMPULSE_FOR_DETACHMENT_TOUGH : MAX_IMPULSE_FOR_DETACHMENT;
			if (!(MIN_IMPULSE_FOR_DETACHMENT <= peak && peak <= max)) return;
		}
		detachPart(s, p, candidate === -1 ? -1 : part.startIndexOfTagPoints + candidate);
	});
}

function detachPart(s: SimState, p: number, hingeTag: number): void {
	const part = s.spec.ikParts[p];
	const hinge = hingeTag !== -1;
	if (part.partGraphics === -1 || s.physicalParts >= MAX_PHYSICAL_PARTS) return;
	if (s.attachedExhausts <= 1 && EXHAUSTS.has(part.partType) && !hinge) return;
	s.physicalParts++;
	const origin: Vec3 = [part.graphicsTransform[3][0], part.graphicsTransform[3][1], part.graphicsTransform[3][2]];
	const pos = meshToWorld(s, origin), vel = velocityAt(s.body, pos);
	s.events.parts.push({ part: p, gfx: part.partGraphics, partType: part.partType, state: hinge ? 'hinged' : 'detached', pos, vel });
	if (hinge) {
		s.partState[p] = PartState.Hinged;
		s.hinges.set(p, { joint: s.spec.tagPoints[hingeTag].jointIndex, tag: hingeTag, rot: 0, vel: 0, storedVel: carLocalVelocity(s) });
		return;
	}
	s.partState[p] = PartState.Detached;
	if (EXHAUSTS.has(part.partType)) s.attachedExhausts--;
	s.free.set(p, { pos, origin, vel, spin: [0, 0, 0], rotation: rotationMatrix(s.body) });
}

// Right-handed rotation by `angle` about `axis` (row-major 3x3). Joint
// angles run from 0 (closed) to -maxJointAngle (fully open); with this sign a
// door on a -X hinge axis lifts its rear edge, i.e. opens upward.
export function jointRotation(axis: Vec3, angle: number): number[] {
	const [x, y, z] = normalize(axis);
	const c = Math.cos(angle), s = Math.sin(angle), t = 1 - c;
	return [
		t * x * x + c, t * x * y - s * z, t * x * z + s * y,
		t * x * y + s * z, t * y * y + c, t * y * z - s * x,
		t * x * z - s * y, t * y * z + s * x, t * z * z + c,
	];
}
export const mul3 = (m: number[], v: Vec3): Vec3 => [
	m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
];

// The hinge point follows the dent of its tag point. The panel is driven by
// the car's own motion along its lever (the defaultDirection) and by gravity,
// bounces softly off its two stops (closed at 0, fully open at -maxAngle)
// and loses 2.5 % of its swing speed per step.
export function hingePoint(s: SimState, p: number): Vec3 | null {
	const h = s.hinges.get(p);
	const js = h && s.spec.ikParts[p].jointSpecs[h.joint];
	if (!h || !js) return null;
	const tag = s.spec.tagPoints[h.tag];
	return add([js.position[0], js.position[1], js.position[2]], sub(s.tags[h.tag], tag.initialPosition));
}

const carLocalVelocity = (s: SimState): Vec3 => toBodyDir(s.body, s.body.v);

export function updateHinges(s: SimState, dt: number): void {
	const carVel = carLocalVelocity(s);
	for (const [p, h] of s.hinges) {
		const js = s.spec.ikParts[p].jointSpecs[h.joint];
		if (!js) continue;
		const dW = mul3(jointRotation([js.axis[0], js.axis[1], js.axis[2]], h.rot), [js.defaultDirection[0], js.defaultDirection[1], js.defaultDirection[2]]);
		const along = dot(carVel, dW);
		const anchor = Math.min(Math.max(along, -ANCHOR_CLAMP), ANCHOR_CLAMP);
		const accel = anchor * anchor + GRAVITY * dW[1] + (along - dot(h.storedVel, dW)) / dt;
		h.vel += accel * dt;
		if (h.rot > 0 || h.rot < -js.maxJointAngle) h.vel *= JOINT_BOUNCE;
		h.rot += h.vel * dt;
		h.vel *= JOINT_RELAX;
		h.rot = Math.min(Math.max(h.rot, -js.maxJointAngle), 0);
		h.storedVel = carVel;
	}
}

export function updateFreeParts(s: SimState, dt: number, groundY = GROUND_Y): void {
	for (const f of s.free.values()) {
		if (f.pos[1] <= groundY && length(f.vel) < 1e-3) continue;
		f.vel = add(f.vel, [0, -GRAVITY * dt, 0]);
		f.pos = add(f.pos, scale(f.vel, dt));
		if (length(f.spin) > 0) {
			const r = jointRotation(f.spin, -length(f.spin) * dt);
			f.rotation = mulMat3(r, f.rotation);
		}
		if (f.pos[1] < groundY) { f.pos[1] = groundY; f.vel = [0, 0, 0]; f.spin = [0, 0, 0]; }
	}
}

function mulMat3(a: number[], b: number[]): number[] {
	const o = new Array(9).fill(0);
	for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) o[r * 3 + c] += a[r * 3 + k] * b[k * 3 + c];
	return o;
}

// Column-major 4x4 (three.js order): rotate by `rot` (row-major 3x3) about
// `pivot`, then translate by `move`.
export function poseMatrix(rot: number[], pivot: Vec3, move: Vec3 = [0, 0, 0]): number[] {
	const t = sub(add(pivot, move), mul3(rot, pivot));
	return [rot[0], rot[3], rot[6], 0, rot[1], rot[4], rot[7], 0, rot[2], rot[5], rot[8], 0, t[0], t[1], t[2], 1];
}
