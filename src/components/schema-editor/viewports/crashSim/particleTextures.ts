// The game's spark and smoke textures, from PARTICLES.BUNDLE when it is
// loaded into the workspace (found by their resource names).

import * as THREE from 'three';
import type { EditableBundle } from '@/context/WorkspaceContext.types';
import { findDebugResourceById } from '@/lib/core/bundle/debugData';
import { u64ToBigInt } from '@/lib/core/u64';
import { decodeTexture, TEXTURE_TYPE_ID } from '@/lib/core/texture';
import type { ResourceEntry } from '@/lib/core/types';

export type ParticleTextures = { spark: THREE.DataTexture | null; smoke: THREE.DataTexture | null };

export function findEffectTexture(bundles: readonly EditableBundle[], name: string): THREE.DataTexture | null {
	const pattern = new RegExp(`/${name}\\.TextureConfig2d`, 'i');
	for (const b of bundles) {
		if (!b.debugResources.some((d) => pattern.test(d.name))) continue;
		const res = b.parsed.resources.find((r) => r.resourceTypeId === TEXTURE_TYPE_ID
			&& pattern.test(findDebugResourceById(b.debugResources, u64ToBigInt(r.resourceId).toString(16))?.name ?? ''));
		if (!res) continue;
		try {
			const dt = decodeTexture(b.originalArrayBuffer, b.parsed, res as ResourceEntry);
			const tex = new THREE.DataTexture(dt.pixels, dt.header.width, dt.header.height, THREE.RGBAFormat);
			tex.minFilter = THREE.LinearFilter;
			tex.magFilter = THREE.LinearFilter;
			tex.needsUpdate = true;
			return tex;
		} catch {
			return null;
		}
	}
	return null;
}

export function particleTextures(bundles: readonly EditableBundle[]): ParticleTextures {
	return { spark: findEffectTexture(bundles, 'fxspark'), smoke: findEffectTexture(bundles, 'fxsmoke') };
}
