// Spec for the V12 overlay's gizmo geometry helpers.
//
// Two things we pin:
//   1. `deriveGizmoPosition` for each target.kind — anchor points must
//      match the pre-extraction `useMemo` block byte-for-byte (the
//      `BULK_GIZMO_Y_OFFSET = 1.5` lift on bulk / section / corner, the
//      verbatim Vector3 read on portalAnchor, the +0.5 lift on
//      noGoLineEndpoint).
//   2. `deriveGizmoAxes` per target.kind — XZ-packed for section /
//      bulk / line endpoints, full XYZ translate + no rotate for
//      portalAnchor, no-rotate single-point profile for corner + line
//      endpoints. Pinning prevents a future "let me just enable rotate
//      on corner" from going unnoticed.

import { describe, it, expect } from 'vitest';
import {
	BULK_GIZMO_Y_OFFSET,
	deriveGizmoPosition,
	deriveGizmoAxes,
} from '../aiSectionsGizmoGeometry';
import type { DragTarget } from '../aiSectionsDrag.types';
import { makeModel, makeSection } from '@/lib/core/aiSectionsOps/_testHelpers';
import { TRANSFORM_AXES_FULL_3D, TRANSFORM_AXES_XZ_PACKED } from '@/lib/core/transformAxes';

describe('deriveGizmoPosition', () => {
	it('returns null for a null target', () => {
		const model = makeModel([makeSection({})]);
		expect(deriveGizmoPosition(null, null, model, 0, null, null)).toBeNull();
	});

	it('section: anchors at the centroid of the live section, lifted +1.5 on Y', () => {
		const model = makeModel([makeSection({})]);
		const target: DragTarget = { kind: 'section', sectionIdx: 0 };
		const pos = deriveGizmoPosition(target, model.sections[0], model, 0, null, null);
		// Unit square centroid is (5, 5) on XZ. Y = sectionY (0) + 1.5.
		expect(pos).toEqual([5, BULK_GIZMO_Y_OFFSET, 5]);
	});

	it('corner: anchors at the corner XZ at sectionY + 1.5', () => {
		const model = makeModel([makeSection({})]);
		const target: DragTarget = { kind: 'corner', sectionIdx: 0, cornerIdx: 2 };
		const pos = deriveGizmoPosition(target, model.sections[0], model, 7, null, null);
		// corner[2] = (10, 10) in stored Vector2 — y → world Z = 10.
		expect(pos).toEqual([10, 7 + BULK_GIZMO_Y_OFFSET, 10]);
	});

	it('portalAnchor: anchors at the stored Vector3 verbatim (no Y lift)', () => {
		const sec = makeSection({
			portals: [{
				position: { x: 4, y: 6, z: 8 },
				boundaryLines: [],
				linkSection: 0xFFFF,
			}],
		});
		const model = makeModel([sec]);
		const target: DragTarget = { kind: 'portalAnchor', sectionIdx: 0, portalIdx: 0 };
		const pos = deriveGizmoPosition(target, sec, model, 0, null, null);
		expect(pos).toEqual([4, 6, 8]);
	});

	it('boundaryLineEndpoint: end 0 reads verts.(x,y); end 1 reads verts.(z,w), Y from parent portal', () => {
		const sec = makeSection({
			portals: [{
				position: { x: 0, y: 12, z: 0 },
				boundaryLines: [{ verts: { x: 1, y: 2, z: 3, w: 4 } }],
				linkSection: 0xFFFF,
			}],
		});
		const model = makeModel([sec]);
		const end0 = deriveGizmoPosition(
			{ kind: 'boundaryLineEndpoint', sectionIdx: 0, portalIdx: 0, lineIdx: 0, endIdx: 0 },
			sec, model, 0, null, null,
		);
		expect(end0).toEqual([1, 12, 2]);
		const end1 = deriveGizmoPosition(
			{ kind: 'boundaryLineEndpoint', sectionIdx: 0, portalIdx: 0, lineIdx: 0, endIdx: 1 },
			sec, model, 0, null, null,
		);
		expect(end1).toEqual([3, 12, 4]);
	});

	it('noGoLineEndpoint: end 0/1 same XZ projection, Y at sectionY + 0.5', () => {
		const sec = {
			...makeSection({}),
			noGoLines: [{ verts: { x: 11, y: 22, z: 33, w: 44 } }],
		};
		const model = makeModel([sec]);
		const end0 = deriveGizmoPosition(
			{ kind: 'noGoLineEndpoint', sectionIdx: 0, lineIdx: 0, endIdx: 0 },
			sec, model, 3, null, null,
		);
		expect(end0).toEqual([11, 3.5, 22]);
		const end1 = deriveGizmoPosition(
			{ kind: 'noGoLineEndpoint', sectionIdx: 0, lineIdx: 0, endIdx: 1 },
			sec, model, 3, null, null,
		);
		expect(end1).toEqual([33, 3.5, 44]);
	});

	it('bulk: pivot + +1.5 lift, drifts along drag.translate', () => {
		const model = makeModel([makeSection({})]);
		const target: DragTarget = {
			kind: 'bulk',
			entities: [{ kind: 'section', sectionIdx: 0 }],
			pivot: { x: 100, y: 0, z: 50 },
		};
		// No drag — anchor at pivot + lift.
		expect(deriveGizmoPosition(target, null, model, 0, null, null))
			.toEqual([100, BULK_GIZMO_Y_OFFSET, 50]);
		// With a bulk drag in flight, anchor drifts with translate.
		const dragging = {
			target,
			delta: { translate: { x: 5, y: 0, z: 3 }, rotate: { x: 0, y: 0, z: 0 }, cascade: false },
		};
		expect(deriveGizmoPosition(target, null, model, 0, null, dragging))
			.toEqual([105, BULK_GIZMO_Y_OFFSET, 53]);
	});

	it('sub-entity + bulkPivotOverride: gizmo follows the typed pivot + translate delta', () => {
		const model = makeModel([makeSection({})]);
		const target: DragTarget = { kind: 'corner', sectionIdx: 0, cornerIdx: 0 };
		const override = { x: 7, y: 1, z: 9 };
		const pos = deriveGizmoPosition(target, null, model, 0, override, null);
		expect(pos).toEqual([7, 1, 9]);
		const dragging = {
			target,
			delta: { translate: { x: 2, y: 0, z: -1 }, rotate: { x: 0, y: 0, z: 0 }, cascade: false },
		};
		expect(deriveGizmoPosition(target, null, model, 0, override, dragging))
			.toEqual([9, 1, 8]);
	});
});

