import { describe, expect, it } from 'vitest';
import { DEFAULT_TIME_OF_DAY, keyLightDirection, sunRigDirection } from '../sun';

const len = (v: { x: number; y: number; z: number }) => Math.hypot(v.x, v.y, v.z);

describe('keyLightDirection', () => {
	it('matches the direction the game publishes at its 13:00 start time', () => {
		const d = keyLightDirection(DEFAULT_TIME_OF_DAY);
		expect(d.x).toBeCloseTo(-0.424578, 5);
		expect(d.y).toBeCloseTo(-0.669810, 5);
		expect(d.z).toBeCloseTo(-0.609170, 5);
	});

	it('defaults to 13:00', () => {
		expect(keyLightDirection()).toEqual(keyLightDirection(46800));
	});

	it('clamps the time of day into 09:00–16:00 before lighting', () => {
		expect(keyLightDirection(6 * 3600)).toEqual(keyLightDirection(9 * 3600));
		expect(keyLightDirection(21 * 3600)).toEqual(keyLightDirection(16 * 3600));
		expect(keyLightDirection(10 * 3600)).not.toEqual(keyLightDirection(9 * 3600));
	});

	it('is a unit vector pointing down (the direction light travels)', () => {
		for (let h = 9; h <= 16; h += 0.5) {
			const d = keyLightDirection(h * 3600);
			expect(len(d)).toBeCloseTo(1, 9);
			expect(d.y).toBeLessThan(0);
		}
	});
});

describe('sunRigDirection', () => {
	it('tilts the midday sun 50° off vertical inside the 45°-rotated rig', () => {
		const d = sunRigDirection(Math.PI / 2);
		expect(d.y).toBeCloseTo(-Math.cos(50 * Math.PI / 180), 9);
		// x/z only come from the tilt, split evenly by the 45° rig rotation.
		expect(d.x).toBeCloseTo(d.z, 9);
	});

	it('tilts 20° at the horizon', () => {
		const d = sunRigDirection(0);
		// At sunrise the base direction is (-1, 0, 0): no tilt component, just the rig turn.
		expect(d.y).toBeCloseTo(0, 9);
		expect(d.x).toBeCloseTo(-Math.cos(Math.PI / 4), 9);
		expect(d.z).toBeCloseTo(Math.sin(Math.PI / 4), 9);
	});
});
