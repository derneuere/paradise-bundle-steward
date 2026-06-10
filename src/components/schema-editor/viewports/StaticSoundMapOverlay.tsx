// StaticSoundMapOverlay — WorldViewport overlay for ambient sound placements.
//
// Renders every StaticSoundEntity as a small sphere at its world position —
// sounds have no orientation or footprint, so a fixed-size marker (not a
// transform-driven box like props) is the honest representation. One
// InstancedMesh draws the whole map; markers are tinted by the entity's
// muTypeOrDistance so passby types (Tunnel/Camera/Collision) group visually.
// Click picks an entity; the selected one gets a wireframe outline, an Html
// label, and — when the value reads as an emitter distance — a ground ring
// showing how far the sound carries.
//
// The map's role (emitter vs passby) is not in the model (meRootType lies),
// so the ring uses the same best-effort heuristic as the schema's labels:
// values beyond the passby enum (>= 19) are treated as metres. Retail passby
// maps only use 9/10/12, retail emitter distances run 14–259, so the rare
// 14–18 m emitter renders ringless rather than a passby ever growing a ring.
//
// Selection currency is the schema NodePath (ADR-0001): the overlay matches
// `['entities', i, ...]` for highlight and emits `['entities', i]` on click.

import { useCallback, useMemo, useRef } from 'react';
import { Html } from '@react-three/drei';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { PASSBY_TYPES, type ParsedStaticSoundMap, type StaticSoundEntity } from '@/lib/core/staticSoundMap';
import { typeOrDistanceLabel } from '@/lib/schema/resources/staticSoundMap';
import { useUpdateInstancedMesh } from '@/lib/three/scene/useUpdateInstancedMesh';
import { useFlyCameraToTarget } from '@/lib/three/scene/useFlyCameraToTarget';
import type { NodePath } from '@/lib/schema/walk';
import type { WorldOverlayComponent } from './WorldViewport.types';
import { defineSelectionCodec, SELECTION_THEME, isDragRelease, type Selection } from './selection';

const KIND = 'staticSoundEntity';

// ---------------------------------------------------------------------------
// Path ↔ Selection codec (exported for tests)
// ---------------------------------------------------------------------------

/** Sub-paths inside an entity (e.g. `['entities', i, 'mPosition']`) collapse
 *  to "this entity is selected". */
export const staticSoundSelectionCodec = defineSelectionCodec({
	pathToSelection: (path: NodePath): Selection | null => {
		if (path.length < 2 || path[0] !== 'entities') return null;
		const idx = path[1];
		if (typeof idx !== 'number') return null;
		return { kind: KIND, indices: [idx] };
	},
	selectionToPath: (sel: Selection): NodePath =>
		sel.kind === KIND ? ['entities', sel.indices[0]] : [],
});

// ---------------------------------------------------------------------------
// Pure helpers (exported for tests)
// ---------------------------------------------------------------------------

/** Audible-distance reading of the dual-semantics u16 — null when the value
 *  sits inside the passby enum and a metres reading would be a guess. */
export function audibleRadius(ent: StaticSoundEntity): number | null {
	return ent.muTypeOrDistance >= PASSBY_TYPES.length ? ent.muTypeOrDistance : null;
}

/** Stable per-value tint, golden-ratio hue step (same recipe as prop types):
 *  passby maps get one colour per type, emitter maps a spread by distance. */
export function soundEntityColor(typeOrDistance: number): THREE.Color {
	const hue = ((typeOrDistance * 0.61803398875) % 1 + 1) % 1;
	return new THREE.Color().setHSL(hue, 0.75, 0.6);
}

// ---------------------------------------------------------------------------
// Shared GPU state — one geometry/material for every overlay instance.
// ---------------------------------------------------------------------------

// ~1.6 m radius: visible next to 3-4 m prop boxes without burying the track.
const MARKER_GEO = new THREE.SphereGeometry(1.6, 16, 12);
const MARKER_MAT = new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.05 });

// Selected-entity outline — a sparse wireframe sphere; EdgesGeometry is useless
// on smooth spheres (no hard edges), so wireframe it is. Depth-test off so the
// highlight survives the marker sitting half-inside the road mesh.
const OUTLINE_GEO = new THREE.WireframeGeometry(new THREE.SphereGeometry(2.2, 12, 8));
const OUTLINE_MAT = new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true });

