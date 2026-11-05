// The game's debris meshes (PARTICLES.BUNDLE's mesh collections) and how
// each debris kind is shaded, for CrashDebris.
//
// The game lights debris with its own small program: the mesh texture times
// the piece's colour, a diffuse + ambient term and a Phong highlight whose
// power / strength come from the kind's preset (matte dark chips, glass with
// a blinding glint). A MeshPhongMaterial with the same power stands in.
// Pieces write depth like solid geometry; their
// alpha (texture alpha x fade-out) blends them over what is behind, and
// anything at alpha 0 is dropped, as the game's alpha test does.

import * as THREE from 'three';
import type { EditableBundle } from '@/context/WorkspaceContext.types';
import { findDebugResourceById } from '@/lib/core/bundle/debugData';
import { getResourceBlocks } from '@/lib/core/resourceManager';
import type { ResourceEntry } from '@/lib/core/types';
import { u64ToBigInt } from '@/lib/core/u64';
import { parseVFXMeshCollection, VFX_MESH_COLLECTION_TYPE_ID } from '@/lib/core/vfxMeshCollection';
import { decodeVFXMeshes, type VFXMesh, type VFXMeshSet } from '@/lib/core/vfxMeshCollectionMeshes';
import { DebrisKind } from '@/lib/core/crashEffects';

export type DebrisLook = { set: VFXMeshSet; texture: THREE.DataTexture | null };
/** By mesh collection name, e.g. 'lowres_debris.rf3'. */
export type DebrisLooks = Map<string, DebrisLook>;

export function findDebrisLooks(
	bundles: readonly EditableBundle[], findTexture: (name: string) => THREE.DataTexture | null,
): DebrisLooks {
	const looks: DebrisLooks = new Map();
	for (const b of bundles) {
		for (const r of b.parsed.resources) {
			if (r.resourceTypeId !== VFX_MESH_COLLECTION_TYPE_ID) continue;
			const name = findDebugResourceById(b.debugResources, u64ToBigInt(r.resourceId).toString(16))?.name;
			if (!name || looks.has(name)) continue;
			try {
				const [header, body] = getResourceBlocks(b.originalArrayBuffer, b.parsed, r as ResourceEntry);
				if (!header || !body) continue;
				const model = parseVFXMeshCollection(header);
				const texture = findTexture(model.textureName);
				if (texture) texture.colorSpace = THREE.SRGBColorSpace;
				looks.set(name, { set: decodeVFXMeshes(model, body), texture });
			} catch {
				// A collection that doesn't decode falls back to the stand-in chips.
			}
		}
	}
	return looks;
}

export function vfxMeshGeometry(mesh: VFXMesh): THREE.BufferGeometry {
	const g = new THREE.BufferGeometry();
	g.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
	g.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3));
	g.setAttribute('uv', new THREE.BufferAttribute(mesh.uvs, 2));
	g.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
	g.computeBoundingSphere();
	return g;
}

// The presets' specular power and strength.
const SPECULAR: Record<DebrisKind, [number, number]> = {
	[DebrisKind.Coloured]: [10, 0.2],
	[DebrisKind.Shiny]: [10, 0.2],
	[DebrisKind.Dark]: [1, 0.01],
	[DebrisKind.HighDetail]: [10, 0.2],
	[DebrisKind.Glass]: [50, 50],
};

// three's Blinn-Phong peaks at (power / 2 + 1) / 4pi x the specular colour;
// the game's unnormalised highlight peaks at its strength.
function shading(kind: DebrisKind): THREE.MeshPhongMaterialParameters {
	const [power, strength] = SPECULAR[kind];
	const k = (strength * 4 * Math.PI) / (power / 2 + 1);
	return { shininess: power, specular: new THREE.Color(k, k, k) };
}

// Per-instance alpha rides an `instanceAlpha` attribute on the geometry.
function withInstanceAlpha(material: THREE.MeshPhongMaterial): THREE.MeshPhongMaterial {
	material.onBeforeCompile = (shader) => {
		shader.vertexShader = 'attribute float instanceAlpha;\nvarying float vInstanceAlpha;\n'
			+ shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvInstanceAlpha = instanceAlpha;');
		shader.fragmentShader = 'varying float vInstanceAlpha;\n'
			+ shader.fragmentShader.replace('#include <alphatest_fragment>', '\tdiffuseColor.a *= vInstanceAlpha;\n#include <alphatest_fragment>');
	};
	return material;
}

export function debrisMaterial(kind: DebrisKind, look: DebrisLook | undefined): THREE.MeshPhongMaterial {
	const standIn = kind === DebrisKind.Glass && !look?.texture ? { color: '#dfeef5', opacity: 0.75 } : {};
	return withInstanceAlpha(new THREE.MeshPhongMaterial({
		...shading(kind), ...standIn, map: look?.texture ?? null, transparent: true, alphaTest: 1 / 255,
	}));
}
