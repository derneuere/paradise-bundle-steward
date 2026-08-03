// TrafficDataOverlay — WorldViewport overlay for the TrafficData resource.
//
// This is the gnarliest selection translation in the codebase: PVS cells
// (top-level, not owned by a hull) plus per-hull sub-types
// (sections / rungs / junctions / lightTriggers / staticTrafficVehicles)
// plus an `activeTab` highlight filter that gates which 3D layer reads as
// "selected". The overlay derives all of that internally from
// `selectedPath` — the chrome and ViewportPane stay path-only.
//
// Selection currency is the schema NodePath (ADR-0001). The overlay matches:
//   - ['hulls', h]                               → hull
//   - ['hulls', h, 'sections', i]                → section (in hull)
//   - ['hulls', h, 'rungs', i]                   → rung
//   - ['hulls', h, 'junctions', i]               → junction
//   - ['hulls', h, 'lightTriggers', i]           → light trigger
//   - ['hulls', h, 'staticTrafficVehicles', i]   → static vehicle
//   - ['pvs', 'hullPvsSets', n]                  → PVS cell
//
// `activeTab` is derived internally from the selection sub-type (sections /
// rungs / junctions / lightTriggers / staticVehicles) so callers don't have
// to thread it.
//
// DOM siblings (PVS-grid toggle, marquee bulk-select for static vehicles)
// ride the WorldViewport HTML slot via `useWorldViewportHtmlSlot`.

