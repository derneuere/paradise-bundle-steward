// AISectionsOverlay — selection round-trip test for all four path shapes.
//
// AISections has the deepest path shape so far — six segments at the
// boundary-line level (`['sections', i, 'portals', p, 'boundaryLines', l]`).
// We exercise the path↔marker translation in both directions plus the
// "sub-paths inside a primitive collapse to the parent" rule the inspector
// relies on (clicking a portal's `position.x` row in the inspector still
// keeps the portal highlighted in 3D).
//
// We don't mount through react-dom — the repo has no DOM-test infra. The
// overlay's render shape is a thin wrapper over the helpers exercised here;
// covering them gives the same effective coverage at a fraction of the
// dep cost.

import { describe, it, expect } from 'vitest';
import {
	aiSectionPathMarker,
	aiSectionMarkerPath,
} from './AISectionsOverlay';
import type { NodePath } from '@/lib/schema/walk';

describe('AISectionsOverlay', () => {
	it('round-trips every path shape (section, portal, boundary line, no-go line)', () => {
		// Section
		expect(aiSectionPathMarker(['sections', 42])).toEqual({ kind: 'section', sectionIndex: 42 });
		expect(aiSectionMarkerPath({ kind: 'section', sectionIndex: 42 })).toEqual(['sections', 42]);

		// Portal
		expect(aiSectionPathMarker(['sections', 42, 'portals', 3])).toEqual({
			kind: 'portal', sectionIndex: 42, portalIndex: 3,
		});
		expect(aiSectionMarkerPath({ kind: 'portal', sectionIndex: 42, portalIndex: 3 }))
			.toEqual(['sections', 42, 'portals', 3]);

		// Boundary line — the deepest shape, six segments
		expect(aiSectionPathMarker(['sections', 42, 'portals', 3, 'boundaryLines', 1])).toEqual({
			kind: 'boundaryLine', sectionIndex: 42, portalIndex: 3, lineIndex: 1,
		});
		expect(aiSectionMarkerPath({
			kind: 'boundaryLine', sectionIndex: 42, portalIndex: 3, lineIndex: 1,
		})).toEqual(['sections', 42, 'portals', 3, 'boundaryLines', 1]);

		// No-go line
		expect(aiSectionPathMarker(['sections', 42, 'noGoLines', 7])).toEqual({
			kind: 'noGoLine', sectionIndex: 42, lineIndex: 7,
		});
		expect(aiSectionMarkerPath({ kind: 'noGoLine', sectionIndex: 42, lineIndex: 7 }))
			.toEqual(['sections', 42, 'noGoLines', 7]);
	});

	it('collapses sub-paths inside a primitive to the nearest selectable marker', () => {
		// Drilling into a portal's position field should still highlight the portal in 3D.
		expect(aiSectionPathMarker(['sections', 1, 'portals', 0, 'position', 'x']))
			.toEqual({ kind: 'portal', sectionIndex: 1, portalIndex: 0 });

		// Drilling into a section's `corners` array should keep the section highlighted.
		expect(aiSectionPathMarker(['sections', 1, 'corners', 2, 'x']))
			.toEqual({ kind: 'section', sectionIndex: 1 });

		// Drilling into a boundary-line's verts should keep the boundary line highlighted.
		expect(aiSectionPathMarker(['sections', 1, 'portals', 0, 'boundaryLines', 0, 'verts', 'x']))
			.toEqual({ kind: 'boundaryLine', sectionIndex: 1, portalIndex: 0, lineIndex: 0 });
	});

	it('returns null for paths outside the AI sections resource', () => {
		expect(aiSectionPathMarker([])).toBeNull();
		expect(aiSectionPathMarker(['unrelated', 0])).toBeNull();
		expect(aiSectionPathMarker(['sections'])).toBeNull();
		expect(aiSectionPathMarker(['sections', 'notANumber'] as unknown as NodePath)).toBeNull();
		expect(aiSectionMarkerPath(null)).toEqual([]);
	});
});
