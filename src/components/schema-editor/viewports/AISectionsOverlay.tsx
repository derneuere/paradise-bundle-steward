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
import { Magnet } from 'lucide-react';
import { Copy } from 'lucide-react';
import { useToggleHotkey } from '@/hooks/useToggleHotkey';
import { useResetOnChange } from '@/hooks/useResetOnChange';
import * as THREE from 'three';
import type { ParsedAISectionsV12, AISection } from '@/lib/core/aiSections';
import { SectionSpeed } from '@/lib/core/aiSections';
import {
	duplicateSectionThroughEdge,
	snapCornerOffset,
	snapSectionOffset,
	translateCornerWithShared,
	translateSectionWithLinks,
} from '@/lib/core/aiSectionsOps';
import { resolveSectionYs } from '@/lib/core/aiSectionY';
import { TranslateGizmo, type GizmoOffset } from '@/components/common/three/TranslateGizmo';
import { CameraBridge, type CameraBridgeData } from '@/components/common/three/CameraBridge';
import { MarqueeSelector } from '@/components/common/three/MarqueeSelector';
import { CornerHandles, type CornerDragOffset } from '@/components/aisections/CornerHandles';
import {
	aiSectionsV12SelectionCodec,
	BatchedSections,
	buildBatchedSections,
	EdgeContextMenu,
	EdgeHandles,
	markerToSelection,
	SectionDetail,
	SectionLabel,
	SelectionOverlay,
	selectionToMarker,
	edgeContextMenuRootStyle as sharedEdgeContextMenuRootStyle,
	type AISectionMarker,
	type Corner,
	type DisplayPortal,
	type DisplayBoundaryLine,
	type SectionAccessor,
	type SectionDetailAccessor,
} from '@/components/aisections/shared';
import { useAISectionsBulk } from '@/components/workspace/AISectionsBulkProvider';
import {
	useBatchedSelection,
	selectionKey,
	type Selection,
} from '@/components/schema-editor/viewports/selection';
import type { ThreeEvent } from '@react-three/fiber';
import type { NodePath } from '@/lib/schema/walk';
import type { WorldOverlayComponent } from './WorldViewport.types';
import { useWorldViewportHtmlSlot } from './WorldViewport';

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

function v12Corners(section: AISection): Corner[] {
	return section.corners.map((c) => ({ x: c.x, z: c.y }));
}

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

