// Transform-axis profile for zone-list resource entities.
//
// Per ADR-0011, zone points are `Vec2Padded` (XZ on the ground plane, with
// two trailing f32 pad slots preserved verbatim for byte-for-byte BND2
// writeback). They have no Y component to receive pitch (around X) or roll
// (around Z), so any **Selection** containing a zone point auto-disables the
// X/Z rotate rings. Yaw stays enabled because corners orbit cleanly around a
// world-+Y axis.
//
// Translate Y is intentionally still ON: the bulk gizmo always renders a Y
// arrow for visual consistency, and dragging it on a pure-XZ entity is a
// no-op for that entity. Mixed-Selection bulks (zone point + Vector3 ref)
// honour the Y arrow on the 3D members; the zone-point member just discards
// its own Y delta on commit.

import type { TransformAxes } from '../transformAxes';

/**
 * Yaw-only rotate, full 3-axis translate. Same profile AI section corners
 * and boundary lines wear today — the gizmo greys out the X and Z rotate
 * rings whenever any zone point is in the Selection.
 */
export const ZONE_POINT_AXES: TransformAxes = {
	translate: { x: true, y: true, z: true },
	rotate: { x: false, y: true, z: false },
};
