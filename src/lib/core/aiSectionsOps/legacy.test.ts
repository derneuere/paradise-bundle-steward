// Unit tests for the V4 / V6 legacy ops:
//
//   - duplicateLegacySectionThroughEdge
//   - translateLegacyCornerWithShared (smart corner-drag)
//   - translateLegacySectionWithLinks (smart section-translate)
//   - snapLegacyCornerOffset / snapLegacySectionOffset
//
// Imports come from the directory barrel so we exercise the same public
// surface every downstream caller hits.

import { describe, it, expect } from 'vitest';
import {
	duplicateLegacySectionThroughEdge,
	snapLegacyCornerOffset,
	snapLegacySectionOffset,
	translateLegacyCornerWithShared,
	translateLegacySectionWithLinks,
} from '../aiSectionsOps';
import {
	LegacyDangerRating,
	LegacyEDistrict,
	type LegacyAISection,
	type LegacyAISectionsData,
	type LegacyPortal,
} from '../aiSections';
import {
	makeLegacyModel,
	makeLegacyV4Section,
	makeLegacyV6Section,
} from './_testHelpers';

// =============================================================================
// duplicateLegacySectionThroughEdge (V4 / V6 prototype layouts)
// =============================================================================

describe('duplicateLegacySectionThroughEdge', () => {
	describe('V4 path', () => {
		it('appends the duplicate at the end of sections', () => {
			const model = makeLegacyModel(4, [makeLegacyV4Section(), makeLegacyV4Section()]);
			const next = duplicateLegacySectionThroughEdge(model, 0, 0);
			expect(next.sections).toHaveLength(3);
			expect(next).not.toBe(model);
			expect(next.sections[0]).not.toBe(model.sections[0]); // source mutated structurally
		});

		it('places the duplicate adjacent on the chosen edge (rectangle: opposite edge lands on chosen edge)', () => {
			// Same square as V12 — edge 0 (bottom) → translate −Z by 10 units.
			const model = makeLegacyModel(4, [makeLegacyV4Section()]);
			const next = duplicateLegacySectionThroughEdge(model, 0, 0);
			const dup = next.sections[1];
			expect(dup.cornersX).toEqual([0, 10, 10, 0]);
			expect(dup.cornersZ).toEqual([-10, -10, 0, 0]);
		});

		it('cross-links the new portal pair via linkSection', () => {
			const model = makeLegacyModel(4, [makeLegacyV4Section()]);
			const next = duplicateLegacySectionThroughEdge(model, 0, 0);
			const srcPortal = next.sections[0].portals.at(-1)!;
			const dupPortal = next.sections[1].portals[0];
			expect(srcPortal.linkSection).toBe(1);
			expect(dupPortal.linkSection).toBe(0);
		});

		it('shares midPosition between the portal pair (same world-space anchor)', () => {
			const model = makeLegacyModel(4, [makeLegacyV4Section()]);
			const next = duplicateLegacySectionThroughEdge(model, 0, 0);
			const srcPortal = next.sections[0].portals.at(-1)!;
			const dupPortal = next.sections[1].portals[0];
			expect(srcPortal.midPosition).toEqual(dupPortal.midPosition);
			// Edge 0 midpoint in world space: (5, 0). Y from no-portals fallback = 0.
			// W is structural padding — fresh portals zero it.
			expect(srcPortal.midPosition).toEqual({ x: 5, y: 0, z: 0, w: 0 });
		});

		it('reverses the boundary-line winding on the duplicate side', () => {
			const model = makeLegacyModel(4, [makeLegacyV4Section()]);
			const next = duplicateLegacySectionThroughEdge(model, 0, 0);
			const srcBL = next.sections[0].portals.at(-1)!.boundaryLines[0].verts;
			const dupBL = next.sections[1].portals[0].boundaryLines[0].verts;
			expect(srcBL).toEqual({ x: 0, y: 0, z: 10, w: 0 });
			expect(dupBL).toEqual({ x: 10, y: 0, z: 0, w: 0 });
		});

		it('copies anchor height from the source\'s first existing portal midPosition.y', () => {
			const seedPortal: LegacyPortal = {
				midPosition: { x: 0, y: 42.5, z: 0, w: 0 },
				boundaryLines: [],
				linkSection: 0,
			};
			const model = makeLegacyModel(4, [makeLegacyV4Section({ portals: [seedPortal] })]);
			const next = duplicateLegacySectionThroughEdge(model, 0, 0);
			expect(next.sections[0].portals.at(-1)!.midPosition.y).toBe(42.5);
			expect(next.sections[1].portals[0].midPosition.y).toBe(42.5);
		});

		it('inherits dangerRating + flags from the source', () => {
			const model = makeLegacyModel(4, [makeLegacyV4Section({
				dangerRating: LegacyDangerRating.E_DANGER_RATING_DANGEROUS,
				flags: 0x01,
			})]);
			const next = duplicateLegacySectionThroughEdge(model, 0, 0);
			const dup = next.sections[1];
			expect(dup.dangerRating).toBe(LegacyDangerRating.E_DANGER_RATING_DANGEROUS);
			expect(dup.flags).toBe(0x01);
		});

		it('does not synthesise V6-only spanIndex / district on a V4 source', () => {
			// Issue #44 documented choice: V4 sections carry no spanIndex /
			// district. The duplicate must not leak undefined-into-defined
			// either, since the V4 RecordSchema has no fields for them.
			const model = makeLegacyModel(4, [makeLegacyV4Section()]);
			const next = duplicateLegacySectionThroughEdge(model, 0, 0);
			const dup = next.sections[1];
			expect('spanIndex' in dup).toBe(false);
			expect('district' in dup).toBe(false);
		});

		it('leaves noGoLines empty on the duplicate', () => {
			const src = makeLegacyV4Section();
			src.noGoLines = [{ verts: { x: 1, y: 2, z: 3, w: 4 } }];
			const model = makeLegacyModel(4, [src]);
			const next = duplicateLegacySectionThroughEdge(model, 0, 0);
			expect(next.sections[1].noGoLines).toEqual([]);
		});

		it('does not touch unrelated sections or their linkSection indices', () => {
			const otherPortal: LegacyPortal = {
				midPosition: { x: 1, y: 2, z: 3, w: 0 },
				boundaryLines: [],
				linkSection: 0,
			};
			const other = makeLegacyV4Section({ portals: [otherPortal] });
			const model = makeLegacyModel(4, [makeLegacyV4Section(), other]);
			const next = duplicateLegacySectionThroughEdge(model, 0, 0);
			expect(next.sections[1]).toBe(other);
			expect(next.sections[1].portals[0].linkSection).toBe(0);
		});

		it('throws on out-of-range srcIdx', () => {
			const model = makeLegacyModel(4, [makeLegacyV4Section()]);
			expect(() => duplicateLegacySectionThroughEdge(model, -1, 0)).toThrow(RangeError);
			expect(() => duplicateLegacySectionThroughEdge(model, 5, 0)).toThrow(RangeError);
		});

		it('throws on out-of-range edgeIdx', () => {
			const model = makeLegacyModel(4, [makeLegacyV4Section()]);
			expect(() => duplicateLegacySectionThroughEdge(model, 0, -1)).toThrow(RangeError);
			expect(() => duplicateLegacySectionThroughEdge(model, 0, 4)).toThrow(RangeError);
		});

		it('throws on a degenerate (zero-length) edge', () => {
			const degenerate = makeLegacyV4Section({
				cornersX: [5, 5, 10, 10], // corners 0+1 coincide → edge 0 zero-length
				cornersZ: [5, 5, 5, 0],
			});
			const model = makeLegacyModel(4, [degenerate]);
			expect(() => duplicateLegacySectionThroughEdge(model, 0, 0)).toThrow(/degenerate/);
		});

		it('works for each edge of a rectangle (offset direction adapts)', () => {
			const model = makeLegacyModel(4, [makeLegacyV4Section()]);
			const cases: { edgeIdx: number; expected: { dx: number; dz: number } }[] = [
				{ edgeIdx: 0, expected: { dx: 0, dz: -10 } }, // bottom → translate −Z
				{ edgeIdx: 1, expected: { dx: 10, dz: 0 } },  // right  → translate +X
				{ edgeIdx: 2, expected: { dx: 0, dz: 10 } },  // top    → translate +Z
				{ edgeIdx: 3, expected: { dx: -10, dz: 0 } }, // left   → translate −X
			];
			for (const { edgeIdx, expected } of cases) {
				const next = duplicateLegacySectionThroughEdge(model, 0, edgeIdx);
				const dup = next.sections[1];
				expect({
					dx: dup.cornersX[0] - model.sections[0].cornersX[0],
					dz: dup.cornersZ[0] - model.sections[0].cornersZ[0],
				}).toEqual(expected);
			}
		});

		it('preserves the wrapper version field', () => {
			const model = makeLegacyModel(4, [makeLegacyV4Section()]);
			const next = duplicateLegacySectionThroughEdge(model, 0, 0);
			expect(next.version).toBe(4);
		});
	});

	describe('V6 path', () => {
		it('inherits spanIndex + district from the source', () => {
			// Issue #44 acceptance criterion: V6 has spanIndex + district →
			// duplicated section inherits both. The user can edit afterwards.
			const model = makeLegacyModel(6, [makeLegacyV6Section({
				spanIndex: 42,
				district: LegacyEDistrict.E_DISTRICT_AIRPORT,
			})]);
			const next = duplicateLegacySectionThroughEdge(model, 0, 0);
			const dup = next.sections[1];
			expect(dup.spanIndex).toBe(42);
			expect(dup.district).toBe(LegacyEDistrict.E_DISTRICT_AIRPORT);
		});

		it('preserves the wrapper version field', () => {
			const model = makeLegacyModel(6, [makeLegacyV6Section()]);
			const next = duplicateLegacySectionThroughEdge(model, 0, 0);
			expect(next.version).toBe(6);
		});

		it('preserves spanIndex = -1 (no-span sentinel) on the duplicate', () => {
			const model = makeLegacyModel(6, [makeLegacyV6Section({ spanIndex: -1 })]);
			const next = duplicateLegacySectionThroughEdge(model, 0, 0);
			expect(next.sections[1].spanIndex).toBe(-1);
		});

		it('cross-links the portal pair (same as V4)', () => {
			const model = makeLegacyModel(6, [makeLegacyV6Section()]);
			const next = duplicateLegacySectionThroughEdge(model, 0, 0);
			expect(next.sections[0].portals.at(-1)!.linkSection).toBe(1);
			expect(next.sections[1].portals[0].linkSection).toBe(0);
		});
	});
});

