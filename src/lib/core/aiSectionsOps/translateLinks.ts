// Cascade-on V12 ops: translate / rotate / portal-mirror / shared-corner.
//
// The cascade-modifier path of the Bulk-transform gizmo (CONTEXT.md /
// "Cascade", ADR-0009, issue #75). When the user holds the modifier the
// gizmo routes through these ops instead of the rigid / no-cascade ones —
// the same one-hop cascade `translateSectionWithLinks` pioneered,
// generalised to rotate, single-corner, and single-portal-anchor drags.
//
// Bulk-Selection variants (`translateSelectionWithLinks`,
// `rotateSelectionWithLinksYaw`) live in `bulk.ts` and reuse the
// `applyLinkFixUp` / `applyRotateLinkFixUp` helpers exported here.

import type {
	AISection,
	BoundaryLine,
	ParsedAISectionsV12,
	Portal,
	Vector2,
} from '../aiSections';
import {
	centroid,
	translateCornerWithSharedGeneric,
	v2Approx,
	v3Approx,
	type SectionLikeShape,
} from './_helpers';

// =============================================================================
// Smart translate (with paired-portal cascade)
// =============================================================================

/**
 * Translate `srcIdx` by an XZ offset and cascade the move into every
 * neighbour the section shares a portal with — preserving the connection
 * geometry that the duplicate-through-edge operation set up:
 *
 *   - Source section: corners, portal positions, portal boundary lines, and
 *     no-go lines all shift by `(dx, dz)`. Same as a plain translate.
 *
 *   - For each `srcIdx` portal `P` pointing at neighbour `N`:
 *       - Find `N`'s reverse portal (the one whose `linkSection` is `srcIdx`
 *         AND whose pre-translate `position` matches `P`'s pre-translate
 *         `position`). Shift its `position` and every `boundaryLine.verts`
 *         endpoint by `(dx, dz)` so the pair stays at one shared world
 *         coordinate.
 *       - Shift `N`'s corners that coincide with `P`'s pre-translate boundary
 *         endpoints by `(dx, dz)`. Other corners on `N` stay put — `N`'s
 *         polygon "stretches" rather than translating wholesale, which keeps
 *         `N`'s OTHER edges (and the connections through them) stationary.
 *
 * Cross-references via `sectionResetPairs` are not touched — they reference
 * sections by index, not by world position, so a translate doesn't break them.
 *
 * Cascades exactly one hop. A neighbour's neighbour is not adjusted, because
 * that would require deciding which of N's corners are shared with N's other
 * neighbours and propagating again — a recursion that doesn't terminate
 * cleanly on graphs with cycles. Two-hop drift is the user's call to fix.
 */
export function translateSectionWithLinks(
	model: ParsedAISectionsV12,
	srcIdx: number,
	offset: { x: number; z: number },
): ParsedAISectionsV12 {
	if (srcIdx < 0 || srcIdx >= model.sections.length) {
		throw new RangeError(`srcIdx ${srcIdx} out of range [0, ${model.sections.length})`);
	}
	if (offset.x === 0 && offset.z === 0) return model;

	const src = model.sections[srcIdx];
	const dx = offset.x;
	const dz = offset.z;

	// --- Source: shift everything spatial. Mirrors the schema-driven
	// translateRecordBySpatial walker, but inlined here so the smart-move
	// path doesn't depend on the schema layer.
	const srcTranslated: AISection = {
		...src,
		corners: src.corners.map((c) => ({ x: c.x + dx, y: c.y + dz })),
		portals: src.portals.map((p) => ({
			...p,
			position: { x: p.position.x + dx, y: p.position.y, z: p.position.z + dz },
			boundaryLines: p.boundaryLines.map((bl) => ({
				verts: { x: bl.verts.x + dx, y: bl.verts.y + dz, z: bl.verts.z + dx, w: bl.verts.w + dz },
			})),
		})),
		noGoLines: src.noGoLines.map((bl) => ({
			verts: { x: bl.verts.x + dx, y: bl.verts.y + dz, z: bl.verts.z + dx, w: bl.verts.w + dz },
		})),
	};

	// --- Neighbours: collect updates keyed by section index. We use a map
	// so a neighbour linked through multiple portals only gets one merged
	// update (each portal's fix-up applies on top of the running state).
	const updates = new Map<number, AISection>();
	updates.set(srcIdx, srcTranslated);

	for (const oldPortal of src.portals) {
		const targetIdx = oldPortal.linkSection;
		if (targetIdx === srcIdx) continue;
		if (targetIdx < 0 || targetIdx >= model.sections.length) continue;

		const current = updates.get(targetIdx) ?? model.sections[targetIdx];
		const fixed = applyLinkFixUp(current, srcIdx, oldPortal, dx, dz);
		if (fixed !== current) updates.set(targetIdx, fixed);
	}

	const sections = model.sections.map((s, i) => updates.get(i) ?? s);
	return { ...model, sections };
}

