// The Renderable view's PBR stand-ins for the game's materials: one
// MeshStandardMaterial per Material resource, textured from its resolved
// diffuse / specular / emissive / AO maps, with shader-name heuristics
// (Window, Chrome, PaintGloss, ...) for the look the engine's shaders would
// give and the chosen car paint on body materials.

import * as THREE from 'three';
import type { DecodedTexture } from '@/lib/core/texture';
import { D3DTextureAddress } from '@/lib/core/textureState';
import type { DecodedRenderable } from '@/lib/core/renderableDecode';

export type PaintColor = { r: number; g: number; b: number; pearl?: { r: number; g: number; b: number } };

// The vehicle scratch map of a built material, for the crash test's scratch
// shading. Kept beside the material, not in userData, which clones deep-copy.
const scratchMaps = new WeakMap<THREE.Material, THREE.DataTexture>();
export const scratchMapOf = (mat: THREE.Material) => scratchMaps.get(mat) ?? null;

function makeDataTexture(
	decoded: DecodedTexture,
	sampler: { addressU: number; addressV: number } | null,
	srgb = true,
): THREE.DataTexture {
	const tex = new THREE.DataTexture(
		decoded.pixels,
		decoded.header.width,
		decoded.header.height,
		THREE.RGBAFormat,
	);
	tex.flipY = false;
	tex.magFilter = THREE.LinearFilter;
	tex.minFilter = THREE.LinearMipmapLinearFilter;
	tex.generateMipmaps = true;
	if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
	applyWrapping(tex, sampler);
	tex.needsUpdate = true;
	return tex;
}

function applyWrapping(
	tex: THREE.DataTexture,
	sampler: { addressU: number; addressV: number } | null,
) {
	const map: Record<number, THREE.Wrapping> = {
		[D3DTextureAddress.WRAP]: THREE.RepeatWrapping,
		[D3DTextureAddress.MIRROR]: THREE.MirroredRepeatWrapping,
		[D3DTextureAddress.CLAMP]: THREE.ClampToEdgeWrapping,
		[D3DTextureAddress.BORDER]: THREE.ClampToEdgeWrapping,
		[D3DTextureAddress.MIRRORONCE]: THREE.MirroredRepeatWrapping,
	};
	tex.wrapS = map[sampler?.addressU ?? D3DTextureAddress.WRAP] ?? THREE.RepeatWrapping;
	tex.wrapT = map[sampler?.addressV ?? D3DTextureAddress.WRAP] ?? THREE.RepeatWrapping;
}