// While a drag is in flight we keep the live offset in local state so the
// underlying model isn't touched until release — one drag commits as one
// undo entry. Two distinct drag flavours can be active (the gizmo translates
// the whole section; the corner handles deform the polygon), so we model it
// as a discriminated union with mutual exclusion.
type ActiveDrag =
	| { kind: 'section'; offset: GizmoOffset }
	| { kind: 'corner'; cornerIdx: number; offset: CornerDragOffset };

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
	const [hoveredEdge, setHoveredEdge] = useState<number | null>(null);
	const [edgeMenu, setEdgeMenu] = useState<
		{ x: number; y: number; sectionIndex: number; edgeIdx: number } | null
	>(null);
	const [drag, setDrag] = useState<ActiveDrag | null>(null);
	const [snapEnabled, setSnapEnabled] = useState(false);

	const cameraBridge = useRef<CameraBridgeData | null>(null);
	const aiBulk = useAISectionsBulk();
	// Resolve "this overlay's bulk" via the workspace bulk's per-instance
	// lookup. When `bundleId`/`index` are missing (legacy single-resource
	// page route) we synthesise an empty handle so the rest of the overlay
	// reads as "no bulk active".
	const sectionBulk = useMemo(() => {
		if (!aiBulk || bundleId == null || index == null) return null;
		return aiBulk.forInstance(bundleId, index);
	}, [aiBulk, bundleId, index]);

	const marker = useMemo(() => aiSectionPathMarker(selectedPath), [selectedPath]);
	const selectedSectionIndex = marker ? marker.sectionIndex : null;

	// Snap radius scales with the scene — for a typical AI bundle (~200 units
	// radius) this lands at ~4 units which feels right when sections are
	// 10–30 units across. Recomputed when the data changes.
	const snapRadius = useMemo(() => {
		if (data.sections.length === 0) return 0.5;
		const box = new THREE.Box3();
		for (const sec of data.sections) {
			for (const c of sec.corners) box.expandByPoint(new THREE.Vector3(c.x, 0, c.y));
		}
		const sphere = new THREE.Sphere();
		box.getBoundingSphere(sphere);
		return Math.max(sphere.radius * 0.02, 0.5);
	}, [data]);

	// `S` toggles snap mode.
	useToggleHotkey('s', setSnapEnabled);

	// Per-section ground Y (issue #27). Derived once per data change from
	// portal Ys plus a BFS through the section graph for portal-less sections.
	// Memoised here so the renderer doesn't re-walk all 8.7k V12 sections on
	// every frame — the hot path is `previewModel`-driven re-renders during a
	// drag, which never change `data.sections`.
	const sectionYs = useMemo(() => resolveSectionYs(data), [data]);

	const scene = useMemo(
		() => buildBatchedSections(data.sections, v12Accessor, sectionYs),
		[data.sections, sectionYs],
	);

	const selSection = selectedSectionIndex != null ? data.sections[selectedSectionIndex] ?? null : null;
	const hovSection = hoverSectionIndex != null ? data.sections[hoverSectionIndex] ?? null : null;
	const selectedSectionY =
		selectedSectionIndex != null && selectedSectionIndex < sectionYs.length
			? sectionYs[selectedSectionIndex]
			: 0;
	const hoverSectionY =
		hoverSectionIndex != null && hoverSectionIndex < sectionYs.length
			? sectionYs[hoverSectionIndex]
			: 0;

	// While a drag is in flight, run the relevant op on the live offset to
	// derive a preview model. Used for the selection overlay on the source
	// AND for highlighted neighbours that the smart-cascade affects, so the
	// user sees the move in real time.
	const previewModel: ParsedAISectionsV12 | null = useMemo(() => {
		if (selectedSectionIndex == null || !selSection || !drag) return null;
		if (drag.offset.x === 0 && drag.offset.z === 0) return null;
		try {
			if (drag.kind === 'section') {
				return translateSectionWithLinks(data, selectedSectionIndex, drag.offset);
			}
			return translateCornerWithShared(data, selectedSectionIndex, drag.cornerIdx, drag.offset);
		} catch {
			return null;
		}
	}, [data, selectedSectionIndex, selSection, drag]);

	const previewSection: AISection | null = useMemo(() => {
		if (!selSection) return null;
		if (!previewModel || selectedSectionIndex == null) return selSection;
		return previewModel.sections[selectedSectionIndex] ?? selSection;
	}, [selSection, previewModel, selectedSectionIndex]);

	const previewCorners = useMemo(
		() => (previewSection ? v12Corners(previewSection) : null),
		[previewSection],
	);
	const hovCorners = useMemo(
		() => (hovSection ? v12Corners(hovSection) : null),
		[hovSection],
	);

	const affectedNeighbours = useMemo(() => {
		if (!previewModel || selectedSectionIndex == null) return [];
		const out: { idx: number; corners: Corner[] }[] = [];
		for (let i = 0; i < previewModel.sections.length; i++) {
			if (i === selectedSectionIndex) continue;
			if (previewModel.sections[i] !== data.sections[i]) {
				out.push({ idx: i, corners: v12Corners(previewModel.sections[i]) });
			}
		}
		return out;
	}, [previewModel, selectedSectionIndex, data]);

	const gizmoPosition = useMemo<[number, number, number] | null>(() => {
		if (!previewSection || previewSection.corners.length === 0) return null;
		let sx = 0, sz = 0;
		for (const c of previewSection.corners) { sx += c.x; sz += c.y; }
		const n = previewSection.corners.length;
		return [sx / n, selectedSectionY + 1.5, sz / n];
	}, [previewSection, selectedSectionY]);

	const gizmoPixelSize = 90;
	const cornerHandlePixelSize = 12;

	const detailAccessor = useMemo(() => makeV12Accessor(sectionYs), [sectionYs]);

	// 3D click on a section. The hook forwards the raw event so we can branch
	// on Ctrl/Shift modifiers:
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

	// Hook-driven hover bridges into the existing `hoverSectionIndex` state
	// the SectionLabel + SelectionOverlay branches read from.
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

	// Drag handlers — the gizmo translates the section, corner handles deform
	// the polygon. Both go through the smart-cascade ops on commit and emit
	// the new root via onChange. Without onChange these are no-ops.
	const handleGizmoTranslate = useCallback((offset: GizmoOffset) => {
		const finalOffset =
			snapEnabled && selectedSectionIndex != null
				? snapSectionOffset(data, selectedSectionIndex, offset, snapRadius)
				: offset;
		setDrag({ kind: 'section', offset: finalOffset });
	}, [snapEnabled, selectedSectionIndex, data, snapRadius]);

	const handleGizmoCommit = useCallback((offset: GizmoOffset) => {
		setDrag(null);
		if (selectedSectionIndex == null || !onChange) return;
		if (offset.x === 0 && offset.z === 0) return;
		const finalOffset = snapEnabled
			? snapSectionOffset(data, selectedSectionIndex, offset, snapRadius)
			: offset;
		if (finalOffset.x === 0 && finalOffset.z === 0) return;
		onChange(translateSectionWithLinks(data, selectedSectionIndex, finalOffset));
	}, [data, selectedSectionIndex, snapEnabled, snapRadius, onChange]);

	const handleGizmoCancel = useCallback(() => setDrag(null), []);

	const handleCornerDrag = useCallback((cornerIdx: number, offset: CornerDragOffset) => {
		const finalOffset =
			snapEnabled && selectedSectionIndex != null
				? snapCornerOffset(data, selectedSectionIndex, cornerIdx, offset, snapRadius)
				: offset;
		setDrag({ kind: 'corner', cornerIdx, offset: finalOffset });
	}, [snapEnabled, selectedSectionIndex, data, snapRadius]);

	const handleCornerCommit = useCallback((cornerIdx: number, offset: CornerDragOffset) => {
		setDrag(null);
		if (selectedSectionIndex == null || !onChange) return;
		if (offset.x === 0 && offset.z === 0) return;
		const finalOffset = snapEnabled
			? snapCornerOffset(data, selectedSectionIndex, cornerIdx, offset, snapRadius)
			: offset;
		if (finalOffset.x === 0 && finalOffset.z === 0) return;
		onChange(translateCornerWithShared(data, selectedSectionIndex, cornerIdx, finalOffset));
	}, [data, selectedSectionIndex, snapEnabled, snapRadius, onChange]);

	const handleCornerCancel = useCallback(() => setDrag(null), []);

	// Reset transient edge / drag UI when the selected section changes.
	useResetOnChange(selectedSectionIndex, () => {
		setHoveredEdge(null);
		setEdgeMenu(null);
		setDrag(null);
	});

	const handleEdgeContextMenu = useCallback(
		(edgeIdx: number, screenX: number, screenY: number) => {
			if (selectedSectionIndex == null) return;
			setEdgeMenu({
				x: screenX,
				y: screenY,
				sectionIndex: selectedSectionIndex,
				edgeIdx,
			});
		},
		[selectedSectionIndex],
	);

	const handleDuplicateThroughEdge = useCallback(() => {
		if (!edgeMenu || !onChange) return;
		const next = duplicateSectionThroughEdge(data, edgeMenu.sectionIndex, edgeMenu.edgeIdx);
		onChange(next);
		const dupIdx = next.sections.length - 1;
		// Defer selection so it lands on the post-update model — avoids a
		// brief flash where the inspector points at the new index but the
		// model still has the old length.
		requestAnimationFrame(() => {
			onSelect(aiSectionMarkerPath({ kind: 'section', sectionIndex: dupIdx }));
		});
		setEdgeMenu(null);
	}, [data, edgeMenu, onChange, onSelect]);

	// Marquee wiring: pick AI sections whose corner-centroid is inside the
	// dragged rectangle and union/subtract their schema paths into the
	// workspace bulk. Sections store XY corners on the Y=0 ground plane
	// (height is implicit), so the centroid we project is (avgX, 0, avgY).
	// Routes through `sectionBulk.onApplyPaths` — the workspace-side bulk —
	// so the right-sidebar BulkPanelStack, the tree's amber rows, and the
	// persistent yellow-outline-with-portals overlay rendering all light up
	// in one dispatch.
	const handleMarquee = useCallback(
		(frustum: THREE.Frustum, mode: 'add' | 'remove') => {
			if (!sectionBulk) return;
			const hits: NodePath[] = [];
			const pt = new THREE.Vector3();
			for (let i = 0; i < data.sections.length; i++) {
				const corners = data.sections[i].corners;
				if (corners.length === 0) continue;
				let sx = 0, sy = 0;
				for (const c of corners) { sx += c.x; sy += c.y; }
				const n = corners.length;
				pt.set(sx / n, 0, sy / n);
				if (frustum.containsPoint(pt)) hits.push(['sections', i]);
			}
			if (hits.length === 0) return;
			sectionBulk.onApplyPaths(hits, mode);
		},
		[data, sectionBulk],
	);

	return (
		<>
			<BatchedSections
				scene={scene}
				onClick={handlers.onClick}
				onPointerMove={handlers.onPointerMove}
				onPointerOut={handlers.onPointerOut}
			/>

			{previewCorners && (
				<SelectionOverlay corners={previewCorners} color="#ffaa33" baseY={selectedSectionY} />
			)}
			{hovCorners && hoverSectionIndex !== selectedSectionIndex && (
				<SelectionOverlay corners={hovCorners} color="#66aaff" baseY={hoverSectionY} />
			)}

			{/* Yellow outline for every bulk member that ISN'T the inspector
			    pick. The inspector pick already wears the orange overlay
			    above; promoting it to yellow as well would hide the
			    "currently editing" cue. */}
			{sectionBulk && [...sectionBulk.bulkSet].map((key) => {
				const parts = key.split(':');
				if (parts[0] !== 'section') return null;
				const idx = Number(parts[1]);
				if (!Number.isFinite(idx) || idx === selectedSectionIndex) return null;
				const sec = data.sections[idx];
				if (!sec) return null;
				const corners = v12Corners(sec);
				const y = idx < sectionYs.length ? sectionYs[idx] : 0;
				return (
					<SelectionOverlay
						key={`bulk-${idx}`}
						corners={corners}
						color="#ffd633"
						baseY={y}
					/>
				);
			})}

			{drag && affectedNeighbours.map(({ idx, corners }) => (
				<SelectionOverlay
					key={`cascade-${idx}`}
					corners={corners}
					color="#ddaa66"
					baseY={idx < sectionYs.length ? sectionYs[idx] : 0}
				/>
			))}

			{previewCorners && previewSection && selectedSectionIndex != null && (
				<SectionLabel corners={previewCorners} color="#ffaa33" baseY={selectedSectionY}>
					Sec {selectedSectionIndex} | 0x{(previewSection.id >>> 0).toString(16).toUpperCase()} | {SPEED_LABEL[previewSection.speed] ?? previewSection.speed}
				</SectionLabel>
			)}
			{hovCorners && hovSection && hoverSectionIndex != null && hoverSectionIndex !== selectedSectionIndex && (
				<SectionLabel corners={hovCorners} color="#aaaaaa" baseY={hoverSectionY}>
					Sec {hoverSectionIndex} | 0x{(hovSection.id >>> 0).toString(16).toUpperCase()} | {SPEED_LABEL[hovSection.speed] ?? hovSection.speed}
				</SectionLabel>
			)}

			{/* Edge handles + sub-entity highlights for the inspector pick only.
			    Bulk members get the structural detail layer below but no edge
			    edit affordances — those are an inspector-only edit gesture. */}
			{selectedSectionIndex != null && previewSection && previewCorners && (
				<>
					<EdgeHandles
						corners={previewCorners}
						hoveredEdge={hoveredEdge}
						onHoverEdge={setHoveredEdge}
						onContextMenu={handleEdgeContextMenu}
						baseY={selectedSectionY}
					/>
					<SectionDetail
						section={previewSection}
						root={data}
						accessor={detailAccessor}
						marker={marker}
						baseY={selectedSectionY}
						onPickPortal={handlePickPortal}
						onPickBoundaryLine={handlePickBoundaryLine}
						onPickNoGoLine={handlePickNoGoLine}
					/>
				</>
			)}

			{/* Detail layer for every bulk member that isn't the inspector
			    pick. This is the "leave portals on screen at all times" fix
			    (the central reason for Slice 1). Bulk members render with
			    `marker={null}` so only structural geometry shows — no
			    portal-orange / boundary-line endpoint labels — keeping the
			    inspector's editing cues isolated to the one section the user
			    is actually editing. */}
			{sectionBulk && [...sectionBulk.bulkSet].map((key) => {
				const parts = key.split(':');
				if (parts[0] !== 'section') return null;
				const idx = Number(parts[1]);
				if (!Number.isFinite(idx) || idx === selectedSectionIndex) return null;
				const sec = data.sections[idx];
				if (!sec) return null;
				const y = idx < sectionYs.length ? sectionYs[idx] : 0;
				return (
					<SectionDetail
						key={`bulk-detail-${idx}`}
						section={sec}
						root={data}
						accessor={detailAccessor}
						marker={null}
						baseY={y}
					/>
				);
			})}

			{gizmoPosition && drag?.kind !== 'corner' && (
				<TranslateGizmo
					position={gizmoPosition}
					pixelSize={gizmoPixelSize}
					onTranslate={handleGizmoTranslate}
					onCommit={handleGizmoCommit}
					onCancel={handleGizmoCancel}
				/>
			)}

			{previewCorners && drag?.kind !== 'section' && (
				<CornerHandles
					corners={previewCorners}
					pixelSize={cornerHandlePixelSize}
					baseY={selectedSectionY}
					onDrag={handleCornerDrag}
					onCommit={handleCornerCommit}
					onCancel={handleCornerCancel}
				/>
			)}

			{/* CameraBridge mirrors camera state out to the marquee selector
			    living in the DOM sibling slot. Lives inside Canvas so it can
			    read three-fiber's per-frame state. */}
			<CameraBridge bridge={cameraBridge} />

			{/* DOM siblings — snap toggle, marquee rectangle, edge context
			    menu — registered into the chrome's HTML slot. The slot
			    renders these outside the Canvas in React-DOM-land, avoiding
			    cross-reconciler portal quirks. */}
			<HtmlSiblings
				isActive={isActive}
				snapEnabled={snapEnabled}
				toggleSnap={() => setSnapEnabled((v) => !v)}
				cameraBridge={cameraBridge}
				onMarquee={handleMarquee}
				edgeMenu={edgeMenu}
				onDuplicateThroughEdge={handleDuplicateThroughEdge}
				onCloseEdgeMenu={() => setEdgeMenu(null)}
			/>
		</>
	);
};

