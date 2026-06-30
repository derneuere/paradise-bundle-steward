// Live-preview block for TriggerDataBulkImportDialog. Split out so the dialog
// itself stays focused on wiring (paste/file/mode + confirm) and this renders
// the per-list breakdown + assigned id / regionIndex ranges + profile / note
// warnings derived by buildTriggerImportPreview.

import { AlertTriangle, Info } from 'lucide-react';
import {
	formatTriggerIdLabel,
	type TriggerImportPreview,
} from './triggerDataBulkImportDialog.helpers';
import type { TriggerImportMode } from '@/lib/clipboard/triggerDataBulkImport';

export function TriggerImportPreviewBlock({
	preview,
	mode,
}: {
	preview: TriggerImportPreview;
	mode: TriggerImportMode;
}) {
	if (preview.error) {
		return (
			<div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
				<div className="mb-1 flex items-center gap-2 font-medium text-destructive">
					<AlertTriangle className="h-4 w-4" />
					Cannot import
				</div>
				<p className="text-xs text-muted-foreground">{preview.error}</p>
			</div>
		);
	}

	const nonEmpty = preview.perList.filter((l) => l.count > 0);

	return (
		<div className="space-y-2 rounded-md border bg-muted/30 p-3 text-sm">
			<div className="font-medium">Preview</div>
			<div className="text-xs">
				{preview.total} {preview.total === 1 ? 'entry' : 'entries'} will be imported in {mode}{' '}
				mode.
			</div>
			{nonEmpty.length > 0 && (
				<ul className="ml-4 list-disc space-y-0.5 text-xs">
					{nonEmpty.map((l) => (
						<li key={l.listKey}>
							<span className="font-mono">{l.listKey}</span>: {l.count}
						</li>
					))}
				</ul>
			)}
			{preview.assignedIdRange && (
				<div className="text-xs text-muted-foreground">
					IDs assigned: {formatTriggerIdLabel(preview.assignedIdRange.firstId)} –{' '}
					{formatTriggerIdLabel(preview.assignedIdRange.lastId)}
				</div>
			)}
			{preview.assignedRegionIndexRange && (
				<div className="text-xs text-muted-foreground">
					Region indices assigned: {preview.assignedRegionIndexRange.first} –{' '}
					{preview.assignedRegionIndexRange.last}
				</div>
			)}
			{preview.profileMismatch && (
				<div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-[11px]">
					<div className="flex items-center gap-1.5 font-medium text-amber-700 dark:text-amber-400">
						<AlertTriangle className="h-3 w-3" />
						Source profile differs from this resource's version
					</div>
					<div className="mt-1 text-muted-foreground">
						TriggerData needs no migration across versions — importing as-is.
					</div>
				</div>
			)}
			{preview.notes.length > 0 && (
				<ul className="ml-4 list-disc space-y-0.5 text-[11px] text-muted-foreground">
					{preview.notes.map((n, i) => (
						<li key={i}>{n}</li>
					))}
				</ul>
			)}
			{preview.notes.length === 0 && !preview.profileMismatch && (
				<div className="flex items-center gap-1.5 text-xs text-muted-foreground">
					<Info className="h-3 w-3" />
					Clean import — fresh ids and region indices assigned automatically.
				</div>
			)}
		</div>
	);
}
