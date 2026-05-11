// AISections higher-level operations.
//
// Pure functions that mutate a `ParsedAISectionsV12` model immutably — i.e.,
// the input is never modified, the result is a new model with structural
// sharing where unaffected. UI code calls these and then commits the
// returned model with `setData(next)`.
//
// Why a separate file: the parser/writer in `aiSections.ts` only knows the
// binary layout. Editor-level operations like "duplicate this section and
// wire up a back-portal" need a different home — they don't belong in the
// IO module, and putting them in a React component would make them hard
// to unit-test.

import type {
	AISection,
	BoundaryLine,
	LegacyAISection,
	LegacyAISectionsData,
	LegacyBoundaryLine,
	LegacyPortal,
	ParsedAISectionsV12,
	Portal,
	Vector2,
} from './aiSections';
import { resolveLegacySectionYs, resolveSectionYs } from './aiSectionY';

// =============================================================================
// Vector helpers (XZ-plane 2D)
// =============================================================================

const v2add = (a: Vector2, b: Vector2): Vector2 => ({ x: a.x + b.x, y: a.y + b.y });
const v2sub = (a: Vector2, b: Vector2): Vector2 => ({ x: a.x - b.x, y: a.y - b.y });
const v2scale = (a: Vector2, s: number): Vector2 => ({ x: a.x * s, y: a.y * s });
const v2dot = (a: Vector2, b: Vector2): number => a.x * b.x + a.y * b.y;
const v2len = (a: Vector2): number => Math.hypot(a.x, a.y);
// 90° rotation in XZ. Either (y, -x) or (-y, x); we pick one and flip later
// based on which side of the polygon centroid the edge midpoint sits on.
const v2perp = (a: Vector2): Vector2 => ({ x: a.y, y: -a.x });

const centroid = (corners: Vector2[]): Vector2 => {
	let sx = 0, sy = 0;
	for (const c of corners) { sx += c.x; sy += c.y; }
	const n = corners.length || 1;
	return { x: sx / n, y: sy / n };
};

// =============================================================================
// Duplicate-through-edge
// =============================================================================

/**
 * Duplicate `srcIdx`'s section through one of its edges, wiring up a mirrored
 * Portal pair so the two sections are AI-connected.
 *
 * The polygon is translated perpendicular to the chosen edge by `2 ×
 * distance(centroid, edge)`. For a rectangle this lands the duplicate's
 * opposite edge exactly on the source's chosen edge (clean shared boundary);
 * for non-rectangular polygons it's a reasonable starting placement and the
 * user drags corners afterwards. The portal pair is correct regardless of
 * polygon shape — both portals share the same world-space `Position` (edge
 * midpoint) and carry the same boundary-line endpoints with reversed winding.
 *
 * Existing `linkSection` indices in unrelated portals stay valid because the
 * duplicate is always appended at the end of `model.sections`.
 *
 * @throws if `srcIdx` or `edgeIdx` is out of range, or if the chosen edge is
 *         degenerate (zero-length).
 */
export function duplicateSectionThroughEdge(
	model: ParsedAISectionsV12,
	srcIdx: number,
	edgeIdx: number,
): ParsedAISectionsV12 {
	if (srcIdx < 0 || srcIdx >= model.sections.length) {
		throw new RangeError(`srcIdx ${srcIdx} out of range [0, ${model.sections.length})`);
	}
	const src = model.sections[srcIdx];
	const N = src.corners.length;
	if (N < 3) {
		throw new Error(`Section ${srcIdx} has only ${N} corners; need at least 3 to define an edge`);
	}
	if (edgeIdx < 0 || edgeIdx >= N) {
		throw new RangeError(`edgeIdx ${edgeIdx} out of range [0, ${N})`);
	}

	const A = src.corners[edgeIdx];
	const B = src.corners[(edgeIdx + 1) % N];
	const edgeDir = v2sub(B, A);
	const edgeLen = v2len(edgeDir);
	if (edgeLen === 0) {
		throw new Error(`Edge ${edgeIdx} of section ${srcIdx} is degenerate (zero length)`);
	}

	// Outward normal: pick the perpendicular pointing *away* from the polygon
	// centroid. For a convex polygon this is unambiguous; for concave shapes
	// we still take "away from centroid" as a reasonable default.
	const ctr = centroid(src.corners);
	const midpoint: Vector2 = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
	const outward = v2sub(midpoint, ctr);
	let perp = v2perp(edgeDir);
	const perpLen = v2len(perp);
	// Normalize perp.
	perp = v2scale(perp, 1 / perpLen);
	if (v2dot(perp, outward) < 0) perp = v2scale(perp, -1);

	// Default offset: 2 × (centroid → edge midpoint) projected onto perp.
	// Rectangle case: this places the duplicate's opposite edge exactly on
	// the source's chosen edge.
	const offsetDist = 2 * v2dot(outward, perp);
	const offset = v2scale(perp, offsetDist);

	const dupCorners: Vector2[] = src.corners.map((c) => v2add(c, offset));

	// Anchor height: prefer the source's first existing portal, then fall
	// back to a section-Y resolver pass over the rest of the model
	// (issue #27 sub-task (b)). The resolver propagates portal Ys outward
	// across the section graph so a portal-less source still picks up its
	// neighbour's height instead of dumping the duplicate at Y=0. Final
	// fallback is 0 — same as pre-#27 behaviour when no portal exists
	// anywhere on the connected component. Corners are 2D (XZ) so they
	// don't carry height information; only the new portal anchor does.
	let anchorY: number;
	if (src.portals.length > 0) {
		anchorY = src.portals[0].position.y;
	} else {
		const resolved = resolveSectionYs(model);
		anchorY = resolved[srcIdx] ?? 0;
	}
	const anchorPos = { x: midpoint.x, y: anchorY, z: midpoint.y };

	// BoundaryLine.verts is a Vector4 packing the 2D segment as
	// (startX, startY, endX, endY). The duplicate's portal carries the same
	// endpoints with reversed winding so the two portals form a mirrored pair.
	const srcBoundary: BoundaryLine = { verts: { x: A.x, y: A.y, z: B.x, w: B.y } };
	const dupBoundary: BoundaryLine = { verts: { x: B.x, y: B.y, z: A.x, w: A.y } };

	const dupIdx = model.sections.length;

	const srcPortalNew: Portal = {
		position: { ...anchorPos },
		boundaryLines: [srcBoundary],
		linkSection: dupIdx,
	};

	const dupPortal: Portal = {
		position: { ...anchorPos },
		boundaryLines: [dupBoundary],
		linkSection: srcIdx,
	};

	const dupSection: AISection = {
		portals: [dupPortal],
		noGoLines: [],
		corners: dupCorners,
		id: nextFreeId(model),
		spanIndex: src.spanIndex,
		speed: src.speed,
		district: src.district,
		flags: src.flags,
	};

	// Build new model immutably. Source section gets the new portal appended;
	// duplicate is pushed to the end of `sections`.
	const updatedSrc: AISection = {
		...src,
		portals: [...src.portals, srcPortalNew],
	};

	const sections: AISection[] = model.sections.map((s, i) => (i === srcIdx ? updatedSrc : s));
	sections.push(dupSection);

	return {
		...model,
		sections,
	};
}

