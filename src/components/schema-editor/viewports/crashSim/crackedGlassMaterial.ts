// Materials for a cracked pane's shattered-glass model. Two paths, fed the
// same per-pane fracture constants every frame (see deformationSim/
// crackedGlass):
//
// - Translated game shaders: the window shader already reads the constants
//   (g_glassFractureStrength / UVOffsets / FresnelRanges) and samples the
//   crack texture through GlassFractureSampler; we write the three cb0 slots
//   and bind the texture.
// - Standard materials: an approximation of what that shader does. Two crack
//   lookups at uv1.xyxy * scale + offsets, maxed, remapped by
//   saturate(crack * 1/s - (1 - s)/s); past 0.05 a texel turns to the crack
//   colour (pale green-white, brighter on stronger lines), loses its mirror
//   reflection and doubles its opacity. The shader's normal wobble along the
//   cracks is left out.
//
// The crack texture is glass_fracture from the global texture dictionary
// (GLOBALTEXTUREDICTIONARY.BIN) when it is loaded in the workspace, else a
// generated star of cracks so a cracked pane still reads as cracked.

import * as THREE from 'three';
import type { FractureConstants } from '@/lib/core/deformationSim';
import type { EditableBundle } from '@/context/WorkspaceContext.types';
import { findEffectTexture } from './particleTextures';

type FractureUniforms = {
	uFractureStrength: { value: THREE.Vector4 };
	uFractureUvOffsets: { value: THREE.Vector4 };
	uFractureUvScale: { value: THREE.Vector4 };
	uFractureMap: { value: THREE.Texture };
};

const FRACTURE_VERTEX = (declareUv1: boolean) => [
	declareUv1 ? '#ifndef USE_UV1\nattribute vec2 uv1;\n#endif' : '',
	'uniform vec4 uFractureUvOffsets;',
	'uniform vec4 uFractureUvScale;',
	'varying vec4 vCrackUv;',
].join('\n');

const FRACTURE_FRAGMENT = [
	'vec2 crack = max(texture2D(uFractureMap, vCrackUv.xy).rg, texture2D(uFractureMap, vCrackUv.zw).rg);',
	'crack = clamp(crack * uFractureStrength.y - uFractureStrength.x, 0.0, 1.0);',
	'float brnCrack = step(0.05, crack.x);',
	'diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.2, 0.3, 0.3) + crack.x * vec3(0.33, 0.65, 0.63), brnCrack);',
	'diffuseColor.a = min(diffuseColor.a * (1.0 + brnCrack), 1.0);',
].join('\n');

// Adds the fracture lookups to a standard material that may already carry an
// onBeforeCompile patch (the crash views' deforming copies).
export function crackedGlassCopy(base: THREE.MeshStandardMaterial, fractureMap: THREE.Texture): THREE.MeshStandardMaterial {
	const mat = base.clone();
	const uniforms: FractureUniforms = {
		uFractureStrength: { value: new THREE.Vector4() },
		uFractureUvOffsets: { value: new THREE.Vector4() },
		uFractureUvScale: { value: new THREE.Vector4() },
		uFractureMap: { value: fractureMap },
	};
	mat.userData.fracture = uniforms;
	mat.transparent = true;
	mat.depthWrite = false;
	const inner = base.onBeforeCompile;
	mat.onBeforeCompile = (shader, renderer) => {
		inner.call(base, shader, renderer);
		Object.assign(shader.uniforms, uniforms);
		const declareUv1 = !/attribute vec2 uv1;/.test(shader.vertexShader);
		shader.vertexShader = shader.vertexShader
			.replace('#include <common>', `#include <common>\n${FRACTURE_VERTEX(declareUv1)}`)
			.replace('#include <begin_vertex>', '#include <begin_vertex>\nvCrackUv = uv1.xyxy * uFractureUvScale + uFractureUvOffsets;');
		shader.fragmentShader = shader.fragmentShader
			.replace('#include <common>', '#include <common>\nuniform vec4 uFractureStrength;\nuniform sampler2D uFractureMap;\nvarying vec4 vCrackUv;')
			.replace('#include <color_fragment>', `#include <color_fragment>\n${FRACTURE_FRAGMENT}`)
			.replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor *= 1.0 - brnCrack;')
			.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.7, brnCrack);');
	};
	const innerKey = base.customProgramCacheKey.call(base);
	mat.customProgramCacheKey = () => `${innerKey}|brn-cracked-glass`;
	return mat;
}