// =============================================================================
// translateLegacyCornerWithShared (V4 / V6 corner-drag with shared-point cascade)
// =============================================================================

describe('translateLegacyCornerWithShared', () => {
	// Two adjacent V4/V6 quads sharing the right edge of section 0 / left edge
	// of section 1. Mirrors the V12 makePair fixture but with cornersX/Z and
	// LegacyPortal midPosition/boundaryLines, so the smart-cascade behaviour
	// is exercised on the real legacy storage layout.
	function makeLegacyPair(version: 4 | 6 = 4): LegacyAISectionsData {
		const portal0to1: LegacyPortal = {
			midPosition: { x: 10, y: 0, z: 5, w: 0 },
			boundaryLines: [{ verts: { x: 10, y: 0, z: 10, w: 10 } }],
			linkSection: 1,
		};
		const portal1to0: LegacyPortal = {
			midPosition: { x: 10, y: 0, z: 5, w: 0 },
			boundaryLines: [{ verts: { x: 10, y: 10, z: 10, w: 0 } }],
			linkSection: 0,
		};
		const make = version === 4 ? makeLegacyV4Section : makeLegacyV6Section;
		const s0 = make({
			cornersX: [0, 10, 10, 0],
			cornersZ: [0, 0, 10, 10],
			portals: [portal0to1],
		});
		const s1 = make({
			cornersX: [10, 20, 20, 10],
			cornersZ: [0, 0, 10, 10],
			portals: [portal1to0],
		});
		return makeLegacyModel(version, [s0, s1]);
	}

	it('moves the targeted corner via cornersX / cornersZ writeback', () => {
		const model = makeLegacyPair();
		const next = translateLegacyCornerWithShared(model, 0, 1, { x: 3, z: -1 });
		// Section 0 corner 1 was (10, 0) → now (13, -1).
		expect(next.sections[0].cornersX[1]).toBe(13);
		expect(next.sections[0].cornersZ[1]).toBe(-1);
		// Other corners unchanged in section 0.
		expect(next.sections[0].cornersX[0]).toBe(0);
		expect(next.sections[0].cornersZ[0]).toBe(0);
		expect(next.sections[0].cornersX[3]).toBe(0);
		expect(next.sections[0].cornersZ[3]).toBe(10);
	});

	it('drags the same-point corner on a neighbour section (smart cascade)', () => {
		const model = makeLegacyPair();
		const next = translateLegacyCornerWithShared(model, 0, 1, { x: 3, z: -1 });
		// Section 1 had corner 0 at (10, 0) — the same world point as the
		// dragged corner — so it must move with us. This is the load-bearing
		// "shared corner" cascade that the V12 op also enforces.
		expect(next.sections[1].cornersX[0]).toBe(13);
		expect(next.sections[1].cornersZ[0]).toBe(-1);
		// Section 1's corners on its far edge stay still.
		expect(next.sections[1].cornersX[1]).toBe(20);
		expect(next.sections[1].cornersZ[1]).toBe(0);
	});

	it('shifts boundary-line endpoints anywhere in the model that match the old corner', () => {
		const model = makeLegacyPair();
		const next = translateLegacyCornerWithShared(model, 0, 1, { x: 3, z: -1 });
		// Source's portal had BL (10,0) → (10,10); the start (10,0) IS the
		// dragged corner so it shifts. End (10,10) is corner 2, untouched.
		expect(next.sections[0].portals[0].boundaryLines[0].verts).toEqual({
			x: 13, y: -1, z: 10, w: 10,
		});
		// Neighbour's reverse BL (10,10) → (10,0); the END (10,0) matched, so
		// it shifts. The start (10,10) is untouched.
		expect(next.sections[1].portals[0].boundaryLines[0].verts).toEqual({
			x: 10, y: 10, z: 13, w: -1,
		});
	});

	it('leaves portal midPosition alone (V4 anchor invariant matches V12)', () => {
		const model = makeLegacyPair();
		const next = translateLegacyCornerWithShared(model, 0, 1, { x: 3, z: -1 });
		// midPosition was (10, 0, 5, 0) on both portals — must be unchanged.
		// (Same rationale as V12: the user may have hand-placed the anchor;
		// dragging a corner shouldn't clobber it.)
		expect(next.sections[0].portals[0].midPosition).toEqual({ x: 10, y: 0, z: 5, w: 0 });
		expect(next.sections[1].portals[0].midPosition).toEqual({ x: 10, y: 0, z: 5, w: 0 });
	});

	it('shifts a noGoLine endpoint that matches the old corner', () => {
		const base = makeLegacyPair();
		const withNoGo: LegacyAISectionsData = {
			...base,
			sections: base.sections.map((s, i) =>
				i === 0
					? { ...s, noGoLines: [{ verts: { x: 5, y: 5, z: 10, w: 0 } }] }
					: s,
			),
		};
		const next = translateLegacyCornerWithShared(withNoGo, 0, 1, { x: 3, z: -1 });
		// noGo endpoint (10, 0) matched corner 1 → shift end to (13, -1).
		expect(next.sections[0].noGoLines[0].verts).toEqual({ x: 5, y: 5, z: 13, w: -1 });
	});

	it('preserves identity for sections that share no point with the dragged corner', () => {
		const base = makeLegacyPair();
		const farAway = makeLegacyV4Section({
			cornersX: [100, 110, 110, 100],
			cornersZ: [100, 100, 110, 110],
		});
		const expanded: LegacyAISectionsData = {
			...base,
			sections: [...base.sections, farAway],
		};
		const next = translateLegacyCornerWithShared(expanded, 0, 1, { x: 3, z: -1 });
		// Far-away section is structurally identical (===) — important for
		// React render-skipping in the overlay's preview path.
		expect(next.sections[2]).toBe(farAway);
	});

	it('is a no-op for a zero offset', () => {
		const model = makeLegacyPair();
		const next = translateLegacyCornerWithShared(model, 0, 1, { x: 0, z: 0 });
		expect(next).toBe(model);
	});

	it('throws on out-of-range srcIdx', () => {
		const model = makeLegacyPair();
		expect(() => translateLegacyCornerWithShared(model, -1, 0, { x: 1, z: 0 })).toThrow(RangeError);
		expect(() => translateLegacyCornerWithShared(model, 7, 0, { x: 1, z: 0 })).toThrow(RangeError);
	});

	it('throws on out-of-range cornerIdx', () => {
		const model = makeLegacyPair();
		expect(() => translateLegacyCornerWithShared(model, 0, -1, { x: 1, z: 0 })).toThrow(RangeError);
		expect(() => translateLegacyCornerWithShared(model, 0, 4, { x: 1, z: 0 })).toThrow(RangeError);
	});

	it('preserves the wrapper version field', () => {
		const v4 = makeLegacyPair(4);
		const v6 = makeLegacyPair(6);
		expect(translateLegacyCornerWithShared(v4, 0, 1, { x: 1, z: 0 }).version).toBe(4);
		expect(translateLegacyCornerWithShared(v6, 0, 1, { x: 1, z: 0 }).version).toBe(6);
	});

	it('preserves V6-only spanIndex / district on every section through a drag', () => {
		// Round-trip safety: the V6 schema requires spanIndex + district on
		// every section. The op must not strip or synthesise these fields,
		// even on neighbours that move via the cascade.
		const model = makeLegacyPair(6);
		const next = translateLegacyCornerWithShared(model, 0, 1, { x: 3, z: -1 });
		for (const sec of next.sections) {
			expect(sec.spanIndex).toBeDefined();
			expect(sec.district).toBeDefined();
		}
	});

	it('does not synthesise V6-only fields onto a V4 section through a drag', () => {
		// The V4 schema has no fields for spanIndex / district. Leaking them
		// in via the op would break the V4 RecordSchema serialisation.
		const model = makeLegacyPair(4);
		const next = translateLegacyCornerWithShared(model, 0, 1, { x: 3, z: -1 });
		for (const sec of next.sections) {
			expect('spanIndex' in sec).toBe(false);
			expect('district' in sec).toBe(false);
		}
	});

	it("does not collapse an interior corner that didn't match the old point", () => {
		// Drag corner 0 of section 0 (world point (0,0)). Section 1's corner 0
		// is (10,0) — different world point — must NOT move.
		const model = makeLegacyPair();
		const next = translateLegacyCornerWithShared(model, 0, 0, { x: -5, z: 0 });
		expect(next.sections[0].cornersX[0]).toBe(-5);
		// Section 1's parallel arrays untouched.
		expect(next.sections[1].cornersX).toEqual(model.sections[1].cornersX);
		expect(next.sections[1].cornersZ).toEqual(model.sections[1].cornersZ);
	});
});

