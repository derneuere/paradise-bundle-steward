import { describe, expect, it } from 'vitest';
import { skyColour } from '../sky';
import { RETAIL_DAYLIGHT_LOOK } from '../retailDaylight';
import type { EnvironmentScatteringData } from '../../environmentSettings';

const S = RETAIL_DAYLIGHT_LOOK.scattering;
const up = { x: 0, y: 1, z: 0 };
const down = { x: 0, y: -1, z: 0 };

describe('skyColour', () => {
	it('is the zenith colour straight up with the sun on the horizon', () => {
		const c = skyColour(S, { x: 1, y: 0, z: 0 }, up);
		expect(c.x).toBeCloseTo(S.mv3SkyTopColour.x, 6);
		expect(c.y).toBeCloseTo(S.mv3SkyTopColour.y, 6);
		expect(c.z).toBeCloseTo(S.mv3SkyTopColour.z, 6);
	});

	it('is the horizon colour below the horizon, away from the sun', () => {
		const c = skyColour(S, up, down);
		expect(c.x).toBeCloseTo(S.mv3SkyHorColour.x, 6);
		expect(c.z).toBeCloseTo(S.mv3SkyHorColour.z, 6);
	});

	it('is the sun colour looking into the sun', () => {
		const sun = { x: 0.6, y: 0.8, z: 0 };
		const c = skyColour(S, sun, sun);
		expect(c.x).toBeCloseTo(S.mv3SkySunColour.x, 6);
		expect(c.z).toBeCloseTo(S.mv3SkySunColour.z, 6);
	});

	it('darkens the anti-sun half by mfSkyDrk', () => {
		expect(skyColour({ ...S, mfSkyDrk: 1 }, up, down).x).toBeCloseTo(0, 9);
		const half: EnvironmentScatteringData = { ...S, mfSkyDrk: 0.5 };
		expect(skyColour(half, up, down).x).toBeCloseTo(S.mv3SkyHorColour.x * 0.5, 6);
	});

	it('blends from the warm horizon toward the blue zenith as the view rises', () => {
		const sun = { x: 0, y: 0.9, z: Math.sqrt(1 - 0.81) };
		const low = skyColour(S, sun, { x: -1, y: 0, z: 0 });
		const high = skyColour(S, sun, { x: -0.5, y: Math.sqrt(0.75), z: 0 });
		expect(high.x).toBeLessThan(low.x);
	});

	it('stays finite at the anti-sun azimuth', () => {
		const sun = { x: 0.6, y: 0.64, z: -0.48 };
		const c = skyColour(S, sun, { x: -0.6, y: 0.0, z: 0.48 / 0.6 * 0.6 });
		expect(Number.isFinite(c.x + c.y + c.z)).toBe(true);
	});
});