// HtmlSiblings ─ encapsulates the DOM-overlay JSX so the registration deps
// can be tracked precisely. The body is one big memoised JSX node passed to
// the chrome's slot; re-registers only when the snapshot of overlay state
// it captures actually changes.
function HtmlSiblings({
	isActive,
	snapEnabled,
	toggleSnap,
	cameraBridge,
	onMarquee,
	edgeMenu,
	onDuplicateThroughEdge,
	onCloseEdgeMenu,
}: {
	isActive: boolean;
	snapEnabled: boolean;
	toggleSnap: () => void;
	cameraBridge: React.MutableRefObject<CameraBridgeData | null>;
	onMarquee: (frustum: THREE.Frustum, mode: 'add' | 'remove') => void;
	edgeMenu: { x: number; y: number; sectionIndex: number; edgeIdx: number } | null;
	onDuplicateThroughEdge: () => void;
	onCloseEdgeMenu: () => void;
}) {
	const node = useMemo(
		() => (
			<>
				<MarqueeSelector
					bridge={cameraBridge}
					far={50000}
					onMarquee={onMarquee}
					hintIdle="press B to box-select AI sections"
				/>

				<button
					type="button"
					onClick={toggleSnap}
					title={snapEnabled
						? 'Snap to edges: ON (S to toggle)'
						: 'Snap to edges: OFF (S to toggle)'}
					aria-pressed={snapEnabled}
					style={{
						position: 'absolute',
						top: 8,
						left: 8,
						display: 'flex',
						alignItems: 'center',
						gap: 6,
						padding: '4px 8px',
						borderRadius: 6,
						fontSize: 11,
						fontFamily: 'monospace',
						border: '1px solid rgba(255,255,255,0.15)',
						background: snapEnabled ? 'rgba(80, 170, 110, 0.85)' : 'rgba(20, 22, 28, 0.85)',
						color: snapEnabled ? '#fff' : 'rgba(255,255,255,0.7)',
						cursor: 'pointer',
						userSelect: 'none',
						boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
						pointerEvents: 'auto',
					}}
				>
					<Magnet size={14} />
					<span>Snap{snapEnabled ? ' · on' : ' · off'}</span>
					<span style={{ opacity: 0.5, fontSize: 10 }}>S</span>
				</button>

				{edgeMenu && (
					<EdgeContextMenu
						x={edgeMenu.x}
						y={edgeMenu.y}
						edgeIdx={edgeMenu.edgeIdx}
						onClose={onCloseEdgeMenu}
					>
						<button
							type="button"
							className="w-full text-left flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground"
							onClick={onDuplicateThroughEdge}
						>
							<Copy className="h-3.5 w-3.5" />
							Duplicate section through this edge
						</button>
					</EdgeContextMenu>
				)}
			</>
		),
		[snapEnabled, toggleSnap, cameraBridge, onMarquee, edgeMenu, onDuplicateThroughEdge, onCloseEdgeMenu],
	);
	// Pass `null` when this overlay isn't the active resource so the chrome
	// drops our marquee / snap / context menu — see ADR-0007 / issue #24.
	useWorldViewportHtmlSlot(isActive ? node : null);
	return null;
}

export default AISectionsOverlay;
