// Unit tests for multi-Selection Bulk-transform ops:
//
//   - translateSelectionWithLinks / rotateSelectionWithLinksYaw — cascade-on
//     multi-section selection (issue #75)
//   - bulkSelectionPivot / bulkTranslateEntities / bulkRotateEntitiesYaw /
//     bulkAISectionsAxes — multi-Selection rigid transform (issue #74)
//   - bulkTranslate + bulkRotate composition (commit-order pinning)
//
// Imports come from the directory barrel so we exercise the same public
// surface every downstream caller hits.

import { describe, it, expect } from 'vitest';
import {
	bulkAISectionsAxes,
	bulkRotateEntitiesYaw,
	bulkSelectionPivot,
	bulkTranslateEntities,
	rotateSelectionWithLinksYaw,
	translateSectionRigid,
	translateSectionWithLinks,
	translateSelectionWithLinks,
	type AISectionEntityRef,
} from '../aiSectionsOps';
import {
	type AISection,
	type ParsedAISectionsV12,
	type Portal,
	type Vector2,
} from '../aiSections';
import { makeModel, makeSection } from './_testHelpers';

// =============================================================================
// Cascade-modifier ops (issue #75): translateSelectionWithLinks,
// rotateSelectionWithLinksYaw
// =============================================================================
//
// These exercise the cascade-on path the gizmo routes through when Shift is
// held at gesture start. Cascade-off is exercised by the existing
// translateSectionRigid + rotateSectionAroundCentroidYaw suite above; this
// suite pins the "outside neighbours follow" semantics.

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
