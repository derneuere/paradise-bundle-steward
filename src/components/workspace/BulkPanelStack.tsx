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
import { ChevronDown, ChevronRight, X, Clipboard, Download } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useWorkspace } from '@/context/WorkspaceContext';
import { getHandlerByKey } from '@/lib/core/registry';
import {
	useWorkspaceAISectionsBulk,
	type WorkspaceAISectionsBulkSummary,
} from './AISectionsBulkProvider';
import { sortBulkSummaries } from './bulkPanelStack.helpers';
import {
	buildEnvelopeFromBulk,
	exportEnvelopeFilename,
} from './bulkPanelExport.helpers';
import { encodeBulkEnvelope } from '@/lib/clipboard/bulkEnvelope';
import type { EditableBundle } from '@/context/WorkspaceContext.types';
import type { ParsedAISections } from '@/lib/core/aiSections';

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

	const model = bundle?.parsedResourcesAll.get(AI_KEY)?.[summary.index] as
		| ParsedAISections
		| undefined;
	const canExport = summary.count > 0 && model != null;

	const handleExportClipboard = async () => {
		if (!canExport || !model) return;
		try {
			const envelope = buildEnvelopeFromBulk(model, summary, filename);
			const json = encodeBulkEnvelope({
				resourceKey: envelope.resourceKey,
				profile: envelope.profile,
				items: envelope.items,
				sourceBundle: envelope.sourceBundle,
			});
			if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
				await navigator.clipboard.writeText(json);
				toast.success(`Copied ${envelope.items.length} section${envelope.items.length === 1 ? '' : 's'} to clipboard`);
			} else {
				// Insecure-context / older-browser fallback. Slice 2's spec says
				// "minimal" — surface the JSON so the user can copy it manually.
				toast.error('Clipboard API unavailable', {
					description: 'Use [Export → file…] instead — your browser blocks clipboard writes.',
				});
			}
		} catch (err) {
			console.error('Bulk export to clipboard failed:', err);
			toast.error('Copy to clipboard failed', {
				description: err instanceof Error ? err.message : 'Unknown error',
			});
		}
	};

	const handleExportFile = () => {
		if (!canExport || !model) return;
		try {
			const envelope = buildEnvelopeFromBulk(model, summary, filename);
			const json = encodeBulkEnvelope({
				resourceKey: envelope.resourceKey,
				profile: envelope.profile,
				items: envelope.items,
				sourceBundle: envelope.sourceBundle,
			});
			const blob = new Blob([json], { type: 'application/json' });
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = exportEnvelopeFilename(filename);
			document.body.appendChild(a);
			a.click();
			a.remove();
			setTimeout(() => URL.revokeObjectURL(url), 0);
			toast.success(`Saved ${envelope.items.length} section${envelope.items.length === 1 ? '' : 's'}`);
		} catch (err) {
			console.error('Bulk export to file failed:', err);
			toast.error('Save to file failed', {
				description: err instanceof Error ? err.message : 'Unknown error',
			});
		}
	};

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
				<div className="px-3 py-2 border-t border-amber-500/40 space-y-2">
					<div className="flex flex-wrap gap-1.5">
						<Button
							type="button"
							variant="outline"
							size="sm"
							className="h-7 text-xs gap-1"
							disabled={!canExport}
							onClick={() => void handleExportClipboard()}
							title="Copy this bulk as JSON to the OS clipboard"
						>
							<Clipboard className="h-3 w-3" />
							Export → clipboard
						</Button>
						<Button
							type="button"
							variant="outline"
							size="sm"
							className="h-7 text-xs gap-1"
							disabled={!canExport}
							onClick={handleExportFile}
							title="Download this bulk as a JSON file"
						>
							<Download className="h-3 w-3" />
							Export → file…
						</Button>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							className="h-7 text-xs ml-auto"
							onClick={onClear}
						>
							Clear
						</Button>
					</div>
				</div>
			)}
		</div>
	);
}
