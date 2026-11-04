// The AI-sections resolver: slot expansion, the three packings, the derived
// section Y, field preservation, reference identity and the axis profile.
//
// Ported from the deleted `aiSectionsOps/{bulk,translateRigid}.test.ts`. The
// assertions that only re-verified median / pivot / rotate-about-pivot /
// no-op-guard maths are deliberately NOT ported — those live once in
// `__tests__/math.test.ts` and `__tests__/transform.test.ts` now.
//
// Behaviour changes pinned here on purpose:
//   * boundary-line endpoint Y is the section's derived ground Y, not the
//     parent portal's anchor Y (the ops and the gizmo geometry disagreed).
//   * an out-of-range index is a silent skip, not a RangeError.
//   * the axis profile no longer depends on cardinality.

import { describe, it, expect } from 'vitest';

import type { ParsedAISectionsV12, Portal } from '../../../aiSections';
import { makeModel, makeSection } from '../../../aiSectionsOps/_testHelpers';
import { TRANSFORM_AXES_XZ_PACKED } from '../../../transformAxes';
import {
	createAISectionsResolver,
	type AISectionRef,
} from '../../resolvers/aiSections';
import { selectionPivot, transform } from '../../transform';
import { delta, expectPoint } from '../_helpers';

const SECTION_0: AISectionRef = { kind: 'section', sectionIdx: 0 };

/** One 10×10 section whose single portal sits at height 7, so the derived
 *  section Y (mean portal Y) is a value no coordinate in the file carries. */
function makeLiftedSection(): ParsedAISectionsV12 {
	const portal: Portal = {
		position: { x: 5, y: 7, z: 0 },
		boundaryLines: [{ verts: { x: 0, y: 0, z: 10, w: 0 } }],
		linkSection: 0xffff,
	};
	const sec = makeSection({ portals: [portal] });
	sec.noGoLines = [{ verts: { x: 1, y: 2, z: 3, w: 4 } }];
	return makeModel([sec]);
}

describe('aiSectionsResolver — expansion and slot identity', () => {
	it('expands a whole section to every corner, portal, BL endpoint and no-go endpoint', () => {
		const model = makeLiftedSection();
		const slots = createAISectionsResolver(model).expand(model, SECTION_0);
		// 4 corners + 1 portal + 1 BL × 2 ends + 1 no-go × 2 ends.
		expect(slots).toHaveLength(9);
		expect(slots.filter((s) => s.kind === 'corner')).toHaveLength(4);
		expect(slots.filter((s) => s.kind === 'boundaryLineEndpoint')).toHaveLength(2);
		expect(slots.filter((s) => s.kind === 'noGoLineEndpoint')).toHaveLength(2);
	});

	it('expands the whole-line markers to nothing — selectable, not transformable', () => {
		const model = makeLiftedSection();
		const r = createAISectionsResolver(model);
		expect(r.expand(model, { kind: 'boundaryLine', sectionIdx: 0, portalIdx: 0, lineIdx: 0 })).toEqual([]);
		expect(r.expand(model, { kind: 'noGoLine', sectionIdx: 0, lineIdx: 0 })).toEqual([]);
		// No slots ⇒ no pivot ⇒ the caller renders no gizmo at all.
		expect(selectionPivot(model, [{ kind: 'noGoLine', sectionIdx: 0, lineIdx: 0 }], r)).toBeNull();
	});

	it('skips out-of-range refs silently instead of throwing', () => {
		const model = makeLiftedSection();
		const r = createAISectionsResolver(model);
		expect(r.expand(model, { kind: 'section', sectionIdx: 9 })).toEqual([]);
		expect(r.resolve(model, { kind: 'corner', sectionIdx: 0, cornerIdx: 9 })).toBeNull();
		expect(r.resolve(model, { kind: 'portal', sectionIdx: 0, portalIdx: 9 })).toBeNull();
		expect(
			r.resolve(model, { kind: 'boundaryLineEndpoint', sectionIdx: 0, portalIdx: 9, lineIdx: 0, end: 0 }),
		).toBeNull();
		// End to end: the stale ref is dropped and the live one still moves.
		const next = transform(
			model,
			[{ kind: 'section', sectionIdx: 9 }, SECTION_0],
			delta({ translate: { x: 5, y: 0, z: 0 } }),
			r,
		);
		expect(next.sections[0].corners[0]).toEqual({ x: 5, y: 0 });
	});

	it('subsumes a portal that is also inside a selected whole section', () => {
		// The section ref and the portal ref produce the same slot key, so the
		// portal moves exactly once. With `spin` in play a double-write would
		// not merely double-translate — it would double-orbit.
		const model = makeLiftedSection();
		const next = transform(
			model,
			[SECTION_0, { kind: 'portal', sectionIdx: 0, portalIdx: 0 }],
			delta({ translate: { x: 3, y: 0, z: 0 } }),
			createAISectionsResolver(model),
		);
		expect(next.sections[0].portals[0].position.x).toBe(8);
	});
});

