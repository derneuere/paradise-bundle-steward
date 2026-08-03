// The AI-sections half of the shared **Bulk transform** — the resource that
// exercises every mechanism in the module at once.
//
// Four storage shapes, three of them lossy relative to a world `Point`:
//
//   * `AISection.corners` — `Vector2` where `.y` IS world Z. AI sections are
//     2D floor-plan polygons; no per-corner height exists anywhere in the file.
//   * `Portal.position` — `Vector3`, the ONLY genuinely 3D datum in the whole
//     resource and the only place a `translate.y` can land.
//   * `BoundaryLine.verts` — a `Vector4` packing TWO XZ points: end 0 is
//     `(x, y)`, end 1 is `(z, w)`. Portal boundary lines and section no-go
//     lines share the shape.
//
// Section Y is not in the file at all: it is derived by `resolveSectionYs`
// (BFS over `linkSection`, seeded from each section's mean portal Y). That is
// why this resolver is a FACTORY — the derived Ys are computed once against
// the pre-gesture model and closed over. Contract W1 (`resolve` is only ever
// called against the pre-gesture model) is what makes that sound.
//
// The `+1.5` / `+0.5` gizmo lifts do NOT live here. They are a visual nudge so
// the gizmo floats clear of the section fill mesh; letting them into `resolve`
// would bake them into the pivot and, one gesture later, into the file.

import type { AISection, BoundaryLine, ParsedAISectionsV12, Portal } from '../../aiSections';
import { resolveSectionYs } from '../../aiSectionY';
import { TRANSFORM_AXES_XZ_PACKED } from '../../transformAxes';
import type { Point, Resolver, SlotWrite } from '../types';

// =============================================================================
// Refs and slots
// =============================================================================

/** Which end of a packed `Vector4` segment: 0 = `(verts.x, verts.y)`,
 *  1 = `(verts.z, verts.w)`. */
export type LineEnd = 0 | 1;

/**
 * THE reference union for AI sections. Three parallel naming families used to
 * describe the same seven things — the bulk ops' `AISectionEntityRef` (kind
 * `portal`, field `end`), the overlay's `DragTarget` (kind `portalAnchor`,
 * field `endIdx`) and the selection marker (field `endIndex`). This is the one
 * that survives; the marker and the schema NodePath adapt at the edges.
 *
 * `boundaryLine` and `noGoLine` are selectable but deliberately NOT
 * transformable — they expand to zero slots, which yields no pivot and
 * therefore no gizmo. That is the honest encoding of "dragging a whole line
 * has no designed write semantics yet"; the user picks an endpoint instead.
 */
export type AISectionRef =
	/** The whole section — every corner, portal anchor, portal boundary-line
	 *  endpoint and no-go endpoint moves together, so a rotate stays rigid. */
	| { kind: 'section'; sectionIdx: number }
	/** One polygon corner (`Vector2`, XZ). */
	| { kind: 'corner'; sectionIdx: number; cornerIdx: number }
	/** One portal's 3D anchor. */
	| { kind: 'portal'; sectionIdx: number; portalIdx: number }
	| { kind: 'boundaryLineEndpoint'; sectionIdx: number; portalIdx: number; lineIdx: number; end: LineEnd }
	| { kind: 'noGoLineEndpoint'; sectionIdx: number; lineIdx: number; end: LineEnd }
	/** Whole-line markers — selectable, not transformable (expand to `[]`). */
	| { kind: 'boundaryLine'; sectionIdx: number; portalIdx: number; lineIdx: number }
	| { kind: 'noGoLine'; sectionIdx: number; lineIdx: number };

/** The leaf spatial data. `section`, `boundaryLine` and `noGoLine` are the
 *  three ref kinds that are not themselves slots. */
export type AISectionSlot = Extract<
	AISectionRef,
	{ kind: 'corner' | 'portal' | 'boundaryLineEndpoint' | 'noGoLineEndpoint' }
>;

export type AISectionsResolverT = Resolver<ParsedAISectionsV12, AISectionRef, AISectionSlot>;

