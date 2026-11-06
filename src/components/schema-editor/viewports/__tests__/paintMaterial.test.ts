import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { applyGamePaint, carryGamePaint, paintFragment } from '../paintMaterial';

// What three hands onBeforeCompile, trimmed to the chunks the patch touches.
const shaderStub = () => ({
	uniforms: {} as Record<string, { value: unknown }>,
	vertexShader: '#include <common>\nvoid main() {}',
	fragmentShader: '#include <common>\nvoid main() {\n#include <map_fragment>\n#include <color_fragment>\n}',
});

const compile = (mat: THREE.Material) => {
	const shader = shaderStub();
	// TODO(types): a stub, not a full WebGLProgramParametersWithUniforms
	mat.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
	return shader;
};

describe('paintFragment', () => {
	it('pearl: face-on pearl to paint by |N - V|^2, then the diffuse alpha masks the livery', () => {
		const f = paintFragment('pearl');
		expect(f).toContain('mix(uPearl, uPaint, min(dot(gpN - gpV, gpN - gpV), 1.0))');
		expect(f).toContain('mix(gpPaint, sampledDiffuseColor.rgb, sampledDiffuseColor.a)');
	});

	it('masked: the paint under the diffuse alpha, no pearl', () => {
		const f = paintFragment('masked');
		expect(f).not.toContain('uPearl');
		expect(f).toContain('vec3 gpPaint = uPaint;');
		expect(f).toContain('mix(gpPaint, sampledDiffuseColor.rgb, sampledDiffuseColor.a)');
	});

	it('solid: the paint is the albedo', () => {
		expect(paintFragment('solid')).toBe('diffuseColor.rgb = uPaint;');
	});
});

describe('applyGamePaint', () => {
	it('swaps the map step for the paint blend and binds the paint decoded from sRGB', () => {
		const mat = new THREE.MeshStandardMaterial({ color: 0x123456 });
		applyGamePaint(mat, 'pearl', { r: 1, g: 0.5, b: 0, pearl: { r: 0.2, g: 0.2, b: 0.2 } });
		const shader = compile(mat);
		expect(shader.fragmentShader).not.toContain('#include <map_fragment>');
		expect(shader.fragmentShader).toContain('uniform vec3 uPaint;');
		expect(shader.fragmentShader.indexOf('gpPaint')).toBeLessThan(shader.fragmentShader.indexOf('#include <color_fragment>'));
		const paint = shader.uniforms.uPaint.value as THREE.Color;
		expect(paint.r).toBeCloseTo(1);
		expect(paint.g).toBeCloseTo(0.2140, 3);
		expect((shader.uniforms.uPearl.value as THREE.Color).r).toBeCloseTo(0.0331, 3);
		expect(mat.color.getHex()).toBe(0xffffff);
		expect(mat.customProgramCacheKey()).toContain('paint-pearl');
	});

	it('without a pearl the pearl uniform is the paint', () => {
		const mat = new THREE.MeshStandardMaterial();
		applyGamePaint(mat, 'masked', { r: 0.5, g: 0.5, b: 0.5 });
		const shader = compile(mat);
		expect((shader.uniforms.uPearl.value as THREE.Color).equals(shader.uniforms.uPaint.value as THREE.Color)).toBe(true);
	});
});

describe('carryGamePaint', () => {
	it('repaints a clone after its own patch (the crash test copies), keeping both', () => {
		const mat = new THREE.MeshStandardMaterial();
		applyGamePaint(mat, 'solid', { r: 1, g: 0, b: 0 });
		const copy = mat.clone();
		copy.onBeforeCompile = (shader) => { shader.uniforms.uRows = { value: 1 }; };
		copy.customProgramCacheKey = () => 'brn-deform';
		carryGamePaint(mat, copy);
		const shader = compile(copy);
		expect(shader.uniforms.uRows).toBeDefined();
		expect(shader.fragmentShader).toContain('diffuseColor.rgb = uPaint;');
		expect(copy.customProgramCacheKey()).toBe('brn-deform|paint-solid');
	});

	it('leaves an unpainted material alone', () => {
		const copy = new THREE.MeshStandardMaterial();
		carryGamePaint(new THREE.MeshStandardMaterial(), copy);
		expect(compile(copy).fragmentShader).toContain('#include <map_fragment>');
	});
});