describe('aiSectionsResolver — resolve: packing and the derived section Y', () => {
	it('reads a corner as (x, derivedSectionY, y) — the Vector2 .y IS world Z', () => {
		const model = makeLiftedSection();
		const r = createAISectionsResolver(model);
		// corners[2] is (10, 10) in storage; the portal at height 7 sets the
		// section's ground Y, which lives nowhere in the file.
		expect(r.resolve(model, { kind: 'corner', sectionIdx: 0, cornerIdx: 2 })).toEqual({ x: 10, y: 7, z: 10 });
	});

	it('reads a portal anchor as a verbatim copy of the Vector3, not a live handle', () => {
		const model = makeLiftedSection();
		const p = createAISectionsResolver(model).resolve(model, { kind: 'portal', sectionIdx: 0, portalIdx: 0 });
		expect(p).toEqual({ x: 5, y: 7, z: 0 });
		expect(p).not.toBe(model.sections[0].portals[0].position);
	});

	it('unpacks the two XZ points a single Vector4 verts carries', () => {
		const model = makeLiftedSection();
		const r = createAISectionsResolver(model);
		const ng0 = r.resolve(model, { kind: 'noGoLineEndpoint', sectionIdx: 0, lineIdx: 0, end: 0 });
		const ng1 = r.resolve(model, { kind: 'noGoLineEndpoint', sectionIdx: 0, lineIdx: 0, end: 1 });
		// verts = (1, 2, 3, 4) ⇒ end 0 is (x=1, z=2), end 1 is (x=3, z=4).
		expect(ng0).toEqual({ x: 1, y: 7, z: 2 });
		expect(ng1).toEqual({ x: 3, y: 7, z: 4 });
	});

	it('gives a boundary-line endpoint the section Y and no visual gizmo lift', () => {
		// Two reconciliations pinned in one assertion: the parent portal's Y
		// (7 here, and it is also 7 for the section — so use a portal whose Y
		// differs from the section mean to tell them apart), and the absence of
		// the overlay's +1.5 / +0.5 lifts.
		const portals: Portal[] = [
			{ position: { x: 0, y: 2, z: 0 }, boundaryLines: [{ verts: { x: 1, y: 2, z: 3, w: 4 } }], linkSection: 0xffff },
			{ position: { x: 0, y: 8, z: 0 }, boundaryLines: [], linkSection: 0xffff },
		];
		const model = makeModel([makeSection({ portals })]);
		const r = createAISectionsResolver(model);
		const point = r.resolve(model, {
			kind: 'boundaryLineEndpoint', sectionIdx: 0, portalIdx: 0, lineIdx: 0, end: 0,
		});
		// Section Y is the MEAN portal Y = (2 + 8) / 2 = 5, not the parent
		// portal's own 2, and not 5 + 0.5.
		expect(point).toEqual({ x: 1, y: 5, z: 2 });
	});
});