// =============================================================================
// translateLegacySectionWithLinks (V4 / V6 smart move with paired-portal cascade)
// =============================================================================

describe('translateLegacySectionWithLinks', () => {
	// Pair of legacy sections sharing the right edge of section 0 / left edge
	// of section 1 (mirroring `makePair` in the V12 translateSectionWithLinks
	// suite above):
	//   Section 0: corners at (0,0) (10,0) (10,10) (0,10), one portal to s1
	//              anchored at (10, 0, 5), boundary line (10,0) → (10,10).
	//   Section 1: corners at (10,0) (20,0) (20,10) (10,10), one portal back
	//              to s0 anchored at (10, 0, 5), boundary line reversed.
	function makeLegacyPair(version: 4 | 6 = 4): LegacyAISectionsData {
		const portal0to1: LegacyPortal = {
			midPosition: { x: 10, y: 0, z: 5, w: 0 },
			boundaryLines: [{ verts: { x: 10, y: 0, z: 10, w: 10 } }],
			linkSection: 1,
		};
		const portal1to0: LegacyPortal = {
			midPosition: { x: 10, y: 0, z: 5, w: 0 },
			boundaryLines: [{ verts: { x: 10, y: 10, z: 10, w: 0 } }],
			linkSection: 0,
		};
		const make = version === 4 ? makeLegacyV4Section : makeLegacyV6Section;
		const s0 = make({
			cornersX: [0, 10, 10, 0],
			cornersZ: [0, 0, 10, 10],
			portals: [portal0to1],
		});
		const s1 = make({
			cornersX: [10, 20, 20, 10],
			cornersZ: [0, 0, 10, 10],
			portals: [portal1to0],
		});
		return makeLegacyModel(version, [s0, s1]);
	}

	it('shifts every spatial field on the source section', () => {
		const model = makeLegacyPair(4);
		const next = translateLegacySectionWithLinks(model, 0, { x: 3, z: -2 });
		const s0 = next.sections[0];
		expect(s0.cornersX).toEqual([3, 13, 13, 3]);
		expect(s0.cornersZ).toEqual([-2, -2, 8, 8]);
		// midPosition.y stays put — XZ-only translate. midPosition.w (vpu::Vector3
		// structural padding) also stays put — it's not a spatial coord.
		expect(s0.portals[0].midPosition).toEqual({ x: 13, y: 0, z: 3, w: 0 });
		expect(s0.portals[0].boundaryLines[0].verts).toEqual({ x: 13, y: -2, z: 13, w: 8 });
	});

	it("translates the neighbour's matching portal and its boundary line (linked-from-elsewhere)", () => {
		// This is the issue #42 acceptance criterion: portals on OTHER
		// sections that link back to the translated section must move along
		// with it. Section 1's portal points back at section 0 — when we
		// translate section 0, that portal's anchor + boundary line shift.
		const model = makeLegacyPair(4);
		const next = translateLegacySectionWithLinks(model, 0, { x: 3, z: -2 });
		const s1 = next.sections[1];
		expect(s1.portals[0].midPosition).toEqual({ x: 13, y: 0, z: 3, w: 0 });
		// Boundary line winding stays reversed — only the endpoint coords shift.
		expect(s1.portals[0].boundaryLines[0].verts).toEqual({ x: 13, y: 8, z: 13, w: -2 });
	});

	it('keeps the source/neighbour portal anchors equal after the move (paired)', () => {
		const model = makeLegacyPair(4);
		const next = translateLegacySectionWithLinks(model, 0, { x: 7, z: 4 });
		expect(next.sections[0].portals[0].midPosition).toEqual(next.sections[1].portals[0].midPosition);
	});

	it('shifts only the neighbour corners that lie on the shared edge', () => {
		const model = makeLegacyPair(4);
		const next = translateLegacySectionWithLinks(model, 0, { x: 3, z: -2 });
		// Shared edge endpoints (pre-translate): (10, 0) and (10, 10).
		// Section 1 has those at indexes 0 and 3; the (20, *) corners on its
		// far edge stay still — the polygon stretches rather than translating.
		expect(next.sections[1].cornersX).toEqual([13, 20, 20, 13]);
		expect(next.sections[1].cornersZ).toEqual([-2, 0, 10, 8]);
	});

	it('preserves portal midPosition.w (vpu::Vector3 structural padding)', () => {
		// V4 fixtures may carry a non-zero W — the parser preserves it for
		// round-trip fidelity. Translate must NOT clobber it. The V12 op has
		// no equivalent (Vector3 has no W); this is a legacy-only invariant.
		const portalWithPadding: LegacyPortal = {
			midPosition: { x: 10, y: 0, z: 5, w: 1.25 },
			boundaryLines: [{ verts: { x: 10, y: 0, z: 10, w: 10 } }],
			linkSection: 1,
		};
		const portalBackWithPadding: LegacyPortal = {
			midPosition: { x: 10, y: 0, z: 5, w: -3.5 },
			boundaryLines: [{ verts: { x: 10, y: 10, z: 10, w: 0 } }],
			linkSection: 0,
		};
		const s0 = makeLegacyV4Section({
			cornersX: [0, 10, 10, 0], cornersZ: [0, 0, 10, 10],
			portals: [portalWithPadding],
		});
		const s1 = makeLegacyV4Section({
			cornersX: [10, 20, 20, 10], cornersZ: [0, 0, 10, 10],
			portals: [portalBackWithPadding],
		});
		const model = makeLegacyModel(4, [s0, s1]);
		const next = translateLegacySectionWithLinks(model, 0, { x: 3, z: 0 });
		expect(next.sections[0].portals[0].midPosition.w).toBe(1.25);
		expect(next.sections[1].portals[0].midPosition.w).toBe(-3.5);
	});

	it('skips a portal pointing at a self-link (linkSection === srcIdx)', () => {
		const selfLinking: LegacyAISection = makeLegacyV4Section({
			portals: [{
				midPosition: { x: 0, y: 0, z: 0, w: 0 },
				boundaryLines: [{ verts: { x: 0, y: 0, z: 1, w: 0 } }],
				linkSection: 0, // points at itself
			}],
		});
		const model = makeLegacyModel(4, [selfLinking]);
		const next = translateLegacySectionWithLinks(model, 0, { x: 5, z: 0 });
		// Source still translates; no other section to cascade into.
		expect(next.sections[0].cornersX[0]).toBe(5);
	});

	it('skips a portal pointing at an out-of-range index (orphan)', () => {
		const orphan: LegacyAISection = makeLegacyV4Section({
			portals: [{
				midPosition: { x: 0, y: 0, z: 0, w: 0 },
				boundaryLines: [],
				linkSection: 999, // does not exist
			}],
		});
		const model = makeLegacyModel(4, [orphan]);
		expect(() => translateLegacySectionWithLinks(model, 0, { x: 5, z: 0 })).not.toThrow();
	});

	it("doesn't touch a neighbour's other portals (independent edges stay put)", () => {
		// Section 1 has two portals: one back to section 0 (will move) and
		// one to section 2 on its far edge (must NOT move). Mirrors the V12
		// "independent edges" test.
		const portal0to1: LegacyPortal = {
			midPosition: { x: 10, y: 0, z: 5, w: 0 },
			boundaryLines: [{ verts: { x: 10, y: 0, z: 10, w: 10 } }],
			linkSection: 1,
		};
		const portal1to0: LegacyPortal = {
			midPosition: { x: 10, y: 0, z: 5, w: 0 },
			boundaryLines: [{ verts: { x: 10, y: 10, z: 10, w: 0 } }],
			linkSection: 0,
		};
		const portal1to2: LegacyPortal = {
			midPosition: { x: 20, y: 0, z: 5, w: 0 },
			boundaryLines: [{ verts: { x: 20, y: 0, z: 20, w: 10 } }],
			linkSection: 2,
		};
		const s0 = makeLegacyV4Section({
			cornersX: [0, 10, 10, 0], cornersZ: [0, 0, 10, 10],
			portals: [portal0to1],
		});
		const s1 = makeLegacyV4Section({
			cornersX: [10, 20, 20, 10], cornersZ: [0, 0, 10, 10],
			portals: [portal1to0, portal1to2],
		});
		const s2 = makeLegacyV4Section();
		const model = makeLegacyModel(4, [s0, s1, s2]);

		const next = translateLegacySectionWithLinks(model, 0, { x: 3, z: 0 });
		// The s1→s2 portal is on the far edge — its anchor and BL are unchanged.
		expect(next.sections[1].portals[1]).toBe(s1.portals[1]);
	});

	it('is a no-op for a zero offset (returns the same model reference)', () => {
		const model = makeLegacyPair(4);
		const next = translateLegacySectionWithLinks(model, 0, { x: 0, z: 0 });
		expect(next).toBe(model);
	});

	it('throws on out-of-range srcIdx', () => {
		const model = makeLegacyPair(4);
		expect(() => translateLegacySectionWithLinks(model, 5, { x: 1, z: 0 })).toThrow(RangeError);
		expect(() => translateLegacySectionWithLinks(model, -1, { x: 1, z: 0 })).toThrow(RangeError);
	});

	it("doesn't change unrelated sections by reference", () => {
		const model = makeLegacyPair(4);
		const detached: LegacyAISection = makeLegacyV4Section({
			cornersX: [100, 110, 110, 100],
			cornersZ: [100, 100, 110, 110],
		});
		const expanded: LegacyAISectionsData = {
			...model,
			sections: [...model.sections, detached],
		};
		const next = translateLegacySectionWithLinks(expanded, 0, { x: 4, z: 4 });
		expect(next.sections[2]).toBe(detached);
	});

	it('preserves the wrapper version field (V4)', () => {
		const model = makeLegacyPair(4);
		const next = translateLegacySectionWithLinks(model, 0, { x: 1, z: 0 });
		expect(next.version).toBe(4);
	});

	it('preserves the wrapper version field (V6)', () => {
		const model = makeLegacyPair(6);
		const next = translateLegacySectionWithLinks(model, 0, { x: 1, z: 0 });
		expect(next.version).toBe(6);
		// And the V6-only fields on cascaded sections survive the translate.
		expect(next.sections[1].district).toBe(LegacyEDistrict.E_DISTRICT_SUBURBS);
	});

	it('round-trips with duplicate-through-edge: translate ∘ duplicate keeps the portal pair coincident', () => {
		// Build a single section, duplicate through edge 0 (which appends a
		// section to its south + cross-links portals), then translate the
		// source. The duplicate's matching portal must follow.
		const seed = makeLegacyModel(4, [makeLegacyV4Section()]);
		const after_dup = duplicateLegacySectionThroughEdge(seed, 0, 0);
		const after_translate = translateLegacySectionWithLinks(after_dup, 0, { x: 5, z: 5 });
		const srcPortal = after_translate.sections[0].portals.at(-1)!;
		const dupPortal = after_translate.sections[1].portals[0];
		expect(srcPortal.midPosition).toEqual(dupPortal.midPosition);
	});
});

