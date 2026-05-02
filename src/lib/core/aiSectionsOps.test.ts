// Unit tests for duplicateSectionThroughEdge.
//
// Pure-model tests — no fixtures, no React, no IO. We hand-build a tiny
// `ParsedAISectionsV12` and check the geometry / portal wiring of the result.

import { describe, it, expect } from 'vitest';
import {
	deleteSection,
	duplicateLegacySectionThroughEdge,
	duplicateSectionThroughEdge,
	snapCornerOffset,
	snapSectionOffset,
	translateCornerWithShared,
	translateLegacyCornerWithShared,
	translateSectionWithLinks,
} from './aiSectionsOps';
import {
	AI_SECTIONS_VERSION,
	EResetSpeedType,
	LegacyDangerRating,
	LegacyEDistrict,
	SectionSpeed,
	type AISection,
	type LegacyAISection,
	type LegacyAISectionsData,
	type LegacyPortal,
	type ParsedAISectionsV12,
	type Portal,
	type SectionResetPair,
	type Vector2,
} from './aiSections';

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

function makeSection(opts: {
	id?: number;
	corners?: Vector2[];
	portals?: Portal[];
	spanIndex?: number;
	speed?: SectionSpeed;
	district?: number;
	flags?: number;
}): AISection {
	return {
		portals: opts.portals ?? [],
		noGoLines: [],
		corners: opts.corners ?? [
			// Default unit square (CCW in XZ, edge 0 = bottom, edge 1 = right,
			// edge 2 = top, edge 3 = left).
			{ x: 0, y: 0 },
			{ x: 10, y: 0 },
			{ x: 10, y: 10 },
			{ x: 0, y: 10 },
		],
		id: opts.id ?? 0xAA,
		spanIndex: opts.spanIndex ?? -1,
		speed: opts.speed ?? SectionSpeed.E_SECTION_SPEED_NORMAL,
		district: opts.district ?? 0,
		flags: opts.flags ?? 0,
	};
}

