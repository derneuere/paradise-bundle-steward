// The game's damaged-car vertex step, on a standard three material: each
// vertex moves by its blend-weighted rows of the 128-entry deformation array
// (g_verletOffsets in the game shaders), applied to the raw position before
// the part's world transform. Normals are not deformed (the game doesn't
// either), so flat shading is what makes the dents readable.

import * as THREE from 'three';

export const DEFORM_ROWS = 128;

export type RowsUniform = { value: Float32Array };
// 1 = colour by how far each vertex has been pushed (blue 0 -> red 0.15 m ->
// white 0.3 m), 0 = plain paint.
export type HeatUniform = { value: number };

export function makeRowsUniform(): RowsUniform {
	return { value: new Float32Array(DEFORM_ROWS * 4) };
}

// Adds the rows step (and the damage-map tint) to any MeshStandardMaterial
// without touching its maps or colours. Only meshes with skinIndex /
// skinWeight may use the result: on a geometry without them WebGL feeds the
// default attribute (0,0,0,1), which would drag the mesh by row 0.
export function patchDeformMaterial<M extends THREE.MeshStandardMaterial>(mat: M, rows: RowsUniform, heat: HeatUniform): M {
	mat.onBeforeCompile = (shader) => {
		shader.uniforms.uRows = rows;
		shader.uniforms.uHeat = heat;
		shader.vertexShader = shader.vertexShader
			.replace('#include <common>', [
				'#include <common>',
				`uniform vec4 uRows[${DEFORM_ROWS}];`,
				'attribute vec4 skinIndex;',
				'attribute vec4 skinWeight;',
				'varying float vDent;',
			].join('\n'))
			.replace('#include <begin_vertex>', [
				'#include <begin_vertex>',
				'vec3 dent = skinWeight.x * uRows[int(skinIndex.x)].xyz',
				'          + skinWeight.y * uRows[int(skinIndex.y)].xyz',
				'          + skinWeight.z * uRows[int(skinIndex.z)].xyz',
				'          + skinWeight.w * uRows[int(skinIndex.w)].xyz;',
				'transformed += dent;',
				'vDent = length(dent);',
			].join('\n'));
		shader.fragmentShader = shader.fragmentShader
			.replace('#include <common>', '#include <common>\nuniform float uHeat;\nvarying float vDent;')
			.replace('#include <color_fragment>', [
				'#include <color_fragment>',
				'float h = clamp(vDent / 0.3, 0.0, 1.0);',
				'vec3 ramp = h < 0.5 ? mix(vec3(0.12, 0.25, 0.75), vec3(0.95, 0.15, 0.1), h * 2.0)',
				'                    : mix(vec3(0.95, 0.15, 0.1), vec3(1.0, 0.95, 0.85), h * 2.0 - 1.0);',
				'diffuseColor.rgb = mix(diffuseColor.rgb, ramp, uHeat);',
			].join('\n'));
	};
	mat.customProgramCacheKey = () => 'brn-deform';
	return mat;
}

export function makeDeformMaterial(rows: RowsUniform, color: THREE.ColorRepresentation, heat: HeatUniform, flatShading = true): THREE.MeshStandardMaterial {
	return patchDeformMaterial(new THREE.MeshStandardMaterial({
		color, metalness: 0.35, roughness: 0.45, side: THREE.DoubleSide, flatShading,
	}), rows, heat);
}

// A deforming copy of a view's own material: shares its textures (dispose
// only the copy, never its maps).
export function deformingCopy(mat: THREE.MeshStandardMaterial, rows: RowsUniform, heat: HeatUniform, flatShading: boolean): THREE.MeshStandardMaterial {
	const copy = patchDeformMaterial(mat.clone(), rows, heat);
	copy.flatShading = flatShading;
	return copy;
}

export const isSkinned = (g: THREE.BufferGeometry) => !!g.getAttribute('skinIndex') && !!g.getAttribute('skinWeight');
