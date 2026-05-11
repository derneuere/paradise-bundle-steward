// Unit tests for the cascade-on V12 ops:
//
//   - translateSectionWithLinks (smart move with paired-portal cascade)
//   - translateCornerWithShared (corner-drag with shared-point cascade)
//   - rotateSectionWithLinksYaw (yaw-axis sibling of the translate cascade)
//   - translatePortalAnchorWithMirror (single portal + its mirror twin)
//
// Imports come from the directory barrel so we exercise the same public
// surface every downstream caller hits.

import { describe, it, expect } from 'vitest';
import {
	rotateSectionWithLinksYaw,
	translateCornerWithShared,
	translatePortalAnchorWithMirror,
	translateSectionWithLinks,
} from '../aiSectionsOps';
import {
	type AISection,
	type ParsedAISectionsV12,
	type Portal,
} from '../aiSections';
import { makeModel, makeSection } from './_testHelpers';

// =============================================================================
// translateSectionWithLinks (smart move with paired-portal cascade)
// =============================================================================

describe('translateSectionWithLinks', () => {
	// Build a pair of sections that share an edge between corner A and B,
	// with mirrored portals exactly as the duplicate-through-edge op produces:
	//
	//   Section 0: a unit-ish quad whose right edge is (10, 0) → (10, 10).
	//   Section 1: a quad to the right of section 0, sharing that edge.
	//   Both portals at world position (10, 0, 5) — the edge midpoint.
	function makePair(): ParsedAISectionsV12 {
		const portal0to1: Portal = {
			position: { x: 10, y: 0, z: 5 },
			boundaryLines: [{ verts: { x: 10, y: 0, z: 10, w: 10 } }],
			linkSection: 1,
		};
		const portal1to0: Portal = {
			position: { x: 10, y: 0, z: 5 },
			boundaryLines: [{ verts: { x: 10, y: 10, z: 10, w: 0 } }],
			linkSection: 0,
		};
		const s0: AISection = makeSection({
			id: 0xA,
			corners: [
				{ x: 0, y: 0 },
				{ x: 10, y: 0 },
				{ x: 10, y: 10 },
				{ x: 0, y: 10 },
			],
			portals: [portal0to1],
		});
		const s1: AISection = makeSection({
			id: 0xB,
			corners: [
				{ x: 10, y: 0 },
				{ x: 20, y: 0 },
				{ x: 20, y: 10 },
				{ x: 10, y: 10 },
			],
			portals: [portal1to0],
		});
		return makeModel([s0, s1]);
	}

	it('shifts every spatial field on the source section', () => {
		const model = makePair();
		const next = translateSectionWithLinks(model, 0, { x: 3, z: -2 });
		const s0 = next.sections[0];
		expect(s0.corners).toEqual([
			{ x: 3, y: -2 },
			{ x: 13, y: -2 },
			{ x: 13, y: 8 },
			{ x: 3, y: 8 },
		]);
		expect(s0.portals[0].position).toEqual({ x: 13, y: 0, z: 3 });
		expect(s0.portals[0].boundaryLines[0].verts).toEqual({ x: 13, y: -2, z: 13, w: 8 });
	});

	it("translates the neighbour's matching portal and its boundary line", () => {
		const model = makePair();
		const next = translateSectionWithLinks(model, 0, { x: 3, z: -2 });
		const s1 = next.sections[1];
		// Match was the only portal on s1; its position should follow s0's.
		expect(s1.portals[0].position).toEqual({ x: 13, y: 0, z: 3 });
		// Boundary line winding stays reversed — only the endpoint coords shift.
		expect(s1.portals[0].boundaryLines[0].verts).toEqual({ x: 13, y: 8, z: 13, w: -2 });
	});

	it('keeps the source/neighbour portal positions equal after the move (paired)', () => {
		const model = makePair();
		const next = translateSectionWithLinks(model, 0, { x: 7, z: 4 });
		expect(next.sections[0].portals[0].position).toEqual(next.sections[1].portals[0].position);
	});

	it('shifts only the neighbour corners that lie on the shared edge', () => {
		const model = makePair();
		const next = translateSectionWithLinks(model, 0, { x: 3, z: -2 });
		// Shared edge endpoints (pre-translate): (10, 0) and (10, 10).
		// Section 1 has those at indexes 0 and 3; the other two corners are
		// (20, 0) and (20, 10) on its far edge — those should stay put.
		expect(next.sections[1].corners).toEqual([
			{ x: 13, y: -2 }, // was (10, 0) — moves
			{ x: 20, y: 0 },  // unchanged
			{ x: 20, y: 10 }, // unchanged
			{ x: 13, y: 8 },  // was (10, 10) — moves
		]);
	});

	it('skips a portal pointing at a self-link (linkSection === srcIdx)', () => {
		const selfLinking: AISection = makeSection({
			portals: [{
				position: { x: 0, y: 0, z: 0 },
				boundaryLines: [{ verts: { x: 0, y: 0, z: 1, w: 0 } }],
				linkSection: 0, // points at itself
			}],
		});
		const model = makeModel([selfLinking]);
		const next = translateSectionWithLinks(model, 0, { x: 5, z: 0 });
		// Source still translates; no other section to cascade into.
		expect(next.sections[0].corners[0]).toEqual({ x: 5, y: 0 });
	});

	it('skips a portal pointing at an out-of-range index (orphan)', () => {
		const orphan: AISection = makeSection({
			portals: [{
				position: { x: 0, y: 0, z: 0 },
				boundaryLines: [],
				linkSection: 999, // does not exist
			}],
		});
		const model = makeModel([orphan]);
		expect(() => translateSectionWithLinks(model, 0, { x: 5, z: 0 })).not.toThrow();
	});

	it("doesn't touch a neighbour's other portals (independent edges stay put)", () => {
		// Section 0 has one portal to section 1.
		// Section 1 has two portals: one back to section 0 (will move) and
		// one to section 2 on its far edge (must NOT move).
		const portal0to1: Portal = {
			position: { x: 10, y: 0, z: 5 },
			boundaryLines: [{ verts: { x: 10, y: 0, z: 10, w: 10 } }],
			linkSection: 1,
		};
		const portal1to0: Portal = {
			position: { x: 10, y: 0, z: 5 },
			boundaryLines: [{ verts: { x: 10, y: 10, z: 10, w: 0 } }],
			linkSection: 0,
		};
		const portal1to2: Portal = {
			// Far edge midpoint — no relation to the s0/s1 shared edge.
			position: { x: 20, y: 0, z: 5 },
			boundaryLines: [{ verts: { x: 20, y: 0, z: 20, w: 10 } }],
			linkSection: 2,
		};
		const s0 = makeSection({ id: 0xA, portals: [portal0to1] });
		const s1 = makeSection({
			id: 0xB,
			corners: [
				{ x: 10, y: 0 },
				{ x: 20, y: 0 },
				{ x: 20, y: 10 },
				{ x: 10, y: 10 },
			],
			portals: [portal1to0, portal1to2],
		});
		const s2 = makeSection({ id: 0xC });
		const model = makeModel([s0, s1, s2]);

		const next = translateSectionWithLinks(model, 0, { x: 3, z: 0 });
		// The s1→s2 portal is on the far edge — its position and BL are
		// unchanged.
		expect(next.sections[1].portals[1]).toBe(s1.portals[1]);
	});

	it("stretches but doesn't break section 1 — its non-shared corners stay still", () => {
		// Same as the previous test but with two distinct neighbours, both
		// of which should stretch by exactly two corners apiece.
		const model = makePair();
		const next = translateSectionWithLinks(model, 0, { x: 5, z: 0 });
		const s1 = next.sections[1];
		// Section 1 was [(10,0),(20,0),(20,10),(10,10)] — the (10,*) corners
		// were on the shared edge so they shift; the (20,*) corners stay.
		expect(s1.corners[1]).toEqual({ x: 20, y: 0 });
		expect(s1.corners[2]).toEqual({ x: 20, y: 10 });
		// And the moved corners landed where source's right edge now is.
		expect(s1.corners[0]).toEqual({ x: 15, y: 0 });
		expect(s1.corners[3]).toEqual({ x: 15, y: 10 });
	});

	it('is a no-op for a zero offset', () => {
		const model = makePair();
		const next = translateSectionWithLinks(model, 0, { x: 0, z: 0 });
		expect(next).toBe(model);
	});

	it('throws on out-of-range srcIdx', () => {
		const model = makePair();
		expect(() => translateSectionWithLinks(model, 5, { x: 1, z: 0 })).toThrow(RangeError);
		expect(() => translateSectionWithLinks(model, -1, { x: 1, z: 0 })).toThrow(RangeError);
	});

	it("doesn't change unrelated sections by reference", () => {
		const model = makePair();
		// Add an extra section that has no link to section 0.
		const detached: AISection = makeSection({ id: 0xDD });
		const expanded: ParsedAISectionsV12 = {
			...model,
			sections: [...model.sections, detached],
		};
		const next = translateSectionWithLinks(expanded, 0, { x: 4, z: 4 });
		expect(next.sections[2]).toBe(detached);
	});
});

