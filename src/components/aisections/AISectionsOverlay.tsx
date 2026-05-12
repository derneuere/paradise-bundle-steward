// AISectionsOverlay — WorldViewport overlay for the V12 AISections resource.
//
// Renders ~8780 sections as one batched fill+outline mesh (2 draw calls)
// with face-index → section picking. The currently-selected section gets a
// detail layer: portals as cyan spheres, boundary lines as red segments,
// noGo lines as orange segments, portal-link lines as dashed cyan, and
// edge handles for in-scene drag/duplicate ops. A translate gizmo and
// corner handles live above the selected section for in-scene editing,
// emitting through the optional `onChange` prop.
//
// Selection currency is the schema NodePath (ADR-0001). The overlay matches:
//   - ['sections', i]                                       → section
//   - ['sections', i, 'portals', p]                         → portal
//   - ['sections', i, 'portals', p, 'boundaryLines', l]     → boundary line
//   - ['sections', i, 'noGoLines', l]                       → no-go line
//
// DOM siblings of the Canvas (snap toggle, marquee rectangle, edge
// right-click context menu) ride the WorldViewport chrome's HTML slot —
// see `useWorldViewportHtmlSlot()` in `./WorldViewport.tsx`. The marquee
// pairs an inside-Canvas `<CameraBridge>` with the DOM rectangle so the
// latter can read camera state.
//
// 3D primitives (BatchedSections, SelectionOverlay, SectionLabel,
// EdgeHandles, EdgeContextMenu) live in `@/components/aisections/shared`
// so the V4/V6 read-only overlay consumes the same code path — bug fixes
// land in both at once. See issue #35.

