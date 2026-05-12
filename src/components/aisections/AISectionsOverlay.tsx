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

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Magnet, Link2 } from 'lucide-react';
import { Copy } from 'lucide-react';
import { useToggleHotkey } from '@/hooks/useToggleHotkey';
import { useResetOnChange } from '@/hooks/useResetOnChange';
import * as THREE from 'three';
import type { ParsedAISectionsV12, AISection } from '@/lib/core/aiSections';
import { SectionSpeed } from '@/lib/core/aiSections';
import {
	bulkSelectionPivot,
	duplicateSectionThroughEdge,
	type AISectionEntityRef,
} from '@/lib/core/aiSectionsOps';
import { resolveSectionYs } from '@/lib/core/aiSectionY';
import { BulkTransformGizmo } from '@/components/common/three/BulkTransformGizmo';
import {
	type BulkTransformDelta,
	identityDelta,
	isIdentityDelta,
} from '@/hooks/useBulkTransformDrag';
import {
	useSetBulkTransformGizmoSession,
	type GizmoSession,
} from '@/components/workspace/BulkTransformGizmoSession';
import { CameraBridge, type CameraBridgeData } from '@/components/common/three/CameraBridge';
import { MarqueeSelector } from '@/components/common/three/MarqueeSelector';
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
import { useCrossBundleBulkController } from '@/components/workspace/useCrossBundleBulkController';
import { useWorkspacePSLBulk } from '@/components/workspace/PSLBulkProvider';
import {
	useBatchedSelection,
	type Selection,
} from '@/components/schema-editor/viewports/selection';
import type { ThreeEvent } from '@react-three/fiber';
import type { NodePath } from '@/lib/schema/walk';
import type { WorldOverlayComponent } from '@/components/schema-editor/viewports/WorldViewport.types';
import { useWorldViewportHtmlSlot } from '@/components/schema-editor/viewports/WorldViewport';
import type { ActiveDrag, DragTarget } from './aiSectionsDrag.types';
import { applyDragToModel } from './applyDragToModel';
import {
	deriveAffectedNeighbours,
	derivePreviewCorners,
	derivePreviewModel,
	derivePreviewSection,
	v12Corners,
} from './aiSectionsPreview';
import {
	BULK_GIZMO_Y_OFFSET,
	deriveGizmoAxes,
	deriveGizmoPosition,
} from './aiSectionsGizmoGeometry';
import { CornerPickers } from './CornerPickers';

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
	const [hoveredEdge, setHoveredEdge] = useState<number | null>(null);
	const [edgeMenu, setEdgeMenu] = useState<
		{ x: number; y: number; sectionIndex: number; edgeIdx: number } | null
	>(null);
	const [drag, setDrag] = useState<ActiveDrag | null>(null);
	const [snapEnabled, setSnapEnabled] = useState(false);
	// Sticky cascade toggle (mirror of `snapEnabled`). When ON, every gizmo
	// gesture defaults to cascade-with-links — outside neighbour reverse-
	// portal anchors and shared corners drag along (the legacy
	// `translateSectionWithLinks` semantics from CONTEXT.md / ADR-0009).
	// The Shift modifier (`drag.delta.cascade`) still works as a per-gesture
	// **inverter**: toggle ON + Shift held → cascade OFF for that one
	// gesture (Blender-style "snap on by default, hold Shift for precision"
	// idiom). Effective cascade = `cascadeEnabled XOR drag.delta.cascade`.
	const [cascadeEnabled, setCascadeEnabled] = useState(false);
	// Pivot-override state is declared a few lines below alongside
	// `bulkPivotDragging` (issue #76 — the pivot-drag handle introduced it).
	// Issue #81's numeric panel reuses the same `bulkPivotOverride` slot, so
	// dragging and typing share one source of truth.
	const setSession = useSetBulkTransformGizmoSession();

	const cameraBridge = useRef<CameraBridgeData | null>(null);
	const aiBulk = useAISectionsBulk();
	// Cross-Bundle bulk controller — owns the workspace-wide view of every
	// (bundleId, index) bulk + the per-Bundle dispatch on commit (issue
	// #80). When the bulk lives in a single Bundle this is essentially
	// dormant (slices has at most one entry, isCrossBundle === false) and
	// the overlay falls through to the legacy single-Bundle commit path.
	// When the bulk spans 2+ Bundles, the gizmo anchors at the cross-
	// Bundle Pivot, the commit goes through `controller.commitDelta` (one
	// multi-Bundle HistoryCommit), and the marquee dispatch walks every
	// loaded + visible AI sections instance instead of just this overlay's.
	const crossBundle = useCrossBundleBulkController();
	// Resolve "this overlay's bulk" via the workspace bulk's per-instance
	// lookup. When `bundleId`/`index` are missing (legacy single-resource
	// page route) we synthesise an empty handle so the rest of the overlay
	// reads as "no bulk active".
	const sectionBulk = useMemo(() => {
		if (!aiBulk || bundleId == null || index == null) return null;
		return aiBulk.forInstance(bundleId, index);
	}, [aiBulk, bundleId, index]);
	// Workspace-wide PSL bulk handle (issue #82). The current Selection
	// model spans every workspace bulk that has entries — when the user
	// has marquee'd both AI sections AND polygon-soup polys, the gizmo
	// should still run on the AI sections but feed back a "N polygon
	// soups not transformed" hint so the soup membership isn't silently
	// dropped. Soup-only Selections are handled by the existing gizmo
	// suppression (no AI section entities → no gizmo); this read only
	// drives the hint copy + the soup-count partition. `null` when no
	// PSL instance is active.
	const pslBulk = useWorkspacePSLBulk();
	const skippedSoupCount = pslBulk?.soupCount ?? 0;

	const marker = useMemo(() => aiSectionPathMarker(selectedPath), [selectedPath]);
	const selectedSectionIndex = marker ? marker.sectionIndex : null;

	// Multi-Selection bulk refs (issue #74). The marquee populates
	// `sectionBulk.bulkSet` with whole-section keys; the inspector pick may
	// add a sub-entity. We flatten both into a single `AISectionEntityRef[]`
	// so the bulk ops can treat them uniformly. The bulk gizmo activates
	// when this list has 2+ distinct entries — at cardinality 1 we fall
	// through to the single-entity gizmo (anchored at the marker).
	const bulkRefs = useMemo<readonly AISectionEntityRef[]>(() => {
		const out: AISectionEntityRef[] = [];
		const seen = new Set<string>();
		if (sectionBulk) {
			for (const key of sectionBulk.bulkSet) {
				const parts = key.split(':');
				if (parts[0] !== 'section') continue;
				const idx = Number(parts[1]);
				if (!Number.isFinite(idx) || idx < 0 || idx >= data.sections.length) continue;
				const k = `section:${idx}`;
				if (seen.has(k)) continue;
				seen.add(k);
				out.push({ kind: 'section', sectionIdx: idx });
			}
		}
		// Fold the inspector pick if it's a sub-entity of a section not
		// already in the bulk — mixed-bulk support (whole section + a
		// portal anchor on a different section).
		if (marker && marker.kind !== 'section') {
			const sIdx = marker.sectionIndex;
			if (sIdx >= 0 && sIdx < data.sections.length && !seen.has(`section:${sIdx}`)) {
				if (marker.kind === 'portal') {
					out.push({ kind: 'portal', sectionIdx: sIdx, portalIdx: marker.portalIndex });
				}
				// boundary/no-go line *endpoints* aren't yet representable in
				// the bulk-ops `AISectionEntityRef` set introduced by issue
				// #74; #73 added the per-endpoint sub-entity selection. The
				// follow-up to unify is tracked in the cleanup pass — for v1
				// the bulk ignores standalone endpoint picks when the rest
				// of the bulk is whole sections.
			}
		}
		return out;
	}, [data, sectionBulk, marker]);

	// "How many entities live in the bulk?" — distinct addresses only.
	const bulkEntityCount = useMemo(() => {
		const seen = new Set<string>();
		for (const r of bulkRefs) {
			const key =
				r.kind === 'section' ? `s:${r.sectionIdx}`
				: r.kind === 'portal' ? `p:${r.sectionIdx}:${r.portalIdx}`
				: r.kind === 'boundaryLineEndpoint' ? `bl:${r.sectionIdx}:${r.portalIdx}:${r.lineIdx}`
				: `ng:${r.sectionIdx}:${r.lineIdx}`;
			seen.add(key);
		}
		return seen.size;
	}, [bulkRefs]);

	const isBulkActive = bulkEntityCount >= 2 || crossBundle.isCrossBundle;

	// Flat set of section indices in the local-Bundle bulk. Used to dedupe
	// the affectedNeighbours render (without this, every bulk member is
	// painted twice per drag frame — yellow by the bulk-member loop AND
	// orange by the cascade-neighbour loop, because both branches see them
	// as "sections that changed"). Re-derived only when bulkRefs changes.
	const bulkSectionIndices = useMemo<ReadonlySet<number>>(() => {
		const out = new Set<number>();
		for (const r of bulkRefs) {
			if (r.kind === 'section') out.add(r.sectionIdx);
		}
		return out;
	}, [bulkRefs]);
	// True when the bulk extends BEYOND this overlay's own (bundleId,
	// index) — at least one other Bundle has its own non-empty bulk
	// participating in the same gesture. The gizmo's pivot / refs / commit
	// path branches on this: cross-Bundle gestures route through
	// `setResourcesMulti` (one multi-Bundle HistoryCommit per gesture),
	// single-Bundle ones stay on the legacy `onChange` → `setResourceAt`
	// path (one single-Bundle HistoryCommit). Both produce exactly ONE
	// Workspace-undo entry per gesture (CONTEXT.md / "Bulk transform").
	const useCrossBundlePath = crossBundle.isCrossBundle;

	// Per-section ground Y (issue #27). Derived once per data change from
	// portal Ys plus a BFS through the section graph for portal-less sections.
	// Memoised here so the renderer doesn't re-walk all 8.7k V12 sections on
	// every frame — the hot path is `previewModel`-driven re-renders during a
	// drag, which never change `data.sections`.
	// Declared ahead of `bulkPivotLive` because that useMemo references
	// `sectionYs` in both its callback and its deps array — keeping the
	// declaration below would TDZ-throw on mount during any render where
	// `bulkPivotLive` is reached.
	const sectionYs = useMemo(() => resolveSectionYs(data), [data]);

	// Bulk Pivot — median of every selected entity position, computed
	// against the live data (NOT the preview model). Snapshotted at gesture
	// start in `bulkPivotRef` so it doesn't drift mid-rotate (re-deriving
	// from moving positions every frame would let the median precess and
	// produce a spiral instead of a rigid rotate).
	const bulkPivotRef = useRef<{ x: number; y: number; z: number } | null>(null);
	const bulkPivotMedian = useMemo<{ x: number; y: number; z: number } | null>(() => {
		if (!isBulkActive) return null;
		// Cross-Bundle bulks anchor at the median across every slice's
		// spatial samples — the cross-Bundle Pivot the controller exposes
		// (issue #80 / CONTEXT.md / "Pivot"). The single-Bundle pivot
		// stays scoped to this overlay's own data so legacy single-Bundle
		// gestures don't pick up phantom samples from cross-Bundle code.
		if (useCrossBundlePath) return crossBundle.pivot;
		const yResolver = (idx: number) => (idx < sectionYs.length ? sectionYs[idx] : 0);
		return bulkSelectionPivot(data, bulkRefs, yResolver);
	}, [isBulkActive, useCrossBundlePath, crossBundle.pivot, bulkRefs, data, sectionYs]);

	// **Pivot drag-reposition** (issue #76 / CONTEXT.md / "Pivot"). The user
	// can grab the dedicated pivot handle on the gizmo and drop it anywhere
	// in world space. The new position is stored here as an override on top
	// of the median. Pure UI state — NOT a Workspace-undo step.
	//
	// Lifecycle:
	//   - `bulkPivotOverride` holds the user-set position (null = use median).
	//   - `bulkPivotDragging` holds the live position during a pivot-drag
	//     gesture so the gizmo rides the cursor without committing yet. On
	//     pointer release the live position is committed into the override.
	//   - Both reset to null on Selection change (the `bulkRefs`-keyed
	//     useEffect below). "Selection change resets the pivot to the new
	//     median" — manual reposition is intentionally lost (issue #76's
	//     "simplest model"; preserving across Selection changes is a
	//     future-feature call per CONTEXT.md).
	const [bulkPivotOverride, setBulkPivotOverride] = useState<
		{ x: number; y: number; z: number } | null
	>(null);
	const [bulkPivotDragging, setBulkPivotDragging] = useState<
		{ x: number; y: number; z: number } | null
	>(null);

	// Selection-change reset. Keyed by the membership of `bulkRefs` (kind +
	// indices) so adding or removing an entity from the bulk drops the
	// manual override. Re-derived as a string key to keep the deps array
	// shallow-stable across renders that don't actually change membership.
	const bulkMembershipKey = useMemo(() => {
		return bulkRefs.map((r) => {
			switch (r.kind) {
				case 'section': return `s:${r.sectionIdx}`;
				case 'portal': return `p:${r.sectionIdx}:${r.portalIdx}`;
				case 'boundaryLineEndpoint':
					return `bl:${r.sectionIdx}:${r.portalIdx}:${r.lineIdx}:${r.end}`;
				case 'noGoLineEndpoint':
					return `ng:${r.sectionIdx}:${r.lineIdx}:${r.end}`;
			}
		}).sort().join('|');
	}, [bulkRefs]);
	useResetOnChange(bulkMembershipKey, () => {
		setBulkPivotOverride(null);
		setBulkPivotDragging(null);
	});

	// Resolve the effective pivot. Dragging wins over committed override
	// wins over median — that order keeps the live drag preview visible
	// without permanently committing it, and lets a previously-committed
	// override survive a selection-internal data change (e.g. another
	// transform on the same Selection).
	const bulkPivotLive = useMemo<{ x: number; y: number; z: number } | null>(() => {
		if (!isBulkActive) return null;
		return bulkPivotDragging ?? bulkPivotOverride ?? bulkPivotMedian;
	}, [isBulkActive, bulkPivotDragging, bulkPivotOverride, bulkPivotMedian]);

	// Identify the gizmo's target. Bulk wins over single-entity when 2+
	// entities are selected (per ADR-0010 — exactly one gizmo on screen).
	// Sub-entity targets translate ONLY that sub-entity on commit; bulk
	// translates/rotates every entity in `entities` around `pivot` as one
	// rigid body. None cascade (ADR-0009; issue #75's modifier-on path).
	const gizmoTarget = useMemo<DragTarget | null>(() => {
		if (isBulkActive) {
			// During a drag, the gizmoTarget's pivot is whatever the gesture
			// snapshotted (`bulkPivotRef.current`). Between gestures, the
			// override wins if set (issue #81 numeric pivot edit), otherwise
			// the live-derived bulk median. Pivot edits between gestures
			// thereby move the rotation centre for the next gesture.
			const pivot = bulkPivotRef.current ?? bulkPivotOverride ?? bulkPivotLive;
			if (!pivot) return null;
			return { kind: 'bulk', entities: bulkRefs, pivot };
		}
		if (!marker) return null;
		switch (marker.kind) {
			case 'section':
				return { kind: 'section', sectionIdx: marker.sectionIndex };
			case 'corner':
				return {
					kind: 'corner',
					sectionIdx: marker.sectionIndex,
					cornerIdx: marker.cornerIndex,
				};
			case 'portal':
				return {
					kind: 'portalAnchor',
					sectionIdx: marker.sectionIndex,
					portalIdx: marker.portalIndex,
				};
			case 'boundaryLineEndpoint':
				return {
					kind: 'boundaryLineEndpoint',
					sectionIdx: marker.sectionIndex,
					portalIdx: marker.portalIndex,
					lineIdx: marker.lineIndex,
					endIdx: marker.endIndex,
				};
			case 'noGoLineEndpoint':
				return {
					kind: 'noGoLineEndpoint',
					sectionIdx: marker.sectionIndex,
					lineIdx: marker.lineIndex,
					endIdx: marker.endIndex,
				};
			// `boundaryLine` / `noGoLine` (a whole-line selection) is intentionally
			// excluded — there's no rigid-body sub-op for a whole line yet (issue
			// #73 ships per-endpoint translates; whole-line goes through inspector
			// numeric fields or by selecting an endpoint).
			default:
				return null;
		}
	}, [isBulkActive, bulkRefs, bulkPivotLive, marker, bulkPivotOverride]);

	// Snap is intentionally not applied to any bulk-transform path (CONTEXT.md
	// / ADR-0009): cascade-off makes snap incoherent (snapping the source to
	// a neighbour edge while leaving the neighbour's reverse-portal stale
	// would surprise the user). State + toggle remain so the keyboard-shortcut
	// muscle memory survives, but the value isn't consulted anywhere in the
	// commit path. Issue #75 reconsiders snap once cascade is opt-in.
	useToggleHotkey('s', setSnapEnabled);
	useToggleHotkey('c', setCascadeEnabled);

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

	// Live-drag preview math — see `./aiSectionsPreview.ts`. Section-scope
	// drags branch between cascade-off (ADR-0009 default) and cascade-on
	// (`delta.cascade`, captured from Shift per issue #75); sub-entity
	// drags are always cascade-off in this slice.
	const previewModel = useMemo(() => derivePreviewModel(data, drag), [data, drag]);

	const previewSection = useMemo(
		() => derivePreviewSection(selSection, previewModel, selectedSectionIndex),
		[selSection, previewModel, selectedSectionIndex],
	);

	const previewCorners = useMemo(() => derivePreviewCorners(previewSection), [previewSection]);
	const hovCorners = useMemo(
		() => (hovSection ? v12Corners(hovSection) : null),
		[hovSection],
	);

	const affectedNeighbours = useMemo(
		() => deriveAffectedNeighbours(previewModel, selectedSectionIndex, bulkSectionIndices, data),
		[previewModel, selectedSectionIndex, data, bulkSectionIndices],
	);

	// Gizmo anchor — see `./aiSectionsGizmoGeometry.ts`. Tracks the live
	// drag via `previewSection`, layers `bulkPivotOverride` (issue #81)
	// for sub-entity targets.
	const gizmoPosition = useMemo(
		() => deriveGizmoPosition(gizmoTarget, previewSection, data, selectedSectionY, bulkPivotOverride, drag),
		[gizmoTarget, previewSection, data, selectedSectionY, bulkPivotOverride, drag],
	);

	// Axes profile per target kind (ADR-0011): section is XZ-packed,
	// portalAnchor is full 3D, single-point sub-entities disable rotate.
	const gizmoAxes = useMemo(() => deriveGizmoAxes(gizmoTarget), [gizmoTarget]);

	const gizmoPixelSize = 90;

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

	// Sub-entity pickers — emit the deeper marker shape so the bulk-transform
	// gizmo anchors at the corner / endpoint. Endpoints are addressed by the
	// (lineIdx, endIdx) pair; endIdx ∈ {0, 1} picks verts.(x,y) vs verts.(z,w).
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

	// Drag handlers — the bulk-transform gizmo owns every direct-manipulation
	// gesture in the WorldViewport per ADR-0010 (one unified affordance,
	// dispatched on the Selection kind). For section-scope selections the
	// gizmo translates and yaw-rotates as a rigid body (PR #84). For sub-
	// entity selections (corner / portal anchor / line endpoint, this slice)
	// it translates only the named sub-entity — no shared-corner cascade,
	// no mirror-portal sync (per ADR-0009; that's #75). On commit, the
	// matching no-cascade op runs and emits the new root via onChange.
	// Without onChange these are no-ops.
	const handleGizmoTransform = useCallback((delta: BulkTransformDelta) => {
		if (!gizmoTarget) return;
		// Fold the sticky cascade toggle into the per-gesture delta.cascade
		// (which carries the raw Shift modifier state from the gizmo). The
		// downstream consumers (`applyDragToModel`, the cascade visual hint,
		// the cross-Bundle path) all read `drag.delta.cascade` as the
		// **effective** cascade for the gesture, so the XOR lives here once
		// rather than at every consumer site.
		const resolvedDelta = {
			...delta,
			cascade: cascadeEnabled !== !!delta.cascade,
		};
		// Bulk gesture: snapshot the Pivot on the first frame so it doesn't
		// drift as we drag (re-deriving the median against moving positions
		// every frame produces a spiral instead of a rigid rotate). The
		// gizmoTarget already carries `bulkPivotRef.current ?? bulkPivotLive`
		// — if the ref was unset (first frame), set it now and use the live
		// value for this frame's gesture.
		if (gizmoTarget.kind === 'bulk') {
			if (!bulkPivotRef.current) bulkPivotRef.current = gizmoTarget.pivot;
			setDrag({
				target: { ...gizmoTarget, pivot: bulkPivotRef.current },
				delta: resolvedDelta,
			});
			return;
		}
		setDrag({ target: gizmoTarget, delta: resolvedDelta });
	}, [gizmoTarget, cascadeEnabled]);

	const handleGizmoCommit = useCallback((delta: BulkTransformDelta) => {
		setDrag(null);
		const snapshotPivot = bulkPivotRef.current;
		bulkPivotRef.current = null;
		if (!gizmoTarget) return;
		if (isIdentityDelta(delta)) return;
		// Fold the sticky toggle into the gesture-time delta.cascade (same
		// XOR as in handleGizmoTransform — kept symmetric so commit dispatch
		// agrees with the preview frames).
		const effectiveDelta = {
			...delta,
			cascade: cascadeEnabled !== !!delta.cascade,
		};
		// Cross-Bundle bulk gesture (issue #80): route through the
		// workspace-level controller so every affected Bundle is
		// independently dirtied and one multi-Bundle HistoryCommit covers
		// the whole gesture. The active overlay's own bundle is included
		// as one slice among many — its single-Bundle `onChange` path is
		// intentionally skipped here to avoid double-writing this slice
		// (once via the per-Bundle dispatch, again via `onChange` →
		// `setResourceAt`).
		if (
			gizmoTarget.kind === 'bulk' &&
			useCrossBundlePath &&
			snapshotPivot
		) {
			const written = crossBundle.commitDelta(
				{ x: snapshotPivot.x, z: snapshotPivot.z },
				{
					translate: effectiveDelta.translate,
					rotateY: effectiveDelta.rotate.y,
				},
			);
			// `written === 0` means every slice resolved to a no-op (the
			// model-reference identity guard in `buildCrossBundleWrites`).
			// No history entry to push; the gesture is a true no-op.
			void written;
			return;
		}
		// Single-Bundle path — unchanged from the pre-issue-#80 shape
		// (one setResourceAt → one HistoryCommit, regression-guarded by
		// the existing #74 tests).
		if (!onChange) return;
		// For bulk commits, use the snapshotted pivot from the gesture's
		// first frame — NOT a freshly-computed median (which would have
		// moved with the preview).
		const committedTarget =
			gizmoTarget.kind === 'bulk' && snapshotPivot
				? { ...gizmoTarget, pivot: snapshotPivot }
				: gizmoTarget;
		let next: ParsedAISectionsV12;
		try {
			next = applyDragToModel(data, { target: committedTarget, delta: effectiveDelta });
		} catch {
			return;
		}
		if (next === data) return;
		// Single onChange call ⇒ single setResourceAt ⇒ single
		// HistoryCommit pushed onto the Workspace-undo stack. Drag-frames
		// in between only updated local React state; they never touched
		// `setResourceAt`, so they don't add stack entries. Cascade-on
		// paths preserve this invariant: even though the cascade-with-links
		// ops mutate more sections per gesture, they still produce ONE
		// resulting model committed via ONE onChange call.
		onChange(next);
	}, [data, gizmoTarget, onChange, useCrossBundlePath, crossBundle, cascadeEnabled]);

	const handleGizmoCancel = useCallback(() => {
		setDrag(null);
		bulkPivotRef.current = null;
	}, []);

	// **Pivot drag-reposition** wiring (issue #76). The gizmo emits the new
	// absolute world position on every frame of a pivot-drag gesture; we
	// stash it in `bulkPivotDragging` so the gizmo rides the cursor without
	// committing. On release we commit to `bulkPivotOverride` (subsequent
	// gestures will use this as the new pivot). Neither path runs
	// `onChange` — pivot reposition is pure UI state and NOT a Workspace-
	// undo step (CONTEXT.md / "Pivot"). Sub-entity selections route the
	// pivot drag through the same channel, but the gizmoPosition memo
	// for those targets currently anchors at the entity itself; until
	// per-target overrides are wired, pivot drag is a no-op for them.
	// The stored pivot uses underlying-data coordinates, NOT the visualised
	// gizmo position — so we subtract `BULK_GIZMO_Y_OFFSET` on incoming
	// gizmo-world positions and re-add it when rendering. Keeps the stored
	// pivot bit-identical to the median computed by `bulkSelectionPivot`.
	const handlePivotMove = useCallback(
		(world: { x: number; y: number; z: number }) => {
			if (!isBulkActive) return;
			setBulkPivotDragging({ x: world.x, y: world.y - BULK_GIZMO_Y_OFFSET, z: world.z });
		},
		[isBulkActive],
	);
	const handlePivotCommit = useCallback(
		(world: { x: number; y: number; z: number }) => {
			setBulkPivotDragging(null);
			if (!isBulkActive) return;
			setBulkPivotOverride({ x: world.x, y: world.y - BULK_GIZMO_Y_OFFSET, z: world.z });
		},
		[isBulkActive],
	);
	const handlePivotCancel = useCallback(() => {
		setBulkPivotDragging(null);
	}, []);

	// =========================================================================
	// Bulk-transform numeric panel companion (issue #81)
	// =========================================================================
	//
	// Publish the active gizmo's staged state to the workspace-scoped
	// `BulkTransformGizmoSessionProvider` so the inspector-side numeric panel
	// can read AND write the same delta + pivot the gizmo uses. The session is
	// keyed by (bundleId, index, marker shape) so the panel resets typed
	// fields when the user picks a different entity.
	//
	// `setDelta` updates the local drag state in preview mode — same shape as
	// `handleGizmoTransform` minus the `gizmoTarget` precondition (which the
	// useMemo below already guards). `commit` reuses `handleGizmoCommit` so
	// the one-undo-per-gesture contract is preserved whether the gesture came
	// from a drag or from a typed Enter. `setPivot` updates `bulkPivotOverride`
	// — the same state the pivot-drag handle uses (issue #76), so typed and
	// dragged pivot edits share one source of truth.

	// The pivot the panel shows — the gizmo's anchor projected to the
	// "absolute world coords" the issue calls out. For bulk gestures this is
	// the snapshotted bulk pivot; for sub-entity gestures it's the anchor
	// itself (corner XZ on section Y, portal Vector3, etc.). We use the raw
	// auto-anchor (no +1.5 Y offset) so the typed values round-trip cleanly:
	// the +1.5 is a "lift above the fill mesh" visual nudge, not part of the
	// pivot value the user cares about.
	const sessionPivot = useMemo<{ x: number; y: number; z: number } | null>(() => {
		if (bulkPivotOverride) return bulkPivotOverride;
		if (!gizmoTarget) return null;
		if (gizmoTarget.kind === 'bulk') return gizmoTarget.pivot;
		const liveSection = data.sections[gizmoTarget.sectionIdx];
		if (!liveSection) return null;
		switch (gizmoTarget.kind) {
			case 'section': {
				if (liveSection.corners.length === 0) return null;
				let sx = 0, sz = 0;
				for (const c of liveSection.corners) { sx += c.x; sz += c.y; }
				const n = liveSection.corners.length;
				return { x: sx / n, y: selectedSectionY, z: sz / n };
			}
			case 'corner': {
				const c = liveSection.corners[gizmoTarget.cornerIdx];
				if (!c) return null;
				return { x: c.x, y: selectedSectionY, z: c.y };
			}
			case 'portalAnchor': {
				const p = liveSection.portals[gizmoTarget.portalIdx];
				if (!p) return null;
				return { x: p.position.x, y: p.position.y, z: p.position.z };
			}
			case 'boundaryLineEndpoint': {
				const p = liveSection.portals[gizmoTarget.portalIdx];
				if (!p) return null;
				const line = p.boundaryLines[gizmoTarget.lineIdx];
				if (!line) return null;
				const v = line.verts;
				const x = gizmoTarget.endIdx === 0 ? v.x : v.z;
				const z = gizmoTarget.endIdx === 0 ? v.y : v.w;
				return { x, y: p.position.y, z };
			}
			case 'noGoLineEndpoint': {
				const line = liveSection.noGoLines[gizmoTarget.lineIdx];
				if (!line) return null;
				const v = line.verts;
				const x = gizmoTarget.endIdx === 0 ? v.x : v.z;
				const z = gizmoTarget.endIdx === 0 ? v.y : v.w;
				return { x, y: selectedSectionY, z };
			}
		}
	}, [gizmoTarget, bulkPivotOverride, data, selectedSectionY]);

	const handleSessionSetDelta = useCallback((next: BulkTransformDelta) => {
		if (!gizmoTarget) return;
		if (isIdentityDelta(next)) {
			setDrag(null);
			return;
		}
		// Same shape as a live drag-frame, but the pivot for a bulk gesture
		// uses whatever the gizmoTarget already carries (override-aware via
		// the memo above). No need to snapshot bulkPivotRef on a typed edit
		// — a typed commit is a one-shot, not a multi-frame gesture, so
		// pivot drift can't happen.
		setDrag({ target: gizmoTarget, delta: next });
	}, [gizmoTarget]);

	const handleSessionCommit = useCallback((typed: BulkTransformDelta) => {
		// Drop any in-flight preview before the commit so the next session
		// state has delta = identity (the "reset to zero after every commit"
		// rule per issue #81 / Blender N panel idiom).
		setDrag(null);
		handleGizmoCommit(typed);
	}, [handleGizmoCommit]);

	const handleSessionSetPivot = useCallback((world: { x: number; y: number; z: number }) => {
		// Typed pivot edit — wires into the same `bulkPivotOverride` slot
		// the pivot-drag handle uses (issue #76 + #81 share one source of
		// truth). No undo entry: pivot is part of the Tools surface, not
		// the Workspace history.
		setBulkPivotOverride(world);
	}, []);

	// Publish the session whenever its observables change. `null` while no
	// gizmo target exists so the panel hides itself.
	useEffect(() => {
		if (!isActive || !gizmoTarget || !sessionPivot) {
			setSession(null);
			return;
		}
		const markerKey =
			gizmoTarget.kind === 'bulk'
				? `bulk:${gizmoTarget.entities.length}`
				: gizmoTarget.kind === 'section'
					? `s:${gizmoTarget.sectionIdx}`
					: gizmoTarget.kind === 'corner'
						? `c:${gizmoTarget.sectionIdx}:${gizmoTarget.cornerIdx}`
						: gizmoTarget.kind === 'portalAnchor'
							? `pa:${gizmoTarget.sectionIdx}:${gizmoTarget.portalIdx}`
							: gizmoTarget.kind === 'boundaryLineEndpoint'
								? `ble:${gizmoTarget.sectionIdx}:${gizmoTarget.portalIdx}:${gizmoTarget.lineIdx}:${gizmoTarget.endIdx}`
								: `nge:${gizmoTarget.sectionIdx}:${gizmoTarget.lineIdx}:${gizmoTarget.endIdx}`;
		const session: GizmoSession = {
			id: `aiSections::${bundleId ?? '?'}::${index ?? '?'}::${markerKey}`,
			delta: drag?.delta ?? identityDelta(),
			pivot: sessionPivot,
			axes: gizmoAxes,
			setDelta: handleSessionSetDelta,
			commit: handleSessionCommit,
			setPivot: handleSessionSetPivot,
		};
		setSession(session);
	}, [
		isActive,
		gizmoTarget,
		sessionPivot,
		gizmoAxes,
		drag,
		bundleId,
		index,
		handleSessionSetDelta,
		handleSessionCommit,
		handleSessionSetPivot,
		setSession,
	]);

	// Clear the session on unmount — happens when the user navigates the
	// inspector to a non-world resource (Bundle / Resource-type level), at
	// which point the overlay drops out of the scene composition.
	useEffect(() => {
		return () => setSession(null);
	}, [setSession]);


	// Reset transient edge / drag UI when the selected section changes.
	useResetOnChange(selectedSectionIndex, () => {
		setHoveredEdge(null);
		setEdgeMenu(null);
		setDrag(null);
		// Also reset any typed pivot override (issue #81) — the next
		// selection brings its own auto-anchor; carrying over a manual
		// pivot from a different section would surprise the user.
		setBulkPivotOverride(null);
		setBulkPivotDragging(null);
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

	// Marquee wiring (issue #80 cross-Bundle): the marquee delegates to
	// the workspace-level dispatcher so a rectangle spanning N Bundles
	// hits every loaded + visible AI sections instance, not just this
	// overlay's. Each Bundle's bulk is dispatched independently via
	// `onBulkApplyPaths(bundleId, index, hits, mode)` — invisible
	// Bundles / resource-types / instances are filtered out by the
	// controller's per-instance visibility check, so a hidden Bundle's
	// sections are never picked up even if they sit inside the marquee
	// rectangle (acceptance criterion: "Invisible Bundles are not part
	// of the Selection"). Routes through the same WORKSPACE
	// `onBulkApplyPaths` the single-Bundle path used so the right-sidebar
	// BulkPanelStack, the tree's amber rows, and the persistent yellow
	// outline overlay rendering all light up in one dispatch per Bundle.
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

			{previewCorners && (
				<SelectionOverlay corners={previewCorners} color="#ffaa33" baseY={selectedSectionY} />
			)}
			{hovCorners && hoverSectionIndex !== selectedSectionIndex && (
				<SelectionOverlay corners={hovCorners} color="#66aaff" baseY={hoverSectionY} />
			)}

			{/* Yellow outline for every bulk member that ISN'T the inspector
			    pick. The inspector pick already wears the orange overlay
			    above; promoting it to yellow as well would hide the
			    "currently editing" cue. While a bulk gesture is in flight
			    we draw against the live previewModel so every member is
			    seen translating / rotating in lockstep. */}
			{sectionBulk && [...sectionBulk.bulkSet].map((key) => {
				const parts = key.split(':');
				if (parts[0] !== 'section') return null;
				const idx = Number(parts[1]);
				if (!Number.isFinite(idx) || idx === selectedSectionIndex) return null;
				const liveSec = (drag?.target.kind === 'bulk' && previewModel)
					? previewModel.sections[idx]
					: data.sections[idx];
				if (!liveSec) return null;
				const corners = v12Corners(liveSec);
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
						onPickBoundaryLineEndpoint={handlePickBoundaryLineEndpoint}
						onPickNoGoLineEndpoint={handlePickNoGoLineEndpoint}
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

			{/* Corner picker spheres — click-to-select; the gizmo handles
			    the drag once a corner is selected (per ADR-0010 / issue #73).
			    Always shown when a section is the active inspector pick so a
			    user can drill into any corner. The currently-picked corner is
			    rendered in the bright "active" colour. */}
			{previewSection && previewCorners && selectedSectionIndex != null && (
				<CornerPickers
					corners={previewCorners}
					baseY={selectedSectionY}
					selectedCornerIdx={marker?.kind === 'corner' ? marker.cornerIndex : null}
					onPick={handlePickCorner}
				/>
			)}

			{/* Gizmo gates on `isActive` so cross-Bundle gestures show
			    exactly one gizmo on screen (per ADR-0010): the overlay
			    matching the current selection renders it, every other
			    overlay's gizmoPosition is suppressed. When no selection
			    is in any AI Sections instance, no gizmo renders — the
			    user clicks any section first to anchor the affordance,
			    even for a cross-Bundle marquee. */}
			{isActive && gizmoPosition && (
				<BulkTransformGizmo
					position={gizmoPosition}
					pixelSize={gizmoPixelSize}
					axes={gizmoAxes}
					onTransform={handleGizmoTransform}
					onCommit={handleGizmoCommit}
					onCancel={handleGizmoCancel}
					// Pivot drag-reposition is bulk-only for now (issue #76).
					// Wire the callbacks only when the bulk gizmo is up; the
					// gizmo renders the pivot handle iff `onPivotMove` is
					// provided. Sub-entity gizmos keep the legacy fixed-pivot
					// behaviour (their pivot IS the entity position, so there's
					// nothing meaningful to drag-reposition).
					onPivotMove={isBulkActive ? handlePivotMove : undefined}
					onPivotCommit={isBulkActive ? handlePivotCommit : undefined}
					onPivotCancel={isBulkActive ? handlePivotCancel : undefined}
				/>
			)}

			{/* CameraBridge mirrors camera state out to the marquee selector
			    living in the DOM sibling slot. Lives inside Canvas so it can
			    read three-fiber's per-frame state. */}
			<CameraBridge bridge={cameraBridge} />

			{/* DOM siblings — snap toggle, marquee rectangle, edge context
			    menu, cascade-on hint — registered into the chrome's HTML
			    slot. The slot renders these outside the Canvas in React-
			    DOM-land, avoiding cross-reconciler portal quirks. */}
			<HtmlSiblings
				isActive={isActive}
				snapEnabled={snapEnabled}
				toggleSnap={() => setSnapEnabled((v) => !v)}
				cascadeEnabled={cascadeEnabled}
				toggleCascade={() => setCascadeEnabled((v) => !v)}
				cameraBridge={cameraBridge}
				onMarquee={handleMarquee}
				edgeMenu={edgeMenu}
				onDuplicateThroughEdge={handleDuplicateThroughEdge}
				onCloseEdgeMenu={() => setEdgeMenu(null)}
				// Cascade hint is renderable for in-flight gestures whose
				// effective cascade is ON — section-scope and bulk only
				// (sub-entity gizmo paths don't dispatch cascade-on ops
				// yet, so the hint would lie). Reads `drag.target.kind`
				// (the discriminator lives on the target, not on `drag`
				// itself — earlier code shipped with `drag?.kind` which
				// silently never matched).
				cascadeActive={
					drag != null &&
					drag.delta.cascade === true &&
					(drag.target.kind === 'section' || drag.target.kind === 'bulk')
				}
				skippedSoupCount={skippedSoupCount}
				showSkippedSoupHint={gizmoPosition != null && skippedSoupCount > 0}
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
	cascadeEnabled,
	toggleCascade,
	cameraBridge,
	onMarquee,
	edgeMenu,
	onDuplicateThroughEdge,
	onCloseEdgeMenu,
	cascadeActive,
	skippedSoupCount,
	showSkippedSoupHint,
}: {
	isActive: boolean;
	snapEnabled: boolean;
	toggleSnap: () => void;
	/** Sticky cascade toggle (CONTEXT.md / "Cascade"). When ON, gizmo
	 *  gestures default to cascade-with-links (outside reverse-portal
	 *  anchors + shared corners drag along). Shift inverts for one
	 *  gesture (toggle=on + Shift = cascade off; toggle=off + Shift =
	 *  cascade on). */
	cascadeEnabled: boolean;
	toggleCascade: () => void;
	cameraBridge: React.MutableRefObject<CameraBridgeData | null>;
	onMarquee: (frustum: THREE.Frustum, mode: 'add' | 'remove') => void;
	edgeMenu: { x: number; y: number; sectionIndex: number; edgeIdx: number } | null;
	onDuplicateThroughEdge: () => void;
	onCloseEdgeMenu: () => void;
	cascadeActive: boolean;
	/** Distinct polygon-soup count across the workspace's active PSL bulk.
	 *  Surfaces in the gizmo's "N polygon soups not transformed" hint when
	 *  the Selection is mixed (issue #82). */
	skippedSoupCount: number;
	/** True when the hint is renderable — the AI-sections side has a gizmo
	 *  (`gizmoPosition != null`) AND the PSL side has polygon-soup polys
	 *  to skip (`skippedSoupCount > 0`). Soup-only Selections fall through
	 *  to no-gizmo + no-hint because there's no AI section to anchor on. */
	showSkippedSoupHint: boolean;
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

				{/* Snap + Cascade toggle row. Wrapped in a flex container so the
				    two buttons layout side-by-side without per-button absolute
				    positioning — the Snap label's width varies with on/off, so
				    a guessed `left: NNpx` on the Cascade button overlapped at
				    some labels. */}
				<div
					style={{
						position: 'absolute',
						top: 8,
						left: 8,
						display: 'flex',
						alignItems: 'center',
						gap: 6,
						pointerEvents: 'none', // children opt back in
					}}
				>
					<button
						type="button"
						onClick={toggleSnap}
						title={snapEnabled
							? 'Snap to edges: ON (S to toggle)'
							: 'Snap to edges: OFF (S to toggle)'}
						aria-pressed={snapEnabled}
						style={{
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

					<button
						type="button"
						onClick={toggleCascade}
						title={cascadeEnabled
							? 'Keep connections (cascade): ON — hold Shift on a gesture for non-cascading (C to toggle)'
							: 'Keep connections (cascade): OFF — hold Shift on a gesture for cascading (C to toggle)'}
						aria-pressed={cascadeEnabled}
						style={{
							display: 'flex',
							alignItems: 'center',
							gap: 6,
							padding: '4px 8px',
							borderRadius: 6,
							fontSize: 11,
							fontFamily: 'monospace',
							border: '1px solid rgba(255,255,255,0.15)',
							// Magenta tint when ON — matches the in-flight cascade
							// hint halo / status badge below, so the user can
							// associate the toggle with what they'll see when a
							// gesture fires.
							background: cascadeEnabled ? 'rgba(200, 80, 180, 0.85)' : 'rgba(20, 22, 28, 0.85)',
							color: cascadeEnabled ? '#fff' : 'rgba(255,255,255,0.7)',
							cursor: 'pointer',
							userSelect: 'none',
							boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
							pointerEvents: 'auto',
						}}
					>
						<Link2 size={14} />
						<span>Cascade{cascadeEnabled ? ' · on' : ' · off'}</span>
						<span style={{ opacity: 0.5, fontSize: 10 }}>C</span>
					</button>
				</div>

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

				{/* Cascade status hint — appears top-centre during a Shift-
				    held bulk-transform gesture (CONTEXT.md / "Cascade",
				    ADR-0009, issue #75). Magenta tint matches the gizmo's
				    cascade halo so the two cues read as one mode. */}
				{cascadeActive && (
					<div
						role="status"
						aria-live="polite"
						style={{
							position: 'absolute',
							top: 8,
							left: '50%',
							transform: 'translateX(-50%)',
							padding: '4px 10px',
							borderRadius: 6,
							fontSize: 11,
							fontFamily: 'monospace',
							border: '1px solid #ff66cc',
							background: 'rgba(255, 102, 204, 0.18)',
							color: '#ffaadd',
							pointerEvents: 'none',
							userSelect: 'none',
							boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
							whiteSpace: 'nowrap',
						}}
					>
						Cascade ON · outside neighbours follow
					</div>
				)}

				{/* Polygon-soup skip hint — appears top-centre (offset down
				    if the cascade hint is also on so they stack cleanly)
				    when the Selection contains transformable entities AND
				    1+ polygon soups (issue #82). Polygon soups have no
				    world-space placement field (vertices u16-packed into
				    local soup-space — CONTEXT.md / "Pivot"), so the
				    transform delta is applied to the non-soup entities
				    only. Amber tint distinguishes it from the cascade
				    magenta — the two cues represent unrelated states. */}
				{showSkippedSoupHint && (
					<div
						role="status"
						aria-live="polite"
						data-testid="bulk-transform-soup-skip-hint"
						style={{
							position: 'absolute',
							top: cascadeActive ? 36 : 8,
							left: '50%',
							transform: 'translateX(-50%)',
							padding: '4px 10px',
							borderRadius: 6,
							fontSize: 11,
							fontFamily: 'monospace',
							border: '1px solid #f59e0b',
							background: 'rgba(245, 158, 11, 0.18)',
							color: '#fbbf24',
							pointerEvents: 'none',
							userSelect: 'none',
							boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
							whiteSpace: 'nowrap',
						}}
					>
						{skippedSoupCount} polygon soup{skippedSoupCount === 1 ? '' : 's'} not transformed
					</div>
				)}
			</>
		),
		[snapEnabled, toggleSnap, cascadeEnabled, toggleCascade, cameraBridge, onMarquee, edgeMenu, onDuplicateThroughEdge, onCloseEdgeMenu, cascadeActive, showSkippedSoupHint, skippedSoupCount],
	);
	// Pass `null` when this overlay isn't the active resource so the chrome
	// drops our marquee / snap / context menu — see ADR-0007 / issue #24.
	useWorldViewportHtmlSlot(isActive ? node : null);
	return null;
}