// =============================================================================
// translateCornerWithShared (corner-drag with shared-point cascade)
// =============================================================================

describe('translateCornerWithShared', () => {
	// Reuse the makePair-style fixture from translateSectionWithLinks: two
	// quads sharing the right edge of section 0 / left edge of section 1.
	function makePair(): ParsedAISectionsV12 {
		const portal0to1: Portal = {
			position: { x: 10, y: 0, z: 5 },
			boundaryLines: [{ verts: { x: 10, y: 0, z: 10, w: 10 } }],
			linkSection: 1,
		};
		const portal1to0: Portal = {
			position: { x: 10, y: 0, z: 5 },
			boundaryLines: [{ verts: { x: 10, y: 10, z: 10, w: 0 } }],
			linkSection: 0,
		};
		const s0 = makeSection({
			id: 0xA,
			corners: [
				{ x: 0, y: 0 },
				{ x: 10, y: 0 },
				{ x: 10, y: 10 },
				{ x: 0, y: 10 },
			],
			portals: [portal0to1],
		});
		const s1 = makeSection({
			id: 0xB,
			corners: [
				{ x: 10, y: 0 },
				{ x: 20, y: 0 },
				{ x: 20, y: 10 },
				{ x: 10, y: 10 },
			],
			portals: [portal1to0],
		});
		return makeModel([s0, s1]);
	}

	it('moves the targeted corner', () => {
		const model = makePair();
		const next = translateCornerWithShared(model, 0, 1, { x: 3, z: -1 });
		// Section 0 corner 1 was (10, 0) → now (13, -1)
		expect(next.sections[0].corners[1]).toEqual({ x: 13, y: -1 });
		// Other corners unchanged
		expect(next.sections[0].corners[0]).toEqual({ x: 0, y: 0 });
		expect(next.sections[0].corners[3]).toEqual({ x: 0, y: 10 });
	});

	it('drags the same-point corner on a neighbour (shared corner)', () => {
		const model = makePair();
		const next = translateCornerWithShared(model, 0, 1, { x: 3, z: -1 });
		// Section 1 had corner 0 at (10, 0) — same world point. It must move too.
		expect(next.sections[1].corners[0]).toEqual({ x: 13, y: -1 });
		// Section 1's other corners on its far edge stay still.
		expect(next.sections[1].corners[1]).toEqual({ x: 20, y: 0 });
		expect(next.sections[1].corners[2]).toEqual({ x: 20, y: 10 });
	});

	it('shifts boundary-line endpoints anywhere in the model that match the old corner', () => {
		const model = makePair();
		const next = translateCornerWithShared(model, 0, 1, { x: 3, z: -1 });
		// Source's portal had BL (10,0) → (10,10); start (10,0) was the corner
		// being dragged, so it shifts. End (10,10) is corner 2, untouched.
		expect(next.sections[0].portals[0].boundaryLines[0].verts).toEqual({
			x: 13, y: -1, z: 10, w: 10,
		});
		// Neighbour's portal had reversed BL (10,10) → (10,0); the END (10,0)
		// matched, so it shifts. The start (10,10) untouched.
		expect(next.sections[1].portals[0].boundaryLines[0].verts).toEqual({
			x: 10, y: 10, z: 13, w: -1,
		});
	});

	it('leaves the portal Position alone (midpoint relationship not enforced)', () => {
		const model = makePair();
		const next = translateCornerWithShared(model, 0, 1, { x: 3, z: -1 });
		// Position was (10, 0, 5) on both portals — must be unchanged.
		expect(next.sections[0].portals[0].position).toEqual({ x: 10, y: 0, z: 5 });
		expect(next.sections[1].portals[0].position).toEqual({ x: 10, y: 0, z: 5 });
	});

	it('shifts a noGoLine endpoint that matches the old corner', () => {
		const base = makePair();
		const withNoGo: ParsedAISectionsV12 = {
			...base,
			sections: base.sections.map((s, i) =>
				i === 0
					? { ...s, noGoLines: [{ verts: { x: 5, y: 5, z: 10, w: 0 } }] }
					: s,
			),
		};
		const next = translateCornerWithShared(withNoGo, 0, 1, { x: 3, z: -1 });
		// noGo endpoint (10, 0) matched corner 1 → shift end to (13, -1).
		expect(next.sections[0].noGoLines[0].verts).toEqual({ x: 5, y: 5, z: 13, w: -1 });
	});

	it('preserves object identity for sections and portals that share no point with the dragged corner', () => {
		// Add a third, unrelated section in a different region.
		const base = makePair();
		const farAway = makeSection({
			id: 0xCC,
			corners: [
				{ x: 100, y: 100 },
				{ x: 110, y: 100 },
				{ x: 110, y: 110 },
				{ x: 100, y: 110 },
			],
		});
		const expanded: ParsedAISectionsV12 = {
			...base,
			sections: [...base.sections, farAway],
		};
		const next = translateCornerWithShared(expanded, 0, 1, { x: 3, z: -1 });
		// The unrelated section is untouched by reference.
		expect(next.sections[2]).toBe(farAway);
	});

	it('is a no-op for a zero offset', () => {
		const model = makePair();
		const next = translateCornerWithShared(model, 0, 1, { x: 0, z: 0 });
		expect(next).toBe(model);
	});

	it('throws on out-of-range srcIdx', () => {
		const model = makePair();
		expect(() => translateCornerWithShared(model, -1, 0, { x: 1, z: 0 })).toThrow(RangeError);
		expect(() => translateCornerWithShared(model, 7, 0, { x: 1, z: 0 })).toThrow(RangeError);
	});

	it('throws on out-of-range cornerIdx', () => {
		const model = makePair();
		expect(() => translateCornerWithShared(model, 0, -1, { x: 1, z: 0 })).toThrow(RangeError);
		expect(() => translateCornerWithShared(model, 0, 4, { x: 1, z: 0 })).toThrow(RangeError);
	});

	it("does not collapse an interior corner that didn't match the old point", () => {
		// If the user drags corner 0 of section 0 (the (0, 0) world point),
		// section 1's corner 0 (which is (10, 0), DIFFERENT world point) must
		// not move.
		const model = makePair();
		const next = translateCornerWithShared(model, 0, 0, { x: -5, z: 0 });
		expect(next.sections[0].corners[0]).toEqual({ x: -5, y: 0 });
		// Section 1's corners are completely untouched (no shared point).
		expect(next.sections[1].corners).toEqual(model.sections[1].corners);
	});

	it('drags multiple coincident points in one section (e.g., a degenerate quad)', () => {
		// Quad with two overlapping corners. Dragging one of them should drag
		// both — useful guarantee for edge cases like collapsed polygons.
		const degenerate = makeSection({
			id: 0xDD,
			corners: [
				{ x: 5, y: 5 },
				{ x: 5, y: 5 }, // duplicate
				{ x: 10, y: 5 },
				{ x: 10, y: 0 },
			],
		});
		const model = makeModel([degenerate]);
		const next = translateCornerWithShared(model, 0, 0, { x: 1, z: 0 });
		// Both (5,5) corners should move together.
		expect(next.sections[0].corners[0]).toEqual({ x: 6, y: 5 });
		expect(next.sections[0].corners[1]).toEqual({ x: 6, y: 5 });
		// Other corners stay.
		expect(next.sections[0].corners[2]).toEqual({ x: 10, y: 5 });
		expect(next.sections[0].corners[3]).toEqual({ x: 10, y: 0 });
	});
});

