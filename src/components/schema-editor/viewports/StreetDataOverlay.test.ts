// StreetDataOverlay — selection round-trip test.
//
// Covers the path↔Selection codec the rendered overlay calls to derive
// highlight + emit clicks. The codec lives in `streetSelectionCodec` and is
// also re-exported as `streetPathMarker`/`streetMarkerPath` aliases so older
// importers keep working. After the migration to the shared selection
// module the marker shape is `{ kind, indices: [i] }` (was `{ kind, index: i }`).
//
//   - `pathToSelection(['streets', i])`     → { kind: 'street', indices: [i] }
//   - `pathToSelection(['junctions', i])`   → { kind: 'junction', indices: [i] }
//   - `pathToSelection(['roads', i])`       → { kind: 'road', indices: [i] }
//   - sub-paths inside a list collapse to "this entity is selected"
//   - paths outside those three lists read as `null` (no selection)
//   - `selectionToPath` is the inverse on every entity-level path
//
// We don't mount through react-dom because the repo has no DOM-test
// infrastructure (vitest env: node, no jsdom, no @testing-library/react,
// no @react-three/test-renderer). The overlay's render shape is a thin
// wrapper over the codec exercised here — covering it gives the same
// effective coverage at a fraction of the dep cost.

import { describe, it, expect, vi } from 'vitest';
import {
	streetSelectionCodec,
	streetPathMarker,
	streetMarkerPath,
} from './StreetDataOverlay';
import type { NodePath } from '@/lib/schema/walk';

describe('StreetDataOverlay', () => {
	it('round-trips every entity kind through path↔Selection translation', () => {
		// Forward: path → Selection
		expect(streetSelectionCodec.pathToSelection(['streets', 7])).toEqual({ kind: 'street', indices: [7] });
		expect(streetSelectionCodec.pathToSelection(['junctions', 12])).toEqual({ kind: 'junction', indices: [12] });
		expect(streetSelectionCodec.pathToSelection(['roads', 0])).toEqual({ kind: 'road', indices: [0] });

		// Inverse: Selection → path
		expect(streetSelectionCodec.selectionToPath({ kind: 'street', indices: [7] })).toEqual(['streets', 7]);
		expect(streetSelectionCodec.selectionToPath({ kind: 'junction', indices: [12] })).toEqual(['junctions', 12]);
		expect(streetSelectionCodec.selectionToPath({ kind: 'road', indices: [0] })).toEqual(['roads', 0]);

		// Back-compat alias: `streetMarkerPath(null)` returns `[]`.
		expect(streetMarkerPath(null)).toEqual([]);

		// Sub-paths collapse to "this entity is selected" — the inspector
		// can drill into a Junction's macName, but the 3D overlay still
		// highlights the parent junction.
		expect(streetPathMarker(['junctions', 3, 'macName'])).toEqual({ kind: 'junction', indices: [3] });
		expect(streetPathMarker(['streets', 5, 'mAiInfo', 'muMaxSpeedMPS']))
			.toEqual({ kind: 'street', indices: [5] });

		// Off-resource paths read as no selection.
		expect(streetPathMarker([])).toBeNull();
		expect(streetPathMarker(['somethingElse', 0])).toBeNull();
		expect(streetPathMarker(['streets'])).toBeNull();
		expect(streetPathMarker(['streets', 'notANumber'] as unknown as NodePath)).toBeNull();
	});

	it('dispatches click events as Selection → path → onSelect', () => {
		// Mirror the overlay's handlePick body verbatim. The instanced-mesh
		// click handler fires onPick({ kind, indices: [e.instanceId] }), which
		// the overlay forwards via onSelect(streetSelectionCodec.selectionToPath(sel)).
		const onSelect = vi.fn();
		const dispatch = (kind: 'street' | 'junction' | 'road', instanceId: number) => {
			onSelect(streetSelectionCodec.selectionToPath({ kind, indices: [instanceId] }));
		};

		dispatch('road', 4);
		dispatch('street', 17);
		dispatch('junction', 9);

		expect(onSelect).toHaveBeenNthCalledWith(1, ['roads', 4]);
		expect(onSelect).toHaveBeenNthCalledWith(2, ['streets', 17]);
		expect(onSelect).toHaveBeenNthCalledWith(3, ['junctions', 9]);
	});
});
