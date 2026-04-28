// AISections higher-level operations.
//
// Pure functions that mutate a `ParsedAISections` model immutably — i.e.,
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
	ParsedAISections,
	Portal,
	Vector2,
} from './aiSections';

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
	model: ParsedAISections,
	srcIdx: number,
	edgeIdx: number,
): ParsedAISections {
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

	// Anchor height: copy from the source's first existing portal, fall back
	// to 0. Corners are 2D (XZ) so they don't carry height information.
	const anchorY = src.portals[0]?.position.y ?? 0;
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
function nextFreeId(model: ParsedAISections): number {
	let max = 0;
	for (const s of model.sections) {
		if (s.id > max) max = s.id;
	}
	// Wrap defensively in case ids approach the u32 ceiling.
	return ((max + 1) >>> 0);
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
	model: ParsedAISections,
	srcIdx: number,
	offset: { x: number; z: number },
): ParsedAISections {
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
// Smart corner-drag (with shared-point cascade)
// =============================================================================

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
	model: ParsedAISections,
	srcIdx: number,
	cornerIdx: number,
	offset: { x: number; z: number },
): ParsedAISections {
	if (srcIdx < 0 || srcIdx >= model.sections.length) {
		throw new RangeError(`srcIdx ${srcIdx} out of range [0, ${model.sections.length})`);
	}
	const src = model.sections[srcIdx];
	if (cornerIdx < 0 || cornerIdx >= src.corners.length) {
		throw new RangeError(`cornerIdx ${cornerIdx} out of range [0, ${src.corners.length})`);
	}
	if (offset.x === 0 && offset.z === 0) return model;

	const oldCorner = src.corners[cornerIdx];
	const dx = offset.x;
	const dz = offset.z;

	const sections = model.sections.map((sec) => {
		let cornersChanged = false;
		const newCorners = sec.corners.map((c) => {
			if (v2Approx(c, oldCorner)) {
				cornersChanged = true;
				return { x: c.x + dx, y: c.y + dz };
			}
			return c;
		});

		let portalsChanged = false;
		const newPortals = sec.portals.map((p) => {
			let blsChanged = false;
			const newBLs = p.boundaryLines.map((bl) => {
				const next = shiftBoundaryEndpointsAt(bl, oldCorner, dx, dz);
				if (next !== bl) blsChanged = true;
				return next;
			});
			if (!blsChanged) return p;
			portalsChanged = true;
			return { ...p, boundaryLines: newBLs };
		});

		let noGoChanged = false;
		const newNoGo = sec.noGoLines.map((bl) => {
			const next = shiftBoundaryEndpointsAt(bl, oldCorner, dx, dz);
			if (next !== bl) noGoChanged = true;
			return next;
		});

		if (!cornersChanged && !portalsChanged && !noGoChanged) return sec;
		return {
			...sec,
			corners: cornersChanged ? newCorners : sec.corners,
			portals: portalsChanged ? newPortals : sec.portals,
			noGoLines: noGoChanged ? newNoGo : sec.noGoLines,
		};
	});

	return { ...model, sections };
}

/**
 * Return a new BoundaryLine with any endpoint that matches `point` shifted
 * by `(dx, dz)`. Returns the original input (`===`-equal) when no endpoint
 * matched, so callers can detect "no change" cheaply.
 */
function shiftBoundaryEndpointsAt(
	bl: BoundaryLine,
	point: Vector2,
	dx: number,
	dz: number,
): BoundaryLine {
	const startMatches =
		Math.abs(bl.verts.x - point.x) < POSITION_EPS &&
		Math.abs(bl.verts.y - point.y) < POSITION_EPS;
	const endMatches =
		Math.abs(bl.verts.z - point.x) < POSITION_EPS &&
		Math.abs(bl.verts.w - point.y) < POSITION_EPS;
	if (!startMatches && !endMatches) return bl;
	return {
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
	model: ParsedAISections,
	idx: number,
): ParsedAISections {
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