function makeModel(sections: AISection[]): ParsedAISectionsV12 {
	return {
		kind: 'v12',
		version: AI_SECTIONS_VERSION,
		sectionMinSpeeds: [0, 0, 0, 0, 0],
		sectionMaxSpeeds: [0, 0, 0, 0, 0],
		sections,
		sectionResetPairs: [],
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('duplicateSectionThroughEdge', () => {
	it('appends the duplicate at the end of sections', () => {
		const model = makeModel([makeSection({ id: 1 }), makeSection({ id: 2 })]);
		const next = duplicateSectionThroughEdge(model, 0, 0);
		expect(next.sections).toHaveLength(3);
		expect(next).not.toBe(model); // immutable update
		expect(next.sections[0]).not.toBe(model.sections[0]); // source mutated structurally
	});

	it('places the duplicate adjacent on the chosen edge (rectangle: opposite edge lands on chosen edge)', () => {
		// Square 0,0 → 10,0 → 10,10 → 0,10. Edge 0 is the bottom (y=0).
		// Outward normal points in -Y (away from centroid at (5,5)).
		// Offset distance = 2 × 5 = 10, so duplicate corners are translated
		// by (0, -10): bottom (-10..0) along Y. The duplicate's edge 2 (top)
		// runs from (10, 0) → (0, 0), which matches edge 0 of the source
		// (reversed winding because corners shift by translation).
		const model = makeModel([makeSection({})]);
		const next = duplicateSectionThroughEdge(model, 0, 0);
		const dup = next.sections[1];
		expect(dup.corners).toEqual([
			{ x: 0, y: -10 },
			{ x: 10, y: -10 },
			{ x: 10, y: 0 },
			{ x: 0, y: 0 },
		]);
	});

	it('cross-links the new portal pair via linkSection', () => {
		const model = makeModel([makeSection({ id: 1 })]);
		const next = duplicateSectionThroughEdge(model, 0, 0);
		const srcPortal = next.sections[0].portals.at(-1)!;
		const dupPortal = next.sections[1].portals[0];
		expect(srcPortal.linkSection).toBe(1);
		expect(dupPortal.linkSection).toBe(0);
	});

	it('shares Position between the portal pair (same world-space anchor)', () => {
		const model = makeModel([makeSection({})]);
		const next = duplicateSectionThroughEdge(model, 0, 0);
		const srcPortal = next.sections[0].portals.at(-1)!;
		const dupPortal = next.sections[1].portals[0];
		expect(srcPortal.position).toEqual(dupPortal.position);
		// Edge 0 midpoint in world space: (5, 0). Y from no-portals fallback = 0.
		expect(srcPortal.position).toEqual({ x: 5, y: 0, z: 0 });
	});

	it('reverses the boundary-line winding on the duplicate side', () => {
		const model = makeModel([makeSection({})]);
		const next = duplicateSectionThroughEdge(model, 0, 0);
		const srcBL = next.sections[0].portals.at(-1)!.boundaryLines[0].verts;
		const dupBL = next.sections[1].portals[0].boundaryLines[0].verts;
		// Source: A→B = (0,0) → (10,0) packed as (0,0,10,0)
		expect(srcBL).toEqual({ x: 0, y: 0, z: 10, w: 0 });
		// Duplicate: B→A = (10,0) → (0,0) packed as (10,0,0,0)
		expect(dupBL).toEqual({ x: 10, y: 0, z: 0, w: 0 });
	});

	it('copies anchor height (Position.y) from the source\'s first existing portal', () => {
		const seedPortal: Portal = {
			position: { x: 0, y: 42.5, z: 0 },
			boundaryLines: [],
			linkSection: 0,
		};
		const model = makeModel([makeSection({ portals: [seedPortal] })]);
		const next = duplicateSectionThroughEdge(model, 0, 0);
		expect(next.sections[0].portals.at(-1)!.position.y).toBe(42.5);
		expect(next.sections[1].portals[0].position.y).toBe(42.5);
	});

	it('falls back to Position.y = 0 when source has no portals', () => {
		const model = makeModel([makeSection({})]);
		const next = duplicateSectionThroughEdge(model, 0, 0);
		expect(next.sections[1].portals[0].position.y).toBe(0);
	});

	it('does not touch unrelated sections or their linkSection indices', () => {
		const other = makeSection({
			id: 99,
			portals: [{ position: { x: 1, y: 2, z: 3 }, boundaryLines: [], linkSection: 0 }],
		});
		const model = makeModel([makeSection({ id: 1 }), other]);
		const next = duplicateSectionThroughEdge(model, 0, 0);
		// The unrelated section (index 1) is preserved by reference.
		expect(next.sections[1]).toBe(other);
		expect(next.sections[1].portals[0].linkSection).toBe(0);
	});

	it('copies spanIndex / speed / flags / district to the duplicate', () => {
		const model = makeModel([makeSection({
			spanIndex: 7,
			speed: SectionSpeed.E_SECTION_SPEED_FAST,
			district: 0, // retail always 0
			flags: 0x05,
		})]);
		const next = duplicateSectionThroughEdge(model, 0, 0);
		const dup = next.sections[1];
		expect(dup.spanIndex).toBe(7);
		expect(dup.speed).toBe(SectionSpeed.E_SECTION_SPEED_FAST);
		expect(dup.district).toBe(0);
		expect(dup.flags).toBe(0x05);
	});

	it('leaves noGoLines empty on the duplicate', () => {
		const src = makeSection({});
		src.noGoLines = [{ verts: { x: 1, y: 2, z: 3, w: 4 } }];
		const model = makeModel([src]);
		const next = duplicateSectionThroughEdge(model, 0, 0);
		expect(next.sections[1].noGoLines).toEqual([]);
	});

	it('assigns max(existing ids) + 1 as the duplicate id', () => {
		const model = makeModel([
			makeSection({ id: 100 }),
			makeSection({ id: 5000 }),
			makeSection({ id: 42 }),
		]);
		const next = duplicateSectionThroughEdge(model, 0, 0);
		expect(next.sections[3].id).toBe(5001);
	});

	it('throws on out-of-range srcIdx', () => {
		const model = makeModel([makeSection({})]);
		expect(() => duplicateSectionThroughEdge(model, -1, 0)).toThrow(RangeError);
		expect(() => duplicateSectionThroughEdge(model, 5, 0)).toThrow(RangeError);
	});

	it('throws on out-of-range edgeIdx', () => {
		const model = makeModel([makeSection({})]);
		expect(() => duplicateSectionThroughEdge(model, 0, -1)).toThrow(RangeError);
		expect(() => duplicateSectionThroughEdge(model, 0, 4)).toThrow(RangeError);
	});

	it('throws on a degenerate (zero-length) edge', () => {
		const degenerate = makeSection({
			corners: [
				{ x: 5, y: 5 },
				{ x: 5, y: 5 }, // same as previous → edge 0 has zero length
				{ x: 10, y: 5 },
				{ x: 10, y: 0 },
			],
		});
		const model = makeModel([degenerate]);
		expect(() => duplicateSectionThroughEdge(model, 0, 0)).toThrow(/degenerate/);
	});

	it('works for each edge of a rectangle (offset direction adapts)', () => {
		// All four edges should produce a duplicate offset by the polygon's
		// width/height in the appropriate direction.
		const model = makeModel([makeSection({})]);
		const cases: { edgeIdx: number; expected: Vector2 }[] = [
			{ edgeIdx: 0, expected: { x: 0, y: -10 } }, // bottom → translate −Y
			{ edgeIdx: 1, expected: { x: 10, y: 0 } },  // right  → translate +X
			{ edgeIdx: 2, expected: { x: 0, y: 10 } },  // top    → translate +Y
			{ edgeIdx: 3, expected: { x: -10, y: 0 } }, // left   → translate −X
		];
		for (const { edgeIdx, expected } of cases) {
			const next = duplicateSectionThroughEdge(model, 0, edgeIdx);
			const delta = {
				x: next.sections[1].corners[0].x - model.sections[0].corners[0].x,
				y: next.sections[1].corners[0].y - model.sections[0].corners[0].y,
			};
			expect(delta).toEqual(expected);
		}
	});

	it('sample from the wiki: portal pair shares Position with reversed boundary winding', () => {
		// Mirrors the screenshot example from the user's feature request:
		// Section 7491 ↔ 7497 share Position (3771.41…, -1005.91…, 27.99…)
		// and have boundary lines (3773,-993)→(3770,-1019) reversed on the
		// other side. We hand-build a section whose chosen edge runs from
		// (3773, -993) → (3770, -1019) and verify the operation produces
		// the same shape.
		const src = makeSection({
			corners: [
				{ x: 3773, y: -993 },
				{ x: 3770, y: -1019 },
				{ x: 3760, y: -1019 },
				{ x: 3763, y: -993 },
			],
		});
		const model = makeModel([src]);
		const next = duplicateSectionThroughEdge(model, 0, 0);
		const srcPortal = next.sections[0].portals.at(-1)!;
		const dupPortal = next.sections[1].portals[0];
		// Same Position.
		expect(srcPortal.position).toEqual(dupPortal.position);
		// Source: A→B winding.
		expect(srcPortal.boundaryLines[0].verts).toEqual({ x: 3773, y: -993, z: 3770, w: -1019 });
		// Duplicate: B→A winding.
		expect(dupPortal.boundaryLines[0].verts).toEqual({ x: 3770, y: -1019, z: 3773, w: -993 });
		// Cross-links.
		expect(srcPortal.linkSection).toBe(1);
		expect(dupPortal.linkSection).toBe(0);
	});
});

// =============================================================================
// deleteSection
// =============================================================================

// Helper: build a portal that links to `target`.
function portalTo(target: number): Portal {
	return {
		position: { x: 0, y: 0, z: 0 },
		boundaryLines: [],
		linkSection: target,
	};
}

// Helper: build a reset pair.
function resetPair(start: number, reset: number): SectionResetPair {
	return {
		resetSpeed: EResetSpeedType.E_RESET_SPEED_TYPE_NONE,
		startSectionIndex: start,
		resetSectionIndex: reset,
	};
}

describe('deleteSection', () => {
	it('removes the section at idx', () => {
		const model = makeModel([
			makeSection({ id: 0xA }),
			makeSection({ id: 0xB }),
			makeSection({ id: 0xC }),
		]);
		const next = deleteSection(model, 1);
		expect(next.sections).toHaveLength(2);
		expect(next.sections.map((s) => s.id)).toEqual([0xA, 0xC]);
	});

	it('decrements linkSection > idx on remaining portals', () => {
		// Three sections; section 0's portals link to 1 and 2. Delete 1 → the
		// portal that pointed at 2 should now point at 1.
		const s0 = makeSection({ id: 0xA, portals: [portalTo(1), portalTo(2)] });
		const model = makeModel([s0, makeSection({ id: 0xB }), makeSection({ id: 0xC })]);
		const next = deleteSection(model, 1);
		const remaining = next.sections[0].portals.map((p) => p.linkSection);
		// Portal-to-1 was orphaned (target == idx, dropped). Portal-to-2 → now 1.
		expect(remaining).toEqual([1]);
	});

	it('drops portals whose linkSection equals the deleted idx', () => {
		const s0 = makeSection({ id: 0xA, portals: [portalTo(1)] });
		const s1 = makeSection({ id: 0xB });
		const model = makeModel([s0, s1]);
		const next = deleteSection(model, 1);
		expect(next.sections).toHaveLength(1);
		expect(next.sections[0].portals).toEqual([]);
	});

	it('leaves linkSection < idx untouched', () => {
		// Section 2 has a portal pointing at 0 — that target index is unaffected
		// by deleting section 1 and should stay 0.
		const s0 = makeSection({ id: 0xA });
		const s1 = makeSection({ id: 0xB });
		const s2 = makeSection({ id: 0xC, portals: [portalTo(0)] });
		const model = makeModel([s0, s1, s2]);
		const next = deleteSection(model, 1);
		// Section 2 in old indexing is now at index 1 — find by id to be safe.
		const remaining = next.sections.find((s) => s.id === 0xC)!;
		expect(remaining.portals[0].linkSection).toBe(0);
	});

	it('reindexes section reset pairs > idx', () => {
		const model: ParsedAISectionsV12 = {
			...makeModel([makeSection({ id: 1 }), makeSection({ id: 2 }), makeSection({ id: 3 })]),
			sectionResetPairs: [resetPair(0, 2), resetPair(2, 0)],
		};
		const next = deleteSection(model, 1);
		// Pair (0, 2) → (0, 1).
		// Pair (2, 0) → (1, 0).
		expect(next.sectionResetPairs).toEqual([
			resetPair(0, 1),
			resetPair(1, 0),
		]);
	});

	it('drops reset pairs that reference the deleted section', () => {
		const model: ParsedAISectionsV12 = {
			...makeModel([makeSection({ id: 1 }), makeSection({ id: 2 }), makeSection({ id: 3 })]),
			sectionResetPairs: [
				resetPair(1, 2),  // start references idx → drop
				resetPair(0, 1),  // reset references idx → drop
				resetPair(0, 2),  // survives, reset shifts to 1
			],
		};
		const next = deleteSection(model, 1);
		expect(next.sectionResetPairs).toEqual([resetPair(0, 1)]);
	});

	it('does not allocate new objects for unaffected sections', () => {
		// Section 0 has no portals pointing at or after the deletion target,
		// so the same object reference should be preserved (cheap idempotency
		// for downstream React memoization).
		const s0 = makeSection({ id: 0xA, portals: [portalTo(0)] });
		// Note: this portal links to itself (idx 0 < deletion idx). After
		// deletion, idx 0 is still 0, so nothing to change.
		const s1 = makeSection({ id: 0xB });
		const model = makeModel([s0, s1]);
		const next = deleteSection(model, 1);
		expect(next.sections[0]).toBe(s0);
	});

	it('throws on out-of-range idx', () => {
		const model = makeModel([makeSection({}), makeSection({})]);
		expect(() => deleteSection(model, -1)).toThrow(RangeError);
		expect(() => deleteSection(model, 2)).toThrow(RangeError);
	});

	it('preserves header fields (version, speed limits)', () => {
		const model: ParsedAISectionsV12 = {
			kind: 'v12',
			version: 12,
			sectionMinSpeeds: [1, 2, 3, 4, 5],
			sectionMaxSpeeds: [6, 7, 8, 9, 10],
			sections: [makeSection({}), makeSection({})],
			sectionResetPairs: [],
		};
		const next = deleteSection(model, 0);
		expect(next.version).toBe(12);
		expect(next.sectionMinSpeeds).toEqual([1, 2, 3, 4, 5]);
		expect(next.sectionMaxSpeeds).toEqual([6, 7, 8, 9, 10]);
	});

});

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

// =============================================================================
// duplicate ↔ delete round-trip
// =============================================================================

describe('duplicate ↔ delete round-trip', () => {
	it('duplicate then delete restores the model', () => {
		// Sanity: a duplicate-then-delete on the duplicate index should produce
		// back the original model (modulo the source section gaining-and-losing
		// a portal).
		const model = makeModel([makeSection({ id: 0xA })]);
		const dup = duplicateSectionThroughEdge(model, 0, 0);
		expect(dup.sections).toHaveLength(2);
		const restored = deleteSection(dup, 1);
		expect(restored.sections).toHaveLength(1);
		// The source's appended back-portal pointed at idx 1 (which we just
		// deleted), so it gets dropped — leaving the section in its original
		// "no portals" state.
		expect(restored.sections[0].portals).toEqual([]);
	});
});

// =============================================================================
// duplicateLegacySectionThroughEdge (V4 / V6 prototype layouts)
// =============================================================================

function makeLegacyV4Section(opts: {
	cornersX?: number[];
	cornersZ?: number[];
	portals?: LegacyPortal[];
	dangerRating?: number;
	flags?: number;
} = {}): LegacyAISection {
	return {
		portals: opts.portals ?? [],
		noGoLines: [],
		// Default unit square mirroring the V12 builder above (CCW in XZ,
		// edge 0 = bottom, edge 1 = right, edge 2 = top, edge 3 = left).
		cornersX: opts.cornersX ?? [0, 10, 10, 0],
		cornersZ: opts.cornersZ ?? [0, 0, 10, 10],
		dangerRating: opts.dangerRating ?? LegacyDangerRating.E_DANGER_RATING_NORMAL,
		flags: opts.flags ?? 0,
	};
}

function makeLegacyV6Section(opts: {
	cornersX?: number[];
	cornersZ?: number[];
	portals?: LegacyPortal[];
	dangerRating?: number;
	flags?: number;
	spanIndex?: number;
	district?: number;
} = {}): LegacyAISection {
	return {
		...makeLegacyV4Section(opts),
		spanIndex: opts.spanIndex ?? -1,
		district: opts.district ?? LegacyEDistrict.E_DISTRICT_SUBURBS,
	};
}

function makeLegacyModel(version: 4 | 6, sections: LegacyAISection[]): LegacyAISectionsData {
	return { version, sections };
}

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
	// Two adjacent V4 quads sharing the right edge of section 0 / left edge
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
