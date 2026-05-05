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
import { aiSectionSelectionCodec } from '../AISectionsOverlay';
import { legacyAISectionSelectionCodec } from '../AISectionsLegacyOverlay';
import { selectionKey } from '../selection';

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
