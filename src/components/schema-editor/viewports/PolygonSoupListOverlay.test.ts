// PolygonSoupListOverlay — selection round-trip test.
//
// PolygonSoupList paths are 4 segments deep: `['soups', S, 'polygons', P]`.
// The overlay derives `treeSelectedPoly` from `selectedPath` so tree
// navigation drives the white outline in the 3D scene. Sub-paths inside a
// polygon (e.g. `collisionTag`) collapse to the parent polygon — the
// outline still highlights it while the inspector is editing a primitive.
//
// We don't mount through react-dom — the repo has no DOM-test infra. The
// overlay's render shape is a thin orchestration over the helpers
// exercised here; covering them gives the same effective coverage at a
// fraction of the dep cost.

import { describe, it, expect } from 'vitest';
import {
	polygonSoupSelectionCodec,
	soupPolyAddressPath,
	soupPolyPathAddress,
} from './PolygonSoupListOverlay';
import type { NodePath } from '@/lib/schema/walk';

describe('PolygonSoupListOverlay', () => {
	it('round-trips polygon paths through path↔address', () => {
		expect(soupPolyPathAddress(['soups', 3, 'polygons', 12])).toEqual({ soup: 3, poly: 12 });
		expect(soupPolyAddressPath({ soup: 3, poly: 12 })).toEqual(['soups', 3, 'polygons', 12]);

		expect(soupPolyPathAddress(['soups', 0, 'polygons', 0])).toEqual({ soup: 0, poly: 0 });
		expect(soupPolyAddressPath({ soup: 0, poly: 0 })).toEqual(['soups', 0, 'polygons', 0]);
	});

	it('collapses sub-paths inside a polygon to the parent address', () => {
		// Drilling into collisionTag should still highlight the parent polygon.
		expect(soupPolyPathAddress(['soups', 1, 'polygons', 4, 'collisionTag']))
			.toEqual({ soup: 1, poly: 4 });
		// Even deeper sub-paths still collapse to the polygon.
		expect(soupPolyPathAddress(['soups', 1, 'polygons', 4, 'vertexIndices', 0]))
			.toEqual({ soup: 1, poly: 4 });
	});

	it('returns null for paths that do not address a polygon', () => {
		expect(soupPolyPathAddress([])).toBeNull();
		expect(soupPolyPathAddress(['soups', 1])).toBeNull();
		expect(soupPolyPathAddress(['soups', 1, 'polygons'])).toBeNull();
		// Top-level fields like `aabbTree` aren't editable polygons.
		expect(soupPolyPathAddress(['aabbTree', 0])).toBeNull();
		// Wrong shape: `['soups', S, 'vertices', V]` isn't a polygon address.
		expect(soupPolyPathAddress(['soups', 1, 'vertices', 0])).toBeNull();
		// Non-numeric segments.
		expect(soupPolyPathAddress(['soups', 'one', 'polygons', 0] as unknown as NodePath))
			.toBeNull();
	});

	it('exposes the new Selection-module codec with the unified `{kind, indices}` shape', () => {
		expect(polygonSoupSelectionCodec.pathToSelection(['soups', 3, 'polygons', 12]))
			.toEqual({ kind: 'polygon', indices: [3, 12] });
		// Sub-paths inside a polygon collapse to the parent polygon.
		expect(polygonSoupSelectionCodec.pathToSelection(['soups', 1, 'polygons', 4, 'collisionTag']))
			.toEqual({ kind: 'polygon', indices: [1, 4] });
		// Inverse — every shape round-trips.
		expect(polygonSoupSelectionCodec.selectionToPath({ kind: 'polygon', indices: [3, 12] }))
			.toEqual(['soups', 3, 'polygons', 12]);
		// Off-resource paths read as null.
		expect(polygonSoupSelectionCodec.pathToSelection([])).toBeNull();
		expect(polygonSoupSelectionCodec.pathToSelection(['soups', 1, 'vertices', 0])).toBeNull();
	});
});
