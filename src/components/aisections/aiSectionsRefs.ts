// Edge adapter: the overlay's selection currency → the ONE AI-sections ref
// union the shared transform core speaks.
//
// Three naming families used to describe the same seven things — the bulk ops'
// `AISectionEntityRef` (kind `portal`, field `end`), the overlay's `DragTarget`
// (kind `portalAnchor`, field `endIdx`) and the selection marker (field
// `endIndex`). `AISectionRef` is the one that survived; this file is the single
// place the marker's `*Index` spelling is translated, so nothing downstream has
// to know two names for one thing.

import type { AISectionMarker } from '@/components/aisections/shared';
import type { AISectionRef, LineEnd } from '@/lib/core/transform/resolvers/aiSections';

// The marker carries `endIndex` as a plain number (it comes off a NodePath),
// while the ref union narrows it to the two ends a packed Vector4 actually has.
const toEnd = (n: number): LineEnd => (n === 0 ? 0 : 1);

/**
 * Translate an inspector marker into the ref the transform core addresses.
 * Returns null only for "nothing selected" — every marker kind, including the
 * two whole-line ones, has a ref. The whole-line refs are selectable but not
 * transformable: they expand to zero slots, so the gizmo simply does not
 * appear (see the resolver's `expand`).
 */
export function markerToAISectionRef(marker: AISectionMarker): AISectionRef | null {
	if (!marker) return null;
	switch (marker.kind) {
		case 'section':
			return { kind: 'section', sectionIdx: marker.sectionIndex };
		case 'corner':
			return { kind: 'corner', sectionIdx: marker.sectionIndex, cornerIdx: marker.cornerIndex };
		case 'portal':
			return { kind: 'portal', sectionIdx: marker.sectionIndex, portalIdx: marker.portalIndex };
		case 'boundaryLine':
			return {
				kind: 'boundaryLine',
				sectionIdx: marker.sectionIndex,
				portalIdx: marker.portalIndex,
				lineIdx: marker.lineIndex,
			};
		case 'noGoLine':
			return { kind: 'noGoLine', sectionIdx: marker.sectionIndex, lineIdx: marker.lineIndex };
		case 'boundaryLineEndpoint':
			return {
				kind: 'boundaryLineEndpoint',
				sectionIdx: marker.sectionIndex,
				portalIdx: marker.portalIndex,
				lineIdx: marker.lineIndex,
				end: toEnd(marker.endIndex),
			};
		case 'noGoLineEndpoint':
			return {
				kind: 'noGoLineEndpoint',
				sectionIdx: marker.sectionIndex,
				lineIdx: marker.lineIndex,
				end: toEnd(marker.endIndex),
			};
	}
}
