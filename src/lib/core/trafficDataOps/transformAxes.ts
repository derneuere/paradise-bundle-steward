// Transform-axis profile for traffic-data resource entities.
//
// Per ADR-0011, every entity covered by this module has spatial data that
// is XZ-packed in some way:
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
// Static traffic vehicles are full-3D `Matrix44` and live in a separate
// module (issue #78) — they DO NOT auto-disable pitch or roll.

import type { TransformAxes } from '../transformAxes';

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
