// The game's damaged-car vertex step, on a standard three material: each
// vertex moves by its blend-weighted rows of the 128-entry deformation array
// (g_verletOffsets in the game shaders), applied to the raw position before
// the part's world transform. Normals are not deformed (the game doesn't
// either), so flat shading is what makes the dents readable.
//
// Given the material's scratch map, the rows' w lane (the scratch amount)
// scratches the paint as the damaged vehicle shaders do: a texel turns to the
// map's scratched colour (R) once its threshold (G) is within reach,
// saturate((G - (1 - scratch)) * 2.5). The shaders' sheen change (B) is not
// reproduced on the standard material.

import * as THREE from 'three';

export const DEFORM_ROWS = 128;

export type RowsUniform = { value: Float32Array };
// 1 = colour by how far each vertex has been pushed (blue 0 -> red 0.15 m ->
// white 0.3 m), 0 = plain paint.
export type HeatUniform = { value: number };

export function makeRowsUniform(): RowsUniform {
	return { value: new Float32Array(DEFORM_ROWS * 4) };
}

const SCRATCH_VERTEX = [
	'#ifndef USE_UV1',
	'attribute vec2 uv1;',
	'#endif',
	'varying float vScratch;',
	'varying vec2 vScratchUv;',
].join('\n');

const SCRATCH_FRAGMENT = [
	'vec3 sc = texture2D(uScratchMap, vScratchUv).rgb;',
	'float scratched = clamp((sc.g - (1.0 - vScratch)) * 2.5, 0.0, 1.0);',
	'diffuseColor.rgb = mix(diffuseColor.rgb, vec3(pow(sc.r, 2.2)), scratched);',
].join('\n');

// Adds the rows step (and the damage-map tint) to any MeshStandardMaterial
// without touching its maps or colours. Only meshes with skinIndex /
// skinWeight may use the result: on a geometry without them WebGL feeds the
// default attribute (0,0,0,1), which would drag the mesh by row 0.
export function patchDeformMaterial<M extends THREE.MeshStandardMaterial>(mat: M, rows: RowsUniform, heat: HeatUniform, scratchMap: THREE.Texture | null = null): M {
	mat.onBeforeCompile = (shader) => {
		shader.uniforms.uRows = rows;
		shader.uniforms.uHeat = heat;
		if (scratchMap) shader.uniforms.uScratchMap = { value: scratchMap };
		shader.vertexShader = shader.vertexShader
			.replace('#include <common>', [
				'#include <common>',
				`uniform vec4 uRows[${DEFORM_ROWS}];`,
				'attribute vec4 skinIndex;',
				'attribute vec4 skinWeight;',
				'varying float vDent;',
				scratchMap ? SCRATCH_VERTEX : '',
			].join('\n'))
			.replace('#include <begin_vertex>', [
				'#include <begin_vertex>',
				'vec4 dent = skinWeight.x * uRows[int(skinIndex.x)]',
				'          + skinWeight.y * uRows[int(skinIndex.y)]',
				'          + skinWeight.z * uRows[int(skinIndex.z)]',
				'          + skinWeight.w * uRows[int(skinIndex.w)];',
				'transformed += dent.xyz;',
				'vDent = length(dent.xyz);',
				scratchMap ? 'vScratch = dent.w;\nvScratchUv = uv1;' : '',
			].join('\n'));
		shader.fragmentShader = shader.fragmentShader
			.replace('#include <common>', [
				'#include <common>',
				'uniform float uHeat;',
				'varying float vDent;',
				scratchMap ? 'uniform sampler2D uScratchMap;\nvarying float vScratch;\nvarying vec2 vScratchUv;' : '',
			].join('\n'))
			.replace('#include <color_fragment>', [
				'#include <color_fragment>',
				scratchMap ? SCRATCH_FRAGMENT : '',
				'float h = clamp(vDent / 0.3, 0.0, 1.0);',
				'vec3 ramp = h < 0.5 ? mix(vec3(0.12, 0.25, 0.75), vec3(0.95, 0.15, 0.1), h * 2.0)',
				'                    : mix(vec3(0.95, 0.15, 0.1), vec3(1.0, 0.95, 0.85), h * 2.0 - 1.0);',
				'diffuseColor.rgb = mix(diffuseColor.rgb, ramp, uHeat);',
			].join('\n'));
	};
	mat.customProgramCacheKey = () => (scratchMap ? 'brn-deform-scratch' : 'brn-deform');
	return mat;
}

export function makeDeformMaterial(rows: RowsUniform, color: THREE.ColorRepresentation, heat: HeatUniform, flatShading = true): THREE.MeshStandardMaterial {
	return patchDeformMaterial(new THREE.MeshStandardMaterial({
		color, metalness: 0.35, roughness: 0.45, side: THREE.DoubleSide, flatShading,
	}), rows, heat);
}

// A deforming copy of a view's own material: shares its textures (dispose
// only the copy, never its maps).
export function deformingCopy(mat: THREE.MeshStandardMaterial, rows: RowsUniform, heat: HeatUniform, flatShading: boolean, scratchMap: THREE.Texture | null = null): THREE.MeshStandardMaterial {
	const copy = patchDeformMaterial(mat.clone(), rows, heat, scratchMap);
	copy.flatShading = flatShading;
	return copy;
}

export const isSkinned = (g: THREE.BufferGeometry) => !!g.getAttribute('skinIndex') && !!g.getAttribute('skinWeight');
