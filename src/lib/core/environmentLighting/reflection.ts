// What the car's reflection sampler sees, for a preview without a world.
//
// In game the vehicle shaders' ReflectionTextureSampler is a cube map the
// engine renders around the car every frame (the world, the sky dome), in the
// same white-level-scaled colour space as everything else. The paint shaders
// blend 50–100 % of it over the lit paint depending on the fresnel term, so
// the cube's content decides much of a car's look. A preview has no world, so
// the stand-in is the next best thing derived from the same keyframe: the sky
// dome above the horizon and a flat, lit asphalt ground below it.

import type { Vec3 } from '../environmentSettings';
import type { EngineLighting } from './engineLighting';
import { skyColour } from './sky';
import { evaluateIrradianceMatrices } from './irradiance';

/** Grey albedo for the stand-in ground (a mid-grey road surface, gamma space). */
export const GROUND_ALBEDO = 0.3;

const HORIZON_BAND = 0.02;

/** Reflected radiance toward unit `dir`, white-level scaled like the game's env map. */
export function reflectionRadiance(env: EngineLighting, dir: Vec3): Vec3 {
	const wl = env.whiteLevel;
	const L = env.keyLightDirection;
	const sunDir = { x: -L.x, y: -L.y, z: -L.z };
	const sky = skyColour(env.scattering, sunDir, dir);
	if (dir.y >= 0) return { x: sky.x * wl, y: sky.y * wl, z: sky.z * wl };

	const up = { x: 0, y: 1, z: 0 };
	const nDotL = Math.max(-L.y, 0);
	const amb = evaluateIrradianceMatrices(env.irradiance, up);
	const key = env.keyLightColour;
	const clamp = (x: number) => Math.min(Math.max(x, 0), wl);
	const ground = {
		x: GROUND_ALBEDO * (clamp(key.x) * nDotL + amb.x),
		y: GROUND_ALBEDO * (clamp(key.y) * nDotL + amb.y),
		z: GROUND_ALBEDO * (clamp(key.z) * nDotL + amb.z),
	};
	const t = Math.min(-dir.y / HORIZON_BAND, 1);
	return {
		x: sky.x * wl + (ground.x - sky.x * wl) * t,
		y: sky.y * wl + (ground.y - sky.y * wl) * t,
		z: sky.z * wl + (ground.z - sky.z * wl) * t,
	};
}

/**
 * Direction through texel centre (i, j) of cube face `face` (GL order
 * +X, -X, +Y, -Y, +Z, -Z; row j = increasing t), unit length.
 */
export function cubeFaceDirection(face: number, i: number, j: number, size: number): Vec3 {
	const sc = (2 * (i + 0.5)) / size - 1;
	const tc = (2 * (j + 0.5)) / size - 1;
	let d: Vec3;
	switch (face) {
		case 0: d = { x: 1, y: -tc, z: -sc }; break;
		case 1: d = { x: -1, y: -tc, z: sc }; break;
		case 2: d = { x: sc, y: 1, z: tc }; break;
		case 3: d = { x: sc, y: -1, z: -tc }; break;
		case 4: d = { x: sc, y: -tc, z: 1 }; break;
		default: d = { x: -sc, y: -tc, z: -1 }; break;
	}
	const l = Math.hypot(d.x, d.y, d.z);
	return { x: d.x / l, y: d.y / l, z: d.z / l };
}

/** RGBA8 pixels of the six cube faces (GL face order). */
export function reflectionCubeFaces(env: EngineLighting, size: number): Uint8Array[] {
	const to8 = (x: number) => Math.round(Math.min(Math.max(x, 0), 1) * 255);
	const faces: Uint8Array[] = [];
	for (let f = 0; f < 6; f++) {
		const px = new Uint8Array(size * size * 4);
		for (let j = 0; j < size; j++) {
			for (let i = 0; i < size; i++) {
				const c = reflectionRadiance(env, cubeFaceDirection(f, i, j, size));
				const o = (j * size + i) * 4;
				px[o] = to8(c.x); px[o + 1] = to8(c.y); px[o + 2] = to8(c.z); px[o + 3] = 255;
			}
		}
		faces.push(px);
	}
	return faces;
}
