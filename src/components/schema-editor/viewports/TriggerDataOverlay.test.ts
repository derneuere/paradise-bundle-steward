// TriggerDataOverlay — selection round-trip test for every kind plus the
// two player-start singleton paths (which both collapse to the same
// in-3D `playerStart` marker since they share the gold cone).
//
// We don't mount through react-dom — the repo has no DOM-test infra. The
// overlay's render shape is a thin orchestration over the helpers
// exercised here; covering them gives the same effective coverage at a
// fraction of the dep cost.

import { describe, it, expect } from 'vitest';
import {
	triggerMarkerPath,
	triggerPathMarker,
} from './TriggerDataOverlay';
import type { NodePath } from '@/lib/schema/walk';

describe('TriggerDataOverlay', () => {
	it('round-trips every region kind and singleton path through path↔marker', () => {
		// Box-region kinds
		expect(triggerPathMarker(['landmarks', 5])).toEqual({ kind: 'landmark', index: 5 });
		expect(triggerMarkerPath({ kind: 'landmark', index: 5 })).toEqual(['landmarks', 5]);

		expect(triggerPathMarker(['genericRegions', 12])).toEqual({ kind: 'generic', index: 12 });
		expect(triggerMarkerPath({ kind: 'generic', index: 12 })).toEqual(['genericRegions', 12]);

		expect(triggerPathMarker(['blackspots', 1])).toEqual({ kind: 'blackspot', index: 1 });
		expect(triggerMarkerPath({ kind: 'blackspot', index: 1 })).toEqual(['blackspots', 1]);

		expect(triggerPathMarker(['vfxBoxRegions', 3])).toEqual({ kind: 'vfx', index: 3 });
		expect(triggerMarkerPath({ kind: 'vfx', index: 3 })).toEqual(['vfxBoxRegions', 3]);

		// Vec-positioned kinds
		expect(triggerPathMarker(['spawnLocations', 7])).toEqual({ kind: 'spawn', index: 7 });
		expect(triggerMarkerPath({ kind: 'spawn', index: 7 })).toEqual(['spawnLocations', 7]);

		expect(triggerPathMarker(['roamingLocations', 0])).toEqual({ kind: 'roaming', index: 0 });
		expect(triggerMarkerPath({ kind: 'roaming', index: 0 })).toEqual(['roamingLocations', 0]);
	});

	it('collapses both player-start singleton paths to the same marker', () => {
		const expected = { kind: 'playerStart', index: 0 } as const;
		expect(triggerPathMarker(['playerStartPosition'])).toEqual(expected);
		expect(triggerPathMarker(['playerStartDirection'])).toEqual(expected);
		// Inverse always returns the canonical Position path — Direction
		// would just re-collapse on the next round trip anyway.
		expect(triggerMarkerPath(expected)).toEqual(['playerStartPosition']);
	});

	it('returns null for unknown paths and empty input', () => {
		expect(triggerPathMarker([])).toBeNull();
		expect(triggerPathMarker(['unrelatedList', 0])).toBeNull();
		expect(triggerPathMarker(['landmarks'])).toBeNull();
		expect(triggerPathMarker(['landmarks', 'notANumber'] as unknown as NodePath)).toBeNull();
		expect(triggerMarkerPath(null)).toEqual([]);
	});
});
