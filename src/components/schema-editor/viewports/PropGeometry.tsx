// PropGeometry — renders a track unit's REAL prop meshes in the WorldViewport,
// upgrading PropInstanceData's grey marker boxes to the actual prop geometry.
//
// Like <TrackGeometry>, this is NOT a pure overlay (ADR-0002): joining
// PropInstanceData (positions + type) with PropGraphicsList (type → Model) and
// decoding those Models needs the bundle's raw bytes + import table, not just a
// parsed model. So the composition mounts it per-bundle, handing it the live
// PropInstanceData model plus the raw bundle/buffer + the other loaded bundles
// (prop Models live in GLOBALPROPS.BIN). The heavy Model decode is memoized on
// the immutable bundle bytes; re-placing on a PropInstanceData edit is cheap.
//
// What renders:
//   - one InstancedMesh per resolved Model geometry (grey, like the track), at
//     each instance's transform — pickable (click → select the instance);
//   - a marker-box fallback (the old behaviour) for instances whose Model isn't
//     loaded — e.g. before GLOBALPROPS.BIN is opened, so the world still shows
//     every prop;
//   - the selected instance's outline + label + camera fly, reused from the
//     PropInstanceData overlay so selection feels identical whether a prop drew
//     as a real mesh or a fallback box.
//
// Because this owns the whole prop visual for a bundle that has a
// PropGraphicsList, the composition does NOT also mount the box-only
// PropInstanceDataOverlay for that bundle (which would double-draw).

