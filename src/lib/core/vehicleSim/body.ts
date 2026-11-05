// The car's rigid body, as the game simulates a race car outside the generic
// physics world: a centre-of-mass position, three body axes (Right, Up, At),
// linear and angular velocity, and four accumulators (force, torque, impulse,
// angular impulse) that `drain` turns into velocity. The vehicle code drains
// several times per step, so later rules see the velocity earlier rules made.
// The body itself never damps or clamps; those rules belong to the vehicle.
//
// Frames: world is +Y up. A body-space vector b maps to world as
// `Right*b.x + Up*b.y + At*b.z`; At is forward and wheel 0 (front left) has
// body x < 0. The body origin is the centre of mass, not the deformation
// spec's origin (see `specToBody` callers).

import type { Vec3 } from '../deformationSpec';
import { add, cross, dot, length, scale, sub } from '../deformationSim/state';

export const GRAVITY = 9.81000042;

export type RigidBody = {
	pos: Vec3;                 // centre of mass, world
	axes: [Vec3, Vec3, Vec3];  // Right, Up, At in world (rows of the game's transform)
	v: Vec3;                   // world linear velocity
	w: Vec3;                   // world angular velocity
	mass: number;
	invILocal: Vec3;           // diagonal, body axes
	invIWorld: number[];       // row-major 3x3, R * invILocal * R^T
	F: Vec3; Tq: Vec3; J: Vec3; L: Vec3;
};

export type Space = 'world' | 'body';

// Solid box over the handling-body half extents. The live tensor has no
// centre-of-mass term and no extra scale.
export function boxInvInertia(halfExtent: Vec3, mass: number): Vec3 {
	const d = scale(halfExtent, 2);
	const k = mass / 12;
	const I = [k * (d[1] * d[1] + d[2] * d[2]), k * (d[0] * d[0] + d[2] * d[2]), k * (d[0] * d[0] + d[1] * d[1])];
	return I.map((x) => (x > 0 ? 1 / x : 0)) as Vec3;
}

export function createBody(mass: number, halfExtent: Vec3, pos: Vec3 = [0, 0, 0]): RigidBody {
	const b: RigidBody = {
		pos: [...pos] as Vec3, axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], v: [0, 0, 0], w: [0, 0, 0],
		mass, invILocal: boxInvInertia(halfExtent, mass), invIWorld: [],
		F: [0, 0, 0], Tq: [0, 0, 0], J: [0, 0, 0], L: [0, 0, 0],
	};
	updateWorldInertia(b);
	return b;
}

// Body-space direction to world.
export const toWorldDir = (b: RigidBody, d: Vec3): Vec3 =>
	add(add(scale(b.axes[0], d[0]), scale(b.axes[1], d[1])), scale(b.axes[2], d[2]));
// World direction to body space.
export const toBodyDir = (b: RigidBody, d: Vec3): Vec3 => [dot(d, b.axes[0]), dot(d, b.axes[1]), dot(d, b.axes[2])];
export const toWorld = (b: RigidBody, p: Vec3): Vec3 => add(b.pos, toWorldDir(b, p));
export const toBody = (b: RigidBody, p: Vec3): Vec3 => toBodyDir(b, sub(p, b.pos));

// Row-major local->world rotation (the axes as columns), the layout the
// deformation sim's `carRot` uses.
export const rotationMatrix = (b: RigidBody): number[] => {
	const [r, u, a] = b.axes;
	return [r[0], u[0], a[0], r[1], u[1], a[1], r[2], u[2], a[2]];
};

export const mulMat = (m: number[], v: Vec3): Vec3 => [
	m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
	m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
	m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
];

export function updateWorldInertia(b: RigidBody): void {
	const R = rotationMatrix(b), d = b.invILocal, m: number[] = new Array(9);
	for (let i = 0; i < 3; i++) {
		for (let j = 0; j < 3; j++) {
			m[i * 3 + j] = R[i * 3] * d[0] * R[j * 3] + R[i * 3 + 1] * d[1] * R[j * 3 + 1] + R[i * 3 + 2] * d[2] * R[j * 3 + 2];
		}
	}
	b.invIWorld = m;
}

const arm = (b: RigidBody, p: Vec3, pSpace: Space): Vec3 => (pSpace === 'world' ? sub(p, b.pos) : toWorldDir(b, p));
const dirIn = (b: RigidBody, f: Vec3, fSpace: Space): Vec3 => (fSpace === 'body' ? toWorldDir(b, f) : f);

export function addWorldForce(b: RigidBody, f: Vec3): void { b.F = add(b.F, f); }
export function addWorldTorque(b: RigidBody, t: Vec3): void { b.Tq = add(b.Tq, t); }
export function addWorldImpulse(b: RigidBody, j: Vec3): void { b.J = add(b.J, j); }
export function addWorldAngImpulse(b: RigidBody, l: Vec3): void { b.L = add(b.L, l); }
// A body-space force through the centre of mass.
export function addLocalSpaceForce(b: RigidBody, f: Vec3): void { b.F = add(b.F, toWorldDir(b, f)); }

