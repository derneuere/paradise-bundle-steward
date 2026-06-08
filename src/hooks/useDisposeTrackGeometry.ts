// Tie the GPU lifetime of a decoded track's geometries + shared material to
// the React lifetime of <TrackGeometry>.
//
// react-three-fiber only auto-disposes objects it constructs declaratively
// from JSX args; the track hands pre-built BufferGeometry and a shared material
// in via the `geometry`/`material` props, so neither is auto-freed. Without
// this, every bundle load → close cycle (or any re-decode) leaks its buffers on
// the GPU — a large track is ~440k verts (TRK9) — until enough accumulates to
// trigger a real THREE.WebGLRenderer: Context Lost.
//
// The two resources have different lifetimes:
//   - geometries belong to the current decode → free them when a new bundle
//     re-decodes (the `meshes` identity changes) or on unmount.
//   - the material is shared for the component's whole lifetime (memoized on
//     []), so it only frees on unmount.

import type * as THREE from 'three';
import {
	disposeTrackGeometries,
	type PlacedTrackMesh,
} from '@/components/schema-editor/viewports/trackGeometryDecode';
import { useDisposeOnDepsChange } from './useDisposeOnDepsChange';
import { useDisposeOnUnmount } from './useDisposeOnUnmount';

export function useDisposeTrackGeometry(
	meshes: PlacedTrackMesh[],
	material: THREE.Material,
): void {
	useDisposeOnDepsChange(() => disposeTrackGeometries(meshes), [meshes]);
	useDisposeOnUnmount(material);
}
