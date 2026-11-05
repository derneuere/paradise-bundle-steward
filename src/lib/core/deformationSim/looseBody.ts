// A rigid body loose in the world: a knocked-off panel or a shed wheel. The
// game hands these to its general physics world; what the simulator keeps of
// that is everything the game sets on the body:
//
// - gravity, then the contacts, then the pose, then drag, then the hard caps
//   on spin and speed (a panel 30 rad/s and 30 m/s, a wheel 10 and 60);
// - contacts against the ground and the obstacle at the body's contact
//   points (a panel's 8 box corners, points round a wheel's two rims), made
//   while a point is within `pad` of a surface, so a fast body does not tunnel;
// - a panel's own rule before each step: spinning faster than 5 rad/s it is
//   cut to 4, flying faster than 60 m/s to 48;
// - sleep: a body whose energy (largest moment / mass * |w|^2 + |v|^2) stays
//   under 0.1 without rising for 30 steps freezes where it lies.
//
// How the game's physics world solves a contact is not known; a few rounds
// of sequential impulses with the game's restitution and friction (static
// grip until the static cone is exceeded, then sliding friction) stand in for
// it, and a body left in a surface is pushed straight back out.

import type { Vec3 } from '../deformationSpec';
import { add, cross, dot, length, normalize, scale, sub, type LooseBody, type Obstacle } from './state';
import { jointRotation, mul3, mulMat3, orthonormalize3, transpose3 } from './rotation';
import { GRAVITY } from './tables';
import { GROUND_Y } from './world';

// A world surface's signed distance from a point: the outward normal and
// how far in front of the surface the point is (negative inside), or null
// when the surface is out of reach.
export type Surface = (p: Vec3) => { n: Vec3; gap: number } | null;

// Points deeper than this behind a face are on its far side, not in it.
const FAR_SIDE = 0.5;

export function worldSurfaces(o: Obstacle | null, groundY = GROUND_Y): Surface[] {
	const surfaces: Surface[] = [(p) => ({ n: [0, 1, 0], gap: p[1] - groundY })];
	if (o?.kind === 'wall') {
		const n = scale(o.normal, -1);
		surfaces.push((p) => { const gap = dot(sub(p, o.point), n); return gap > -FAR_SIDE ? { n, gap } : null; });
	} else if (o?.kind === 'pole') {
		const axisPoint = add(o.point, scale(o.normal, o.poleRadius));
		surfaces.push((p) => {
			const d = sub(p, axisPoint), perp = sub(d, scale(o.poleAxis, dot(d, o.poleAxis))), dist = length(perp);
			if (dist < 1e-9 || dist < o.poleRadius - FAR_SIDE) return null;
			return { n: scale(perp, 1 / dist), gap: dist - o.poleRadius };
		});
	}
	return surfaces;
}

// The contact a world point makes: on the first surface it is within `pad`
// of, the surface point under it and the outward normal.
export function pointContact(p: Vec3, surfaces: readonly Surface[], pad: number): { n: Vec3; gap: number; onSurface: Vec3 }[] {
	const out: { n: Vec3; gap: number; onSurface: Vec3 }[] = [];
	for (const surface of surfaces) {
		const hit = surface(p);
		if (hit && hit.gap < pad) out.push({ ...hit, onSurface: sub(p, scale(hit.n, hit.gap)) });
	}
	return out;
}

const SOLVER_ROUNDS = 8;
// Below this closing speed a contact does not bounce (keeps resting bodies quiet).
const BOUNCE_SPEED = 0.5;
const SLEEP_ENERGY = 0.1;
const SLEEP_STEPS = 30;
const PART_SPIN_LIMIT = 5, PART_SPIN_CUT = 4;
const PART_SPEED_LIMIT = 60, PART_SPEED_CUT = 48;

const worldInvInertia = (b: LooseBody): number[] => mulMat3(mulMat3(b.rotation, b.invInertia), transpose3(b.rotation));

function capLength(v: Vec3, max: number, to = max): Vec3 {
	const l = length(v);
	return l > max ? scale(v, to / l) : v;
}

type Contact = { r: Vec3; n: Vec3; target: number; kn: number; jn: number; jt: Vec3 };

function applyImpulse(b: LooseBody, invI: number[], r: Vec3, j: Vec3): void {
	b.vel = add(b.vel, scale(j, b.invMass));
	b.spin = add(b.spin, mul3(invI, cross(r, j)));
}

