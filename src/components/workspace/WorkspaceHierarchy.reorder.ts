// Drag-to-reorder helpers for record-list instance rows in the unified
// Workspace tree (branch feat/prop-instance-reorder).
//
// The tree's list-item rows (`SchemaRow` whose `schemaPath` ends in a numeric
// index — e.g. `['instances', 7]` for a PropInstanceData prop, `['triggers',
// 3]` for a TriggerData entry) can be dragged up/down to reorder them within
// their parent list. This module is the pure core: it has no React / DOM
// dependency so the vitest `node` env exercises the index math and the
// same-list guard directly, mirroring the WorldViewportComposition helper
// tests.
//
// Domain (PropInstanceData, the primary driver): props are stored as one flat
// `instances` array that the writer partitions into spatial `cells` by
// position. Reordering the flat array is exactly the edit the user wants —
// it changes which props fall in each cell's positional run, which fixes the
// respawn/collectible order the Blender exporter gets wrong. We never touch
// `cells`; the writer recomputes the partition (muStartIndex/muCount) from the
// reordered array, and the total count is unchanged so the round-trip stays
// valid. See docs/prop-instance-data-spec.md and
// src/lib/core/propInstanceData.ts.

import { updateAtPath, type NodePath } from '@/lib/schema/walk';

// ---------------------------------------------------------------------------
// Pure array move
// ---------------------------------------------------------------------------

// Move the element at `from` to `to`, returning a NEW array (structural
// sharing — the source array is never mutated). `to` is the destination index
// in the post-removal coordinate space, i.e. the index the moved item ends up
// occupying. Out-of-range / no-op moves return a shallow copy so callers can
// treat the result uniformly without an identity surprise.
export function moveItem<T>(arr: readonly T[], from: number, to: number): T[] {
	const next = arr.slice();
	if (
		from < 0 ||
		from >= next.length ||
		to < 0 ||
		to >= next.length ||
		from === to
	) {
		return next;
	}
	const [moved] = next.splice(from, 1);
	next.splice(to, 0, moved);
	return next;
}

// ---------------------------------------------------------------------------
// Reorderable-row identification
// ---------------------------------------------------------------------------

// A schema row is a reorderable list item iff its path ends in a numeric
// segment — that segment is its index inside the parent list, and everything
// before it is the list path. `['instances', 7]` → list `['instances']`,
// index 7. `['cells', 2, 'foo']` is NOT a list item (ends in a string), and a
// top-level field like `['instances']` is the list itself, not an item.
export type ListItemAddress = {
	/** Path to the enclosing list (the row's `schemaPath` minus its last segment). */
	listPath: NodePath;
	/** Item's index within that list (the row's last path segment). */
	index: number;
};

export function listItemAddress(schemaPath: NodePath): ListItemAddress | null {
	if (schemaPath.length === 0) return null;
	const last = schemaPath[schemaPath.length - 1];
	if (typeof last !== 'number') return null;
	return { listPath: schemaPath.slice(0, -1), index: last };
}

// ---------------------------------------------------------------------------
// Drag payload + same-list guard
// ---------------------------------------------------------------------------

// What a drag carries. A drop is only honoured when the target row addresses
// the SAME list in the SAME instance of the SAME resource in the SAME bundle —
// reordering can't move an item across lists, instances, resources, or
// bundles. The `index` differs between source and target (that's the move); the
// rest must match exactly.
export type ReorderDragSource = {
	bundleId: string;
	resourceKey: string;
	/** Instance index of the resource (top-level multi-instance address). */
	instanceIndex: number;
	/** Path to the enclosing list within the instance's model. */
	listPath: NodePath;
	/** The dragged item's index within that list. */
	itemIndex: number;
};

function samePath(a: NodePath, b: NodePath): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		if (a[i] !== b[i]) return false;
	}
	return true;
}

// True when `target` is a valid drop site for `source`: same bundle, resource,
// instance, and list path. Index equality is intentionally NOT required — a
// drop onto the row you started dragging is a no-op the caller can short-
// circuit, but it's still a "same list" target.
export function isSameReorderList(
	source: ReorderDragSource,
	target: Omit<ReorderDragSource, 'itemIndex'>,
): boolean {
	return (
		source.bundleId === target.bundleId &&
		source.resourceKey === target.resourceKey &&
		source.instanceIndex === target.instanceIndex &&
		samePath(source.listPath, target.listPath)
	);
}

// ---------------------------------------------------------------------------
// Model reorder
// ---------------------------------------------------------------------------

// Produce the next instance model with the item at `from` moved to `to` inside
// the list at `listPath`. Structural sharing throughout: `updateAtPath` clones
// only the spine down to the list, and `moveItem` clones only the list array.
// Returns the original `model` reference unchanged when the move is a no-op
// (same index) so callers can skip a pointless write + history entry.
export function reorderListInModel(
	model: unknown,
	listPath: NodePath,
	from: number,
	to: number,
): unknown {
	if (from === to) return model;
	return updateAtPath(model, listPath, (current) => {
		if (!Array.isArray(current)) return current;
		return moveItem(current, from, to);
	});
}