describe('aiSectionsResolver — write: packing, preservation, reference identity', () => {
	it('lands translate.y on portal anchors only — corners and lines are XZ-packed', () => {
		const model = makeLiftedSection();
		const next = transform(
			model,
			[SECTION_0],
			delta({ translate: { x: 7, y: 2, z: -3 } }),
			createAISectionsResolver(model),
		);
		const sec = next.sections[0];
		expect(sec.corners[0]).toEqual({ x: 7, y: -3 });
		expect(sec.portals[0].position).toEqual({ x: 12, y: 9, z: -3 });
		// Both endpoints of the packed Vector4 shift in XZ; nothing writes a Y.
		expect(sec.portals[0].boundaryLines[0].verts).toEqual({ x: 7, y: -3, z: 17, w: -3 });
		expect(sec.noGoLines[0].verts).toEqual({ x: 8, y: -1, z: 10, w: 1 });
	});

	it('preserves every non-spatial field and shares untouched siblings by reference', () => {
		const model = makeModel([
			makeSection({ id: 0xa, spanIndex: 3, flags: 0x11, district: 0 }),
			makeSection({ id: 0xb }),
		]);
		const next = transform(
			model,
			[SECTION_0],
			delta({ translate: { x: 1, y: 0, z: 0 } }),
			createAISectionsResolver(model),
		);
		expect(next.sections[0].id).toBe(0xa);
		expect(next.sections[0].spanIndex).toBe(3);
		expect(next.sections[0].flags).toBe(0x11);
		// Structural sharing is the BND2 writeback contract: an untouched
		// section must re-encode to the exact bytes it parsed from, and the
		// overlay paints cascade-affected neighbours orange by `!==`.
		expect(next.sections[1]).toBe(model.sections[1]);
		expect(next.sectionResetPairs).toBe(model.sectionResetPairs);
		expect(next.sectionMinSpeeds).toBe(model.sectionMinSpeeds);
	});

	it('leaves the rest of a section === when only one sub-entity is selected', () => {
		const model = makeLiftedSection();
		const next = transform(
			model,
			[{ kind: 'boundaryLineEndpoint', sectionIdx: 0, portalIdx: 0, lineIdx: 0, end: 0 }],
			delta({ translate: { x: 10, y: 99, z: 20 } }),
			createAISectionsResolver(model),
		);
		const sec = next.sections[0];
		expect(sec.corners).toBe(model.sections[0].corners);
		expect(sec.noGoLines).toBe(model.sections[0].noGoLines);
		expect(sec.portals[0].position).toBe(model.sections[0].portals[0].position);
		// End 0 moved in XZ, end 1 untouched, translate.y discarded.
		expect(sec.portals[0].boundaryLines[0].verts).toEqual({ x: 10, y: 20, z: 10, w: 0 });
	});

	it('returns the input model when every write equals what is already stored', () => {
		// The overlay's `next !== data` gate is the only thing standing between
		// a no-op gesture and a dirtied Bundle.
		const model = makeLiftedSection();
		const same = createAISectionsResolver(model).write(model, [
			// corners[0] is (0, 0); the y component of the point is discarded,
			// so even a wildly wrong height must not register as a change.
			{ slot: { kind: 'corner', sectionIdx: 0, cornerIdx: 0 }, point: { x: 0, y: 99, z: 0 }, spin: null },
		]);
		expect(same).toBe(model);
	});
});

