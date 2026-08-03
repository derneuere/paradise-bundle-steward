// Spec for the V12 overlay's gizmo geometry helper.
//
// Anchor derivation itself is no longer here — it moved into the shared
// Transform module's aiSections resolver (`resolve()` per slot kind, pinned in
// transform/__tests__/resolvers/aiSections.test.ts). What survives in this
// module, and all this file pins, is the VISUAL Y-LIFT policy: how far above
// the anchor the handle floats so it stays grabbable instead of buried in the
// track surface. That lift is deliberately kept out of `resolve()` — it must
// never reach a write, or every gesture would raise the geometry it moved.

import { describe, it, expect } from 'vitest';
import {
	BULK_GIZMO_Y_OFFSET,
	LINE_GIZMO_Y_OFFSET,
	deriveGizmoPosition,
	gizmoYLift,
} from '../aiSectionsGizmoGeometry';
import type { AISectionRef } from '@/lib/core/transform';

const PIVOT = { x: 5, y: 2, z: 9 };

describe('gizmoYLift', () => {
	it('lifts a whole-section or corner anchor clear of the track surface', () => {
		expect(gizmoYLift({ kind: 'section', sectionIdx: 0 })).toBe(BULK_GIZMO_Y_OFFSET);
		expect(gizmoYLift({ kind: 'corner', sectionIdx: 0, cornerIdx: 2 })).toBe(BULK_GIZMO_Y_OFFSET);
	});

	it('uses the smaller line lift for boundary and no-go endpoints', () => {
		const bl: AISectionRef = {
			kind: 'boundaryLineEndpoint', sectionIdx: 0, portalIdx: 0, lineIdx: 0, end: 0,
		};
		const ng: AISectionRef = { kind: 'noGoLineEndpoint', sectionIdx: 0, lineIdx: 0, end: 1 };
		expect(gizmoYLift(bl)).toBe(LINE_GIZMO_Y_OFFSET);
		expect(gizmoYLift(ng)).toBe(LINE_GIZMO_Y_OFFSET);
	});

	it('does not lift a portal anchor — its stored Vector3 already carries a real height', () => {
		expect(gizmoYLift({ kind: 'portal', sectionIdx: 0, portalIdx: 0 })).toBe(0);
	});

	it('falls back to the bulk lift when there is no single anchor (a multi-entity Selection)', () => {
		expect(gizmoYLift(null)).toBe(BULK_GIZMO_Y_OFFSET);
	});
});

describe('deriveGizmoPosition', () => {
	it('returns null without a pivot, so an empty Selection renders no gizmo', () => {
		expect(deriveGizmoPosition(null, null, null)).toBeNull();
	});

	it('anchors at the pivot plus the anchor kind\'s lift', () => {
		expect(deriveGizmoPosition(PIVOT, { kind: 'section', sectionIdx: 0 }, null))
			.toEqual([5, 2 + BULK_GIZMO_Y_OFFSET, 9]);
		expect(deriveGizmoPosition(PIVOT, { kind: 'portal', sectionIdx: 0, portalIdx: 0 }, null))
			.toEqual([5, 2, 9]);
	});

	it('rides along the in-flight translate so the handle tracks the drag', () => {
		const pos = deriveGizmoPosition(PIVOT, null, { x: 10, y: 1, z: -4 });
		expect(pos).toEqual([15, 2 + BULK_GIZMO_Y_OFFSET + 1, 5]);
	});

	it('ignores rotation — the pivot IS the fixed point a rigid body turns around', () => {
		// No rotate parameter exists by construction. Pinned as a spec: if a
		// future change threads one in, the handle must still not orbit itself.
		const still = deriveGizmoPosition(PIVOT, null, { x: 0, y: 0, z: 0 });
		expect(still).toEqual(deriveGizmoPosition(PIVOT, null, null));
	});
});
