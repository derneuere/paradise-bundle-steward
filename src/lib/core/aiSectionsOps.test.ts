// Unit tests for duplicateSectionThroughEdge.
//
// Pure-model tests — no fixtures, no React, no IO. We hand-build a tiny
// `ParsedAISectionsV12` and check the geometry / portal wiring of the result.

import { describe, it, expect } from 'vitest';
import {
	bulkAISectionsAxes,
	bulkRotateEntitiesYaw,
	bulkSelectionPivot,
	bulkTranslateEntities,
	deleteSection,
	duplicateLegacySectionThroughEdge,
	duplicateSectionThroughEdge,
	rotateSectionAroundCentroidYaw,
	rotateSectionWithLinksYaw,
	rotateSelectionWithLinksYaw,
	snapCornerOffset,
	snapLegacyCornerOffset,
	snapLegacySectionOffset,
	snapSectionOffset,
	translateBoundaryLineEndpointRigid,
	translateCornerRigid,
	translateCornerWithShared,
	translateLegacyCornerWithShared,
	translateLegacySectionWithLinks,
	translateNoGoLineEndpointRigid,
	translatePortalAnchorRigid,
	translatePortalAnchorWithMirror,
	translateSectionRigid,
	translateSectionWithLinks,
	translateSelectionWithLinks,
	type AISectionEntityRef,
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

	it('falls back to Position.y = 0 when source has no portals and no portal-linked neighbours', () => {
		const model = makeModel([makeSection({})]);
		const next = duplicateSectionThroughEdge(model, 0, 0);
		expect(next.sections[1].portals[0].position.y).toBe(0);
	});

	it('inherits Y from a portal-linked neighbour when source has no portals (issue #27 sub-task b)', () => {
		// Source (section 0) has no portals; neighbour (section 1) has a
		// portal pointing at section 0 with Y=42. The Y resolver propagates
		// that Y to section 0, so the duplicate's portal anchor lands at 42
		// instead of falling back to 0.
		const neighbour = makeSection({
			id: 99,
			portals: [{ position: { x: 0, y: 42, z: 0 }, boundaryLines: [], linkSection: 0 }],
		});
		const model = makeModel([makeSection({}), neighbour]);
		const next = duplicateSectionThroughEdge(model, 0, 0);
		expect(next.sections[2].portals[0].position.y).toBe(42);
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

// =============================================================================
// translateSectionRigid (Bulk-transform: no-cascade rigid translate)
// =============================================================================
//
// The Bulk-transform gizmo's default-no-modifier path. Outside neighbours
// stay completely put (per ADR-0009) — this is what differentiates this op
// from `translateSectionWithLinks`. The 3D offset accepts `(dx, dy, dz)`:
// `dy` shifts portal anchor Ys but leaves the XZ-packed corners and
// boundary lines alone (per ADR-0011).

describe('translateSectionRigid', () => {
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

	it('shifts every spatial field on the source by (dx, dy, dz)', () => {
		const model = makePair();
		const next = translateSectionRigid(model, 0, { x: 3, y: 2, z: -2 });
		const s0 = next.sections[0];
		// XZ-packed corners only see (dx, dz) — dy doesn't apply.
		expect(s0.corners).toEqual([
			{ x: 3, y: -2 },
			{ x: 13, y: -2 },
			{ x: 13, y: 8 },
			{ x: 3, y: 8 },
		]);
		// Portal anchor (Vector3) sees full (dx, dy, dz).
		expect(s0.portals[0].position).toEqual({ x: 13, y: 2, z: 3 });
		// Portal boundary line (XZ-packed Vector4) — both endpoints shift by (dx, dz).
		expect(s0.portals[0].boundaryLines[0].verts).toEqual({ x: 13, y: -2, z: 13, w: 8 });
	});

	it('translates noGo lines too', () => {
		const portal: Portal = {
			position: { x: 0, y: 0, z: 0 },
			boundaryLines: [],
			linkSection: 0,
		};
		const sec = makeSection({
			portals: [portal],
		});
		sec.noGoLines = [{ verts: { x: 0, y: 0, z: 5, w: 5 } }];
		const model = makeModel([sec]);
		const next = translateSectionRigid(model, 0, { x: 1, y: 0, z: 2 });
		expect(next.sections[0].noGoLines[0].verts).toEqual({ x: 1, y: 2, z: 6, w: 7 });
	});

	it('leaves outside neighbours completely put (no cascade — ADR-0009)', () => {
		const model = makePair();
		const next = translateSectionRigid(model, 0, { x: 3, y: 0, z: -2 });
		// Section 1's corners, portals, and boundary lines all stay put.
		// Reference equality on the section object proves nothing under it
		// changed (immutable-update convention used throughout this module).
		expect(next.sections[1]).toBe(model.sections[1]);
	});

	it('produces stale paired-portal anchors (a documented v1 trade-off — ADR-0009)', () => {
		// The neighbour's reverse portal still claims it lives at the OLD
		// shared-edge midpoint, while the source's portal has moved. That's
		// the "stale" state ADR-0009 accepts as a v1 trade-off — a follow-up
		// "dangling boundary portals" affordance highlights these.
		const model = makePair();
		const next = translateSectionRigid(model, 0, { x: 3, y: 0, z: -2 });
		expect(next.sections[0].portals[0].position).toEqual({ x: 13, y: 0, z: 3 });
		expect(next.sections[1].portals[0].position).toEqual({ x: 10, y: 0, z: 5 });
	});

	it('returns the original model reference for a (0, 0, 0) offset (no-op)', () => {
		// Important for byte-for-byte BND2 writeback: a cancelled gesture
		// or a click-without-drag must leave the model exactly identical.
		const model = makePair();
		const next = translateSectionRigid(model, 0, { x: 0, y: 0, z: 0 });
		expect(next).toBe(model);
	});

	it('throws on out-of-range srcIdx', () => {
		const model = makePair();
		expect(() => translateSectionRigid(model, 5, { x: 1, y: 0, z: 0 })).toThrow(RangeError);
		expect(() => translateSectionRigid(model, -1, { x: 1, y: 0, z: 0 })).toThrow(RangeError);
	});

	it('does not mutate the input', () => {
		const model = makePair();
		const before = JSON.stringify(model);
		translateSectionRigid(model, 0, { x: 5, y: 1, z: 5 });
		expect(JSON.stringify(model)).toEqual(before);
	});

	it('shares the unaffected source-section reference when the result is the same model (no-op)', () => {
		// Reinforces the structural-sharing convention: a no-op never copies.
		const model = makePair();
		const result = translateSectionRigid(model, 0, { x: 0, y: 0, z: 0 });
		expect(result.sections[0]).toBe(model.sections[0]);
		expect(result.sections[1]).toBe(model.sections[1]);
	});
});

// =============================================================================
// rotateSectionAroundCentroidYaw (Bulk-transform: rigid yaw rotate)
// =============================================================================
//
// Yaw-only rotate around the section's own corner-centroid (cardinality-1
// pivot per CONTEXT.md / "Pivot"). Pitch/roll are not exposed because AI
// section corners are XZ-packed (per ADR-0011 — the gizmo greys out those
// rings; this op intentionally has no pitch/roll parameter).

describe('rotateSectionAroundCentroidYaw', () => {
	function makeRect(): ParsedAISectionsV12 {
		// 10×10 quad centred at (5, 5).
		const portal: Portal = {
			position: { x: 10, y: 3, z: 5 },
			boundaryLines: [{ verts: { x: 10, y: 0, z: 10, w: 10 } }],
			linkSection: 0,
		};
		const sec = makeSection({
			id: 0xA,
			corners: [
				{ x: 0, y: 0 },
				{ x: 10, y: 0 },
				{ x: 10, y: 10 },
				{ x: 0, y: 10 },
			],
			portals: [portal],
		});
		sec.noGoLines = [{ verts: { x: 2, y: 2, z: 8, w: 8 } }];
		return makeModel([sec]);
	}

	it('returns the original model reference for theta = 0 (identity — byte-for-byte safe)', () => {
		// CRITICAL: a rotate-by-0 gesture must NOT change anything. This is
		// the byte-for-byte BND2 writeback invariant. If this fails, a user
		// clicking the rotate ring without dragging would dirty the bundle.
		const model = makeRect();
		const next = rotateSectionAroundCentroidYaw(model, 0, 0);
		expect(next).toBe(model);
		expect(next.sections[0]).toBe(model.sections[0]);
	});

	it('rotates corners by 90° around the centroid (rigid body)', () => {
		// Centroid of the unit square is (5, 5). Rotate +π/2 (90° yaw).
		// Following the right-hand rule with thumb +Y: +X → +Z, +Z → -X.
		// Corner (0, 0) → centroid offset (-5, -5) → after rot (5, -5) → (10, 0)
		// Corner (10, 0) → offset (5, -5) → after rot (5, 5) → (10, 10)
		// Corner (10, 10) → offset (5, 5) → after rot (-5, 5) → (0, 10)
		// Corner (0, 10) → offset (-5, 5) → after rot (-5, -5) → (0, 0)
		const model = makeRect();
		const next = rotateSectionAroundCentroidYaw(model, 0, Math.PI / 2);
		const corners = next.sections[0].corners;
		expect(corners[0].x).toBeCloseTo(10, 6);
		expect(corners[0].y).toBeCloseTo(0, 6);
		expect(corners[1].x).toBeCloseTo(10, 6);
		expect(corners[1].y).toBeCloseTo(10, 6);
		expect(corners[2].x).toBeCloseTo(0, 6);
		expect(corners[2].y).toBeCloseTo(10, 6);
		expect(corners[3].x).toBeCloseTo(0, 6);
		expect(corners[3].y).toBeCloseTo(0, 6);
	});

	it('preserves relative distances (rigid-body invariant)', () => {
		// Pick an arbitrary, non-cardinal angle so floating-point trig is
		// exercised. Any pair of corners' distance must be identical
		// before and after rotation.
		const model = makeRect();
		const theta = 0.7;
		const next = rotateSectionAroundCentroidYaw(model, 0, theta);
		const before = model.sections[0].corners;
		const after = next.sections[0].corners;
		const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
			Math.hypot(a.x - b.x, a.y - b.y);
		for (let i = 0; i < before.length; i++) {
			for (let j = i + 1; j < before.length; j++) {
				expect(dist(after[i], after[j])).toBeCloseTo(dist(before[i], before[j]), 6);
			}
		}
	});

	it('rotates portal positions on XZ but preserves portal Y', () => {
		const model = makeRect();
		// Portal sat at (10, 3, 5) — centroid offset on XZ is (5, 0). Rotate
		// +π/2: offset becomes (0, 5), so position lands at (5, 3, 10). Y
		// must be untouched (yaw doesn't tip vertically).
		const next = rotateSectionAroundCentroidYaw(model, 0, Math.PI / 2);
		const p = next.sections[0].portals[0].position;
		expect(p.x).toBeCloseTo(5, 6);
		expect(p.y).toBe(3); // exact, untouched
		expect(p.z).toBeCloseTo(10, 6);
	});

	it('rotates portal boundary line endpoints', () => {
		// BL was (10, 0) → (10, 10). Centroid (5, 5).
		// Start offset (5, -5) → after π/2 (5, 5) → (10, 10).
		// End   offset (5, 5)  → after π/2 (-5, 5) → (0, 10).
		const model = makeRect();
		const next = rotateSectionAroundCentroidYaw(model, 0, Math.PI / 2);
		const bl = next.sections[0].portals[0].boundaryLines[0].verts;
		expect(bl.x).toBeCloseTo(10, 6);
		expect(bl.y).toBeCloseTo(10, 6);
		expect(bl.z).toBeCloseTo(0, 6);
		expect(bl.w).toBeCloseTo(10, 6);
	});

	it('rotates noGo line endpoints', () => {
		// NoGo was (2, 2) → (8, 8) — diagonal across the square. Centroid (5, 5).
		// Start offset (-3, -3) → π/2 (3, -3) → (8, 2).
		// End   offset (3, 3)   → π/2 (-3, 3) → (2, 8).
		const model = makeRect();
		const next = rotateSectionAroundCentroidYaw(model, 0, Math.PI / 2);
		const ng = next.sections[0].noGoLines[0].verts;
		expect(ng.x).toBeCloseTo(8, 6);
		expect(ng.y).toBeCloseTo(2, 6);
		expect(ng.z).toBeCloseTo(2, 6);
		expect(ng.w).toBeCloseTo(8, 6);
	});

	it('rotation by 2π equals identity geometry (full revolution returns to start, modulo float epsilon)', () => {
		const model = makeRect();
		const next = rotateSectionAroundCentroidYaw(model, 0, Math.PI * 2);
		const before = model.sections[0].corners;
		const after = next.sections[0].corners;
		for (let i = 0; i < before.length; i++) {
			expect(after[i].x).toBeCloseTo(before[i].x, 5);
			expect(after[i].y).toBeCloseTo(before[i].y, 5);
		}
	});

	it('does not cascade into outside neighbours (ADR-0009)', () => {
		// Same shape as the no-cascade translate test: a paired neighbour
		// stays put even when the source rotates.
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
			corners: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
			portals: [portal0to1],
		});
		const s1 = makeSection({
			id: 0xB,
			corners: [{ x: 10, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }, { x: 10, y: 10 }],
			portals: [portal1to0],
		});
		const model = makeModel([s0, s1]);
		const next = rotateSectionAroundCentroidYaw(model, 0, Math.PI / 4);
		// s1 reference unchanged — proves nothing under it moved.
		expect(next.sections[1]).toBe(model.sections[1]);
	});

	it('throws on out-of-range srcIdx', () => {
		const model = makeRect();
		expect(() => rotateSectionAroundCentroidYaw(model, 5, 1)).toThrow(RangeError);
		expect(() => rotateSectionAroundCentroidYaw(model, -1, 1)).toThrow(RangeError);
	});

	it('does not mutate the input', () => {
		const model = makeRect();
		const before = JSON.stringify(model);
		rotateSectionAroundCentroidYaw(model, 0, 0.5);
		expect(JSON.stringify(model)).toEqual(before);
	});
});

// =============================================================================
// Bulk-transform compose: translate then yaw, in commit order
// =============================================================================
//
// The AISectionsOverlay's gizmo commit composes translate then yaw rotate
// in that order — yaw rotates around the *post-translate* centroid. These
// tests pin the composition shape so the preview and commit paths stay
// in lock-step.

describe('translateSectionRigid + rotateSectionAroundCentroidYaw composition', () => {
	function makeRect(): ParsedAISectionsV12 {
		const sec = makeSection({
			id: 0xA,
			corners: [
				{ x: 0, y: 0 },
				{ x: 10, y: 0 },
				{ x: 10, y: 10 },
				{ x: 0, y: 10 },
			],
			portals: [],
		});
		return makeModel([sec]);
	}

	it('translate then yaw rotates around the post-translate centroid', () => {
		const model = makeRect();
		const t = translateSectionRigid(model, 0, { x: 100, y: 0, z: 200 });
		// Post-translate centroid is (105, 205). Rotate π/2 around it.
		const r = rotateSectionAroundCentroidYaw(t, 0, Math.PI / 2);
		// Pre-translate corner (0,0) → post-translate (100, 200) → centroid
		// offset (-5, -5) → π/2 → (5, -5) → (110, 200).
		expect(r.sections[0].corners[0].x).toBeCloseTo(110, 6);
		expect(r.sections[0].corners[0].y).toBeCloseTo(200, 6);
	});
});

// =============================================================================
// Cascade-modifier ops (issue #75): rotateSectionWithLinksYaw,
// translatePortalAnchorWithMirror, translateSelectionWithLinks,
// rotateSelectionWithLinksYaw
// =============================================================================
//
// These exercise the cascade-on path the gizmo routes through when Shift is
// held at gesture start. Cascade-off is exercised by the existing
// translateSectionRigid + rotateSectionAroundCentroidYaw suite above; this
// suite pins the "outside neighbours follow" semantics.

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

describe('translateSelectionWithLinks', () => {
	// Build a row of 3 sections so we can pick the middle two as a Selection
	// and verify outside neighbours cascade while inside Selection members
	// translate rigid-bodily.
	function makeTrio(): ParsedAISectionsV12 {
		// s0 — leftmost (outside Selection). Its right edge is (10, 0)–(10, 10)
		// shared with s1.
		const s0 = makeSection({
			id: 0xA,
			corners: [
				{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 },
			],
			portals: [{
				position: { x: 10, y: 0, z: 5 },
				boundaryLines: [{ verts: { x: 10, y: 0, z: 10, w: 10 } }],
				linkSection: 1,
			}],
		});
		// s1 — middle. Has a portal to s0 on its left edge AND a portal to
		// s2 on its right edge.
		const s1 = makeSection({
			id: 0xB,
			corners: [
				{ x: 10, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }, { x: 10, y: 10 },
			],
			portals: [
				{
					position: { x: 10, y: 0, z: 5 },
					boundaryLines: [{ verts: { x: 10, y: 10, z: 10, w: 0 } }],
					linkSection: 0,
				},
				{
					position: { x: 20, y: 0, z: 5 },
					boundaryLines: [{ verts: { x: 20, y: 0, z: 20, w: 10 } }],
					linkSection: 2,
				},
			],
		});
		// s2 — rightmost (outside Selection). Its left edge (20, 0)–(20, 10)
		// is shared with s1.
		const s2 = makeSection({
			id: 0xC,
			corners: [
				{ x: 20, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 10 }, { x: 20, y: 10 },
			],
			portals: [{
				position: { x: 20, y: 0, z: 5 },
				boundaryLines: [{ verts: { x: 20, y: 10, z: 20, w: 0 } }],
				linkSection: 1,
			}],
		});
		return makeModel([s0, s1, s2]);
	}

	it('with a single-section Selection, matches translateSectionWithLinks byte-for-byte', () => {
		// Regression: cascade-on single-section translate must produce the
		// exact same model as the legacy `translateSectionWithLinks` op.
		const model = makeTrio();
		const a = translateSelectionWithLinks(model, [1], { x: 3, z: -2 });
		const b = translateSectionWithLinks(model, 1, { x: 3, z: -2 });
		expect(a).toEqual(b);
	});

	it('cascades to outside neighbours but not to inside-Selection members', () => {
		const model = makeTrio();
		// Select s1 alone: cascade should reach s0 AND s2 (both outside).
		const single = translateSelectionWithLinks(model, [1], { x: 5, z: 0 });
		// s0's reverse portal (at 10, 0, 5) should track to (15, 0, 5).
		expect(single.sections[0].portals[0].position).toEqual({ x: 15, y: 0, z: 5 });
		// s2's reverse portal (at 20, 0, 5) should track to (25, 0, 5).
		expect(single.sections[2].portals[0].position).toEqual({ x: 25, y: 0, z: 5 });
	});

	it('a Selection of two adjacent sections moves both inside-rigidly and cascades only to outside neighbours', () => {
		const model = makeTrio();
		// Select s1 and s2: s0 is the only outside neighbour.
		const next = translateSelectionWithLinks(model, [1, 2], { x: 7, z: 0 });
		// s0 (outside): reverse portal cascades — was (10, 0, 5), becomes (17, 0, 5).
		expect(next.sections[0].portals[0].position).toEqual({ x: 17, y: 0, z: 5 });
		// s0 corners that lie on the s0/s1 shared edge (10, 0) and (10, 10)
		// follow the cascade.
		expect(next.sections[0].corners[1]).toEqual({ x: 17, y: 0 });
		expect(next.sections[0].corners[2]).toEqual({ x: 17, y: 10 });
		// s1 (inside): all corners translate by (7, 0).
		expect(next.sections[1].corners[0]).toEqual({ x: 17, y: 0 });
		expect(next.sections[1].corners[1]).toEqual({ x: 27, y: 0 });
		// s2 (inside): all corners translate by (7, 0) — NO double-shift
		// from a cascade into s2 (s1's right-portal points at s2 which is
		// inside-Selection, so cascade is skipped per `selectedSet.has(targetIdx)`).
		expect(next.sections[2].corners[0]).toEqual({ x: 27, y: 0 });
		expect(next.sections[2].corners[1]).toEqual({ x: 37, y: 0 });
	});

	it('cascade-off bulk leaves outside neighbours put (regression vs cascade-on)', () => {
		// Sanity: contrast the cascade-on result with what a rigid bulk would
		// produce. We simulate cascade-off bulk by translating each member
		// rigidly with `translateSectionRigid` and checking outside neighbours
		// are stale.
		const model = makeTrio();
		let off = model;
		off = translateSectionRigid(off, 1, { x: 7, y: 0, z: 0 });
		off = translateSectionRigid(off, 2, { x: 7, y: 0, z: 0 });
		// Cascade-off: s0's reverse portal is now stale at (10, 0, 5) — it
		// still points at the (now-moved) s1 but at the OLD world position.
		expect(off.sections[0].portals[0].position).toEqual({ x: 10, y: 0, z: 5 });

		// Cascade-on: same delta, different outcome — s0's reverse portal
		// follows.
		const on = translateSelectionWithLinks(model, [1, 2], { x: 7, z: 0 });
		expect(on.sections[0].portals[0].position).toEqual({ x: 17, y: 0, z: 5 });
	});

	it('is a no-op for an empty Selection or zero offset', () => {
		const model = makeTrio();
		expect(translateSelectionWithLinks(model, [], { x: 5, z: 5 })).toBe(model);
		expect(translateSelectionWithLinks(model, [0, 1], { x: 0, z: 0 })).toBe(model);
	});

	it('throws on out-of-range index in Selection', () => {
		const model = makeTrio();
		expect(() => translateSelectionWithLinks(model, [0, 99], { x: 1, z: 0 })).toThrow(RangeError);
	});
});

describe('rotateSelectionWithLinksYaw', () => {
	function makePair(): ParsedAISectionsV12 {
		// Same as the rotateSectionWithLinksYaw fixture.
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
			corners: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
			portals: [portal0to1],
		});
		const s1 = makeSection({
			id: 0xB,
			corners: [{ x: 10, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }, { x: 10, y: 10 }],
			portals: [portal1to0],
		});
		return makeModel([s0, s1]);
	}

	it('orbits every selected section around the supplied pivot', () => {
		const model = makePair();
		// Pivot at the s0/s1 shared edge midpoint (10, 5). Rotate π/2.
		const next = rotateSelectionWithLinksYaw(model, [0, 1], { x: 10, z: 5 }, Math.PI / 2);
		// s0 corner (0, 0): offset (-10, -5) → π/2 → (5, -10) → world (15, -5).
		expect(next.sections[0].corners[0].x).toBeCloseTo(15, 6);
		expect(next.sections[0].corners[0].y).toBeCloseTo(-5, 6);
		// s1 corner (20, 0): offset (10, -5) → π/2 → (5, 10) → world (15, 15).
		expect(next.sections[1].corners[1].x).toBeCloseTo(15, 6);
		expect(next.sections[1].corners[1].y).toBeCloseTo(15, 6);
	});

	it('cascades to outside neighbours but not to inside-Selection members', () => {
		// Build a 3-section row, select the middle one, rotate, verify only
		// outside neighbours' reverse portals cascade.
		const s0 = makeSection({
			id: 0xA,
			corners: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
			portals: [{
				position: { x: 10, y: 0, z: 5 },
				boundaryLines: [{ verts: { x: 10, y: 0, z: 10, w: 10 } }],
				linkSection: 1,
			}],
		});
		const s1 = makeSection({
			id: 0xB,
			corners: [{ x: 10, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }, { x: 10, y: 10 }],
			portals: [{
				position: { x: 10, y: 0, z: 5 },
				boundaryLines: [{ verts: { x: 10, y: 10, z: 10, w: 0 } }],
				linkSection: 0,
			}],
		});
		const model = makeModel([s0, s1]);
		// Select s1 alone; rotate around its centroid (15, 5).
		const next = rotateSelectionWithLinksYaw(model, [1], { x: 15, z: 5 }, Math.PI);
		// s0 (outside): reverse portal at (10, 0, 5). Pivot (15, 5), π:
		// offset (-5, 0) → (5, 0) → world (20, 5).
		expect(next.sections[0].portals[0].position.x).toBeCloseTo(20, 6);
		expect(next.sections[0].portals[0].position.z).toBeCloseTo(5, 6);
	});

	it('is a no-op for theta === 0 or an empty Selection', () => {
		const model = makePair();
		expect(rotateSelectionWithLinksYaw(model, [0, 1], { x: 0, z: 0 }, 0)).toBe(model);
		expect(rotateSelectionWithLinksYaw(model, [], { x: 0, z: 0 }, 0.5)).toBe(model);
	});

	it('throws on out-of-range Selection index', () => {
		const model = makePair();
		expect(() => rotateSelectionWithLinksYaw(model, [99], { x: 0, z: 0 }, 0.5)).toThrow(RangeError);
	});
});