import { useCallback, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { ParsedTrafficDataRetail } from '@/lib/core/trafficData';
import {
	TRANSFORM_AXES_XZ_PACKED,
	selectionPivot,
	toTransformDelta,
	transform,
} from '@/lib/core/transform';
// Direct path, not the barrel: this resolver imports three, and the barrel is
// pulled in by the CLI and the node test runner, neither of which wants a
// scene graph.
import {
	trafficDataResolver,
	type TrafficDataRef,
} from '@/lib/core/transform/resolvers/trafficData';
import { BulkTransformGizmo } from '@/components/common/three/BulkTransformGizmo';
import {
	type BulkTransformDelta,
	isIdentityDelta,
} from '@/hooks/useBulkTransformDrag';
import {
	AllJunctionInstances,
	AllLaneConnections,
	AllLightTriggerInstances,
	AllRungLines,
	AllStaticVehicleInstances,
	FocusOnVehicle,
	PickingPlane,
	PvsCellTooltip,
	PvsGridOverlay,
	SectionHighlight,
	SelectedVehicleOutline,
	SelectionLabel,
	TrafficLightInstances,
	computeAllBounds,
} from '@/components/trafficdata/TrafficDataViewport';
import {
	isPvsCellSelection,
	type TrafficDataSelection,
} from '@/components/trafficdata/useTrafficSelection';
import { CameraBridge, type CameraBridgeData } from '@/components/common/three/CameraBridge';
import { MarqueeSelector } from '@/components/common/three/MarqueeSelector';
import { useSchemaBulkSelection } from '@/components/schema-editor/bulkSelectionContext';
import type { NodePath } from '@/lib/schema/walk';
import type { WorldOverlayComponent } from './WorldViewport.types';
import { useWorldViewportHtmlSlot } from './WorldViewport';
import { defineSelectionCodec, type Selection } from './selection';

// ---------------------------------------------------------------------------
// Path ↔ Selection codec (exported for tests)
// ---------------------------------------------------------------------------

const SUB_TYPE_FROM_LIST: Record<string, 'section' | 'rung' | 'junction' | 'lightTrigger' | 'staticVehicle'> = {
	sections: 'section',
	rungs: 'rung',
	junctions: 'junction',
	lightTriggers: 'lightTrigger',
	staticTrafficVehicles: 'staticVehicle',
};

const LIST_FROM_SUB_TYPE: Record<string, string> = {
	section: 'sections',
	rung: 'rungs',
	junction: 'junctions',
	lightTrigger: 'lightTriggers',
	staticVehicle: 'staticTrafficVehicles',
};

const SUB_TYPE_TO_TAB: Record<string, string> = {
	section: 'sections',
	rung: 'rungs',
	junction: 'junctions',
	lightTrigger: 'lightTriggers',
	staticVehicle: 'staticVehicles',
};

/**
 * Codec for every TrafficData entity. Sub-paths inside a list item collapse
 * to the parent (drilling into `mfSpeed` of a section keeps the section
 * highlighted). Selection kinds:
 *   - 'hull'         → indices: [hullIndex]
 *   - 'section'      → indices: [hullIndex, sectionIndex]
 *   - 'rung'         → indices: [hullIndex, rungIndex]
 *   - 'junction'     → indices: [hullIndex, junctionIndex]
 *   - 'lightTrigger' → indices: [hullIndex, lightTriggerIndex]
 *   - 'staticVehicle'→ indices: [hullIndex, vehicleIndex]
 *   - 'pvsCell'      → indices: [cellIndex]
 *
 * The overlay still adapts internally to the legacy `TrafficDataSelection`
 * shape every consumer in `@/components/trafficdata/TrafficDataViewport`
 * speaks; the codec is the public seam.
 */
export const trafficSelectionCodec = defineSelectionCodec({
	pathToSelection: (path: NodePath): Selection | null => {
		if (path[0] === 'pvs' && path[1] === 'hullPvsSets' && typeof path[2] === 'number') {
			return { kind: 'pvsCell', indices: [path[2]] };
		}
		if (path.length < 2 || path[0] !== 'hulls') return null;
		const hullIndex = path[1];
		if (typeof hullIndex !== 'number') return null;
		if (path.length === 2) return { kind: 'hull', indices: [hullIndex] };
		const list = path[2];
		const idx = path[3];
		if (typeof list !== 'string' || typeof idx !== 'number') return { kind: 'hull', indices: [hullIndex] };
		const subType = SUB_TYPE_FROM_LIST[list];
		if (!subType) return { kind: 'hull', indices: [hullIndex] };
		return { kind: subType, indices: [hullIndex, idx] };
	},
	selectionToPath: (sel: Selection): NodePath => {
		if (sel.kind === 'pvsCell') return ['pvs', 'hullPvsSets', sel.indices[0]];
		if (sel.kind === 'hull') return ['hulls', sel.indices[0]];
		const list = LIST_FROM_SUB_TYPE[sel.kind];
		return list ? ['hulls', sel.indices[0], list, sel.indices[1]] : [];
	},
});

// Adapters between the unified Selection shape and the legacy
// TrafficDataSelection consumed by `@/components/trafficdata/TrafficDataViewport`.
// Kept private to this overlay — the boundary into the children is fully
// owned here.
function selectionToTrafficSelection(sel: Selection | null): TrafficDataSelection {
	if (!sel) return null;
	if (sel.kind === 'pvsCell') return { kind: 'pvsCell', cellIndex: sel.indices[0] };
	if (sel.kind === 'hull') return { hullIndex: sel.indices[0] };
	if (sel.kind === 'section' || sel.kind === 'rung' || sel.kind === 'junction'
		|| sel.kind === 'lightTrigger' || sel.kind === 'staticVehicle') {
		return { hullIndex: sel.indices[0], sub: { type: sel.kind, index: sel.indices[1] } };
	}
	return null;
}

function trafficSelectionToSelection(sel: TrafficDataSelection): Selection | null {
	if (!sel) return null;
	if (isPvsCellSelection(sel)) return { kind: 'pvsCell', indices: [sel.cellIndex] };
	if (!sel.sub) return { kind: 'hull', indices: [sel.hullIndex] };
	return { kind: sel.sub.type, indices: [sel.hullIndex, sel.sub.index] };
}

/**
 * Back-compat alias retained for tests + any caller that still wants the
 * legacy `TrafficDataSelection` directly.
 */
export function trafficPathSelection(path: NodePath): TrafficDataSelection {
	return selectionToTrafficSelection(trafficSelectionCodec.pathToSelection(path));
}

/** Back-compat alias retained for tests. */
export function trafficSelectionPath(sel: TrafficDataSelection): NodePath {
	const s = trafficSelectionToSelection(sel);
	return s ? trafficSelectionCodec.selectionToPath(s) : [];
}

/**
 * Pick the active tab for the given selection. Drives which 3D layer reads
 * as "selected" — the source viewport used this to filter the traffic-light
 * layer; we keep the same behaviour, derived internally from `selectedPath`.
 */
export function trafficActiveTabFromSelection(sel: TrafficDataSelection): string {
	if (!sel || isPvsCellSelection(sel)) return 'sections';
	if (!sel.sub) return 'sections';
	return SUB_TYPE_TO_TAB[sel.sub.type] ?? 'sections';
}

// ---------------------------------------------------------------------------
// Overlay
// ---------------------------------------------------------------------------

type Props = {
	data: ParsedTrafficDataRetail;
	selectedPath: NodePath;
	onSelect: (path: NodePath) => void;
	onChange?: (next: ParsedTrafficDataRetail) => void;
	/** True when this overlay owns the active selection — gates tool registration. */
	isActive?: boolean;
};

export const TrafficDataOverlay: WorldOverlayComponent<ParsedTrafficDataRetail> = ({
	data, selectedPath, onSelect, onChange, isActive = true,
}: Props) => {
	const hulls = data.hulls;

	// Derive TrafficDataSelection / activeHullIndex / activeTab from the
	// schema path. The sub-components below use the legacy selection shape;
	// we adapt at the boundary.
	const selected = useMemo(() => trafficPathSelection(selectedPath), [selectedPath]);
	const activeHullIndex = selected && !isPvsCellSelection(selected) ? selected.hullIndex : 0;
	const activeTab = useMemo(() => trafficActiveTabFromSelection(selected), [selected]);

	const handleSelect = useCallback(
		(sel: TrafficDataSelection) => onSelect(trafficSelectionPath(sel)),
		[onSelect],
	);

	// Bounds — used only for sizing the picking plane (chrome owns the camera
	// per ADR-0003, so we don't fit to bounds here).
	const { center, radius } = useMemo(() => computeAllBounds(hulls), [hulls]);

	// PVS overlay: visible by default whenever the resource has a populated
	// grid. Toggle gates click + tooltip too — we don't want the grid mesh
	// intercepting clicks meant for hulls / vehicles when it's hidden.
	const hasPvsGrid = data.pvs.muNumCells_X > 0 && data.pvs.muNumCells_Z > 0 && data.pvs.hullPvsSets.length > 0;
	const [showPvsGrid, setShowPvsGrid] = useState(hasPvsGrid);
	const [hoverCellIndex, setHoverCellIndex] = useState<number | null>(null);
	const [hoverWorld, setHoverWorld] = useState<THREE.Vector3 | null>(null);
	const handleHoverCell = useCallback((idx: number | null, w: THREE.Vector3 | null) => {
		setHoverCellIndex(idx);
		setHoverWorld(w);
	}, []);

	// Marquee wiring — picks static traffic vehicles inside the dragged
	// rectangle. (Other pickable kinds — junctions, light triggers — could
	// be added later; vehicles are the most common bulk-edit target.)
	const cameraBridge = useRef<CameraBridgeData | null>(null);
	const bulk = useSchemaBulkSelection();
	const handleMarquee = useCallback(
		(frustum: THREE.Frustum, mode: 'add' | 'remove') => {
			if (!bulk?.onBulkApplyPaths) return;
			const hits: NodePath[] = [];
			const pt = new THREE.Vector3();
			for (let h = 0; h < hulls.length; h++) {
				const list = hulls[h].staticTrafficVehicles;
				for (let s = 0; s < list.length; s++) {
					const m = list[s].mTransform;
					pt.set(m[12] ?? 0, m[13] ?? 0, m[14] ?? 0);
					if (frustum.containsPoint(pt)) {
						hits.push(['hulls', h, 'staticTrafficVehicles', s]);
					}
				}
			}
			if (hits.length === 0) return;
			bulk.onBulkApplyPaths(hits, mode);
		},
		[hulls, bulk],
	);

	const selectedHull = selected && !isPvsCellSelection(selected) ? hulls[selected.hullIndex] : null;
	const selectedSectionIndex =
		selected && !isPvsCellSelection(selected) && selected.sub?.type === 'section'
			? selected.sub.index
			: -1;

	// =========================================================================
	// Bulk-transform gizmo (issues #78 + #79)
	//
	// Maps the schema-Selection (junction / lightTrigger / rung / static
	// vehicle) to a `TrafficDataRef` list and folds in any marquee-selected
	// static vehicles from the schema bulk context, then anchors the gizmo at
	// the median pivot and hands the whole gesture to the shared transform.
	// There is no per-representation dispatch here any more: the resolver
	// knows that a yaw-packed box takes the yaw in its `.w`, a lane rung has
	// two endpoints, and a static vehicle's Matrix44 basis takes the full
	// delta — and all three orbit through one piece of math, so they cannot
	// counter-rotate.
	// =========================================================================
	const bulkRefs = useMemo<readonly TrafficDataRef[]>(() => {
		const out: TrafficDataRef[] = [];
		const seen = new Set<string>();

		const addStaticVehicle = (hullIdx: number, vehicleIdx: number) => {
			if (hullIdx < 0 || hullIdx >= hulls.length) return;
			const hull = hulls[hullIdx];
			if (vehicleIdx < 0 || vehicleIdx >= hull.staticTrafficVehicles.length) return;
			const key = `sv:${hullIdx}:${vehicleIdx}`;
			if (seen.has(key)) return;
			seen.add(key);
			out.push({ kind: 'staticVehicle', hullIdx, vehicleIdx });
		};

		// Marquee-selected static vehicles. Paths look like
		// `['hulls', h, 'staticTrafficVehicles', s]` (see the marquee
		// handler that emits them above).
		if (bulk?.bulkPathKeys) {
			for (const key of bulk.bulkPathKeys) {
				const parts = key.split('/');
				if (parts.length !== 4 || parts[0] !== 'hulls' || parts[2] !== 'staticTrafficVehicles') continue;
				const h = Number(parts[1]);
				const s = Number(parts[3]);
				if (Number.isFinite(h) && Number.isFinite(s)) addStaticVehicle(h, s);
			}
		}

		// Inspector pick (single-select).
		if (selected && !isPvsCellSelection(selected) && selected.sub) {
			const hullIdx = selected.hullIndex;
			switch (selected.sub.type) {
				case 'junction':
					out.push({ kind: 'junction', hullIdx, junctionIdx: selected.sub.index });
					break;
				case 'lightTrigger':
					out.push({ kind: 'lightTrigger', hullIdx, triggerIdx: selected.sub.index });
					break;
				case 'rung':
					out.push({ kind: 'laneRung', hullIdx, rungIdx: selected.sub.index });
					break;
				case 'staticVehicle':
					addStaticVehicle(hullIdx, selected.sub.index);
					break;
				// Section picks have no transform target — pass-through.
			}
		}
		return out;
	}, [selected, bulk, hulls]);

	// Snapshot the pivot at gesture start so it doesn't drift mid-rotate — see
	// the AISectionsOverlay comment for the rationale.
	const bulkPivotRef = useRef<{ x: number; y: number; z: number } | null>(null);
	const bulkPivotLive = useMemo(
		() => selectionPivot(data, bulkRefs, trafficDataResolver),
		[data, bulkRefs],
	);
	const [dragDelta, setDragDelta] = useState<BulkTransformDelta | null>(null);

	// A pure static-vehicle Selection gets all three rotate rings; any
	// yaw-packed sibling AND-collapses pitch and roll off (ADR-0011). The
	// empty-Selection fallback never renders — `gizmoPosition` is null then.
	const gizmoAxes = useMemo(
		() => trafficDataResolver.axes(bulkRefs) ?? TRANSFORM_AXES_XZ_PACKED,
		[bulkRefs],
	);

	const gizmoPosition = useMemo<[number, number, number] | null>(() => {
		const pivot = bulkPivotRef.current ?? bulkPivotLive;
		if (!pivot) return null;
		const dx = dragDelta?.translate.x ?? 0;
		const dy = dragDelta?.translate.y ?? 0;
		const dz = dragDelta?.translate.z ?? 0;
		return [pivot.x + dx, pivot.y + dy, pivot.z + dz];
	}, [bulkPivotLive, dragDelta]);

	const handleGizmoTransform = useCallback((delta: BulkTransformDelta) => {
		if (!bulkPivotRef.current && bulkPivotLive) {
			bulkPivotRef.current = bulkPivotLive;
		}
		setDragDelta(delta);
	}, [bulkPivotLive]);

	const handleGizmoCommit = useCallback((delta: BulkTransformDelta) => {
		setDragDelta(null);
		// Gesture-start snapshot, or the live median if the commit arrived with
		// no preceding frame — the old code dropped the rotation outright in
		// that case while still applying the translate.
		const pivot = bulkPivotRef.current ?? bulkPivotLive;
		bulkPivotRef.current = null;
		if (!onChange) return;
		if (isIdentityDelta(delta)) return;
		const next = transform(
			data,
			bulkRefs,
			toTransformDelta(delta, pivot),
			trafficDataResolver,
		);
		if (next !== data) onChange(next);
	}, [data, onChange, bulkRefs, bulkPivotLive]);

	const handleGizmoCancel = useCallback(() => {
		setDragDelta(null);
		bulkPivotRef.current = null;
	}, []);

	// HTML siblings — registered into the chrome's slot.
	const htmlNode = useMemo(
		() => (
			<>
				<MarqueeSelector
					bridge={cameraBridge}
					far={50000}
					onMarquee={handleMarquee}
					hintIdle="press B to box-select static vehicles"
				/>
				{hasPvsGrid && (
					<label
						style={{
							position: 'absolute', top: 8, right: 8,
							background: 'rgba(0,0,0,0.7)', color: '#cdd', padding: '4px 8px',
							borderRadius: 4, fontSize: 11, fontFamily: 'monospace',
							display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
							userSelect: 'none', pointerEvents: 'auto',
						}}
					>
						<input
							type="checkbox"
							checked={showPvsGrid}
							onChange={(e) => setShowPvsGrid(e.target.checked)}
							style={{ margin: 0 }}
						/>
						PVS grid ({data.pvs.muNumCells_X}×{data.pvs.muNumCells_Z})
					</label>
				)}
			</>
		),
		[handleMarquee, hasPvsGrid, showPvsGrid, data.pvs.muNumCells_X, data.pvs.muNumCells_Z],
	);
	// Drop our marquee + PVS toggle when this overlay isn't the focused
	// resource — see ADR-0007 / issue #24.
	useWorldViewportHtmlSlot(isActive ? htmlNode : null);

	if (hulls.length === 0) return null;

	return (
		<>
			<FocusOnVehicle hulls={hulls} selected={selected} />

			<PickingPlane
				hulls={hulls}
				center={center}
				radius={radius}
				onSelect={handleSelect}
				pvs={hasPvsGrid ? data.pvs : null}
				pvsActive={showPvsGrid && hasPvsGrid}
				onHoverCell={handleHoverCell}
			/>

			<AllLaneConnections hulls={hulls} activeHullIndex={activeHullIndex} />
			<AllRungLines hulls={hulls} activeHullIndex={activeHullIndex} />

			{selectedHull && selectedSectionIndex >= 0 && (
				<SectionHighlight hull={selectedHull} sectionIndex={selectedSectionIndex} />
			)}

			<AllJunctionInstances
				hulls={hulls}
				activeHullIndex={activeHullIndex}
				selected={selected}
				onSelect={handleSelect}
			/>

			<AllLightTriggerInstances
				hulls={hulls}
				activeHullIndex={activeHullIndex}
				onSelect={handleSelect}
			/>

			<AllStaticVehicleInstances
				hulls={hulls}
				activeHullIndex={activeHullIndex}
				selected={selected}
				onSelect={handleSelect}
			/>
			<SelectedVehicleOutline hulls={hulls} selected={selected} />

			{activeTab === 'lights' && <TrafficLightInstances data={data} />}

			{showPvsGrid && hasPvsGrid && (
				<>
					<PvsGridOverlay
						pvs={data.pvs}
						hulls={hulls}
						selected={selected}
					/>
					<PvsCellTooltip
						pvs={data.pvs}
						hoverCellIndex={hoverCellIndex}
						hoverWorld={hoverWorld}
					/>
				</>
			)}

			<SelectionLabel hulls={hulls} selected={selected} />

			{onChange && gizmoPosition && (
				<BulkTransformGizmo
					position={gizmoPosition}
					axes={gizmoAxes}
					onTransform={handleGizmoTransform}
					onCommit={handleGizmoCommit}
					onCancel={handleGizmoCancel}
				/>
			)}

			<CameraBridge bridge={cameraBridge} />
		</>
	);
};
