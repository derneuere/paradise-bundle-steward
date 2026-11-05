// Debris pieces: small chunks (paint-coloured, shiny, dark, large body bits)
// and glass. They fall under gravity with a little air drag, bounce off the
// ground and the obstacle a few times (2 - 5, fixed per piece) losing speed
// each time, then lie still until their 1.4 - 2 s life runs out. Each piece
// tumbles about a random axis in proportion to the distance it travels.

import type { Vec3 } from '../deformationSpec';
import { add, dot, length, normalize, scale, sub } from '../deformationSim/state';
import type { Rng } from './random';
import { DEBRIS_DRAG, DEBRIS_GRAVITY, DEBRIS_LIFETIMES, DEBRIS_PRESETS, DebrisKind } from './tables';

export type Debris = {
	kind: DebrisKind;
	birth: number;
	life: number;
	p: Vec3;
	v: Vec3;
	axis: Vec3;      // tumble axis
	spinRate: number; // radians per metre travelled
	angle: number;
	size: number;    // metres
	colour: Vec3;
	bouncesLeft: number;
	still: boolean;
};

// A surface debris can hit: the ground (normal +Y) or the wall face.
export type Plane = { point: Vec3; normal: Vec3 };

const frac = (x: number) => x - Math.floor(x);

// The paint randomiser: somewhere between a quarter and three quarters of
// the way from the colour's grey to the colour itself, darkened 10 - 50 %.
export function debrisColour(base: Vec3, rng: Rng): Vec3 {
	const grey = (base[0] + base[1] + base[2]) / 3;
	const r = rng.next();
	const shade = rng.range(0.5, 0.9);
	return base.map((c) => {
		const lo = grey + 0.25 * (c - grey), hi = grey + 0.75 * (c - grey);
		return (lo + (hi - lo) * r) * shade;
	}) as Vec3;
}

export function randomUnit(rng: Rng): Vec3 {
	const z = rng.range(-1, 1), a = rng.range(0, 2 * Math.PI), r = Math.sqrt(1 - z * z);
	return [r * Math.cos(a), r * Math.sin(a), z];
}

export function makeDebris(
	kind: DebrisKind, p: Vec3, v: Vec3, size: number, time: number, index: number, paint: Vec3, rng: Rng,
): Debris {
	const preset = DEBRIS_PRESETS[kind];
	const base = preset.colour === 'paint' ? paint : preset.colour;
	const colour = scale(debrisColour(base, rng), preset.diffuse);
	const spinRate = rng.range(0.5, 4);
	return {
		kind, birth: time, life: DEBRIS_LIFETIMES[index & 3], p, v, axis: randomUnit(rng), spinRate, angle: 0, size, colour,
		bouncesLeft: Math.floor(frac(((spinRate + 2.468) * (size + 1.357)) ** 2) * 3 + 2.5),
		still: false,
	};
}

export function stepDebris(d: Debris, dt: number, planes: readonly Plane[], rng: Rng): void {
	if (d.still) return;
	d.v = scale(add(d.v, [0, DEBRIS_GRAVITY * dt, 0]), 1 - DEBRIS_DRAG * dt);
	const move = scale(d.v, dt);
	let next = add(d.p, move);
	for (const plane of planes) {
		const before = dot(sub(d.p, plane.point), plane.normal);
		const after = dot(sub(next, plane.point), plane.normal);
		if (!(before >= 0 && after < 0)) continue;
		// Stop just short of the surface, bounce, and kick sideways a little.
		const hit = before / (before - after);
		next = add(d.p, scale(move, hit * 0.95));
		const n = plane.normal;
		const b = DEBRIS_PRESETS[d.kind].bounciness;
		const loss = rng.range(0.6, 1.0);
		const r = sub(d.v, scale(n, 2 * dot(n, d.v)));
		d.v = [r[0] * b[0] * loss, r[1] * b[1] * loss, r[2] * b[2] * loss];
		d.v = add(d.v, [(rng.next() - 0.5) * d.v[1], 0, (rng.next() - 0.5) * d.v[1]]);
		if (--d.bouncesLeft <= 0) { d.still = true; d.v = [0, 0, 0]; }
		break;
	}
	d.angle += d.spinRate * length(sub(next, d.p));
	d.p = next;
}

// 0..1 visibility: grows in over the preset's fade-in, fades over the last 0.8 s.
export function debrisFade(d: Debris, age: number, fadeOut: number): number {
	const fadeIn = DEBRIS_PRESETS[d.kind].fadeIn;
	return Math.min(1, age / fadeIn, Math.max(0, (d.life - age) / fadeOut));
}

// A direction inside the cone of half-angle `deg` around +Y.
export function upCone(deg: number, rng: Rng): Vec3 {
	const theta = rng.range(0, deg) * (Math.PI / 180), phi = rng.range(0, 2 * Math.PI);
	return normalize([Math.sin(theta) * Math.cos(phi), Math.cos(theta), Math.sin(theta) * Math.sin(phi)]);
}