// =============================================================================
// Bulk-transform sub-entity ops (issue #73) — no-cascade translate of one
// corner, portal anchor, or line endpoint. The cascade-on path stays in
// `translateCornerWithShared` for the modifier-on slice (#75).
// =============================================================================

describe('translateCornerRigid', () => {
	function makeNeighbourPair(): ParsedAISectionsV12 {
		// Two adjacent unit squares sharing the edge at x=10.
		// Section 0: corners (0,0)→(10,0)→(10,10)→(0,10), corner #1 = (10, 0).
		// Section 1: corners (10,0)→(20,0)→(20,10)→(10,10), corner #0 = (10, 0)
		// — that's the SHARED corner with section 0's corner #1.
		const s0 = makeSection({
			id: 0xA,
			corners: [
				{ x: 0, y: 0 },
				{ x: 10, y: 0 },
				{ x: 10, y: 10 },
				{ x: 0, y: 10 },
			],
			portals: [{
				position: { x: 10, y: 0, z: 5 },
				boundaryLines: [{ verts: { x: 10, y: 0, z: 10, w: 10 } }],
				linkSection: 1,
			}],
		});
		const s1 = makeSection({
			id: 0xB,
			corners: [
				{ x: 10, y: 0 },
				{ x: 20, y: 0 },
				{ x: 20, y: 10 },
				{ x: 10, y: 10 },
			],
		});
		return makeModel([s0, s1]);
	}

	it('moves only the named corner; coincident neighbour corners stay put (no cascade)', () => {
		const model = makeNeighbourPair();
		// Move section 0's corner #1 (at (10, 0)) by (+1, +2). Section 1's
		// corner #0 also lives at (10, 0) (shared corner) but must stay put
		// because the no-cascade op is "tear off" by design (ADR-0009).
		const next = translateCornerRigid(model, 0, 1, { x: 1, z: 2 });
		expect(next.sections[0].corners[1]).toEqual({ x: 11, y: 2 });
		// Other corners on section 0 are untouched.
		expect(next.sections[0].corners[0]).toEqual({ x: 0, y: 0 });
		expect(next.sections[0].corners[2]).toEqual({ x: 10, y: 10 });
		expect(next.sections[0].corners[3]).toEqual({ x: 0, y: 10 });
		// Neighbour section 1 is bit-for-bit unchanged (===-identical).
		expect(next.sections[1]).toBe(model.sections[1]);
	});

	it('does not touch the section\'s portal anchors or boundary lines', () => {
		const model = makeNeighbourPair();
		const next = translateCornerRigid(model, 0, 1, { x: 1, z: 2 });
		expect(next.sections[0].portals[0].position).toEqual({ x: 10, y: 0, z: 5 });
		expect(next.sections[0].portals[0].boundaryLines[0].verts).toEqual({
			x: 10, y: 0, z: 10, w: 10,
		});
	});

	it('returns the original model reference for a (0, 0) offset (no-op — byte-for-byte safe)', () => {
		const model = makeNeighbourPair();
		const next = translateCornerRigid(model, 0, 1, { x: 0, z: 0 });
		expect(next).toBe(model);
	});

	it('throws on out-of-range srcIdx or cornerIdx', () => {
		const model = makeNeighbourPair();
		expect(() => translateCornerRigid(model, 5, 0, { x: 1, z: 0 })).toThrow(RangeError);
		expect(() => translateCornerRigid(model, -1, 0, { x: 1, z: 0 })).toThrow(RangeError);
		expect(() => translateCornerRigid(model, 0, 4, { x: 1, z: 0 })).toThrow(RangeError);
		expect(() => translateCornerRigid(model, 0, -1, { x: 1, z: 0 })).toThrow(RangeError);
	});

	it('does not mutate the input', () => {
		const model = makeNeighbourPair();
		const before = JSON.stringify(model);
		translateCornerRigid(model, 0, 1, { x: 5, z: 7 });
		expect(JSON.stringify(model)).toEqual(before);
	});

	it('undo round-trip: applying the inverse offset restores the original corner', () => {
		const model = makeNeighbourPair();
		const forward = translateCornerRigid(model, 0, 1, { x: 3, z: 5 });
		const back = translateCornerRigid(forward, 0, 1, { x: -3, z: -5 });
		// Deep-equal on the corner — we don't get ===-identity back because the
		// section is rebuilt; but every Vector2 lands exactly where it started.
		expect(back.sections[0].corners).toEqual(model.sections[0].corners);
	});
});

