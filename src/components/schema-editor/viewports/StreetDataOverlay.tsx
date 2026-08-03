// StreetDataOverlay — WorldViewport overlay for the StreetData resource.
//
// Selection currency (the public contract per ADR-0001) is the schema NodePath:
// this overlay matches `['roads', i]`, `['streets', i]`, `['junctions', i]`
// directly. The path↔Selection codec is `streetSelectionCodec` below.
//
// The markers themselves (instanced spheres/cubes/octahedrons and the hover
// label) live in `./StreetDataMarkers`; what stays here is the codec plus the
// edit path.
//
// `onChange` is forwarded for in-scene edits: a selected road gets a
// BulkTransformGizmo whose gesture runs through the shared transform core
// (`@/lib/core/transform`) rather than any street-specific op.
//
// The grid stays here rather than in the WorldViewport chrome — AI sections
// and ZoneList both deliberately omit it (z-fights with their dense polys),
// so it's a StreetData-specific decoration, not chrome default.

import { useCallback, useMemo, useRef, useState } from 'react';
import { Grid } from '@react-three/drei';
import * as THREE from 'three';
import type { ParsedStreetData } from '@/lib/core/streetData';
import {
	resolverAxes,
	selectionPivot,
	streetDataResolver,
	toTransformDelta,
	transform,
	type Point,
	type StreetDataRef,
} from '@/lib/core/transform';
import { BulkTransformGizmo } from '@/components/common/three/BulkTransformGizmo';
import {
	type BulkTransformDelta,
	isIdentityDelta,
} from '@/hooks/useBulkTransformDrag';
import type { NodePath } from '@/lib/schema/walk';
import type { WorldOverlayComponent } from './WorldViewport.types';
import {
	JunctionInstances,
	RoadInstances,
	SelectedLabel,
	StreetInstances,
} from './StreetDataMarkers';
import { defineSelectionCodec, type Selection } from './selection';

// ---------------------------------------------------------------------------
// Path ↔ Selection codec (exported for tests)
// ---------------------------------------------------------------------------

/**
 * Codec for the three top-level StreetData lists. Sub-paths inside an entity
 * (e.g. drilling into `['streets', 5, 'mAiInfo', ...]`) collapse to "this
 * entity is selected" — the inspector can refine to a primitive but the 3D
 * overlay still highlights the parent.
 */
export const streetSelectionCodec = defineSelectionCodec({
	pathToSelection: (path: NodePath): Selection | null => {
		if (path.length < 2) return null;
		const head = path[0];
		const idx = path[1];
		if (typeof idx !== 'number') return null;
		if (head === 'streets') return { kind: 'street', indices: [idx] };
		if (head === 'junctions') return { kind: 'junction', indices: [idx] };
		if (head === 'roads') return { kind: 'road', indices: [idx] };
		return null;
	},
	selectionToPath: (sel: Selection): NodePath => {
		if (sel.kind === 'street') return ['streets', sel.indices[0]];
		if (sel.kind === 'junction') return ['junctions', sel.indices[0]];
		if (sel.kind === 'road') return ['roads', sel.indices[0]];
		return [];
	},
});

/** Back-compat alias retained for test imports — same as the codec direction. */
export const streetPathMarker = streetSelectionCodec.pathToSelection;
/** Back-compat alias retained for test imports — same as the codec direction. */
export const streetMarkerPath = (sel: Selection | null): NodePath =>
	sel ? streetSelectionCodec.selectionToPath(sel) : [];

// ---------------------------------------------------------------------------
// Scene bounds — kept overlay-local so the grid sizes itself sensibly. The
// chrome's camera is fixed (ADR-0003); this is purely for the grid extent.
// ---------------------------------------------------------------------------

function computeBounds(data: ParsedStreetData): { center: THREE.Vector3; radius: number } {
	if (data.roads.length === 0) return { center: new THREE.Vector3(), radius: 50 };
	const box = new THREE.Box3();
	for (const r of data.roads) {
		box.expandByPoint(new THREE.Vector3(r.mReferencePosition.x, r.mReferencePosition.y, r.mReferencePosition.z));
	}
	const sphere = new THREE.Sphere();
	box.getBoundingSphere(sphere);
	return { center: sphere.center, radius: Math.max(sphere.radius, 20) };
}

// ---------------------------------------------------------------------------
// Overlay
// ---------------------------------------------------------------------------

type Props = {
	data: ParsedStreetData;
	selectedPath: NodePath;
	onSelect: (path: NodePath) => void;
	onChange?: (next: ParsedStreetData) => void;
};