/**
 * Stable identity for a ref OR a slot — slots are a subset of refs, so one
 * encoding serves both. Two refs addressing the same storage MUST agree here:
 * that is what makes a whole-section ref subsume an individually-picked portal
 * inside it instead of moving it twice, and what collapses the duplicate a
 * marquee ∪ inspector pick produces.
 */
export function aiSectionRefKey(ref: AISectionRef): string {
	switch (ref.kind) {
		case 'section':
			return `s:${ref.sectionIdx}`;
		case 'corner':
			return `c:${ref.sectionIdx}:${ref.cornerIdx}`;
		case 'portal':
			return `p:${ref.sectionIdx}:${ref.portalIdx}`;
		case 'boundaryLine':
			return `blw:${ref.sectionIdx}:${ref.portalIdx}:${ref.lineIdx}`;
		case 'boundaryLineEndpoint':
			return `bl:${ref.sectionIdx}:${ref.portalIdx}:${ref.lineIdx}:${ref.end}`;
		case 'noGoLine':
			return `ngw:${ref.sectionIdx}:${ref.lineIdx}`;
		case 'noGoLineEndpoint':
			return `ng:${ref.sectionIdx}:${ref.lineIdx}:${ref.end}`;
	}
}

function expandSection(sec: AISection, sectionIdx: number): AISectionSlot[] {
	const out: AISectionSlot[] = [];
	for (let cornerIdx = 0; cornerIdx < sec.corners.length; cornerIdx++) {
		out.push({ kind: 'corner', sectionIdx, cornerIdx });
	}
	for (let portalIdx = 0; portalIdx < sec.portals.length; portalIdx++) {
		out.push({ kind: 'portal', sectionIdx, portalIdx });
		const bls = sec.portals[portalIdx].boundaryLines;
		for (let lineIdx = 0; lineIdx < bls.length; lineIdx++) {
			out.push({ kind: 'boundaryLineEndpoint', sectionIdx, portalIdx, lineIdx, end: 0 });
			out.push({ kind: 'boundaryLineEndpoint', sectionIdx, portalIdx, lineIdx, end: 1 });
		}
	}
	for (let lineIdx = 0; lineIdx < sec.noGoLines.length; lineIdx++) {
		out.push({ kind: 'noGoLineEndpoint', sectionIdx, lineIdx, end: 0 });
		out.push({ kind: 'noGoLineEndpoint', sectionIdx, lineIdx, end: 1 });
	}
	return out;
}

// =============================================================================
// Batched write
// =============================================================================

// One accumulator per touched section so `model.sections` is rebuilt exactly
// once per gesture rather than once per slot — a 500-section bulk resolves to
// ~5,000 slots and would otherwise rebuild the array 5,000 times per frame.
type SectionBucket = {
	corners: Map<number, Point>;
	portals: Map<number, Point>;
	/** Keyed `${portalIdx}/${lineIdx}/${end}`. */
	boundaryEnds: Map<string, Point>;
	/** Keyed `${lineIdx}/${end}`. */
	noGoEnds: Map<string, Point>;
};

function emptyBucket(): SectionBucket {
	return { corners: new Map(), portals: new Map(), boundaryEnds: new Map(), noGoEnds: new Map() };
}

/**
 * Rewrite a packed-`Vector4` line list. `at(lineIdx, end)` supplies the new
 * world point for one endpoint or `undefined` to leave it alone — so the two
 * endpoints sharing one `verts` never clobber each other, and a line nobody
 * touched comes back by reference.
 */