// =============================================================================
// rotateSectionWithLinksYaw (cascade-on yaw rotate)
// =============================================================================

describe('rotateSectionWithLinksYaw', () => {
	// Same makePair shape as translateSectionWithLinks: two adjacent quads
	// sharing the right edge of section 0 / left edge of section 1, with
	// mirrored portals at the edge midpoint.
	function makePair(): ParsedAISectionsV12 {
		const portal0to1: Portal = {
			position: { x: 10, y: 0, z: 5 },
			boundaryLines: [{ verts: { x: 10, y: 0, z: 10, w: 10 } }],
			linkSection: 1,
		};
		const portal1to0: Portal = {
			position: { x: 10, y: 0, z: 5 },
			boundaryLines: [{ verts: { x: 10, y: 10, z: 10, w: 0 } }],
			linkSection: 0,
		};
		const s0 = makeSection({
			id: 0xA,
			corners: [
				{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 },
			],
			portals: [portal0to1],
		});
		const s1 = makeSection({
			id: 0xB,
			corners: [
				{ x: 10, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }, { x: 10, y: 10 },
			],
			portals: [portal1to0],
		});
		return makeModel([s0, s1]);
	}

	it('rotates the source section around its centroid like the rigid op', () => {
		const model = makePair();
		// Source centroid is (5, 5); π/2 rotates (0, 0) → centroid offset
		// (-5, -5) → (5, -5) → (10, 0).
		const next = rotateSectionWithLinksYaw(model, 0, Math.PI / 2);
		expect(next.sections[0].corners[0].x).toBeCloseTo(10, 6);
		expect(next.sections[0].corners[0].y).toBeCloseTo(0, 6);
	});

	it("rotates the neighbour's reverse portal around the source centroid", () => {
		const model = makePair();
		// Pre-rotate portal anchor is at (10, 5). Source centroid is (5, 5).
		// π/2 rotation: offset (5, 0) → (0, 5) → world (5, 10).
		const next = rotateSectionWithLinksYaw(model, 0, Math.PI / 2);
		expect(next.sections[1].portals[0].position.x).toBeCloseTo(5, 6);
		expect(next.sections[1].portals[0].position.y).toBe(0); // y unchanged
		expect(next.sections[1].portals[0].position.z).toBeCloseTo(10, 6);
	});

	it('keeps source and neighbour portal positions equal after the rotate (lockstep)', () => {
		const model = makePair();
		const next = rotateSectionWithLinksYaw(model, 0, 0.7);
		const sp = next.sections[0].portals[0].position;
		const np = next.sections[1].portals[0].position;
		expect(sp.x).toBeCloseTo(np.x, 6);
		expect(sp.y).toBeCloseTo(np.y, 6);
		expect(sp.z).toBeCloseTo(np.z, 6);
	});

	it('orbits the shared corners on the neighbour around the source centroid', () => {
		const model = makePair();
		// Shared corners are (10, 0) and (10, 10) — they were on the source's
		// right edge and ARE the neighbour's left edge. After π/2 around
		// (5, 5): (10, 0) → (5, -5)+(5,5) → (10, 0)? wait. Let's compute:
		// offset (5, -5) → π/2 → (5, 5) → world (10, 10). And (10, 10) →
		// offset (5, 5) → π/2 → (-5, 5) → world (0, 10).
		const next = rotateSectionWithLinksYaw(model, 0, Math.PI / 2);
		const s1 = next.sections[1];
		// Pre-rotate s1 corners were [(10,0),(20,0),(20,10),(10,10)]. The
		// shared corners at indexes 0 and 3 spin; the non-shared ones at
		// indexes 1 and 2 stay put.
		expect(s1.corners[0].x).toBeCloseTo(10, 6);
		expect(s1.corners[0].y).toBeCloseTo(10, 6);
		expect(s1.corners[3].x).toBeCloseTo(0, 6);
		expect(s1.corners[3].y).toBeCloseTo(10, 6);
		// Non-shared corners unchanged.
		expect(s1.corners[1]).toEqual({ x: 20, y: 0 });
		expect(s1.corners[2]).toEqual({ x: 20, y: 10 });
	});

	it('is a no-op for theta === 0', () => {
		const model = makePair();
		expect(rotateSectionWithLinksYaw(model, 0, 0)).toBe(model);
	});

	it('throws on out-of-range srcIdx', () => {
		const model = makePair();
		expect(() => rotateSectionWithLinksYaw(model, 5, 0.1)).toThrow(RangeError);
		expect(() => rotateSectionWithLinksYaw(model, -1, 0.1)).toThrow(RangeError);
	});

	it('a full revolution (2π) returns a near-identity result', () => {
		const model = makePair();
		const next = rotateSectionWithLinksYaw(model, 0, 2 * Math.PI);
		// Floats won't be exactly equal but should be machine-close.
		expect(next.sections[0].corners[0].x).toBeCloseTo(0, 5);
		expect(next.sections[0].corners[0].y).toBeCloseTo(0, 5);
		expect(next.sections[1].portals[0].position.x).toBeCloseTo(10, 5);
		expect(next.sections[1].portals[0].position.z).toBeCloseTo(5, 5);
	});
});

