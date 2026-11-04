// The shape the V12 overlay uses to describe one in-flight gizmo gesture.
//
// A gesture is a ref list, a Pivot snapshot and the staged delta — exactly the
// three things `transform(model, refs, delta, resolver)` consumes. There is no
// per-target dispatcher any more: whole sections, sub-entities and multi-entity
// bulks differ only in which refs are in the list.
//
// `refs` is already **Cascade**-expanded when the modifier is on, because
// cascade widens the ref list rather than changing the maths (ADR-0009). The
// expansion happens once, against the pre-gesture model, at the moment the
// gesture frame is built — so preview and commit cannot disagree.

import type { Point } from '@/lib/core/transform';
import type { AISectionRef } from '@/lib/core/transform/resolvers/aiSections';
import type { BulkTransformDelta } from '@/hooks/useBulkTransformDrag';

export type ActiveDrag = {
	/** Everything the gesture moves, cascade included. */
	refs: readonly AISectionRef[];
	/** The single entity the gizmo hangs off, or null for a multi-entity bulk
	 *  (whose gizmo hangs off the Pivot). Drives the visual Y lift only. */
	anchor: AISectionRef | null;
	/** Pivot latched at gesture start. Re-deriving it per frame from already-
	 *  moved positions turns a rigid rotate into a spiral. */
	pivot: Point | null;
	/** True for the multi-entity / cross-Bundle path — the bulk render layers
	 *  key off it. */
	isBulk: boolean;
	delta: BulkTransformDelta;
};
