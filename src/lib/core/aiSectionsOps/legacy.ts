// Legacy (V4 / V6) AISections operations.
//
// V4/V6 sections store corners as parallel `cornersX[]` / `cornersZ[]` f32
// arrays where V12 uses `Vector2[]`. The editor-level ops on this format are
// the same set as V12 — duplicate-through-edge, translate-with-links,
// corner-with-shared, snap-section, snap-corner — but operate on the legacy
// storage layout. Many of them reuse the storage-shape adapter machinery
// from `_helpers.ts` so the math doesn't have to fork.
//
// V4 sections have no `id`, no `spanIndex`, no `district`. V6 adds spanIndex
// + district. The duplicate-through-edge op respects this: a V4 duplicate
// must NOT synthesise V6-only fields; a V6 duplicate inherits them from the
// source.

import type {
	LegacyAISection,
	LegacyAISectionsData,
	LegacyBoundaryLine,
	LegacyPortal,
	Vector2,
} from '../aiSections';
import { resolveLegacySectionYs } from '../aiSectionY';
import {
	POSITION_EPS,
	centroid,
	padTo4,
	translateCornerWithSharedGeneric,
	v2Approx,
	v2add,
	v2dot,
	v2len,
	v2perp,
	v2scale,
	v2sub,
	v3Approx,
	type SectionLikeShape,
} from './_helpers';
import { nearestPointOnSegment } from './snap';

// =============================================================================
// Legacy (V4 / V6) duplicate-through-edge
// =============================================================================

// V4/V6 sections store corners as parallel `cornersX[4]` / `cornersZ[4]` f32
// arrays (V12 stores them via a Vector2[4] pointer). The geometry math is
// the same — these helpers project the parallel arrays into Vector2 form
// and back so the duplicate-through-edge math doesn't have to fork on
// storage layout.
function legacyCornersAsVec2(sec: LegacyAISection): Vector2[] {
	const n = Math.min(sec.cornersX.length, sec.cornersZ.length);
	const out: Vector2[] = new Array(n);
	for (let i = 0; i < n; i++) out[i] = { x: sec.cornersX[i], y: sec.cornersZ[i] };
	return out;
}

/**
 * Duplicate `srcIdx`'s legacy (V4 / V6) section through one of its edges,
 * wiring up a mirrored portal pair so the two sections are AI-connected.
 * Mirrors {@link duplicateSectionThroughEdge} for the V12 retail shape; the
 * geometry math is identical — corners get translated perpendicular to the
 * chosen edge by `2 × distance(centroid, edge)`, the portal pair shares a
 * world-space midpoint anchor, and the duplicate's boundary line carries the
 * reversed-winding endpoints.
 *
 * Identity differences from V12 (per issue #44):
 *   - V4 sections have NO `id` field at all, so the duplicate's "identity"
 *     is just its position in the array (the section's index IS its
 *     identity in this format). dangerRating + flags are inherited from the
 *     source.
 *   - V6 adds `spanIndex` (StreetData span; -1 = none) and `district`
 *     (BrnAI::EDistrict). Both are inherited from the source — the
 *     duplicate sits in the same district and on the same span as its
 *     parent unless the user edits afterwards.
 *
 * Anchor height: copied from the source's first existing portal's
 * `midPosition.y`, or 0 when the source has no portals. Corners on the
 * legacy section live on the XZ plane and don't carry a Y; the portal
 * `midPosition.w` (vpu::Vector3 structural padding word) is set to 0 on the
 * new portals.
 *
 * Existing `linkSection` indices in unrelated portals stay valid because
 * the duplicate is always appended at the end of `legacy.sections`.
 *
 * @throws if `srcIdx` or `edgeIdx` is out of range, or if the chosen edge
 *         is degenerate (zero-length).
 */
