// Pure helper for `BulkPanelStack` ordering. Lives in `.ts` so the test
// under `__tests__/` can pin the most-recently-touched-first contract
// without dragging in React.
//
// Why "most recently touched": a user curating multiple bulks (e.g.
// V4 + V12 side-by-side comparison) wants the one they just edited at
// the top of the stack so they don't lose track of it. Bundle load order
// is the implicit tie-breaker because `summaries` walks the underlying
// Map in insertion order — the comparator preserves that for equal
// timestamps via a stable sort (`Array.prototype.sort` is stable in
// every modern JS engine).

import type { WorkspaceAISectionsBulkSummary } from './AISectionsBulkProvider';

export function sortBulkSummaries(
	summaries: readonly WorkspaceAISectionsBulkSummary[],
): WorkspaceAISectionsBulkSummary[] {
	const out = [...summaries];
	out.sort((a, b) => b.lastTouchedAt - a.lastTouchedAt);
	return out;
}
