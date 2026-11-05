// The engine's per-frame lighting constants, derived from an environment
// keyframe the way the game derives them.
//
// Every frame the game blends the current season's two time-of-day keyframes
// that bracket the clock (linear in time, clamped at the ends of the day's
// schedule) and publishes from the blend:
//   KeyLightColour          keyframe key light × white level
//   KeyLightClampedColour   the same clamped to [0, white level] (what diffuse uses)
//   KeyLightSpecularColour  keyframe specular × white level
//   KeyLightDirection       the sun rig at the clamped time of day (see sun.ts)
//   IrradianceQuadricA/B    the fill rig's irradiance (see irradiance.ts) × white level
//   FogColourPlusWhiteLevel (horizon in-scatter colour × white level, white level)
//   ScattCoeffs             (1/(far-near), near/(far-near), pow, cap) of the fog ramp
//   HDRConstants            (white level, 1/white level, 0, 0)
//   SkyReflectionColour     (sky horizon colour × white level, horizon power)
// Cars are drawn with the key light and ambient boosted by 1.175 (the clamped
// key light is clamped after the boost). The per-car g_PerVehicleFog is
// (fog colour × t, 1 - t) with t = pow(saturate(d·x - y), z)·w over the
// camera distance d and ScattCoeffs — zero fog within the near distance (25 m
// in the daylight keyframes), which covers any close-up preview.
//
// WHITE LEVEL. Every light colour is pre-multiplied by the white level (0.5 by
// default) so the scene renders into half the target's range, leaving headroom
// for overbright; the post-process divides it back out (and then grades with
// the keyframe's colour cube). A faithful preview therefore shows
// clamp(colour / whiteLevel, 0, 1). The game's pipeline is gamma-space end to
// end: no sRGB decode on textures, no sRGB encode on output.

import type { EnvironmentLightingData, EnvironmentScatteringData, Vec3 } from '../environmentSettings';
import { DEFAULT_TIME_OF_DAY, keyLightDirection } from './sun';
import { irradianceMatrices, packIrradianceQuadrics, type IrradianceMatrices } from './irradiance';

/** The two keyframe blocks that drive lighting (bloom/vignette/clouds are post-fx / sky only). */
export type EnvironmentLook = {
	lighting: EnvironmentLightingData;
	scattering: EnvironmentScatteringData;
};

export type TimedLook = { timeOfDay: number; look: EnvironmentLook };

export const DEFAULT_WHITE_LEVEL = 0.5;
export const CAR_KEY_LIGHT_MULTIPLIER = 1.175;
export const CAR_AMBIENT_MULTIPLIER = 1.175;

export type EngineLightingOptions = {
	timeOfDay?: number;
	whiteLevel?: number;
	/** Camera-to-car distance for the per-vehicle fog (world units). */
	cameraDistance?: number;
};

export type EngineLighting = {
	whiteLevel: number;
	timeOfDay: number;
	/** Direction the key light travels (world space, unit). */
	keyLightDirection: Vec3;
	/** World-pass (un-boosted) key light, already × white level. */
	keyLightColour: Vec3;
	/** World-pass irradiance matrices, already × white level. */
	irradiance: IrradianceMatrices;
	scattering: EnvironmentScatteringData;
	/** cb0 values by RDEF variable name for a CAR draw; 4 floats per register. */
	carConstants: Record<string, number[]>;
};

type Tree = number | number[] | { [k: string]: Tree };

function lerpTree<T extends Tree>(a: T, b: T, wa: number, wb: number): T {
	if (typeof a === 'number') return (a * wa + (b as number) * wb) as T;
	if (Array.isArray(a)) return a.map((x, i) => x * wa + (b as number[])[i] * wb) as T;
	const out: Record<string, Tree> = {};
	for (const k of Object.keys(a)) out[k] = lerpTree(a[k], (b as Record<string, Tree>)[k], wa, wb);
	return out as T;
}

/**
 * Blend a location's ascending keyframe schedule at `timeOfDay` the way the
 * game does: the two keyframes that bracket the time, weighted linearly;
 * before the first / after the last keyframe the end keyframe alone.
 */
export function blendTimeline(schedule: readonly TimedLook[], timeOfDay: number): EnvironmentLook {
	if (schedule.length === 0) throw new Error('blendTimeline: empty schedule');
	let i = 0;
	while (i < schedule.length && timeOfDay >= schedule[i].timeOfDay) i++;
	if (i === schedule.length) return schedule[schedule.length - 1].look;
	if (i === 0) return schedule[0].look;
	const a = schedule[i - 1];
	const b = schedule[i];
	const wa = (b.timeOfDay - timeOfDay) / (b.timeOfDay - a.timeOfDay);
	return lerpTree(a.look as unknown as Tree, b.look as unknown as Tree, wa, 1 - wa) as unknown as EnvironmentLook;
}

const v3 = (c: Vec3, s: number): Vec3 => ({ x: c.x * s, y: c.y * s, z: c.z * s });
const vec4 = (c: Vec3, w: number) => [c.x, c.y, c.z, w];

export function deriveEngineLighting(look: EnvironmentLook, opts: EngineLightingOptions = {}): EngineLighting {
	const wl = opts.whiteLevel ?? DEFAULT_WHITE_LEVEL;
	const tod = opts.timeOfDay ?? DEFAULT_TIME_OF_DAY;
	const { lighting: L, scattering: S } = look;
	const dir = keyLightDirection(tod);

	const irradiance = irradianceMatrices(dir, L).map((m) => m.map((x) => x * wl)) as IrradianceMatrices;
	const carQuadrics = packIrradianceQuadrics(irradiance.map((m) => m.map((x) => x * CAR_AMBIENT_MULTIPLIER)) as IrradianceMatrices);
	const carQuadricA = carQuadrics.a;
	const carQuadricB = carQuadrics.b;

	const keyLight = v3(L.mv3KeyLightColour, wl);
	const carKey = v3(keyLight, CAR_KEY_LIGHT_MULTIPLIER);
	const clamp = (x: number) => Math.min(Math.max(x, 0), wl);

	const near = S.mafScattDist[0];
	const far = S.mafScattDist[1];
	const scattCoeffs = [1 / (far - near), near / (far - near), S.mfScattPow, S.mfScattCap];
	const fogColour = v3(S.mv3ScattHorColour, wl);
	const d = opts.cameraDistance ?? 0;
	const fogT = Math.pow(Math.min(Math.max(d * scattCoeffs[0] - scattCoeffs[1], 0), 1), scattCoeffs[2]) * scattCoeffs[3];

	return {
		whiteLevel: wl,
		timeOfDay: tod,
		keyLightDirection: dir,
		keyLightColour: keyLight,
		irradiance,
		scattering: S,
		carConstants: {
			KeyLightColour: vec4(carKey, 0),
			KeyLightClampedColour: [clamp(carKey.x), clamp(carKey.y), clamp(carKey.z), 0],
			KeyLightSpecularColour: vec4(v3(L.mv3SpecularColour, wl), 0),
			KeyLightDirection: vec4(dir, 0),
			IrradianceQuadricA: carQuadricA,
			IrradianceQuadricB: carQuadricB,
			FogColourPlusWhiteLevel: vec4(fogColour, wl),
			ScattCoeffs: scattCoeffs,
			HDRConstants: [wl, 1 / wl, 0, 0],
			SkyReflectionColour: vec4(v3(S.mv3SkyHorColour, wl), S.mfSkyHorPow),
			g_PerVehicleFog: vec4(v3(fogColour, fogT), 1 - fogT),
		},
	};
}
