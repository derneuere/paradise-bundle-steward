// The translated shaders' output transform keeps the shader's alpha only for
// draws that use it (blended or alpha-to-coverage); opaque draws get alpha 1.

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildTranslatedShaderMaterial } from '@/lib/core/translatedShaderMaterial';
import { knobGroupForConstant, type CbLayout } from '@/lib/core/shaderEngineConstants';

const build = (keepAlpha: boolean | undefined, mode: 'game' | 'preview') => buildTranslatedShaderMaterial({
	vsSource: 'precision highp float;\nvoid main() {\n\tgl_Position = vec4(0.0);\n}',
	psSource: 'precision highp float;\nvoid main() {\n\tgl_FragColor = vec4(1.0, 1.0, 1.0, 0.45);\n}',
	shaderName: 'Vehicle_Greyscale_Window_Textured',
	shaderConstants: [],
	// TODO(types): the layout is unused without a cb0
	layout: {} as CbLayout,
	materialBinding: null,
	textureCatalog: [],
	heuristicDefaults: {},
	pickFallbackTexture: () => new THREE.DataTexture(),
	decodedToDataTexture: () => null,
	applyPreviewTonemap: mode === 'preview',
	displayWhiteLevel: mode === 'game' ? 0.5 : undefined,
	keepAlpha,
});

describe('translated output alpha', () => {
	it('keeps the shader alpha when asked, in both output transforms', () => {
		for (const mode of ['game', 'preview'] as const) {
			const fs = build(true, mode).fragmentShader;
			expect(fs).toContain('float _a = clamp(gl_FragColor.a, 0.0, 1.0);');
			expect(fs).toMatch(/clamp\(_c, 0\.0, 1\.0\), _a\)|a \/ \(a \+ vec3\(1\.0\)\), _a\)/);
		}
	});

	it('forces alpha 1 by default', () => {
		for (const mode of ['game', 'preview'] as const) {
			expect(build(undefined, mode).fragmentShader).toContain('float _a = 1.0;');
		}
	});
});

describe('knobGroupForConstant', () => {
	it('scales the key light colours but never its direction', () => {
		expect(knobGroupForConstant('KeyLightColour')).toBe('keyLight');
		expect(knobGroupForConstant('KeyLightSpecularColour')).toBe('keyLight');
		expect(knobGroupForConstant('KeyLightDirection')).toBeNull();
		expect(knobGroupForConstant('IrradianceQuadricA')).toBe('ambient');
		expect(knobGroupForConstant('FogColourPlusWhiteLevel')).toBe('fog');
		expect(knobGroupForConstant('world')).toBeNull();
	});
});
