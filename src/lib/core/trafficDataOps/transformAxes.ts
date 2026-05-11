// Transform-axis profile for traffic-data resource entities.
//
// Per ADR-0011, most traffic-data entities are XZ-packed and therefore
// yaw-only on rotate:
//
//   - Yaw-packed Vector4 boxes (junction logic boxes, light triggers,
//     traffic-light collection elements, corona positions) carry `(x, y, z,
//     yaw)` and rotate around world +Y only — pitch/roll have no `.w` slot
//     to land in, so they auto-disable.
//   - Lane rungs hold two Vector4 endpoints whose Y is interpreted as
//     terrain height. The rung is a horizontal segment between two world
//     points; rotating it out of the XZ plane breaks the lane topology, so
//     pitch/roll auto-disable. (We retain Y on translate so a user
//     repositioning a rung between two elevation tiers can shift it
//     vertically — the inspector numeric fields can still edit Y directly.)
//
// Static traffic vehicles (issue #78) are the exception — their pose is a
// full `Matrix44Affine` so all three rotate axes have somewhere to land,
// and the gizmo offers all three rings interactive when the Selection is
// pure-static-vehicle (or mixed only with other full-3D contributors like
// trigger boxes). The auto-disable intersection in
// `intersectTransformAxes` collapses back to yaw-only as soon as a
// yaw-packed sibling joins the Selection.

import { TRANSFORM_AXES_FULL_3D, type TransformAxes } from '../transformAxes';

/**
 * Traffic yaw-packed Vector4 box / element: full 3-axis translate, yaw-only
 * rotate. The `.w` field receives the yaw delta; `.x/.y/.z` orbit the bulk
 * pivot on a yaw rotate (rigid-body composition).
 */
export const TRAFFIC_YAW_PACKED_AXES: TransformAxes = {
	translate: { x: true, y: true, z: true },
	rotate: { x: false, y: true, z: false },
};

/**
 * Traffic lane rung: full 3-axis translate, yaw-only rotate. Same profile
 * as the yaw-packed boxes — the two endpoints together act as a horizontal
 * segment, and rotating them out of the XZ plane has no on-disk meaning.
 */
export const TRAFFIC_LANE_RUNG_AXES: TransformAxes = {
	translate: { x: true, y: true, z: true },
	rotate: { x: false, y: true, z: false },
};

/**
 * Traffic static vehicle (`mTransform` Matrix44Affine): full 3-axis
 * translate AND full 3-axis rotate. Static vehicles are the only Matrix44
 * resource in the traffic-data family — they have somewhere to land all
 * three rotate axes (the rotation portion of the 4×4), so the gizmo
 * exposes pitch, yaw, and roll rings whenever the Selection is purely
 * static-vehicle or mixed only with other full-3D contributors.
 */
export const TRAFFIC_STATIC_VEHICLE_AXES: TransformAxes = TRANSFORM_AXES_FULL_3D;
