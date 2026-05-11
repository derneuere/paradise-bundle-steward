// Bulk-transform no-cascade ops (V12 retail).
//
// The "rigid" / no-cascade ops the gizmo routes through when the user has
// NOT held the cascade modifier. Outside neighbours stay completely put —
// the stale-mirror state ADR-0009 accepts as the v1 default. Mirrors the
// `bulk*` ops below for cardinality-1 selections; the cascade-on siblings
// (`translateSectionWithLinks`, `rotateSectionWithLinksYaw`, etc.) live in
// `translateLinks.ts`.

import type {
	AISection,
	BoundaryLine,
	ParsedAISectionsV12,
	Portal,
} from '../aiSections';
import { centroid } from './_helpers';

// =============================================================================
// Bulk-transform: no-cascade rigid translate + yaw rotate
// =============================================================================
//
// The Bulk-transform feature (CONTEXT.md / "Bulk transform", ADR-0009 /
// ADR-0010 / ADR-0011) replaces the legacy single-section drag with a unified
// gizmo whose default behaviour is "move what you selected; modifier extends
// to connected geometry." These ops are the *no-cascade* path:
//
//   - `translateSectionRigid` — translate one section's corners + portal
//     anchors + portal boundary lines + no-go lines by `(dx, dy, dz)`.
//     Outside neighbours stay completely put. Y shifts the portal anchor
//     heights but NOT the corners (they're XZ-packed Vector2 — see ADR-0011);
//     the boundary lines and no-go lines are also XZ-only.
//
//   - `rotateSectionAroundCentroidYaw` — rotate the section as a rigid body
//     around its own centroid (cardinality-1 pivot per CONTEXT.md / "Pivot")
//     by an angle θ around world +Y (yaw). Corners + portal positions +
//     portal boundary lines + no-go lines all rotate together; relative
//     geometry is preserved exactly. Pitch/roll are not exposed by this op
//     because the section's spatial data is XZ-packed (ADR-0011); future
//     resource families with full 3D rotation use a different op.
//
// Cascade-on remains the legacy `translateSectionWithLinks` path; the
// follow-up cascade-modifier slice (#75) wires it to the modifier press.

/**
 * Translate one AI section as a rigid body — no cascade into neighbours.
 *
 * Every spatial field on the source section shifts by `(dx, dy, dz)`:
 *   - corners (Vector2 — XZ only; `dy` does not apply)
 *   - portals[].position (Vector3 — full 3D)
 *   - portals[].boundaryLines[].verts (Vector4 packed XZ start/end — XZ only)
 *   - noGoLines[].verts (same shape as portal boundary lines — XZ only)
 *
 * Outside neighbours stay completely put. Their reverse-portal `linkSection`
 * still points at this section by index, but the world-space anchor will
 * be out of sync with the moved section's portal — accepted per ADR-0009.
 * The cascade-on path is `translateSectionWithLinks` (separate function).
 *
 * Returns the original `model` reference when `(dx, dy, dz) === (0, 0, 0)`
 * so byte-for-byte BND2 writeback is preserved on a no-op gesture.
 *
 * @throws RangeError if `srcIdx` is out of range.
 */
export function translateSectionRigid(
	model: ParsedAISectionsV12,
	srcIdx: number,
	offset: { x: number; y: number; z: number },
): ParsedAISectionsV12 {
	if (srcIdx < 0 || srcIdx >= model.sections.length) {
		throw new RangeError(`srcIdx ${srcIdx} out of range [0, ${model.sections.length})`);
	}
	const dx = offset.x;
	const dy = offset.y;
	const dz = offset.z;
	if (dx === 0 && dy === 0 && dz === 0) return model;

	const src = model.sections[srcIdx];
	const next: AISection = {
		...src,
		corners: src.corners.map((c) => ({ x: c.x + dx, y: c.y + dz })),
		portals: src.portals.map((p) => ({
			...p,
			position: { x: p.position.x + dx, y: p.position.y + dy, z: p.position.z + dz },
			boundaryLines: p.boundaryLines.map((bl) => ({
				verts: { x: bl.verts.x + dx, y: bl.verts.y + dz, z: bl.verts.z + dx, w: bl.verts.w + dz },
			})),
		})),
		noGoLines: src.noGoLines.map((bl) => ({
			verts: { x: bl.verts.x + dx, y: bl.verts.y + dz, z: bl.verts.z + dx, w: bl.verts.w + dz },
		})),
	};

	const sections = model.sections.map((s, i) => (i === srcIdx ? next : s));
	return { ...model, sections };
}