describe('translatePortalAnchorRigid', () => {
	function makeLinkedPair(): ParsedAISectionsV12 {
		// Two sections that share a portal anchor at the same world position
		// (typical state after duplicateSectionThroughEdge). The reverse
		// portal on section 1 has linkSection = 0 and matching position.
		const portal0to1: Portal = {
			position: { x: 10, y: 5, z: 5 },
			boundaryLines: [{ verts: { x: 10, y: 0, z: 10, w: 10 } }],
			linkSection: 1,
		};
		const portal1to0: Portal = {
			position: { x: 10, y: 5, z: 5 },
			boundaryLines: [{ verts: { x: 10, y: 10, z: 10, w: 0 } }],
			linkSection: 0,
		};
		const s0 = makeSection({ id: 0xA, portals: [portal0to1] });
		const s1 = makeSection({ id: 0xB, portals: [portal1to0] });
		return makeModel([s0, s1]);
	}

	it('moves only the named portal anchor; the mirror anchor stays put (stale by design — ADR-0009)', () => {
		const model = makeLinkedPair();
		const next = translatePortalAnchorRigid(model, 0, 0, { x: 3, y: 2, z: -4 });
		// Source portal anchor moved by full XYZ delta.
		expect(next.sections[0].portals[0].position).toEqual({ x: 13, y: 7, z: 1 });
		// Mirror portal on the neighbour stays at the old position — this is
		// the "stale mirror" state ADR-0009 accepts as the v1 default.
		expect(next.sections[1].portals[0].position).toEqual({ x: 10, y: 5, z: 5 });
		// Neighbour section is ===-identical.
		expect(next.sections[1]).toBe(model.sections[1]);
	});

	it('does not touch the portal\'s boundary lines or the source section\'s corners', () => {
		const model = makeLinkedPair();
		const next = translatePortalAnchorRigid(model, 0, 0, { x: 3, y: 2, z: -4 });
		// Boundary lines unchanged — only `position` shifted.
		expect(next.sections[0].portals[0].boundaryLines[0].verts).toEqual({
			x: 10, y: 0, z: 10, w: 10,
		});
		expect(next.sections[0].corners).toEqual(model.sections[0].corners);
	});

	it('returns the original model reference for an identity offset (no-op)', () => {
		const model = makeLinkedPair();
		expect(translatePortalAnchorRigid(model, 0, 0, { x: 0, y: 0, z: 0 })).toBe(model);
	});

	it('throws on out-of-range srcIdx or portalIdx', () => {
		const model = makeLinkedPair();
		expect(() => translatePortalAnchorRigid(model, 5, 0, { x: 1, y: 0, z: 0 })).toThrow(RangeError);
		expect(() => translatePortalAnchorRigid(model, -1, 0, { x: 1, y: 0, z: 0 })).toThrow(RangeError);
		expect(() => translatePortalAnchorRigid(model, 0, 5, { x: 1, y: 0, z: 0 })).toThrow(RangeError);
		expect(() => translatePortalAnchorRigid(model, 0, -1, { x: 1, y: 0, z: 0 })).toThrow(RangeError);
	});

	it('does not mutate the input', () => {
		const model = makeLinkedPair();
		const before = JSON.stringify(model);
		translatePortalAnchorRigid(model, 0, 0, { x: 7, y: 3, z: 2 });
		expect(JSON.stringify(model)).toEqual(before);
	});

	it('undo round-trip: inverse offset restores the original anchor', () => {
		const model = makeLinkedPair();
		const forward = translatePortalAnchorRigid(model, 0, 0, { x: 3, y: 2, z: -4 });
		const back = translatePortalAnchorRigid(forward, 0, 0, { x: -3, y: -2, z: 4 });
		expect(back.sections[0].portals[0].position).toEqual(
			model.sections[0].portals[0].position,
		);
	});
});

