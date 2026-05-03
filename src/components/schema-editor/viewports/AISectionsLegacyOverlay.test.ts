// AISectionsLegacyOverlay — selection round-trip + batched-geometry build test.
//
// Mirrors `AISectionsOverlay.test.ts` (V12) but exercises the V4-specific
// path shape (paths nest under `legacy.sections` rather than directly under
// `sections`) and the inline cornersX[4] / cornersZ[4] storage. We don't
// mount through react-dom — the repo has no DOM-test infra; covering the
// pure helpers gives effective coverage of the overlay's selection contract
// at a fraction of the dep cost.

import { describe, it, expect } from 'vitest';
import {
	legacyAISectionPathMarker,
	legacyAISectionMarkerPath,
	legacyAISectionSelectionCodec,
	buildBatchedLegacySections,
} from './AISectionsLegacyOverlay';
import type { LegacyAISection } from '@/lib/core/aiSections';
import { LegacyDangerRating } from '@/lib/core/aiSections';
import type { NodePath } from '@/lib/schema/walk';

// ---------------------------------------------------------------------------
// Path ↔ marker round-trip
// ---------------------------------------------------------------------------

describe('AISectionsLegacyOverlay path/marker contract', () => {
	it('round-trips every V4 path shape (section, portal, boundary line, no-go line)', () => {
		// Section — V4 paths nest under the `legacy` wrapper field.
		expect(legacyAISectionPathMarker(['legacy', 'sections', 42]))
			.toEqual({ kind: 'section', sectionIndex: 42 });
		expect(legacyAISectionMarkerPath({ kind: 'section', sectionIndex: 42 }))
			.toEqual(['legacy', 'sections', 42]);

		// Portal
		expect(legacyAISectionPathMarker(['legacy', 'sections', 42, 'portals', 3]))
			.toEqual({ kind: 'portal', sectionIndex: 42, portalIndex: 3 });
		expect(legacyAISectionMarkerPath({ kind: 'portal', sectionIndex: 42, portalIndex: 3 }))
			.toEqual(['legacy', 'sections', 42, 'portals', 3]);

		// Boundary line — the deepest shape, seven segments under the wrapper
		expect(legacyAISectionPathMarker(['legacy', 'sections', 42, 'portals', 3, 'boundaryLines', 1])).toEqual({
			kind: 'boundaryLine', sectionIndex: 42, portalIndex: 3, lineIndex: 1,
		});
		expect(legacyAISectionMarkerPath({
			kind: 'boundaryLine', sectionIndex: 42, portalIndex: 3, lineIndex: 1,
		})).toEqual(['legacy', 'sections', 42, 'portals', 3, 'boundaryLines', 1]);

		// No-go line
		expect(legacyAISectionPathMarker(['legacy', 'sections', 42, 'noGoLines', 7]))
			.toEqual({ kind: 'noGoLine', sectionIndex: 42, lineIndex: 7 });
		expect(legacyAISectionMarkerPath({ kind: 'noGoLine', sectionIndex: 42, lineIndex: 7 }))
			.toEqual(['legacy', 'sections', 42, 'noGoLines', 7]);
	});

	it('collapses sub-paths inside a primitive to the nearest selectable marker', () => {
		// Drilling into a portal's midPosition field should still highlight the portal in 3D.
		expect(legacyAISectionPathMarker(['legacy', 'sections', 1, 'portals', 0, 'midPosition', 'x']))
			.toEqual({ kind: 'portal', sectionIndex: 1, portalIndex: 0 });

		// Drilling into a section's parallel cornersX/cornersZ arrays should keep the section highlighted.
		expect(legacyAISectionPathMarker(['legacy', 'sections', 1, 'cornersX', 2]))
			.toEqual({ kind: 'section', sectionIndex: 1 });
		expect(legacyAISectionPathMarker(['legacy', 'sections', 1, 'cornersZ', 0]))
			.toEqual({ kind: 'section', sectionIndex: 1 });

		// Drilling into a boundary-line's verts should keep the boundary line highlighted.
		expect(legacyAISectionPathMarker(['legacy', 'sections', 1, 'portals', 0, 'boundaryLines', 0, 'verts', 'x']))
			.toEqual({ kind: 'boundaryLine', sectionIndex: 1, portalIndex: 0, lineIndex: 0 });
	});

	it('returns null for paths outside the legacy AI sections resource', () => {
		expect(legacyAISectionPathMarker([])).toBeNull();
		// V12-style path (no `legacy` prefix) must NOT match — the V12 overlay
		// owns those, and a false positive here would cross-wire selection.
		expect(legacyAISectionPathMarker(['sections', 42])).toBeNull();
		expect(legacyAISectionPathMarker(['unrelated', 0])).toBeNull();
		expect(legacyAISectionPathMarker(['legacy', 'sections'])).toBeNull();
		expect(legacyAISectionPathMarker(['legacy', 'sections', 'notANumber'] as unknown as NodePath)).toBeNull();
		expect(legacyAISectionMarkerPath(null)).toEqual([]);
	});

	it('exposes the new Selection-module codec with the unified `{kind, indices}` shape and the `legacy` prefix', () => {
		expect(legacyAISectionSelectionCodec.pathToSelection(['legacy', 'sections', 42]))
			.toEqual({ kind: 'section', indices: [42] });
		expect(legacyAISectionSelectionCodec.pathToSelection(['legacy', 'sections', 42, 'portals', 3]))
			.toEqual({ kind: 'portal', indices: [42, 3] });
		expect(legacyAISectionSelectionCodec.pathToSelection(['legacy', 'sections', 42, 'portals', 3, 'boundaryLines', 1]))
			.toEqual({ kind: 'boundaryLine', indices: [42, 3, 1] });
		expect(legacyAISectionSelectionCodec.pathToSelection(['legacy', 'sections', 42, 'noGoLines', 7]))
			.toEqual({ kind: 'noGoLine', indices: [42, 7] });
		// Inverse always carries the `legacy` prefix back.
		expect(legacyAISectionSelectionCodec.selectionToPath({ kind: 'portal', indices: [42, 3] }))
			.toEqual(['legacy', 'sections', 42, 'portals', 3]);
		// V12-style paths (no prefix) read as null — the codec must not
		// false-positive on them.
		expect(legacyAISectionSelectionCodec.pathToSelection(['sections', 42])).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// Batched geometry — V4-specific cornersX / cornersZ projection
// ---------------------------------------------------------------------------

function makeSection(
	cornersX: number[],
	cornersZ: number[],
	dangerRating: number = LegacyDangerRating.E_DANGER_RATING_NORMAL,
): LegacyAISection {
	return {
		portals: [],
		noGoLines: [],
		cornersX,
		cornersZ,
		dangerRating,
		flags: 0,
	};
}

describe('AISectionsLegacyOverlay batched geometry', () => {
	it('emits one fan-triangulated quad per section with face→section mapping', () => {
		const sections: LegacyAISection[] = [
			makeSection([0, 10, 10, 0], [0, 0, 10, 10]),
			makeSection([20, 30, 30, 20], [20, 20, 30, 30]),
		];
		const scene = buildBatchedLegacySections(sections);

		// 2 quads × (4 verts) = 8 fill verts, each emitting (4-2)=2 triangles → 4 faces total.
		expect(scene.fillGeo.getAttribute('position').count).toBe(8);
		expect(scene.faceToSection.length).toBe(4);
		// First two triangles belong to section 0, next two to section 1.
		expect(Array.from(scene.faceToSection)).toEqual([0, 0, 1, 1]);

		// Outline geometry is the polygon perimeter — 4 corners × 2 verts each = 8 per section.
		expect(scene.outlineGeo.getAttribute('position').count).toBe(16);
	});

	it('skips degenerate sections (fewer than 3 valid corners)', () => {
		const sections: LegacyAISection[] = [
			makeSection([0, 10], [0, 0]),                // only 2 corners → skipped
			makeSection([0, 10, 10, 0], [0, 0, 10, 10]), // valid quad → kept
		];
		const scene = buildBatchedLegacySections(sections);

		// Only the valid quad contributes geometry, but the face→section map
		// still references the original index (1) for traceability.
		expect(scene.fillGeo.getAttribute('position').count).toBe(4);
		expect(scene.faceToSection.length).toBe(2);
		expect(Array.from(scene.faceToSection)).toEqual([1, 1]);
	});

	it('uses the V4 cornersX/cornersZ parallel arrays as XZ world coordinates', () => {
		// Hand-checked: for the section [(0,0), (10,0), (10,10), (0,10)] the
		// fill positions land at world (X, 0.1, Z) — Y is the constant ground
		// plane, X comes from cornersX, Z comes from cornersZ. This pins the
		// V4-specific projection so a regression that swapped cornersZ → Y
		// (a plausible bug given V12's `corners[i].y` -> world.z mapping)
		// would fail loudly.
		const sections: LegacyAISection[] = [makeSection([0, 10, 10, 0], [0, 0, 10, 10])];
		const scene = buildBatchedLegacySections(sections);
		const positions = scene.fillGeo.getAttribute('position').array as Float32Array;

		// Vertex 0 — (cornersX[0]=0, ground, cornersZ[0]=0)
		expect(positions[0]).toBe(0);
		expect(positions[1]).toBeCloseTo(0.1);
		expect(positions[2]).toBe(0);
		// Vertex 2 — (cornersX[2]=10, ground, cornersZ[2]=10)
		expect(positions[6]).toBe(10);
		expect(positions[7]).toBeCloseTo(0.1);
		expect(positions[8]).toBe(10);
	});

	it('colors sections by dangerRating (3 buckets: freeway / normal / dangerous)', () => {
		const sections: LegacyAISection[] = [
			makeSection([0, 1, 1, 0], [0, 0, 1, 1], LegacyDangerRating.E_DANGER_RATING_FREEWAY),
			makeSection([0, 1, 1, 0], [0, 0, 1, 1], LegacyDangerRating.E_DANGER_RATING_NORMAL),
			makeSection([0, 1, 1, 0], [0, 0, 1, 1], LegacyDangerRating.E_DANGER_RATING_DANGEROUS),
		];
		const scene = buildBatchedLegacySections(sections);
		const colors = scene.fillGeo.getAttribute('color').array as Float32Array;

		// Each section emits 4 verts × 3 channels = 12 floats. Spot-check the
		// red channel of the first vert in each section — it must vary across
		// the three dangerRating buckets, which is the whole point of the
		// V4-vs-V12 colour difference.
		const reds = [colors[0], colors[12], colors[24]];
		expect(new Set(reds).size).toBe(3);
		// Sanity: dangerous should be the reddest of the three.
		expect(colors[24]).toBeGreaterThan(colors[0]);
		expect(colors[24]).toBeGreaterThan(colors[12]);
	});
});
