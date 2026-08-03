// Where the V12 gizmo hangs in world space.
//
// The anchor itself is the **Pivot** the shared transform core computed — one
// median over the same deduped slot list the gesture will move — so this file
// no longer re-derives any geometry. All that is left is the VISUAL Y lift,
// which is the whole reason it still exists: the lift must never reach
// `resolve()`, or it would land in the pivot and, one gesture later, in the
// file. Keeping it here, at the render boundary, makes that structural.
//
// Lift per anchor kind:
//   - bulk / section / corner → +1.5, clear of the section fill mesh.
//   - boundary + no-go line endpoints → +0.5; they sit on the section's
//     derived ground Y and need only a hairline to avoid z-fighting.
//   - portal anchor → none. Its Y is real 3D data the inspector edits, and the
//     handle has to sit exactly on the value the user is typing.

import type { Point } from '@/lib/core/transform';
import type { AISectionRef } from '@/lib/core/transform/resolvers/aiSections';

export const BULK_GIZMO_Y_OFFSET = 1.5;
export const LINE_GIZMO_Y_OFFSET = 0.5;

/** `null` means "bulk" — a multi-entity gesture hangs off the Pivot, which is
 *  a synthetic point rather than any one entity. */
export function gizmoYLift(anchor: AISectionRef | null): number {
	if (!anchor) return BULK_GIZMO_Y_OFFSET;
	switch (anchor.kind) {
		case 'section':
		case 'corner':
			return BULK_GIZMO_Y_OFFSET;
		case 'boundaryLineEndpoint':
		case 'noGoLineEndpoint':
			return LINE_GIZMO_Y_OFFSET;
		default:
			return 0;
	}
}

/**
 * Anchor the gizmo at `pivot`, lifted, riding along the in-flight translate.
 * Rotation does not move it — the pivot IS the fixed point a rigid body turns
 * around.
 */
export function deriveGizmoPosition(
	pivot: Point | null,
	anchor: AISectionRef | null,
	translate: { x: number; y: number; z: number } | null,
): [number, number, number] | null {
	if (!pivot) return null;
	const d = translate ?? { x: 0, y: 0, z: 0 };
	return [pivot.x + d.x, pivot.y + gizmoYLift(anchor) + d.y, pivot.z + d.z];
}
