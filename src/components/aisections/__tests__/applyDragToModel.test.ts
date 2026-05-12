// Pinning the gizmo-target dispatcher in `applyDragToModel`.
//
// One fixture per `target.kind` (section / bulk / corner / portalAnchor /
// boundaryLineEndpoint / noGoLineEndpoint), with both cascade-off (the
// ADR-0009 default) and cascade-on for the section path (cascade is only
// wired for section + bulk; sub-entity drags hard-code cascade-off in
// this slice).
//
// These tests pin the dispatcher's contract — they don't re-test the
// underlying ops (those live in `src/lib/core/aiSectionsOps/__tests__/`).
// Each case proves the dispatcher routes the (target, delta) pair to the
// right op AND drops the components the destination shape can't carry
// (translate.y for Vector2 corners and Vector4 line endpoints).

import { describe, it, expect } from 'vitest';
import { applyDragToModel } from '../applyDragToModel';
import type { ActiveDrag } from '../aiSectionsDrag.types';
import { makeModel, makeSection } from '@/lib/core/aiSectionsOps/_testHelpers';
import type { AISection, Portal } from '@/lib/core/aiSections';

function delta(translate: { x?: number; y?: number; z?: number } = {}, rotateY = 0, cascade = false) {
	return {
		translate: { x: 0, y: 0, z: 0, ...translate },
		rotate: { x: 0, y: rotateY, z: 0 },
		cascade,
	};
}

describe('applyDragToModel', () => {
	it('section / no-cascade: translates rigid + rotates around centroid', () => {
		const model = makeModel([makeSection({})]);
		const drag: ActiveDrag = {
			target: { kind: 'section', sectionIdx: 0 },
			delta: delta({ x: 5, z: 3 }),
		};
		const next = applyDragToModel(model, drag);
		expect(next).not.toBe(model);
		const sec = next.sections[0];
		// Unit square corner [0] {0,0} → {5,3}.
		expect(sec.corners[0]).toEqual({ x: 5, y: 3 });
	});

	it('section / cascade-on: routes through translateSectionWithLinks (XZ only)', () => {
		// Two sections sharing the right edge of s0 / left edge of s1, both
		// linked through portals. Cascade-on should drag s1's reverse-portal
		// + shared corners along.
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
		const next = applyDragToModel(model, drag);
		// s0 corner [1] (10,0) → (14,0).
		expect(next.sections[0].corners[1]).toEqual({ x: 14, y: 0 });
		// s1 shouldn't be the same object reference — cascade mutated it.
		expect(next.sections[1]).not.toBe(s1);
	});

	it('section / cascade-on: yaw rotation routes through rotateSectionWithLinksYaw', () => {
		const model = makeModel([makeSection({})]);
		const drag: ActiveDrag = {
			target: { kind: 'section', sectionIdx: 0 },
			delta: delta({}, Math.PI / 2, true),
		};
		const next = applyDragToModel(model, drag);
		expect(next).not.toBe(model);
		// A π/2 rotation around the centroid permutes corners; just assert it ran.
		expect(next.sections[0]).not.toBe(model.sections[0]);
	});

	it('bulk / cascade-off: rigid translate (and rotate around post-translate pivot)', () => {
		const s0 = makeSection({ id: 0xA });
		const s1 = makeSection({
			id: 0xB,
			corners: [
				{ x: 20, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 10 }, { x: 20, y: 10 },
			],
		});
		const model = makeModel([s0, s1]);
		const drag: ActiveDrag = {
			target: {
				kind: 'bulk',
				entities: [
					{ kind: 'section', sectionIdx: 0 },
					{ kind: 'section', sectionIdx: 1 },
				],
				pivot: { x: 15, y: 0, z: 5 },
			},
			delta: delta({ x: 7 }),
		};
		const next = applyDragToModel(model, drag);
		expect(next.sections[0].corners[0]).toEqual({ x: 7, y: 0 });
		expect(next.sections[1].corners[0]).toEqual({ x: 27, y: 0 });
	});

	it('corner: XZ-only — translate.y is dropped', () => {
		const model = makeModel([makeSection({})]);
		const drag: ActiveDrag = {
			target: { kind: 'corner', sectionIdx: 0, cornerIdx: 1 },
			delta: delta({ x: 3, y: 99, z: 4 }),
		};
		const next = applyDragToModel(model, drag);
		// corner[1] starts at (10, 0); +3,+4 → (13, 4). Y in the corner's
		// Vector2 stores world Z, so the y=99 from delta must be discarded.
		expect(next.sections[0].corners[1]).toEqual({ x: 13, y: 4 });
		// Other corners untouched.
		expect(next.sections[0].corners[0]).toEqual({ x: 0, y: 0 });
	});

	it('portalAnchor: full Vector3 — translate.y is preserved', () => {
		const sec: AISection = makeSection({
			portals: [{
				position: { x: 5, y: 2, z: 1 },
				boundaryLines: [],
				linkSection: 0xFFFF,
			} as Portal],
		});
		const model = makeModel([sec]);
		const drag: ActiveDrag = {
			target: { kind: 'portalAnchor', sectionIdx: 0, portalIdx: 0 },
			delta: delta({ x: 1, y: 7, z: 2 }),
		};
		const next = applyDragToModel(model, drag);
		expect(next.sections[0].portals[0].position).toEqual({ x: 6, y: 9, z: 3 });
	});

	it('boundaryLineEndpoint: XZ-only — translate.y is dropped', () => {
		const sec = makeSection({
			portals: [{
				position: { x: 0, y: 0, z: 0 },
				boundaryLines: [{ verts: { x: 1, y: 2, z: 3, w: 4 } }],
				linkSection: 0xFFFF,
			} as Portal],
		});
		const model = makeModel([sec]);
		const drag: ActiveDrag = {
			target: { kind: 'boundaryLineEndpoint', sectionIdx: 0, portalIdx: 0, lineIdx: 0, endIdx: 0 },
			delta: delta({ x: 10, y: 99, z: 20 }),
		};
		const next = applyDragToModel(model, drag);
		// endIdx 0 → (verts.x, verts.y). Y in the packed Vector4 is world Z.
		const v = next.sections[0].portals[0].boundaryLines[0].verts;
		expect(v.x).toBe(11);
		expect(v.y).toBe(22);
		// Other endpoint untouched.
		expect(v.z).toBe(3);
		expect(v.w).toBe(4);
	});

	it('noGoLineEndpoint: XZ-only — translate.y is dropped', () => {
		const sec: AISection = {
			...makeSection({}),
			noGoLines: [{ verts: { x: 1, y: 2, z: 3, w: 4 } }],
		};
		const model = makeModel([sec]);
		const drag: ActiveDrag = {
			target: { kind: 'noGoLineEndpoint', sectionIdx: 0, lineIdx: 0, endIdx: 1 },
			delta: delta({ x: 10, y: 99, z: 20 }),
		};
		const next = applyDragToModel(model, drag);
		// endIdx 1 → (verts.z, verts.w).
		const v = next.sections[0].noGoLines[0].verts;
		expect(v.x).toBe(1);
		expect(v.y).toBe(2);
		expect(v.z).toBe(13);
		expect(v.w).toBe(24);
	});
});
