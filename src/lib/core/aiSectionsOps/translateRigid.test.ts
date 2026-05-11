// Unit tests for the no-cascade V12 Bulk-transform ops:
//
//   - translateSectionRigid (whole-section rigid translate)
//   - rotateSectionAroundCentroidYaw (whole-section yaw)
//   - translate{Corner,PortalAnchor,BoundaryLineEndpoint,NoGoLineEndpoint}Rigid
//     (single-sub-entity translates)
//   - translate + rotate composition (commit-order pinning)
//
// Imports come from the directory barrel so we exercise the same public
// surface every downstream caller hits.

import { describe, it, expect } from 'vitest';
import {
	rotateSectionAroundCentroidYaw,
	translateBoundaryLineEndpointRigid,
	translateCornerRigid,
	translateNoGoLineEndpointRigid,
	translatePortalAnchorRigid,
	translateSectionRigid,
} from '../aiSectionsOps';
import {
	type AISection,
	type ParsedAISectionsV12,
	type Portal,
} from '../aiSections';
import { makeModel, makeSection } from './_testHelpers';

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