// =============================================================================
// snapLegacyCornerOffset / snapLegacySectionOffset (V4 / V6 prototype layouts)
// =============================================================================
//
// V4/V6 sections store corners in parallel `cornersX[]` / `cornersZ[]` f32
// arrays, where V12 uses `Vector2[]`. The snap math is the same as V12 — these
// tests check the legacy adapter walks the parallel arrays correctly and
// returns identical offsets to the V12 path on geometrically-equivalent
// inputs.

describe('snapLegacyCornerOffset', () => {
	it('snaps onto a foreign corner within radius', () => {
		// Two squares — the dragged corner of section 0 (corner 1, world 10,0)
		// is being moved by (+0.3, 0); section 1's corner 0 sits at (11, 0).
		// With snapRadius 1.0, post-offset position 10.3 is within 0.7 of 11
		// → snaps to 11. Net offset becomes (1, 0).
		const model = makeLegacyModel(4, [
			makeLegacyV4Section(), // 0,0 / 10,0 / 10,10 / 0,10
			makeLegacyV4Section({
				cornersX: [11, 21, 21, 11],
				cornersZ: [0, 0, 10, 10],
			}),
		]);
		const snapped = snapLegacyCornerOffset(model, 0, 1, { x: 0.3, z: 0 }, 1.0);
		expect(snapped.x).toBeCloseTo(1, 6);
		expect(snapped.z).toBeCloseTo(0, 6);
	});

	it('snaps onto a foreign edge (closest point on segment, not endpoint)', () => {
		// Section 1 is an edge running x ∈ [-5, 15] at z = -1 — its bottom
		// edge (corners 0→1). Dragging section 0's corner 0 (world 0,0) by
		// (0, -0.5) lands probe at (0, -0.5); the closest point on that edge
		// is (0, -1). With snapRadius 1.0 it snaps. Net offset: (0, -1).
		const model = makeLegacyModel(4, [
			makeLegacyV4Section(),
			makeLegacyV4Section({
				cornersX: [-5, 15, 15, -5],
				cornersZ: [-1, -1, -11, -11],
			}),
		]);
		const snapped = snapLegacyCornerOffset(model, 0, 0, { x: 0, z: -0.5 }, 1.0);
		expect(snapped.x).toBeCloseTo(0, 6);
		expect(snapped.z).toBeCloseTo(-1, 6);
	});

	it('returns the proposed offset when nothing is in range', () => {
		const model = makeLegacyModel(4, [
			makeLegacyV4Section(),
			makeLegacyV4Section({
				cornersX: [100, 110, 110, 100],
				cornersZ: [100, 100, 110, 110],
			}),
		]);
		const proposed = { x: 0.3, z: 0.4 };
		const snapped = snapLegacyCornerOffset(model, 0, 1, proposed, 1.0);
		expect(snapped).toEqual(proposed);
	});

	it('ignores its own corners (no self-snap)', () => {
		// Single section — no other section to snap to. Even though section 0
		// has another corner at (10, 10), dragging corner 1 toward it should
		// not snap. (Snapping a polygon corner onto another corner of the
		// same polygon would degenerate the shape.)
		const model = makeLegacyModel(4, [makeLegacyV4Section()]);
		const proposed = { x: 0.1, z: 9.95 };
		const snapped = snapLegacyCornerOffset(model, 0, 1, proposed, 1.0);
		expect(snapped).toEqual(proposed);
	});

	it('excludes neighbour corners coincident with the dragged corner (cascade partner filter)', () => {
		// Two sections sharing a corner at (10, 0). Dragging section 0's
		// corner 1 (the shared world position) toward another foreign target
		// at (11, 0): the cascade-partner filter should exclude section 1's
		// corner 0 (== old world position of the dragged corner). The snap
		// target is section 1's corner 1 (21, 0), which is too far away
		// (post-offset 10.3 is 10.7 from 21), so we get no snap and keep
		// proposed offset.
		const model = makeLegacyModel(4, [
			makeLegacyV4Section(),
			makeLegacyV4Section({
				cornersX: [10, 21, 21, 10],
				cornersZ: [0, 0, 10, 10],
			}),
		]);
		const proposed = { x: 0.3, z: 0 };
		const snapped = snapLegacyCornerOffset(model, 0, 1, proposed, 1.0);
		expect(snapped).toEqual(proposed);
	});

	it('returns proposed offset on out-of-range srcIdx', () => {
		const model = makeLegacyModel(4, [makeLegacyV4Section()]);
		const proposed = { x: 0.5, z: 0.5 };
		expect(snapLegacyCornerOffset(model, 99, 0, proposed, 1.0)).toEqual(proposed);
	});

	it('returns proposed offset on out-of-range cornerIdx', () => {
		const model = makeLegacyModel(4, [makeLegacyV4Section()]);
		const proposed = { x: 0.5, z: 0.5 };
		expect(snapLegacyCornerOffset(model, 0, 99, proposed, 1.0)).toEqual(proposed);
	});

	it('returns proposed offset on snapRadius <= 0', () => {
		const model = makeLegacyModel(4, [
			makeLegacyV4Section(),
			makeLegacyV4Section({ cornersX: [11, 21, 21, 11], cornersZ: [0, 0, 10, 10] }),
		]);
		const proposed = { x: 0.3, z: 0 };
		expect(snapLegacyCornerOffset(model, 0, 1, proposed, 0)).toEqual(proposed);
		expect(snapLegacyCornerOffset(model, 0, 1, proposed, -1)).toEqual(proposed);
	});

	it('works for V6 sections (same code path as V4)', () => {
		const model = makeLegacyModel(6, [
			makeLegacyV6Section(),
			makeLegacyV6Section({ cornersX: [11, 21, 21, 11], cornersZ: [0, 0, 10, 10] }),
		]);
		const snapped = snapLegacyCornerOffset(model, 0, 1, { x: 0.3, z: 0 }, 1.0);
		expect(snapped.x).toBeCloseTo(1, 6);
		expect(snapped.z).toBeCloseTo(0, 6);
	});
});

