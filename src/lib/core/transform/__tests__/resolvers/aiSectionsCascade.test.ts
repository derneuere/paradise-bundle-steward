// The AI-sections **Cascade** — the only ref expansion in the editor.
//
// Ported from the deleted `aiSectionsOps/bulk.test.ts` cascade suites
// (`translateSelectionWithLinks`, `rotateSelectionWithLinksYaw`). Those ops
// baked the cascade into a bespoke translate and a bespoke rotate; the same
// semantics now fall out of widening the ref list and handing it to the one
// shared `transform()`, so the rotate half needs no separate implementation.

import { describe, it, expect } from 'vitest';

import type { ParsedAISectionsV12 } from '../../../aiSections';
import { makeModel, makeSection } from '../../../aiSectionsOps/_testHelpers';
import { createAISectionsResolver, type AISectionRef } from '../../resolvers/aiSections';
import { expandAISectionsCascade } from '../../resolvers/aiSectionsCascade';
import { transform } from '../../transform';
import { delta } from '../_helpers';

/** A row of three sections. s1 in the middle is joined to s0 on its left edge
 *  and to s2 on its right edge; each join is a mirrored portal pair sitting at
 *  one shared world coordinate. */
function makeTrio(): ParsedAISectionsV12 {
	const s0 = makeSection({
		id: 0xa,
		corners: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
		portals: [{
			position: { x: 10, y: 0, z: 5 },
			boundaryLines: [{ verts: { x: 10, y: 0, z: 10, w: 10 } }],
			linkSection: 1,
		}],
	});
	const s1 = makeSection({
		id: 0xb,
		corners: [{ x: 10, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }, { x: 10, y: 10 }],
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
	const s2 = makeSection({
		id: 0xc,
		corners: [{ x: 20, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 10 }, { x: 20, y: 10 }],
		portals: [{
			position: { x: 20, y: 0, z: 5 },
			boundaryLines: [{ verts: { x: 20, y: 10, z: 20, w: 0 } }],
			linkSection: 1,
		}],
	});
	return makeModel([s0, s1, s2]);
}

const SEL_1: AISectionRef[] = [{ kind: 'section', sectionIdx: 1 }];

describe('expandAISectionsCascade', () => {
	it('adds the neighbours reverse portal, its line endpoints and the shared corners', () => {
		const model = makeTrio();
		const out = expandAISectionsCascade(model, SEL_1);
		expect(out).toContainEqual({ kind: 'portal', sectionIdx: 0, portalIdx: 0 });
		expect(out).toContainEqual({ kind: 'portal', sectionIdx: 2, portalIdx: 0 });
		// Both ends of the mirror portal's boundary line, so the join stays
		// welded under a rotate as well as a translate.
		expect(out).toContainEqual({ kind: 'boundaryLineEndpoint', sectionIdx: 0, portalIdx: 0, lineIdx: 0, end: 0 });
		expect(out).toContainEqual({ kind: 'boundaryLineEndpoint', sectionIdx: 0, portalIdx: 0, lineIdx: 0, end: 1 });
		// s0's corners on the shared edge — (10, 0) and (10, 10) — only.
		expect(out).toContainEqual({ kind: 'corner', sectionIdx: 0, cornerIdx: 1 });
		expect(out).toContainEqual({ kind: 'corner', sectionIdx: 0, cornerIdx: 2 });
		expect(out).not.toContainEqual({ kind: 'corner', sectionIdx: 0, cornerIdx: 0 });
		expect(out).not.toContainEqual({ kind: 'corner', sectionIdx: 0, cornerIdx: 3 });
	});

	it('never cascades INTO another Selection member', () => {
		// s2 already moves under its own ref; cascading would move it twice.
		const model = makeTrio();
		const out = expandAISectionsCascade(model, [
			{ kind: 'section', sectionIdx: 1 },
			{ kind: 'section', sectionIdx: 2 },
		]);
		expect(out.filter((r) => r.sectionIdx === 2)).toEqual([{ kind: 'section', sectionIdx: 2 }]);
		// s0 is still outside the Selection, so it still cascades.
		expect(out).toContainEqual({ kind: 'portal', sectionIdx: 0, portalIdx: 0 });
	});

	it('skips self-links and out-of-range linkSection values', () => {
		const model = makeModel([
			makeSection({
				portals: [
					{ position: { x: 0, y: 0, z: 0 }, boundaryLines: [], linkSection: 0 },
					{ position: { x: 0, y: 0, z: 0 }, boundaryLines: [], linkSection: 0xffff },
				],
			}),
		]);
		expect(expandAISectionsCascade(model, [{ kind: 'section', sectionIdx: 0 }]))
			.toEqual([{ kind: 'section', sectionIdx: 0 }]);
	});

	it('matches a mirror portal on position as well as linkSection', () => {
		// `linkSection` alone is not enough: a pair of sections can be joined
		// through two separate edges, so a reverse portal that points back at
		// the source but sits somewhere else is a DIFFERENT join.
		const model = makeTrio();
		const moved: ParsedAISectionsV12 = {
			...model,
			sections: model.sections.map((s, i) =>
				i === 0
					? { ...s, portals: [{ ...s.portals[0], position: { x: 999, y: 0, z: 999 } }] }
					: s),
		};
		const out = expandAISectionsCascade(moved, SEL_1);
		expect(out).not.toContainEqual({ kind: 'portal', sectionIdx: 0, portalIdx: 0 });
	});

	it('returns the input list by reference when nothing cascades', () => {
		const model = makeTrio();
		// Sub-entity drags are the "tear it off the join" gesture — the only
		// way to fix a bad weld — so they deliberately cascade to nothing.
		const subEntity: AISectionRef[] = [{ kind: 'corner', sectionIdx: 1, cornerIdx: 0 }];
		expect(expandAISectionsCascade(model, subEntity)).toBe(subEntity);
	});
});

describe('expandAISectionsCascade + transform', () => {
	it('drags the outside neighbours reverse portal and shared corners along', () => {
		const model = makeTrio();
		const refs = expandAISectionsCascade(model, SEL_1);
		const next = transform(
			model,
			refs,
			delta({ translate: { x: 5, y: 0, z: 0 } }),
			createAISectionsResolver(model),
		);
		expect(next.sections[0].portals[0].position).toEqual({ x: 15, y: 0, z: 5 });
		expect(next.sections[0].corners[1]).toEqual({ x: 15, y: 0 });
		expect(next.sections[0].corners[2]).toEqual({ x: 15, y: 10 });
		// Corners away from the join stay put: the neighbour stretches rather
		// than translating wholesale, keeping ITS other joins stationary.
		expect(next.sections[0].corners[0]).toEqual({ x: 0, y: 0 });
		expect(next.sections[2].portals[0].position).toEqual({ x: 25, y: 0, z: 5 });
	});

	it('carries the vertical component into cascaded portal anchors', () => {
		// Deliberate behaviour change: the old `translateSectionWithLinks` had
		// no `dy` parameter at all, so a cascade-on vertical drag left mirror
		// portals behind at the old height.
		const model = makeTrio();
		const refs = expandAISectionsCascade(model, SEL_1);
		const next = transform(
			model,
			refs,
			delta({ translate: { x: 0, y: 4, z: 0 } }),
			createAISectionsResolver(model),
		);
		expect(next.sections[0].portals[0].position.y).toBe(4);
	});

	it('orbits cascaded slots about the shared pivot, keeping the join coincident', () => {
		const model = makeTrio();
		const refs = expandAISectionsCascade(model, SEL_1);
		const next = transform(
			model,
			refs,
			delta({ rotate: { x: 0, y: Math.PI, z: 0 }, pivot: { x: 15, y: 0, z: 5 } }),
			createAISectionsResolver(model),
		);
		// s0's reverse portal at (10, 5) spun 180° about (15, 5) lands at (20, 5).
		expect(next.sections[0].portals[0].position.x).toBeCloseTo(20, 6);
		expect(next.sections[0].portals[0].position.z).toBeCloseTo(5, 6);
		// The pair is still coincident: s1's portal back at s0 lands there too.
		expect(next.sections[1].portals[0].position.x).toBeCloseTo(20, 6);
		expect(next.sections[1].portals[0].position.z).toBeCloseTo(5, 6);
	});

	it('leaves sections nobody cascaded into === so the orange highlight stays honest', () => {
		const model = makeTrio();
		const isolated = makeModel([...model.sections, makeSection({ id: 0xd })]);
		const refs = expandAISectionsCascade(isolated, SEL_1);
		const next = transform(
			isolated,
			refs,
			delta({ translate: { x: 5, y: 0, z: 0 } }),
			createAISectionsResolver(isolated),
		);
		expect(next.sections[3]).toBe(isolated.sections[3]);
	});
});