export function duplicateLegacySectionThroughEdge(
	model: LegacyAISectionsData,
	srcIdx: number,
	edgeIdx: number,
): LegacyAISectionsData {
	if (srcIdx < 0 || srcIdx >= model.sections.length) {
		throw new RangeError(`srcIdx ${srcIdx} out of range [0, ${model.sections.length})`);
	}
	const src = model.sections[srcIdx];
	const corners = legacyCornersAsVec2(src);
	const N = corners.length;
	if (N < 3) {
		throw new Error(`Section ${srcIdx} has only ${N} corners; need at least 3 to define an edge`);
	}
	if (edgeIdx < 0 || edgeIdx >= N) {
		throw new RangeError(`edgeIdx ${edgeIdx} out of range [0, ${N})`);
	}

	const A = corners[edgeIdx];
	const B = corners[(edgeIdx + 1) % N];
	const edgeDir = v2sub(B, A);
	const edgeLen = v2len(edgeDir);
	if (edgeLen === 0) {
		throw new Error(`Edge ${edgeIdx} of section ${srcIdx} is degenerate (zero length)`);
	}

	const ctr = centroid(corners);
	const midpoint: Vector2 = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
	const outward = v2sub(midpoint, ctr);
	let perp = v2perp(edgeDir);
	perp = v2scale(perp, 1 / v2len(perp));
	if (v2dot(perp, outward) < 0) perp = v2scale(perp, -1);

	const offsetDist = 2 * v2dot(outward, perp);
	const offset = v2scale(perp, offsetDist);

	const dupCornersX: number[] = new Array(N);
	const dupCornersZ: number[] = new Array(N);
	for (let i = 0; i < N; i++) {
		const c = v2add(corners[i], offset);
		dupCornersX[i] = c.x;
		dupCornersZ[i] = c.y;
	}

	// Anchor Y: legacy portals carry the height in midPosition.y. midPosition.w
	// is `vpu::Vector3` structural padding — zeroed on freshly created portals
	// (the V4 parser preserves any non-zero W on existing portals for
	// round-trip fidelity, but a duplicate has no source W to inherit).
	// When the source has no portal of its own we fall back to the resolver
	// (issue #27 sub-task (b)) so a duplicate landing off a portal-less
	// section still inherits a sensible height from neighbours; final
	// fallback is 0.
	let anchorY: number;
	if (src.portals.length > 0) {
		anchorY = src.portals[0].midPosition.y;
	} else {
		const resolved = resolveLegacySectionYs(model);
		anchorY = resolved[srcIdx] ?? 0;
	}
	const anchorMid = { x: midpoint.x, y: anchorY, z: midpoint.y, w: 0 };

	const srcBoundary: LegacyBoundaryLine = { verts: { x: A.x, y: A.y, z: B.x, w: B.y } };
	const dupBoundary: LegacyBoundaryLine = { verts: { x: B.x, y: B.y, z: A.x, w: A.y } };

	const dupIdx = model.sections.length;

	const srcPortalNew: LegacyPortal = {
		midPosition: { ...anchorMid },
		boundaryLines: [srcBoundary],
		linkSection: dupIdx,
	};

	const dupPortal: LegacyPortal = {
		midPosition: { ...anchorMid },
		boundaryLines: [dupBoundary],
		linkSection: srcIdx,
	};

	const dupSection: LegacyAISection = {
		portals: [dupPortal],
		noGoLines: [],
		// Always emit length-4 arrays (matches the on-disk layout —
		// CORNERS_PER_LEGACY_SECTION = 4 in aiSectionsLegacy.ts). Pad with
		// zeros if the source happened to be malformed.
		cornersX: padTo4(dupCornersX),
		cornersZ: padTo4(dupCornersZ),
		dangerRating: src.dangerRating,
		flags: src.flags,
	};
	// V6-only fields: only emit when the source carries them. Round-trip
	// safety — a V4 section that gains an undefined spanIndex/district would
	// no longer match the V4 schema's RecordSchema definition.
	if (src.spanIndex !== undefined) dupSection.spanIndex = src.spanIndex;
	if (src.district !== undefined) dupSection.district = src.district;

	const updatedSrc: LegacyAISection = {
		...src,
		portals: [...src.portals, srcPortalNew],
	};

	const sections: LegacyAISection[] = model.sections.map((s, i) => (i === srcIdx ? updatedSrc : s));
	sections.push(dupSection);

	return {
		...model,
		sections,
	};
}