/**
 * Apply the per-neighbour cascade: translate the matching reverse portal
 * and the corners that lie on the shared edge.
 */
export function applyLinkFixUp(
	target: AISection,
	srcIdx: number,
	oldSrcPortal: Portal,
	dx: number,
	dz: number,
): AISection {
	// Find the reverse portal in `target`. We match by both `linkSection`
	// and `position` so a neighbour with multiple portals back to `src`
	// (rare but possible — two separate connections between A and B on
	// different edges) updates the right one.
	const matchIdx = target.portals.findIndex(
		(p) => p.linkSection === srcIdx && v3Approx(p.position, oldSrcPortal.position),
	);

	let portals = target.portals;
	if (matchIdx >= 0) {
		const old = target.portals[matchIdx];
		const updated: Portal = {
			...old,
			position: { x: old.position.x + dx, y: old.position.y, z: old.position.z + dz },
			boundaryLines: old.boundaryLines.map((bl) => ({
				verts: { x: bl.verts.x + dx, y: bl.verts.y + dz, z: bl.verts.z + dx, w: bl.verts.w + dz },
			})),
		};
		portals = target.portals.slice();
		portals[matchIdx] = updated;
	}

	// Shift the corners that coincide with the source portal's pre-translate
	// boundary-line endpoints. Each portal usually has exactly one boundary
	// line (a single shared edge); we walk every BL anyway to handle the
	// general case where a portal carries multiple lines.
	const sharedPoints: Vector2[] = [];
	for (const bl of oldSrcPortal.boundaryLines) {
		sharedPoints.push({ x: bl.verts.x, y: bl.verts.y });
		sharedPoints.push({ x: bl.verts.z, y: bl.verts.w });
	}

	let corners = target.corners;
	if (sharedPoints.length > 0) {
		let cornersChanged = false;
		const next = target.corners.map((c) => {
			if (sharedPoints.some((p) => v2Approx(c, p))) {
				cornersChanged = true;
				return { x: c.x + dx, y: c.y + dz };
			}
			return c;
		});
		if (cornersChanged) corners = next;
	}

	if (portals === target.portals && corners === target.corners) return target;
	return { ...target, portals, corners };
}

// =============================================================================
// Smart corner-drag (with shared-point cascade)
// =============================================================================

const v12Shape: SectionLikeShape<AISection, Portal, BoundaryLine> = {
	getCorners: (s) => s.corners,
	// V12's native corner storage IS Vector2[] with y → world-Z, so
	// "set" just installs the array verbatim.
	setCorners: (s, corners) => ({ ...s, corners }),
	getPortals: (s) => s.portals,
	setPortals: (s, portals) => ({ ...s, portals }),
	getNoGoLines: (s) => s.noGoLines,
	setNoGoLines: (s, noGoLines) => ({ ...s, noGoLines }),
	getPortalBoundaryLines: (p) => p.boundaryLines,
	setPortalBoundaryLines: (p, boundaryLines) => ({ ...p, boundaryLines }),
};

