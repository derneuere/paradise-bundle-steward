// Spec for the V12 overlay's live-drag preview math.
//
// Three things we pin here:
//   1. identity-delta short-circuit (no preview model when the drag hasn't
//      moved — important so the bulk-member render loop falls back to data
//      and doesn't allocate per-frame).
//   2. round-trip a translate delta through `derivePreviewModel` →
//      `derivePreviewSection` → `derivePreviewCorners` to confirm the
//      preview corners reflect the dragged geometry.
//   3. `deriveAffectedNeighbours` excludes bulk members (the filter the
//      overlay uses to avoid double-painting in the orange "cascade" colour
//      on top of bulk yellow).

import { describe, it, expect } from 'vitest';
import {
	derivePreviewModel,
	derivePreviewSection,
	derivePreviewCorners,
	deriveAffectedNeighbours,
} from '../aiSectionsPreview';
import type { ActiveDrag } from '../aiSectionsDrag.types';
import { makeModel, makeSection } from '@/lib/core/aiSectionsOps/_testHelpers';

function delta(translate: { x?: number; y?: number; z?: number } = {}, rotateY = 0, cascade = false) {
	return {
		translate: { x: 0, y: 0, z: 0, ...translate },
		rotate: { x: 0, y: rotateY, z: 0 },
		cascade,
	};
}

describe('derivePreviewModel', () => {
	it('returns null when no drag is active', () => {
		const model = makeModel([makeSection({})]);
		expect(derivePreviewModel(model, null)).toBeNull();
	});

	it('returns null when the drag delta is identity (no movement)', () => {
		const model = makeModel([makeSection({})]);
		const drag: ActiveDrag = {
			target: { kind: 'section', sectionIdx: 0 },
			delta: delta(),
		};
		expect(derivePreviewModel(model, drag)).toBeNull();
	});

	it('returns the next model when the drag has a non-identity translate', () => {
		const model = makeModel([makeSection({})]);
		const drag: ActiveDrag = {
			target: { kind: 'section', sectionIdx: 0 },
			delta: delta({ x: 4, z: 5 }),
		};
		const preview = derivePreviewModel(model, drag);
		expect(preview).not.toBeNull();
		expect(preview!.sections[0].corners[0]).toEqual({ x: 4, y: 5 });
	});

	it('round-trips through derivePreviewSection + derivePreviewCorners', () => {
		const model = makeModel([makeSection({}), makeSection({ id: 0xB })]);
		const drag: ActiveDrag = {
			target: { kind: 'section', sectionIdx: 0 },
			delta: delta({ x: 2, z: 0 }),
		};
		const preview = derivePreviewModel(model, drag);
		const previewSection = derivePreviewSection(model.sections[0], preview, 0);
		const corners = derivePreviewCorners(previewSection);
		expect(corners).not.toBeNull();
		// V12 corner.y is world Z — projection ⇒ {x, z}.
		expect(corners![0]).toEqual({ x: 2, z: 0 });
	});

	it('derivePreviewSection falls back to selSection when no preview is available', () => {
		const sec = makeSection({});
		const fallback = derivePreviewSection(sec, null, 0);
		expect(fallback).toBe(sec);
	});
});

describe('deriveAffectedNeighbours', () => {
	it('returns [] when no preview model is available', () => {
		const model = makeModel([makeSection({})]);
		expect(deriveAffectedNeighbours(null, 0, new Set(), model)).toEqual([]);
	});

	it('lists sections the preview touched that are neither the inspector pick nor bulk members', () => {
		// Two sections sharing the right edge of s0 / left edge of s1. A
		// cascade-on translate on s0 mutates s1's reverse-portal section as
		// well — that's the "affected neighbour" the overlay paints orange.
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
		const s1 = makeSection({
			id: 0xB,
			corners: [
				{ x: 10, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }, { x: 10, y: 10 },
			],
			portals: [{
				position: { x: 10, y: 0, z: 5 },
				boundaryLines: [{ verts: { x: 10, y: 10, z: 10, w: 0 } }],
				linkSection: 0,
			}],
		});
		const model = makeModel([s0, s1]);
		const drag: ActiveDrag = {
			target: { kind: 'section', sectionIdx: 0 },
			delta: delta({ x: 4 }, 0, true),
		};
		const preview = derivePreviewModel(model, drag);
		const out = deriveAffectedNeighbours(preview, 0, new Set(), model);
		expect(out.map((n) => n.idx)).toEqual([1]);
	});

	it('excludes bulk members — the bulk-member render loop already paints them', () => {
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
		const s1 = makeSection({
			id: 0xB,
			corners: [
				{ x: 10, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }, { x: 10, y: 10 },
			],
			portals: [{
				position: { x: 10, y: 0, z: 5 },
				boundaryLines: [{ verts: { x: 10, y: 10, z: 10, w: 0 } }],
				linkSection: 0,
			}],
		});
		const model = makeModel([s0, s1]);
		const drag: ActiveDrag = {
			target: { kind: 'section', sectionIdx: 0 },
			delta: delta({ x: 4 }, 0, true),
		};
		const preview = derivePreviewModel(model, drag);
		// Without the bulk filter the neighbour at idx 1 would show. With
		// idx 1 in the bulk it disappears (the bulk-member render loop is
		// responsible for painting it).
		const filtered = deriveAffectedNeighbours(preview, 0, new Set([1]), model);
		expect(filtered).toEqual([]);
	});
});
