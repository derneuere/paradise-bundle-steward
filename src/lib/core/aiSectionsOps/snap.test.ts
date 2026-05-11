// Unit tests for V12 snap-to-edges (`snapSectionOffset` / `snapCornerOffset`).
//
// Imports come from the directory barrel so we exercise the same public
// surface every downstream caller hits.

import { describe, it, expect } from 'vitest';
import { snapCornerOffset, snapSectionOffset } from '../aiSectionsOps';
import { type ParsedAISectionsV12 } from '../aiSections';
import { makeModel, makeSection } from './_testHelpers';

// =============================================================================
// snap-to-edges (snapSectionOffset / snapCornerOffset)
// =============================================================================

describe('snapSectionOffset', () => {
	function makeTwoApart(): ParsedAISectionsV12 {
		// Section 0: unit-ish quad on the left.
		// Section 1: a triangle whose tip (14, 0) is the rightmost point, so
		// the two edges meeting at that tip both retreat in -X. A probe at
		// (14.3, 0) — to the right of the tip — projects to t<0 (or t>1)
		// on each edge and clamps back to the tip, giving the same dist as
		// the corner itself. Without this geometry, a foreign edge passing
		// through the probe at y=0 would steal the snap with dist 0.
		const s0 = makeSection({
			id: 0xA,
			corners: [
				{ x: 0, y: 0 },
				{ x: 5, y: 0 },
				{ x: 5, y: 5 },
				{ x: 0, y: 5 },
			],
		});
		const s1 = makeSection({
			id: 0xB,
			corners: [
				{ x: 14, y: 0 },
				{ x: 10, y: 10 },
				{ x: 10, y: -10 },
			],
		});
		return makeModel([s0, s1]);
	}

	it('snaps a source corner to a foreign corner within range', () => {
		const model = makeTwoApart();
		// Source corner (5, 0) wants to land at (14.3, 0). Foreign corner
		// (14, 0) is 0.3 away, well within a 1.0 snap radius; both edges
		// clamp to that corner for any probe with x > 14. Offset adjusts
		// from +9.3 to +9.0 on X.
		const out = snapSectionOffset(model, 0, { x: 9.3, z: 0 }, 1.0);
		expect(out).toEqual({ x: 9, z: 0 });
	});

	it('returns the proposed offset unchanged when nothing is in range', () => {
		const model = makeTwoApart();
		// Source far from any neighbour corner.
		const out = snapSectionOffset(model, 0, { x: 100, z: 100 }, 1.0);
		expect(out).toEqual({ x: 100, z: 100 });
	});

	it('picks the closest target when multiple are within range', () => {
		// Two disjoint foreign triangles, each pointed (rightmost-corner-
		// frontier) so their edges both retreat from the probe. The closer
		// tip wins.
		const s0 = makeSection({
			id: 0xA,
			corners: [
				{ x: 0, y: 0 },
				{ x: 5, y: 0 },
				{ x: 5, y: 5 },
				{ x: 0, y: 5 },
			],
		});
		const s1 = makeSection({
			id: 0xB,
			corners: [
				{ x: 10, y: 0 },
				{ x: 5, y: 10 },
				{ x: 5, y: -10 },
			],
		});
		const s2 = makeSection({
			id: 0xC,
			corners: [
				{ x: 10.6, y: 0 },
				{ x: 5.6, y: 10 },
				{ x: 5.6, y: -10 },
			],
		});
		const model = makeModel([s0, s1, s2]);
		// Source corner (5, 0) lands at (10.1, 0). Nearest target on s1 is
		// the tip (10, 0) at dist 0.1; on s2 it's (10.6, 0) at 0.5. Snaps
		// to (10, 0). Required offset: (10 - 5, 0) = (5, 0).
		const out = snapSectionOffset(model, 0, { x: 5.1, z: 0 }, 1.0);
		expect(out).toEqual({ x: 5, z: 0 });
	});

	it('skips cascade-partner corners (foreign corners coincident with a source corner)', () => {
		// Section 0 and section 1 share an edge: source corner (5, 0) is
		// the same world point as section 1 corner (5, 0). After dragging
		// source by +0.3 along X, source corner moves to (5.3, 0); the
		// shared neighbour corner is at (5, 0) before any cascade and would
		// be 0.3 away — but it's a cascade partner, must be excluded.
		const s0 = makeSection({
			id: 0xA,
			corners: [
				{ x: 0, y: 0 },
				{ x: 5, y: 0 },
				{ x: 5, y: 5 },
				{ x: 0, y: 5 },
			],
		});
		const s1 = makeSection({
			id: 0xB,
			corners: [
				{ x: 5, y: 0 },   // shared with s0 corner 1 — excluded
				{ x: 10, y: 0 },  // distinct
				{ x: 10, y: 5 },
				{ x: 5, y: 5 },   // shared with s0 corner 2 — excluded
			],
		});
		const model = makeModel([s0, s1]);
		// Drag offset +0.3 along X. Source corner (5,0) → (5.3, 0). The
		// only non-cascade foreign corner in range is (10, 0) at distance
		// 4.7, well outside the snap radius.
		const out = snapSectionOffset(model, 0, { x: 0.3, z: 0 }, 1.0);
		expect(out).toEqual({ x: 0.3, z: 0 });
	});

	it('respects a tiny snapRadius (essentially disabled)', () => {
		const model = makeTwoApart();
		const out = snapSectionOffset(model, 0, { x: 9.4, z: 0 }, 0);
		expect(out).toEqual({ x: 9.4, z: 0 });
	});

	it('returns the proposed offset on out-of-range srcIdx without throwing', () => {
		const model = makeTwoApart();
		expect(() => snapSectionOffset(model, 99, { x: 1, z: 0 }, 1.0)).not.toThrow();
		const out = snapSectionOffset(model, 99, { x: 1, z: 0 }, 1.0);
		expect(out).toEqual({ x: 1, z: 0 });
	});
});

