// Pure-function helpers backing WorkspaceContext.tsx.
//
// Why a separate module: the React provider is hard to unit-test (no DOM in
// our vitest environment), but the model-edit and visibility-cascade
// reducers are the parts most likely to have an off-by-one. Extracting
// them keeps the heavy lifting testable; the provider just wires React
// state to these and dispatches toasts.

import type {
	BundleId,
	EditableBundle,
	VisibilityNode,
} from './WorkspaceContext.types';

// ---------------------------------------------------------------------------
// Visibility — flat key map with three key shapes matching VisibilityNode.
// Default-true semantics: an absent key is visible, only explicit `false`
// is stored.
// ---------------------------------------------------------------------------

export type VisibilityKey = string;

export function visibilityKey(node: VisibilityNode): VisibilityKey {
	if ('index' in node) return `${node.bundleId}::${node.resourceKey}::${node.index}`;
	if ('resourceKey' in node) return `${node.bundleId}::${node.resourceKey}`;
	return node.bundleId;
}

/**
 * Coarser ancestor keys for the cascade lookup. `{bundleId}` and
 * `{bundleId, key}` are the two ancestors of `{bundleId, key, index}`.
 */
export function ancestorKeys(node: VisibilityNode): VisibilityKey[] {
	if ('index' in node) {
		return [node.bundleId, `${node.bundleId}::${node.resourceKey}`];
	}
	if ('resourceKey' in node) {
		return [node.bundleId];
	}
	return [];
}

/**
 * True if `node` would render given the current visibility map. Walks
 * ancestors first — any explicit `false` up the chain wins. Default-true
 * if no entry anywhere up the chain.
 */
export function isVisibleIn(
	visibility: ReadonlyMap<VisibilityKey, boolean>,
	node: VisibilityNode,
): boolean {
	for (const key of ancestorKeys(node)) {
		if (visibility.get(key) === false) return false;
	}
	return visibility.get(visibilityKey(node)) !== false;
}

/**
 * Returns the entries to drop from the visibility map when a Bundle is
 * closed. Anything keyed by the Bundle's id, or prefixed with
 * `${bundleId}::`, is no longer addressable.
 */
export function visibilityKeysForBundle(
	visibility: ReadonlyMap<VisibilityKey, boolean>,
	bundleId: BundleId,
): VisibilityKey[] {
	const out: VisibilityKey[] = [];
	for (const key of visibility.keys()) {
		if (key === bundleId || key.startsWith(`${bundleId}::`)) {
			out.push(key);
		}
	}
	return out;
}

// ---------------------------------------------------------------------------
// EditableBundle reducer — applies a `(key, index, value)` write to a
// Bundle's resource maps and dirty bookkeeping. Used by both the user-
// facing `setResource` / `setResourceAt` paths and the undo/redo restore
// path so they share a single source of truth for "what an edit looks
// like."
// ---------------------------------------------------------------------------

export function applyResourceWriteToBundle(
	bundle: EditableBundle,
	key: string,
	index: number,
	next: unknown | null,
): EditableBundle {
	const nextAll = new Map(bundle.parsedResourcesAll);
	const list = nextAll.get(key)?.slice() ?? [];
	while (list.length <= index) list.push(null);
	list[index] = next;
	nextAll.set(key, list);

	const nextSingle = new Map(bundle.parsedResources);
	if (index === 0) {
		if (next == null) nextSingle.delete(key);
		else nextSingle.set(key, next);
	}

	const nextDirty = new Set(bundle.dirtyMulti);
	nextDirty.add(`${key}:${index}`);

	return {
		...bundle,
		parsedResourcesAll: nextAll,
		parsedResources: nextSingle,
		dirtyMulti: nextDirty,
		isModified: true,
	};
}

/**
 * Resets the dirty-tracking bookkeeping after a save. The model maps stay
 * intact — only the dirty set and the modified flag clear.
 */
export function clearBundleDirty(bundle: EditableBundle): EditableBundle {
	return {
		...bundle,
		dirtyMulti: new Set(),
		isModified: false,
	};
}
