// The game's paint blend on the Renderable view's standard materials (see
// vehiclePaint for what each vehicle shader does with the paint).
//
// The diffuse map stays as it is and the paint replaces the material colour:
// albedo = mix(paint', diffuse.rgb, diffuse.a), paint' the view-dependent
// pearl / paint mix on PaintGloss bodies. The palette values are the raw
// numbers the game mixes with raw texels; three decodes the sRGB diffuse map
// to linear, so the paint is decoded the same way to keep the pair in step
// (and the car reads as its swatch).
//
// The blend runs where the map is sampled, so the crash test's scratches
// (patched in at the colour step) land on top of the paint as in the game.

import * as THREE from 'three';
import { pearlOf, type CarPaint, type PaintShading } from '@/lib/core/vehiclePaint';

type PaintPatch = { shading: PaintShading; paint: THREE.Color; pearl: THREE.Color };

// Kept beside the material: clones (the crash test's deforming copies) drop
// onBeforeCompile and must be repainted with carryGamePaint.
const patches = new WeakMap<THREE.Material, PaintPatch>();

const srgb = (c: { r: number; g: number; b: number }) => new THREE.Color().setRGB(c.r, c.g, c.b, THREE.SRGBColorSpace);

const PAINT_PARS = 'uniform vec3 uPaint;\nuniform vec3 uPearl;';

// |N - V|^2 with V the unit vector to the eye: 0 face-on, >= 1 from 60 degrees.
const PEARL_MIX = [
	'vec3 gpV = normalize(vViewPosition);',
	'#ifdef FLAT_SHADED',
	'vec3 gpN = normalize(cross(dFdx(vViewPosition), dFdy(vViewPosition)));',
	'#else',
	'vec3 gpN = normalize(vNormal);',
	'#ifdef DOUBLE_SIDED',
	'gpN *= gl_FrontFacing ? 1.0 : -1.0;',
	'#endif',
	'#endif',
	'vec3 gpPaint = mix(uPearl, uPaint, min(dot(gpN - gpV, gpN - gpV), 1.0));',
].join('\n');

const MASK_BY_MAP = [
	'#ifdef USE_MAP',
	'vec4 sampledDiffuseColor = texture2D(map, vMapUv);',
	'diffuseColor.rgb = mix(gpPaint, sampledDiffuseColor.rgb, sampledDiffuseColor.a);',
	'#else',
	'diffuseColor.rgb = gpPaint;',
	'#endif',
].join('\n');

export function paintFragment(shading: PaintShading): string {
	if (shading === 'solid') return 'diffuseColor.rgb = uPaint;';
	return [shading === 'pearl' ? PEARL_MIX : 'vec3 gpPaint = uPaint;', MASK_BY_MAP].join('\n');
}

function patch(mat: THREE.MeshStandardMaterial, p: PaintPatch): void {
	patches.set(mat, p);
	const before = mat.onBeforeCompile;
	const beforeKey = mat.customProgramCacheKey;
	mat.onBeforeCompile = (shader, renderer) => {
		before.call(mat, shader, renderer);
		shader.uniforms.uPaint = { value: p.paint };
		shader.uniforms.uPearl = { value: p.pearl };
		shader.fragmentShader = shader.fragmentShader
			.replace('#include <common>', `#include <common>\n${PAINT_PARS}`)
			.replace('#include <map_fragment>', paintFragment(p.shading));
	};
	mat.customProgramCacheKey = () => `${beforeKey.call(mat)}|paint-${p.shading}`;
}

/** Paint a vehicle material the way its shader does. */
export function applyGamePaint(mat: THREE.MeshStandardMaterial, shading: PaintShading, paint: CarPaint): void {
	mat.color.setRGB(1, 1, 1);
	patch(mat, { shading, paint: srgb(paint), pearl: srgb(pearlOf(paint)) });
}

/** Give a copy of a painted material the same paint; returns the copy. */
export function carryGamePaint<M extends THREE.MeshStandardMaterial>(from: THREE.Material, to: M): M {
	const p = patches.get(from);
	if (p) patch(to, p);
	return to;
}