describe('translateBoundaryLineEndpointRigid', () => {
	function makeWithBoundary(): ParsedAISectionsV12 {
		const portal: Portal = {
			position: { x: 5, y: 3, z: 5 },
			boundaryLines: [{ verts: { x: 0, y: 0, z: 10, w: 0 } }], // start (0,0), end (10,0)
			linkSection: 0,
		};
		const sec = makeSection({ id: 0xA, portals: [portal] });
		return makeModel([sec]);
	}

	it('moves only the start endpoint (endIdx=0); end stays put', () => {
		const model = makeWithBoundary();
		const next = translateBoundaryLineEndpointRigid(model, 0, 0, 0, 0, { x: 1, z: 2 });
		// Start (verts.x, verts.y) moved by (+1, +2); end (verts.z, verts.w) unchanged.
		expect(next.sections[0].portals[0].boundaryLines[0].verts).toEqual({
			x: 1, y: 2, z: 10, w: 0,
		});
	});

	it('moves only the end endpoint (endIdx=1); start stays put', () => {
		const model = makeWithBoundary();
		const next = translateBoundaryLineEndpointRigid(model, 0, 0, 0, 1, { x: 3, z: -1 });
		expect(next.sections[0].portals[0].boundaryLines[0].verts).toEqual({
			x: 0, y: 0, z: 13, w: -1,
		});
	});

	it('does not touch the portal anchor or section corners', () => {
		const model = makeWithBoundary();
		const next = translateBoundaryLineEndpointRigid(model, 0, 0, 0, 0, { x: 1, z: 2 });
		expect(next.sections[0].portals[0].position).toEqual(
			model.sections[0].portals[0].position,
		);
		expect(next.sections[0].corners).toEqual(model.sections[0].corners);
	});

	it('returns the original model reference for a (0, 0) offset (no-op)', () => {
		const model = makeWithBoundary();
		expect(translateBoundaryLineEndpointRigid(model, 0, 0, 0, 0, { x: 0, z: 0 })).toBe(model);
	});

	it('throws on out-of-range indices or endIdx not in {0, 1}', () => {
		const model = makeWithBoundary();
		expect(() => translateBoundaryLineEndpointRigid(model, 5, 0, 0, 0, { x: 1, z: 0 })).toThrow(RangeError);
		expect(() => translateBoundaryLineEndpointRigid(model, 0, 5, 0, 0, { x: 1, z: 0 })).toThrow(RangeError);
		expect(() => translateBoundaryLineEndpointRigid(model, 0, 0, 5, 0, { x: 1, z: 0 })).toThrow(RangeError);
		expect(() => translateBoundaryLineEndpointRigid(model, 0, 0, 0, 2, { x: 1, z: 0 })).toThrow(RangeError);
		expect(() => translateBoundaryLineEndpointRigid(model, 0, 0, 0, -1, { x: 1, z: 0 })).toThrow(RangeError);
	});

	it('does not mutate the input', () => {
		const model = makeWithBoundary();
		const before = JSON.stringify(model);
		translateBoundaryLineEndpointRigid(model, 0, 0, 0, 0, { x: 5, z: 7 });
		expect(JSON.stringify(model)).toEqual(before);
	});

	it('undo round-trip: inverse offset restores the original endpoint', () => {
		const model = makeWithBoundary();
		const forward = translateBoundaryLineEndpointRigid(model, 0, 0, 0, 1, { x: 3, z: -4 });
		const back = translateBoundaryLineEndpointRigid(forward, 0, 0, 0, 1, { x: -3, z: 4 });
		expect(back.sections[0].portals[0].boundaryLines[0].verts).toEqual(
			model.sections[0].portals[0].boundaryLines[0].verts,
		);
	});
});