// =============================================================================
// Smart translate — legacy (V4 / V6) variant
// =============================================================================

/**
 * Legacy (V4 / V6) sibling of {@link translateSectionWithLinks}. The cascade
 * algorithm is identical — translate the source section's corners + portal
 * anchors + boundary lines + no-go lines by `(dx, dz)`, then for each portal
 * pointing at a neighbour `N` find `N`'s reverse portal (matched by
 * `linkSection === srcIdx` AND coincident pre-translate `midPosition.xyz`)
 * and shift it plus the corners on `N` that lie on the shared edge.
 *
 * Storage differences from V12:
 *   - Corners are parallel `cornersX[]` / `cornersZ[]` f32 arrays instead of
 *     a `Vector2[]`. The legacy section keeps both arrays in lock-step.
 *   - Portal anchor is `midPosition: Vector4` (xyz + structural padding `w`)
 *     vs V12's `position: Vector3`. The translate touches xyz only — `y`
 *     and `w` carry vertical height and round-trip padding respectively.
 *   - No `sectionResetPairs` — the legacy format predates that table, so
 *     the V12 cross-reference invariance comment doesn't apply here.
 *
 * Cascades exactly one hop, same as V12 (see that function's docstring for
 * why two-hop propagation isn't safe on cyclic neighbour graphs).
 */
export function translateLegacySectionWithLinks(
	model: LegacyAISectionsData,
	srcIdx: number,
	offset: { x: number; z: number },
): LegacyAISectionsData {
	if (srcIdx < 0 || srcIdx >= model.sections.length) {
		throw new RangeError(`srcIdx ${srcIdx} out of range [0, ${model.sections.length})`);
	}
	if (offset.x === 0 && offset.z === 0) return model;

	const src = model.sections[srcIdx];
	const dx = offset.x;
	const dz = offset.z;

	const srcTranslated: LegacyAISection = {
		...src,
		cornersX: src.cornersX.map((x) => x + dx),
		cornersZ: src.cornersZ.map((z) => z + dz),
		portals: src.portals.map((p) => ({
			...p,
			midPosition: {
				x: p.midPosition.x + dx,
				y: p.midPosition.y,
				z: p.midPosition.z + dz,
				w: p.midPosition.w,
			},
			boundaryLines: p.boundaryLines.map((bl) => ({
				verts: { x: bl.verts.x + dx, y: bl.verts.y + dz, z: bl.verts.z + dx, w: bl.verts.w + dz },
			})),
		})),
		noGoLines: src.noGoLines.map((bl) => ({
			verts: { x: bl.verts.x + dx, y: bl.verts.y + dz, z: bl.verts.z + dx, w: bl.verts.w + dz },
		})),
	};

	const updates = new Map<number, LegacyAISection>();
	updates.set(srcIdx, srcTranslated);

	for (const oldPortal of src.portals) {
		const targetIdx = oldPortal.linkSection;
		if (targetIdx === srcIdx) continue;
		if (targetIdx < 0 || targetIdx >= model.sections.length) continue;

		const current = updates.get(targetIdx) ?? model.sections[targetIdx];
		const fixed = applyLegacyLinkFixUp(current, srcIdx, oldPortal, dx, dz);
		if (fixed !== current) updates.set(targetIdx, fixed);
	}

	const sections = model.sections.map((s, i) => updates.get(i) ?? s);
	return { ...model, sections };
}