/**
 * Move a single polygon corner by an XZ offset, dragging along every other
 * value in the model that coincides with the OLD corner position:
 *
 *   - Corners on neighbouring sections that lie at the same world XZ point
 *     (a "shared corner") move with us.
 *   - Boundary-line endpoints (portal BLs and noGo lines) anywhere in the
 *     model whose start- or end-point matches the old corner shift the
 *     matching endpoint by the same delta.
 *
 * Portal `position` (the 3D anchor at an edge midpoint) is NOT moved — the
 * midpoint relationship is the duplicate-through-edge op's choice, not a
 * rule the user must keep. Adjusting the anchor based on a corner drag
 * would clobber portals the user manually placed.
 *
 * Sections, portals, and lines whose endpoints don't reference the old
 * corner stay structurally identical (===-equal) so React renderers can
 * cheaply skip them.
 *
 * @throws RangeError if `srcIdx` or `cornerIdx` is out of range.
 */
export function translateCornerWithShared(
	model: ParsedAISectionsV12,
	srcIdx: number,
	cornerIdx: number,
	offset: { x: number; z: number },
): ParsedAISectionsV12 {
	const result = translateCornerWithSharedGeneric(model.sections, srcIdx, cornerIdx, offset, v12Shape);
	if (!result.changed) return model;
	return { ...model, sections: result.sections };
}

// =============================================================================
// Bulk-transform: cascade-on variants (held-modifier opt-in path)
// =============================================================================
//
// The **Cascade** modifier path of the **Bulk transform** gizmo (CONTEXT.md /
// "Cascade", ADR-0009, issue #75). When the user holds the modifier (Shift)
// at gesture start the gizmo routes through these ops instead of the rigid /
// no-cascade ones — the same one-hop cascade `translateSectionWithLinks`
// pioneered, generalised to rotate, single-corner, and single-portal-anchor
// drags. The mental model is one sentence from the ADR: "the gizmo moves
// what you selected; modifier extends to connected geometry."
//
// One-hop semantics are inherited from `translateSectionWithLinks`. We do not
// chase the cascade through a neighbour's *other* portals because that doesn't
// terminate cleanly on cyclic neighbour graphs — same trade-off documented on
// the translate op (a two-hop drift is the user's call to fix).

/**
 * Rotate one AI section around its own centroid by `theta` radians of yaw,
 * cascading the rotation into every neighbour the section shares a portal
 * with — the rotate-axis sibling of {@link translateSectionWithLinks}.
 *
 * The source section rotates as a rigid body (corners + portal positions +
 * portal boundary lines + no-go lines all spin together) around the
 * pre-rotate centroid. For each `srcIdx` portal `P` pointing at neighbour
 * `N`:
 *
 *   - Find `N`'s reverse portal (matched by `linkSection === srcIdx` AND a
 *     pre-rotate `position` that approximates `P`'s pre-rotate `position`).
 *     Rotate its `position` and every `boundaryLine.verts` endpoint around
 *     the SAME centroid — keeping the portal pair at one shared world XZ
 *     coordinate post-rotation (Y is unchanged by yaw).
 *   - Rotate `N`'s corners that coincide with `P`'s pre-rotate boundary
 *     endpoints around the centroid. `N`'s other corners stay put, so `N`
 *     "stretches" along its other edges — same shape the translate cascade
 *     uses, just with rotation as the per-point transform.
 *
 * Returns the original `model` reference when `theta === 0` so byte-for-byte
 * BND2 writeback is preserved on a no-op gesture.
 *
 * Why the existing translate algorithm doesn't extend trivially: the
 * translate cascade shifts every cascade-partner by the SAME `(dx, dz)`
 * vector, so the order of operations doesn't matter. Rotation isn't a
 * translation — every point's new position depends on its OWN offset from
 * the pivot — so we have to identify the cascade partners (reverse portals,
 * shared corners) on the *pre-rotate* geometry, then apply the rotation
 * point-by-point with the same `(cx, cz, theta)` to each. We use the source
 * section's centroid as the pivot rather than the section-pair centroid
 * because the gizmo's pivot for a cardinality-1 **Selection** IS the source
 * section's centroid (CONTEXT.md / "Pivot"). Neighbours' OTHER edges (those
 * not shared with the source) accept the cascade-driven stretch on their
 * shared corners and stay rigid otherwise.
 *
 * Cross-references via `sectionResetPairs` are not touched — they reference
 * sections by index, not by world position, so a rotate doesn't break them.
 *
 * @throws RangeError if `srcIdx` is out of range.
 */