describe('translateNoGoLineEndpointRigid', () => {
	function makeWithNoGo(): ParsedAISectionsV12 {
		const sec = makeSection({ id: 0xA });
		sec.noGoLines = [{ verts: { x: 0, y: 0, z: 5, w: 5 } }];
		return makeModel([sec]);
	}

	it('moves only the start endpoint (endIdx=0); end stays put', () => {
		const model = makeWithNoGo();
		const next = translateNoGoLineEndpointRigid(model, 0, 0, 0, { x: 2, z: 3 });
		expect(next.sections[0].noGoLines[0].verts).toEqual({ x: 2, y: 3, z: 5, w: 5 });
	});

	it('moves only the end endpoint (endIdx=1); start stays put', () => {
		const model = makeWithNoGo();
		const next = translateNoGoLineEndpointRigid(model, 0, 0, 1, { x: -1, z: -2 });
		expect(next.sections[0].noGoLines[0].verts).toEqual({ x: 0, y: 0, z: 4, w: 3 });
	});

	it('does not touch corners or portals', () => {
		const portal: Portal = {
			position: { x: 1, y: 0, z: 1 },
			boundaryLines: [{ verts: { x: 1, y: 1, z: 2, w: 2 } }],
			linkSection: 0,
		};
		const sec = makeSection({ id: 0xA, portals: [portal] });
		sec.noGoLines = [{ verts: { x: 0, y: 0, z: 5, w: 5 } }];
		const model = makeModel([sec]);
		const next = translateNoGoLineEndpointRigid(model, 0, 0, 0, { x: 2, z: 3 });
		expect(next.sections[0].corners).toEqual(model.sections[0].corners);
		expect(next.sections[0].portals).toEqual(model.sections[0].portals);
	});

	it('returns the original model reference for a (0, 0) offset (no-op)', () => {
		const model = makeWithNoGo();
		expect(translateNoGoLineEndpointRigid(model, 0, 0, 0, { x: 0, z: 0 })).toBe(model);
	});

	it('throws on out-of-range indices or endIdx not in {0, 1}', () => {
		const model = makeWithNoGo();
		expect(() => translateNoGoLineEndpointRigid(model, 5, 0, 0, { x: 1, z: 0 })).toThrow(RangeError);
		expect(() => translateNoGoLineEndpointRigid(model, -1, 0, 0, { x: 1, z: 0 })).toThrow(RangeError);
		expect(() => translateNoGoLineEndpointRigid(model, 0, 5, 0, { x: 1, z: 0 })).toThrow(RangeError);
		expect(() => translateNoGoLineEndpointRigid(model, 0, 0, 2, { x: 1, z: 0 })).toThrow(RangeError);
		expect(() => translateNoGoLineEndpointRigid(model, 0, 0, -1, { x: 1, z: 0 })).toThrow(RangeError);
	});

	it('does not mutate the input', () => {
		const model = makeWithNoGo();
		const before = JSON.stringify(model);
		translateNoGoLineEndpointRigid(model, 0, 0, 0, { x: 5, z: 7 });
		expect(JSON.stringify(model)).toEqual(before);
	});

	it('undo round-trip: inverse offset restores the original endpoint', () => {
		const model = makeWithNoGo();
		const forward = translateNoGoLineEndpointRigid(model, 0, 0, 0, { x: 4, z: -2 });
		const back = translateNoGoLineEndpointRigid(forward, 0, 0, 0, { x: -4, z: 2 });
		expect(back.sections[0].noGoLines[0].verts).toEqual(
			model.sections[0].noGoLines[0].verts,
		);
	});
});

