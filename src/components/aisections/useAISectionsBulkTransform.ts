// useAISectionsBulkTransform — one-stop V12 transform domain.
//
// The V12 AISections overlay's editing surface is a tight little state
// machine: drag preview, bulk membership flattening, pivot snapshot, gizmo
// anchoring, cross-Bundle commit routing, and numeric-panel session publish
// all interact. This hook owns the whole machine in one place — the overlay
// just renders the JSX with the returned state.
//
// The maths does NOT live here. Every gesture — one corner, one whole section,
// a marquee spanning Bundles — is the same call: expand the Cascade if the
// modifier is on, then `transform(data, refs, delta, resolver)` from
// `@/lib/core/transform`. The old per-target dispatcher (`applyDragToModel`)
// and the seven AI-section-specific ops it routed to are gone.
//
// We accepted "one fat hook" over splitting because the pieces are too coupled
// to live apart without a forest of refs threading state across.
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
	TRANSFORM_AXES_FULL_3D,
	resolverAxes,
	selectionPivot,
	toTransformDelta,
	transform,
	type Point,
	type TransformAxes,
} from '@/lib/core/transform';
import {
	aiSectionRefKey,
	createAISectionsResolver,
	type AISectionRef,
} from '@/lib/core/transform/resolvers/aiSections';
import { expandAISectionsCascade } from '@/lib/core/transform/resolvers/aiSectionsCascade';
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
import type { ActiveDrag } from './aiSectionsDrag.types';
import { markerToAISectionRef } from './aiSectionsRefs';
import {
	deriveAffectedNeighbours,
	derivePreviewCorners,
	derivePreviewModel,
	derivePreviewSection,
} from './aiSectionsPreview';
import { BULK_GIZMO_Y_OFFSET, deriveGizmoPosition } from './aiSectionsGizmoGeometry';

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
	/** True while an in-flight gesture's effective cascade is ON and there is
	 *  something for it to cascade from. Drives the DOM hint. */
	cascadeActive: boolean;
	// bulk derivations
	bulkRefs: readonly AISectionRef[];
	bulkEntityCount: number;
	isBulkActive: boolean;
	bulkSectionIndices: ReadonlySet<number>;
	// preview
	previewModel: ParsedAISectionsV12 | null;
	previewSection: ReturnType<typeof derivePreviewSection>;
	previewCorners: Corner[] | null;
	affectedNeighbours: { idx: number; corners: Corner[] }[];
	// gizmo geometry
	gizmoAnchor: AISectionRef | null;
	gizmoPosition: [number, number, number] | null;
	gizmoAxes: TransformAxes;
	gizmoPixelSize: number;
	// pivot
	bulkPivotLive: Point | null;
	handlePivotMove: (world: Point) => void;
	handlePivotCommit: (world: Point) => void;
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

	// The resolver is a FACTORY bound to the pre-gesture model, because
	// corner / line-endpoint Y is derived (`resolveSectionYs`) rather than
	// stored. `data` never changes mid-gesture — the drag renders against a
	// derived preview — so the derived Ys stay coherent for the whole gesture.
	const resolver = useMemo(() => createAISectionsResolver(data, sectionYs), [data, sectionYs]);

	// =========================================================================
	// Ref flattening (marquee bulkSet + inspector pick → AISectionRef[])
	// =========================================================================

	const markerRef = useMemo(() => markerToAISectionRef(marker), [marker]);

	const bulkRefs = useMemo<readonly AISectionRef[]>(() => {
		const out: AISectionRef[] = [];
		const seen = new Set<string>();
		if (sectionBulk) {
			for (const key of sectionBulk.bulkSet) {
				const parts = key.split(':');
				if (parts[0] !== 'section') continue;
				const idx = Number(parts[1]);
				if (!Number.isFinite(idx) || idx < 0 || idx >= data.sections.length) continue;
				const ref: AISectionRef = { kind: 'section', sectionIdx: idx };
				const k = aiSectionRefKey(ref);
				if (seen.has(k)) continue;
				seen.add(k);
				out.push(ref);
			}
		}
		// Fold the inspector pick in when it is a sub-entity of a section not
		// already in the bulk — mixed-bulk support (whole section + a portal
		// anchor, corner or line endpoint on a different section). Every
		// sub-entity kind is representable now that the three naming families
		// have collapsed into one ref union.
		if (markerRef && markerRef.kind !== 'section') {
			const sIdx = markerRef.sectionIdx;
			if (sIdx >= 0 && sIdx < data.sections.length && !seen.has(`s:${sIdx}`)) {
				out.push(markerRef);
			}
		}
		return out;
	}, [data.sections.length, sectionBulk, markerRef]);

	const bulkEntityCount = useMemo(() => {
		const seen = new Set<string>();
		for (const r of bulkRefs) seen.add(aiSectionRefKey(r));
		return seen.size;
	}, [bulkRefs]);

	const isBulkActive = bulkEntityCount >= 2 || crossBundle.isCrossBundle;

	// What the gizmo actually transforms. A bulk moves its whole ref list; a
	// single pick moves just itself. Whole-line markers land here too and
	// expand to zero slots, which is what suppresses their gizmo.
	const gestureRefs = useMemo<readonly AISectionRef[]>(() => {
		if (isBulkActive) return bulkRefs;
		return markerRef ? [markerRef] : [];
	}, [isBulkActive, bulkRefs, markerRef]);

	/** The entity the gizmo hangs off; null for a bulk (it hangs off the Pivot). */
	const gizmoAnchor = useMemo<AISectionRef | null>(
		() => (isBulkActive ? null : markerRef),
		[isBulkActive, markerRef],
	);

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
	// Pivot — issue #76 (drag) + #81 (numeric panel)
	// =========================================================================

	// Median of every slot the Selection addresses, against the live data (NOT
	// the preview model). Snapshotted at gesture start in `pivotRef` so it
	// doesn't drift mid-rotate.
	const pivotRef = useRef<Point | null>(null);
	const pivotMedian = useMemo<Point | null>(() => {
		// Cross-Bundle bulks anchor at the median across every slice's spatial
		// samples — the cross-Bundle Pivot the controller exposes (issue #80).
		if (useCrossBundlePath) return crossBundle.pivot;
		return selectionPivot(data, gestureRefs, resolver);
	}, [useCrossBundlePath, crossBundle.pivot, data, gestureRefs, resolver]);

	// Pivot drag-reposition / numeric-panel pivot edit share one slot.
	const [bulkPivotOverride, setBulkPivotOverride] = useState<Point | null>(null);
	const [bulkPivotDragging, setBulkPivotDragging] = useState<Point | null>(null);

	// Selection-change reset. Keyed by membership so adding / removing an
	// entity from the Selection drops the manual override.
	const membershipKey = useMemo(
		() => gestureRefs.map(aiSectionRefKey).sort().join('|'),
		[gestureRefs],
	);
	useResetOnChange(membershipKey, () => {
		setBulkPivotOverride(null);
		setBulkPivotDragging(null);
	});

	// Effective pivot. Dragging > committed override > median.
	const bulkPivotLive = useMemo<Point | null>(
		() => bulkPivotDragging ?? bulkPivotOverride ?? pivotMedian,
		[bulkPivotDragging, bulkPivotOverride, pivotMedian],
	);

	// Snap is intentionally not applied on any bulk-transform path (ADR-
	// 0009 / CONTEXT.md). State + hotkey are kept for muscle memory but
	// the value is never consulted in the commit path.
	useToggleHotkey('s', setSnapEnabled);
	useToggleHotkey('c', setCascadeEnabled);

	// =========================================================================
	// Preview derivations
	// =========================================================================

	const selSection = selectedSectionIndex != null ? data.sections[selectedSectionIndex] ?? null : null;

	const previewModel = useMemo(
		() => derivePreviewModel(data, drag, resolver),
		[data, drag, resolver],
	);
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
		() => deriveGizmoPosition(bulkPivotLive, gizmoAnchor, drag?.delta.translate ?? null),
		[bulkPivotLive, gizmoAnchor, drag],
	);
	const gizmoAxes = useMemo(
		() => resolverAxes(gestureRefs, resolver) ?? TRANSFORM_AXES_FULL_3D,
		[gestureRefs, resolver],
	);

	// =========================================================================
	// Gesture handlers
	//
	// The cascade XOR is folded here so `drag.refs` is already the widened
	// list — preview and commit consume the identical refs, and the orange
	// "cascade-affected neighbour" highlight falls out of the reference
	// identity of the sections `transform` left alone.
	// =========================================================================

	const buildFrame = useCallback(
		(delta: BulkTransformDelta, pivot: Point | null): ActiveDrag => {
			const cascade = cascadeEnabled !== !!delta.cascade;
			const refs = cascade ? expandAISectionsCascade(data, gestureRefs) : gestureRefs;
			return {
				refs,
				anchor: gizmoAnchor,
				pivot,
				isBulk: isBulkActive,
				delta: { ...delta, cascade },
			};
		},
		[cascadeEnabled, data, gestureRefs, gizmoAnchor, isBulkActive],
	);

	const handleGizmoTransform = useCallback(
		(delta: BulkTransformDelta) => {
			if (gestureRefs.length === 0) return;
			// Snapshot the Pivot on the first frame so it doesn't drift as we
			// drag (re-deriving the median against moving positions every frame
			// produces a spiral instead of a rigid rotate).
			if (!pivotRef.current) pivotRef.current = bulkPivotLive;
			setDrag(buildFrame(delta, pivotRef.current));
		},
		[gestureRefs.length, bulkPivotLive, buildFrame],
	);

	const handleGizmoCommit = useCallback(
		(delta: BulkTransformDelta) => {
			setDrag(null);
			// Fall back to the live pivot when a commit arrives with no
			// preceding frame, rather than dropping the rotation on the floor.
			const snapshotPivot = pivotRef.current ?? bulkPivotLive;
			pivotRef.current = null;
			if (gestureRefs.length === 0) return;
			if (isIdentityDelta(delta)) return;
			const frame = buildFrame(delta, snapshotPivot);
			// Cross-Bundle bulk gesture (issue #80): route through the
			// workspace-level controller so every affected Bundle is
			// independently dirtied and one multi-Bundle HistoryCommit
			// covers the whole gesture. The active overlay's own bundle is
			// included as one slice among many — the single-Bundle `onChange`
			// path is intentionally skipped here to avoid double-writing.
			if (isBulkActive && useCrossBundlePath && snapshotPivot) {
				// `written === 0` means every slice resolved to a no-op, so no
				// history entry is pushed.
				void crossBundle.commitDelta(
					{ x: snapshotPivot.x, z: snapshotPivot.z },
					{ translate: frame.delta.translate, rotateY: frame.delta.rotate.y },
				);
				return;
			}
			// Single-Bundle path — one setResourceAt → one HistoryCommit.
			if (!onChange) return;
			const next = transform(data, frame.refs, toTransformDelta(frame.delta, frame.pivot), resolver);
			if (next === data) return;
			onChange(next);
		},
		[
			bulkPivotLive, buildFrame, crossBundle, data, gestureRefs.length,
			isBulkActive, onChange, resolver, useCrossBundlePath,
		],
	);

	const handleGizmoCancel = useCallback(() => {
		setDrag(null);
		pivotRef.current = null;
	}, []);

	// =========================================================================
	// Pivot drag-reposition (issue #76)
	// =========================================================================

	// The stored pivot uses underlying-data coordinates, NOT the visualised
	// gizmo position — subtract BULK_GIZMO_Y_OFFSET on incoming gizmo-world
	// positions. Pivot handles are bulk-only, and the bulk lift IS
	// BULK_GIZMO_Y_OFFSET, so this round-trips exactly.
	const handlePivotMove = useCallback(
		(world: Point) => {
			if (!isBulkActive) return;
			setBulkPivotDragging({ x: world.x, y: world.y - BULK_GIZMO_Y_OFFSET, z: world.z });
		},
		[isBulkActive],
	);
	const handlePivotCommit = useCallback(
		(world: Point) => {
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

	const handleSessionSetDelta = useCallback(
		(next: BulkTransformDelta) => {
			if (gestureRefs.length === 0) return;
			if (isIdentityDelta(next)) {
				setDrag(null);
				return;
			}
			// A typed commit is a one-shot, not a multi-frame gesture, so pivot
			// drift can't happen and there is nothing to snapshot.
			setDrag(buildFrame(next, bulkPivotLive));
		},
		[gestureRefs.length, buildFrame, bulkPivotLive],
	);

	const handleSessionCommit = useCallback(
		(typed: BulkTransformDelta) => {
			// Drop any in-flight preview before the commit so the next session
			// state has delta = identity (the "reset to zero after every commit"
			// rule per issue #81 / Blender N panel idiom).
			setDrag(null);
			handleGizmoCommit(typed);
		},
		[handleGizmoCommit],
	);

	const handleSessionSetPivot = useCallback((world: Point) => {
		// Typed pivot edit — same `bulkPivotOverride` slot the pivot-drag
		// handle uses. No undo entry: pivot is part of the Tools surface,
		// not the Workspace history.
		setBulkPivotOverride(world);
	}, []);

	useGizmoSessionPublish({
		isActive,
		// The session pivot is the gizmo's anchor in absolute world coords —
		// the pivot itself, with no +1.5 lift (that's a visual nudge, not part
		// of the typed value the user cares about).
		sessionPivot: gestureRefs.length > 0 ? bulkPivotLive : null,
		sessionKey: isBulkActive
			? `bulk:${bulkEntityCount}`
			: gizmoAnchor
				? aiSectionRefKey(gizmoAnchor)
				: null,
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
		// Cascade only reaches out through whole-section refs; a sub-entity
		// gesture is deliberately the "tear it off the join" one.
		cascadeActive:
			drag != null && drag.delta.cascade === true && drag.refs.some((r) => r.kind === 'section'),
		bulkRefs,
		bulkEntityCount,
		isBulkActive,
		bulkSectionIndices,
		previewModel,
		previewSection,
		previewCorners,
		affectedNeighbours,
		gizmoAnchor,
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
	sessionPivot: Point | null;
	/** Identity of what the gizmo is on, so the panel resets between picks. */
	sessionKey: string | null;
	gizmoAxes: TransformAxes;
	drag: ActiveDrag | null;
	bundleId: string | undefined;
	index: number | undefined;
	setDelta: (next: BulkTransformDelta) => void;
	commit: (typed: BulkTransformDelta) => void;
	setPivot: (world: Point) => void;
}) {
	const setSession = useSetBulkTransformGizmoSession();
	const {
		isActive,
		sessionPivot,
		sessionKey,
		gizmoAxes,
		drag,
		bundleId,
		index,
		setDelta,
		commit,
		setPivot,
	} = opts;

	useEffect(() => {
		if (!isActive || !sessionKey || !sessionPivot) {
			setSession(null);
			return;
		}
		const session: GizmoSession = {
			id: `aiSections::${bundleId ?? '?'}::${index ?? '?'}::${sessionKey}`,
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
		sessionKey,
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
