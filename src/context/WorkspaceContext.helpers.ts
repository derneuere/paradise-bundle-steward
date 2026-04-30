// Pure-function helpers backing WorkspaceContext.tsx.
//
// Why a separate module: the React provider is hard to unit-test (no DOM in
// our vitest environment), but the model-edit and visibility-cascade
// reducers are the parts most likely to have an off-by-one. Extracting
// them keeps the heavy lifting testable; the provider just wires React
// state to these and dispatches toasts.

import type { HistoryStack } from '@/lib/history';
import type {
	BundleId,
	EditableBundle,
	HistoryCommit,
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

// ---------------------------------------------------------------------------
// Load / replace / close helpers
//
// These exist so the multi-Bundle load path can be unit-tested without a DOM.
// The React provider wires them to its `bundles` state and the deferred
// resolver pattern that drives the same-name and dirty-close prompts.
// ---------------------------------------------------------------------------

/**
 * Decide whether a candidate Bundle should be appended to the Workspace or
 * whether the loader needs to ask the user "Replace? Cancel?" before doing
 * anything. The Bundle's filename is its identity (CONTEXT.md / "Bundle
 * filename"), so two Bundles with the same id can never coexist — that's
 * what forces the prompt.
 */
export function classifyLoad(
	bundles: readonly EditableBundle[],
	candidate: EditableBundle,
): { kind: 'append' } | { kind: 'replace'; existing: EditableBundle } {
	const existing = bundles.find((b) => b.id === candidate.id);
	return existing ? { kind: 'replace', existing } : { kind: 'append' };
}

/** Append a candidate Bundle. Order is load order. */
export function appendBundle(
	bundles: readonly EditableBundle[],
	candidate: EditableBundle,
): EditableBundle[] {
	return [...bundles, candidate];
}

/**
 * Swap in a candidate by id. Used after the user picks Replace on the
 * same-name prompt. Caller is responsible for clearing dependent state
 * (Selection, Visibility, history) — those concerns live above the bundle
 * list itself.
 */
export function replaceBundleById(
	bundles: readonly EditableBundle[],
	candidate: EditableBundle,
): EditableBundle[] {
	return bundles.map((b) => (b.id === candidate.id ? candidate : b));
}

/** Drop a Bundle by id — the bundle-list side of `closeBundle`. */
export function removeBundleById(
	bundles: readonly EditableBundle[],
	bundleId: BundleId,
): EditableBundle[] {
	return bundles.filter((b) => b.id !== bundleId);
}

// ---------------------------------------------------------------------------
// History pruning — the closeBundle / replace-on-load side of the global
// undo stack (ADR-0006).
//
// Loading a Bundle does NOT clear history (the stack is per-Workspace, not
// per-Bundle, and persists across loads); but closing a Bundle, or
// replacing one in place via the same-name prompt, has to drop entries
// pointing at it. Restoring a closed Bundle's previous value would
// resurrect the Bundle silently — far worse than losing a few undo entries.
// ---------------------------------------------------------------------------

/**
 * Drop every history commit that referenced a Bundle that no longer exists.
 * Used by both close (after user confirms) and replace (the new bytes shadow
 * the old ones at the same id, so prior commits no longer apply cleanly).
 *
 * Stack identity is preserved when no entries match, so a no-op prune
 * doesn't churn React state.
 */
export function dropHistoryForBundle(
	history: HistoryStack<HistoryCommit>,
	bundleId: BundleId,
): HistoryStack<HistoryCommit> {
	const past = history.past.filter((c) => c.bundleId !== bundleId);
	const future = history.future.filter((c) => c.bundleId !== bundleId);
	if (past.length === history.past.length && future.length === history.future.length) {
		return history;
	}
	return { past, future };
}