// =============================================================================
// Multi-Selection bulk transform (issue #74)
// =============================================================================
//
// The single-entity ops above handle cardinality-1 selections; the bulk ops
// below handle cardinality ≥ 2. Every selected entity orbits the single bulk
// pivot (rigid-body interpretation): relative distances within the bulk are
// preserved; outside neighbours are completely untouched (ADR-0009).

describe('bulkSelectionPivot', () => {
	function makeTwoSections(): ParsedAISectionsV12 {
		// Two non-overlapping squares: s0 at (0..10, 0..10), s1 at (20..30, 20..30).
		const s0 = makeSection({
			id: 0xA,
			corners: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
		});
		const s1 = makeSection({
			id: 0xB,
			corners: [{ x: 20, y: 20 }, { x: 30, y: 20 }, { x: 30, y: 30 }, { x: 20, y: 30 }],
		});
		return makeModel([s0, s1]);
	}

	const ySource = () => 0;

	it('returns null for an empty refs list', () => {
		const model = makeTwoSections();
		expect(bulkSelectionPivot(model, [], ySource)).toBeNull();
	});

	it('uses the median of every corner across whole-section refs', () => {
		const model = makeTwoSections();
		// s0 contributes (0,0,0), (10,0,0), (10,0,10), (0,0,10).
		// s1 contributes (20,0,20), (30,0,20), (30,0,30), (20,0,30).
		// 8 points. Median X (sorted): 0,0,10,10,20,20,30,30 → (10+20)/2 = 15.
		// Median Z (sorted): 0,0,10,10,20,20,30,30 → 15.
		const refs: AISectionEntityRef[] = [
			{ kind: 'section', sectionIdx: 0 },
			{ kind: 'section', sectionIdx: 1 },
		];
		const pivot = bulkSelectionPivot(model, refs, ySource);
		expect(pivot).not.toBeNull();
		expect(pivot!.x).toBeCloseTo(15, 6);
		expect(pivot!.z).toBeCloseTo(15, 6);
	});

	it('contributes a portal anchor for a portal ref (3D position included)', () => {
		const portal: Portal = {
			position: { x: 5, y: 7, z: 5 },
			boundaryLines: [],
			linkSection: 0,
		};
		const sec = makeSection({ portals: [portal] });
		const model = makeModel([sec]);
		const pivot = bulkSelectionPivot(
			model,
			[{ kind: 'portal', sectionIdx: 0, portalIdx: 0 }],
			ySource,
		);
		expect(pivot).toEqual({ x: 5, y: 7, z: 5 });
	});

	it('contributes one endpoint per boundaryLineEndpoint ref', () => {
		const portal: Portal = {
			position: { x: 0, y: 0, z: 0 },
			boundaryLines: [{ verts: { x: 1, y: 2, z: 3, w: 4 } }],
			linkSection: 0,
		};
		const sec = makeSection({ portals: [portal] });
		const model = makeModel([sec]);
		const refs: AISectionEntityRef[] = [
			{ kind: 'boundaryLineEndpoint', sectionIdx: 0, portalIdx: 0, lineIdx: 0, end: 0 },
		];
		expect(bulkSelectionPivot(model, refs, ySource)).toEqual({ x: 1, y: 0, z: 2 });
	});

	it('drops refs pointing at out-of-range entities', () => {
		const model = makeTwoSections();
		const refs: AISectionEntityRef[] = [
			{ kind: 'section', sectionIdx: 99 },
			{ kind: 'section', sectionIdx: 0 },
		];
		// Only s0's corners count. Median X over [0,10,10,0] is 5; same for Z.
		const pivot = bulkSelectionPivot(model, refs, ySource);
		expect(pivot!.x).toBeCloseTo(5, 6);
		expect(pivot!.z).toBeCloseTo(5, 6);
	});
});

