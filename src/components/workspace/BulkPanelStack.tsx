// BulkPanelStack — right-sidebar list of every non-empty AI Sections bulk
// across every loaded bundle. Lives below the regular `RightInspector` form
// in `WorkspacePage`'s right column, so the user can see their bulks while
// the inspector continues to focus on whatever resource they navigated to.
//
// One panel per bulk; sort by `lastTouchedAt` desc so the panel the user
// just touched rises to the top. Each panel:
//   - Header: chevron, bundle filename, resource label, count, [✕]
//   - Title click: `select(...)` jumps the inspector back to the bulk's
//     instance (path: []), so the user can return to the inspector form
//     for that resource without losing their bulk.
//   - [✕] click: clears that bulk only (other bulks coexist).
//   - Body (when expanded): placeholder for Slice 2 export buttons.
//
// PSL retrofit (mounting PSL bulks here too) is explicitly OUT OF SCOPE for
// Slice 1 — see CONTEXT/spec. This stack only consults
// `useWorkspaceAISectionsBulk`. Adding PSL would mean teaching this stack to
// fan out across multiple bulk-providers; we'll do that when Slice 2 needs it.

import { useState, useMemo } from 'react';
import { ChevronDown, ChevronRight, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useWorkspace } from '@/context/WorkspaceContext';
import { getHandlerByKey } from '@/lib/core/registry';
import {
	useWorkspaceAISectionsBulk,
	type WorkspaceAISectionsBulkSummary,
} from './AISectionsBulkProvider';
import { sortBulkSummaries } from './bulkPanelStack.helpers';
import type { EditableBundle } from '@/context/WorkspaceContext.types';

const AI_KEY = 'aiSections';

// ---------------------------------------------------------------------------
// Stack
// ---------------------------------------------------------------------------

export function BulkPanelStack() {
	const aiBulk = useWorkspaceAISectionsBulk();
	const { bundles, select } = useWorkspace();

	const sorted = useMemo<readonly WorkspaceAISectionsBulkSummary[]>(
		() => (aiBulk ? sortBulkSummaries(aiBulk.summaries) : []),
		[aiBulk],
	);

	if (!aiBulk || sorted.length === 0) return null;

	return (
		<div className="border-t bg-card/40">
			<div className="px-3 py-2 text-[11px] uppercase tracking-wide text-muted-foreground">
				Bulk selections
			</div>
			<div className="space-y-1 px-2 pb-2">
				{sorted.map((s) => {
					const bundle = bundles.find((b) => b.id === s.bundleId);
					return (
						<BulkPanel
							key={`${s.bundleId}::${s.index}`}
							summary={s}
							bundle={bundle}
							onNavigate={() =>
								select({
									bundleId: s.bundleId,
									resourceKey: AI_KEY,
									index: s.index,
									path: [],
								})
							}
							onClear={() => aiBulk.onClear(s.bundleId, s.index)}
						/>
					);
				})}
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// One panel
// ---------------------------------------------------------------------------

export function BulkPanel({
	summary,
	bundle,
	onNavigate,
	onClear,
}: {
	summary: WorkspaceAISectionsBulkSummary;
	bundle: EditableBundle | undefined;
	onNavigate: () => void;
	onClear: () => void;
}) {
	const [expanded, setExpanded] = useState(false);

	const handler = getHandlerByKey(AI_KEY);
	const resourceLabel = handler?.name ?? AI_KEY;
	const filename = bundle?.id ?? summary.bundleId;

	return (
		<div className="rounded border border-amber-500/40 bg-amber-500/5">
			<div className="flex items-center gap-1 px-2 py-1.5">
				<button
					type="button"
					onClick={() => setExpanded((v) => !v)}
					className="shrink-0 p-0.5 rounded hover:bg-muted/40"
					aria-label={expanded ? 'Collapse panel' : 'Expand panel'}
					aria-expanded={expanded}
				>
					{expanded ? (
						<ChevronDown className="h-3 w-3 text-muted-foreground" />
					) : (
						<ChevronRight className="h-3 w-3 text-muted-foreground" />
					)}
				</button>
				<button
					type="button"
					onClick={onNavigate}
					className="flex-1 min-w-0 flex items-center gap-1.5 px-1 py-0.5 rounded hover:bg-muted/40 text-left"
					title={`Jump inspector to ${filename} · ${resourceLabel} #${summary.index}`}
				>
					<span className="truncate text-xs font-medium" title={filename}>
						{filename}
					</span>
					<span className="text-[10px] text-muted-foreground shrink-0">·</span>
					<span className="truncate text-[11px] text-muted-foreground" title={resourceLabel}>
						{resourceLabel}
					</span>
					<Badge variant="outline" className="ml-auto h-4 px-1.5 text-[10px] tabular-nums shrink-0">
						{summary.count}
					</Badge>
				</button>
				<button
					type="button"
					onClick={onClear}
					className="shrink-0 p-0.5 rounded text-muted-foreground hover:bg-muted hover:text-foreground"
					aria-label={`Clear bulk for ${filename}`}
					title="Clear this bulk"
				>
					<X className="h-3 w-3" />
				</button>
			</div>
			{expanded && (
				<div className="px-3 py-2 border-t border-amber-500/40">
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className="h-6 text-xs"
						onClick={onClear}
					>
						Clear
					</Button>
					{/* TODO: Slice 2 ships export-to-JSON / import-from-JSON / V4→V12
					    migration buttons here. Slice 1 only needs the stack to
					    exist + clear; the buttons land in the next slice. */}
				</div>
			)}
		</div>
	);
}