export function rotateSectionWithLinksYaw(
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

	// Pivot = source section centroid (cardinality-1 default per CONTEXT.md /
	// "Pivot"). AISection.Vector2 stores world XZ in `(x, y)`, so the
	// centroid's `(cx, cz)` lives in `(centre.x, centre.y)`.
	const c = centroid(src.corners);
	const cx = c.x;
	const cz = c.y;
	const cosT = Math.cos(theta);
	const sinT = Math.sin(theta);

	// Yaw around world +Y: with thumb along +Y, +X rotates towards +Z. Mirrors
	// the rigid yaw op exactly so combined gestures compose deterministically.
	const rotXZ = (x: number, z: number): { x: number; z: number } => {
		const ox = x - cx;
		const oz = z - cz;
		return {
			x: ox * cosT - oz * sinT + cx,
			z: ox * sinT + oz * cosT + cz,
		};
	};

	const srcRotated: AISection = {
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
					return { verts: { x: rStart.x, y: rStart.z, z: rEnd.x, w: rEnd.z } };
				}),
			};
		}),
		noGoLines: src.noGoLines.map((bl) => {
			const rStart = rotXZ(bl.verts.x, bl.verts.y);
			const rEnd = rotXZ(bl.verts.z, bl.verts.w);
			return { verts: { x: rStart.x, y: rStart.z, z: rEnd.x, w: rEnd.z } };
		}),
	};

	// Neighbour fix-ups — one per source portal pointing at a distinct
	// neighbour. Multiple portals can point at the same neighbour (rare A↔B
	// dual-edge connection): in that case each portal's fix-up applies on
	// top of the running state via the same map-keyed accumulator the
	// translate cascade uses.
	const updates = new Map<number, AISection>();
	updates.set(srcIdx, srcRotated);

	for (const oldPortal of src.portals) {
		const targetIdx = oldPortal.linkSection;
		if (targetIdx === srcIdx) continue;
		if (targetIdx < 0 || targetIdx >= model.sections.length) continue;

		const current = updates.get(targetIdx) ?? model.sections[targetIdx];
		const fixed = applyRotateLinkFixUp(current, srcIdx, oldPortal, rotXZ);
		if (fixed !== current) updates.set(targetIdx, fixed);
	}

	const sections = model.sections.map((s, i) => updates.get(i) ?? s);
	return { ...model, sections };
}

/**
 * Per-neighbour rotate cascade: rotate the matching reverse portal and any
 * corners on the shared edge around the same pivot the source spun about.
 * Mirrors {@link applyLinkFixUp}'s shape — match the reverse portal by
 * `linkSection` AND coincident pre-rotate `position`, then apply `rotXZ`
 * point-by-point to that portal's position, its boundary-line endpoints,
 * and the neighbour corners coincident with the source portal's pre-rotate
 * boundary-line endpoints.
 */
export function applyRotateLinkFixUp(
	target: AISection,
	srcIdx: number,
	oldSrcPortal: Portal,
	rotXZ: (x: number, z: number) => { x: number; z: number },
): AISection {
	const matchIdx = target.portals.findIndex(
		(p) => p.linkSection === srcIdx && v3Approx(p.position, oldSrcPortal.position),
	);

	let portals = target.portals;
	if (matchIdx >= 0) {
		const old = target.portals[matchIdx];
		const rPos = rotXZ(old.position.x, old.position.z);
		const updated: Portal = {
			...old,
			position: { x: rPos.x, y: old.position.y, z: rPos.z },
			boundaryLines: old.boundaryLines.map((bl) => {
				const rStart = rotXZ(bl.verts.x, bl.verts.y);
				const rEnd = rotXZ(bl.verts.z, bl.verts.w);
				return { verts: { x: rStart.x, y: rStart.z, z: rEnd.x, w: rEnd.z } };
			}),
		};
		portals = target.portals.slice();
		portals[matchIdx] = updated;
	}

	// Identify shared corners by matching the source portal's pre-rotate
	// boundary-line endpoints — same lookup the translate cascade uses.
	const sharedPoints: Vector2[] = [];
	for (const bl of oldSrcPortal.boundaryLines) {
		sharedPoints.push({ x: bl.verts.x, y: bl.verts.y });
		sharedPoints.push({ x: bl.verts.z, y: bl.verts.w });
	}

	let corners = target.corners;
	if (sharedPoints.length > 0) {
		let cornersChanged = false;
		const next = target.corners.map((c) => {
			if (sharedPoints.some((p) => v2Approx(c, p))) {
				cornersChanged = true;
				const r = rotXZ(c.x, c.y);
				return { x: r.x, y: r.z };
			}
			return c;
		});
		if (cornersChanged) corners = next;
	}

	if (portals === target.portals && corners === target.corners) return target;
	return { ...target, portals, corners };
}

