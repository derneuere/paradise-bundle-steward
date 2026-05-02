// Sanity tests on the target preset registry. The registry itself is data,
// so the tests are mostly "is the data well-formed" — unique ids, valid
// platform values, and the launch preset matches the issue spec.

import { describe, expect, it } from 'vitest';
import { TARGET_PRESETS, getTargetPreset } from '../targets';

describe('TARGET_PRESETS', () => {
	it('has at least one preset', () => {
		expect(TARGET_PRESETS.length).toBeGreaterThan(0);
	});

	it('every preset has a unique id', () => {
		const ids = TARGET_PRESETS.map((p) => p.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it('every preset names a known platform', () => {
		for (const p of TARGET_PRESETS) {
			expect([1, 2, 3]).toContain(p.platform);
		}
	});

	it('every preset names a known container', () => {
		for (const p of TARGET_PRESETS) {
			expect(['bnd1', 'bnd2']).toContain(p.container);
		}
	});

	it('ships with paradise-pc-retail (V12, BND2, PC) at launch', () => {
		const preset = getTargetPreset('paradise-pc-retail');
		expect(preset).toBeDefined();
		expect(preset?.container).toBe('bnd2');
		expect(preset?.platform).toBe(1);
		// AI Sections (typeId 0x10001) → v12.
		expect(preset?.kinds[0x10001]).toBe('v12');
	});

	it('returns undefined for unknown preset ids', () => {
		expect(getTargetPreset('unknown-preset-id')).toBeUndefined();
	});
});