describe('snapLegacySectionOffset', () => {
	it('snaps the whole section so a source corner lands on a foreign corner', () => {
		// Source square at 0..10. Foreign square at 11..21 in X. Translate
		// proposed (+0.7, 0) → source corner 1 lands at (10.7, 0). Foreign
		// corner 0 sits at (11, 0). With snapRadius 1.0 → snap delta +0.3.
		// Net offset (+1, 0). Foreign corner 3 at (11, 10) is also at
		// distance 0.3 + 10 → not closer.
		const model = makeLegacyModel(4, [
			makeLegacyV4Section(),
			makeLegacyV4Section({ cornersX: [11, 21, 21, 11], cornersZ: [0, 0, 10, 10] }),
		]);
		const snapped = snapLegacySectionOffset(model, 0, { x: 0.7, z: 0 }, 1.0);
		expect(snapped.x).toBeCloseTo(1, 6);
		expect(snapped.z).toBeCloseTo(0, 6);
	});

	it('picks the closest source-corner / foreign-target pair', () => {
		// Two foreign squares in range. The closer one (foreign corner at
		// (11, 0), distance 0.3 from source corner 1 post-translate) should
		// win over the farther one (foreign corner at (10.6, 0), distance 0.6
		// from source corner 0 post-translate). Tests that the algorithm
		// genuinely searches across all source corners + all foreign
		// candidates and picks the global minimum, not just the first hit.
		const model = makeLegacyModel(4, [
			makeLegacyV4Section(),
			// Square anchored at (11, 0) — corner 0 at (11, 0) is the
			// nearest target for source corner 1 (post-translate world 10.3,0).
			makeLegacyV4Section({ cornersX: [11, 21, 21, 11], cornersZ: [0, 0, 10, 10] }),
			// Square far below at z=-50 with corner 0 at (10.6, -50) — too far
			// to ever snap. Confirms we don't accidentally snap to it.
			makeLegacyV4Section({ cornersX: [10.6, 20, 20, 10.6], cornersZ: [-50, -50, -40, -40] }),
		]);
		const snapped = snapLegacySectionOffset(model, 0, { x: 0.3, z: 0 }, 1.0);
		// Source corner 1 (10, 0) → post-translate (10.3, 0); snaps to (11, 0).
		// Net offset: (+1, 0).
		expect(snapped.x).toBeCloseTo(1, 6);
		expect(snapped.z).toBeCloseTo(0, 6);
	});

	it('returns the proposed offset when nothing is in range', () => {
		const model = makeLegacyModel(4, [
			makeLegacyV4Section(),
			makeLegacyV4Section({ cornersX: [100, 110, 110, 100], cornersZ: [100, 100, 110, 110] }),
		]);
		const proposed = { x: 0.3, z: 0 };
		const snapped = snapLegacySectionOffset(model, 0, proposed, 1.0);
		expect(snapped).toEqual(proposed);
	});

	it('returns proposed offset on out-of-range srcIdx', () => {
		const model = makeLegacyModel(4, [makeLegacyV4Section()]);
		const proposed = { x: 0.5, z: 0.5 };
		expect(snapLegacySectionOffset(model, 99, proposed, 1.0)).toEqual(proposed);
	});

	it('returns proposed offset on snapRadius <= 0', () => {
		const model = makeLegacyModel(4, [
			makeLegacyV4Section(),
			makeLegacyV4Section({ cornersX: [11, 21, 21, 11], cornersZ: [0, 0, 10, 10] }),
		]);
		const proposed = { x: 0.7, z: 0 };
		expect(snapLegacySectionOffset(model, 0, proposed, 0)).toEqual(proposed);
		expect(snapLegacySectionOffset(model, 0, proposed, -1)).toEqual(proposed);
	});

	it('snaps onto a foreign edge between two corners', () => {
		// Foreign section: long horizontal edge from (-5, 11) to (15, 11) —
		// the bottom edge (corners 0→1). Translate (+0, +10.7) on the source
		// square: source corner 3 (0,10) → (0, 20.7) → not near. Source
		// corner 2 (10,10) → (10, 20.7) → not near.
		// Wait — that doesn't work. Let me re-orient: foreign edge at z=11
		// running from x=-5 to x=15. Translating source up by +0.7 in Z lands
		// corner 3 (0,10) at (0,10.7) — which is 0.3 from the closest point
		// on the foreign edge (0, 11). With snapRadius 1.0 → snaps to 11.
		// Net offset (0, +1).
		const model = makeLegacyModel(4, [
			makeLegacyV4Section(),
			makeLegacyV4Section({ cornersX: [-5, 15, 15, -5], cornersZ: [11, 11, 21, 21] }),
		]);
		const snapped = snapLegacySectionOffset(model, 0, { x: 0, z: 0.7 }, 1.0);
		expect(snapped.x).toBeCloseTo(0, 6);
		expect(snapped.z).toBeCloseTo(1, 6);
	});

	it('works for V6 sections (same code path as V4)', () => {
		const model = makeLegacyModel(6, [
			makeLegacyV6Section(),
			makeLegacyV6Section({ cornersX: [11, 21, 21, 11], cornersZ: [0, 0, 10, 10] }),
		]);
		const snapped = snapLegacySectionOffset(model, 0, { x: 0.7, z: 0 }, 1.0);
		expect(snapped.x).toBeCloseTo(1, 6);
		expect(snapped.z).toBeCloseTo(0, 6);
	});

	it('does not modify the input model', () => {
		const model = makeLegacyModel(4, [
			makeLegacyV4Section(),
			makeLegacyV4Section({ cornersX: [11, 21, 21, 11], cornersZ: [0, 0, 10, 10] }),
		]);
		const before = JSON.stringify(model);
		snapLegacySectionOffset(model, 0, { x: 0.7, z: 0 }, 1.0);
		expect(JSON.stringify(model)).toEqual(before);
	});
});