// Pick `max(existing ids) + 1` so the duplicate doesn't collide with any
// existing section ID. AISection IDs are u32 GameDB hashes in retail data;
// "max + 1" is just a placeholder the user can edit afterwards in the
// inspector.
function nextFreeId(model: ParsedAISectionsV12): number {
	let max = 0;
	for (const s of model.sections) {
		if (s.id > max) max = s.id;
	}
	// Wrap defensively in case ids approach the u32 ceiling.
	return ((max + 1) >>> 0);
}

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

function padTo4(xs: number[]): number[] {
	if (xs.length >= 4) return xs.slice(0, 4);
	const out = xs.slice();
	while (out.length < 4) out.push(0);
	return out;
}

// =============================================================================
// Smart translate (with paired-portal cascade)
// =============================================================================

const POSITION_EPS = 1e-3;

const v3Approx = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) =>
	Math.abs(a.x - b.x) < POSITION_EPS &&
	Math.abs(a.y - b.y) < POSITION_EPS &&
	Math.abs(a.z - b.z) < POSITION_EPS;

const v2Approx = (a: Vector2, b: Vector2) =>
	Math.abs(a.x - b.x) < POSITION_EPS && Math.abs(a.y - b.y) < POSITION_EPS;

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
function applyLinkFixUp(
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
// Snap-to-edges (corner & edge magnetism for the in-viewport drag gestures)
// =============================================================================

/**
 * Project `p` onto the segment `a→b` and return both the closest point on
 * the segment and the XZ distance from `p` to that point. Endpoints are
 * clamped — a probe that overshoots either end snaps to that end's corner.
 */
function nearestPointOnSegment(
	p: Vector2,
	a: Vector2,
	b: Vector2,
): { point: Vector2; dist: number } {
	const abx = b.x - a.x;
	const aby = b.y - a.y;
	const lenSq = abx * abx + aby * aby;
	if (lenSq === 0) {
		// Degenerate edge — `a` and `b` are the same point. Treat as that point.
		const dx = p.x - a.x;
		const dy = p.y - a.y;
		return { point: { x: a.x, y: a.y }, dist: Math.hypot(dx, dy) };
	}
	const t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq;
	const tClamped = Math.max(0, Math.min(1, t));
	const point = { x: a.x + tClamped * abx, y: a.y + tClamped * aby };
	return { point, dist: Math.hypot(p.x - point.x, p.y - point.y) };
}

/**
 * Search every foreign corner and edge for the nearest target to a probe
 * point. Returns the world XZ position of the target plus its distance, or
 * `null` when nothing is in range.
 *
 * `cascadePartner` lets the caller exclude points already moving with the
 * drag (e.g., for a corner-drag, the corners coincident with the OLD
 * dragged position; for a section-drag, every corner coincident with any
 * source corner). Edges with either endpoint flagged as a cascade partner
 * are also skipped — those edges are deforming with us, snapping onto
 * them is meaningless.
 */
function findNearestSnapTarget(
	model: ParsedAISectionsV12,
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
		const N = s.corners.length;
		if (N === 0) continue;

		// Test every corner.
		for (const c of s.corners) {
			if (cascadePartner(c)) continue;
			const dist = Math.hypot(probe.x - c.x, probe.y - c.y);
			if (dist < (best?.dist ?? snapRadius)) {
				best = { point: { x: c.x, y: c.y }, dist };
			}
		}

		// Test every edge (corner-pair). Skip edges whose endpoints are
		// cascade partners — those edges move with us.
		for (let i = 0; i < N; i++) {
			const a = s.corners[i];
			const b = s.corners[(i + 1) % N];
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
 * Adjust a proposed translate-offset so a source corner that lands within
 * `snapRadius` of a foreign corner OR a point on a foreign edge snaps onto
 * that target exactly. Tries every source corner against every foreign
 * snap target; the closest pair wins. Returns the original offset when
 * nothing's in range.
 *
 * "Foreign" excludes:
 *   - corners and edges on the source section itself,
 *   - corners on neighbour sections world-coincident with any source
 *     corner (cascade partners — they translate with us, so they're not
 *     stationary snap targets),
 *   - edges with either endpoint flagged as a cascade partner (they
 *     deform with us).
 */
export function snapSectionOffset(
	model: ParsedAISectionsV12,
	srcIdx: number,
	proposedOffset: { x: number; z: number },
	snapRadius: number,
): { x: number; z: number } {
	if (srcIdx < 0 || srcIdx >= model.sections.length) return proposedOffset;
	if (snapRadius <= 0) return proposedOffset;

	const src = model.sections[srcIdx];
	const srcCorners = src.corners;

	const isCascadePartner = (c: Vector2): boolean => {
		for (const s of srcCorners) {
			if (Math.abs(s.x - c.x) < POSITION_EPS && Math.abs(s.y - c.y) < POSITION_EPS) {
				return true;
			}
		}
		return false;
	};

	let bestDist = snapRadius;
	let bestAdjustment: { x: number; z: number } | null = null;

	for (const srcCorner of srcCorners) {
		const probe: Vector2 = {
			x: srcCorner.x + proposedOffset.x,
			y: srcCorner.y + proposedOffset.z,
		};
		const found = findNearestSnapTarget(model, srcIdx, probe, bestDist, isCascadePartner);
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
 * Adjust a proposed corner-drag offset so the dragged corner snaps onto
 * the closest foreign corner OR point on a foreign edge within
 * `snapRadius`. Returns the original offset when nothing's in range.
 */
export function snapCornerOffset(
	model: ParsedAISectionsV12,
	srcIdx: number,
	cornerIdx: number,
	proposedOffset: { x: number; z: number },
	snapRadius: number,
): { x: number; z: number } {
	if (srcIdx < 0 || srcIdx >= model.sections.length) return proposedOffset;
	const src = model.sections[srcIdx];
	if (cornerIdx < 0 || cornerIdx >= src.corners.length) return proposedOffset;
	if (snapRadius <= 0) return proposedOffset;

	const oldCorner = src.corners[cornerIdx];
	const probe: Vector2 = {
		x: oldCorner.x + proposedOffset.x,
		y: oldCorner.y + proposedOffset.z,
	};

	const isCascadePartner = (c: Vector2): boolean =>
		Math.abs(c.x - oldCorner.x) < POSITION_EPS &&
		Math.abs(c.y - oldCorner.y) < POSITION_EPS;

	const found = findNearestSnapTarget(model, srcIdx, probe, snapRadius, isCascadePartner);
	if (!found) return proposedOffset;

	return {
		x: found.point.x - oldCorner.x,
		z: found.point.y - oldCorner.y,
	};
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
 * Variant of {@link findNearestSnapTarget} that walks `LegacyAISectionsData`.
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
// Smart corner-drag (with shared-point cascade)
// =============================================================================

/**
 * Storage-shape adapter for the corner-drag op. V12 sections store corners
 * as `Vector2[]` (with the `y` field being world-Z); V4/V6 sections store
 * them as parallel `cornersX[]` + `cornersZ[]` f32 arrays. The smart-drag
 * algorithm is identical in both — find every corner / boundary-line
 * endpoint coincident with the dragged point, shift them by the same
 * offset — so we factor the storage difference out into this adapter and
 * keep one op implementation.
 *
 * `getCorners` projects to the canonical `Vector2`-on-XZ shape (`{x, y=z}`,
 * matching V12's native storage), and `setCorners` writes back through
 * whichever native layout the section uses. Boundary lines on V12 and V4/V6
 * already share the `BoundaryLine` Vector4 shape, so no boundary-line
 * adapter is needed — the `BoundaryLine` type alias here covers both
 * (`LegacyBoundaryLine` is structurally identical to `BoundaryLine`).
 */
type SectionLikeShape<S, P, BL extends { verts: { x: number; y: number; z: number; w: number } }> = {
	getCorners: (s: S) => Vector2[];
	setCorners: (s: S, corners: Vector2[]) => S;
	getPortals: (s: S) => P[];
	setPortals: (s: S, portals: P[]) => S;
	getNoGoLines: (s: S) => BL[];
	setNoGoLines: (s: S, lines: BL[]) => S;
	getPortalBoundaryLines: (p: P) => BL[];
	setPortalBoundaryLines: (p: P, lines: BL[]) => P;
};

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
 * Generic smart corner-drag — the meat of `translateCornerWithShared`
 * (V12) and `translateLegacyCornerWithShared` (V4/V6). Walks every section
 * via the supplied `shape`, looking for corners and boundary-line endpoints
 * that coincide with the OLD dragged-corner position, and shifts them by
 * `(dx, dz)`. Sections, portals, and lines that don't touch the dragged
 * point are returned `===`-identical so React renderers can cheaply skip.
 */
function translateCornerWithSharedGeneric<
	S,
	P,
	BL extends { verts: { x: number; y: number; z: number; w: number } },
>(
	sections: S[],
	srcIdx: number,
	cornerIdx: number,
	offset: { x: number; z: number },
	shape: SectionLikeShape<S, P, BL>,
): { sections: S[]; changed: boolean } {
	if (srcIdx < 0 || srcIdx >= sections.length) {
		throw new RangeError(`srcIdx ${srcIdx} out of range [0, ${sections.length})`);
	}
	const src = sections[srcIdx];
	const srcCorners = shape.getCorners(src);
	if (cornerIdx < 0 || cornerIdx >= srcCorners.length) {
		throw new RangeError(`cornerIdx ${cornerIdx} out of range [0, ${srcCorners.length})`);
	}
	if (offset.x === 0 && offset.z === 0) return { sections, changed: false };

	const oldCorner = srcCorners[cornerIdx];
	const dx = offset.x;
	const dz = offset.z;

	let anyChanged = false;
	const next = sections.map((sec) => {
		const corners = shape.getCorners(sec);
		let cornersChanged = false;
		const newCorners = corners.map((c) => {
			if (v2Approx(c, oldCorner)) {
				cornersChanged = true;
				return { x: c.x + dx, y: c.y + dz };
			}
			return c;
		});

		const portals = shape.getPortals(sec);
		let portalsChanged = false;
		const newPortals = portals.map((p) => {
			const bls = shape.getPortalBoundaryLines(p);
			let blsChanged = false;
			const newBLs = bls.map((bl) => {
				const shifted = shiftBoundaryEndpointsAt(bl, oldCorner, dx, dz);
				if (shifted !== bl) blsChanged = true;
				return shifted;
			});
			if (!blsChanged) return p;
			portalsChanged = true;
			return shape.setPortalBoundaryLines(p, newBLs);
		});

		const noGo = shape.getNoGoLines(sec);
		let noGoChanged = false;
		const newNoGo = noGo.map((bl) => {
			const shifted = shiftBoundaryEndpointsAt(bl, oldCorner, dx, dz);
			if (shifted !== bl) noGoChanged = true;
			return shifted;
		});

		if (!cornersChanged && !portalsChanged && !noGoChanged) return sec;
		anyChanged = true;
		let updated = sec;
		if (cornersChanged) updated = shape.setCorners(updated, newCorners);
		if (portalsChanged) updated = shape.setPortals(updated, newPortals);
		if (noGoChanged) updated = shape.setNoGoLines(updated, newNoGo);
		return updated;
	});

	return { sections: anyChanged ? next : sections, changed: anyChanged };
}

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

/**
 * Return a new BoundaryLine with any endpoint that matches `point` shifted
 * by `(dx, dz)`. Returns the original input (`===`-equal) when no endpoint
 * matched, so callers can detect "no change" cheaply.
 *
 * Generic over the boundary-line shape — V12 `BoundaryLine` and V4/V6
 * `LegacyBoundaryLine` are structurally identical (both wrap a Vector4
 * packing the two endpoints) so the same helper drives both ops.
 */
function shiftBoundaryEndpointsAt<BL extends { verts: { x: number; y: number; z: number; w: number } }>(
	bl: BL,
	point: Vector2,
	dx: number,
	dz: number,
): BL {
	const startMatches =
		Math.abs(bl.verts.x - point.x) < POSITION_EPS &&
		Math.abs(bl.verts.y - point.y) < POSITION_EPS;
	const endMatches =
		Math.abs(bl.verts.z - point.x) < POSITION_EPS &&
		Math.abs(bl.verts.w - point.y) < POSITION_EPS;
	if (!startMatches && !endMatches) return bl;
	return {
		...bl,
		verts: {
			x: startMatches ? bl.verts.x + dx : bl.verts.x,
			y: startMatches ? bl.verts.y + dz : bl.verts.y,
			z: endMatches ? bl.verts.z + dx : bl.verts.z,
			w: endMatches ? bl.verts.w + dz : bl.verts.w,
		},
	};
}

// =============================================================================
// Delete-section
// =============================================================================

/**
 * Remove the section at `idx` and re-thread every cross-reference so the
 * model stays internally consistent.
 *
 * Section indices are u16 keys used in two places:
 *   - `Portal.linkSection` (every other section's portals)
 *   - `SectionResetPair.startSectionIndex` / `.resetSectionIndex`
 *
 * A naive `sections.filter` would silently break those references — every
 * index `> idx` would then point at the section that *used* to be one slot
 * later, which is almost always wrong. This function:
 *
 *   1. Drops references *to* `idx` (orphans):
 *      - portals on other sections whose `linkSection === idx` are removed.
 *      - reset pairs that reference `idx` in either field are removed.
 *   2. Decrements references `> idx` by 1 to keep the remaining sections
 *      pointing at the same logical neighbours after the splice.
 *
 * @throws RangeError if `idx` is out of range.
 */
export function deleteSection(
	model: ParsedAISectionsV12,
	idx: number,
): ParsedAISectionsV12 {
	if (idx < 0 || idx >= model.sections.length) {
		throw new RangeError(`idx ${idx} out of range [0, ${model.sections.length})`);
	}

	// Step 1: rewrite every surviving section's portals — drop orphans, shift
	// links above `idx` down by one. Sections before `idx` are unaffected by
	// the index shift but may still own a portal pointing AT `idx`, so we
	// always rewrite portals on every section.
	const remappedSections: AISection[] = model.sections
		.filter((_, i) => i !== idx)
		.map((s) => {
			const newPortals: Portal[] = [];
			let portalsChanged = false;
			for (const p of s.portals) {
				if (p.linkSection === idx) {
					// Orphaned — the section it pointed at is gone.
					portalsChanged = true;
					continue;
				}
				if (p.linkSection > idx) {
					newPortals.push({ ...p, linkSection: p.linkSection - 1 });
					portalsChanged = true;
				} else {
					newPortals.push(p);
				}
			}
			return portalsChanged ? { ...s, portals: newPortals } : s;
		});

	// Step 2: same treatment for reset pairs — drop any that reference `idx`,
	// shift indices above `idx` down by one.
	const remappedResetPairs = model.sectionResetPairs.flatMap((rp) => {
		if (rp.startSectionIndex === idx || rp.resetSectionIndex === idx) {
			return [];
		}
		const start = rp.startSectionIndex > idx ? rp.startSectionIndex - 1 : rp.startSectionIndex;
		const reset = rp.resetSectionIndex > idx ? rp.resetSectionIndex - 1 : rp.resetSectionIndex;
		if (start === rp.startSectionIndex && reset === rp.resetSectionIndex) {
			return [rp];
		}
		return [{ ...rp, startSectionIndex: start, resetSectionIndex: reset }];
	});

	return {
		...model,
		sections: remappedSections,
		sectionResetPairs: remappedResetPairs,
	};
}

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
function applyRotateLinkFixUp(
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

/**
 * Cascade-on translate of a multi-section **Selection** by an XZ offset.
 * Layered on top of {@link translateSectionWithLinks}: each selected section
 * is translated with the one-hop cascade rule, but cascades INTO other
 * Selection members are skipped — the inside of the Selection moves as one
 * rigid body, and only OUTSIDE neighbours get their reverse portals + shared
 * corners dragged along (per the issue #75 acceptance criterion "cascade
 * applied to every Selection-boundary portal/corner").
 *
 * Why we can't just call `translateSectionWithLinks` per member: cascading
 * into another Selection member would double-translate that member (once by
 * its own gizmo translate, once by the cascade from the previous member).
 * The inside-Selection cascade is also redundant — both members move by the
 * same delta, so their shared boundary stays coincident either way.
 *
 * Algorithm:
 *   1. Build a set of cascade-target indices = the Selection's complement,
 *      restricted to neighbours of any Selection member.
 *   2. For each Selection member: apply the rigid translate to the source,
 *      then for each of its portals pointing at a target NOT in the
 *      Selection, apply the same one-hop fix-up `applyLinkFixUp` uses
 *      (translate the reverse portal + shared corners).
 *   3. Selection-internal portals get their `position` and `boundaryLines`
 *      translated as part of the rigid move on the source side; the matching
 *      reverse portal on the OTHER Selection member is similarly translated
 *      by its own pass, so the pair stays coherent without explicit cascade.
 *
 * Returns the original `model` reference when `(dx, dz) === (0, 0)` so
 * byte-for-byte BND2 writeback is preserved on a no-op gesture.
 *
 * Layered on top of issue #74's bulk path — when #74 lands and the bulk
 * Selection has its own carrier, this op consumes the same `readonly
 * number[]` of section indices. Today's caller is issue #75's cascade-on
 * path for single-section selections too (selectedIndices = [i]); behaviour
 * matches `translateSectionWithLinks` exactly in that single-member case.
 *
 * @throws RangeError if any index in `selectedIndices` is out of range.
 */
export function translateSelectionWithLinks(
	model: ParsedAISectionsV12,
	selectedIndices: readonly number[],
	offset: { x: number; z: number },
): ParsedAISectionsV12 {
	if (selectedIndices.length === 0) return model;
	for (const idx of selectedIndices) {
		if (idx < 0 || idx >= model.sections.length) {
			throw new RangeError(`section index ${idx} out of range [0, ${model.sections.length})`);
		}
	}
	if (offset.x === 0 && offset.z === 0) return model;

	const dx = offset.x;
	const dz = offset.z;
	const selectedSet = new Set<number>(selectedIndices);

	// Per-section update accumulator (same shape as the single-section op).
	const updates = new Map<number, AISection>();

	// Pass 1 — rigid-translate every selected section. This is the "inside
	// the Selection moves as one block" pass; outside cascade lands in pass 2.
	for (const idx of selectedSet) {
		const src = model.sections[idx];
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
		updates.set(idx, srcTranslated);
	}

	// Pass 2 — cascade into outside neighbours. We walk every Selection
	// member's ORIGINAL portals (not the post-translate ones — `oldSrcPortal`
	// in `applyLinkFixUp` references pre-translate positions for the lookup
	// of coincident reverse portals + shared corners).
	for (const idx of selectedSet) {
		const src = model.sections[idx];
		for (const oldPortal of src.portals) {
			const targetIdx = oldPortal.linkSection;
			if (targetIdx === idx) continue;
			if (targetIdx < 0 || targetIdx >= model.sections.length) continue;
			// Skip cascades INTO another Selection member — that member's
			// rigid translate from pass 1 already covers the shared edge.
			if (selectedSet.has(targetIdx)) continue;

			const current = updates.get(targetIdx) ?? model.sections[targetIdx];
			const fixed = applyLinkFixUp(current, idx, oldPortal, dx, dz);
			if (fixed !== current) updates.set(targetIdx, fixed);
		}
	}

	const sections = model.sections.map((s, i) => updates.get(i) ?? s);
	return { ...model, sections };
}

/**
 * Cascade-on yaw rotate of a multi-section **Selection** by `theta` radians
 * around `pivot` (the Selection's median XZ, per CONTEXT.md / "Pivot"). The
 * yaw-axis sibling of {@link translateSelectionWithLinks}: every selected
 * section rotates as a rigid body around the shared pivot, and for any
 * portal on a Selection member pointing OUTSIDE the Selection, the reverse
 * portal + shared corners on the outside neighbour rotate around the same
 * pivot. Selection-internal portals are covered by the rigid-pass on both
 * member sides — they move together so their shared edge stays coincident.
 *
 * Returns the original `model` reference when `theta === 0` so byte-for-byte
 * BND2 writeback is preserved on a no-op gesture.
 *
 * @throws RangeError if any index in `selectedIndices` is out of range.
 */
export function rotateSelectionWithLinksYaw(
	model: ParsedAISectionsV12,
	selectedIndices: readonly number[],
	pivot: { x: number; z: number },
	theta: number,
): ParsedAISectionsV12 {
	if (selectedIndices.length === 0) return model;
	for (const idx of selectedIndices) {
		if (idx < 0 || idx >= model.sections.length) {
			throw new RangeError(`section index ${idx} out of range [0, ${model.sections.length})`);
		}
	}
	if (theta === 0) return model;

	const cx = pivot.x;
	const cz = pivot.z;
	const cosT = Math.cos(theta);
	const sinT = Math.sin(theta);
	const rotXZ = (x: number, z: number): { x: number; z: number } => {
		const ox = x - cx;
		const oz = z - cz;
		return {
			x: ox * cosT - oz * sinT + cx,
			z: ox * sinT + oz * cosT + cz,
		};
	};

	const selectedSet = new Set<number>(selectedIndices);
	const updates = new Map<number, AISection>();

	// Pass 1 — rigid yaw rotate of every Selection member around the
	// shared pivot. All members spin lockstep so their relative geometry
	// is preserved.
	for (const idx of selectedSet) {
		const src = model.sections[idx];
		updates.set(idx, {
			...src,
			corners: src.corners.map((c) => {
				const r = rotXZ(c.x, c.y);
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
		});
	}

	// Pass 2 — cascade into outside neighbours via per-member portals
	// pointing OUTSIDE the Selection. Same shape as the single-section
	// rotate cascade, just iterated over the Selection.
	for (const idx of selectedSet) {
		const src = model.sections[idx];
		for (const oldPortal of src.portals) {
			const targetIdx = oldPortal.linkSection;
			if (targetIdx === idx) continue;
			if (targetIdx < 0 || targetIdx >= model.sections.length) continue;
			if (selectedSet.has(targetIdx)) continue;

			const current = updates.get(targetIdx) ?? model.sections[targetIdx];
			const fixed = applyRotateLinkFixUp(current, idx, oldPortal, rotXZ);
			if (fixed !== current) updates.set(targetIdx, fixed);
		}
	}

	const sections = model.sections.map((s, i) => updates.get(i) ?? s);
	return { ...model, sections };
}


// =============================================================================
// Bulk-transform: multi-Selection rigid translate + yaw rotate
// =============================================================================
//
// The multi-Selection slice of **Bulk transform** (issue #74, CONTEXT.md /
// "Bulk transform", ADR-0009 / ADR-0010 / ADR-0011) lets the marquee pick
// several whole AI sections (and/or sub-entities like portals and line
// endpoints under the inspector) and treats the whole bunch as one rigid
// body. The single-entity ops above (`translateSectionRigid`,
// `rotateSectionAroundCentroidYaw`) handle cardinality 1; the bulk ops
// below handle cardinality ≥ 2.
//
// Entity references are a discriminated union — a flat list of "which
// spatial thing in the model to move." A whole-section ref pulls the
// section's entire corners + portal anchors + portal-BL endpoints + no-go
// endpoints through the transform. Sub-entity refs (portal anchor, boundary
// line endpoint, no-go line endpoint) move only the single spatial datum
// they address; the surrounding section is otherwise untouched.
//
// Rigid-body interpretation (load-bearing): every spatial coordinate in
// every selected entity orbits the single bulk pivot. We do NOT treat each
// whole-section as having an independent centre — the bulk is one rigid
// body, period. This preserves relative distances within the bulk
// (acceptance criterion: "yaw-rotating the bulk rotates every selected
// entity around the pivot as a rigid body — each section's relative
// geometry preserved"). Letting each section spin around its own centre
// would translate sections without rotating their geometry, breaking the
// rigid-body invariant on inter-section distances.
//
// No cascade (ADR-0009): the only things that move are the entities
// explicitly named in the refs list. Outside neighbours of any selected
// section stay completely put — their reverse-portal anchors will be left
// "stale" relative to the moved portals, which is the documented v1
// trade-off.

/** Discriminated reference to a single spatial datum inside a V12 AI sections
 *  model. The multi-Selection bulk transform takes an array of these. */
export type AISectionEntityRef =
	/** The whole section — corners, portal positions, portal BL endpoints,
	 *  and no-go line endpoints all move together. */
	| { kind: 'section'; sectionIdx: number }
	/** A single portal's 3D anchor (`position`). Portal boundary lines and
	 *  the parent section's corners stay put. */
	| { kind: 'portal'; sectionIdx: number; portalIdx: number }
	/** One endpoint (start or end) of a portal's boundary line. `end = 0`
	 *  addresses `(verts.x, verts.y)`; `end = 1` addresses `(verts.z, verts.w)`. */
	| { kind: 'boundaryLineEndpoint'; sectionIdx: number; portalIdx: number; lineIdx: number; end: 0 | 1 }
	/** One endpoint (start or end) of a no-go line, indexed the same as boundary lines. */
	| { kind: 'noGoLineEndpoint'; sectionIdx: number; lineIdx: number; end: 0 | 1 };

/**
 * Median (per-component) of every spatial point the bulk Selection
 * addresses. The result is in display coordinates — `{x, y, z}` where
 * `y` is the editor's vertical (yaw axis).
 *
 * - Whole sections contribute every corner (`(x, sectionY, z)` — corners
 *   are XZ-packed Vector2 so we read the section's Y from the supplied
 *   `sectionY` resolver) plus every portal position.
 * - Portal refs contribute the portal position.
 * - Boundary/no-go line endpoint refs contribute the endpoint at
 *   `(x, sectionY, z)`.
 *
 * Median (not centroid) so a tight cluster + a few outliers anchors near
 * the cluster — matches the spec's "median of all selected positions"
 * (CONTEXT.md / "Pivot"). Returns `null` when the refs list is empty or
 * every ref points at an out-of-range entity.
 */
export function bulkSelectionPivot(
	model: ParsedAISectionsV12,
	refs: readonly AISectionEntityRef[],
	sectionY: (sectionIdx: number) => number,
): { x: number; y: number; z: number } | null {
	const xs: number[] = [];
	const ys: number[] = [];
	const zs: number[] = [];
	for (const ref of refs) {
		const sec = model.sections[ref.sectionIdx];
		if (!sec) continue;
		const y = sectionY(ref.sectionIdx);
		if (ref.kind === 'section') {
			for (const c of sec.corners) {
				xs.push(c.x); ys.push(y); zs.push(c.y);
			}
			for (const p of sec.portals) {
				xs.push(p.position.x); ys.push(p.position.y); zs.push(p.position.z);
			}
			continue;
		}
		if (ref.kind === 'portal') {
			const p = sec.portals[ref.portalIdx];
			if (!p) continue;
			xs.push(p.position.x); ys.push(p.position.y); zs.push(p.position.z);
			continue;
		}
		if (ref.kind === 'boundaryLineEndpoint') {
			const p = sec.portals[ref.portalIdx];
			const bl = p?.boundaryLines[ref.lineIdx];
			if (!bl) continue;
			if (ref.end === 0) { xs.push(bl.verts.x); ys.push(y); zs.push(bl.verts.y); }
			else { xs.push(bl.verts.z); ys.push(y); zs.push(bl.verts.w); }
			continue;
		}
		if (ref.kind === 'noGoLineEndpoint') {
			const bl = sec.noGoLines[ref.lineIdx];
			if (!bl) continue;
			if (ref.end === 0) { xs.push(bl.verts.x); ys.push(y); zs.push(bl.verts.y); }
			else { xs.push(bl.verts.z); ys.push(y); zs.push(bl.verts.w); }
			continue;
		}
	}
	if (xs.length === 0) return null;
	return { x: median(xs), y: median(ys), z: median(zs) };
}

function median(values: number[]): number {
	const sorted = values.slice().sort((a, b) => a - b);
	const n = sorted.length;
	if (n === 0) return 0;
	const mid = n >> 1;
	return n % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// Group refs by section index so we build each updated section in one pass.
// Multiple sub-entity refs into the same section share a bucket and are
// applied together; sections with no refs of any kind keep their original
// reference (the section-by-section map below returns `sec` untouched).
type SectionRefBucket = {
	wholeSection: boolean;
	portalIdxs: Set<number>;
	/** Bitmask: 1 = start endpoint selected, 2 = end endpoint selected, 3 = both.
	 *  Keyed by `${portalIdx}/${lineIdx}` so a (portalIdx, lineIdx, end) triple
	 *  collapses to one bucket entry. */
	blEndpoints: Map<string, number>;
	noGoEndpoints: Map<number, number>;
};

function bucketRefs(refs: readonly AISectionEntityRef[]): Map<number, SectionRefBucket> {
	const map = new Map<number, SectionRefBucket>();
	for (const ref of refs) {
		let bucket = map.get(ref.sectionIdx);
		if (!bucket) {
			bucket = {
				wholeSection: false,
				portalIdxs: new Set(),
				blEndpoints: new Map(),
				noGoEndpoints: new Map(),
			};
			map.set(ref.sectionIdx, bucket);
		}
		if (ref.kind === 'section') {
			bucket.wholeSection = true;
		} else if (ref.kind === 'portal') {
			bucket.portalIdxs.add(ref.portalIdx);
		} else if (ref.kind === 'boundaryLineEndpoint') {
			const key = `${ref.portalIdx}/${ref.lineIdx}`;
			const mask = (bucket.blEndpoints.get(key) ?? 0) | (ref.end === 0 ? 1 : 2);
			bucket.blEndpoints.set(key, mask);
		} else {
			const mask = (bucket.noGoEndpoints.get(ref.lineIdx) ?? 0) | (ref.end === 0 ? 1 : 2);
			bucket.noGoEndpoints.set(ref.lineIdx, mask);
		}
	}
	return map;
}

/**
 * Translate every entity in the multi-Selection by the same `(dx, dy, dz)`
 * offset, treating the bulk as one rigid body. No cascade — outside
 * neighbours stay put (ADR-0009).
 *
 * Whole-section refs translate the section's corners + every portal anchor
 * + every portal boundary-line endpoint + every no-go line endpoint. Y
 * shifts the portal anchor heights only (corners and line endpoints are
 * XZ-packed — ADR-0011).
 *
 * Sub-entity refs move only the addressed spatial datum:
 *   - portal: the Vector3 `position` (full 3D).
 *   - boundaryLineEndpoint / noGoLineEndpoint: the XZ pair only (no Y).
 *
 * Returns the original `model` reference on a (0, 0, 0) offset OR an empty
 * refs list so byte-for-byte BND2 writeback is preserved on a no-op gesture.
 */
export function bulkTranslateEntities(
	model: ParsedAISectionsV12,
	refs: readonly AISectionEntityRef[],
	offset: { x: number; y: number; z: number },
): ParsedAISectionsV12 {
	const dx = offset.x;
	const dy = offset.y;
	const dz = offset.z;
	if (dx === 0 && dy === 0 && dz === 0) return model;
	if (refs.length === 0) return model;

	const buckets = bucketRefs(refs);
	let anyChange = false;
	const nextSections = model.sections.map((sec, sectionIdx) => {
		const bucket = buckets.get(sectionIdx);
		if (!bucket) return sec;

		// Whole-section ref: translate everything spatial in this section.
		if (bucket.wholeSection) {
			anyChange = true;
			return {
				...sec,
				corners: sec.corners.map((c) => ({ x: c.x + dx, y: c.y + dz })),
				portals: sec.portals.map((p) => ({
					...p,
					position: { x: p.position.x + dx, y: p.position.y + dy, z: p.position.z + dz },
					boundaryLines: p.boundaryLines.map((bl) => ({
						verts: { x: bl.verts.x + dx, y: bl.verts.y + dz, z: bl.verts.z + dx, w: bl.verts.w + dz },
					})),
				})),
				noGoLines: sec.noGoLines.map((bl) => ({
					verts: { x: bl.verts.x + dx, y: bl.verts.y + dz, z: bl.verts.z + dx, w: bl.verts.w + dz },
				})),
			};
		}

		// Sub-entity refs only — touch the specific portals / endpoints, leave
		// every other field of this section structurally identical (=== equal).
		let sectionTouched = false;

		const nextPortals = sec.portals.map((p, pi) => {
			const portalSelected = bucket.portalIdxs.has(pi);
			const blMask = (li: number) => bucket.blEndpoints.get(`${pi}/${li}`) ?? 0;
			let portalTouched = false;
			let position = p.position;
			if (portalSelected) {
				position = { x: p.position.x + dx, y: p.position.y + dy, z: p.position.z + dz };
				portalTouched = true;
			}
			const nextBls = p.boundaryLines.map((bl, li) => {
				const m = blMask(li);
				if (m === 0) return bl;
				portalTouched = true;
				const startSelected = (m & 1) !== 0;
				const endSelected = (m & 2) !== 0;
				return {
					verts: {
						x: startSelected ? bl.verts.x + dx : bl.verts.x,
						y: startSelected ? bl.verts.y + dz : bl.verts.y,
						z: endSelected ? bl.verts.z + dx : bl.verts.z,
						w: endSelected ? bl.verts.w + dz : bl.verts.w,
					},
				};
			});
			if (!portalTouched) return p;
			sectionTouched = true;
			return { ...p, position, boundaryLines: nextBls };
		});

		const nextNoGo = sec.noGoLines.map((bl, li) => {
			const m = bucket.noGoEndpoints.get(li) ?? 0;
			if (m === 0) return bl;
			sectionTouched = true;
			const startSelected = (m & 1) !== 0;
			const endSelected = (m & 2) !== 0;
			return {
				verts: {
					x: startSelected ? bl.verts.x + dx : bl.verts.x,
					y: startSelected ? bl.verts.y + dz : bl.verts.y,
					z: endSelected ? bl.verts.z + dx : bl.verts.z,
					w: endSelected ? bl.verts.w + dz : bl.verts.w,
				},
			};
		});

		if (!sectionTouched) return sec;
		anyChange = true;
		return { ...sec, portals: nextPortals, noGoLines: nextNoGo };
	});

	if (!anyChange) return model;
	return { ...model, sections: nextSections };
}

/**
 * Rotate every entity in the multi-Selection around the same world-space
 * `pivot` by `theta` radians of yaw (around world +Y). Treats the bulk as
 * one rigid body — every selected spatial coordinate orbits the single
 * pivot, so relative distances within the bulk are preserved exactly.
 *
 * Whole-section refs rotate the section's corners + every portal anchor
 * (XZ rotated, Y untouched) + every portal boundary-line endpoint + every
 * no-go line endpoint. Sub-entity refs rotate only the addressed coordinate.
 *
 * Yaw direction follows the right-hand rule with thumb along world +Y, so
 * positive `theta` rotates +X towards +Z — same convention as
 * `rotateSectionAroundCentroidYaw` and three.js's `Object3D.rotation.y`.
 *
 * Returns the original `model` reference on `theta === 0` OR an empty refs
 * list so byte-for-byte BND2 writeback is preserved on a no-op gesture.
 */
export function bulkRotateEntitiesYaw(
	model: ParsedAISectionsV12,
	refs: readonly AISectionEntityRef[],
	pivot: { x: number; z: number },
	theta: number,
): ParsedAISectionsV12 {
	if (theta === 0) return model;
	if (refs.length === 0) return model;

	const cosT = Math.cos(theta);
	const sinT = Math.sin(theta);
	const cx = pivot.x;
	const cz = pivot.z;

	const rotXZ = (x: number, z: number): { x: number; z: number } => {
		const ox = x - cx;
		const oz = z - cz;
		return {
			x: ox * cosT - oz * sinT + cx,
			z: ox * sinT + oz * cosT + cz,
		};
	};

	const buckets = bucketRefs(refs);
	let anyChange = false;
	const nextSections = model.sections.map((sec, sectionIdx) => {
		const bucket = buckets.get(sectionIdx);
		if (!bucket) return sec;

		if (bucket.wholeSection) {
			anyChange = true;
			return {
				...sec,
				corners: sec.corners.map((corner) => {
					const r = rotXZ(corner.x, corner.y);
					return { x: r.x, y: r.z };
				}),
				portals: sec.portals.map((p) => {
					const rp = rotXZ(p.position.x, p.position.z);
					return {
						...p,
						position: { x: rp.x, y: p.position.y, z: rp.z },
						boundaryLines: p.boundaryLines.map((bl) => {
							const rs = rotXZ(bl.verts.x, bl.verts.y);
							const re = rotXZ(bl.verts.z, bl.verts.w);
							return { verts: { x: rs.x, y: rs.z, z: re.x, w: re.z } };
						}),
					};
				}),
				noGoLines: sec.noGoLines.map((bl) => {
					const rs = rotXZ(bl.verts.x, bl.verts.y);
					const re = rotXZ(bl.verts.z, bl.verts.w);
					return { verts: { x: rs.x, y: rs.z, z: re.x, w: re.z } };
				}),
			};
		}

		let sectionTouched = false;

		const nextPortals = sec.portals.map((p, pi) => {
			const portalSelected = bucket.portalIdxs.has(pi);
			const blMask = (li: number) => bucket.blEndpoints.get(`${pi}/${li}`) ?? 0;
			let portalTouched = false;
			let position = p.position;
			if (portalSelected) {
				const rp = rotXZ(p.position.x, p.position.z);
				position = { x: rp.x, y: p.position.y, z: rp.z };
				portalTouched = true;
			}
			const nextBls = p.boundaryLines.map((bl, li) => {
				const m = blMask(li);
				if (m === 0) return bl;
				portalTouched = true;
				const startSelected = (m & 1) !== 0;
				const endSelected = (m & 2) !== 0;
				const rs = startSelected ? rotXZ(bl.verts.x, bl.verts.y) : { x: bl.verts.x, z: bl.verts.y };
				const re = endSelected ? rotXZ(bl.verts.z, bl.verts.w) : { x: bl.verts.z, z: bl.verts.w };
				return { verts: { x: rs.x, y: rs.z, z: re.x, w: re.z } };
			});
			if (!portalTouched) return p;
			sectionTouched = true;
			return { ...p, position, boundaryLines: nextBls };
		});

		const nextNoGo = sec.noGoLines.map((bl, li) => {
			const m = bucket.noGoEndpoints.get(li) ?? 0;
			if (m === 0) return bl;
			sectionTouched = true;
			const startSelected = (m & 1) !== 0;
			const endSelected = (m & 2) !== 0;
			const rs = startSelected ? rotXZ(bl.verts.x, bl.verts.y) : { x: bl.verts.x, z: bl.verts.y };
			const re = endSelected ? rotXZ(bl.verts.z, bl.verts.w) : { x: bl.verts.z, z: bl.verts.w };
			return { verts: { x: rs.x, y: rs.z, z: re.x, w: re.z } };
		});

		if (!sectionTouched) return sec;
		anyChange = true;
		return { ...sec, portals: nextPortals, noGoLines: nextNoGo };
	});

	if (!anyChange) return model;
	return { ...model, sections: nextSections };
}

/**
 * Compute the **effective** TransformAxes for a multi-Selection of AI section
 * entities. Per ADR-0011, every entity in this slice is XZ-packed (corners,
 * boundary lines, no-go lines) or has a single-axis yaw freedom (portal
 * anchors as 3D points still inherit the XZ-only rotate restriction because
 * the bulk's combined rotation has to apply uniformly to its XZ-packed
 * neighbours in the same bulk). So an AI-section-only bulk always reports
 * yaw-only — pitch/roll rings render disabled.
 *
 * Returns `null` for an empty refs list so the caller can fall back to
 * showing no gizmo. The function exists as a separate export so future
 * resource families (trigger boxes, static vehicles) can declare their own
 * per-entity-ref axes and have `intersectTransformAxes` AND them down.
 */
export function bulkAISectionsAxes(
	refs: readonly AISectionEntityRef[],
): { translate: { x: boolean; y: boolean; z: boolean }; rotate: { x: boolean; y: boolean; z: boolean } } | null {
	if (refs.length === 0) return null;
	// Every AI-section entity (whole section, portal, line endpoint) is in an
	// XZ-packed family — yaw-only. The intersection of all-yaw is yaw.
	return {
		translate: { x: true, y: true, z: true },
		rotate: { x: false, y: true, z: false },
	};
}
