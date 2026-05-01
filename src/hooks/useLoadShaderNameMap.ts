// Auto-load SHADERS.BNDL from the example directory at mount and feed
// the parsed shader name map into a caller-owned setter.
//
// Same side-effect the old RenderablePage ran at mount; lifted up to
// `RenderableDecodedProvider` so every consumer (viewport, hierarchy
// tree, materials extension) sees the same map. Failures are silent —
// SHADERS.BNDL is optional, and consumers handle a null map gracefully
// (shader names display as raw IDs).

import { useEffect } from 'react';
import {
	parseShaderNameMap,
	type ShaderNameMap,
} from '@/lib/core/materialChain';

export function useLoadShaderNameMap(
	setShaderNameMap: React.Dispatch<React.SetStateAction<ShaderNameMap | null>>,
): void {
	useEffect(() => {
		fetch('/example/SHADERS.BNDL')
			.then((r) => {
				if (!r.ok) throw new Error('not found');
				return r.arrayBuffer();
			})
			.then((ab) => {
				const map = parseShaderNameMap(ab);
				setShaderNameMap(map);
			})
			.catch(() => {
				/* SHADERS.BNDL not available, shader names will be null */
			});
	}, [setShaderNameMap]);
}