// =============================================================================
// Bulk-transform: no-cascade sub-entity translates (issue #73)
// =============================================================================
//
// Single-sub-entity siblings of `translateSectionRigid` for the unified gizmo
// when the **Selection** is a sub-path (one corner, one portal anchor, one
// boundary-line endpoint, one no-go-line endpoint). Default-off cascade per
// ADR-0009 — these ops touch ONLY the named sub-entity. The shared-corner
// cascade (`translateCornerWithShared`) stays in this module as the
// modifier-on path for issue #75.

/**
 * Translate one polygon corner by an XZ offset — no cascade.
 *
 * Only `model.sections[srcIdx].corners[cornerIdx]` moves. Coincident corners
 * on neighbour sections, boundary-line endpoints elsewhere in the model that
 * happen to share the dragged point, and the section's own portal anchors
 * all stay put — the source corner is "torn off" any shared join it
 * participates in. The cascade-on path that drags coincident corners +
 * boundary-line endpoints together is `translateCornerWithShared`, retained
 * for the modifier-on slice (#75).
 *
 * Y is intentionally absent from the offset — corners are `Vector2` (XZ-only;
 * see ADR-0011), so a Y translate would have nowhere to land. The gizmo's
 * Y arrow is still rendered (the XZ-packed axes profile leaves translate.y
 * on) but the wire-up in `AISectionsOverlay` discards a sub-entity gizmo's
 * Y delta for corners. See ADR-0011 / CONTEXT.md / "Pivot".
 *
 * Returns the original `model` reference when `(dx, dz) === (0, 0)` so
 * byte-for-byte BND2 writeback is preserved on a no-op gesture.
 *
 * @throws RangeError if `srcIdx` or `cornerIdx` is out of range.
 */
export function translateCornerRigid(
	model: ParsedAISectionsV12,
	srcIdx: number,
	cornerIdx: number,
	offset: { x: number; z: number },
): ParsedAISectionsV12 {
	if (srcIdx < 0 || srcIdx >= model.sections.length) {
		throw new RangeError(`srcIdx ${srcIdx} out of range [0, ${model.sections.length})`);
	}
	const src = model.sections[srcIdx];
	if (cornerIdx < 0 || cornerIdx >= src.corners.length) {
		throw new RangeError(`cornerIdx ${cornerIdx} out of range [0, ${src.corners.length})`);
	}
	const dx = offset.x;
	const dz = offset.z;
	if (dx === 0 && dz === 0) return model;

	const next: AISection = {
		...src,
		corners: src.corners.map((c, i) => (i === cornerIdx ? { x: c.x + dx, y: c.y + dz } : c)),
	};
	const sections = model.sections.map((s, i) => (i === srcIdx ? next : s));
	return { ...model, sections };
}

/**
 * Translate one portal anchor by a 3D offset — no cascade.
 *
 * Only `model.sections[srcIdx].portals[portalIdx].position` moves. The
 * portal's boundary lines, the section's corners, and the linked section's
 * reverse portal all stay put — the anchor is "torn off" its mirror twin,
 * leaving the stale-mirror state ADR-0009 accepts as a v1 trade-off.
 * Portal anchor is a `Vector3`, so full 3D motion is permitted.
 *
 * Returns the original `model` reference when the offset is identity so
 * byte-for-byte BND2 writeback is preserved on a no-op gesture.
 *
 * @throws RangeError if `srcIdx` or `portalIdx` is out of range.
 */
export function translatePortalAnchorRigid(
	model: ParsedAISectionsV12,
	srcIdx: number,
	portalIdx: number,
	offset: { x: number; y: number; z: number },
): ParsedAISectionsV12 {
	if (srcIdx < 0 || srcIdx >= model.sections.length) {
		throw new RangeError(`srcIdx ${srcIdx} out of range [0, ${model.sections.length})`);
	}
	const src = model.sections[srcIdx];
	if (portalIdx < 0 || portalIdx >= src.portals.length) {
		throw new RangeError(`portalIdx ${portalIdx} out of range [0, ${src.portals.length})`);
	}
	const dx = offset.x;
	const dy = offset.y;
	const dz = offset.z;
	if (dx === 0 && dy === 0 && dz === 0) return model;

	const srcPortal = src.portals[portalIdx];
	const updatedPortal: Portal = {
		...srcPortal,
		position: {
			x: srcPortal.position.x + dx,
			y: srcPortal.position.y + dy,
			z: srcPortal.position.z + dz,
		},
	};
	const next: AISection = {
		...src,
		portals: src.portals.map((p, i) => (i === portalIdx ? updatedPortal : p)),
	};
	const sections = model.sections.map((s, i) => (i === srcIdx ? next : s));
	return { ...model, sections };
}

