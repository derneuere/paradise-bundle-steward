// Transform-axis profile for street-data resource entities.
//
// `Road.mReferencePosition` is a plain Vector3 (`{ x, y, z }`) — a pure 3D
// anchor point with no rotation field. The bulk gizmo therefore exposes
// full 3-axis translate for it. Rotation is enabled in the *bulk* sense
// (the position orbits the bulk pivot) but disabled for single-entity
// Selections (a point rotating around itself is a no-op, so we hide the
// affordance rather than let the user grab it).
//
// Street refs DO NOT auto-disable any rotate axis when mixed into a bulk —
// they're genuinely 3D, so they don't veto pitch or roll. An XZ-packed
// resource sharing the same bulk does (per ADR-0011) — the intersection in
// `intersectTransformAxes` handles that.

import type { TransformAxes } from '../transformAxes';

/**
 * Single street-data reference position: a pure 3D point. Translate is full
 * 3-axis; rotation is disabled because rotating a point around itself is a
 * no-op.
 */
export const STREET_REF_POSITION_AXES: TransformAxes = {
	translate: { x: true, y: true, z: true },
	rotate: { x: false, y: false, z: false },
};

/**
 * Street ref as a *bulk* contributor — i.e. the entity is one of two-plus
 * Selection members. Rotation is enabled (all three rings) because the
 * position orbits a real pivot; pitch and roll stay enabled too because
 * the data has no XZ-only constraint. The intersection helper will AND
 * these flags with other contributors' profiles.
 */
export const STREET_REF_POSITION_BULK_AXES: TransformAxes = {
	translate: { x: true, y: true, z: true },
	rotate: { x: true, y: true, z: true },
};
