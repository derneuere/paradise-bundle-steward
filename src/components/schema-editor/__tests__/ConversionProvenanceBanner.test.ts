// ConversionProvenanceBanner — banner-content unit tests.
//
// Mirrors the test approach used elsewhere in this folder (e.g.
// ZoneListOverlay.test.ts): the repo's vitest env is `node` with no
// jsdom / @testing-library/react, so we don't mount the React component
// directly. Instead, we cover:
//
//   - the pure formatter (`formatBannerHeading`) the component renders
//   - the `hasFieldsToReport` predicate that decides whether a banner
//     has anything substantive to show
//   - the dismissal contract on the workspace provenance store —
//     dismissing immediately suppresses the banner via `getActiveProvenance`,
//     which is the same query the component uses to decide whether to
//     render. Together those exercise the full "click Dismiss → banner
//     unmounts" flow without a DOM.

import { describe, it, expect } from 'vitest';
import {
	formatBannerHeading,
	hasFieldsToReport,
	type ConversionProvenance,
} from '../conversionProvenanceBanner.helpers';
import {
	dismissProvenance,
	getActiveProvenance,
	provenanceKey,
	recordProvenance,
} from '@/context/WorkspaceContext.provenance';

const SAMPLE: ConversionProvenance = {
	sourceKind: 'v4',
	targetKind: 'v12',
	defaulted: ['aiSections: spanIndex', 'aiSections: district'],
	lossy: ['aiSections: speed (from dangerRating)', 'aiSections: flags'],
	exportedAt: 1714521600000,
};

describe('formatBannerHeading', () => {
	it("matches the issue's wording — 'Converted from V4 to V12'", () => {
		// Banner content per issue #38: "Converted from V4 — defaulted: ...
		// Interpreted: ...". The heading wraps source/target kinds upper-
		// cased so 'v4' -> 'V4' without each migration registering a display
		// variant of its own.
		expect(formatBannerHeading(SAMPLE)).toBe('Converted from V4 to V12');
	});

	it('upper-cases arbitrary kind discriminators', () => {
		expect(
			formatBannerHeading({ ...SAMPLE, sourceKind: 'default', targetKind: 'pc' }),
		).toBe('Converted from DEFAULT to PC');
	});
});

describe('hasFieldsToReport', () => {
	it('true when defaulted is non-empty and lossy is empty', () => {
		expect(
			hasFieldsToReport({ ...SAMPLE, lossy: [] }),
		).toBe(true);
	});

	it('true when lossy is non-empty and defaulted is empty', () => {
		expect(
			hasFieldsToReport({ ...SAMPLE, defaulted: [] }),
		).toBe(true);
	});

	it('false when both lists are empty (degenerate pure-reshape migration)', () => {
		expect(
			hasFieldsToReport({ ...SAMPLE, defaulted: [], lossy: [] }),
		).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Dismissal contract — exercises the same query the rendered banner uses
// to decide whether to mount. `getActiveProvenance` returns null after
// `dismissProvenance` is called, which is what unmounts the banner in
// the live component.
// ---------------------------------------------------------------------------

describe('Dismiss flow — provenance store', () => {
	it('renders before dismiss, hides after', () => {
		// "Renders" here = `getActiveProvenance` returns the provenance,
		// which is the truthy branch the banner mounts on. After dismiss,
		// it returns null, which is the unmount branch.
		let map = recordProvenance(new Map(), 'AI.DAT', 'aiSections', 0, SAMPLE);
		const before = getActiveProvenance(map, 'AI.DAT', 'aiSections', 0);
		expect(before).not.toBeNull();
		expect(before!.defaulted).toEqual(SAMPLE.defaulted);
		expect(before!.lossy).toEqual(SAMPLE.lossy);

		map = dismissProvenance(map, 'AI.DAT', 'aiSections', 0);
		expect(getActiveProvenance(map, 'AI.DAT', 'aiSections', 0)).toBeNull();
	});

	it('dismiss is per-resource — siblings keep showing the banner', () => {
		// Acceptance criterion from issue #38: "dismissal persists per-
		// resource (not global)". We dismiss instance 0; instance 1 keeps
		// its banner alive.
		let map = recordProvenance(new Map(), 'AI.DAT', 'aiSections', 0, SAMPLE);
		map = recordProvenance(map, 'AI.DAT', 'aiSections', 1, SAMPLE);
		map = dismissProvenance(map, 'AI.DAT', 'aiSections', 0);
		expect(getActiveProvenance(map, 'AI.DAT', 'aiSections', 0)).toBeNull();
		expect(getActiveProvenance(map, 'AI.DAT', 'aiSections', 1)).not.toBeNull();
	});

	it('dismissal survives selection changes — same key still hidden', () => {
		// "Dismissed banners stay dismissed across selection changes" —
		// from the implementation brief. Selection lives outside the
		// provenance map, so the same key lookup after any number of
		// selection toggles must still return null.
		let map = recordProvenance(new Map(), 'AI.DAT', 'aiSections', 0, SAMPLE);
		map = dismissProvenance(map, 'AI.DAT', 'aiSections', 0);
		// Simulate the user clicking elsewhere then back to the same
		// resource — same key, same lookup, must still be hidden.
		const key = provenanceKey('AI.DAT', 'aiSections', 0);
		expect(map.get(key)?.dismissed).toBe(true);
		expect(getActiveProvenance(map, 'AI.DAT', 'aiSections', 0)).toBeNull();
	});
});