describe('deriveGizmoAxes', () => {
	it('null target → full 3D default', () => {
		expect(deriveGizmoAxes(null)).toBe(TRANSFORM_AXES_FULL_3D);
	});

	it('section → XZ-packed', () => {
		expect(deriveGizmoAxes({ kind: 'section', sectionIdx: 0 })).toBe(TRANSFORM_AXES_XZ_PACKED);
	});

	it('bulk → AND-intersection of section axes (XZ-packed yaw, full-3D translate)', () => {
		const axes = deriveGizmoAxes({
			kind: 'bulk',
			entities: [{ kind: 'section', sectionIdx: 0 }],
			pivot: { x: 0, y: 0, z: 0 },
		});
		// `bulkAISectionsAxes` exposes full-XYZ translate so a bulk of full-3D
		// portal anchors can move on Y; rotation stays yaw-only (ADR-0011).
		expect(axes.translate).toEqual({ x: true, y: true, z: true });
		expect(axes.rotate).toEqual({ x: false, y: true, z: false });
	});

	it('corner → XZ translate, rotate fully disabled (single point)', () => {
		expect(deriveGizmoAxes({ kind: 'corner', sectionIdx: 0, cornerIdx: 0 })).toEqual({
			translate: { x: true, y: false, z: true },
			rotate: { x: false, y: false, z: false },
		});
	});

	it('portalAnchor → full XYZ translate, rotate disabled (single point)', () => {
		expect(deriveGizmoAxes({ kind: 'portalAnchor', sectionIdx: 0, portalIdx: 0 })).toEqual({
			translate: { x: true, y: true, z: true },
			rotate: { x: false, y: false, z: false },
		});
	});

	it('boundaryLineEndpoint / noGoLineEndpoint → XZ translate, rotate disabled', () => {
		const bl = deriveGizmoAxes({
			kind: 'boundaryLineEndpoint', sectionIdx: 0, portalIdx: 0, lineIdx: 0, endIdx: 0,
		});
		const ng = deriveGizmoAxes({
			kind: 'noGoLineEndpoint', sectionIdx: 0, lineIdx: 0, endIdx: 0,
		});
		const expected = {
			translate: { x: true, y: false, z: true },
			rotate: { x: false, y: false, z: false },
		};
		expect(bl).toEqual(expected);
		expect(ng).toEqual(expected);
	});
});