import { useCallback, useMemo, useRef } from 'react';
import { type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { ParsedBundle } from '@/lib/core/types';
import type { ParsedPropInstanceData } from '@/lib/core/propInstanceData';
import type { NodePath } from '@/lib/schema/walk';
import { useUpdateInstancedMesh } from '@/lib/three/scene/useUpdateInstancedMesh';
import { useDisposeOnDepsChange } from '@/hooks/useDisposeOnDepsChange';
import { useDisposeOnUnmount } from '@/hooks/useDisposeOnUnmount';
import {
	decodePropTypeGeometry,
	placeProps,
	disposePropTypeGeometry,
	type BundleSource,
	type PropMeshGroup,
} from './propGeometryDecode';
import {
	MARKER_GEO,
	MARKER_MAT,
	SelectedPropDecor,
	FocusOnProp,
	propTypeColor,
	propInstanceMatrix,
	propInstanceSelectionCodec,
} from './PropInstanceDataOverlay';
import { SELECTION_THEME, isDragRelease } from './selection';

// A touch lighter / warmer than the track's grey (0x8a8f99) so props read as
// distinct objects sitting on the road rather than blending into it.
const PROP_MESH_COLOR = 0xb4b8c0;

// ---------------------------------------------------------------------------
// One instanced draw of a single resolved Model geometry
// ---------------------------------------------------------------------------

function PropMeshGroupMesh({
	group,
	material,
	onPick,
}: {
	group: PropMeshGroup;
	material: THREE.Material;
	onPick: (instanceIndex: number) => void;
}) {
	const ref = useRef<THREE.InstancedMesh>(null!);
	useUpdateInstancedMesh(
		ref,
		group.placements.length,
		(mesh) => {
			for (let i = 0; i < group.placements.length; i++) {
				mesh.setMatrixAt(i, group.placements[i].matrix);
			}
		},
		[group],
	);
	const onClick = useCallback(
		(e: ThreeEvent<MouseEvent>) => {
			e.stopPropagation();
			if (isDragRelease(e.nativeEvent.clientX, e.nativeEvent.clientY)) return;
			if (e.instanceId == null) return;
			onPick(group.placements[e.instanceId].instanceIndex);
		},
		[group, onPick],
	);
	return <instancedMesh ref={ref} args={[group.geometry, material, group.placements.length]} onClick={onClick} />;
}

// ---------------------------------------------------------------------------
// Marker-box fallback for instances whose Model didn't resolve
// ---------------------------------------------------------------------------

function PropFallbackBoxes({
	pid,
	indices,
	selIdx,
	onPick,
}: {
	pid: ParsedPropInstanceData;
	indices: number[];
	selIdx: number;
	onPick: (instanceIndex: number) => void;
}) {
	const ref = useRef<THREE.InstancedMesh>(null!);
	useUpdateInstancedMesh(
		ref,
		indices.length,
		(mesh) => {
			const mat = new THREE.Matrix4();
			for (let k = 0; k < indices.length; k++) {
				const i = indices[k];
				propInstanceMatrix(pid.instances[i], mat);
				mesh.setMatrixAt(k, mat);
				const color = i === selIdx ? SELECTION_THEME.primary : propTypeColor(pid.instances[i].typeId);
				mesh.setColorAt(k, color);
			}
		},
		[pid, indices, selIdx],
	);
	const onClick = useCallback(
		(e: ThreeEvent<MouseEvent>) => {
			e.stopPropagation();
			if (isDragRelease(e.nativeEvent.clientX, e.nativeEvent.clientY)) return;
			if (e.instanceId == null) return;
			onPick(indices[e.instanceId]);
		},
		[indices, onPick],
	);
	return <instancedMesh ref={ref} args={[MARKER_GEO, MARKER_MAT, indices.length]} onClick={onClick} />;
}

// ---------------------------------------------------------------------------
// Prop layer
// ---------------------------------------------------------------------------

export function PropGeometry({
	pid,
	bundle,
	buffer,
	externals,
	selectedPath,
	onSelect,
}: {
	pid: ParsedPropInstanceData;
	bundle: ParsedBundle;
	buffer: ArrayBuffer;
	externals: BundleSource[];
	selectedPath: NodePath;
	onSelect: (path: NodePath) => void;
}) {
	// Heavy: decode each prop type's Model once. Keyed on the immutable bundle
	// bytes (+ the companion bundles), NOT the live `pid`, so editing a prop in
	// the inspector re-places without re-decoding geometry.
	const typeGeometry = useMemo(
		() => decodePropTypeGeometry(bundle, buffer, externals),
		[bundle, buffer, externals],
	);
	// Cheap: place the live instances against the decoded geometry.
	const { groups, resolvedInstanceIndices } = useMemo(
		() => placeProps(pid, typeGeometry),
		[pid, typeGeometry],
	);

	const material = useMemo(
		() =>
			new THREE.MeshStandardMaterial({
				color: PROP_MESH_COLOR,
				side: THREE.DoubleSide,
				roughness: 0.85,
				metalness: 0.0,
			}),
		[],
	);

	// R3F doesn't free prop-fed geometry/material — tie them to this component's
	// lifetime (geometry per decode, material for the whole lifetime).
	useDisposeOnDepsChange(() => disposePropTypeGeometry(typeGeometry), [typeGeometry]);
	useDisposeOnUnmount(material);

	const unresolved = useMemo(() => {
		const out: number[] = [];
		for (let i = 0; i < pid.instances.length; i++) {
			if (!resolvedInstanceIndices.has(i)) out.push(i);
		}
		return out;
	}, [pid, resolvedInstanceIndices]);

	const selIdx = useMemo(() => {
		const sel = propInstanceSelectionCodec.pathToSelection(selectedPath);
		return sel && sel.indices[0] < pid.instances.length ? sel.indices[0] : -1;
	}, [selectedPath, pid]);

	const onPick = useCallback((i: number) => onSelect(['instances', i]), [onSelect]);

	// When the selected prop draws as a real mesh, outline its actual bounding box
	// (oriented by the instance transform) rather than the fixed marker box — so
	// the selection box matches the prop's true shape (e.g. a wide flat fan, not a
	// tall thin box). Falls back to undefined (→ marker box) for unresolved props.
	const selOutline = useMemo<THREE.BufferGeometry | undefined>(() => {
		if (selIdx < 0) return undefined;
		const geoms = typeGeometry.get(pid.instances[selIdx].typeId);
		if (!geoms || geoms.length === 0) return undefined;
		const box = new THREE.Box3();
		for (const g of geoms) {
			g.computeBoundingBox();
			if (g.boundingBox) box.union(g.boundingBox);
		}
		if (box.isEmpty()) return undefined;
		const size = box.getSize(new THREE.Vector3());
		const center = box.getCenter(new THREE.Vector3());
		const bg = new THREE.BoxGeometry(
			Math.max(size.x, 1e-3),
			Math.max(size.y, 1e-3),
			Math.max(size.z, 1e-3),
		);
		bg.translate(center.x, center.y, center.z); // the bbox may be off-origin in model space
		const edges = new THREE.EdgesGeometry(bg);
		bg.dispose();
		return edges;
	}, [selIdx, pid, typeGeometry]);
	useDisposeOnDepsChange(() => selOutline?.dispose(), [selOutline]);

	if (pid.instances.length === 0) return null;
	const selInst = selIdx >= 0 ? pid.instances[selIdx] : null;

	return (
		<>
			<FocusOnProp data={pid} selectedPath={selectedPath} />
			{groups.map((group, i) => (
				<PropMeshGroupMesh key={i} group={group} material={material} onPick={onPick} />
			))}
			{unresolved.length > 0 && (
				<PropFallbackBoxes pid={pid} indices={unresolved} selIdx={selIdx} onPick={onPick} />
			)}
			{selInst && <SelectedPropDecor inst={selInst} index={selIdx} outline={selOutline} />}
		</>
	);
}
