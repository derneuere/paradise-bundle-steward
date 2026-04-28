// Pure history-stack helpers backing the BundleContext undo/redo feature.
//
// Why a separate module: the BundleContext provider is React-coupled and
// hard to unit-test, but the past/future bookkeeping is the part most likely
// to have an off-by-one. Pulling it out keeps the reducer pure and
// well-tested; the React layer just calls these on commit/undo/redo.
//
// The stack does NOT carry the "current" value. The current value lives in
// `parsedResourcesAll` (the source of truth). On undo, the caller reads the
// current value, pushes it onto `future`, then applies the popped past
// entry. This avoids drift if non-tracked code paths mutate the model
// directly (e.g., bundle reload swapping the whole map).

// =============================================================================
// Types & defaults
// =============================================================================

export type HistoryStack<T> = {
	/** Snapshots from older commits, oldest at index 0. */
	past: T[];
	/** Snapshots from undone commits, newest at index 0 (closest to "redo this next"). */
	future: T[];
};

/**
 * Cap on stack depth. Each entry is a full parsed model snapshot — for a
 * large bundle that's a few hundred KB to a couple of MB; immutable
 * structural sharing helps but at some point we have to bound memory.
 * 50 entries gives "back out the last hour or so of edits" without growing
 * unboundedly across a long session.
 */
export const HISTORY_CAP = 50;

export const emptyHistory = <T>(): HistoryStack<T> => ({ past: [], future: [] });

// =============================================================================
// Reducer-style helpers
// =============================================================================

/**
 * Record a fresh commit. The `oldValue` is the value being replaced — it
 * goes onto the `past` stack. Any pending `future` (i.e., redoable entries)
 * is dropped: making a new edit forks the timeline, the old redo branch
 * becomes unreachable.
 */
export function recordCommit<T>(stack: HistoryStack<T> | undefined, oldValue: T): HistoryStack<T> {
	const past = [...(stack?.past ?? []), oldValue];
	const trimmed = past.length > HISTORY_CAP ? past.slice(-HISTORY_CAP) : past;
	return { past: trimmed, future: [] };
}

/**
 * Pop the latest past entry. Caller passes `actualCurrent` (read from the
 * source of truth, not the stack) which becomes the head of `future` so a
 * subsequent redo restores it.
 *
 * Returns `null` when the past is empty — the caller should do nothing
 * (and disable the undo button).
 */
export function recordUndo<T>(
	stack: HistoryStack<T>,
	actualCurrent: T,
): { stack: HistoryStack<T>; restored: T } | null {
	if (stack.past.length === 0) return null;
	const restored = stack.past[stack.past.length - 1]!;
	const newPast = stack.past.slice(0, -1);
	const newFuture = [actualCurrent, ...stack.future];
	return { stack: { past: newPast, future: newFuture }, restored };
}

/**
 * Inverse of `recordUndo`. Pops the head of `future` and pushes the
 * `actualCurrent` onto `past`.
 */
export function recordRedo<T>(
	stack: HistoryStack<T>,
	actualCurrent: T,
): { stack: HistoryStack<T>; restored: T } | null {
	if (stack.future.length === 0) return null;
	const restored = stack.future[0]!;
	const newFuture = stack.future.slice(1);
	const newPast = [...stack.past, actualCurrent];
	return { stack: { past: newPast, future: newFuture }, restored };
}

// =============================================================================
// Convenience
// =============================================================================

export const canUndo = (stack: HistoryStack<unknown> | undefined): boolean =>
	(stack?.past.length ?? 0) > 0;

export const canRedo = (stack: HistoryStack<unknown> | undefined): boolean =>
	(stack?.future.length ?? 0) > 0;
