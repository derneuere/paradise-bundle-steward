// Shared state between PolygonSoupListPage and PolygonSoupListViewport.
//
// The viewport needs:
//   1. The full list of parsed PSL resources (so it can render all of them
//      in a single batched draw call — not just the one the schema editor
//      is currently editing).
//   2. Which resource is currently selected, for highlighting.
//   3. A callback to fire when the user clicks on collision geometry, so
//      the page can switch the active resource + navigate the schema tree.
//
// Kept in its own tiny file (no JSX) so both the page and the viewport can
// import it without dragging React component code into each other.

import { createContext, useContext } from 'react';
import type { ParsedPolygonSoupList } from '@/lib/core/polygonSoupList';

export type PolygonSoupListContextValue = {
	/** Every PSL resource in the loaded bundle, in resource-index order.
	 *  Entries that failed to parse are `null` to keep indexes aligned. */
	models: (ParsedPolygonSoupList | null)[];
	/** Resource index currently owned by the schema editor. */
	selectedModelIndex: number;
	/** Fired when the user clicks collision geometry in the 3D view.
	 *  `soupIndex` is the soup within `models[modelIndex]` that was hit. */
	onSelect: (modelIndex: number, soupIndex: number) => void;
};

export const PolygonSoupListContext = createContext<PolygonSoupListContextValue | null>(null);

export function usePolygonSoupListContext(): PolygonSoupListContextValue | null {
	return useContext(PolygonSoupListContext);
}
