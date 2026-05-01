// Memoize a THREE.BufferGeometry built from an iterable of line-segment
// edges, disposing the previous geometry on rebuild / unmount.
//
// Companion to `buildLineSegmentsGeometry` (in
// src/components/common/three/SelectionOutline.tsx) — that pure function
// is what you want in tests / non-React code; this hook is the React
// integration that owns the geometry's lifecycle in a viewport.

import { useEffect, useMemo, type DependencyList } from 'react';
import * as THREE from 'three';
import {
	buildLineSegmentsGeometry,
	type Edge,
} from '@/components/common/three/SelectionOutline';

export function useLineSegmentsGeometry(
	buildEdges: () => Iterable<Edge>,
	deps: DependencyList,
): THREE.BufferGeometry {
	// eslint-disable-next-line react-hooks/exhaustive-deps
	const geometry = useMemo(() => buildLineSegmentsGeometry(buildEdges()), deps);
	useEffect(() => {
		const g = geometry;
		return () => { g.dispose(); };
	}, [geometry]);
	return geometry;
}