// Keyed by Material resource id (hex).
export function buildTexturedMaterials(
	renderables: readonly DecodedRenderable[],
	wireframe: boolean,
	paintColor: PaintColor | null,
): Map<string, THREE.MeshStandardMaterial> {
	const map = new Map<string, THREE.MeshStandardMaterial>();
	for (const r of renderables) {
		for (const m of r.meshes) {
			if (!m.resolvedMaterial || !m.materialAssemblyId) continue;
			const key = m.materialAssemblyId.toString(16);
			if (map.has(key)) continue;

			const rm = m.resolvedMaterial;
			const props = rm.properties;
			let side: THREE.Side = THREE.DoubleSide;
			if (props) {
				if (props.cullMode === 2) side = THREE.FrontSide;
				else if (props.cullMode === 3) side = THREE.BackSide;
			}

			const mat = new THREE.MeshStandardMaterial({
				side,
				metalness: 0.15,
				roughness: 0.7,
				transparent: props?.alphaBlendEnable ?? false,
				alphaTest: props?.alphaTestEnable ? (props.alphaRef / 255) : 0,
				depthWrite: !(props?.alphaBlendEnable),
				wireframe,
			});

			if (rm.diffuse) {
				const tex = makeDataTexture(rm.diffuse, rm.samplerState);
				mat.map = tex;
			}

			const sn = rm.shaderName ?? '';

			if (sn.includes('Window')) {
				mat.transparent = true;
				mat.opacity = rm.diffuse ? 0.35 : 0.25;
				mat.color.setRGB(0.08, 0.1, 0.14);
				mat.metalness = 0.95;
				mat.roughness = 0.02;
				mat.envMapIntensity = 2.5;
				mat.depthWrite = false;
			} else if (sn.includes('Chrome')) {
				mat.color.setRGB(0.35, 0.35, 0.38);
				mat.metalness = 1.0;
				mat.roughness = 0.08;
				mat.envMapIntensity = 2.5;
			} else if (sn.includes('PaintGloss')) {
				if (paintColor) {
					mat.color.setRGB(paintColor.r, paintColor.g, paintColor.b);
					const pearl = paintColor.pearl;
					if (pearl) {
						mat.emissive.setRGB(pearl.r * 0.25, pearl.g * 0.25, pearl.b * 0.25);
					} else {
						mat.emissive.setRGB(paintColor.r * 0.3, paintColor.g * 0.3, paintColor.b * 0.3);
					}
					mat.emissiveIntensity = 1.0;
				} else {
					mat.color.setRGB(0.18, 0.18, 0.20);
				}
				mat.metalness = 0.6;
				mat.roughness = 0.2;
				mat.envMapIntensity = 1.5;
			} else if (sn.includes('Light') && sn.includes('EnvMapped')) {
				mat.metalness = 0.8;
				mat.roughness = 0.1;
				mat.envMapIntensity = 2.0;
			} else if (sn.includes('Metal') || sn.includes('SimpleMetal')) {
				mat.metalness = 0.7;
				mat.roughness = 0.3;
				mat.envMapIntensity = 1.2;
			} else if (sn.includes('Decal') && sn.includes('EnvMapped')) {
				mat.metalness = 0.4;
				mat.roughness = 0.3;
				mat.envMapIntensity = 1.5;
			} else if (sn.includes('Decal')) {
				mat.metalness = 0.1;
				mat.roughness = 0.6;
			} else if (sn.includes('CarGuts') || sn.includes('Livery')) {
				mat.metalness = 0.1;
				mat.roughness = 0.8;
			} else {
				const isGlassNoTex = !rm.diffuse && !rm.diffuseFromSecondary && rm.crossBundleMisses > 0;
				const isGlassSmallAlpha = rm.diffuse && rm.diffuseFromSecondary
					&& rm.diffuse.header.format === 'DXT5'
					&& rm.diffuse.header.width <= 128 && rm.diffuse.header.height <= 128;
				const isGlass = isGlassNoTex || isGlassSmallAlpha;
				if (isGlass) {
					mat.transparent = true;
					mat.opacity = 0.3;
					mat.color.setRGB(0.15, 0.18, 0.22);
					mat.metalness = 0.95;
					mat.roughness = 0.02;
					mat.envMapIntensity = 2.0;
					mat.depthWrite = false;
				}
				const isBodyMaterial = !isGlass && (rm.diffuseFromSecondary || rm.anyFromSecondary || !rm.diffuse);
				if (paintColor && isBodyMaterial) {
					mat.color.setRGB(paintColor.r, paintColor.g, paintColor.b);
					mat.metalness = 0.6;
					mat.roughness = 0.25;
					mat.envMapIntensity = 1.2;
				} else if (isBodyMaterial) {
					mat.color.setRGB(0.18, 0.18, 0.20);
					mat.metalness = 0.5;
					mat.roughness = 0.3;
					mat.envMapIntensity = 1.5;
				}
			}

			if (rm.specular) {
				const tex = makeDataTexture(rm.specular, rm.samplerState, false);
				mat.metalnessMap = tex;
			}
			if (rm.emissive) {
				const tex = makeDataTexture(rm.emissive, rm.samplerState);
				mat.emissiveMap = tex;
				mat.emissive.setRGB(1, 1, 1);
				mat.emissiveIntensity = 2.0;
			}
			if (rm.ao) {
				const tex = makeDataTexture(rm.ao, rm.samplerState, false);
				mat.aoMap = tex;
				mat.aoMapIntensity = 1.0;
			}
			if (rm.scratch) scratchMaps.set(mat, makeDataTexture(rm.scratch, null, false));

			map.set(key, mat);
		}
	}
	return map;
}
