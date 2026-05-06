// Pure helper for `BulkPanelStack` ordering. Lives in `.ts` so the test
// under `__tests__/` can pin the most-recently-touched-first contract
// without dragging in React.
//
// Why "most recently touched": a user curating multiple bulks (e.g.
// V4 + V12 side-by-side comparison, or AI sections + TriggerData regions)
// wants the one they just edited at the top of the stack so they don't
// lose track of it. Bundle load order is the implicit tie-breaker because
// `summaries` walks the underlying Map in insertion order — the comparator
// preserves that for equal timestamps via a stable sort
// (`Array.prototype.sort` is stable in every modern JS engine).

/** Minimal shape every bulk summary the panel stack consumes shares —
 *  defining the comparator over a structural type lets `sortBulkSummaries`
 *  work uniformly across AI Sections, TriggerData, and any future
 *  bulk-providing resource without per-key overloads. */
export type SortableBulkSummary = {
	lastTouchedAt: number;
};

export function sortBulkSummaries<T extends SortableBulkSummary>(
	summaries: readonly T[],
): T[] {
	const out = [...summaries];
	out.sort((a, b) => b.lastTouchedAt - a.lastTouchedAt);
	return out;
}