describe('snapCornerOffset', () => {
	function makeTwoApart(): ParsedAISectionsV12 {
		const s0 = makeSection({
			id: 0xA,
			corners: [
				{ x: 0, y: 0 },
				{ x: 5, y: 0 },
				{ x: 5, y: 5 },
				{ x: 0, y: 5 },
			],
		});
		const s1 = makeSection({
			id: 0xB,
			corners: [
				{ x: 8, y: 0 },
				{ x: 13, y: 0 },
				{ x: 13, y: 5 },
				{ x: 8, y: 5 },
			],
		});
		return makeModel([s0, s1]);
	}

	it("snaps the dragged corner to a foreign corner within range", () => {
		const model = makeTwoApart();
		// Drag corner 1 of s0 (currently at (5,0)) by (+2.7, 0). The new
		// position would be (7.7, 0); closest foreign corner is (8, 0)
		// dist 0.3, within a 1.0 snap radius.
		const out = snapCornerOffset(model, 0, 1, { x: 2.7, z: 0 }, 1.0);
		// Snapped offset puts the corner exactly at (8, 0): offset = (3, 0).
		expect(out).toEqual({ x: 3, z: 0 });
	});

	it('returns the proposed offset when nothing is in range', () => {
		const model = makeTwoApart();
		const out = snapCornerOffset(model, 0, 1, { x: 100, z: 100 }, 1.0);
		expect(out).toEqual({ x: 100, z: 100 });
	});

	it('skips cascade partners (other corners at the OLD position)', () => {
		// Section 0 shares a corner with section 1 at (5, 0). Dragging that
		// corner shouldn't snap to its own cascade partner (the matching
		// corner on section 1 at (5, 0)).
		const s0 = makeSection({
			id: 0xA,
			corners: [
				{ x: 0, y: 0 },
				{ x: 5, y: 0 },
				{ x: 5, y: 5 },
				{ x: 0, y: 5 },
			],
		});
		const s1 = makeSection({
			id: 0xB,
			corners: [
				{ x: 5, y: 0 },  // cascade partner
				{ x: 10, y: 0 }, // distinct, far
				{ x: 10, y: 5 },
				{ x: 5, y: 5 },
			],
		});
		const model = makeModel([s0, s1]);
		// Tiny drag: (5,0) → (5.1, 0). Cascade partner at (5, 0) is 0.1
		// away but excluded; no other corner in range. Offset unchanged.
		const out = snapCornerOffset(model, 0, 1, { x: 0.1, z: 0 }, 0.5);
		expect(out).toEqual({ x: 0.1, z: 0 });
	});

	it("doesn't snap to itself", () => {
		const model = makeTwoApart();
		// Tiny drag: corner 1 of s0 from (5,0) to (5.001, 0). The corner
		// itself is excluded; nearest foreign is far. Offset unchanged.
		const out = snapCornerOffset(model, 0, 1, { x: 0.001, z: 0 }, 0.5);
		expect(out).toEqual({ x: 0.001, z: 0 });
	});

	it('picks the closest target when multiple are within range', () => {
		// Two disjoint foreign sections, neither with an edge crossing the
		// probe; the closer corner wins.
		const s0 = makeSection({
			id: 0xA,
			corners: [
				{ x: 0, y: 0 },
				{ x: 5, y: 0 },
				{ x: 5, y: 5 },
				{ x: 0, y: 5 },
			],
		});
		const s1 = makeSection({
			id: 0xB,
			corners: [
				{ x: 7.5, y: 0 },
				{ x: 7.5, y: 100 },
				{ x: -100, y: 100 },
				{ x: -100, y: 0 },
			],
		});
		const s2 = makeSection({
			id: 0xC,
			corners: [
				{ x: 8.0, y: 0 },
				{ x: 8.0, y: 100 },
				{ x: 200, y: 100 },
				{ x: 200, y: 0 },
			],
		});
		const model = makeModel([s0, s1, s2]);
		// Drag corner 1 from (5,0) by (+2.7, 0) to (7.7, 0). Closest
		// target on s1 is corner (7.5, 0) at dist 0.2; on s2 it's
		// corner (8, 0) at dist 0.3. Snaps to (7.5, 0).
		const out = snapCornerOffset(model, 0, 1, { x: 2.7, z: 0 }, 1.0);
		expect(out).toEqual({ x: 2.5, z: 0 });
	});

	it('snaps onto a foreign edge interior when no corner is closer', () => {
		// Source isolated from neighbour: corners far enough that no corner
		// is in range, but an edge passes close to the dragged corner.
		const s0 = makeSection({
			id: 0xA,
			corners: [
				{ x: 0, y: 0 },
				{ x: 5, y: 0 },
				{ x: 5, y: 5 },
				{ x: 0, y: 5 },
			],
		});
		const s1 = makeSection({
			id: 0xB,
			corners: [
				{ x: 8, y: -10 }, // far in -Z
				{ x: 8, y: 10 },  // far in +Z
				{ x: 13, y: 10 },
				{ x: 13, y: -10 },
			],
		});
		const model = makeModel([s0, s1]);
		// Drag corner 1 of s0 from (5,0) by (+2.7, 0.1) to (7.7, 0.1).
		// Section 1's left edge runs from (8,-10) to (8,10) — a vertical
		// line at X=8. Nearest point is (8, 0.1), distance 0.3.
		// All foreign corners are >10 away, so the edge wins.
		const out = snapCornerOffset(model, 0, 1, { x: 2.7, z: 0.1 }, 1.0);
		// Snap target = (8, 0.1). New offset = (8 - 5, 0.1 - 0) = (3, 0.1).
		expect(out.x).toBeCloseTo(3);
		expect(out.z).toBeCloseTo(0.1);
	});

	it("clamps edge projection to the segment endpoints (doesn't snap past the edge)", () => {
		// Probe lies past the end of the edge; nearestPointOnSegment should
		// clamp to the endpoint, which is itself a corner. We verify the
		// returned offset matches the endpoint.
		const s0 = makeSection({
			id: 0xA,
			corners: [
				{ x: 0, y: 0 },
				{ x: 5, y: 0 },
				{ x: 5, y: 5 },
				{ x: 0, y: 5 },
			],
		});
		const s1 = makeSection({
			id: 0xB,
			corners: [
				{ x: 8, y: 0 },
				{ x: 10, y: 0 },
				{ x: 10, y: 5 },
				{ x: 8, y: 5 },
			],
		});
		const model = makeModel([s0, s1]);
		// Probe at (10.2, 0) — past s1's right edge (X=10). Closest point
		// on the right edge clamps to (10, 0), dist 0.2. Closest corner is
		// (10, 0) itself, dist 0.2. Tie — either wins, both produce the
		// same offset.
		const out = snapCornerOffset(model, 0, 1, { x: 5.2, z: 0 }, 1.0);
		expect(out).toEqual({ x: 5, z: 0 });
	});
});