// =============================================================================
// translatePortalAnchorWithMirror (single portal + its mirror twin)
// =============================================================================

describe('translatePortalAnchorWithMirror', () => {
	function makePair(): ParsedAISectionsV12 {
		const portal0to1: Portal = {
			position: { x: 10, y: 3, z: 5 },
			boundaryLines: [{ verts: { x: 10, y: 0, z: 10, w: 10 } }],
			linkSection: 1,
		};
		const portal1to0: Portal = {
			position: { x: 10, y: 3, z: 5 },
			boundaryLines: [{ verts: { x: 10, y: 10, z: 10, w: 0 } }],
			linkSection: 0,
		};
		const s0 = makeSection({ id: 0xA, portals: [portal0to1] });
		const s1 = makeSection({
			id: 0xB,
			corners: [
				{ x: 10, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }, { x: 10, y: 10 },
			],
			portals: [portal1to0],
		});
		return makeModel([s0, s1]);
	}

	it('translates the source portal and the mirror portal by the same delta', () => {
		const model = makePair();
		const next = translatePortalAnchorWithMirror(model, 0, 0, { x: 4, y: 0.5, z: -2 });
		expect(next.sections[0].portals[0].position).toEqual({ x: 14, y: 3.5, z: 3 });
		expect(next.sections[1].portals[0].position).toEqual({ x: 14, y: 3.5, z: 3 });
	});

	it('does NOT touch corners on either section', () => {
		const model = makePair();
		const next = translatePortalAnchorWithMirror(model, 0, 0, { x: 4, y: 0, z: -2 });
		expect(next.sections[0].corners).toEqual(model.sections[0].corners);
		expect(next.sections[1].corners).toEqual(model.sections[1].corners);
	});

	it('does NOT touch portal boundary lines on either section', () => {
		const model = makePair();
		const next = translatePortalAnchorWithMirror(model, 0, 0, { x: 4, y: 0, z: -2 });
		expect(next.sections[0].portals[0].boundaryLines).toEqual(
			model.sections[0].portals[0].boundaryLines,
		);
		expect(next.sections[1].portals[0].boundaryLines).toEqual(
			model.sections[1].portals[0].boundaryLines,
		);
	});

	it('is a no-op for a zero offset', () => {
		const model = makePair();
		expect(translatePortalAnchorWithMirror(model, 0, 0, { x: 0, y: 0, z: 0 })).toBe(model);
	});

	it('throws on out-of-range sectionIdx or portalIdx', () => {
		const model = makePair();
		expect(() => translatePortalAnchorWithMirror(model, 5, 0, { x: 1, y: 0, z: 0 })).toThrow(RangeError);
		expect(() => translatePortalAnchorWithMirror(model, 0, 5, { x: 1, y: 0, z: 0 })).toThrow(RangeError);
	});

	it('still moves the source portal even when the mirror is missing (orphan link)', () => {
		const orphan: AISection = makeSection({
			id: 0xC,
			portals: [{
				position: { x: 1, y: 0, z: 2 },
				boundaryLines: [],
				linkSection: 999, // out of range
			}],
		});
		const model = makeModel([orphan]);
		const next = translatePortalAnchorWithMirror(model, 0, 0, { x: 5, y: 0, z: 0 });
		expect(next.sections[0].portals[0].position).toEqual({ x: 6, y: 0, z: 2 });
	});
});