/**
 * Cascade-on translate of a single portal anchor by `(dx, dy, dz)`. The
 * source portal at `(sectionIdx, portalIdx)` moves to its new position, and
 * the **mirror portal** on the linked section (matched by `linkSection ===
 * sectionIdx` AND a pre-translate `position` coincident with the source
 * portal's pre-translate `position`) moves by the same delta so the
 * connection stays geometrically coherent.
 *
 * Unlike {@link translateSectionWithLinks}, this op does NOT touch corners
 * or boundary-line endpoints on either section. The portal anchor is a
 * 3D point at an edge midpoint by convention (the duplicate-through-edge
 * op's choice); dragging it slides the anchor along the connection without
 * deforming either polygon. The user can drag corners separately to
 * re-align the shared edge if they want.
 *
 * Returns the original `model` reference when `(dx, dy, dz) === (0, 0, 0)`
 * so byte-for-byte BND2 writeback is preserved on a no-op gesture.
 *
 * @throws RangeError if `sectionIdx` or `portalIdx` is out of range.
 */
export function translatePortalAnchorWithMirror(
	model: ParsedAISectionsV12,
	sectionIdx: number,
	portalIdx: number,
	offset: { x: number; y: number; z: number },
): ParsedAISectionsV12 {
	if (sectionIdx < 0 || sectionIdx >= model.sections.length) {
		throw new RangeError(`sectionIdx ${sectionIdx} out of range [0, ${model.sections.length})`);
	}
	const src = model.sections[sectionIdx];
	if (portalIdx < 0 || portalIdx >= src.portals.length) {
		throw new RangeError(`portalIdx ${portalIdx} out of range [0, ${src.portals.length})`);
	}
	const dx = offset.x;
	const dy = offset.y;
	const dz = offset.z;
	if (dx === 0 && dy === 0 && dz === 0) return model;

	const oldPortal = src.portals[portalIdx];
	const oldPosition = { ...oldPortal.position };
	const movedPortal: Portal = {
		...oldPortal,
		position: { x: oldPortal.position.x + dx, y: oldPortal.position.y + dy, z: oldPortal.position.z + dz },
	};
	const updatedSrc: AISection = {
		...src,
		portals: src.portals.map((p, i) => (i === portalIdx ? movedPortal : p)),
	};

	const updates = new Map<number, AISection>();
	updates.set(sectionIdx, updatedSrc);

	// Mirror lookup: the linked section's portal pointing back at us whose
	// pre-translate position approximates ours. Same matching strategy as
	// `applyLinkFixUp` so a neighbour with multiple portals back to the
	// source resolves to the right one.
	const linkIdx = oldPortal.linkSection;
	if (linkIdx !== sectionIdx && linkIdx >= 0 && linkIdx < model.sections.length) {
		const neighbour = model.sections[linkIdx];
		const mirrorIdx = neighbour.portals.findIndex(
			(p) => p.linkSection === sectionIdx && v3Approx(p.position, oldPosition),
		);
		if (mirrorIdx >= 0) {
			const oldMirror = neighbour.portals[mirrorIdx];
			const movedMirror: Portal = {
				...oldMirror,
				position: {
					x: oldMirror.position.x + dx,
					y: oldMirror.position.y + dy,
					z: oldMirror.position.z + dz,
				},
			};
			const updatedNeighbour: AISection = {
				...neighbour,
				portals: neighbour.portals.map((p, i) => (i === mirrorIdx ? movedMirror : p)),
			};
			updates.set(linkIdx, updatedNeighbour);
		}
	}

	const sections = model.sections.map((s, i) => updates.get(i) ?? s);
	return { ...model, sections };
}
