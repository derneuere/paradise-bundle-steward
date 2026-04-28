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
