// BulkTransformGizmoSession — workspace-scoped registry that lifts the gizmo's
// staged transform (Δ translate, Δ rotate, Pivot) and its axis profile to a
// place both the in-Canvas gizmo and the inspector-side numeric panel can
// read and write (issue #81).
//
// Why this exists
// ---------------
// The BulkTransformGizmo lives inside the WorldViewport's <Canvas> and drives
// every spatial gesture through `useBulkTransformDrag` — one gesture → one
// undo entry (CONTEXT.md / "Bulk transform"). The numeric panel companion
// renders in the inspector pane, structurally a sibling of the Canvas, but
// needs to:
//
//   1. Read the gesture's live delta so the X/Y/Z number fields update on
//      every drag-frame.
//   2. Write a typed value back as a one-shot commit equivalent to a drag
//      that ended at exactly that delta — same one-undo-per-gesture contract.
//   3. Read the current Pivot in absolute world coords and let the user move
//      it via typed XYZ (no undo entry — pivot moves are not part of the
//      Workspace history; consistent with #76's drag-reposition slice).
//
// The cleanest way is "lift the staged state": the overlay (which owns the
// model) publishes a `GizmoSession` to this context when its gizmo is active;
// the panel reads it and calls back into the session's `setDelta` / `commit`
// / `setPivot`. Drag and typed-edit funnel through the same `commit` callback
// the overlay supplies, so both routes share the existing one-undo contract.
//
// One session is active at a time (per ADR-0010 — exactly one gizmo on
// screen at any moment). Overlays call `setSession(...)` on mount when their
// gizmo is visible and `setSession(null)` when it isn't. The panel renders
// only while `session !== null`.

import {
	createContext,
	useCallback,
	useContext,
	useMemo,
	useState,
	type ReactNode,
} from 'react';
import type { BulkTransformDelta } from '@/hooks/useBulkTransformDrag';
import type { TransformAxes } from '@/lib/core/transformAxes';

// =============================================================================
// Session shape
// =============================================================================

/**
 * The contract every overlay implements to be edited by the numeric panel.
 * Each callback is OWNED BY THE OVERLAY — the overlay decides what "commit a
 * delta" means for its resource family (AI sections route through
 * `applyDragToModel` + `onChange`, future families will route through their
 * own ops modules). The session here just plumbs the calls.
 */
export type GizmoSession = {
	/** Stable identifier for the session — `${bundleId}::${resourceKey}::${index}::${markerKind}`.
	 *  React's `useEffect(... [session.id])` keys on this so panel state resets when the
	 *  user picks a different entity. */
	id: string;
	/** Live staged delta. Zero between gestures; non-zero while a gesture is in
	 *  flight. Updates frame-for-frame during a gizmo drag so the panel's number
	 *  fields can subscribe via React state. */
	delta: BulkTransformDelta;
	/** Absolute world coords of the current Pivot. Live-edited via `setPivot`
	 *  — the panel reads this directly, no internal mirror needed. */
	pivot: { x: number; y: number; z: number };
	/** Axis profile — drives the panel's auto-disable rule (greyed-out rotate
	 *  X/Z when XZ-packed resources are in the Selection, per ADR-0011). */
	axes: TransformAxes;
	/** Set the staged delta — used by the panel during typing to preview the
	 *  in-progress edit on the gizmo and the model preview. Does NOT push to
	 *  history; the overlay will run the same `applyDragToModel`-style preview
	 *  it already runs during a drag. */
	setDelta: (delta: BulkTransformDelta) => void;
	/** Commit a typed delta as a one-shot. Equivalent to the gesture ending at
	 *  exactly this delta — one Workspace-undo entry pushed. After this fires,
	 *  the session's `delta` resets to identity (handled by the overlay's
	 *  existing commit path). */
	commit: (delta: BulkTransformDelta) => void;
	/** Move the Pivot to a new absolute world coordinate. No undo entry — pivot
	 *  edits are part of the Tools surface, not the Workspace history. */
	setPivot: (world: { x: number; y: number; z: number }) => void;
};

// =============================================================================
// Context
// =============================================================================

type Ctx = {
	session: GizmoSession | null;
	setSession: (s: GizmoSession | null) => void;
};

const BulkTransformGizmoSessionContext = createContext<Ctx | null>(null);

/**
 * Provider — mount once at workspace scope so the overlay (deep inside the
 * Canvas) and the numeric panel (inside the inspector pane) read the same
 * value. Provider state is a single nullable `GizmoSession`.
 */
export function BulkTransformGizmoSessionProvider({
	children,
}: {
	children: ReactNode;
}) {
	const [session, setSession] = useState<GizmoSession | null>(null);
	const value = useMemo<Ctx>(() => ({ session, setSession }), [session]);
	return (
		<BulkTransformGizmoSessionContext.Provider value={value}>
			{children}
		</BulkTransformGizmoSessionContext.Provider>
	);
}

/**
 * Hook for consumers (the panel). Returns the current session or null. Throws
 * outside a provider so a missing provider during dev surfaces immediately
 * rather than rendering an empty panel.
 */
export function useBulkTransformGizmoSession(): GizmoSession | null {
	const ctx = useContext(BulkTransformGizmoSessionContext);
	if (!ctx) {
		throw new Error(
			'useBulkTransformGizmoSession must be used inside a BulkTransformGizmoSessionProvider',
		);
	}
	return ctx.session;
}

/**
 * Hook for publishers (the overlay). Returns a stable `setSession` callback
 * the overlay calls from a `useEffect` on every change to its gizmo state.
 * Pulled out as a separate hook so consumers don't get a re-render every
 * time the publisher updates internal state.
 *
 * Tolerant of a missing provider — returns a no-op. This lets the overlay
 * be re-used by tests / future routes that mount it without the
 * Workspace-level provider in scope (the numeric panel just won't appear).
 */
export function useSetBulkTransformGizmoSession(): (s: GizmoSession | null) => void {
	const ctx = useContext(BulkTransformGizmoSessionContext);
	return useCallback(
		(s: GizmoSession | null) => {
			if (!ctx) return;
			ctx.setSession(s);
		},
		[ctx],
	);
}

// =============================================================================
// Helpers exported for the panel + tests
// =============================================================================

/**
 * "Apply a typed pivot edit to a session's pivot." Returns a new pivot
 * vector with `field` replaced by `value`. Helper so the panel doesn't have
 * to know the pivot's internal shape — and the test suite can exercise the
 * typed-edit semantics without mounting React.
 */
export function applyTypedPivotEdit(
	current: { x: number; y: number; z: number },
	field: 'x' | 'y' | 'z',
	value: number,
): { x: number; y: number; z: number } {
	return { ...current, [field]: value };
}

/**
 * "Apply a typed delta edit to a staged delta." Returns a new delta with the
 * named translate or rotate component replaced by `value`. Used by the panel
 * to derive the next staged delta from a single field edit; same shape
 * applies for both the preview update (setDelta) and the commit (commit).
 */
export function applyTypedDeltaEdit(
	current: BulkTransformDelta,
	kind: 'translate' | 'rotate',
	axis: 'x' | 'y' | 'z',
	value: number,
): BulkTransformDelta {
	if (kind === 'translate') {
		return {
			...current,
			translate: { ...current.translate, [axis]: value },
		};
	}
	return {
		...current,
		rotate: { ...current.rotate, [axis]: value },
	};
}
