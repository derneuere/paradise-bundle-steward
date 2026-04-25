// Drop-in bulk-selection state for any schema-editor page.
//
// Hosts that wrap SchemaEditor in <SchemaBulkSelectionContext.Provider>
// with the value returned from this hook get Ctrl/Cmd+click to toggle
// any tree row into a bulk set, and Shift+click to extend a range from
// the current inspector selection — for free, without writing any
// page-specific reducer code. Tree rows whose path is in the set
// auto-render with the amber border defined in HierarchyTree.tsx.
//
// "Range" semantics:
//   - If both paths end in a numeric index AND share an identical prefix
//     (everything up to the last segment is the same), every list item
//     between the two indices (inclusive) joins the bulk set.
//   - Otherwise, only the target path is added — Shift+click degrades
//     to plain Ctrl+click in that case rather than silently no-oping.
//
// This matches what PSL hand-rolled for polygons (ranges within the same
// soup), but generalizes to any nested list — Trigger landmarks/blackspots,
// AISection portals, TrafficData static vehicles, etc.

import { useCallback, useState } from 'react';
import type { NodePath } from '@/lib/schema/walk';

/** Canonical stringification used as the Set key. Matches the format
 *  HierarchyTree's `pathKey()` uses for its expansion-state Map, so a
 *  page can compare against either set without converting. */
export function pathKey(path: NodePath): string {
	return path.join('/') || '__root__';
}

/** Expand a Shift+click intent into the list of paths that should be
 *  added to the bulk set. Exported so callers that want a different
 *  set semantics (PSL's polygon-only validation, for example) can
 *  reuse the geometry without taking the whole hook. */
export function rangePathsBetween(from: NodePath, to: NodePath): NodePath[] {
	if (to.length === 0) return [];
	const fromIdx = from[from.length - 1];
	const toIdx = to[to.length - 1];
	// Both must terminate in a numeric index for a "range" to be defined.
	if (typeof fromIdx !== 'number' || typeof toIdx !== 'number') return [to];
	// Different depths can't share a parent list.
	if (from.length !== to.length) return [to];
	// All but the last segment must be identical (same parent list).
	for (let i = 0; i < from.length - 1; i++) {
		if (from[i] !== to[i]) return [to];
	}
	const lo = Math.min(fromIdx, toIdx);
	const hi = Math.max(fromIdx, toIdx);
	const prefix = to.slice(0, -1);
	const out: NodePath[] = [];
	for (let i = lo; i <= hi; i++) out.push([...prefix, i]);
	return out;
}

export type GenericBulkSelection = {
	bulkPathKeys: ReadonlySet<string>;
	onBulkToggle: (path: NodePath) => void;
	onBulkRange: (from: NodePath, to: NodePath) => void;
	clear: () => void;
};

export function useGenericBulkSelection(): GenericBulkSelection {
	const [bulkPathKeys, setBulkPathKeys] = useState<ReadonlySet<string>>(() => new Set());

	const onBulkToggle = useCallback((path: NodePath) => {
		const key = pathKey(path);
		setBulkPathKeys((prev) => {
			const next = new Set(prev);
			if (next.has(key)) next.delete(key);
			else next.add(key);
			return next;
		});
	}, []);

	const onBulkRange = useCallback((from: NodePath, to: NodePath) => {
		setBulkPathKeys((prev) => {
			const next = new Set(prev);
			for (const p of rangePathsBetween(from, to)) next.add(pathKey(p));
			return next;
		});
	}, []);

	const clear = useCallback(() => setBulkPathKeys(new Set()), []);

	return { bulkPathKeys, onBulkToggle, onBulkRange, clear };
}