/**
 * Translate one endpoint of one portal-boundary-line by an XZ offset — no
 * cascade.
 *
 * The boundary line's `verts` is a packed `Vector4`: `(x, y)` is the start
 * XZ pair, `(z, w)` is the end XZ pair. `endIdx === 0` moves the start;
 * `endIdx === 1` moves the end. The other endpoint stays put — the line
 * deforms (stretches or rotates around the fixed endpoint) rather than
 * translating wholesale. Neither the portal's anchor nor any section corners
 * follow along.
 *
 * Returns the original `model` reference when `(dx, dz) === (0, 0)` so
 * byte-for-byte BND2 writeback is preserved on a no-op gesture.
 *
 * @throws RangeError if any index is out of range, or if `endIdx` is not 0 or 1.
 */
export function translateBoundaryLineEndpointRigid(
	model: ParsedAISectionsV12,
	srcIdx: number,
	portalIdx: number,
	lineIdx: number,
	endIdx: number,
	offset: { x: number; z: number },
): ParsedAISectionsV12 {
	if (srcIdx < 0 || srcIdx >= model.sections.length) {
		throw new RangeError(`srcIdx ${srcIdx} out of range [0, ${model.sections.length})`);
	}
	const src = model.sections[srcIdx];
	if (portalIdx < 0 || portalIdx >= src.portals.length) {
		throw new RangeError(`portalIdx ${portalIdx} out of range [0, ${src.portals.length})`);
	}
	const srcPortal = src.portals[portalIdx];
	if (lineIdx < 0 || lineIdx >= srcPortal.boundaryLines.length) {
		throw new RangeError(`lineIdx ${lineIdx} out of range [0, ${srcPortal.boundaryLines.length})`);
	}
	if (endIdx !== 0 && endIdx !== 1) {
		throw new RangeError(`endIdx ${endIdx} must be 0 (start) or 1 (end)`);
	}
	const dx = offset.x;
	const dz = offset.z;
	if (dx === 0 && dz === 0) return model;

	const srcLine = srcPortal.boundaryLines[lineIdx];
	const v = srcLine.verts;
	const updatedLine: BoundaryLine = {
		verts: endIdx === 0
			? { x: v.x + dx, y: v.y + dz, z: v.z, w: v.w }
			: { x: v.x, y: v.y, z: v.z + dx, w: v.w + dz },
	};
	const updatedPortal: Portal = {
		...srcPortal,
		boundaryLines: srcPortal.boundaryLines.map((bl, i) => (i === lineIdx ? updatedLine : bl)),
	};
	const next: AISection = {
		...src,
		portals: src.portals.map((p, i) => (i === portalIdx ? updatedPortal : p)),
	};
	const sections = model.sections.map((s, i) => (i === srcIdx ? next : s));
	return { ...model, sections };
}

/**
 * Translate one endpoint of one no-go-line by an XZ offset — no cascade.
 *
 * Same shape as {@link translateBoundaryLineEndpointRigid} but operates on
 * `section.noGoLines[lineIdx]` instead of `portal.boundaryLines[lineIdx]`.
 *
 * Returns the original `model` reference when `(dx, dz) === (0, 0)` so
 * byte-for-byte BND2 writeback is preserved on a no-op gesture.
 *
 * @throws RangeError if any index is out of range, or if `endIdx` is not 0 or 1.
 */
export function translateNoGoLineEndpointRigid(
	model: ParsedAISectionsV12,
	srcIdx: number,
	lineIdx: number,
	endIdx: number,
	offset: { x: number; z: number },
): ParsedAISectionsV12 {
	if (srcIdx < 0 || srcIdx >= model.sections.length) {
		throw new RangeError(`srcIdx ${srcIdx} out of range [0, ${model.sections.length})`);
	}
	const src = model.sections[srcIdx];
	if (lineIdx < 0 || lineIdx >= src.noGoLines.length) {
		throw new RangeError(`lineIdx ${lineIdx} out of range [0, ${src.noGoLines.length})`);
	}
	if (endIdx !== 0 && endIdx !== 1) {
		throw new RangeError(`endIdx ${endIdx} must be 0 (start) or 1 (end)`);
	}
	const dx = offset.x;
	const dz = offset.z;
	if (dx === 0 && dz === 0) return model;

	const srcLine = src.noGoLines[lineIdx];
	const v = srcLine.verts;
	const updatedLine: BoundaryLine = {
		verts: endIdx === 0
			? { x: v.x + dx, y: v.y + dz, z: v.z, w: v.w }
			: { x: v.x, y: v.y, z: v.z + dx, w: v.w + dz },
	};
	const next: AISection = {
		...src,
		noGoLines: src.noGoLines.map((bl, i) => (i === lineIdx ? updatedLine : bl)),
	};
	const sections = model.sections.map((s, i) => (i === srcIdx ? next : s));
	return { ...model, sections };
}