const pointVelocity = (b: LooseBody, r: Vec3): Vec3 => add(b.vel, cross(b.spin, r));

function effectiveMass(b: LooseBody, invI: number[], r: Vec3, d: Vec3): number {
	const k = b.invMass + dot(d, cross(mul3(invI, cross(r, d)), r));
	return k > 0 ? 1 / k : 0;
}

function solveContacts(b: LooseBody, surfaces: readonly Surface[], dt: number): void {
	const invI = worldInvInertia(b);
	const contacts: Contact[] = [];
	for (const p of b.points) {
		const r = mul3(b.rotation, p);
		for (const { n, gap } of pointContact(add(b.pos, r), surfaces, b.pad)) {
			const vn = dot(pointVelocity(b, r), n);
			// Separated: it may close the gap this step but no more. In contact:
			// it stops, or bounces off a fast approach.
			const target = gap > 0 ? -gap / dt : vn < -BOUNCE_SPEED ? -b.props.restitution * vn : 0;
			contacts.push({ r, n, target, kn: effectiveMass(b, invI, r, n), jn: 0, jt: [0, 0, 0] });
		}
	}
	for (let round = 0; round < SOLVER_ROUNDS; round++) {
		for (const c of contacts) {
			const vn = dot(pointVelocity(b, c.r), c.n);
			const jn = Math.max(c.jn + (c.target - vn) * c.kn, 0);
			applyImpulse(b, invI, c.r, scale(c.n, jn - c.jn));
			c.jn = jn;
			const v = pointVelocity(b, c.r);
			const vt = sub(v, scale(c.n, dot(v, c.n)));
			const speed = length(vt);
			let jt = c.jt;
			if (speed > 1e-9) {
				const t = scale(vt, 1 / speed);
				jt = add(jt, scale(t, -speed * effectiveMass(b, invI, c.r, t)));
			}
			const l = length(jt);
			if (l > b.props.staticFriction * c.jn) jt = l > 1e-12 ? scale(jt, (b.props.dynamicFriction * c.jn) / l) : [0, 0, 0];
			applyImpulse(b, invI, c.r, sub(jt, c.jt));
			c.jt = jt;
		}
	}
}

// Whatever of the body is still in a surface after the step is pushed out.
function pushOut(b: LooseBody, surfaces: readonly Surface[]): void {
	for (const surface of surfaces) {
		let deepest: { n: Vec3; gap: number } | null = null;
		for (const p of b.points) {
			const hit = surface(add(b.pos, mul3(b.rotation, p)));
			if (hit && hit.gap < 0 && (!deepest || hit.gap < deepest.gap)) deepest = hit;
		}
		if (deepest) b.pos = sub(b.pos, scale(deepest.n, deepest.gap));
	}
}

function sleep(b: LooseBody): void {
	const energy = b.inertiaRatio * dot(b.spin, b.spin) + dot(b.vel, b.vel);
	if (energy >= SLEEP_ENERGY) b.sleepSteps = 0;
	else if (energy <= b.sleepEnergy) b.sleepSteps++;
	b.sleepEnergy = energy;
	if (b.sleepSteps >= SLEEP_STEPS) { b.frozen = true; b.vel = [0, 0, 0]; b.spin = [0, 0, 0]; }
}

export function stepLooseBody(b: LooseBody, surfaces: readonly Surface[], dt: number): void {
	if (b.frozen) return;
	if (b.props.limitVelocities) {
		b.spin = capLength(b.spin, PART_SPIN_LIMIT, PART_SPIN_CUT);
		b.vel = capLength(b.vel, PART_SPEED_LIMIT, PART_SPEED_CUT);
	}
	b.vel = add(b.vel, [0, -GRAVITY * dt, 0]);
	solveContacts(b, surfaces, dt);
	b.pos = add(b.pos, scale(b.vel, dt));
	const w = length(b.spin);
	if (w > 0) b.rotation = orthonormalize3(mulMat3(jointRotation(normalize(b.spin), w * dt), b.rotation));
	pushOut(b, surfaces);
	b.vel = capLength(scale(b.vel, 1 - b.props.drag), b.props.maxSpeed);
	b.spin = capLength(scale(b.spin, 1 - b.props.drag), b.props.maxSpin);
	sleep(b);
}
