// Unit tests for duplicateSectionThroughEdge.
//
// Pure-model tests — no fixtures, no React, no IO. We hand-build a tiny
// `ParsedAISections` and check the geometry / portal wiring of the result.

import { describe, it, expect } from 'vitest';
import { deleteSection, duplicateSectionThroughEdge } from './aiSectionsOps';
import {
	AI_SECTIONS_VERSION,
	EResetSpeedType,
	SectionSpeed,
	type AISection,
	type ParsedAISections,
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

function makeModel(sections: AISection[]): ParsedAISections {
	return {
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
		const model: ParsedAISections = {
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
		const model: ParsedAISections = {
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
		const model: ParsedAISections = {
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

	it('round-trip: duplicate then delete restores the model', () => {
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
