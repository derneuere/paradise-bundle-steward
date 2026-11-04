// PropTransformOverlay — move/rotate gizmo + marquee multi-select for prop
// instances, the prop analogue of TrafficData's static-vehicle gizmo.
//
// A prop's pose is a full Matrix44Affine (mWorldTransform), so the gizmo offers
// all three translate arrows AND all three rotate rings (TRANSFORM_AXES_FULL_3D).
// The gizmo anchors at the median pivot of the transform set, which is the union
// of:
//   - the inspector-selected instance (selectedPath ['instances', i]), and
//   - any instances box-selected with the marquee (press B, drag; alt = remove).
//
// The marquee set is VIEWPORT-LOCAL state (a Set of instance indices) — it isn't
// wired into the WorkspaceHierarchy tree / bulk panel the way TrafficData's is.
// That keeps this self-contained; the in-viewport interaction (box-select, then
// drag the gizmo to move/rotate the whole set) is identical. The selected set is
// outlined so the user can see what will move.
//
// Edits flow through the shared Bulk transform (`transform()` + the prop
// resolver, which owns the Matrix44Affine packing and composes the gesture's
// rotation into each prop's basis) and out via onChange. One gesture = one
// onChange = one undo entry (commit on pointer release; the live drag only
// moves the gizmo).

import { useCallback, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { ParsedPropInstanceData } from '@/lib/core/propInstanceData';
import { selectionPivot, toTransformDelta, transform, type Point } from '@/lib/core/transform';
// The prop resolver imports three, so it is deliberately absent from the
// transform barrel (the CLI and the node runner pull that in) — direct path.
import {
	propInstanceResolver,
	type PropInstanceRef,
} from '@/lib/core/transform/resolvers/propInstanceData';
import { TRANSFORM_AXES_FULL_3D } from '@/lib/core/transformAxes';
import { BulkTransformGizmo } from '@/components/common/three/BulkTransformGizmo';
import { CameraBridge, type CameraBridgeData } from '@/components/common/three/CameraBridge';
import { MarqueeSelector } from '@/components/common/three/MarqueeSelector';
import { type BulkTransformDelta, isIdentityDelta } from '@/hooks/useBulkTransformDrag';
import { useDisposeOnDepsChange } from '@/hooks/useDisposeOnDepsChange';
import type { NodePath } from '@/lib/schema/walk';
import type { WorldOverlayComponent } from './WorldViewport.types';
import { useWorldViewportHtmlSlot } from './WorldViewport';
import { SELECTION_THEME } from './selection';

// Half-extent of the per-target selection outline box (world metres). Roughly
// the prop marker footprint so the outline reads as "this prop is in the set".
const OUTLINE_HALF = 2.5;

const targetOutlineMat = new THREE.LineBasicMaterial({
	color: '#' + SELECTION_THEME.primary.getHexString(),
	transparent: true, opacity: 0.85, depthTest: false,
});

// 12 edges of a unit cube (±1) as 24 endpoints — translated/scaled per target.
const CUBE_EDGES: ReadonlyArray<readonly [number, number, number]> = [
	[-1, -1, -1], [1, -1, -1], [1, -1, -1], [1, -1, 1], [1, -1, 1], [-1, -1, 1], [-1, -1, 1], [-1, -1, -1],
	[-1, 1, -1], [1, 1, -1], [1, 1, -1], [1, 1, 1], [1, 1, 1], [-1, 1, 1], [-1, 1, 1], [-1, 1, -1],
	[-1, -1, -1], [-1, 1, -1], [1, -1, -1], [1, 1, -1], [1, -1, 1], [1, 1, 1], [-1, -1, 1], [-1, 1, 1],
];

/** Box-edge outlines around every instance in `indices`. Null when empty. */
export function buildTargetOutline(data: ParsedPropInstanceData, indices: readonly number[]): THREE.BufferGeometry | null {
	if (indices.length === 0) return null;
	const pos = new Float32Array(indices.length * CUBE_EDGES.length * 3);
	let p = 0;
	for (const i of indices) {
		const inst = data.instances[i];
		if (!inst) continue;
		const cx = inst.mWorldTransform[12] ?? 0;
		const cy = inst.mWorldTransform[13] ?? 0;
		const cz = inst.mWorldTransform[14] ?? 0;
		for (const e of CUBE_EDGES) {
			pos[p++] = cx + e[0] * OUTLINE_HALF;
			pos[p++] = cy + e[1] * OUTLINE_HALF;
			pos[p++] = cz + e[2] * OUTLINE_HALF;
		}
	}
	const geo = new THREE.BufferGeometry();
	geo.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, p), 3));
	return geo;
}

/** The instance index a NodePath selects, or -1. Exported for tests. */
export function selectedInstanceIndex(path: NodePath, count: number): number {
	if (path[0] !== 'instances' || typeof path[1] !== 'number') return -1;
	return path[1] >= 0 && path[1] < count ? path[1] : -1;
}

type Props = {
	data: ParsedPropInstanceData;
	selectedPath: NodePath;
	onSelect: (path: NodePath) => void;
	onChange?: (next: ParsedPropInstanceData) => void;
	isActive?: boolean;
};