export const StreetDataOverlay: WorldOverlayComponent<ParsedStreetData> = ({
	data,
	selectedPath,
	onSelect,
	onChange,
}: Props) => {
	const [hovered, setHovered] = useState<Selection | null>(null);
	const { center, radius } = useMemo(() => computeBounds(data), [data]);

	const primary = useMemo(
		() => streetSelectionCodec.pathToSelection(selectedPath),
		[selectedPath],
	);

	const handlePick = useCallback(
		(sel: Selection) => onSelect(streetSelectionCodec.selectionToPath(sel)),
		[onSelect],
	);

	// =========================================================================
	// Bulk-transform gizmo (issue #79)
	//
	// Single-road selection only in this slice — the gizmo moves
	// `Road.mReferencePosition` (Vector3, full 3D) through the shared transform
	// core. Multi-road bulks arrive via the workspace bulk Set in a later slice
	// and need no change here: `bulkRefs` just gets longer.
	//
	// All three rotate rings are live even for a single road. A point orbiting
	// its own position would be a no-op, but the pivot is drag-repositionable,
	// so the road orbits wherever the user put it.
	// =========================================================================
	const bulkRefs = useMemo<readonly StreetDataRef[]>(() => {
		if (primary?.kind !== 'road') return [];
		const idx = primary.indices[0];
		if (idx < 0 || idx >= data.roads.length) return [];
		return [{ kind: 'road', roadIdx: idx }];
	}, [primary, data.roads.length]);

	const bulkPivotLive = useMemo(
		() => selectionPivot(data, bulkRefs, streetDataResolver),
		[data, bulkRefs],
	);
	const bulkAxes = useMemo(
		() => resolverAxes(bulkRefs, streetDataResolver),
		[bulkRefs],
	);
	const [dragDelta, setDragDelta] = useState<BulkTransformDelta | null>(null);

	// Gesture-start pivot snapshot. Latched on the first `onTransform` frame and
	// reused for every later frame and for the commit: re-deriving the pivot
	// from already-moved positions turns a rigid rotate into a spiral.
	const pivotAtDragStart = useRef<Point | null>(null);

	const gizmoPosition = useMemo<[number, number, number] | null>(() => {
		if (!bulkPivotLive) return null;
		// Rotation orbits the pivot, so only the translate moves the gizmo itself.
		const dx = dragDelta?.translate.x ?? 0;
		const dy = dragDelta?.translate.y ?? 0;
		const dz = dragDelta?.translate.z ?? 0;
		return [bulkPivotLive.x + dx, bulkPivotLive.y + dy, bulkPivotLive.z + dz];
	}, [bulkPivotLive, dragDelta]);

	const handleGizmoTransform = useCallback((delta: BulkTransformDelta) => {
		if (!pivotAtDragStart.current) pivotAtDragStart.current = bulkPivotLive;
		setDragDelta(delta);
	}, [bulkPivotLive]);

	const handleGizmoCommit = useCallback((delta: BulkTransformDelta) => {
		// Fall back to the live pivot when a commit arrives with no preceding
		// frame, rather than dropping the rotation on the floor.
		const pivot = pivotAtDragStart.current ?? bulkPivotLive;
		pivotAtDragStart.current = null;
		setDragDelta(null);
		if (!onChange) return;
		if (isIdentityDelta(delta)) return;
		const next = transform(data, bulkRefs, toTransformDelta(delta, pivot), streetDataResolver);
		if (next !== data) onChange(next);
	}, [data, onChange, bulkRefs, bulkPivotLive]);

	const handleGizmoCancel = useCallback(() => {
		pivotAtDragStart.current = null;
		setDragDelta(null);
	}, []);

	return (
		<>
			<Grid
				position={[center.x, center.y - radius, center.z]}
				args={[Math.max(radius * 4, 100), Math.max(radius * 4, 100)]}
				cellSize={50}
				cellThickness={0.5}
				sectionSize={200}
				sectionThickness={1}
				fadeDistance={radius * 8}
				infiniteGrid
			/>
			<RoadInstances data={data} primary={primary} hovered={hovered} onPick={handlePick} onHover={setHovered} />
			<StreetInstances data={data} primary={primary} hovered={hovered} onPick={handlePick} onHover={setHovered} />
			<JunctionInstances data={data} primary={primary} hovered={hovered} onPick={handlePick} onHover={setHovered} />
			<SelectedLabel data={data} primary={primary} hovered={hovered} />
			{onChange && gizmoPosition && bulkAxes && (
				<BulkTransformGizmo
					position={gizmoPosition}
					axes={bulkAxes}
					onTransform={handleGizmoTransform}
					onCommit={handleGizmoCommit}
					onCancel={handleGizmoCancel}
				/>
			)}
		</>
	);
};
