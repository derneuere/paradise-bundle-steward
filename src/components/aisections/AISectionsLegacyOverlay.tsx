// AISectionsLegacyOverlay — WorldViewport overlay for the V4/V6 prototype
// AI Sections data. Reads the legacy model directly — no adapter to the V12
// shape — so the prototype's parallel cornersX[4] + cornersZ[4] storage,
// dangerRating enum, and Vector4 midPosition fields are visible to the
// rendering code without lossy translation.
//
// Visual conventions mirror `AISectionsOverlay` (V12) so the two overlays
// look like obvious siblings:
//   - Batched fill + outline mesh (one draw call each)
//   - Color from dangerRating (3 buckets: freeway / normal / dangerous)
//     instead of V12's speed (5 buckets)
//   - Portal spheres (cyan), boundary line segments (red),
//     no-go line segments (orange), portal-link dashed lines (cyan)
//   - Section label: `Sec {index}` — V4 has no `id` field so the label
//     is intentionally simpler than V12's `Sec i | 0xID | SPEED`.
//
// Selection currency is the schema NodePath (ADR-0001). The V4 schema nests
// the actual section list under a `legacy` wrapper field
// (ParsedAISectionsV4 = { kind, version, legacy: LegacyAISectionsDataV4 }),
// so the schema-correct paths the inspector tree generates — and that this
// overlay must match for selection round-trip to work — are:
//   - ['legacy', 'sections', i]                                       → section
//   - ['legacy', 'sections', i, 'portals', p]                         → portal
//   - ['legacy', 'sections', i, 'portals', p, 'boundaryLines', l]     → boundary line
//   - ['legacy', 'sections', i, 'noGoLines', l]                       → no-go line
//
// Edit ops:
//   - `Duplicate section through this edge` from the edge right-click menu
//     (`duplicateLegacySectionThroughEdge` in `aiSectionsOps.ts`; issue #44).
//   - Corner drag with smart-cascade — drags one corner of the selected
//     section and any neighbour section sharing that corner moves with it
//     (`translateLegacyCornerWithShared`; issue #41).
//   - Section translate via the centred `TranslateGizmo` — drags the source
//     section's corners + portals + no-go lines and cascades into linked
//     neighbour sections (`translateLegacySectionWithLinks`; issue #42).
//   - Snap-to-edges: `S` toggles snap mode (matches V12). When on, both the
//     gizmo and corner-handle drags snap to nearby foreign corners / edges
//     within a scene-scaled radius (`snapLegacySectionOffset`,
//     `snapLegacyCornerOffset`; issue #43).
//
// Marquee (B-key box-select) hit-tests sections by corner centroid against
// the marquee frustum — same pattern as V12, but the centroid is folded over
// the parallel cornersX/cornersZ arrays via the `legacyCorners` adapter
// rather than V12's Vector2[] corners.
//
// 3D primitives (BatchedSections, SelectionOverlay, SectionLabel,
// EdgeHandles, EdgeContextMenu) live in `@/components/aisections/shared`
// so the V12 overlay consumes the same code path — bug fixes land in both
// at once. See issue #35.