describe('bulkTranslateEntities', () => {
	function makeFour(): ParsedAISectionsV12 {
		// Four sections in a 2×2 grid, each 10×10 unit square.
		const mk = (cx: number, cz: number, id: number): AISection =>
			makeSection({
				id,
				corners: [
					{ x: cx, y: cz },
					{ x: cx + 10, y: cz },
					{ x: cx + 10, y: cz + 10 },
					{ x: cx, y: cz + 10 },
				],
			});
		return makeModel([
			mk(0, 0, 0xA),
			mk(20, 0, 0xB),
			mk(0, 20, 0xC),
			mk(20, 20, 0xD),
		]);
	}

	it('moves every selected section by the same (dx, dy, dz)', () => {
		const model = makeFour();
		const refs: AISectionEntityRef[] = [
			{ kind: 'section', sectionIdx: 0 },
			{ kind: 'section', sectionIdx: 1 },
		];
		const next = bulkTranslateEntities(model, refs, { x: 100, y: 0, z: 50 });
		// s0 corners: (100, 50), (110, 50), (110, 60), (100, 60)
		expect(next.sections[0].corners).toEqual([
			{ x: 100, y: 50 },
			{ x: 110, y: 50 },
			{ x: 110, y: 60 },
			{ x: 100, y: 60 },
		]);
		// s1 corners: (120, 50), (130, 50), (130, 60), (120, 60)
		expect(next.sections[1].corners).toEqual([
			{ x: 120, y: 50 },
			{ x: 130, y: 50 },
			{ x: 130, y: 60 },
			{ x: 120, y: 60 },
		]);
	});

	it('leaves outside neighbours completely put (no cascade — ADR-0009)', () => {
		const model = makeFour();
		const refs: AISectionEntityRef[] = [
			{ kind: 'section', sectionIdx: 0 },
			{ kind: 'section', sectionIdx: 1 },
		];
		const next = bulkTranslateEntities(model, refs, { x: 5, y: 0, z: 0 });
		// s2 and s3 not in the refs list → reference-equal to source.
		expect(next.sections[2]).toBe(model.sections[2]);
		expect(next.sections[3]).toBe(model.sections[3]);
	});

	it('returns the original model on a zero offset (no-op identity safe)', () => {
		const model = makeFour();
		const refs: AISectionEntityRef[] = [{ kind: 'section', sectionIdx: 0 }];
		expect(bulkTranslateEntities(model, refs, { x: 0, y: 0, z: 0 })).toBe(model);
	});

	it('returns the original model on an empty refs list', () => {
		const model = makeFour();
		expect(bulkTranslateEntities(model, [], { x: 5, y: 0, z: 0 })).toBe(model);
	});

	it('translates the whole-section bulk — corners, portals, BLs, noGo lines', () => {
		const portal: Portal = {
			position: { x: 5, y: 3, z: 5 },
			boundaryLines: [{ verts: { x: 0, y: 0, z: 10, w: 0 } }],
			linkSection: 0,
		};
		const sec = makeSection({ portals: [portal] });
		sec.noGoLines = [{ verts: { x: 1, y: 1, z: 9, w: 9 } }];
		const model = makeModel([sec]);
		const next = bulkTranslateEntities(
			model,
			[{ kind: 'section', sectionIdx: 0 }],
			{ x: 7, y: 2, z: -3 },
		);
		// Portal Y picks up dy (Vector3 — full 3D).
		expect(next.sections[0].portals[0].position).toEqual({ x: 12, y: 5, z: 2 });
		// Portal BL is XZ-packed — only x/z apply.
		expect(next.sections[0].portals[0].boundaryLines[0].verts).toEqual({ x: 7, y: -3, z: 17, w: -3 });
		// No-go line is XZ-packed.
		expect(next.sections[0].noGoLines[0].verts).toEqual({ x: 8, y: -2, z: 16, w: 6 });
	});

	it('mixed refs (whole section + portal + boundary endpoint): each entity moves correctly', () => {
		// Section 0 is a whole-section ref. Section 1 has only a portal anchor
		// in the bulk. Section 2 has only a single boundary line endpoint in
		// the bulk. Every other field on s1 / s2 must stay structurally
		// identical so unaffected geometry is shared by reference.
		const s0 = makeSection({
			id: 0xA,
			corners: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
		});
		const s1Portal: Portal = {
			position: { x: 50, y: 0, z: 50 },
			boundaryLines: [{ verts: { x: 49, y: 49, z: 51, w: 51 } }],
			linkSection: 0,
		};
		const s1 = makeSection({
			id: 0xB,
			corners: [{ x: 40, y: 40 }, { x: 60, y: 40 }, { x: 60, y: 60 }, { x: 40, y: 60 }],
			portals: [s1Portal],
		});
		const s2Portal: Portal = {
			position: { x: 100, y: 0, z: 100 },
			boundaryLines: [{ verts: { x: 99, y: 99, z: 101, w: 101 } }],
			linkSection: 0,
		};
		const s2 = makeSection({
			id: 0xC,
			corners: [{ x: 90, y: 90 }, { x: 110, y: 90 }, { x: 110, y: 110 }, { x: 90, y: 110 }],
			portals: [s2Portal],
		});
		const model = makeModel([s0, s1, s2]);
		const refs: AISectionEntityRef[] = [
			{ kind: 'section', sectionIdx: 0 },
			{ kind: 'portal', sectionIdx: 1, portalIdx: 0 },
			{ kind: 'boundaryLineEndpoint', sectionIdx: 2, portalIdx: 0, lineIdx: 0, end: 0 },
		];
		const next = bulkTranslateEntities(model, refs, { x: 1, y: 0, z: 2 });

		// s0 whole-section moved.
		expect(next.sections[0].corners[0]).toEqual({ x: 1, y: 2 });
		// s1 portal anchor shifted, corners unchanged.
		expect(next.sections[1].portals[0].position).toEqual({ x: 51, y: 0, z: 52 });
		expect(next.sections[1].corners).toBe(model.sections[1].corners);
		// s1's portal BL stays put (not in refs).
		expect(next.sections[1].portals[0].boundaryLines[0].verts).toBe(model.sections[1].portals[0].boundaryLines[0].verts);
		// s2 boundary endpoint 0 (start) moved; end stays.
		const bl = next.sections[2].portals[0].boundaryLines[0].verts;
		expect(bl.x).toBe(100);
		expect(bl.y).toBe(101);
		expect(bl.z).toBe(101);
		expect(bl.w).toBe(101);
		// s2 corners unchanged.
		expect(next.sections[2].corners).toBe(model.sections[2].corners);
	});

	it('does not mutate the input', () => {
		const model = makeFour();
		const before = JSON.stringify(model);
		bulkTranslateEntities(model, [{ kind: 'section', sectionIdx: 0 }], { x: 9, y: 1, z: 9 });
		expect(JSON.stringify(model)).toEqual(before);
	});
});

