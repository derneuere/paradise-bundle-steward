import { describe, expect, it } from 'vitest';
import { GROUND_ALBEDO, cubeFaceDirection, reflectionCubeFaces, reflectionRadiance } from '../reflection';
import { skyColour } from '../sky';
import { evaluateIrradianceMatrices } from '../irradiance';
import { DEFAULT_ENGINE_LIGHTING as env } from '../defaults';

describe('reflectionRadiance', () => {
	it('is the white-level-scaled sky above the horizon', () => {
		const dir = { x: 0, y: 1, z: 0 };
		const L = env.keyLightDirection;
		const sky = skyColour(env.scattering, { x: -L.x, y: -L.y, z: -L.z }, dir);
		const r = reflectionRadiance(env, dir);
		expect(r.x).toBeCloseTo(sky.x * 0.5, 9);
		expect(r.z).toBeCloseTo(sky.z * 0.5, 9);
	});

	it('is a lit grey ground below the horizon', () => {
		const r = reflectionRadiance(env, { x: 0, y: -1, z: 0 });
		const amb = evaluateIrradianceMatrices(env.irradiance, { x: 0, y: 1, z: 0 });
		const nDotL = -env.keyLightDirection.y;
		expect(r.y).toBeCloseTo(GROUND_ALBEDO * (Math.min(env.keyLightColour.y, 0.5) * nDotL + amb.y), 9);
	});

	it('fills six opaque RGBA8 faces', () => {
		const faces = reflectionCubeFaces(env, 8);
		expect(faces).toHaveLength(6);
		for (const f of faces) {
			expect(f).toHaveLength(8 * 8 * 4);
			for (let i = 3; i < f.length; i += 4) expect(f[i]).toBe(255);
		}
	});
});

describe('cubeFaceDirection', () => {
	it('maps each face centre onto its axis, in GL face order', () => {
		const axes = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
		axes.forEach((axis, f) => {
			const d = cubeFaceDirection(f, 32, 32, 65);
			expect([d.x, d.y, d.z].map((v) => Math.round(v) + 0)).toEqual(axis);
		});
	});

	it('follows the GL face orientation', () => {
		// +X face: s runs toward -z, t toward -y.
		const d = cubeFaceDirection(0, 63, 63, 64);
		expect(d.z).toBeLessThan(0);
		expect(d.y).toBeLessThan(0);
		// +Y face: s toward +x, t toward +z.
		const top = cubeFaceDirection(2, 0, 63, 64);
		expect(top.x).toBeLessThan(0);
		expect(top.z).toBeGreaterThan(0);
	});

	it('returns unit vectors', () => {
		const d = cubeFaceDirection(4, 3, 50, 64);
		expect(Math.hypot(d.x, d.y, d.z)).toBeCloseTo(1, 12);
	});
});