export function addForceAt(b: RigidBody, f: Vec3, fSpace: Space, p: Vec3, pSpace: Space): void {
	const fw = dirIn(b, f, fSpace);
	b.F = add(b.F, fw);
	b.Tq = add(b.Tq, cross(arm(b, p, pSpace), fw));
}

export function addImpulseAt(b: RigidBody, j: Vec3, jSpace: Space, p: Vec3, pSpace: Space): void {
	const { linear, angular } = impulsesFromLocal(b, j, jSpace, p, pSpace);
	b.J = add(b.J, linear);
	b.L = add(b.L, angular);
}

// The linear and angular halves of an impulse at a point, without storing them.
export function impulsesFromLocal(b: RigidBody, j: Vec3, jSpace: Space, p: Vec3, pSpace: Space): { linear: Vec3; angular: Vec3 } {
	const jw = dirIn(b, j, jSpace);
	return { linear: jw, angular: cross(arm(b, p, pSpace), jw) };
}

// Turns everything accumulated into velocity, then clears the accumulators.
export function drain(b: RigidBody, dt: number): void {
	b.v = add(b.v, scale(add(scale(b.F, dt), b.J), 1 / b.mass));
	b.w = add(b.w, mulMat(b.invIWorld, add(scale(b.Tq, dt), b.L)));
	b.F = [0, 0, 0]; b.Tq = [0, 0, 0]; b.J = [0, 0, 0]; b.L = [0, 0, 0];
}

export function velocityAt(b: RigidBody, p: Vec3, pSpace: Space = 'world'): Vec3 {
	return add(b.v, cross(b.w, arm(b, p, pSpace)));
}

// 1/m + n·((I⁻¹(r×n))×r): the inverse of the effective mass along n at p.
export function invEffectiveMass(b: RigidBody, p: Vec3, n: Vec3, pSpace: Space = 'world'): number {
	const r = arm(b, p, pSpace);
	return 1 / b.mass + dot(n, cross(mulMat(b.invIWorld, cross(r, n)), r));
}

// Penetration correction moves the body and nothing else.
export function translate(b: RigidBody, d: Vec3): void { b.pos = add(b.pos, d); }

// Gravity, then the pose: position by velocity, each axis turned first-order
// by w*dt, then re-orthonormalised. Gravity is a direct velocity edit made
// after the contact solve, so contacts never see this step's gravity.
export function integrate(b: RigidBody, dt: number): void {
	b.v = [b.v[0], b.v[1] - GRAVITY * dt, b.v[2]];
	b.pos = add(b.pos, scale(b.v, dt));
	const s = scale(b.w, dt);
	b.axes = b.axes.map((a) => sub(a, cross(a, s))) as [Vec3, Vec3, Vec3];
	b.axes = orthonormalize(b.axes);
	updateWorldInertia(b);
}

// The engine's orthonormalisation: normalise the rows, keep the row least
// out of square with the other two as the pivot, rebuild the others from it.
export function orthonormalize(rows: [Vec3, Vec3, Vec3]): [Vec3, Vec3, Vec3] {
	const lens = rows.map(length);
	const n = rows.map((r, i) => (lens[i] > 0 ? scale(r, 1 / lens[i]) : r)) as [Vec3, Vec3, Vec3];
	const a = Math.abs(dot(n[1], n[2])), bb = Math.abs(dot(n[2], n[0])), c = Math.abs(dot(n[0], n[1]));
	let p = bb > a ? (c > a ? 1 : 0) : (c > bb ? 2 : 0);
	if (lens[p] === 0) p = lens.findIndex((l) => l > 0);
	if (p < 0) return [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
	const next = (p + 1) % 3, prev = (p + 2) % 3;
	const unit = (v: Vec3) => { const l = length(v); return l > 0 ? scale(v, 1 / l) : v; };
	n[prev] = unit(cross(n[p], n[next]));
	n[next] = unit(cross(n[prev], n[p]));
	return n;
}

// w *= k^(60 dt).
export function dampenAngularVelocity(b: RigidBody, k: number, dt: number): void {
	b.w = scale(b.w, Math.pow(k, 60 * dt));
}

// Removes a share of w about each body axis in turn (Right by kp, Up by ky,
// At by kr): 0 removes nothing, 1 the whole component.
export function dampPitchYawRoll(b: RigidBody, kp: number, ky: number, kr: number, dt: number): void {
	if (Math.abs(dt) <= 1.19e-7) return;
	[kp, ky, kr].forEach((k, i) => {
		const axis = b.axes[i];
		b.w = sub(b.w, scale(axis, dot(b.w, axis) * Math.pow(k, 60 * dt)));
	});
}