/**
 * Per-neighbour cascade for the legacy variant: translate the matching
 * reverse portal and the corners that lie on the shared edge. Mirrors
 * {@link applyLinkFixUp} for the V12 retail layout — see that function's
 * docstring for the matching strategy. Storage differences:
 *   - corners come out of parallel `cornersX[]` / `cornersZ[]` arrays;
 *   - portal anchor is `midPosition` (Vector4) — `w` is structural padding
 *     and stays untouched on the translate.
 */
function applyLegacyLinkFixUp(
	target: LegacyAISection,
	srcIdx: number,
	oldSrcPortal: LegacyPortal,
	dx: number,
	dz: number,
): LegacyAISection {
	const matchIdx = target.portals.findIndex(
		(p) => p.linkSection === srcIdx && v3Approx(p.midPosition, oldSrcPortal.midPosition),
	);

	let portals = target.portals;
	if (matchIdx >= 0) {
		const old = target.portals[matchIdx];
		const updated: LegacyPortal = {
			...old,
			midPosition: {
				x: old.midPosition.x + dx,
				y: old.midPosition.y,
				z: old.midPosition.z + dz,
				w: old.midPosition.w,
			},
			boundaryLines: old.boundaryLines.map((bl) => ({
				verts: { x: bl.verts.x + dx, y: bl.verts.y + dz, z: bl.verts.z + dx, w: bl.verts.w + dz },
			})),
		};
		portals = target.portals.slice();
		portals[matchIdx] = updated;
	}

	// Shift corners on the neighbour that coincide with the source portal's
	// pre-translate boundary-line endpoints. Boundary lines are typically a
	// single edge per portal but we walk every BL for the general case.
	const sharedPoints: Vector2[] = [];
	for (const bl of oldSrcPortal.boundaryLines) {
		sharedPoints.push({ x: bl.verts.x, y: bl.verts.y });
		sharedPoints.push({ x: bl.verts.z, y: bl.verts.w });
	}

	let cornersX = target.cornersX;
	let cornersZ = target.cornersZ;
	if (sharedPoints.length > 0) {
		const N = Math.min(target.cornersX.length, target.cornersZ.length);
		let cornersChanged = false;
		const nextX = target.cornersX.slice();
		const nextZ = target.cornersZ.slice();
		for (let i = 0; i < N; i++) {
			const c: Vector2 = { x: target.cornersX[i], y: target.cornersZ[i] };
			if (sharedPoints.some((p) => v2Approx(c, p))) {
				cornersChanged = true;
				nextX[i] = c.x + dx;
				nextZ[i] = c.y + dz;
			}
		}
		if (cornersChanged) {
			cornersX = nextX;
			cornersZ = nextZ;
		}
	}

	if (
		portals === target.portals &&
		cornersX === target.cornersX &&
		cornersZ === target.cornersZ
	) {
		return target;
	}
	return { ...target, portals, cornersX, cornersZ };
}

// =============================================================================
// Legacy (V4 / V6) snap-to-edges
// =============================================================================

// V4/V6 corner storage uses parallel `cornersX[]` / `cornersZ[]` f32 arrays
// where V12 uses `Vector2[]`. The snap math is identical — these wrappers
// project the legacy layout into the same Vector2 form the V12 helpers
// already work in, then convert the resulting offset back. Same adapter
// shape #44 used for `duplicateLegacySectionThroughEdge`.

/**
 * Variant of `findNearestSnapTarget` that walks `LegacyAISectionsData`.
 * Identical search semantics — every foreign corner and every foreign edge
 * is tested against the probe point, with `cascadePartner` excluding points
 * that are already moving with the drag.
 */
