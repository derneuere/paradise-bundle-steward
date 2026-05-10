// Transform axis descriptors — the data-driven contract that tells the
// **Bulk transform** gizmo which translate/rotate axes are meaningful for
// a given resource family.
//
// Per ADR-0011: AI section corners (Vector2 on XZ), boundary lines (segment
// packed XZ), zone points (Vec2Padded on XZ), and traffic yaw-packed boxes
// have no Y component to receive a pitch (around X) or roll (around Z)
// rotation. Editing those axes would either be silently lossy or require a
// type-promotion at write time, both of which break BND2 byte-for-byte
// writeback. So the gizmo greys out the X and Z rotate rings whenever the
// **Selection** contains any XZ-locked resource.
//
// We keep the descriptor data-driven (per resource family rather than
// hard-coded "AI sections only get yaw") because future slices need to
// handle several other resource families: trigger boxes (full 3-axis,
// Euler-rotated regions), static traffic vehicles (Matrix44, full 3-axis),
// portal anchors as pure points, etc. Each will declare its own
// `TransformAxes` and the same gizmo + reducer will handle them.

/**
 * Per-axis enable flags for translate (which arrows respond to drag) and
 * rotate (which rings respond to drag). The gizmo always renders all three
 * arrows and all three rings for visual consistency — disabled axes render
 * dimmed and don't accept pointer events.
 *
 * The convention "Y is vertical-up" matches the editor's display convention
 * (the disk format stores Z as vertical, but the spatial editor swaps Y↔Z
 * at the display boundary; see `swapYZ` on FieldMetadata). Inside the
 * gizmo and the ops modules we always work in editor-display coordinates
 * (Y-up) and let the IO layer flip at write time.
 */
export type TransformAxes = {
	/** Which translate arrows are interactive. */
	translate: { x: boolean; y: boolean; z: boolean };
	/** Which rotate rings are interactive. Rings for disabled axes render
	 *  visibly greyed-out (per ADR-0011) so users see the affordance but
	 *  can't drive it into a state the data model can't represent. */
	rotate: { x: boolean; y: boolean; z: boolean };
};

/**
 * Full 3-axis translate + 3-axis rotate. Default for resources whose spatial
 * data is genuinely 3D (trigger box regions with Euler rotation, static
 * traffic vehicles with Matrix44, portal anchors as pure points).
 */
export const TRANSFORM_AXES_FULL_3D: TransformAxes = {
	translate: { x: true, y: true, z: true },
	rotate: { x: true, y: true, z: true },
};

/**
 * Full 3-axis translate, yaw-only rotate. Default for resources whose
 * spatial data is XZ-packed 2D — corners/lines/points have no Y component
 * to receive pitch or roll (ADR-0011). Translate Y still works because it
 * shifts the *anchor* heights (e.g. portal anchor `position.y`) without
 * touching the XZ-packed corners.
 *
 * Used today by AI sections; future slices add it to zone points, boundary
 * lines as standalone selections, and traffic yaw-packed boxes.
 */
export const TRANSFORM_AXES_XZ_PACKED: TransformAxes = {
	translate: { x: true, y: true, z: true },
	rotate: { x: false, y: true, z: false },
};

/**
 * Combine the per-resource axes inside a (potentially heterogeneous)
 * **Selection** by AND-ing each flag — an axis is interactive only if
 * every selected resource agrees it should be. This is the rule for
 * cross-resource selections in future slices (e.g. one trigger box + one
 * AI section → AND yields "yaw-only rotate" because the AI section vetoes
 * pitch and roll).
 *
 * Pure function so the **Bulk transform** reducer can compose any
 * cardinality of axes without per-cardinality branching.
 */
export function intersectTransformAxes(
	axes: readonly TransformAxes[],
): TransformAxes {
	if (axes.length === 0) return TRANSFORM_AXES_FULL_3D;
	let tx = true, ty = true, tz = true;
	let rx = true, ry = true, rz = true;
	for (const a of axes) {
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