describe('bulkRotateEntitiesYaw', () => {
	function makeTwoOffset(): ParsedAISectionsV12 {
		// Two 10×10 squares, s0 at (0..10) and s1 at (20..30) on the X axis.
		// Bulk pivot if we select both = median X (10,10,10,10,20,20,20,20 → 15)
		// and median Z (0,0,10,10,0,0,10,10 → 5). So pivot = (15, 5).
		const s0 = makeSection({
			id: 0xA,
			corners: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
		});
		const s1 = makeSection({
			id: 0xB,
			corners: [{ x: 20, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 10 }, { x: 20, y: 10 }],
		});
		return makeModel([s0, s1]);
	}

	it('returns the original model on theta = 0 (byte-for-byte safe identity)', () => {
		const model = makeTwoOffset();
		const refs: AISectionEntityRef[] = [
			{ kind: 'section', sectionIdx: 0 },
			{ kind: 'section', sectionIdx: 1 },
		];
		expect(bulkRotateEntitiesYaw(model, refs, { x: 15, z: 5 }, 0)).toBe(model);
	});

	it('returns the original model on an empty refs list', () => {
		const model = makeTwoOffset();
		expect(bulkRotateEntitiesYaw(model, [], { x: 15, z: 5 }, 0.5)).toBe(model);
	});

	it('rotates corners by 90° around the single bulk pivot (rigid body)', () => {
		// Pivot = (15, 5). For 90° yaw (right-hand-rule around +Y, +X → +Z):
		// Section 0 corner (0,0)  → offset (-15,-5)  → rot (5,-15)  → (20,-10)
		// Section 0 corner (10,0) → offset (-5,-5)   → rot (5,-5)   → (20, 0)
		// Section 1 corner (20,0) → offset (5,-5)    → rot (5, 5)   → (20, 10)
		// Section 1 corner (30,0) → offset (15,-5)   → rot (5,15)   → (20, 20)
		const model = makeTwoOffset();
		const refs: AISectionEntityRef[] = [
			{ kind: 'section', sectionIdx: 0 },
			{ kind: 'section', sectionIdx: 1 },
		];
		const next = bulkRotateEntitiesYaw(model, refs, { x: 15, z: 5 }, Math.PI / 2);
		expect(next.sections[0].corners[0].x).toBeCloseTo(20, 6);
		expect(next.sections[0].corners[0].y).toBeCloseTo(-10, 6);
		expect(next.sections[0].corners[1].x).toBeCloseTo(20, 6);
		expect(next.sections[0].corners[1].y).toBeCloseTo(0, 6);
		expect(next.sections[1].corners[0].x).toBeCloseTo(20, 6);
		expect(next.sections[1].corners[0].y).toBeCloseTo(10, 6);
		expect(next.sections[1].corners[1].x).toBeCloseTo(20, 6);
		expect(next.sections[1].corners[1].y).toBeCloseTo(20, 6);
	});

	it('preserves all pairwise distances inside the bulk (rigid-body invariant)', () => {
		// Sample many pairs across both sections and check distances survive
		// an arbitrary, non-cardinal yaw. This is the load-bearing rigid-body
		// invariant — if any pair's distance changes, the bulk wasn't treated
		// as a single rigid body.
		const model = makeTwoOffset();
		const refs: AISectionEntityRef[] = [
			{ kind: 'section', sectionIdx: 0 },
			{ kind: 'section', sectionIdx: 1 },
		];
		const theta = 0.4123;
		const next = bulkRotateEntitiesYaw(model, refs, { x: 15, z: 5 }, theta);
		const before: Vector2[] = [];
		const after: Vector2[] = [];
		for (let i = 0; i < model.sections.length; i++) {
			for (const c of model.sections[i].corners) before.push(c);
			for (const c of next.sections[i].corners) after.push(c);
		}
		const dist = (a: Vector2, b: Vector2) => Math.hypot(a.x - b.x, a.y - b.y);
		for (let i = 0; i < before.length; i++) {
			for (let j = i + 1; j < before.length; j++) {
				expect(dist(after[i], after[j])).toBeCloseTo(dist(before[i], before[j]), 5);
			}
		}
	});

	it('leaves outside neighbours completely put (no cascade — ADR-0009)', () => {
		const s0 = makeSection({
			id: 0xA,
			corners: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
		});
		const s1 = makeSection({
			id: 0xB,
			corners: [{ x: 100, y: 100 }, { x: 110, y: 100 }, { x: 110, y: 110 }, { x: 100, y: 110 }],
		});
		const model = makeModel([s0, s1]);
		const next = bulkRotateEntitiesYaw(
			model,
			[{ kind: 'section', sectionIdx: 0 }],
			{ x: 5, z: 5 },
			Math.PI / 3,
		);
		// s1 reference unchanged → its geometry is untouched even though s0 rotated.
		expect(next.sections[1]).toBe(model.sections[1]);
	});

	it('rotates portal positions on XZ but preserves portal Y (yaw is XZ-only)', () => {
		const portal: Portal = {
			position: { x: 30, y: 12, z: 5 },
			boundaryLines: [],
			linkSection: 0,
		};
		const sec = makeSection({
			id: 0xA,
			corners: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
			portals: [portal],
		});
		const model = makeModel([sec]);
		// Pivot at (5, 5). For 90°: portal (30,12,5) → offset (25,0) → rot (0,25) → (5,12,30).
		const next = bulkRotateEntitiesYaw(
			model,
			[{ kind: 'section', sectionIdx: 0 }],
			{ x: 5, z: 5 },
			Math.PI / 2,
		);
		expect(next.sections[0].portals[0].position.x).toBeCloseTo(5, 6);
		expect(next.sections[0].portals[0].position.y).toBe(12); // untouched
		expect(next.sections[0].portals[0].position.z).toBeCloseTo(30, 6);
	});

	it('rotates only a portal anchor when only that sub-entity is in the bulk', () => {
		const portal: Portal = {
			position: { x: 30, y: 0, z: 5 },
			boundaryLines: [{ verts: { x: 25, y: 4, z: 35, w: 6 } }],
			linkSection: 0,
		};
		const sec = makeSection({
			id: 0xA,
			corners: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
			portals: [portal],
		});
		const model = makeModel([sec]);
		const next = bulkRotateEntitiesYaw(
			model,
			[{ kind: 'portal', sectionIdx: 0, portalIdx: 0 }],
			{ x: 30, z: 5 },
			Math.PI / 2,
		);
		// Portal sits AT the pivot — rotation has no effect on position.
		expect(next.sections[0].portals[0].position.x).toBeCloseTo(30, 6);
		expect(next.sections[0].portals[0].position.z).toBeCloseTo(5, 6);
		// Corners stay untouched (whole-section ref not in the bulk).
		expect(next.sections[0].corners).toBe(model.sections[0].corners);
		// BL stays untouched (its endpoint refs not in the bulk).
		expect(next.sections[0].portals[0].boundaryLines[0].verts).toBe(model.sections[0].portals[0].boundaryLines[0].verts);
	});

	it('does not mutate the input', () => {
		const model = makeTwoOffset();
		const before = JSON.stringify(model);
		bulkRotateEntitiesYaw(
			model,
			[{ kind: 'section', sectionIdx: 0 }, { kind: 'section', sectionIdx: 1 }],
			{ x: 15, z: 5 },
			0.7,
		);
		expect(JSON.stringify(model)).toEqual(before);
	});

	it('rotation by 2π is the identity geometry (modulo float epsilon)', () => {
		const model = makeTwoOffset();
		const refs: AISectionEntityRef[] = [
			{ kind: 'section', sectionIdx: 0 },
			{ kind: 'section', sectionIdx: 1 },
		];
		const next = bulkRotateEntitiesYaw(model, refs, { x: 15, z: 5 }, Math.PI * 2);
		for (let i = 0; i < model.sections.length; i++) {
			for (let j = 0; j < model.sections[i].corners.length; j++) {
				expect(next.sections[i].corners[j].x).toBeCloseTo(model.sections[i].corners[j].x, 5);
				expect(next.sections[i].corners[j].y).toBeCloseTo(model.sections[i].corners[j].y, 5);
			}
		}
	});
});

describe('bulkAISectionsAxes', () => {
	it('returns null for an empty refs list', () => {
		expect(bulkAISectionsAxes([])).toBeNull();
	});

	it('reports yaw-only axes for an all-section bulk (ADR-0011: XZ-packed)', () => {
		const axes = bulkAISectionsAxes([
			{ kind: 'section', sectionIdx: 0 },
			{ kind: 'section', sectionIdx: 1 },
		]);
		expect(axes).toEqual({
			translate: { x: true, y: true, z: true },
			rotate: { x: false, y: true, z: false },
		});
	});

	it('reports yaw-only axes for a mixed bulk that includes XZ-packed entities', () => {
		// Every entity kind in this bulk has an XZ-packed family member, so
		// the intersection is yaw-only. Translates remain full 3D.
		const axes = bulkAISectionsAxes([
			{ kind: 'section', sectionIdx: 0 },
			{ kind: 'portal', sectionIdx: 1, portalIdx: 0 },
			{ kind: 'boundaryLineEndpoint', sectionIdx: 2, portalIdx: 0, lineIdx: 0, end: 0 },
		]);
		expect(axes!.rotate.x).toBe(false);
		expect(axes!.rotate.y).toBe(true);
		expect(axes!.rotate.z).toBe(false);
	});
});

// =============================================================================
// Bulk-transform composition + commit-on-release contract (issue #74)
// =============================================================================
//
// The overlay composes translate + yaw rotate in its commit handler — these
// tests pin the composition shape so a future refactor doesn't accidentally
// rotate around the pre-translate pivot (which would precess the rigid body
// instead of orbiting it cleanly).

describe('bulkTranslateEntities + bulkRotateEntitiesYaw composition', () => {
	it('translate then rotate around the post-translate pivot keeps the bulk rigid', () => {
		const s0 = makeSection({
			id: 0xA,
			corners: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
		});
		const s1 = makeSection({
			id: 0xB,
			corners: [{ x: 20, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 10 }, { x: 20, y: 10 }],
		});
		const model = makeModel([s0, s1]);
		const refs: AISectionEntityRef[] = [
			{ kind: 'section', sectionIdx: 0 },
			{ kind: 'section', sectionIdx: 1 },
		];
		// Initial pivot (15, 5) ⇒ after translate by (100, 0, 200), pivot is
		// (115, 205). Rotate 90° around it.
		const t = bulkTranslateEntities(model, refs, { x: 100, y: 0, z: 200 });
		const r = bulkRotateEntitiesYaw(t, refs, { x: 115, z: 205 }, Math.PI / 2);
		// Pre-translate corner (0,0) → post-translate (100, 200) → offset
		// from pivot (-15, -5) → 90° → (5, -15) → (120, 190).
		expect(r.sections[0].corners[0].x).toBeCloseTo(120, 6);
		expect(r.sections[0].corners[0].y).toBeCloseTo(190, 6);
		// Distances inside the bulk are preserved.
		const before = model.sections[0].corners[0];
		const before2 = model.sections[1].corners[0];
		const after = r.sections[0].corners[0];
		const after2 = r.sections[1].corners[0];
		const distBefore = Math.hypot(before.x - before2.x, before.y - before2.y);
		const distAfter = Math.hypot(after.x - after2.x, after.y - after2.y);
		expect(distAfter).toBeCloseTo(distBefore, 5);
	});
});
