// Spec for the engine-global sampler fallback classifier + texture picker.
//
// The load-bearing facts: vehicle pixel shaders fold the sampled value of their
// engine-global samplers straight into the output colour, so the stand-in for a
// reflection / glass-fracture sampler must NOT be the loud magenta "missing
// texture" marker (that smears magenta over the whole car) — reflection reads a
// neutral sky, fracture reads black (no cracks), shadow reads white (lit).

import { describe, it, expect } from 'vitest';
import { classifyEngineSampler, pickEngineSamplerFallback } from '../engineSamplerFallback';

describe('classifyEngineSampler', () => {
	it('classifies the engine-global samplers seen on real vehicle shaders', () => {
		expect(classifyEngineSampler('shadowMapSamplerHighDetailTexture')).toBe('shadow');
		expect(classifyEngineSampler('ReflectionTextureSamplerTexture')).toBe('reflection');
		expect(classifyEngineSampler('GlassFractureSamplerTexture')).toBe('fracture');
		expect(classifyEngineSampler('NormalTextureSamplerTexture')).toBe('normal');
		expect(classifyEngineSampler('DiffuseTextureSamplerTexture')).toBe('diffuse');
	});

	it('routes depth/envmap/cube aliases to the right bucket', () => {
		expect(classifyEngineSampler('SceneDepthSampler')).toBe('shadow');
		expect(classifyEngineSampler('envMapSampler')).toBe('reflection');
		expect(classifyEngineSampler('Cube_Map_Sampler')).toBe('reflection');
	});

	it('prefers the more specific role when names overlap', () => {
		// "wavenormal" must beat the generic "normal" rule.
		expect(classifyEngineSampler('WaveNormalSampler')).toBe('wavenormal');
		// a reflection sampler that also says "normal" is still a reflection.
		expect(classifyEngineSampler('ReflectionNormalSampler')).toBe('reflection');
	});

	it('falls back to the loud magenta marker only for unknown samplers', () => {
		expect(classifyEngineSampler('SomeUnknownThingSampler')).toBe('magenta');
	});
});

function rgba(t: { image: { data: Uint8Array | Uint8ClampedArray } }): number[] {
	return Array.from(t.image.data.slice(0, 4));
}

describe('pickEngineSamplerFallback', () => {
	it('reflection is NOT magenta (the bug): a neutral sky-ish colour', () => {
		const tex = pickEngineSamplerFallback('ReflectionTextureSamplerTexture');
		const [r, g, b] = rgba(tex);
		// Not the magenta marker (255,64,200).
		expect(r === 255 && g === 64 && b === 200).toBe(false);
		// Bluish/neutral: blue is the dominant or co-dominant channel.
		expect(b).toBeGreaterThanOrEqual(g);
	});

	it('shadow → white, fracture → black, normal → flat (0,0,1)', () => {
		expect(rgba(pickEngineSamplerFallback('shadowMapSampler'))).toEqual([255, 255, 255, 255]);
		expect(rgba(pickEngineSamplerFallback('GlassFractureSampler'))).toEqual([0, 0, 0, 255]);
		expect(rgba(pickEngineSamplerFallback('NormalSampler'))).toEqual([128, 128, 255, 255]);
	});

	it('keeps magenta for genuinely unknown samplers', () => {
		expect(rgba(pickEngineSamplerFallback('WhatIsThisSampler'))).toEqual([255, 64, 200, 255]);
	});

	it('memoises — same sampler kind returns the same instance', () => {
		expect(pickEngineSamplerFallback('ReflectionA')).toBe(pickEngineSamplerFallback('ReflectionB'));
	});
});