import { useMemo, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { useResetOnChange } from '@/hooks/useResetOnChange';
import { useToggleHotkey } from '@/hooks/useToggleHotkey';
import { CameraBridge, type CameraBridgeData } from '@/components/common/three/CameraBridge';
import type {
	ParsedAISectionsV4,
	ParsedAISectionsV6,
	LegacyAISection,
	LegacyAISectionsData,
} from '@/lib/core/aiSections';
import { LegacyDangerRating } from '@/lib/core/aiSections';
import {
	duplicateLegacySectionThroughEdge,
	snapLegacyCornerOffset,
	snapLegacySectionOffset,
	translateLegacyCornerWithShared,
	translateLegacySectionWithLinks,
} from '@/lib/core/aiSectionsOps';
import { CornerHandles, type CornerDragOffset } from '@/components/aisections/CornerHandles';
import { TranslateGizmo, type GizmoOffset } from '@/components/common/three/TranslateGizmo';
import {
	aiSectionsLegacySelectionCodec,
	BatchedSections,
	buildBatchedSections,
	BulkSectionLayer,
	CascadeNeighbourLayer,
	HoverSectionLayer,
	markerToSelection,
	OverlayHtmlSiblings,
	SelectedSectionLayer,
	selectionToMarker,
	type AISectionMarker,
	type BatchedSectionsScene,
	type Corner,
	type DisplayPortal,
	type DisplayBoundaryLine,
	type SectionAccessor,
	type SectionDetailAccessor,
} from '@/components/aisections/shared';
import { useAISectionsBulk } from '@/components/workspace/AISectionsBulkProvider';
import {
	useBatchedSelection,
	type Selection,
} from '@/components/schema-editor/viewports/selection';
import type { ThreeEvent } from '@react-three/fiber';
import type { NodePath } from '@/lib/schema/walk';
import type { WorldOverlayComponent } from '@/components/schema-editor/viewports/WorldViewport.types';

// ---------------------------------------------------------------------------
// Path ↔ Selection codec — re-exported from the shared module so V12 and V4/V6
// stay in lock-step. The marker shape is identical to V12's; only the schema
// path prefix differs (V4/V6 paths nest under the `legacy` wrapper field).
// The legacy `{ kind, sectionIndex, ... }` marker shape is preserved for tests.
// ---------------------------------------------------------------------------

export type LegacyAISectionMarker = AISectionMarker;
export const legacyAISectionSelectionCodec = aiSectionsLegacySelectionCodec;

export function legacyAISectionPathMarker(path: NodePath): LegacyAISectionMarker {
	return selectionToMarker(aiSectionsLegacySelectionCodec.pathToSelection(path));
}

export function legacyAISectionMarkerPath(m: LegacyAISectionMarker): NodePath {
	const sel = markerToSelection(m);
	if (!sel) return [];
	return aiSectionsLegacySelectionCodec.selectionToPath(sel);
}

// ---------------------------------------------------------------------------
// V4/V6 → shared adapters
// ---------------------------------------------------------------------------

// V4/V6 use a 3-step danger rating where V12 has a 5-step speed enum. The
// palette is hand-picked to read as "fast/normal/risky" at-a-glance and to
// stay obviously distinct from V12's blue→green→orange→red speed ramp so
// a side-by-side V4-vs-V12 comparison is unambiguous.
const DANGER_COLORS_RGB: Record<number, readonly [number, number, number]> = {
	[LegacyDangerRating.E_DANGER_RATING_FREEWAY]: [0.27, 0.67, 0.53],
	[LegacyDangerRating.E_DANGER_RATING_NORMAL]: [0.53, 0.73, 0.27],
	[LegacyDangerRating.E_DANGER_RATING_DANGEROUS]: [0.8, 0.27, 0.27],
};
const FALLBACK_RGB: readonly [number, number, number] = [0.4, 0.4, 0.4];

const DANGER_SHORT: Record<number, string> = {
	[LegacyDangerRating.E_DANGER_RATING_FREEWAY]: 'FREE',
	[LegacyDangerRating.E_DANGER_RATING_NORMAL]: 'NORM',
	[LegacyDangerRating.E_DANGER_RATING_DANGEROUS]: 'DANG',
};

// Defensively clamp to the shorter of cornersX / cornersZ — synthetic test
// fixtures may pass mismatched arrays even though the V4 wire format always
// stores exactly four of each.
function legacyCornerCount(s: LegacyAISection): number {
	return Math.min(s.cornersX.length, s.cornersZ.length);
}

const legacyAccessor: SectionAccessor<LegacyAISection> = {
	cornerCount: legacyCornerCount,
	cornerX: (s, i) => s.cornersX[i],
	cornerZ: (s, i) => s.cornersZ[i],
	color: (s) => DANGER_COLORS_RGB[s.dangerRating] ?? FALLBACK_RGB,
};

function legacyCorners(section: LegacyAISection): Corner[] {
	const n = legacyCornerCount(section);
	const out: Corner[] = new Array(n);
	for (let i = 0; i < n; i++) {
		out[i] = { x: section.cornersX[i], z: section.cornersZ[i] };
	}
	return out;
}

const EMPTY_BULK_SET: ReadonlySet<string> = new Set();

// V4/V6 → SectionDetail accessor.
//
// Storage differences vs V12:
//   - portal anchor lives at `portal.midPosition` (Vector4 — w byte is
//     padding). The display shape is `Vector3`-equivalent so we drop w.
//   - corners stored as parallel `cornersX[]`/`cornersZ[]`; centre averages
//     `[0]` and `[2]` from each.
//   - legacy data has no resolved-Y map; the link line lands at the
//     SOURCE portal's Y. That's the same fallback the pre-extraction
//     legacy overlay used (it never consulted a sectionYs map).
const legacyDetailAccessor: SectionDetailAccessor<LegacyAISection, LegacyAISectionsData> = {
	portals: (s) =>
		s.portals.map<DisplayPortal>((p) => ({
			position: { x: p.midPosition.x, y: p.midPosition.y, z: p.midPosition.z },
			linkSection: p.linkSection,
			boundaryLines: p.boundaryLines as readonly DisplayBoundaryLine[],
		})),
	noGoLines: (s) => s.noGoLines as readonly DisplayBoundaryLine[],
	sectionAt: (root, idx) => {
		if (idx < 0 || idx >= root.sections.length) return null;
		const target = root.sections[idx];
		const tn = legacyCornerCount(target);
		if (tn < 4) return null;
		return target;
	},
	centreOf: (root, idx, sourcePortalY) => {
		if (idx < 0 || idx >= root.sections.length) return null;
		const target = root.sections[idx];
		const tn = legacyCornerCount(target);
		if (tn < 4) return null;
		return {
			x: (target.cornersX[0] + target.cornersX[2]) / 2,
			y: sourcePortalY,
			z: (target.cornersZ[0] + target.cornersZ[2]) / 2,
		};
	},
};

/**
 * Thin wrapper around the generic shared builder, kept for
 * `AISectionsLegacyOverlay.test.ts` which exercises V4-specific
 * cornersX/cornersZ projection + dangerRating colour buckets. The wrapper
 * just plugs the V4 accessor into the generic — no V4-specific geometry
 * code remains.
 */
export function buildBatchedLegacySections(sections: LegacyAISection[]): BatchedSectionsScene {
	return buildBatchedSections(sections, legacyAccessor);
}

// ---------------------------------------------------------------------------
// Overlay
// ---------------------------------------------------------------------------

type Props = {
	data: ParsedAISectionsV4 | ParsedAISectionsV6;
	selectedPath: NodePath;
	onSelect: (path: NodePath) => void;
	onChange?: (next: ParsedAISectionsV4 | ParsedAISectionsV6) => void;
	/** True when this overlay owns the active selection — gates HTML-slot
	 *  registration of the edge context menu. Defaults to `true` so single-
	 *  resource (legacy per-page) routes don't have to thread it. */
	isActive?: boolean;
	/** Bundle / instance identity, supplied by `WorldViewportComposition` so
	 *  the overlay can resolve "MY bulk" via `forInstance(bundleId, index)`.
	 *  Optional so legacy per-resource pages still mount cleanly. */
	bundleId?: string;
	index?: number;
};

// Live drag state — same discriminated-union shape the V12 overlay uses.
// Two distinct drag flavours can be active (the gizmo translates the whole
// section; corner handles deform the polygon), and they're mutually
// exclusive while in flight. Keeping the offset in transient state means the
// underlying model isn't touched until release, so one drag commits as one
// undo entry.
type ActiveDrag =
	| { kind: 'section'; offset: GizmoOffset }
	| { kind: 'corner'; cornerIdx: number; offset: CornerDragOffset };

export const AISectionsLegacyOverlay: WorldOverlayComponent<ParsedAISectionsV4 | ParsedAISectionsV6> = ({
	data, selectedPath, onSelect, onChange, isActive = true, bundleId, index,
}: Props) => {
	const [hoverSectionIndex, setHoverSectionIndex] = useState<number | null>(null);
	const [hoveredEdge, setHoveredEdge] = useState<number | null>(null);
	const [edgeMenu, setEdgeMenu] = useState<
		{ x: number; y: number; sectionIndex: number; edgeIdx: number } | null
	>(null);
	const [drag, setDrag] = useState<ActiveDrag | null>(null);
	const [snapEnabled, setSnapEnabled] = useState(false);

	const legacy = data.legacy;
	const sections = legacy.sections;

	const cameraBridge = useRef<CameraBridgeData | null>(null);
	const aiBulk = useAISectionsBulk();
	// Resolve "this overlay's bulk" via per-instance lookup. Legacy per-page
	// routes don't supply `bundleId`/`index` so they degrade to "no bulk".
	const sectionBulk = useMemo(() => {
		if (!aiBulk || bundleId == null || index == null) return null;
		return aiBulk.forInstance(bundleId, index);
	}, [aiBulk, bundleId, index]);

	const marker = useMemo(() => legacyAISectionPathMarker(selectedPath), [selectedPath]);
	const selectedSectionIndex = marker ? marker.sectionIndex : null;

	// Snap radius scales with the scene — for a typical legacy AI prototype
	// (~200 units across) this lands at ~4 units, matching V12. Walks the
	// parallel cornersX[]/cornersZ[] arrays directly; no Vector2 projection
	// needed for the bounding-sphere computation. Min of 0.5 keeps the snap
	// usable even on tiny synthetic test fixtures.
	const snapRadius = useMemo(() => {
		if (sections.length === 0) return 0.5;
		const box = new THREE.Box3();
		const v = new THREE.Vector3();
		for (const sec of sections) {
			const n = Math.min(sec.cornersX.length, sec.cornersZ.length);
			for (let i = 0; i < n; i++) {
				v.set(sec.cornersX[i], 0, sec.cornersZ[i]);
				box.expandByPoint(v);
			}
		}
		const sphere = new THREE.Sphere();
		box.getBoundingSphere(sphere);
		return Math.max(sphere.radius * 0.02, 0.5);
	}, [sections]);

	// `S` toggles snap mode (matches V12 overlay).
	useToggleHotkey('s', setSnapEnabled);

	const scene = useMemo(() => buildBatchedSections(sections, legacyAccessor), [sections]);

	const selSection = selectedSectionIndex != null ? sections[selectedSectionIndex] ?? null : null;
	const hovSection = hoverSectionIndex != null ? sections[hoverSectionIndex] ?? null : null;

	// Live-preview model: while a drag is in flight, run the relevant op on
	// the live offset so the selection overlay AND any cascaded-neighbour
	// highlights track the cursor. Branches on `drag.kind` — section-translate
	// vs corner-deform are independent ops with different cascade behaviour.
	// Try/catch swallows the edge case where the offset happens to land at
	// exactly (0,0) and the op short-circuits. Mirrors V12's previewModel
	// derivation so both overlays read the same way.
	const previewLegacy: LegacyAISectionsData | null = useMemo(() => {
		if (selectedSectionIndex == null || !selSection || !drag) return null;
		if (drag.offset.x === 0 && drag.offset.z === 0) return null;
		try {
			if (drag.kind === 'section') {
				return translateLegacySectionWithLinks(legacy, selectedSectionIndex, drag.offset);
			}
			return translateLegacyCornerWithShared(legacy, selectedSectionIndex, drag.cornerIdx, drag.offset);
		} catch {
			return null;
		}
	}, [legacy, selectedSectionIndex, selSection, drag]);

	const previewSection = useMemo<LegacyAISection | null>(() => {
		if (!selSection) return null;
		if (!previewLegacy || selectedSectionIndex == null) return selSection;
		return previewLegacy.sections[selectedSectionIndex] ?? selSection;
	}, [selSection, previewLegacy, selectedSectionIndex]);

	const selCorners = useMemo(
		() => (previewSection ? legacyCorners(previewSection) : null),
		[previewSection],
	);
	const hovCorners = useMemo(
		() => (hovSection ? legacyCorners(hovSection) : null),
		[hovSection],
	);

	// Sections other than the dragged one whose corners moved as part of the
	// smart cascade — highlighted in a distinct colour so the user sees which
	// neighbours are deforming or moving with them. Empty when no drag is
	// active or when nothing cascaded. Mirrors the V12 overlay.
	const affectedNeighbours = useMemo<{ idx: number; corners: Corner[] }[]>(() => {
		if (!previewLegacy || selectedSectionIndex == null) return [];
		const out: { idx: number; corners: Corner[] }[] = [];
		for (let i = 0; i < previewLegacy.sections.length; i++) {
			if (i === selectedSectionIndex) continue;
			if (previewLegacy.sections[i] !== legacy.sections[i]) {
				out.push({ idx: i, corners: legacyCorners(previewLegacy.sections[i]) });
			}
		}
		return out;
	}, [previewLegacy, selectedSectionIndex, legacy]);

	// Centre of the selected section's polygon — anchor for the translate
	// gizmo. Computed off `previewSection` so it tracks the live drag.
	const gizmoPosition = useMemo<[number, number, number] | null>(() => {
		if (!previewSection) return null;
		const n = legacyCornerCount(previewSection);
		if (n === 0) return null;
		let sx = 0, sz = 0;
		for (let i = 0; i < n; i++) {
			sx += previewSection.cornersX[i];
			sz += previewSection.cornersZ[i];
		}
		return [sx / n, 1.5, sz / n];
	}, [previewSection]);

	const gizmoPixelSize = 90;
	const cornerHandlePixelSize = 12;

	// 3D click on a section. Same Ctrl/Shift dispatch as V12 — see the V12
	// overlay for the reasoning. The legacy overlay only differs in the
	// schema path shape (marker output uses the `legacy` prefix), not in
	// the bulk-select semantics.
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
				onSelect(legacyAISectionMarkerPath({ kind: 'section', sectionIndex: sectionIdx }));
				return;
			}
			onSelect(legacyAISectionMarkerPath({ kind: 'section', sectionIndex: sectionIdx }));
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
	const noopApplyColor = useCallback(() => {}, []);
	const faceToEntity = useCallback(
		(face: number) =>
			face >= 0 && face < faceToSectionMap.length ? faceToSectionMap[face] : -1,
		[faceToSectionMap],
	);
	const handlers = useBatchedSelection({
		kind: 'section',
		count: sections.length,
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
		onSelect(legacyAISectionMarkerPath({ kind: 'portal', sectionIndex: selectedSectionIndex, portalIndex }));
	}, [onSelect, selectedSectionIndex]);

	const handlePickBoundaryLine = useCallback((portalIndex: number, lineIndex: number) => {
		if (selectedSectionIndex == null) return;
		onSelect(legacyAISectionMarkerPath({ kind: 'boundaryLine', sectionIndex: selectedSectionIndex, portalIndex, lineIndex }));
	}, [onSelect, selectedSectionIndex]);

	const handlePickNoGoLine = useCallback((lineIndex: number) => {
		if (selectedSectionIndex == null) return;
		onSelect(legacyAISectionMarkerPath({ kind: 'noGoLine', sectionIndex: selectedSectionIndex, lineIndex }));
	}, [onSelect, selectedSectionIndex]);

	// Reset transient edge / drag UI when the selected section changes — the
	// hover / open-menu / in-flight drag state belongs to a section, not the
	// overlay. Mirrors V12.
	useResetOnChange(selectedSectionIndex, () => {
		setHoveredEdge(null);
		setEdgeMenu(null);
		setDrag(null);
	});

	// Drag callbacks — gizmo translates the whole section, corner handles
	// deform a single corner. Both go through the smart-cascade ops on commit
	// and emit the new root via onChange. Without onChange the previews still
	// render but the commit is a no-op (read-only mode).
	//
	// Snap is applied on BOTH the live drag (so the preview overlay snaps
	// in real time) and on commit (so the persisted offset matches what the
	// user saw). Mirrors V12's `handleGizmoTranslate` / `handleCornerDrag`.
	const handleGizmoTranslate = useCallback((offset: GizmoOffset) => {
		const finalOffset =
			snapEnabled && selectedSectionIndex != null
				? snapLegacySectionOffset(legacy, selectedSectionIndex, offset, snapRadius)
				: offset;
		setDrag({ kind: 'section', offset: finalOffset });
	}, [snapEnabled, selectedSectionIndex, legacy, snapRadius]);

	const handleGizmoCommit = useCallback((offset: GizmoOffset) => {
		setDrag(null);
		if (selectedSectionIndex == null || !onChange) return;
		const finalOffset = snapEnabled
			? snapLegacySectionOffset(legacy, selectedSectionIndex, offset, snapRadius)
			: offset;
		if (finalOffset.x === 0 && finalOffset.z === 0) return;
		const nextLegacy = translateLegacySectionWithLinks(legacy, selectedSectionIndex, finalOffset);
		// Re-wrap into the discriminated-union root — same shape the page
		// handed us. Mirrors the duplicate-through-edge flow above.
		const nextRoot = { ...data, legacy: nextLegacy } as ParsedAISectionsV4 | ParsedAISectionsV6;
		onChange(nextRoot);
	}, [data, legacy, selectedSectionIndex, onChange, snapEnabled, snapRadius]);

	const handleGizmoCancel = useCallback(() => setDrag(null), []);

	const handleCornerDrag = useCallback((cornerIdx: number, offset: CornerDragOffset) => {
		const finalOffset =
			snapEnabled && selectedSectionIndex != null
				? snapLegacyCornerOffset(legacy, selectedSectionIndex, cornerIdx, offset, snapRadius)
				: offset;
		setDrag({ kind: 'corner', cornerIdx, offset: finalOffset });
	}, [snapEnabled, selectedSectionIndex, legacy, snapRadius]);

	const handleCornerCommit = useCallback((cornerIdx: number, offset: CornerDragOffset) => {
		setDrag(null);
		if (selectedSectionIndex == null || !onChange) return;
		const finalOffset = snapEnabled
			? snapLegacyCornerOffset(legacy, selectedSectionIndex, cornerIdx, offset, snapRadius)
			: offset;
		if (finalOffset.x === 0 && finalOffset.z === 0) return;
		const nextLegacy = translateLegacyCornerWithShared(legacy, selectedSectionIndex, cornerIdx, finalOffset);
		const nextRoot = { ...data, legacy: nextLegacy } as ParsedAISectionsV4 | ParsedAISectionsV6;
		onChange(nextRoot);
	}, [data, legacy, selectedSectionIndex, onChange, snapEnabled, snapRadius]);

	const handleCornerCancel = useCallback(() => setDrag(null), []);

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
		const nextLegacy = duplicateLegacySectionThroughEdge(
			legacy,
			edgeMenu.sectionIndex,
			edgeMenu.edgeIdx,
		);
		// Re-wrap into the discriminated-union root so the page's setAtPath([])
		// receives the same shape it gave us. `version` and `kind` are
		// unchanged — the wrapper exists purely as a structural tag.
		const nextRoot = { ...data, legacy: nextLegacy } as ParsedAISectionsV4 | ParsedAISectionsV6;
		onChange(nextRoot);
		const dupIdx = nextLegacy.sections.length - 1;
		// Defer selection so it lands on the post-update model — avoids a
		// brief flash where the inspector points at the new index but the
		// model still has the old length. Mirrors the V12 overlay's flow.
		requestAnimationFrame(() => {
			onSelect(legacyAISectionMarkerPath({ kind: 'section', sectionIndex: dupIdx }));
		});
		setEdgeMenu(null);
	}, [data, legacy, edgeMenu, onChange, onSelect]);

	// Marquee wiring: pick legacy sections whose corner-centroid is inside the
	// dragged rectangle and union/subtract their schema paths into the
	// workspace bulk. V4/V6 store corners as parallel cornersX/cornersZ arrays
	// (4 each on the wire format), so the centroid is folded via `legacyCorners`
	// — a one-pass adapter to the shared `Corner` shape — and projected onto
	// the Y=0 ground plane (legacy data has no resolved-Y map, matching the
	// detail layer's anchor convention).
	const handleMarquee = useCallback(
		(frustum: THREE.Frustum, mode: 'add' | 'remove') => {
			if (!sectionBulk) return;
			const hits: NodePath[] = [];
			const pt = new THREE.Vector3();
			for (let i = 0; i < sections.length; i++) {
				const corners = legacyCorners(sections[i]);
				if (corners.length === 0) continue;
				let sx = 0, sz = 0;
				for (const c of corners) { sx += c.x; sz += c.z; }
				const n = corners.length;
				pt.set(sx / n, 0, sz / n);
				if (frustum.containsPoint(pt)) hits.push(['legacy', 'sections', i]);
			}
			if (hits.length === 0) return;
			sectionBulk.onApplyPaths(hits, mode);
		},
		[sections, sectionBulk],
	);

	return (
		<>
			<BatchedSections
				scene={scene}
				onClick={handlers.onClick}
				onPointerMove={handlers.onPointerMove}
				onPointerOut={handlers.onPointerOut}
			/>

			{/* Hover blue outline + grey label. */}
			{hovCorners && hovSection && hoverSectionIndex != null && hoverSectionIndex !== selectedSectionIndex && (
				<HoverSectionLayer
					corners={hovCorners}
					labelText={`Sec ${hoverSectionIndex} | ${DANGER_SHORT[hovSection.dangerRating] ?? hovSection.dangerRating}`}
				/>
			)}

			{/* Yellow outline + detail for every bulk member that isn't
			    the inspector pick. Legacy data has no resolved-Y map; the
			    shared layer drops to baseY=0 when sectionYs is omitted. */}
			{sectionBulk && (
				<BulkSectionLayer
					bulkSet={sectionBulk.bulkSet}
					selectedSectionIndex={selectedSectionIndex}
					data={legacy}
					sections={sections}
					cornersOf={legacyCorners}
					accessor={legacyDetailAccessor}
					root={legacy}
				/>
			)}

			{/* Cascade-affected outside neighbours during a drag (orange). */}
			<CascadeNeighbourLayer
				drag={drag}
				affectedNeighbours={affectedNeighbours}
			/>

			{/* Inspector pick — orange outline, label, edge handles,
			    SectionDetail with marker. V4/V6 has no per-endpoint
			    sub-entity selection, so the endpoint pickers are left
			    undefined. */}
			{selectedSectionIndex != null && previewSection && selCorners && (
				<SelectedSectionLayer
					corners={selCorners}
					section={previewSection}
					baseY={0}
					marker={marker}
					root={legacy}
					accessor={legacyDetailAccessor}
					labelText={`Sec ${selectedSectionIndex} | ${DANGER_SHORT[previewSection.dangerRating] ?? previewSection.dangerRating}`}
					hoveredEdge={hoveredEdge}
					onHoverEdge={setHoveredEdge}
					onContextMenu={handleEdgeContextMenu}
					onPickPortal={handlePickPortal}
					onPickBoundaryLine={handlePickBoundaryLine}
					onPickNoGoLine={handlePickNoGoLine}
				/>
			)}

			{gizmoPosition && onChange && drag?.kind !== 'corner' && (
				<TranslateGizmo
					position={gizmoPosition}
					pixelSize={gizmoPixelSize}
					onTranslate={handleGizmoTranslate}
					onCommit={handleGizmoCommit}
					onCancel={handleGizmoCancel}
				/>
			)}

			{selCorners && drag?.kind !== 'section' && (
				<CornerHandles
					corners={selCorners}
					pixelSize={cornerHandlePixelSize}
					onDrag={handleCornerDrag}
					onCommit={handleCornerCommit}
					onCancel={handleCornerCancel}
				/>
			)}

			{/* CameraBridge mirrors camera state out to the marquee selector
			    living in the DOM sibling slot. Lives inside Canvas so it can
			    read three-fiber's per-frame state. Mirrors V12. */}
			<CameraBridge bridge={cameraBridge} />

			<OverlayHtmlSiblings
				isActive={isActive}
				snapEnabled={snapEnabled}
				toggleSnap={() => setSnapEnabled((v) => !v)}
				cameraBridge={cameraBridge}
				onMarquee={handleMarquee}
				edgeMenu={edgeMenu}
				canDuplicate={!!onChange}
				onDuplicateThroughEdge={handleDuplicateThroughEdge}
				onCloseEdgeMenu={() => setEdgeMenu(null)}
			/>
		</>
	);
};

