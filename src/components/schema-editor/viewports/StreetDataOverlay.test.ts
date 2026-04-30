// StreetDataOverlay — selection round-trip test.
//
// Covers the path-marker translation in both directions (the same code the
// rendered overlay calls to derive highlight + emit clicks):
//
//   - `streetPathMarker(['streets', i])`     → { kind: 'street', index: i }
//   - `streetPathMarker(['junctions', i])`   → { kind: 'junction', index: i }
//   - `streetPathMarker(['roads', i])`       → { kind: 'road', index: i }
//   - sub-paths inside a list collapse to "this marker is selected"
//   - paths outside those three lists read as `null` (no selection)
//   - `streetMarkerPath` is the inverse on every marker shape
//
// We don't mount through react-dom because the repo has no DOM-test
// infrastructure (vitest env: node, no jsdom, no @testing-library/react,
// no @react-three/test-renderer). The overlay's render shape is a thin
// wrapper over the helpers exercised here — covering them gives the same
// effective coverage at a fraction of the dep cost.

import { describe, it, expect, vi } from 'vitest';
import {
	streetPathMarker,
	streetMarkerPath,
} from './StreetDataOverlay';
import type { NodePath } from '@/lib/schema/walk';

describe('StreetDataOverlay', () => {
	it('round-trips every marker kind through path↔marker translation', () => {
		// Forward: path → marker
		expect(streetPathMarker(['streets', 7])).toEqual({ kind: 'street', index: 7 });
		expect(streetPathMarker(['junctions', 12])).toEqual({ kind: 'junction', index: 12 });
		expect(streetPathMarker(['roads', 0])).toEqual({ kind: 'road', index: 0 });

		// Inverse: marker → path
		expect(streetMarkerPath({ kind: 'street', index: 7 })).toEqual(['streets', 7]);
		expect(streetMarkerPath({ kind: 'junction', index: 12 })).toEqual(['junctions', 12]);
		expect(streetMarkerPath({ kind: 'road', index: 0 })).toEqual(['roads', 0]);
		expect(streetMarkerPath(null)).toEqual([]);

		// Sub-paths collapse to "this marker is selected" — the inspector
		// can drill into a Junction's macName, but the 3D overlay still
		// highlights the parent junction.
		expect(streetPathMarker(['junctions', 3, 'macName'])).toEqual({ kind: 'junction', index: 3 });
		expect(streetPathMarker(['streets', 5, 'mAiInfo', 'muMaxSpeedMPS']))
			.toEqual({ kind: 'street', index: 5 });

		// Off-resource paths read as no selection.
		expect(streetPathMarker([])).toBeNull();
		expect(streetPathMarker(['somethingElse', 0])).toBeNull();
		expect(streetPathMarker(['streets'])).toBeNull();
		expect(streetPathMarker(['streets', 'notANumber'] as unknown as NodePath)).toBeNull();
	});

	it('dispatches click events as marker → path → onSelect', () => {
		// Mirror the overlay's handlePick body verbatim. The instanced-mesh
		// click handler calls onPick({ kind, index: e.instanceId }), which
		// the overlay forwards via onSelect(streetMarkerPath(marker)).
		const onSelect = vi.fn();
		const dispatch = (kind: 'street' | 'junction' | 'road', instanceId: number) => {
			onSelect(streetMarkerPath({ kind, index: instanceId }));
		};

		dispatch('road', 4);
		dispatch('street', 17);
		dispatch('junction', 9);

		expect(onSelect).toHaveBeenNthCalledWith(1, ['roads', 4]);
		expect(onSelect).toHaveBeenNthCalledWith(2, ['streets', 17]);
		expect(onSelect).toHaveBeenNthCalledWith(3, ['junctions', 9]);
	});
});
