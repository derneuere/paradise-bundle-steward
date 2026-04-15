// Shared state between PolygonSoupListPage and PolygonSoupListViewport.
//
// The viewport needs:
//   1. The full list of parsed PSL resources (so it can render all of them
//      in a single batched draw call — not just the one the schema editor
//      is currently editing).
//   2. Which resource is currently selected, for highlighting.
//   3. A callback to fire when the user clicks on collision geometry, so
//      the page can switch the active resource + navigate the schema tree.
//   4. The subset of polygons in the currently-selected model that belong
//      to the page's bulk selection, for extra highlighting.
//
// The bulk-selection mechanics (building the set, toggling membership) live
// ENTIRELY outside the viewport now — on PolygonSoupListPage, driven by
// ctrl/cmd+click in the hierarchy tree. The viewport only reads the derived
// index set to paint highlighted polys.
//
// Kept in its own tiny file (no JSX) so both the page and the viewport can
// import it without dragging React component code into each other.

import { createContext, useContext } from 'react';
import type { ParsedPolygonSoupList } from '@/lib/core/polygonSoupList';

/** Encode a (soupIndex, polyIndex) pair into a single `number` for a compact
 *  `Set<number>` that the viewport can do O(1) membership checks on while
 *  walking every triangle. Soup and poly indices both fit in 16 bits in
 *  practice (u8 poly count per soup, u32 soups per resource in theory but
 *  realistic fixtures top out at a few thousand). */
export function encodeSoupPoly(soup: number, poly: number): number {
	return (soup << 16) | (poly & 0xFFFF);
}

export type PolygonSoupListContextValue = {
	/** Every PSL resource in the loaded bundle, in resource-index order.
	 *  Entries that failed to parse are `null` to keep indexes aligned. */
	models: (ParsedPolygonSoupList | null)[];
	/** Resource index currently owned by the schema editor. */
	selectedModelIndex: number;
	/** Fired on a click in the 3D viewport. Navigates the schema editor to
	 *  the clicked polygon (and potentially swaps the active resource). */
	onSelect: (modelIndex: number, soupIndex: number, polyIndex: number) => void;
	/** Polygons in the currently-selected model that are in the page's bulk
	 *  selection. Keys are `encodeSoupPoly(soup, poly)`. The viewport tints
	 *  every matching triangle so the user can see their selection in 3D. */
	selectedPolysInCurrentModel: ReadonlySet<number>;
};

export const PolygonSoupListContext = createContext<PolygonSoupListContextValue | null>(null);

export function usePolygonSoupListContext(): PolygonSoupListContextValue | null {
	return useContext(PolygonSoupListContext);
}