// The translated window shader's fracture constants by cb0 slot.
const TRANSLATED_SLOTS = {
	strength: 'g_glassFractureStrength',
	uvOffsets: 'g_glassFractureUVOffsets',
	uvScale: 'g_glassFractureFresnelRanges',
} as const;
const TRANSLATED_SAMPLER = 'GlassFractureSamplerTexture';

export const isTranslatedGlass = (m: THREE.Material): m is THREE.ShaderMaterial =>
	m instanceof THREE.ShaderMaterial && !!m.uniforms[TRANSLATED_SAMPLER];

export function bindTranslatedFracture(m: THREE.ShaderMaterial, fractureMap: THREE.Texture): void {
	m.uniforms[TRANSLATED_SAMPLER].value = fractureMap;
}

// Writes one pane's constants into whichever kind of material draws its
// shattered model. Anything else is left alone.
export function applyFracture(material: THREE.Material | THREE.Material[] | undefined, c: FractureConstants): void {
	if (!material || Array.isArray(material)) return;
	const u = material.userData.fracture as FractureUniforms | undefined;
	if (u) {
		u.uFractureStrength.value.fromArray(c.strength);
		u.uFractureUvOffsets.value.fromArray(c.uvOffsets);
		u.uFractureUvScale.value.fromArray(c.uvScale);
		return;
	}
	// TODO(types): cbSlots is set by buildTranslatedShaderMaterial on userData (any)
	const slots = material.userData.cbSlots as Map<string, number> | undefined;
	const cb0 = (material as THREE.ShaderMaterial).uniforms?.cb0?.value as THREE.Vector4[] | undefined;
	if (!slots || !cb0) return;
	for (const [k, name] of Object.entries(TRANSLATED_SLOTS) as [keyof FractureConstants, string][]) {
		const slot = slots.get(name);
		if (slot !== undefined && cb0[slot]) cb0[slot].fromArray(c[k]);
	}
}

export function fractureTexture(bundles: readonly EditableBundle[]): THREE.Texture {
	const tex = findEffectTexture(bundles, 'glass_fracture');
	if (!tex) return generatedFractureTexture();
	tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
	tex.minFilter = THREE.LinearMipmapLinearFilter;
	tex.generateMipmaps = true;
	tex.needsUpdate = true;
	return tex;
}

// A stand-in crack texture: rays from the centre with a few broken rings,
// brightest at the centre so a light crack shows only the middle lines (the
// remap keeps the texels above 1 - strength).
let generated: THREE.DataTexture | null = null;
export function generatedFractureTexture(): THREE.DataTexture {
	if (generated) return generated;
	const N = 256;
	const px = new Uint8Array(N * N * 4);
	let seed = 0x2f6b1d;
	const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
	const plot = (x: number, y: number, v: number) => {
		const i = ((Math.round(y) & (N - 1)) * N + (Math.round(x) & (N - 1))) * 4;
		px[i] = px[i + 1] = Math.max(px[i], v);
		px[i + 3] = 255;
	};
	const c = N / 2;
	for (let r = 0; r < 26; r++) {
		let a = (r / 26) * Math.PI * 2 + rnd() * 0.2;
		let x = c, y = c;
		for (let s = 0; s < N * 0.7; s++) {
			a += (rnd() - 0.5) * 0.08;
			x += Math.cos(a); y += Math.sin(a);
			plot(x, y, 255 * (1 - (s / (N * 0.7)) * 0.85));
		}
	}
	for (const radius of [18, 40, 70, 105]) {
		for (let t = 0; t < Math.PI * 2; t += 0.5 / radius) {
			if (Math.sin(t * 7 + radius) > 0.3) plot(c + Math.cos(t) * radius, c + Math.sin(t) * radius, 255 * (1 - radius / 130));
		}
	}
	generated = new THREE.DataTexture(px, N, N, THREE.RGBAFormat);
	generated.userData.generated = true;   // shared: never disposed
	generated.wrapS = generated.wrapT = THREE.RepeatWrapping;
	generated.magFilter = THREE.LinearFilter;
	generated.minFilter = THREE.LinearFilter;
	generated.needsUpdate = true;
	return generated;
}
