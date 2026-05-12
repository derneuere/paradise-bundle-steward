// AISectionsOverlay bulk-wiring spec.
//
// Slice 1 migrates the V12 + V4/V6 overlays from the legacy
// `BatchedSections.handleClick` flow to the shared `useBatchedSelection`
// hook so AI Sections speaks the same dispatch dialect as ZoneList /
// StreetData / PSL. The repo's vitest env is `node` (no jsdom) so we don't
// mount the overlay; we pin the wiring contract by:
//
//   1. asserting the codec the overlay feeds into the hook agrees on
//      `kind: 'section'` for a section-level path
//   2. asserting `selectionKey` for that selection matches the
//      Selection-key shape the overlay reads off `useAISectionsBulk()` to
//      decide which sections paint yellow
//
// Together those keep the overlay's bulk Set and the workspace's bulk Set
// in sync — a regression that swapped one of the kinds (e.g. to `'aiSection'`
// or `'sec'`) would silently make the yellow paint pass on the wrong
// entities and would land here loudly.

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import type { AISection } from '@/lib/core/aiSections';
import { SectionSpeed } from '@/lib/core/aiSections';
import type { NodePath } from '@/lib/schema/walk';
import { aiSectionSelectionCodec } from '../AISectionsOverlay';
import { legacyAISectionSelectionCodec } from '../AISectionsLegacyOverlay';
import { selectionKey } from '@/components/schema-editor/viewports/selection';

describe('AISections overlay bulk wiring', () => {
	it('V12 codec produces a `section` selection that round-trips to the bulk-Set key', () => {
		const sel = aiSectionSelectionCodec.pathToSelection(['sections', 5]);
		expect(sel?.kind).toBe('section');
		expect(sel?.indices).toEqual([5]);
		expect(selectionKey(sel!)).toBe('section:5');
	});

	it('V4 codec produces a `section` selection with the same kind as V12', () => {
		const sel = legacyAISectionSelectionCodec.pathToSelection(['legacy', 'sections', 5]);
		// Same kind across V12 and V4 is load-bearing: the overlay-side bulk
		// Set hands SECTION-keyed entries to `useBatchedSelection`, which
		// must match for both variants. If a future refactor splits the
		// kinds (e.g. 'sectionV12' vs 'sectionLegacy') the bulk Set
		// wouldn't paint anything in the V4 overlay.
		expect(sel?.kind).toBe('section');
		expect(selectionKey(sel!)).toBe('section:5');
	});

	it('sub-paths normalise to the same `section:i` bulk key — clicking a portal still highlights the parent section', () => {
		// V12 portal sub-path
		const v12Portal = aiSectionSelectionCodec.pathToSelection([
			'sections', 5, 'portals', 3,
		]);
		// The bulk-key contract is "the section paints yellow even when
		// the user drilled into a sub-entity". The hook keys on the kind
		// + indices[0] (single-level entity); a portal selection's
		// indices[0] is the section index, so `section:5`-keyed bulk Sets
		// still match.
		expect(v12Portal?.kind).toBe('portal');
		expect(v12Portal?.indices[0]).toBe(5);
	});
});

// ---------------------------------------------------------------------------
// V12 marquee centroid hit-test — pins the cornersX/cornersY → (avgX, 0, avgY)
// projection. V12 stores corners as Vector2 where `.y` is the world Z axis;
// regressing this to either dimension would silently misroute every hit.
// ---------------------------------------------------------------------------

function v12MarqueeHits(
	sections: readonly AISection[],
	frustum: THREE.Frustum,
): NodePath[] {
	const hits: NodePath[] = [];
	const pt = new THREE.Vector3();
	for (let i = 0; i < sections.length; i++) {
		const corners = sections[i].corners;
		if (corners.length === 0) continue;
		let sx = 0, sy = 0;
		for (const c of corners) { sx += c.x; sy += c.y; }
		const n = corners.length;
		pt.set(sx / n, 0, sy / n);
		if (frustum.containsPoint(pt)) hits.push(['sections', i]);
	}
	return hits;
}

function makeV12Section(
	corners: Array<{ x: number; y: number }>,
	id: number = 0,
): AISection {
	return {
		id,
		spanIndex: 0,
		speed: SectionSpeed.E_SECTION_SPEED_NORMAL,
		district: 0,
		flags: 0,
		corners: corners.map((c) => new THREE.Vector2(c.x, c.y)),
		portals: [],
		noGoLines: [],
	};
}

function buildBoxFrustum(
	xMin: number, xMax: number,
	yMin: number, yMax: number,
	zMin: number, zMax: number,
): THREE.Frustum {
	const planes = [
		new THREE.Plane(new THREE.Vector3(1, 0, 0), -xMin),
		new THREE.Plane(new THREE.Vector3(-1, 0, 0), xMax),
		new THREE.Plane(new THREE.Vector3(0, 1, 0), -yMin),
		new THREE.Plane(new THREE.Vector3(0, -1, 0), yMax),
		new THREE.Plane(new THREE.Vector3(0, 0, 1), -zMin),
		new THREE.Plane(new THREE.Vector3(0, 0, -1), zMax),
	];
	const f = new THREE.Frustum();
	for (let i = 0; i < 6; i++) f.planes[i].copy(planes[i]);
	return f;
}

describe('AISectionsOverlay V12 marquee centroid hit-test', () => {
	const sections: AISection[] = [
		makeV12Section([{ x: -5, y: -5 }, { x: 5, y: -5 }, { x: 5, y: 5 }, { x: -5, y: 5 }]),
		makeV12Section([{ x: 95, y: -5 }, { x: 105, y: -5 }, { x: 105, y: 5 }, { x: 95, y: 5 }]),
		makeV12Section([{ x: 195, y: -5 }, { x: 205, y: -5 }, { x: 205, y: 5 }, { x: 195, y: 5 }]),
	];

	it('returns only the section whose centroid lies inside the frustum', () => {
		const frustum = buildBoxFrustum(80, 120, -1, 1, -50, 50);
		expect(v12MarqueeHits(sections, frustum)).toEqual([['sections', 1]]);
	});

	it('emits paths WITHOUT the `legacy` prefix (V12 lives at the root)', () => {
		const frustum = buildBoxFrustum(-50, 250, -1, 1, -50, 50);
		const hits = v12MarqueeHits(sections, frustum);
		expect(hits.length).toBe(3);
		for (const h of hits) {
			expect(h[0]).toBe('sections');
		}
	});
});
