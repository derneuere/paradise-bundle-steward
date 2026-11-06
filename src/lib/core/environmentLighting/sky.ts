// The game's analytic sky model: the colour of the sky dome in one direction,
// from a keyframe's sky scattering colours. The sky dome's pixel shader runs
// the same model, so this is what the car reflects when it reflects the sky.
//
// Horizon colour, widened toward the sun by a wide sun lobe, ramps up into the
// zenith colour by pow(dir.y, horizonPower); near the sun's AZIMUTH the ramp's
// exponent grows ("horizon bleed": the warm horizon reaches further up beside
// a low sun). A tight lobe paints the sun itself, and mfSkyDrk darkens the
// half of the sky facing away from the sun. Below the horizon the ramp is zero,
// so the dome is horizon-coloured there.

import type { EnvironmentScatteringData, Vec3 } from '../environmentSettings';

type V4 = [number, number, number, number];

const lerp4 = (a: V4, b: V4, t: number): V4 => [
	a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t,
];

/** Sky colour toward `dir` (unit) with the sun toward `sunDir` (unit, pointing AT the sun). */
export function skyColour(s: EnvironmentScatteringData, sunDir: Vec3, dir: Vec3): Vec3 {
	const top: V4 = [s.mv3SkyTopColour.x, s.mv3SkyTopColour.y, s.mv3SkyTopColour.z, s.mfSkyDrk];
	const hor: V4 = [s.mv3SkyHorColour.x, s.mv3SkyHorColour.y, s.mv3SkyHorColour.z, s.mfSkyHorPow];
	const sun: V4 = [s.mv3SkySunColour.x, s.mv3SkySunColour.y, s.mv3SkySunColour.z, s.mfSkySunPow];

	const xzProduct = Math.hypot(dir.x, dir.z) * Math.hypot(sunDir.x, sunDir.z);
	const cosAzimuth = xzProduct >= 0.001 ? (dir.x * sunDir.x + dir.z * sunDir.z) / xzProduct : 0;
	// The game doesn't clamp this base; at the exact anti-sun azimuth rounding can
	// push it a hair below zero, which only matters for a NaN, so clamp here.
	const horBleed = Math.pow(Math.max((cosAzimuth + 1) * 0.5, 0), s.mfSkyHorBleedPow);
	const horPow = s.mfSkyHorPow * (1 + s.mfSkyHorBleedScl * (1 - sunDir.y) * horBleed);
	const topBlend = Math.pow(Math.max(dir.y, 0), horPow);

	const sunDot = sunDir.x * dir.x + sunDir.y * dir.y + sunDir.z * dir.z;
	const sunDotSat = Math.max(sunDot, 0);
	const sunCore = Math.pow(sunDotSat, s.mfSkySunPow);
	const sunBleed = Math.pow(sunDotSat, s.mfSkySunBleedPow);
	const darkening = s.mfSkyDrk * ((sunDot + 1) * 0.5) + (1 - s.mfSkyDrk);

	let c = lerp4(hor, sun, sunBleed);
	c = lerp4(c, top, topBlend);
	c = lerp4(c, sun, sunCore);
	return { x: c[0] * darkening, y: c[1] * darkening, z: c[2] * darkening };
}
