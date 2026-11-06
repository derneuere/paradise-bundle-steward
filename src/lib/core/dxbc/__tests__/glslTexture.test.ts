// Sampling: the resource swizzle, cube maps, LOD / bias / gradient forms and
// the shadow-map compare.

import { describe, it, expect } from 'vitest';
import { decl, dst, imm, ins, resource, sampler, swz, temp, translate } from './emitHarness';

const CUBE_DCL = 6, TEX2D_DCL = 3;

describe('sample', () => {
	it('applies the resource swizzle to the texel before the destination mask', () => {
		// DXT5 normal maps: `sample r0.xy, r1, t0.ywxz, s0` reads G and A.
		const { source } = translate([ins('sample', [dst(0, 0x3), temp(1), resource(0, swz('ywxz')), sampler(0)])]);
		expect(source).toContain('r0.xy = vec4(texture(_t0, vec4(r1.xyzw).xy).ywxz).xy;');
	});

	it('declares a texturecube resource as samplerCube and samples it with a direction', () => {
		const { source } = translate(
			[ins('sample', [dst(0), temp(1), resource(13), sampler(13)])],
			{ decls: [decl({ kind: 'resource', register: 13, dim: CUBE_DCL, returnType: 0 })], textures: [{ name: 'ReflectionTexture', reg: 13, dimension: 9 }] },
		);
		expect(source).toContain('uniform samplerCube ReflectionTexture; // t13');
		expect(source).toContain('texture(ReflectionTexture, vec4(r1.xyzw).xyz)');
	});

	it('keeps 2D textures as sampler2D', () => {
		const { source } = translate(
			[ins('sample', [dst(0), temp(1), resource(0), sampler(0)])],
			{ decls: [decl({ kind: 'resource', register: 0, dim: TEX2D_DCL, returnType: 0 })] },
		);
		expect(source).toContain('uniform sampler2D _t0; // t0');
	});

	it('passes the explicit LOD, bias and gradients through', () => {
		const lod = translate([ins('sample_l', [dst(0), temp(1), resource(0), sampler(0), temp(2, 2)])]).source;
		expect(lod).toContain('textureLod(_t0, vec4(r1.xyzw).xy, vec4(r2.x).x)');
		const bias = translate([ins('sample_b', [dst(0), temp(1), resource(0), sampler(0), temp(2, 2)])]).source;
		expect(bias).toContain('texture(_t0, vec4(r1.xyzw).xy, vec4(r2.x).x)');
		const grad = translate([ins('sample_d', [dst(0), temp(1), resource(0), sampler(0), temp(2), temp(3)])]).source;
		expect(grad).toContain('textureGrad(_t0, vec4(r1.xyzw).xy, vec4(r2.xyzw).xy, vec4(r3.xyzw).xy)');
	});

	it('applies an immediate texel offset', () => {
		const { source } = translate([ins('sample', [dst(0), temp(1), resource(0), sampler(0)], { texelOffset: [1, -2, 0] })]);
		expect(source).toContain('textureOffset(_t0, vec4(r1.xyzw).xy, ivec2(1, -2))');
	});
});

describe('sample_c_lz (shadow map compare)', () => {
	const shadow = () => translate([ins('sample_c_lz', [dst(0, 0x1), temp(1), resource(4, swz('xxxx')), sampler(2), temp(1, 2)])]);

	it('compares the reference against the mip-0 texel with the sampler compare function', () => {
		const { source } = shadow();
		expect(source).toContain('uniform int _cmpFunc_s2;');
		expect(source).toContain('r0.x = vec4(vec4(_dxCompare(vec4(r1.x).x, textureLod(_t4, vec4(r1.xyzw).xy, 0.0).x, _cmpFunc_s2)).xxxx).x;');
	});

	it('defaults an unset compare function to LESS_EQUAL with the reference clamped, so a white map is lit', () => {
		const { source } = shadow();
		const helper = source.slice(source.indexOf('float _dxCompare'));
		expect(helper).toContain('ref = clamp(ref, 0.0, 1.0);');
		// The last (fall-through) case, taken for func 0 and 4.
		expect(helper).toMatch(/return ref <= texel \? 1\.0 : 0\.0;\s*\}/);
	});

	it('emits no compare helper for a shader that never compares', () => {
		const { source } = translate([ins('sample', [dst(0), temp(1), resource(0), sampler(0)])]);
		expect(source).not.toContain('_dxCompare');
	});
});

describe('immediates feeding a sample', () => {
	it('reads an integer LOD immediate as its integer value', () => {
		const { source } = translate([ins('sample_l', [dst(0), temp(1), resource(0), sampler(0), imm(2)])]);
		expect(source).toContain('textureLod(_t0, vec4(r1.xyzw).xy, vec4(vec4(2.0)).x)');
	});
});
