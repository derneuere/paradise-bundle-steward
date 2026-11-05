import { describe, expect, it } from 'vitest';
import {
	CAR_AMBIENT_MULTIPLIER, CAR_KEY_LIGHT_MULTIPLIER, blendTimeline, deriveEngineLighting,
	type EnvironmentLook, type TimedLook,
} from '../engineLighting';
import { evaluateIrradianceMatrices, evaluateIrradianceQuadrics } from '../irradiance';
import { RETAIL_DAYLIGHT_LOOK } from '../retailDaylight';
import { DEFAULT_ENGINE_LIGHTING } from '../defaults';
import { keyLightDirection } from '../sun';

const withKey = (r: number): EnvironmentLook => ({
	lighting: { ...RETAIL_DAYLIGHT_LOOK.lighting, mv3KeyLightColour: { x: r, y: r, z: r } },
	scattering: { ...RETAIL_DAYLIGHT_LOOK.scattering, mafScattDist: [r, r + 100] },
});

describe('blendTimeline', () => {
	const schedule: TimedLook[] = [
		{ timeOfDay: 36000, look: withKey(1) },
		{ timeOfDay: 43200, look: withKey(2) },
		{ timeOfDay: 50400, look: withKey(4) },
	];

	it('interpolates every field linearly between the bracketing keyframes', () => {
		const b = blendTimeline(schedule, 46800);
		expect(b.lighting.mv3KeyLightColour.x).toBeCloseTo(3, 9);
		expect(b.scattering.mafScattDist[0]).toBeCloseTo(3, 9);
		expect(b.lighting.mfAmbientIrradianceScale).toBeCloseTo(0.4, 9);
	});

	it('returns a keyframe exactly at its time', () => {
		expect(blendTimeline(schedule, 43200).lighting.mv3KeyLightColour.x).toBeCloseTo(2, 9);
	});

	it('holds the first / last keyframe outside the schedule', () => {
		expect(blendTimeline(schedule, 0).lighting.mv3KeyLightColour.x).toBe(1);
		expect(blendTimeline(schedule, 80000).lighting.mv3KeyLightColour.x).toBe(4);
	});

	it('rejects an empty schedule', () => {
		expect(() => blendTimeline([], 0)).toThrow();
	});
});

describe('deriveEngineLighting', () => {
	const env = deriveEngineLighting(RETAIL_DAYLIGHT_LOOK);
	const K = env.carConstants;
	const key = RETAIL_DAYLIGHT_LOOK.lighting.mv3KeyLightColour;

	it('pre-scales the key light by the white level and boosts it for cars', () => {
		expect(K.KeyLightColour[0]).toBeCloseTo(key.x * 0.5 * CAR_KEY_LIGHT_MULTIPLIER, 9);
		expect(K.KeyLightColour[2]).toBeCloseTo(key.z * 0.5 * CAR_KEY_LIGHT_MULTIPLIER, 9);
		expect(env.keyLightColour.x).toBeCloseTo(key.x * 0.5, 9);
	});

	it('clamps the diffuse key light to the white level after the car boost', () => {
		// 1.3013 × 0.5 × 1.175 = 0.7645 → 0.5; 0.8078 × 0.5 × 1.175 = 0.4746 stays.
		expect(K.KeyLightClampedColour[0]).toBe(0.5);
		expect(K.KeyLightClampedColour[2]).toBeCloseTo(0.8077947 * 0.5875, 6);
		expect(K.KeyLightClampedColour[3]).toBe(0);
	});

	it('does not boost the specular colour', () => {
		expect(K.KeyLightSpecularColour[0]).toBeCloseTo(RETAIL_DAYLIGHT_LOOK.lighting.mv3SpecularColour.x * 0.5, 9);
	});

	it('publishes the sun direction and the HDR constants', () => {
		const d = keyLightDirection();
		expect(K.KeyLightDirection).toEqual([d.x, d.y, d.z, 0]);
		expect(K.HDRConstants).toEqual([0.5, 2, 0, 0]);
		expect(deriveEngineLighting(RETAIL_DAYLIGHT_LOOK, { whiteLevel: 0.25 }).carConstants.HDRConstants).toEqual([0.25, 4, 0, 0]);
	});

	it('moves the sun with the time of day', () => {
		const d = keyLightDirection(10 * 3600);
		expect(deriveEngineLighting(RETAIL_DAYLIGHT_LOOK, { timeOfDay: 10 * 3600 }).carConstants.KeyLightDirection).toEqual([d.x, d.y, d.z, 0]);
	});

	it('builds the fog ramp coefficients from the scattering distances', () => {
		expect(K.ScattCoeffs[0]).toBeCloseTo(1 / 1475, 12);
		expect(K.ScattCoeffs[1]).toBeCloseTo(25 / 1475, 12);
		expect(K.ScattCoeffs.slice(2)).toEqual([1, 0.87]);
		expect(K.FogColourPlusWhiteLevel[3]).toBe(0.5);
		expect(K.FogColourPlusWhiteLevel[0]).toBeCloseTo(0.385183 * 0.5, 9);
		expect(K.SkyReflectionColour[0]).toBeCloseTo(RETAIL_DAYLIGHT_LOOK.scattering.mv3SkyHorColour.x * 0.5, 9);
		expect(K.SkyReflectionColour[3]).toBe(0.5);
	});

	it('fogs a car only beyond the near scattering distance', () => {
		expect(deriveEngineLighting(RETAIL_DAYLIGHT_LOOK, { cameraDistance: 20 }).carConstants.g_PerVehicleFog).toEqual([0, 0, 0, 1]);
		const far = deriveEngineLighting(RETAIL_DAYLIGHT_LOOK, { cameraDistance: 1500 }).carConstants.g_PerVehicleFog;
		expect(far[3]).toBeCloseTo(1 - 0.87, 9);
		expect(far[0]).toBeCloseTo(0.385183 * 0.5 * 0.87, 9);
	});

	it('boosts the car irradiance quadrics by the ambient multiplier over the world irradiance', () => {
		const q = { a: K.IrradianceQuadricA, b: K.IrradianceQuadricB };
		for (const n of [{ x: 0, y: 1, z: 0 }, { x: 0.6, y: 0, z: 0.8 }, { x: 0, y: -1, z: 0 }]) {
			const world = evaluateIrradianceMatrices(env.irradiance, n);
			const car = evaluateIrradianceQuadrics(q, n);
			expect(car.y).toBeCloseTo(world.y * CAR_AMBIENT_MULTIPLIER, 9);
		}
	});

	it('gives a daylight ambient that is brighter and bluer from the sky than from the ground', () => {
		const up = evaluateIrradianceMatrices(env.irradiance, { x: 0, y: 1, z: 0 });
		const down = evaluateIrradianceMatrices(env.irradiance, { x: 0, y: -1, z: 0 });
		expect(up.z).toBeGreaterThan(down.z);
		expect(up.z).toBeGreaterThan(up.x);
		expect(up.y).toBeGreaterThan(0.1);
		expect(up.y).toBeLessThan(0.5);
	});

	it('is what the shared default is built from', () => {
		expect(DEFAULT_ENGINE_LIGHTING.carConstants).toEqual(K);
	});
});