function findNearestLegacySnapTarget(
	model: LegacyAISectionsData,
	srcIdx: number,
	probe: Vector2,
	snapRadius: number,
	cascadePartner: (c: Vector2) => boolean,
): { point: Vector2; dist: number } | null {
	if (snapRadius <= 0) return null;

	let best: { point: Vector2; dist: number } | null = null;

	for (let si = 0; si < model.sections.length; si++) {
		if (si === srcIdx) continue;
		const s = model.sections[si];
		const N = Math.min(s.cornersX.length, s.cornersZ.length);
		if (N === 0) continue;

		// Test every corner.
		for (let i = 0; i < N; i++) {
			const c: Vector2 = { x: s.cornersX[i], y: s.cornersZ[i] };
			if (cascadePartner(c)) continue;
			const dist = Math.hypot(probe.x - c.x, probe.y - c.y);
			if (dist < (best?.dist ?? snapRadius)) {
				best = { point: { x: c.x, y: c.y }, dist };
			}
		}

		// Test every edge (corner-pair). Skip edges whose endpoints are
		// cascade partners — those edges move with us.
		for (let i = 0; i < N; i++) {
			const a: Vector2 = { x: s.cornersX[i], y: s.cornersZ[i] };
			const b: Vector2 = { x: s.cornersX[(i + 1) % N], y: s.cornersZ[(i + 1) % N] };
			if (cascadePartner(a) || cascadePartner(b)) continue;
			const candidate = nearestPointOnSegment(probe, a, b);
			if (candidate.dist < (best?.dist ?? snapRadius)) {
				best = candidate;
			}
		}
	}

	return best;
}

/**
 * V4/V6 sibling of {@link snapSectionOffset}. Adjusts a proposed
 * section-translate offset so a source corner that lands within
 * `snapRadius` of a foreign corner OR point on a foreign edge snaps onto
 * that target exactly. Returns the original offset when nothing's in range.
 *
 * "Foreign" excludes corners and edges on the source legacy section
 * itself, plus any corner on a neighbour section that happens to share a
 * world XZ position with a source corner (a cascade partner — those
 * neighbour corners would move along with us in a smart-translate, so
 * they're not stationary snap targets).
 *
 * Note: a "smart translate with paired-portal cascade" pass for legacy
 * sections doesn't exist yet (issue #42 ships the bare gizmo first), so
 * the cascade-partner filter today only ever excludes the source's own
 * corners. The filter signature is here so the snap behaviour matches
 * V12's once a legacy smart-translate lands.
 */
export function snapLegacySectionOffset(
	model: LegacyAISectionsData,
	srcIdx: number,
	proposedOffset: { x: number; z: number },
	snapRadius: number,
): { x: number; z: number } {
	if (srcIdx < 0 || srcIdx >= model.sections.length) return proposedOffset;
	if (snapRadius <= 0) return proposedOffset;

	const src = model.sections[srcIdx];
	const N = Math.min(src.cornersX.length, src.cornersZ.length);
	if (N === 0) return proposedOffset;

	const isCascadePartner = (c: Vector2): boolean => {
		for (let i = 0; i < N; i++) {
			if (
				Math.abs(src.cornersX[i] - c.x) < POSITION_EPS &&
				Math.abs(src.cornersZ[i] - c.y) < POSITION_EPS
			) {
				return true;
			}
		}
		return false;
	};

	let bestDist = snapRadius;
	let bestAdjustment: { x: number; z: number } | null = null;

	for (let i = 0; i < N; i++) {
		const probe: Vector2 = {
			x: src.cornersX[i] + proposedOffset.x,
			y: src.cornersZ[i] + proposedOffset.z,
		};
		const found = findNearestLegacySnapTarget(model, srcIdx, probe, bestDist, isCascadePartner);
		if (found && found.dist < bestDist) {
			bestDist = found.dist;
			bestAdjustment = {
				x: found.point.x - probe.x,
				z: found.point.y - probe.y,
			};
		}
	}

	if (!bestAdjustment) return proposedOffset;
	return {
		x: proposedOffset.x + bestAdjustment.x,
		z: proposedOffset.z + bestAdjustment.z,
	};
}

/**
 * V4/V6 sibling of {@link snapCornerOffset}. Adjusts a proposed
 * corner-drag offset so the dragged corner snaps onto the closest foreign
 * corner OR point on a foreign edge within `snapRadius`. Returns the
 * original offset when nothing's in range.
 */