/**
 * Rotate one AI section as a rigid body around its own centroid by `theta`
 * radians of yaw (rotation about world +Y). No cascade into neighbours.
 *
 * Pivot is the section's corner-centroid (cardinality-1 default per
 * CONTEXT.md / "Pivot"). All spatial fields rotate as a single rigid body so
 * relative distances between corners, portal positions, and line endpoints
 * are preserved exactly:
 *
 *   - corners (Vector2 / XZ): rotated around (cx, cz).
 *   - portals[].position (Vector3): X/Z rotated around (cx, cz); Y unchanged
 *     (yaw doesn't move things vertically).
 *   - portals[].boundaryLines[].verts (Vector4 / packed XZ start/end): both
 *     endpoints rotated independently — keeps the line as the same world
 *     segment relative to the corners.
 *   - noGoLines[].verts: same as portal boundary lines.
 *
 * Returns the original `model` reference when `theta === 0` so byte-for-byte
 * BND2 writeback is preserved on a no-op gesture.
 *
 * Yaw direction follows the right-hand rule with thumb along world +Y, so a
 * positive `theta` rotates the +X axis towards +Z (the same convention
 * three.js uses for `Object3D.rotation.y`).
 *
 * @throws RangeError if `srcIdx` is out of range.
 */
export function rotateSectionAroundCentroidYaw(
	model: ParsedAISectionsV12,
	srcIdx: number,
	theta: number,
): ParsedAISectionsV12 {
	if (srcIdx < 0 || srcIdx >= model.sections.length) {
		throw new RangeError(`srcIdx ${srcIdx} out of range [0, ${model.sections.length})`);
	}
	if (theta === 0) return model;

	const src = model.sections[srcIdx];
	if (src.corners.length === 0) return model;

	// Pivot = section centroid. AISection.Vector2 stores world XZ in `(x, y)`,
	// so the centroid's `(cx, cz)` lives in `(centre.x, centre.y)`.
	const c = centroid(src.corners);
	const cx = c.x;
	const cz = c.y;

	const cosT = Math.cos(theta);
	const sinT = Math.sin(theta);

	// Yaw around world +Y: with thumb along +Y, +X rotates towards +Z.
	//   x' = (x - cx) cos − (z - cz) sin + cx
	//   z' = (x - cx) sin + (z - cz) cos + cz
	const rotXZ = (x: number, z: number): { x: number; z: number } => {
		const ox = x - cx;
		const oz = z - cz;
		return {
			x: ox * cosT - oz * sinT + cx,
			z: ox * sinT + oz * cosT + cz,
		};
	};

	const next: AISection = {
		...src,
		corners: src.corners.map((corner) => {
			const r = rotXZ(corner.x, corner.y);
			return { x: r.x, y: r.z };
		}),
		portals: src.portals.map((p) => {
			const rPos = rotXZ(p.position.x, p.position.z);
			return {
				...p,
				position: { x: rPos.x, y: p.position.y, z: rPos.z },
				boundaryLines: p.boundaryLines.map((bl) => {
					const rStart = rotXZ(bl.verts.x, bl.verts.y);
					const rEnd = rotXZ(bl.verts.z, bl.verts.w);
					return {
						verts: { x: rStart.x, y: rStart.z, z: rEnd.x, w: rEnd.z },
					};
				}),
			};
		}),
		noGoLines: src.noGoLines.map((bl) => {
			const rStart = rotXZ(bl.verts.x, bl.verts.y);
			const rEnd = rotXZ(bl.verts.z, bl.verts.w);
			return {
				verts: { x: rStart.x, y: rStart.z, z: rEnd.x, w: rEnd.z },
			};
		}),
	};

	const sections = model.sections.map((s, i) => (i === srcIdx ? next : s));
	return { ...model, sections };
}
