// What the car's collision spheres can touch, and the in-place sphere test
// the game runs against it. The game's world is road and wall triangles; the
// editor has the ground plane (y = 0) plus the obstacle of the current hit, an
// endless wall or a pole. The pole is a smooth cylinder here, where the game
// would only ever meet a faceted one.
//
// Two sphere tests, both one-sided (a sphere whose centre starts behind a
// surface touches nothing, so a car driven through a wall stays through it):
//
// - in place: a sphere whose centre is at least 1 mm in front of a surface
//   and whose skin is within 2 m of it yields a contact even when it is still
//   separated; the latch (contacts.ts) decides whether it closes this step.
// - swept: the sphere is moved along this step's travel D (its centre's
//   velocity times the step) and yields a contact only if it overlaps the
//   surface at some point of that travel. The contact is taken where the
//   sphere first reaches the surface: the surface point P under the centre
//   at that moment, the car point on the start sphere toward P, and the
//   surface's own normal. A car on its wheels has no sphere within its own
//   radius of the road, so a swept test finds no road contacts at all.
//
// The game runs the swept test for a car that is not crashing and is moving
// forward faster than 6 m/s, and the in-place test otherwise.

import type { Vec3 } from '../deformationSpec';
import { add, dot, length, normalize, scale, sub, type Obstacle } from './state';

// A candidate contact between one collision sphere and the world.
export type PotentialContact = {
	sphere: number;  // < numDeformationSensors: that sensor; numDeformationSensors + w: wheel hub w
	pA: Vec3;        // deepest point of the sphere toward the surface, world
	pB: Vec3;        // closest point on the surface, world
	n: Vec3;         // unit, out of the surface toward the car
	surface: 'ground' | 'obstacle';
};

export const GROUND_Y = 0;
// Spheres farther than this beyond their own radius find no contact.
export const CONTACT_PADDING = 2.0;
// The centre must sit at least this far in front of a surface.
export const MIN_FRONT_DISTANCE = 0.001;

type Hit = { pA: Vec3; pB: Vec3; n: Vec3 };

// Sphere against the plane through `point` with unit normal `normal`.
export function sphereVsPlane(c: Vec3, r: number, point: Vec3, normal: Vec3): Hit | null {
	const h = dot(sub(c, point), normal);
	if (h < MIN_FRONT_DISTANCE || h > r + CONTACT_PADDING) return null;
	return { pA: sub(c, scale(normal, r)), pB: sub(c, scale(normal, h)), n: normal };
}

// Sphere against an endless round pole: `axisPoint` on its axis, unit `axis`.
export function sphereVsPole(c: Vec3, r: number, axisPoint: Vec3, axis: Vec3, poleRadius: number): Hit | null {
	const d = sub(c, axisPoint);
	const perp = sub(d, scale(axis, dot(d, axis)));
	const dist = length(perp);
	if (dist < 1e-9) return null;
	const n = scale(perp, 1 / dist);
	const h = dist - poleRadius;
	if (h < MIN_FRONT_DISTANCE || h > r + CONTACT_PADDING) return null;
	return { pA: sub(c, scale(n, r)), pB: add(add(axisPoint, scale(axis, dot(d, axis))), scale(n, poleRadius)), n };
}

export function sphereVsGround(c: Vec3, r: number): Hit | null {
	return sphereVsPlane(c, r, [0, GROUND_Y, 0], [0, 1, 0]);
}

// The obstacle's `normal` points from the car into the obstacle; `point` is on
// its surface (for a pole, the surface point facing the car).
export function sphereVsObstacle(c: Vec3, r: number, o: Obstacle): Hit | null {
	if (o.kind === 'wall') return sphereVsPlane(c, r, o.point, scale(o.normal, -1));
	return sphereVsPole(c, r, add(o.point, scale(o.normal, o.poleRadius)), o.poleAxis, o.poleRadius);
}

// Swept sphere against the plane through `point` with unit normal `normal`:
// the slab of half-thickness r around the plane is entered at tEnter (0 when
// the sphere starts in it). A sweep exactly along the plane counts only while
// it is already inside the slab.
export function sweptSphereVsPlane(c: Vec3, r: number, travel: Vec3, point: Vec3, normal: Vec3): Hit | null {
	const h0 = dot(sub(c, point), normal);
	const dn = dot(travel, normal);
	let tEnter = 0;
	if (dn === 0) {
		if (Math.abs(h0) >= r) return null;
	} else {
		const ta = (h0 - r) / -dn, tb = (h0 + r) / -dn;
		tEnter = Math.max(Math.min(ta, tb), 0);
		if (Math.min(Math.max(ta, tb), 1) <= 0 || tEnter >= 1) return null;
	}
	const P = sub(add(c, scale(travel, tEnter)), scale(normal, h0 + dn * tEnter));
	return sweptHit(c, r, P, normal);
}

// The same against an endless round pole: the sweep meets the pole when its
// centre comes within r + poleRadius of the axis; the normal is the pole's
// outward one there.
export function sweptSphereVsPole(c: Vec3, r: number, travel: Vec3, axisPoint: Vec3, axis: Vec3, poleRadius: number): Hit | null {
	const perp = (v: Vec3) => sub(v, scale(axis, dot(v, axis)));
	const q = perp(sub(c, axisPoint)), d = perp(travel), reach = r + poleRadius;
	const c0 = dot(q, q) - reach * reach;
	let tEnter = 0;
	if (c0 > 0) {
		const a = dot(d, d), b = 2 * dot(q, d), disc = b * b - 4 * a * c0;
		if (a === 0 || disc < 0) return null;
		tEnter = (-b - Math.sqrt(disc)) / (2 * a);
		if (tEnter < 0 || tEnter >= 1) return null;
	}
	const at = add(c, scale(travel, tEnter));
	const radial = perp(sub(at, axisPoint));
	const dist = length(radial);
	if (dist < 1e-9) return null;
	const n = scale(radial, 1 / dist);
	const P = add(add(axisPoint, scale(axis, dot(sub(at, axisPoint), axis))), scale(n, poleRadius));
	return sweptHit(c, r, P, n);
}

// P is ahead of the start centre only if the centre started in front of the
// surface; the contact direction perpendicular to the surface is rejected too.
function sweptHit(c: Vec3, r: number, P: Vec3, normal: Vec3): Hit | null {
	const f = normalize(sub(P, c));
	if (!(dot(f, normal) < 0)) return null;
	return { pA: add(c, scale(f, r)), pB: P, n: normal };
}

export const sweptSphereVsGround = (c: Vec3, r: number, travel: Vec3) =>
	sweptSphereVsPlane(c, r, travel, [0, GROUND_Y, 0], [0, 1, 0]);

export function sweptSphereVsObstacle(c: Vec3, r: number, travel: Vec3, o: Obstacle): Hit | null {
	if (o.kind === 'wall') return sweptSphereVsPlane(c, r, travel, o.point, scale(o.normal, -1));
	return sweptSphereVsPole(c, r, travel, add(o.point, scale(o.normal, o.poleRadius)), o.poleAxis, o.poleRadius);
}