// Unit ground circle scaled per-entity to the audible radius.
const RING_GEO = (() => {
	const pts: THREE.Vector3[] = [];
	for (let i = 0; i <= 64; i++) {
		const a = (i / 64) * Math.PI * 2;
		pts.push(new THREE.Vector3(Math.cos(a), 0, Math.sin(a)));
	}
	return new THREE.BufferGeometry().setFromPoints(pts);
})();
const RING_MAT = new THREE.LineBasicMaterial({ color: 0x66ccff, transparent: true, opacity: 0.6 });

const SELECTED_COLOR = '#' + SELECTION_THEME.primary.getHexString();

// ---------------------------------------------------------------------------
// Selected-entity outline + label + audible ring
// ---------------------------------------------------------------------------

export function SelectedSoundDecor({ ent, index }: { ent: StaticSoundEntity; index: number }) {
	const { x, y, z } = ent.mPosition;
	const radius = audibleRadius(ent);
	return (
		<>
			<lineSegments geometry={OUTLINE_GEO} material={OUTLINE_MAT} position={[x, y, z]} />
			{radius != null && (
				<lineLoop geometry={RING_GEO} material={RING_MAT} position={[x, y, z]} scale={[radius, 1, radius]} />
			)}
			<Html position={[x, y, z]} center style={{ pointerEvents: 'none' }}>
				<div style={{
					background: 'rgba(0,0,0,0.8)', color: SELECTED_COLOR, padding: '2px 6px',
					borderRadius: 4, fontSize: 10, whiteSpace: 'nowrap', fontFamily: 'monospace',
					transform: 'translateY(-22px)',
				}}>
					#{index} {typeOrDistanceLabel(ent.muTypeOrDistance)} | snd {ent.muSoundIndex}
				</div>
			</Html>
		</>
	);
}

// ---------------------------------------------------------------------------
// Camera auto-fit — same trick as FocusOnProp: fly over when an entity is
// selected from the tree so the marker is actually on-screen.
// ---------------------------------------------------------------------------

export function FocusOnSound({ data, selectedPath }: { data: ParsedStaticSoundMap; selectedPath: NodePath }) {
	const { camera, controls } = useThree() as { camera: THREE.Camera; controls: { target: THREE.Vector3; update: () => void } | null };
	const entities = data?.entities ?? [];
	const target = useMemo<THREE.Vector3 | null>(() => {
		if (selectedPath.length < 2 || selectedPath[0] !== 'entities') return null;
		const i = selectedPath[1];
		if (typeof i !== 'number' || i >= entities.length) return null;
		const { x, y, z } = entities[i].mPosition;
		return new THREE.Vector3(x, y, z);
	}, [entities, selectedPath]);
	useFlyCameraToTarget(camera, controls, target, 60);
	return null;
}

// ---------------------------------------------------------------------------
// Overlay
// ---------------------------------------------------------------------------

export const StaticSoundMapOverlay: WorldOverlayComponent<ParsedStaticSoundMap> = ({
	data, selectedPath, onSelect,
}) => {
	const entities = data?.entities ?? [];
	const count = entities.length;
	const meshRef = useRef<THREE.InstancedMesh>(null!);

	const selIdx = useMemo(() => {
		const sel = staticSoundSelectionCodec.pathToSelection(selectedPath);
		return sel && sel.indices[0] < count ? sel.indices[0] : -1;
	}, [selectedPath, count]);

	useUpdateInstancedMesh(
		meshRef,
		count,
		(mesh) => {
			const mat = new THREE.Matrix4();
			for (let i = 0; i < count; i++) {
				const { x, y, z } = entities[i].mPosition;
				mesh.setMatrixAt(i, mat.makeTranslation(x, y, z));
				const color = i === selIdx ? SELECTION_THEME.primary : soundEntityColor(entities[i].muTypeOrDistance);
				mesh.setColorAt(i, color);
			}
			if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
		},
		[entities, count, selIdx],
	);

	const onClick = useCallback((e: ThreeEvent<MouseEvent>) => {
		e.stopPropagation();
		// Don't select when the click ends a camera orbit — see dragGuard.
		if (isDragRelease(e.nativeEvent.clientX, e.nativeEvent.clientY)) return;
		if (e.instanceId == null) return;
		onSelect(staticSoundSelectionCodec.selectionToPath({ kind: KIND, indices: [e.instanceId] }));
	}, [onSelect]);

	if (count === 0) return null;

	const selEnt = selIdx >= 0 ? entities[selIdx] : null;

	return (
		<>
			<FocusOnSound data={data} selectedPath={selectedPath} />
			<instancedMesh
				ref={meshRef}
				args={[MARKER_GEO, MARKER_MAT, count]}
				onClick={onClick}
			/>
			{selEnt && <SelectedSoundDecor ent={selEnt} index={selIdx} />}
		</>
	);
};
