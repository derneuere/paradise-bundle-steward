// TrackGeometry — renders a track-unit bundle's InstanceList geometry as grey,
// untextured meshes in the shared WorldViewport, so props sit on the visible
// track.
//
// This is NOT a pure overlay (ADR-0002): overlays receive only parsed models
// via props, but decoding the track needs the bundle's raw ArrayBuffer + the
// import table (Model and Renderable references live in the BND2 import
// section, not in the parsed InstanceList). So the composition mounts this
// per-loaded-bundle component, handing it the EditableBundle's parsed bundle +
// originalArrayBuffer; the heavy decode is memoized on the bundle identity (it
// walks every Model → Renderable → vertex buffer once, ~440k verts for TRK9).
//
// Read-only by design: the track is spatial backdrop, not an editable
// resource — no picking, no selection, no onChange. Rendered with a low
// renderOrder so editable prop overlays draw on top.

import { useMemo } from 'react';
import * as THREE from 'three';
import type { ParsedBundle } from '@/lib/core/types';
import { decodeTrackGeometry, TRACK_MATERIAL_COLOR } from './trackGeometryDecode';

// Behind the editable overlays. The track is map-scale backdrop; props and
// the other world-family overlays (default renderOrder 0) draw on top.
const TRACK_RENDER_ORDER = -1;

export function TrackGeometry({
	bundle,
	buffer,
}: {
	bundle: ParsedBundle;
	buffer: ArrayBuffer;
}) {
	// Decode is expensive (every Model's renderables → vertex buffers). Memoize
	// on the bundle/buffer identity so it only re-runs when a different bundle
	// loads, not on unrelated workspace re-renders.
	const { meshes } = useMemo(() => decodeTrackGeometry(bundle, buffer), [bundle, buffer]);

	// One shared grey material for the whole track — MeshStandardMaterial so it
	// catches the WorldViewport's lighting; DoubleSide because track geometry
	// is not reliably wound for back-face culling.
	const material = useMemo(
		() =>
			new THREE.MeshStandardMaterial({
				color: TRACK_MATERIAL_COLOR,
				side: THREE.DoubleSide,
				roughness: 0.95,
				metalness: 0.0,
			}),
		[],
	);

	if (meshes.length === 0) return null;

	return (
		<group renderOrder={TRACK_RENDER_ORDER}>
			{meshes.map((m, i) => (
				<mesh
					key={i}
					geometry={m.geometry}
					material={material}
					matrixAutoUpdate={false}
					onUpdate={(self) => {
						// The instance transform is a world matrix; bypass R3F's
						// position/rotation/scale props and set it directly.
						self.matrix.copy(m.matrix);
						self.matrixWorldNeedsUpdate = true;
					}}
					renderOrder={TRACK_RENDER_ORDER}
				/>
			))}
		</group>
	);
}