export const PropTransformOverlay: WorldOverlayComponent<ParsedPropInstanceData> = ({
	data, selectedPath, onChange, isActive = true,
}: Props) => {
	const instances = data?.instances ?? [];
	const count = instances.length;
	const [marquee, setMarquee] = useState<ReadonlySet<number>>(() => new Set());
	const [dragDelta, setDragDelta] = useState<BulkTransformDelta | null>(null);
	const cameraBridge = useRef<CameraBridgeData | null>(null);
	// Snapshot the pivot at gesture start so a rotate doesn't drift as the
	// translate part of the same gesture moves the median (mirrors TrafficData).
	const pivotRef = useRef<Point | null>(null);

	// Transform set = inspector selection ∪ marqueed indices, clamped to range.
	const targets = useMemo(() => {
		const set = new Set<number>();
		for (const i of marquee) if (i >= 0 && i < count) set.add(i);
		const sel = selectedInstanceIndex(selectedPath, count);
		if (sel >= 0) set.add(sel);
		return [...set].sort((a, b) => a - b);
	}, [marquee, selectedPath, count]);

	// The outline geometry wants raw indices; the transform wants refs.
	const refs = useMemo<PropInstanceRef[]>(
		() => targets.map((instanceIdx) => ({ kind: 'propInstance', instanceIdx })),
		[targets],
	);

	const livePivot = useMemo(() => selectionPivot(data, refs, propInstanceResolver), [data, refs]);

	const outlineGeo = useMemo(() => buildTargetOutline(data, targets), [data, targets]);
	// Built imperatively + handed to R3F by reference, so R3F won't auto-dispose
	// it — free the prior geometry on change AND on unmount (the hook's effect
	// cleanup covers both), matching PropCellGridOverlay / PropGeometry.
	useDisposeOnDepsChange(() => outlineGeo?.dispose(), [outlineGeo]);

	const handleMarquee = useCallback((frustum: THREE.Frustum, mode: 'add' | 'remove') => {
		const pt = new THREE.Vector3();
		const hits: number[] = [];
		for (let i = 0; i < count; i++) {
			const t = instances[i].mWorldTransform;
			pt.set(t[12] ?? 0, t[13] ?? 0, t[14] ?? 0);
			if (frustum.containsPoint(pt)) hits.push(i);
		}
		if (hits.length === 0) return;
		setMarquee((prev) => {
			const next = new Set(prev);
			for (const i of hits) { if (mode === 'remove') next.delete(i); else next.add(i); }
			return next;
		});
	}, [instances, count]);

	const gizmoPosition = useMemo<[number, number, number] | null>(() => {
		const pivot = pivotRef.current ?? livePivot;
		if (!pivot) return null;
		return [
			pivot.x + (dragDelta?.translate.x ?? 0),
			pivot.y + (dragDelta?.translate.y ?? 0),
			pivot.z + (dragDelta?.translate.z ?? 0),
		];
	}, [livePivot, dragDelta]);

	const handleTransform = useCallback((delta: BulkTransformDelta) => {
		if (!pivotRef.current && livePivot) pivotRef.current = livePivot;
		setDragDelta(delta);
	}, [livePivot]);

	const handleCommit = useCallback((delta: BulkTransformDelta) => {
		setDragDelta(null);
		const pivot = pivotRef.current;
		pivotRef.current = null;
		if (!onChange || refs.length === 0 || isIdentityDelta(delta)) return;
		// translate-then-rotate-about-the-translate-adjusted-pivot lives in
		// transform() now; a commit arriving with no preceding onTransform frame
		// falls back to the live median instead of silently dropping the rotate.
		const next = transform(data, refs, toTransformDelta(delta, pivot ?? livePivot), propInstanceResolver);
		if (next !== data) onChange(next);
	}, [data, onChange, refs, livePivot]);

	const handleCancel = useCallback(() => {
		setDragDelta(null);
		pivotRef.current = null;
	}, []);

	// Marquee DOM rides the chrome HTML slot, only while this PID is the active
	// selection so it doesn't fight sibling overlays for the slot (issue #24).
	const htmlNode = useMemo(
		() => (
			<MarqueeSelector
				bridge={cameraBridge}
				far={50000}
				onMarquee={handleMarquee}
				hintIdle="press B to box-select props"
			/>
		),
		[handleMarquee],
	);
	useWorldViewportHtmlSlot(isActive ? htmlNode : null);

	if (!isActive) return null;

	return (
		<>
			{outlineGeo && (
				<lineSegments geometry={outlineGeo} material={targetOutlineMat} renderOrder={9} raycast={() => undefined as unknown as void} />
			)}
			{onChange && gizmoPosition && (
				<BulkTransformGizmo
					position={gizmoPosition}
					axes={TRANSFORM_AXES_FULL_3D}
					onTransform={handleTransform}
					onCommit={handleCommit}
					onCancel={handleCancel}
				/>
			)}
			<CameraBridge bridge={cameraBridge} />
		</>
	);
};