function writeLines(
	lines: readonly BoundaryLine[],
	at: (lineIdx: number, end: LineEnd) => Point | undefined,
): readonly BoundaryLine[] {
	let changed = false;
	const next = lines.map((bl, lineIdx) => {
		const start = at(lineIdx, 0);
		const finish = at(lineIdx, 1);
		if (!start && !finish) return bl;
		const v = bl.verts;
		// `.y` and `.w` are world Z, not height — the packing is (x, z) pairs.
		const verts = {
			x: start ? start.x : v.x,
			y: start ? start.z : v.y,
			z: finish ? finish.x : v.z,
			w: finish ? finish.z : v.w,
		};
		if (verts.x === v.x && verts.y === v.y && verts.z === v.z && verts.w === v.w) return bl;
		changed = true;
		return { ...bl, verts };
	});
	return changed ? next : lines;
}

function writeCorners(
	corners: readonly { x: number; y: number }[],
	moved: Map<number, Point>,
): readonly { x: number; y: number }[] {
	if (moved.size === 0) return corners;
	let changed = false;
	const next = corners.map((c, i) => {
		const p = moved.get(i);
		// `point.y` is discarded on purpose: a corner has no height storage, so
		// the gizmo's Y arrow is a no-op here (ADR-0011). The axis profile
		// still advertises translate.y because the SAME gesture legitimately
		// moves portal anchors vertically.
		if (!p || (c.x === p.x && c.y === p.z)) return c;
		changed = true;
		return { x: p.x, y: p.z };
	});
	return changed ? next : corners;
}

function writePortals(portals: readonly Portal[], bucket: SectionBucket): readonly Portal[] {
	let changed = false;
	const next = portals.map((p, portalIdx) => {
		const anchor = bucket.portals.get(portalIdx);
		const boundaryLines = writeLines(p.boundaryLines, (lineIdx, end) =>
			bucket.boundaryEnds.get(`${portalIdx}/${lineIdx}/${end}`));
		const cur = p.position;
		const moved = anchor && (anchor.x !== cur.x || anchor.y !== cur.y || anchor.z !== cur.z);
		if (!moved && boundaryLines === p.boundaryLines) return p;
		changed = true;
		return {
			...p,
			position: moved ? { x: anchor.x, y: anchor.y, z: anchor.z } : cur,
			boundaryLines: boundaryLines as BoundaryLine[],
		};
	});
	return changed ? next : portals;
}

function applyWrites(
	model: ParsedAISectionsV12,
	writes: readonly SlotWrite<AISectionSlot>[],
): ParsedAISectionsV12 {
	if (writes.length === 0) return model;

	const buckets = new Map<number, SectionBucket>();
	for (const w of writes) {
		let bucket = buckets.get(w.slot.sectionIdx);
		if (!bucket) {
			bucket = emptyBucket();
			buckets.set(w.slot.sectionIdx, bucket);
		}
		switch (w.slot.kind) {
			case 'corner':
				bucket.corners.set(w.slot.cornerIdx, w.point);
				break;
			case 'portal':
				bucket.portals.set(w.slot.portalIdx, w.point);
				break;
			case 'boundaryLineEndpoint':
				bucket.boundaryEnds.set(`${w.slot.portalIdx}/${w.slot.lineIdx}/${w.slot.end}`, w.point);
				break;
			case 'noGoLineEndpoint':
				bucket.noGoEnds.set(`${w.slot.lineIdx}/${w.slot.end}`, w.point);
				break;
		}
	}

	let changed = false;
	const sections = model.sections.map((sec, idx) => {
		const bucket = buckets.get(idx);
		if (!bucket) return sec;
		const corners = writeCorners(sec.corners, bucket.corners);
		const portals = writePortals(sec.portals, bucket);
		const noGoLines = writeLines(sec.noGoLines, (lineIdx, end) =>
			bucket.noGoEnds.get(`${lineIdx}/${end}`));
		// Structural sharing is the BND2 writeback contract, not a perf tweak:
		// an untouched section must re-encode to the exact bytes it parsed
		// from, and the overlay paints cascade-affected neighbours orange by
		// `!==` against the pre-gesture model.
		if (corners === sec.corners && portals === sec.portals && noGoLines === sec.noGoLines) return sec;
		changed = true;
		return {
			...sec,
			corners: corners as AISection['corners'],
			portals: portals as Portal[],
			noGoLines: noGoLines as BoundaryLine[],
		};
	});

	if (!changed) return model;
	return { ...model, sections };
}

