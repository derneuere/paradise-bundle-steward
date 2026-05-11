// TransformAxes contributions from trigger-box entities.
//
// Trigger-box regions (Landmark / Generic / Blackspot / VFXBox) store
// position as `Vector3` AND rotation as an Euler `Vector3` in radians, so
// every box is genuinely 3D-rotation-capable — the gizmo exposes all three
// translate arrows AND all three rotate rings for a pure trigger-box
// Selection (per ADR-0011). RoamingLocation and SpawnLocation expose a
// `Vector4` position but no rotation field, so they translate-only.
//
// The auto-disable rule from ADR-0011 still applies when a trigger box is
// mixed with an XZ-packed resource (e.g. an AI section corner) — the gizmo
// AND-intersects per-resource axes, and the XZ-packed contribution forces
// yaw-only. The intersection happens in `intersectTransformAxes` from
// `@/lib/core/transformAxes`; this module just supplies the trigger-box
// half of the input.
//
// We keep one bulk-axes helper (analogous to `bulkAISectionsAxes`) so the
// overlay can ask "what's the AND-intersection across all trigger-box refs
// in this Selection?" and the overlay's final pass widens the rings only
// when the bulk is purely trigger boxes. Future slices (#78 Matrix44 traffic
// vehicles, #79 other XZ-packed resources) drop in as sibling adapters; the
// caller AND-intersects everything before passing the result to
// `BulkTransformGizmo`.

import {
	TRANSFORM_AXES_FULL_3D,
	type TransformAxes,
} from '../transformAxes';
import type { TriggerBoxEntityRef } from './bulk';

/**
 * Per-trigger-box-ref TransformAxes. Boxes contribute full 3D translate +
 * full 3D Euler rotate; roaming / spawn locations contribute full 3D
 * translate but no rotation (single-point locations have no orientation
 * field in the data model, so rotating them around their own position is
 * a no-op — we render the rings disabled to match the data).
 *
 * Exported so the overlay can map each ref independently (e.g. when an
 * inspector pick lands on a roaming dot, we still want to show the
 * translate arrows but hide the rotate rings).
 */
export function triggerBoxRefAxes(ref: TriggerBoxEntityRef): TransformAxes {
	switch (ref.kind) {
		case 'landmark':
		case 'generic':
		case 'blackspot':
		case 'vfx':
			return TRANSFORM_AXES_FULL_3D;
		case 'roaming':
		case 'spawn':
			// Single-point locations: full 3D translate, no rotation rings.
			// We render rotate-disabled rather than full-3D-yet-no-op so the
			// affordance is honest.
			return {
				translate: { x: true, y: true, z: true },
				rotate: { x: false, y: false, z: false },
			};
	}
}

/**
 * AND-intersection of every trigger-box ref's TransformAxes contribution
 * across a multi-Selection. Returns `null` for an empty refs list so the
 * caller can fall back to showing no gizmo. Matches the shape of
 * `bulkAISectionsAxes` so the overlay's wiring is symmetric.
 *
 * A pure trigger-box-only Selection (just BoxRegions: Landmark / Generic /
 * Blackspot / VFX) returns full 3D translate + full 3D rotate. As soon as
 * a roaming or spawn ref joins, rotate rings collapse to disabled (no
 * orientation to rotate). When the overlay then AND-intersects this with
 * (say) `bulkAISectionsAxes` for a mixed Selection containing an AI corner,
 * pitch and roll collapse further per ADR-0011.
 */
export function bulkTriggerBoxAxes(
	refs: readonly TriggerBoxEntityRef[],
): TransformAxes | null {
	if (refs.length === 0) return null;
	let tx = true, ty = true, tz = true;
	let rx = true, ry = true, rz = true;
	for (const ref of refs) {
		const a = triggerBoxRefAxes(ref);
		tx = tx && a.translate.x;
		ty = ty && a.translate.y;
		tz = tz && a.translate.z;
		rx = rx && a.rotate.x;
		ry = ry && a.rotate.y;
		rz = rz && a.rotate.z;
	}
	return {
		translate: { x: tx, y: ty, z: tz },
		rotate: { x: rx, y: ry, z: rz },
	};
}
