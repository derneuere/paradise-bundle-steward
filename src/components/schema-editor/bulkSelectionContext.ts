// Multi-selection companion to the schema editor's single-select
// `selectedPath`.
//
// The schema editor itself only tracks one selected path at a time — the one
// the inspector is pointed at. Pages that want a "multi-select for bulk edit"
// flow (e.g., PolygonSoupListPage's collision-tag bulk editor) wrap the
// SchemaEditor in this context and provide a Set of path keys plus a toggle
// callback. The hierarchy tree row uses ctrl/cmd+click to invoke the toggle
// and decorates rows that are in the set so the user can see their selection
// at a glance.
//
// Pages that don't provide this context see no change — tree rows behave as
// single-select-only.

import { createContext, useContext } from 'react';
import type { NodePath } from '@/lib/schema/walk';

export type BulkSelectionContextValue = {
	/** Stringified path keys (joined with '/') that are in the bulk selection.
	 *  Must match the key format used by HierarchyTree's `pathKey(path)`. */
	bulkPathKeys: ReadonlySet<string>;
	/** Toggle the given path's membership in the bulk selection. Called on
	 *  ctrl/cmd+click of a tree row. Implementations should silently ignore
	 *  paths that don't correspond to a bulk-editable node. */
	onBulkToggle: (path: NodePath) => void;
};

export const SchemaBulkSelectionContext =
	createContext<BulkSelectionContextValue | null>(null);

export function useSchemaBulkSelection(): BulkSelectionContextValue | null {
	return useContext(SchemaBulkSelectionContext);
}
