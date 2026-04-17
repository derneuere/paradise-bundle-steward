// Collection-picker context consumed by HierarchyTree when a bundle contains
// multiple resources of the same type (e.g. WORLDCOL.BIN has ~200 PSLs).
//
// The tree prepends a list of top-level "resource rows" driven by this
// context. Each row has an eye icon for viewport visibility (click to
// toggle, alt-click to solo) and clicking the row body selects that
// resource for editing. Sort/search/hide-empty state also lives here so
// the tree header can render controls without the hosting page rebuilding
// the whole picker on every keystroke.
//
// When the context is null (single-resource pages like TrafficData /
// StreetData, or bundles with only one resource of a given type), the
// tree renders as it always has.

import { createContext, useContext } from 'react';
import type {
	PickerLabel,
	PickerResourceCtx,
	PickerSortKey,
} from '@/lib/core/registry/handler';

/** One row in the picker. `sortIndex` is the row's position in the currently
 *  sorted + filtered list (for keyboard nav / scroll-to-selected); `modelIndex`
 *  is its position in the underlying bundle-order resource list (stable,
 *  used by `setResourceAt` and viewport geometry ranges). */
export type PickerRow = {
	modelIndex: number;
	ctx: PickerResourceCtx;
	model: unknown | null;
	label: PickerLabel;
	/** `true` when this resource's eye icon is ON (rendered in the viewport).
	 *  Independent of selection. */
	visible: boolean;
};

export type MultiResourcePickerValue = {
	/** Stable identifier for the handler whose resources are being shown
	 *  (`polygonSoupList`, `texture`, ...). Used by the tree to namespace
	 *  expansion keys so switching resources preserves per-resource state. */
	handlerKey: string;

	/** Rows in display order: sorted by `sortKey` and filtered by
	 *  `searchQuery` + `hideEmpty`. Length can differ from the total resource
	 *  count when filters are active. */
	rows: PickerRow[];

	/** Bundle-order index (matches `getResources` / `setResourceAt`) of the
	 *  resource currently owned by the inspector. `-1` when the filter hid
	 *  the selection — the tree renders the selected row anyway so the user
	 *  doesn't lose focus accidentally. */
	selectedModelIndex: number;

	/** Select the given bundle-order model index. Clears any transient
	 *  per-resource state (bulk selection etc.) in the host page. */
	onSelectModel: (modelIndex: number) => void;

	/** Toggle viewport visibility for a single resource (click eye). */
	onToggleVisible: (resourceId: string) => void;

	/** Solo a resource — hide every other resource's visibility. Passing
	 *  the same id again un-solos (restores the prior visibility set). */
	onSoloVisible: (resourceId: string) => void;

	// -------------------------------------------------------------------------
	// Controls shown in the tree header.
	// -------------------------------------------------------------------------

	sortKey: string;
	onSortKeyChange: (id: string) => void;
	sortKeys: PickerSortKey[];

	searchQuery: string;
	onSearchQueryChange: (q: string) => void;

	hideEmpty: boolean;
	onHideEmptyChange: (v: boolean) => void;
};

export const MultiResourcePickerContext =
	createContext<MultiResourcePickerValue | null>(null);

/** Consume the picker context. Returns `null` when the tree is hosted by a
 *  single-resource page. */
export function useMultiResourcePicker(): MultiResourcePickerValue | null {
	return useContext(MultiResourcePickerContext);
}
