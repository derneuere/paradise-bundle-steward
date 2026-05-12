// useAISectionsBulkTransform — one-stop V12 transform domain.
//
// The V12 AISections overlay's editing surface has grown into a tight
// little state machine: drag preview, bulk membership flattening, pivot
// snapshot, gizmo target selection, cross-Bundle commit routing, and
// numeric-panel session publish all interact. This hook owns the whole
// machine in one place — the overlay just renders the JSX with the
// returned state.
//
// We accepted "one fat hook" over splitting because the pieces are too
// coupled to live apart without a forest of refs threading state across.
// If it grows past ~600 lines, the user's open question is whether to
// split into 2–3 narrower hooks (e.g. bulk-only, gesture-only, session-
// only). For now it's one place.
//
// Effects: the session publish to `BulkTransformGizmoSessionProvider` is
// extracted into `useGizmoSessionPublish` (file-local) per CLAUDE.md
// "Don't reach for useEffect" — when an effect IS needed (external-store
// sync IS legit), it lives in its own named hook. The same applies to
// the on-unmount session clear.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useResetOnChange } from '@/hooks/useResetOnChange';
import { useToggleHotkey } from '@/hooks/useToggleHotkey';
import type { ParsedAISectionsV12 } from '@/lib/core/aiSections';
import {
	bulkSelectionPivot,
	type AISectionEntityRef,
} from '@/lib/core/aiSectionsOps';
import {
	type BulkTransformDelta,
	identityDelta,
	isIdentityDelta,
} from '@/hooks/useBulkTransformDrag';
import {
	useSetBulkTransformGizmoSession,
	type GizmoSession,
} from '@/components/workspace/BulkTransformGizmoSession';
import type { AISectionsBulkInstanceValue } from '@/components/workspace/AISectionsBulkProvider';
import type { CrossBundleBulkController } from '@/components/workspace/useCrossBundleBulkController';
import type { AISectionMarker, Corner } from '@/components/aisections/shared';
import type { NodePath } from '@/lib/schema/walk';
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
import type { TransformAxes } from '@/lib/core/transformAxes';

type Vec3 = { x: number; y: number; z: number };

export type UseAISectionsBulkTransformOpts = {
	data: ParsedAISectionsV12;
	marker: AISectionMarker;
	selectedSectionIndex: number | null;
	sectionBulk: AISectionsBulkInstanceValue | null;
	isActive: boolean;
	bundleId: string | undefined;
	index: number | undefined;
	crossBundle: CrossBundleBulkController;
	useCrossBundlePath: boolean;
	onChange: ((next: ParsedAISectionsV12) => void) | undefined;
	onSelectMarkerPath: (path: NodePath) => void;
	markerToPath: (marker: AISectionMarker) => NodePath;
	sectionYs: ArrayLike<number>;
};

export type UseAISectionsBulkTransformResult = {
	// transient state
	drag: ActiveDrag | null;
	snapEnabled: boolean;
	toggleSnap: () => void;
	cascadeEnabled: boolean;
	toggleCascade: () => void;
	// bulk derivations
	bulkRefs: readonly AISectionEntityRef[];
	bulkEntityCount: number;
	isBulkActive: boolean;
	bulkSectionIndices: ReadonlySet<number>;
	// preview
	previewModel: ParsedAISectionsV12 | null;
	previewSection: ReturnType<typeof derivePreviewSection>;
	previewCorners: Corner[] | null;
	affectedNeighbours: { idx: number; corners: Corner[] }[];
	// gizmo geometry
	gizmoTarget: DragTarget | null;
	gizmoPosition: [number, number, number] | null;
	gizmoAxes: TransformAxes;
	gizmoPixelSize: number;
	// pivot
	bulkPivotLive: Vec3 | null;
	handlePivotMove: (world: Vec3) => void;
	handlePivotCommit: (world: Vec3) => void;
	handlePivotCancel: () => void;
	// gesture
	handleGizmoTransform: (delta: BulkTransformDelta) => void;
	handleGizmoCommit: (delta: BulkTransformDelta) => void;
	handleGizmoCancel: () => void;
	// transient UI state lifted into the hook so the section-change reset
	// can clear it alongside the drag/pivot state. The overlay reads/writes
	// `hoveredEdge` and `edgeMenu` against these.
	hoveredEdge: number | null;
	setHoveredEdge: (n: number | null) => void;
	edgeMenu: EdgeMenuState | null;
	setEdgeMenu: (m: EdgeMenuState | null) => void;
};