describe('aiSectionsResolver — rotate', () => {
	it('yaws +X toward -Z (true right-hand rule / three.js)', () => {
		const model = makeModel([makeSection({ corners: [{ x: 10, y: 0 }] })]);
		const next = transform(
			model,
			[SECTION_0],
			delta({ rotate: { x: 0, y: Math.PI / 2, z: 0 }, pivot: { x: 0, y: 0, z: 0 } }),
			createAISectionsResolver(model),
		);
		const c = next.sections[0].corners[0];
		expect(c.x).toBeCloseTo(0, 10);
		expect(c.y).toBeCloseTo(-10, 10);
	});

	it('orbits both endpoints of one packed verts independently', () => {
		// Contract W1 + W2 in one test: both endpoints are read from the
		// pre-gesture model and each write touches only its own two floats, so
		// the second endpoint's write cannot double-rotate the first.
		const model = makeModel([
			{
				...makeSection({}),
				noGoLines: [{ verts: { x: 10, y: 0, z: 0, w: 10 } }],
			},
		]);
		const next = transform(
			model,
			[
				{ kind: 'noGoLineEndpoint', sectionIdx: 0, lineIdx: 0, end: 0 },
				{ kind: 'noGoLineEndpoint', sectionIdx: 0, lineIdx: 0, end: 1 },
			],
			delta({ rotate: { x: 0, y: Math.PI / 2, z: 0 }, pivot: { x: 0, y: 0, z: 0 } }),
			createAISectionsResolver(model),
		);
		const v = next.sections[0].noGoLines[0].verts;
		// (10, 0) → (0, -10) and (0, 10) → (10, 0).
		expect(v.x).toBeCloseTo(0, 10);
		expect(v.y).toBeCloseTo(-10, 10);
		expect(v.z).toBeCloseTo(10, 10);
		expect(v.w).toBeCloseTo(0, 10);
	});

	it('keeps portal Y out of a yaw', () => {
		const model = makeLiftedSection();
		const next = transform(
			model,
			[SECTION_0],
			delta({ rotate: { x: 0, y: Math.PI / 2, z: 0 }, pivot: { x: 0, y: 0, z: 0 } }),
			createAISectionsResolver(model),
		);
		expect(next.sections[0].portals[0].position.y).toBeCloseTo(7, 10);
	});

	it('preserves every pairwise distance across a multi-section bulk (rigid body)', () => {
		// The load-bearing invariant: a whole-section ref expands to every
		// corner, so each corner orbits the shared pivot on its own and the
		// bulk turns instead of merely sliding its anchors around.
		const model = makeModel([
			makeSection({ id: 0xa, corners: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] }),
			makeSection({ id: 0xb, corners: [{ x: 20, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 10 }, { x: 20, y: 10 }] }),
		]);
		const next = transform(
			model,
			[SECTION_0, { kind: 'section', sectionIdx: 1 }],
			delta({ rotate: { x: 0, y: 0.4123, z: 0 }, pivot: { x: 15, y: 0, z: 5 } }),
			createAISectionsResolver(model),
		);
		const flatten = (m: ParsedAISectionsV12) => m.sections.flatMap((s) => s.corners);
		const before = flatten(model);
		const after = flatten(next);
		const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
			Math.hypot(a.x - b.x, a.y - b.y);
		for (let i = 0; i < before.length; i++) {
			for (let j = i + 1; j < before.length; j++) {
				expect(dist(after[i], after[j])).toBeCloseTo(dist(before[i], before[j]), 5);
			}
		}
	});
});

describe('aiSectionsResolver — pivot and axes', () => {
	it('anchors at the per-component median over corners AND portal anchors', () => {
		const portal: Portal = { position: { x: 100, y: 0, z: 100 }, boundaryLines: [], linkSection: 0xffff };
		const model = makeModel([makeSection({ portals: [portal] })]);
		// Samples: 4 corners (0,0) (10,0) (10,10) (0,10) at the portal's Y=0,
		// plus the portal at (100, 0, 100). Median X over [0,0,10,10,100] = 10.
		expectPoint(selectionPivot(model, [SECTION_0], createAISectionsResolver(model)), { x: 10, y: 0, z: 10 });
	});

	it('reports full 3-axis translate with yaw-only rotate (ADR-0011)', () => {
		const model = makeLiftedSection();
		expect(createAISectionsResolver(model).axes([SECTION_0])).toEqual(TRANSFORM_AXES_XZ_PACKED);
	});

	it('reports the same profile for one sub-entity as for a whole bulk', () => {
		// Cardinality is no longer a factor: the pivot is drag-repositionable,
		// so a lone corner genuinely orbits rather than spinning in place.
		const model = makeLiftedSection();
		const r = createAISectionsResolver(model);
		expect(r.axes([{ kind: 'corner', sectionIdx: 0, cornerIdx: 0 }])).toEqual(r.axes([SECTION_0]));
	});

	it('returns null for an empty refs list so the caller renders no gizmo', () => {
		const model = makeLiftedSection();
		expect(createAISectionsResolver(model).axes([])).toBeNull();
	});
});
