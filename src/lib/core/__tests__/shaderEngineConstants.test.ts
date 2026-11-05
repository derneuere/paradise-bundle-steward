import { describe, it, expect } from 'vitest';
import { ENGINE_CONSTANT_DEFAULTS, inferCbLayout } from '../shaderEngineConstants';
import type { ParsedDxbc } from '../dxbc';

// Build a minimal ParsedDxbc whose RDEF declares the named constants at the
// given vec4 slots (startOffset = slot * 16).
function fakeParsed(slots: Record<string, number>): ParsedDxbc {
	const variables = Object.entries(slots).map(([name, slot]) => ({
		name,
		startOffset: slot * 16,
		size: 16,
	}));
	return {
		reflection: { constantBuffers: [{ variables }], resourceBindings: [] },
	} as unknown as ParsedDxbc;
}

describe('inferCbLayout', () => {
	it('recovers the full 4-row engine matrices from RDEF names', () => {
		const layout = inferCbLayout('', fakeParsed({
			world: 44,
			ViewProjectionModified: 5,
			ViewPosition: 37,
			worldViewProj: 50,
			viewProjection: 54,
		}));
		expect(layout.worldRow0).toBe(44);
		expect(layout.vpRow0).toBe(5);
		expect(layout.viewRow2).toBe(7); // regex fallback (no GLSL source)
		expect(layout.cameraPos).toBe(37);
		// The two matrices that were previously never bound:
		expect(layout.worldViewProjRow0).toBe(50);
		expect(layout.viewProjectionRow0).toBe(54);
	});

	it('returns null matrix slots when the shader does not declare them', () => {
		const layout = inferCbLayout('', fakeParsed({ world: 44, ViewProjectionModified: 5 }));
		expect(layout.worldViewProjRow0).toBeNull();
		expect(layout.viewProjectionRow0).toBeNull();
	});

	it('falls back to defaults with no parsed reflection', () => {
		const layout = inferCbLayout('');
		expect(layout.worldRow0).toBe(44);
		expect(layout.vpRow0).toBe(5);
		expect(layout.worldViewProjRow0).toBeNull();
	});
});

describe('ENGINE_CONSTANT_DEFAULTS', () => {
	it('covers the engine-supplied constants the real shaders reference', () => {
		// These appear in 200+ of the example shaders and previously read zero.
		for (const name of [
			'KeyLightDirection', 'KeyLightColour', 'FogColourPlusWhiteLevel',
			'IrradianceQuadricA', 'IrradianceQuadricB', 'HDRConstants',
			'ShadowMap_Constants', 'ScattCoeffs', 'g_paintColour',
		]) {
			expect(ENGINE_CONSTANT_DEFAULTS[name], name).toBeDefined();
			// One register (4 floats) each, except the 4x4 irradiance quadrics.
			expect(ENGINE_CONSTANT_DEFAULTS[name]).toHaveLength(name.startsWith('IrradianceQuadric') ? 16 : 4);
		}
	});

	it('carries the derived daylight, pre-scaled by the 0.5 white level', () => {
		expect(ENGINE_CONSTANT_DEFAULTS.HDRConstants).toEqual([0.5, 2, 0, 0]);
		expect(ENGINE_CONSTANT_DEFAULTS.FogColourPlusWhiteLevel[3]).toBe(0.5);
		// No vehicle fog at preview distances.
		expect(ENGINE_CONSTANT_DEFAULTS.g_PerVehicleFog).toEqual([0, 0, 0, 1]);
		const [x, y, z] = ENGINE_CONSTANT_DEFAULTS.KeyLightDirection;
		expect(Math.hypot(x, y, z)).toBeCloseTo(1, 6);
		expect(y).toBeLessThan(0);
	});
});