export type EdgeMenuState = {
	x: number;
	y: number;
	sectionIndex: number;
	edgeIdx: number;
};

export function useAISectionsBulkTransform(
	opts: UseAISectionsBulkTransformOpts,
): UseAISectionsBulkTransformResult {
	const {
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
		sectionYs,
	} = opts;

	// =========================================================================
	// Transient state
	// =========================================================================

	const [drag, setDrag] = useState<ActiveDrag | null>(null);
	const [snapEnabled, setSnapEnabled] = useState(false);
	// Sticky cascade toggle. When ON, every gizmo gesture defaults to
	// cascade-with-links (outside reverse-portal anchors + shared corners
	// drag along). The Shift modifier (`drag.delta.cascade`) still acts
	// as a per-gesture inverter — Blender-style "snap on by default, hold
	// Shift for precision" idiom. Effective cascade = cascadeEnabled XOR
	// delta.cascade.
	const [cascadeEnabled, setCascadeEnabled] = useState(false);

	const [hoveredEdge, setHoveredEdge] = useState<number | null>(null);
	const [edgeMenu, setEdgeMenu] = useState<EdgeMenuState | null>(null);

	// =========================================================================
	// Bulk flattening (marquee bulkSet + inspector pick → AISectionEntityRef[])
	// =========================================================================

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
				// follow-up to unify is tracked in the cleanup pass.
			}
		}
		return out;
	}, [data, sectionBulk, marker]);

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
	// the affectedNeighbours render (every bulk member is otherwise painted
	// twice per drag frame — yellow by the bulk-member loop AND orange by
	// the cascade-neighbour loop).
	const bulkSectionIndices = useMemo<ReadonlySet<number>>(() => {
		const out = new Set<number>();
		for (const r of bulkRefs) {
			if (r.kind === 'section') out.add(r.sectionIdx);
		}
		return out;
	}, [bulkRefs]);

	// =========================================================================
	// Pivot state — issue #76 (drag) + #81 (numeric panel)
	// =========================================================================

	// Bulk Pivot — median of every selected entity position. Computed
	// against the live data (NOT the preview model). Snapshotted at gesture
	// start in `bulkPivotRef` so it doesn't drift mid-rotate.
	const bulkPivotRef = useRef<Vec3 | null>(null);
	const bulkPivotMedian = useMemo<Vec3 | null>(() => {
		if (!isBulkActive) return null;
		// Cross-Bundle bulks anchor at the median across every slice's
		// spatial samples — the cross-Bundle Pivot the controller exposes
		// (issue #80 / CONTEXT.md / "Pivot").
		if (useCrossBundlePath) return crossBundle.pivot;
		const yResolver = (idx: number) => (idx < sectionYs.length ? sectionYs[idx] : 0);
		return bulkSelectionPivot(data, bulkRefs, yResolver);
	}, [isBulkActive, useCrossBundlePath, crossBundle.pivot, bulkRefs, data, sectionYs]);

	// Pivot drag-reposition / numeric-panel pivot edit share one slot.
	const [bulkPivotOverride, setBulkPivotOverride] = useState<Vec3 | null>(null);
	const [bulkPivotDragging, setBulkPivotDragging] = useState<Vec3 | null>(null);

	// Selection-change reset. Keyed by bulkRefs membership so adding /
	// removing an entity from the bulk drops the manual override.
	const bulkMembershipKey = useMemo(() => {
		return bulkRefs
			.map((r) => {
				switch (r.kind) {
					case 'section':
						return `s:${r.sectionIdx}`;
					case 'portal':
						return `p:${r.sectionIdx}:${r.portalIdx}`;
					case 'boundaryLineEndpoint':
						return `bl:${r.sectionIdx}:${r.portalIdx}:${r.lineIdx}:${r.end}`;
					case 'noGoLineEndpoint':
						return `ng:${r.sectionIdx}:${r.lineIdx}:${r.end}`;
				}
			})
			.sort()
			.join('|');
	}, [bulkRefs]);
	useResetOnChange(bulkMembershipKey, () => {
		setBulkPivotOverride(null);
		setBulkPivotDragging(null);
	});

	// Effective pivot. Dragging > committed override > median.
	const bulkPivotLive = useMemo<Vec3 | null>(() => {
		if (!isBulkActive) return null;
		return bulkPivotDragging ?? bulkPivotOverride ?? bulkPivotMedian;
	}, [isBulkActive, bulkPivotDragging, bulkPivotOverride, bulkPivotMedian]);

	// =========================================================================
	// Gizmo target — bulk > single-entity (ADR-0010)
	// =========================================================================

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
			// `boundaryLine` / `noGoLine` (whole-line selection) intentionally
			// excluded — no rigid-body sub-op for a whole line yet (issue #73
			// ships per-endpoint translates).
			default:
				return null;
		}
	}, [isBulkActive, bulkRefs, bulkPivotLive, marker, bulkPivotOverride]);

	// Snap is intentionally not applied on any bulk-transform path (ADR-
	// 0009 / CONTEXT.md). State + hotkey are kept for muscle memory but
	// the value is never consulted in the commit path. Issue #75
	// reconsiders snap once cascade is opt-in.
	useToggleHotkey('s', setSnapEnabled);
	useToggleHotkey('c', setCascadeEnabled);

	// =========================================================================
	// Preview derivations
	// =========================================================================

	const selSection = selectedSectionIndex != null ? data.sections[selectedSectionIndex] ?? null : null;
	const selectedSectionY =
		selectedSectionIndex != null && selectedSectionIndex < sectionYs.length
			? sectionYs[selectedSectionIndex]
			: 0;

	const previewModel = useMemo(() => derivePreviewModel(data, drag), [data, drag]);
	const previewSection = useMemo(
		() => derivePreviewSection(selSection, previewModel, selectedSectionIndex),
		[selSection, previewModel, selectedSectionIndex],
	);
	const previewCorners = useMemo(() => derivePreviewCorners(previewSection), [previewSection]);
	const affectedNeighbours = useMemo(
		() => deriveAffectedNeighbours(previewModel, selectedSectionIndex, bulkSectionIndices, data),
		[previewModel, selectedSectionIndex, data, bulkSectionIndices],
	);

	const gizmoPosition = useMemo(
		() => deriveGizmoPosition(gizmoTarget, previewSection, data, selectedSectionY, bulkPivotOverride, drag),
		[gizmoTarget, previewSection, data, selectedSectionY, bulkPivotOverride, drag],
	);
	const gizmoAxes = useMemo(() => deriveGizmoAxes(gizmoTarget), [gizmoTarget]);

	// =========================================================================
	// Gesture handlers (cascade XOR is folded here so downstream consumers
	// see the effective cascade verbatim)
	// =========================================================================

	const handleGizmoTransform = useCallback(
		(delta: BulkTransformDelta) => {
			if (!gizmoTarget) return;
			const resolvedDelta = {
				...delta,
				cascade: cascadeEnabled !== !!delta.cascade,
			};
			if (gizmoTarget.kind === 'bulk') {
				// Snapshot the Pivot on the first frame so it doesn't drift
				// as we drag (re-deriving the median against moving positions
				// every frame produces a spiral instead of a rigid rotate).
				if (!bulkPivotRef.current) bulkPivotRef.current = gizmoTarget.pivot;
				setDrag({
					target: { ...gizmoTarget, pivot: bulkPivotRef.current },
					delta: resolvedDelta,
				});
				return;
			}
			setDrag({ target: gizmoTarget, delta: resolvedDelta });
		},
		[gizmoTarget, cascadeEnabled],
	);

	const handleGizmoCommit = useCallback(
		(delta: BulkTransformDelta) => {
			setDrag(null);
			const snapshotPivot = bulkPivotRef.current;
			bulkPivotRef.current = null;
			if (!gizmoTarget) return;
			if (isIdentityDelta(delta)) return;
			const effectiveDelta = {
				...delta,
				cascade: cascadeEnabled !== !!delta.cascade,
			};
			// Cross-Bundle bulk gesture (issue #80): route through the
			// workspace-level controller so every affected Bundle is
			// independently dirtied and one multi-Bundle HistoryCommit
			// covers the whole gesture. The active overlay's own bundle is
			// included as one slice among many — the single-Bundle `onChange`
			// path is intentionally skipped here to avoid double-writing.
			if (gizmoTarget.kind === 'bulk' && useCrossBundlePath && snapshotPivot) {
				const written = crossBundle.commitDelta(
					{ x: snapshotPivot.x, z: snapshotPivot.z },
					{
						translate: effectiveDelta.translate,
						rotateY: effectiveDelta.rotate.y,
					},
				);
				// `written === 0` means every slice resolved to a no-op
				// (the model-reference identity guard in
				// `buildCrossBundleWrites`). No history entry.
				void written;
				return;
			}
			// Single-Bundle path — one setResourceAt → one HistoryCommit.
			if (!onChange) return;
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
			// HistoryCommit pushed onto the Workspace-undo stack. Cascade-on
			// paths preserve this invariant (one resulting model, one commit).
			onChange(next);
		},
		[data, gizmoTarget, onChange, useCrossBundlePath, crossBundle, cascadeEnabled],
	);

	const handleGizmoCancel = useCallback(() => {
		setDrag(null);
		bulkPivotRef.current = null;
	}, []);

	// =========================================================================
	// Pivot drag-reposition (issue #76)
	// =========================================================================

	// The stored pivot uses underlying-data coordinates, NOT the visualised
	// gizmo position — subtract BULK_GIZMO_Y_OFFSET on incoming gizmo-world
	// positions. Keeps the stored pivot bit-identical to the median
	// computed by `bulkSelectionPivot`.
	const handlePivotMove = useCallback(
		(world: Vec3) => {
			if (!isBulkActive) return;
			setBulkPivotDragging({ x: world.x, y: world.y - BULK_GIZMO_Y_OFFSET, z: world.z });
		},
		[isBulkActive],
	);
	const handlePivotCommit = useCallback(
		(world: Vec3) => {
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
	// Session publish (issue #81) — typed pivot + delta companion
	// =========================================================================

	// Session pivot — the gizmo's anchor projected to "absolute world
	// coords" (the issue's terminology). Bulk uses the snapshotted bulk
	// pivot; sub-entity uses the anchor itself. No +1.5 lift — that's a
	// visual nudge, not part of the typed value the user cares about.
	const sessionPivot = useMemo<Vec3 | null>(() => {
		if (bulkPivotOverride) return bulkPivotOverride;
		if (!gizmoTarget) return null;
		if (gizmoTarget.kind === 'bulk') return gizmoTarget.pivot;
		const liveSection = data.sections[gizmoTarget.sectionIdx];
		if (!liveSection) return null;
		switch (gizmoTarget.kind) {
			case 'section': {
				if (liveSection.corners.length === 0) return null;
				let sx = 0;
				let sz = 0;
				for (const c of liveSection.corners) {
					sx += c.x;
					sz += c.y;
				}
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

	const handleSessionSetDelta = useCallback(
		(next: BulkTransformDelta) => {
			if (!gizmoTarget) return;
			if (isIdentityDelta(next)) {
				setDrag(null);
				return;
			}
			// Same shape as a live drag-frame, but the pivot for a bulk
			// gesture uses whatever the gizmoTarget already carries
			// (override-aware via the memo above). No need to snapshot
			// bulkPivotRef — a typed commit is a one-shot, not a multi-
			// frame gesture, so pivot drift can't happen.
			setDrag({ target: gizmoTarget, delta: next });
		},
		[gizmoTarget],
	);

	const handleSessionCommit = useCallback(
		(typed: BulkTransformDelta) => {
			// Drop any in-flight preview before the commit so the next
			// session state has delta = identity (the "reset to zero after
			// every commit" rule per issue #81 / Blender N panel idiom).
			setDrag(null);
			handleGizmoCommit(typed);
		},
		[handleGizmoCommit],
	);

	const handleSessionSetPivot = useCallback((world: Vec3) => {
		// Typed pivot edit — same `bulkPivotOverride` slot the pivot-drag
		// handle uses. No undo entry: pivot is part of the Tools surface,
		// not the Workspace history.
		setBulkPivotOverride(world);
	}, []);

	useGizmoSessionPublish({
		isActive,
		gizmoTarget,
		sessionPivot,
		gizmoAxes,
		drag,
		bundleId,
		index,
		setDelta: handleSessionSetDelta,
		commit: handleSessionCommit,
		setPivot: handleSessionSetPivot,
	});

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

	// Stable toggle callbacks for the DOM-overlay row.
	const toggleSnap = useCallback(() => setSnapEnabled((v) => !v), []);
	const toggleCascade = useCallback(() => setCascadeEnabled((v) => !v), []);

	return {
		drag,
		snapEnabled,
		toggleSnap,
		cascadeEnabled,
		toggleCascade,
		bulkRefs,
		bulkEntityCount,
		isBulkActive,
		bulkSectionIndices,
		previewModel,
		previewSection,
		previewCorners,
		affectedNeighbours,
		gizmoTarget,
		gizmoPosition,
		gizmoAxes,
		gizmoPixelSize: 90,
		bulkPivotLive,
		handlePivotMove,
		handlePivotCommit,
		handlePivotCancel,
		handleGizmoTransform,
		handleGizmoCommit,
		handleGizmoCancel,
		hoveredEdge,
		setHoveredEdge,
		edgeMenu,
		setEdgeMenu,
	};
}

// ---------------------------------------------------------------------------
// Effect-only sub-hook — issue #81 numeric panel session publish.
//
// The session lives in an external React-context store
// (`BulkTransformGizmoSessionProvider`), so `useSyncExternalStore` doesn't
// apply: we're WRITING to the store, not reading from it. Per CLAUDE.md
// "Don't reach for useEffect" the publish lives in its own named hook —
// the rare legit effect, isolated at its hook's site.
//
// Two effects: (1) publish whenever the session observables change,
// (2) clear on unmount so the panel hides itself when the overlay drops
// out of the scene composition.
// ---------------------------------------------------------------------------

function useGizmoSessionPublish(opts: {
	isActive: boolean;
	gizmoTarget: DragTarget | null;
	sessionPivot: Vec3 | null;
	gizmoAxes: TransformAxes;
	drag: ActiveDrag | null;
	bundleId: string | undefined;
	index: number | undefined;
	setDelta: (next: BulkTransformDelta) => void;
	commit: (typed: BulkTransformDelta) => void;
	setPivot: (world: Vec3) => void;
}) {
	const setSession = useSetBulkTransformGizmoSession();
	const {
		isActive,
		gizmoTarget,
		sessionPivot,
		gizmoAxes,
		drag,
		bundleId,
		index,
		setDelta,
		commit,
		setPivot,
	} = opts;

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
			setDelta,
			commit,
			setPivot,
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
		setDelta,
		commit,
		setPivot,
		setSession,
	]);

	// Clear the session on unmount — happens when the user navigates the
	// inspector to a non-world resource and the overlay drops out of the
	// scene composition.
	useEffect(() => {
		return () => setSession(null);
	}, [setSession]);
}
