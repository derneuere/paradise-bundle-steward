// The Renderable view's cracked panes: tells the shattered-glass models apart
// from the car's own renderables and hands each one the material it draws
// with. A translated window shader is used as is (one instance per model
// already) with the crack texture bound; a standard material gets a per-pane
// cracked copy, cached by the material it was made from.

import { useMemo } from 'react';
import * as THREE from 'three';
import type { EditableBundle } from '@/context/WorkspaceContext.types';
import type { DecodedRenderable } from '@/lib/core/renderableDecode';
import type { ShatteredGlassRenderable } from '@/lib/core/shatteredGlassDecode';
import { useDisposeOnDepsChange } from '@/hooks/useDisposeOnDepsChange';
import type { CrackedGlassRef } from './crashStepper';
import { bindTranslatedFracture, crackedGlassCopy, fractureTexture, isTranslatedGlass } from './crackedGlassMaterial';

export type CrackedGlass = {
	// The pane a drawn renderable is the shattered-glass model of, if it is one.
	of: (r: DecodedRenderable) => CrackedGlassRef | undefined;
	// The material a renderable's mesh draws with, given the one the view
	// picked for it: unchanged unless it is a shattered-glass model.
	material: (r: DecodedRenderable, picked: THREE.Material) => THREE.Material;
};

type Cache = Map<THREE.Material, Map<number, THREE.MeshStandardMaterial>>;

const shatteredOf = (r: DecodedRenderable) => ('glass' in r ? (r as ShatteredGlassRenderable).glass : undefined);

export function crackedGlassFor(fracture: THREE.Texture, cache: Cache): CrackedGlass {
	return {
		of: shatteredOf,
		material: (r, picked) => {
			const glass = shatteredOf(r);
			if (!glass) return picked;
			if (isTranslatedGlass(picked)) {
				bindTranslatedFracture(picked, fracture);
				return picked;
			}
			if (!(picked instanceof THREE.MeshStandardMaterial)) return picked;
			let perPane = cache.get(picked);
			if (!perPane) cache.set(picked, (perPane = new Map()));
			let mat = perPane.get(glass.glassIndex);
			if (!mat) perPane.set(glass.glassIndex, (mat = crackedGlassCopy(picked, fracture)));
			return mat;
		},
	};
}

export function useCrackedGlass(bundles: readonly EditableBundle[]): CrackedGlass {
	const fracture = useMemo(() => fractureTexture(bundles), [bundles]);
	// A fresh cache (copies bound to the old texture are disposed) per texture.
	// eslint-disable-next-line react-hooks/exhaustive-deps
	const cache = useMemo<Cache>(() => new Map(), [fracture]);
	useDisposeOnDepsChange(() => {
		for (const perPane of cache.values()) for (const m of perPane.values()) m.dispose();
		if (!fracture.userData.generated) fracture.dispose();
	}, [cache, fracture]);
	return useMemo(() => crackedGlassFor(fracture, cache), [fracture, cache]);
}
