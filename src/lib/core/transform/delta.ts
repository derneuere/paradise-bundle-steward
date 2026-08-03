// Adapter from the gizmo's drag delta to the core's `TransformDelta`, so that
// no overlay ever hand-rolls the pivot arithmetic again.

import type { Point, Rotation, TransformDelta } from './types';

/**
 * The subset of `BulkTransformDelta` (`@/hooks/useBulkTransformDrag`) that the
 * maths needs. Declared structurally rather than imported so `src/lib/core`
 * keeps its no-UI-dependency rule — a `BulkTransformDelta` satisfies it
 * directly, and its UI-only `cascade` flag is deliberately absent because
 * cascade changes the REF LIST above `transform()`, not the delta.
 */
export type GestureDelta = {
	translate: Point;
	rotate: Rotation;
};

/**
 * `pivot` is the overlay's gesture-start snapshot (latched on the first
 * `onTransform` frame, reused for every later frame and for the commit,
 * cleared on commit/cancel). Pass null only outside a gesture — `transform()`
 * then falls back to the live slot median rather than silently dropping the
 * rotation, which is what a commit arriving with no preceding frame used to do.
 */
export function toTransformDelta(d: GestureDelta, pivot: Point | null): TransformDelta {
	return { translate: d.translate, rotate: d.rotate, pivot };
}
