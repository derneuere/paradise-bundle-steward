// What the car's collision spheres can touch, and the in-place sphere test
// the game runs against it. The game's world is road and wall triangles; the
// editor has the ground plane (y = 0) plus the obstacle of the current hit, an
// endless wall or a pole. The pole is a smooth cylinder here, where the game
// would only ever meet a faceted one.
//
// The sphere test is one-sided: a sphere whose centre is not at least 1 mm in
// front of a surface touches nothing (so a car driven through a wall stays
// through it), and a surface more than 2 m beyond the sphere's skin is
// ignored. Within that padding a separated sphere still yields a contact; the
// latch (contacts.ts) decides whether it closes this step.

import type { Vec3 } from '../deformationSpec';
import { add, dot, length, scale, sub, type Obstacle } from './state';

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