import { useMemo, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import type { ParsedAISectionsV12, AISection } from '@/lib/core/aiSections';
import { SectionSpeed } from '@/lib/core/aiSections';
import { duplicateSectionThroughEdge } from '@/lib/core/aiSectionsOps';
import { resolveSectionYs } from '@/lib/core/aiSectionY';
import { BulkTransformGizmo } from '@/components/common/three/BulkTransformGizmo';
import { CameraBridge, type CameraBridgeData } from '@/components/common/three/CameraBridge';
import {
	aiSectionsV12SelectionCodec,
	BatchedSections,
	buildBatchedSections,
	BulkSectionLayer,
	CascadeNeighbourLayer,
	HoverSectionLayer,
	markerToSelection,
	OverlayHtmlSiblings,
	SelectedSectionLayer,
	selectionToMarker,
	edgeContextMenuRootStyle as sharedEdgeContextMenuRootStyle,
	type AISectionMarker,
	type DisplayPortal,
	type DisplayBoundaryLine,
	type SectionAccessor,
	type SectionDetailAccessor,
} from '@/components/aisections/shared';
import { useAISectionsBulk } from '@/components/workspace/AISectionsBulkProvider';
import { useCrossBundleBulkController } from '@/components/workspace/useCrossBundleBulkController';
import { useWorkspacePSLBulk } from '@/components/workspace/PSLBulkProvider';
import {
	useBatchedSelection,
	type Selection,
} from '@/components/schema-editor/viewports/selection';
import type { ThreeEvent } from '@react-three/fiber';
import type { NodePath } from '@/lib/schema/walk';
import type { WorldOverlayComponent } from '@/components/schema-editor/viewports/WorldViewport.types';
import { v12Corners } from './aiSectionsPreview';
import { CornerPickers } from './CornerPickers';
import { useAISectionsBulkTransform } from './useAISectionsBulkTransform';

// ---------------------------------------------------------------------------
// Path ↔ Selection codec — re-exported from the shared module so V12 and V4/V6
// stay in lock-step. The `*PathMarker` / `*MarkerPath` aliases below preserve
// the legacy `{ kind, sectionIndex, portalIndex, ... }` shape for tests and
// callers that haven't moved to the new Selection currency yet.
// ---------------------------------------------------------------------------

export type { AISectionMarker };
export const aiSectionSelectionCodec = aiSectionsV12SelectionCodec;

export function aiSectionPathMarker(path: NodePath): AISectionMarker {
	return selectionToMarker(aiSectionsV12SelectionCodec.pathToSelection(path));
}

export function aiSectionMarkerPath(m: AISectionMarker): NodePath {
	const sel = markerToSelection(m);
	if (!sel) return [];
	return aiSectionsV12SelectionCodec.selectionToPath(sel);
}

/**
 * Re-export for the regression test pinned in `AISectionsOverlay.test.ts`.
 * The implementation lives in `@/components/aisections/shared/EdgeContextMenu`.
 */
export const edgeContextMenuRootStyle = sharedEdgeContextMenuRootStyle;

// ---------------------------------------------------------------------------
// V12 → shared adapters
// ---------------------------------------------------------------------------

const SPEED_COLORS_RGB: Record<number, readonly [number, number, number]> = {
	[SectionSpeed.E_SECTION_SPEED_VERY_SLOW]: [0.2, 0.4, 0.8],
	[SectionSpeed.E_SECTION_SPEED_SLOW]: [0.27, 0.67, 0.53],
	[SectionSpeed.E_SECTION_SPEED_NORMAL]: [0.53, 0.73, 0.27],
	[SectionSpeed.E_SECTION_SPEED_FAST]: [0.8, 0.53, 0.2],
	[SectionSpeed.E_SECTION_SPEED_VERY_FAST]: [0.8, 0.2, 0.2],
};
const FALLBACK_RGB: readonly [number, number, number] = [0.4, 0.4, 0.4];

// V12 stores corners as `Vector2` where `y` is the world Z axis (the ground
// plane is XZ). The shared primitives speak `Corner = { x, z }`, so this
// adapter pins the y→z projection in one place.
const v12Accessor: SectionAccessor<AISection> = {
	cornerCount: (s) => s.corners.length,
	cornerX: (s, i) => s.corners[i].x,
	cornerZ: (s, i) => s.corners[i].y,
	color: (s) => SPEED_COLORS_RGB[s.speed] ?? FALLBACK_RGB,
};

const SPEED_LABEL = ['VSLOW', 'SLOW', 'NORM', 'FAST', 'VFAST'];

const EMPTY_BULK_SET: ReadonlySet<string> = new Set();

// ---------------------------------------------------------------------------
// V12 → SectionDetail accessor
//
// The V12 storage shape:
//   - portal.position is a Vector3 already (xyz)
//   - portal.boundaryLines: Vector4 (start XZ, end XZ) — same display shape
//   - section.corners: Vector2[] where `y` is the world Z axis
//   - sectionYs is a parallel `ArrayLike<number>` resolved off the V12 model
//     (see issue #27 — portal Ys + BFS through the section graph for portal-
//     less sections). Captured by closure in `makeV12Accessor`.
// ---------------------------------------------------------------------------

function makeV12Accessor(sectionYs: ArrayLike<number>): SectionDetailAccessor<AISection, ParsedAISectionsV12> {
	return {
		portals: (s) =>
			s.portals.map<DisplayPortal>((p) => ({
				position: { x: p.position.x, y: p.position.y, z: p.position.z },
				linkSection: p.linkSection,
				boundaryLines: p.boundaryLines as readonly DisplayBoundaryLine[],
			})),
		noGoLines: (s) => s.noGoLines as readonly DisplayBoundaryLine[],
		sectionAt: (root, idx) => {
			if (idx < 0 || idx >= root.sections.length) return null;
			const target = root.sections[idx];
			// Need at least 4 corners to compute a centre between
			// `corners[0]` and `corners[2]` — V12 always emits quads, but
			// synthetic test fixtures occasionally ship triangles.
			if (target.corners.length < 4) return null;
			return target;
		},
		centreOf: (root, idx) => {
			if (idx < 0 || idx >= root.sections.length) return null;
			const target = root.sections[idx];
			if (target.corners.length < 4) return null;
			const y = idx < sectionYs.length ? sectionYs[idx] : 0;
			return {
				x: (target.corners[0].x + target.corners[2].x) / 2,
				y,
				z: (target.corners[0].y + target.corners[2].y) / 2,
			};
		},
	};
}

// ---------------------------------------------------------------------------
// Overlay
// ---------------------------------------------------------------------------

// Drag state — see `./aiSectionsDrag.types.ts`. One gesture commits as
// one Workspace-undo entry (CONTEXT.md / "Bulk transform"). All drag
// flavours flow through the same `BulkTransformGizmo` per ADR-0010; per
// ADR-0009 none of these cascade by default.

type Props = {
	data: ParsedAISectionsV12;
	selectedPath: NodePath;
	onSelect: (path: NodePath) => void;
	onChange?: (next: ParsedAISectionsV12) => void;
	/** True when this overlay owns the active selection — gates tool registration. */
	isActive?: boolean;
	/** Bundle / instance identity, supplied by `WorldViewportComposition` so
	 *  the overlay can resolve "MY bulk" via `forInstance(bundleId, index)`.
	 *  Optional so legacy per-resource pages still mount cleanly. */
	bundleId?: string;
	index?: number;
};

export const AISectionsOverlay: WorldOverlayComponent<ParsedAISectionsV12> = ({
	data, selectedPath, onSelect, onChange, isActive = true, bundleId, index,
}: Props) => {
	const [hoverSectionIndex, setHoverSectionIndex] = useState<number | null>(null);

	const cameraBridge = useRef<CameraBridgeData | null>(null);
	const aiBulk = useAISectionsBulk();
	// Cross-Bundle bulk controller (issue #80). Dormant for single-Bundle
	// bulks; for cross-Bundle gestures it owns the pivot, the commit
	// dispatch (one multi-Bundle HistoryCommit), and the marquee fan-out.
	const crossBundle = useCrossBundleBulkController();
	const sectionBulk = useMemo(() => {
		if (!aiBulk || bundleId == null || index == null) return null;
		return aiBulk.forInstance(bundleId, index);
	}, [aiBulk, bundleId, index]);
	// PSL bulk (issue #82). Drives the "N polygon soups not transformed"
	// hint; null when no PSL instance is active.
	const pslBulk = useWorkspacePSLBulk();
	const skippedSoupCount = pslBulk?.soupCount ?? 0;

	const marker = useMemo(() => aiSectionPathMarker(selectedPath), [selectedPath]);
	const selectedSectionIndex = marker ? marker.sectionIndex : null;

	// Per-section ground Y (issue #27). Derived once per data change —
	// the hot path is `previewModel`-driven re-renders during a drag,
	// which never change `data.sections`.
	const sectionYs = useMemo(() => resolveSectionYs(data), [data]);

	const useCrossBundlePath = crossBundle.isCrossBundle;

	// --- V12 transform state machine — see `./useAISectionsBulkTransform`. ---
	const t = useAISectionsBulkTransform({
		data,
		marker,
		selectedSectionIndex,
		sectionBulk,
		isActive,
		bundleId,
		index,
		crossBundle,
		useCrossBundlePath,
		onChange,
		onSelectMarkerPath: onSelect,
		markerToPath: aiSectionMarkerPath,
		sectionYs,
	});

	const scene = useMemo(
		() => buildBatchedSections(data.sections, v12Accessor, sectionYs),
		[data.sections, sectionYs],
	);

	const hovSection = hoverSectionIndex != null ? data.sections[hoverSectionIndex] ?? null : null;
	const selectedSectionY =
		selectedSectionIndex != null && selectedSectionIndex < sectionYs.length
			? sectionYs[selectedSectionIndex]
			: 0;
	const hoverSectionY =
		hoverSectionIndex != null && hoverSectionIndex < sectionYs.length
			? sectionYs[hoverSectionIndex]
			: 0;

	const hovCorners = useMemo(
		() => (hovSection ? v12Corners(hovSection) : null),
		[hovSection],
	);

	const detailAccessor = useMemo(() => makeV12Accessor(sectionYs), [sectionYs]);

	// 3D click on a section. Branches on Ctrl/Shift modifiers:
	//   - Ctrl/Cmd: toggle the clicked section in the bulk Set; do NOT move
	//               the inspector. The user is curating a multi-selection.
	//   - Shift:    extend the bulk range from the inspector's current
	//               anchor to the clicked section, then advance the
	//               inspector so subsequent shifts extend outward.
	//   - Plain:    navigate the inspector; do NOT touch the bulk.
	const handleSectionClick = useCallback(
		(sel: Selection, e: ThreeEvent<MouseEvent>) => {
			const sectionIdx = sel.indices[0];
			const ne = e.nativeEvent as MouseEvent | undefined;
			const ctrl = (ne?.ctrlKey || ne?.metaKey) ?? false;
			const shift = ne?.shiftKey ?? false;
			if (ctrl) {
				sectionBulk?.onToggleSection(sectionIdx);
				return;
			}
			if (shift) {
				sectionBulk?.onRangeSection(selectedSectionIndex, sectionIdx);
				onSelect(aiSectionMarkerPath({ kind: 'section', sectionIndex: sectionIdx }));
				return;
			}
			onSelect(aiSectionMarkerPath({ kind: 'section', sectionIndex: sectionIdx }));
		},
		[sectionBulk, selectedSectionIndex, onSelect],
	);

	const handleSectionHover = useCallback(
		(sel: Selection | null) => {
			setHoverSectionIndex(sel ? sel.indices[0] : null);
		},
		[],
	);

	const faceToSectionMap = scene.faceToSection;
	const hoveredSelection: Selection | null = useMemo(
		() => (hoverSectionIndex != null
			? { kind: 'section', indices: [hoverSectionIndex] }
			: null),
		[hoverSectionIndex],
	);
	const primarySelection: Selection | null = useMemo(
		() => (selectedSectionIndex != null
			? { kind: 'section', indices: [selectedSectionIndex] }
			: null),
		[selectedSectionIndex],
	);
	// `applyColor` is intentionally a no-op: selection visuals for AI Sections
	// flow through the sibling overlays (SelectedSectionLayer / HoverSectionLayer /
	// BulkSectionLayer / CascadeNeighbourLayer) rather than per-vertex paint on
	// the merged BatchedSections geometry. Stay-partial is tracked in #49 and
	// documented at the noopApplyColor site in `AISectionsLegacyOverlay.tsx`.
	const noopApplyColor = useCallback(() => {}, []);
	const faceToEntity = useCallback(
		(face: number) =>
			face >= 0 && face < faceToSectionMap.length ? faceToSectionMap[face] : -1,
		[faceToSectionMap],
	);
	const handlers = useBatchedSelection({
		kind: 'section',
		count: data.sections.length,
		primary: primarySelection,
		bulk: sectionBulk?.bulkSet ?? EMPTY_BULK_SET,
		hovered: hoveredSelection,
		faceToEntity,
		applyColor: noopApplyColor,
		onPick: handleSectionClick,
		onHover: handleSectionHover,
	});

	// Sub-entity pickers — emit the deeper marker shape so the bulk-transform
	// gizmo anchors at the corner / endpoint. Endpoints are addressed by the
	// (lineIdx, endIdx) pair; endIdx ∈ {0, 1} picks verts.(x,y) vs verts.(z,w).
	const handlePickPortal = useCallback((portalIndex: number) => {
		if (selectedSectionIndex == null) return;
		onSelect(aiSectionMarkerPath({ kind: 'portal', sectionIndex: selectedSectionIndex, portalIndex }));
	}, [onSelect, selectedSectionIndex]);

	const handlePickBoundaryLine = useCallback((portalIndex: number, lineIndex: number) => {
		if (selectedSectionIndex == null) return;
		onSelect(aiSectionMarkerPath({ kind: 'boundaryLine', sectionIndex: selectedSectionIndex, portalIndex, lineIndex }));
	}, [onSelect, selectedSectionIndex]);

	const handlePickNoGoLine = useCallback((lineIndex: number) => {
		if (selectedSectionIndex == null) return;
		onSelect(aiSectionMarkerPath({ kind: 'noGoLine', sectionIndex: selectedSectionIndex, lineIndex }));
	}, [onSelect, selectedSectionIndex]);

	const handlePickCorner = useCallback((cornerIndex: number) => {
		if (selectedSectionIndex == null) return;
		onSelect(aiSectionMarkerPath({
			kind: 'corner',
			sectionIndex: selectedSectionIndex,
			cornerIndex,
		}));
	}, [onSelect, selectedSectionIndex]);

	const handlePickBoundaryLineEndpoint = useCallback(
		(portalIndex: number, lineIndex: number, endIndex: number) => {
			if (selectedSectionIndex == null) return;
			onSelect(aiSectionMarkerPath({
				kind: 'boundaryLineEndpoint',
				sectionIndex: selectedSectionIndex,
				portalIndex,
				lineIndex,
				endIndex,
			}));
		},
		[onSelect, selectedSectionIndex],
	);

	const handlePickNoGoLineEndpoint = useCallback(
		(lineIndex: number, endIndex: number) => {
			if (selectedSectionIndex == null) return;
			onSelect(aiSectionMarkerPath({
				kind: 'noGoLineEndpoint',
				sectionIndex: selectedSectionIndex,
				lineIndex,
				endIndex,
			}));
		},
		[onSelect, selectedSectionIndex],
	);

	const handleEdgeContextMenu = useCallback(
		(edgeIdx: number, screenX: number, screenY: number) => {
			if (selectedSectionIndex == null) return;
			t.setEdgeMenu({
				x: screenX,
				y: screenY,
				sectionIndex: selectedSectionIndex,
				edgeIdx,
			});
		},
		[selectedSectionIndex, t],
	);

	const handleDuplicateThroughEdge = useCallback(() => {
		if (!t.edgeMenu || !onChange) return;
		const next = duplicateSectionThroughEdge(data, t.edgeMenu.sectionIndex, t.edgeMenu.edgeIdx);
		onChange(next);
		const dupIdx = next.sections.length - 1;
		// Defer selection so it lands on the post-update model — avoids a
		// brief flash where the inspector points at the new index but the
		// model still has the old length.
		requestAnimationFrame(() => {
			onSelect(aiSectionMarkerPath({ kind: 'section', sectionIndex: dupIdx }));
		});
		t.setEdgeMenu(null);
	}, [data, t, onChange, onSelect]);

	// Marquee (issue #80 cross-Bundle): delegates to the workspace-level
	// dispatcher so a rectangle spanning N Bundles hits every loaded +
	// visible AI sections instance. Invisible Bundles are filtered out by
	// the controller's per-instance visibility check.
	const handleMarquee = useCallback(
		(frustum: THREE.Frustum, mode: 'add' | 'remove') => {
			crossBundle.marqueeDispatch(frustum, mode);
		},
		[crossBundle],
	);

	return (
		<>
			<BatchedSections
				scene={scene}
				onClick={handlers.onClick}
				onPointerMove={handlers.onPointerMove}
				onPointerOut={handlers.onPointerOut}
			/>

			{/* Hover blue outline + grey label. Caller gates "hover != selected"
			    so HoverSectionLayer doesn't need to know about the inspector
			    pick — cheaper than threading another prop through. */}
			{hovCorners && hovSection && hoverSectionIndex != null && hoverSectionIndex !== selectedSectionIndex && (
				<HoverSectionLayer
					corners={hovCorners}
					baseY={hoverSectionY}
					labelText={`Sec ${hoverSectionIndex} | 0x${(hovSection.id >>> 0).toString(16).toUpperCase()} | ${SPEED_LABEL[hovSection.speed] ?? hovSection.speed}`}
				/>
			)}

			{/* Yellow outline + structural detail for every bulk member that
			    isn't the inspector pick. The "leave portals on screen" fix:
			    bulk members render with `marker={null}` so structural geometry
			    shows but no sub-entity highlights. */}
			{sectionBulk && (
				<BulkSectionLayer
					bulkSet={sectionBulk.bulkSet}
					selectedSectionIndex={selectedSectionIndex}
					data={data}
					previewModel={t.previewModel}
					dragKind={t.drag?.target.kind ?? null}
					sections={data.sections}
					cornersOf={v12Corners}
					accessor={detailAccessor}
					root={data}
					sectionYs={sectionYs}
				/>
			)}

			{/* Cascade-affected outside neighbours during a drag (orange).
			    Bulk members are pre-filtered out of `affectedNeighbours`. */}
			<CascadeNeighbourLayer
				drag={t.drag}
				affectedNeighbours={t.affectedNeighbours}
				sectionYs={sectionYs}
			/>

			{/* Inspector pick — orange outline, label, edge handles, and
			    SectionDetail with the marker so the picked portal / line /
			    endpoint gets its highlight. */}
			{selectedSectionIndex != null && t.previewSection && t.previewCorners && (
				<SelectedSectionLayer
					corners={t.previewCorners}
					section={t.previewSection}
					baseY={selectedSectionY}
					marker={marker}
					root={data}
					accessor={detailAccessor}
					labelText={`Sec ${selectedSectionIndex} | 0x${(t.previewSection.id >>> 0).toString(16).toUpperCase()} | ${SPEED_LABEL[t.previewSection.speed] ?? t.previewSection.speed}`}
					hoveredEdge={t.hoveredEdge}
					onHoverEdge={t.setHoveredEdge}
					onContextMenu={handleEdgeContextMenu}
					onPickPortal={handlePickPortal}
					onPickBoundaryLine={handlePickBoundaryLine}
					onPickNoGoLine={handlePickNoGoLine}
					onPickBoundaryLineEndpoint={handlePickBoundaryLineEndpoint}
					onPickNoGoLineEndpoint={handlePickNoGoLineEndpoint}
				/>
			)}

			{/* Corner picker spheres — click-to-select; the gizmo handles
			    the drag once a corner is selected (per ADR-0010 / issue #73). */}
			{t.previewSection && t.previewCorners && selectedSectionIndex != null && (
				<CornerPickers
					corners={t.previewCorners}
					baseY={selectedSectionY}
					selectedCornerIdx={marker?.kind === 'corner' ? marker.cornerIndex : null}
					onPick={handlePickCorner}
				/>
			)}

			{/* Gizmo gates on `isActive` so cross-Bundle gestures show
			    exactly one gizmo on screen (per ADR-0010). */}
			{isActive && t.gizmoPosition && (
				<BulkTransformGizmo
					position={t.gizmoPosition}
					pixelSize={t.gizmoPixelSize}
					axes={t.gizmoAxes}
					onTransform={t.handleGizmoTransform}
					onCommit={t.handleGizmoCommit}
					onCancel={t.handleGizmoCancel}
					// Pivot drag-reposition is bulk-only for now (issue #76).
					// Sub-entity gizmos keep the legacy fixed-pivot behaviour
					// (their pivot IS the entity position).
					onPivotMove={t.isBulkActive ? t.handlePivotMove : undefined}
					onPivotCommit={t.isBulkActive ? t.handlePivotCommit : undefined}
					onPivotCancel={t.isBulkActive ? t.handlePivotCancel : undefined}
				/>
			)}

			{/* CameraBridge mirrors camera state out to the marquee selector
			    living in the DOM sibling slot. Lives inside Canvas so it can
			    read three-fiber's per-frame state. */}
			<CameraBridge bridge={cameraBridge} />

			{/* DOM siblings — registered into the WorldViewport chrome's HTML
			    slot, outside Canvas to avoid cross-reconciler portal quirks. */}
			<OverlayHtmlSiblings
				isActive={isActive}
				snapEnabled={t.snapEnabled}
				toggleSnap={t.toggleSnap}
				cascadeEnabled={t.cascadeEnabled}
				toggleCascade={t.toggleCascade}
				cameraBridge={cameraBridge}
				onMarquee={handleMarquee}
				edgeMenu={t.edgeMenu}
				onDuplicateThroughEdge={handleDuplicateThroughEdge}
				onCloseEdgeMenu={() => t.setEdgeMenu(null)}
				// Cascade hint renders for in-flight gestures whose effective
				// cascade is ON — section-scope and bulk only (sub-entity
				// gizmo paths don't dispatch cascade-on ops yet). Reads
				// `drag.target.kind` (the discriminator lives on the target,
				// not on `drag` — earlier code shipped with `drag?.kind`
				// which silently never matched).
				cascadeActive={
					t.drag != null &&
					t.drag.delta.cascade === true &&
					(t.drag.target.kind === 'section' || t.drag.target.kind === 'bulk')
				}
				skippedSoupCount={skippedSoupCount}
				showSkippedSoupHint={t.gizmoPosition != null && skippedSoupCount > 0}
			/>
		</>
	);
};

