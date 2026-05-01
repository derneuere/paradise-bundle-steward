// Capture a snapshot of a BufferGeometry's `color` attribute into a
// caller-owned ref whenever the geometry identity changes.
//
// Use case: a viewport bakes per-vertex base colors at geometry build
// time, then mutates `geometry.attributes.color` in place to overlay
// selection highlights. The mutation needs the original colors to
// restore non-selected vertices on each pass — `useCachedColorAttribute`
// is the "stash the originals" half of that pattern.
//
// `ref.current` is `null` until the geometry's first commit; the
// applyHighlight pass should guard for null before reading.

import { useEffect } from 'react';
import * as THREE from 'three';

export function useCachedColorAttribute(
	geometry: THREE.BufferGeometry,
	ref: React.MutableRefObject<Float32Array | null>,
): void {
	useEffect(() => {
		const attr = geometry.getAttribute('color') as THREE.BufferAttribute | undefined;
		if (!attr) return;
		ref.current = (attr.array as Float32Array).slice();
	}, [geometry, ref]);
}