export function snapLegacyCornerOffset(
	model: LegacyAISectionsData,
	srcIdx: number,
	cornerIdx: number,
	proposedOffset: { x: number; z: number },
	snapRadius: number,
): { x: number; z: number } {
	if (srcIdx < 0 || srcIdx >= model.sections.length) return proposedOffset;
	const src = model.sections[srcIdx];
	const N = Math.min(src.cornersX.length, src.cornersZ.length);
	if (cornerIdx < 0 || cornerIdx >= N) return proposedOffset;
	if (snapRadius <= 0) return proposedOffset;

	const oldCornerX = src.cornersX[cornerIdx];
	const oldCornerZ = src.cornersZ[cornerIdx];
	const probe: Vector2 = {
		x: oldCornerX + proposedOffset.x,
		y: oldCornerZ + proposedOffset.z,
	};

	const isCascadePartner = (c: Vector2): boolean =>
		Math.abs(c.x - oldCornerX) < POSITION_EPS &&
		Math.abs(c.y - oldCornerZ) < POSITION_EPS;

	const found = findNearestLegacySnapTarget(model, srcIdx, probe, snapRadius, isCascadePartner);
	if (!found) return proposedOffset;

	return {
		x: found.point.x - oldCornerX,
		z: found.point.y - oldCornerZ,
	};
}

// =============================================================================
// Legacy (V4 / V6) smart corner-drag (with shared-point cascade)
// =============================================================================

const legacyShape: SectionLikeShape<LegacyAISection, LegacyPortal, LegacyBoundaryLine> = {
	getCorners: legacyCornersAsVec2,
	// Write back into the parallel cornersX/cornersZ arrays. Allocation is
	// fresh — the caller may have created a new corner array, and we want
	// the on-disk layout to match exactly what the op produced. Length is
	// preserved so a section with 4 corners stays 4-cornered (the V4 wire
	// format mandates exactly 4 — duplicateLegacy already enforces this).
	setCorners: (s, corners) => {
		const cornersX = corners.map((c) => c.x);
		const cornersZ = corners.map((c) => c.y);
		return { ...s, cornersX, cornersZ };
	},
	getPortals: (s) => s.portals,
	setPortals: (s, portals) => ({ ...s, portals }),
	getNoGoLines: (s) => s.noGoLines,
	setNoGoLines: (s, noGoLines) => ({ ...s, noGoLines }),
	getPortalBoundaryLines: (p) => p.boundaryLines,
	setPortalBoundaryLines: (p, boundaryLines) => ({ ...p, boundaryLines }),
};

/**
 * V4/V6 sibling of {@link translateCornerWithShared}. Same smart-cascade
 * behaviour — corners shared between sections (matched by exact-equal
 * coordinates within an epsilon) move together, boundary-line endpoints
 * coincident with the dragged corner shift along — but operates on the
 * legacy `cornersX[]` / `cornersZ[]` storage instead of V12's `Vector2[]`.
 *
 * Identity choices match `duplicateLegacySectionThroughEdge`:
 *   - V4 sections have no `id` field; corner identity is positional within
 *     the parallel arrays.
 *   - V6-only fields (`spanIndex`, `district`) are preserved — the smart
 *     drag never touches non-spatial fields.
 *   - Portal `midPosition` (the Vector4 with structural padding W) is NOT
 *     moved by a corner drag, mirroring the V12 op's "leave the anchor
 *     alone" rule.
 *
 * @throws RangeError if `srcIdx` or `cornerIdx` is out of range.
 */
export function translateLegacyCornerWithShared(
	model: LegacyAISectionsData,
	srcIdx: number,
	cornerIdx: number,
	offset: { x: number; z: number },
): LegacyAISectionsData {
	const result = translateCornerWithSharedGeneric(model.sections, srcIdx, cornerIdx, offset, legacyShape);
	if (!result.changed) return model;
	return { ...model, sections: result.sections };
}