// =============================================================================
// The resolver factory
// =============================================================================

/**
 * Build a resolver bound to `gestureStartModel`.
 *
 * A factory rather than a singleton because corner / line-endpoint Y is
 * derived (`resolveSectionYs`) rather than stored: it has to be computed once
 * per gesture, against the pre-gesture geometry, or a rotate would re-derive
 * heights from its own half-applied output.
 *
 * `sectionYs` may be passed in when the caller already memoised it (the
 * overlay does, for the batched section mesh).
 */
export function createAISectionsResolver(
	gestureStartModel: ParsedAISectionsV12,
	sectionYs: ArrayLike<number> = resolveSectionYs(gestureStartModel),
): AISectionsResolverT {
	const sectionY = (idx: number): number =>
		idx >= 0 && idx < sectionYs.length ? sectionYs[idx] : 0;

	return {
		id: 'aiSections',

		expand(model, ref) {
			const sec = model.sections[ref.sectionIdx];
			if (!sec) return [];
			// Whole-line markers are selectable but have no write semantics —
			// an empty expansion is how the module says "no gizmo for this".
			if (ref.kind === 'boundaryLine' || ref.kind === 'noGoLine') return [];
			if (ref.kind === 'section') return expandSection(sec, ref.sectionIdx);
			// Every other kind IS its own leaf datum. Out-of-range sub-indices
			// are not filtered here — `resolve` returns null and `resolveSlots`
			// drops them, keeping ONE silent-skip path rather than two.
			return [ref];
		},

		key: aiSectionRefKey,

		resolve(model, slot) {
			const sec = model.sections[slot.sectionIdx];
			if (!sec) return null;
			switch (slot.kind) {
				case 'corner': {
					const c = sec.corners[slot.cornerIdx];
					if (!c) return null;
					// `.y` is world Z; the height is the derived section Y.
					return { x: c.x, y: sectionY(slot.sectionIdx), z: c.y };
				}
				case 'portal': {
					const p = sec.portals[slot.portalIdx];
					if (!p) return null;
					return { x: p.position.x, y: p.position.y, z: p.position.z };
				}
				case 'boundaryLineEndpoint': {
					const line = sec.portals[slot.portalIdx]?.boundaryLines[slot.lineIdx];
					if (!line) return null;
					// Y is the section's derived ground, NOT the parent portal's
					// anchor height. The two disagreed before the merge (the ops
					// used sectionY, the gizmo geometry used the portal Y); this
					// is the reconciliation, and it keeps a whole-section rotate
					// rigid — every XZ-packed slot in the section shares one Y.
					return endpointPoint(line, slot.end, sectionY(slot.sectionIdx));
				}
				case 'noGoLineEndpoint': {
					const line = sec.noGoLines[slot.lineIdx];
					if (!line) return null;
					return endpointPoint(line, slot.end, sectionY(slot.sectionIdx));
				}
			}
		},

		write: applyWrites,

		/**
		 * Yaw-only rotate, full 3-axis translate (ADR-0011). Corners, boundary
		 * lines and no-go lines are XZ-packed, so pitch and roll have nowhere
		 * to land; `translate.y` stays enabled because the same gesture moves
		 * portal anchor heights, and the XZ-packed slots drop it in `write`.
		 *
		 * Deliberately NOT cardinality-dependent. A lone corner or endpoint
		 * used to have all three rotate rings disabled on the grounds that "a
		 * point rotating about itself is a no-op"; with a drag-repositionable
		 * pivot that is false — the point orbits wherever the user put it.
		 */
		axes(refs) {
			return refs.length === 0 ? null : TRANSFORM_AXES_XZ_PACKED;
		},
	};
}

function endpointPoint(line: BoundaryLine, end: LineEnd, y: number): Point {
	const v = line.verts;
	return end === 0 ? { x: v.x, y, z: v.y } : { x: v.z, y, z: v.w };
}
