// TriggerDataOverlay — selection round-trip test for every kind plus the
// two player-start singleton paths (which both collapse to the same
// in-3D `playerStart` marker since they share the gold cone).
//
// After the migration to the shared selection module the canonical shape is
// `{ kind, indices: [i] }` (Selection from `./selection/`). The legacy
// `{ kind, index }` aliases (triggerPathMarker / triggerMarkerPath) stay as
// thin wrappers over the codec; this test pins both surfaces.
//
// We don't mount through react-dom — the repo has no DOM-test infra. The
// overlay's render shape is a thin orchestration over the helpers
// exercised here; covering them gives the same effective coverage at a
// fraction of the dep cost.

import { describe, it, expect } from 'vitest';
import {
	triggerMarkerPath,
	triggerPathMarker,
	triggerSelectionCodec,
} from './TriggerDataOverlay';
import type { NodePath } from '@/lib/schema/walk';

describe('TriggerDataOverlay', () => {
	it('round-trips every region kind and singleton path through the codec', () => {
		// Box-region kinds — codec uses the new Selection shape.
		expect(triggerSelectionCodec.pathToSelection(['landmarks', 5])).toEqual({ kind: 'landmark', indices: [5] });
		expect(triggerSelectionCodec.selectionToPath({ kind: 'landmark', indices: [5] })).toEqual(['landmarks', 5]);

		expect(triggerSelectionCodec.pathToSelection(['genericRegions', 12])).toEqual({ kind: 'generic', indices: [12] });
		expect(triggerSelectionCodec.selectionToPath({ kind: 'generic', indices: [12] })).toEqual(['genericRegions', 12]);

		expect(triggerSelectionCodec.pathToSelection(['blackspots', 1])).toEqual({ kind: 'blackspot', indices: [1] });
		expect(triggerSelectionCodec.selectionToPath({ kind: 'blackspot', indices: [1] })).toEqual(['blackspots', 1]);

		expect(triggerSelectionCodec.pathToSelection(['vfxBoxRegions', 3])).toEqual({ kind: 'vfx', indices: [3] });
		expect(triggerSelectionCodec.selectionToPath({ kind: 'vfx', indices: [3] })).toEqual(['vfxBoxRegions', 3]);

		// Vec-positioned kinds
		expect(triggerSelectionCodec.pathToSelection(['spawnLocations', 7])).toEqual({ kind: 'spawn', indices: [7] });
		expect(triggerSelectionCodec.selectionToPath({ kind: 'spawn', indices: [7] })).toEqual(['spawnLocations', 7]);

		expect(triggerSelectionCodec.pathToSelection(['roamingLocations', 0])).toEqual({ kind: 'roaming', indices: [0] });
		expect(triggerSelectionCodec.selectionToPath({ kind: 'roaming', indices: [0] })).toEqual(['roamingLocations', 0]);
	});

	it('back-compat aliases (triggerPathMarker / triggerMarkerPath) keep the legacy `{kind, index}` shape', () => {
		expect(triggerPathMarker(['landmarks', 5])).toEqual({ kind: 'landmark', index: 5 });
		expect(triggerMarkerPath({ kind: 'landmark', index: 5 })).toEqual(['landmarks', 5]);

		expect(triggerPathMarker(['spawnLocations', 7])).toEqual({ kind: 'spawn', index: 7 });
		expect(triggerMarkerPath({ kind: 'spawn', index: 7 })).toEqual(['spawnLocations', 7]);
	});

	it('collapses both player-start singleton paths to the same selection', () => {
		const expected = { kind: 'playerStart', indices: [0] };
		expect(triggerSelectionCodec.pathToSelection(['playerStartPosition'])).toEqual(expected);
		expect(triggerSelectionCodec.pathToSelection(['playerStartDirection'])).toEqual(expected);
		// Inverse always returns the canonical Position path — Direction
		// would just re-collapse on the next round trip anyway.
		expect(triggerSelectionCodec.selectionToPath(expected)).toEqual(['playerStartPosition']);

		// And via the legacy alias.
		expect(triggerPathMarker(['playerStartPosition'])).toEqual({ kind: 'playerStart', index: 0 });
		expect(triggerMarkerPath({ kind: 'playerStart', index: 0 })).toEqual(['playerStartPosition']);
	});

	it('returns null for unknown paths and empty input', () => {
		expect(triggerSelectionCodec.pathToSelection([])).toBeNull();
		expect(triggerSelectionCodec.pathToSelection(['unrelatedList', 0])).toBeNull();
		expect(triggerSelectionCodec.pathToSelection(['landmarks'])).toBeNull();
		expect(triggerSelectionCodec.pathToSelection(['landmarks', 'notANumber'] as unknown as NodePath)).toBeNull();
		expect(triggerMarkerPath(null)).toEqual([]);
		expect(triggerPathMarker([])).toBeNull();
	});
});
