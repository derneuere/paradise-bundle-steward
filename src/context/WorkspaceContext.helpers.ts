// Pure-function helpers backing WorkspaceContext.tsx.
//
// Why a separate module: the React provider is hard to unit-test (no DOM in
// our vitest environment), but the model-edit and visibility-cascade
// reducers are the parts most likely to have an off-by-one. Extracting
// them keeps the heavy lifting testable; the provider just wires React
// state to these and dispatches toasts.

import type { HistoryStack } from '@/lib/history';
import { isVisibilityRelevantKey } from '@/components/workspace/WorkspaceHierarchy.helpers';
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
// Solo gesture (issue #26) — alt+click on a visibility eye hides every peer
// at the same level inside the same Bundle, and force-shows the soloed
// node's ancestors so it's guaranteed to render. A second alt-press while
// the node is the only visible peer restores full visibility within scope.
// ---------------------------------------------------------------------------

/**
 * Peers at the same scope as `node` that solo would hide. Visibility-relevant
 * resource types only — non-relevant keys never get an eye icon, so hiding
 * them here would be a meaningless write to the visibility map.
 */
function peerNodesFor(
	bundles: readonly EditableBundle[],
	node: VisibilityNode,
): VisibilityNode[] {
	if ('index' in node) {
		// Instance solo hides (a) every other resource type in this Bundle and
		// (b) every other instance inside the soloed node's resource type — see
		// issue #26 acceptance criterion 1.
		const bundle = bundles.find((b) => b.id === node.bundleId);
		if (!bundle) return [];
		const peers: VisibilityNode[] = [];
		for (const [key, list] of bundle.parsedResourcesAll) {
			if (!isVisibilityRelevantKey(key)) continue;
			if (list.length === 0) continue;
			if (key === node.resourceKey) {
				for (let i = 0; i < list.length; i++) {
					if (i === node.index) continue;
					peers.push({ bundleId: node.bundleId, resourceKey: key, index: i });
				}
			} else {
				peers.push({ bundleId: node.bundleId, resourceKey: key });
			}
		}
		return peers;
	}
	if ('resourceKey' in node) {
		const bundle = bundles.find((b) => b.id === node.bundleId);
		if (!bundle) return [];
		const peers: VisibilityNode[] = [];
		for (const [key, list] of bundle.parsedResourcesAll) {
			if (key === node.resourceKey) continue;
			if (!isVisibilityRelevantKey(key)) continue;
			if (list.length === 0) continue;
			peers.push({ bundleId: node.bundleId, resourceKey: key });
		}
		return peers;
	}
	return bundles.filter((b) => b.id !== node.bundleId).map((b) => ({ bundleId: b.id }));
}

/**
 * True if `node` is the only visible peer at its scope. The detection mirrors
 * what `applySolo` would have produced — visible self, every peer hidden via
 * the cascade. Used by the gesture handler to decide whether the second alt-
 * click should restore full visibility or treat the press as a fresh solo.
 */
export function isSoloed(
	visibility: ReadonlyMap<VisibilityKey, boolean>,
	bundles: readonly EditableBundle[],
	node: VisibilityNode,
): boolean {
	if (!isVisibleIn(visibility, node)) return false;
	const peers = peerNodesFor(bundles, node);
	for (const peer of peers) {
		if (isVisibleIn(visibility, peer)) return false;
	}
	// No peers and node visible counts as soloed — alt-clicking again at that
	// point clears any stale within-scope `false` entries the user accumulated
	// before, which matches the legacy PSL "alt to flip back to all visible."
	return true;
}

function applySolo(
	visibility: ReadonlyMap<VisibilityKey, boolean>,
	bundles: readonly EditableBundle[],
	node: VisibilityNode,
): Map<VisibilityKey, boolean> {
	const next = new Map(visibility);
	// Force the soloed node's path visible. Cascade is one-way — an explicit
	// `false` on an ancestor would shadow the soloed node, so we drop those
	// outright. The own-key delete also clears any stale `false` left from a
	// prior plain-click hide.
	next.delete(visibilityKey(node));
	for (const k of ancestorKeys(node)) next.delete(k);
	for (const peer of peerNodesFor(bundles, node)) {
		next.set(visibilityKey(peer), false);
	}
	return next;
}

function restoreFromSolo(
	visibility: ReadonlyMap<VisibilityKey, boolean>,
	bundles: readonly EditableBundle[],
	node: VisibilityNode,
): Map<VisibilityKey, boolean> {
	const next = new Map(visibility);
	if ('resourceKey' in node || 'index' in node) {
		// Resource-type or Instance un-solo: restore full visibility within the
		// Bundle (issue #26 says scope is the Bundle, never crosses Bundles).
		const prefix = `${node.bundleId}::`;
		for (const k of [...next.keys()]) {
			if (k === node.bundleId || k.startsWith(prefix)) next.delete(k);
		}
		return next;
	}
	// Bundle un-solo: drop every Bundle-id key so all loaded bundles default
	// back to visible. Within-bundle entries stay — restoring "all bundles"
	// shouldn't wipe per-instance hides the user set inside any one bundle.
	for (const b of bundles) next.delete(b.id);
	return next;
}

/**
 * Toggle the solo state of `node`. If the node is already the only visible
 * peer at its scope, restores full visibility within scope; otherwise applies
 * solo. Single state update so React batches the visibility map change as one
 * commit (no flash of intermediate visibility).
 */
export function toggleSoloVisibility(
	visibility: ReadonlyMap<VisibilityKey, boolean>,
	bundles: readonly EditableBundle[],
	node: VisibilityNode,
): Map<VisibilityKey, boolean> {
	if (isSoloed(visibility, bundles, node)) {
		return restoreFromSolo(visibility, bundles, node);
	}
	return applySolo(visibility, bundles, node);
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
