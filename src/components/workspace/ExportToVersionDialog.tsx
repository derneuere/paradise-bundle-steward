// Modal for the "Export to game version..." action (issue #37).
//
// Three states drive the dialog body:
//
//   1. "Pick preset" — preset dropdown + analysis summary. Always shown.
//      Surfaces blockers (no migration registered) and disables Export
//      until they go away (different preset, or migrations get added).
//
//   2. "Confirm lossy" — surfaced AFTER the user clicks Export when at
//      least one migration emits `lossy` field paths. Lists the entries
//      with a "this is a guess" tone and asks for an explicit confirm.
//      Routine additive migrations (only `defaulted`, no `lossy`) skip
//      this state entirely — Export fires straight to the writer.
//
//   3. "Saving" — transient while the writer runs and the download is
//      triggered. Mostly a "no-op" gate so a stray double-click doesn't
//      issue two downloads.
//
// The output is a browser download (matches Save Bundle, ADR-0005). The
// filename is editable in the dialog so the user can pick where it lands
// — the underlying File System Access API is not yet wired (see ADR-0005);
// when it is, this dialog can swap the filename input for a "save to..."
// button without any other change.

import { useMemo, useState } from 'react';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select';
import { AlertTriangle, Info } from 'lucide-react';
import { toast } from 'sonner';
import { TARGET_PRESETS, getTargetPreset } from '@/lib/conversion/targets';
import {
	analyzeExport,
	runMigrations,
	type Blocker,
} from '@/lib/conversion/exportPlan';
import { applyExport, defaultExportFilename } from '@/lib/conversion/applyExport';
import type { EditableBundle } from '@/context/WorkspaceContext.types';

type Props = {
	bundle: EditableBundle | null;
	open: boolean;
	onOpenChange: (next: boolean) => void;
};

export function ExportToVersionDialog({ bundle, open, onOpenChange }: Props) {
	// First preset is the dropdown default. Always at least one preset (we
	// ship paradise-pc-retail at launch); if the registry ever empties, the
	// dialog renders an empty-state instead of crashing.
	const [presetId, setPresetId] = useState<string>(TARGET_PRESETS[0]?.id ?? '');
	const [filename, setFilename] = useState<string>('');
	// Confirmation step is gated on lossy migrations. We move into it only
	// after the user clicks Export and the analysis surfaces lossy entries.
	const [pendingConfirm, setPendingConfirm] = useState<{
		runs: ReturnType<typeof runMigrations>;
		filename: string;
	} | null>(null);
	const [saving, setSaving] = useState(false);

	const preset = useMemo(() => getTargetPreset(presetId), [presetId]);

	// Analysis is recomputed on every render — the cost is cheap (a single
	// walk over `parsedResourcesAll` keyed lookups) and avoids stale-state
	// bugs when the user toggles between presets.
	const analysis = useMemo(() => {
		if (!bundle || !preset) return null;
		return analyzeExport(bundle, preset);
	}, [bundle, preset]);

	// Initialise the filename when the dialog opens / preset changes.
	const expectedFilename = useMemo(() => {
		if (!bundle || !preset) return '';
		return defaultExportFilename(bundle.id, preset);
	}, [bundle, preset]);
	// `filename` defaults to empty string so we can detect "user hasn't
	// touched it" and follow the preset choice. Once they edit it, we
	// stop overwriting on preset change — the user's intent wins.
	const effectiveFilename = filename.length > 0 ? filename : expectedFilename;

	const reset = () => {
		setPresetId(TARGET_PRESETS[0]?.id ?? '');
		setFilename('');
		setPendingConfirm(null);
		setSaving(false);
	};

	const handleClose = (next: boolean) => {
		if (!next) reset();
		onOpenChange(next);
	};

	const triggerDownload = (buffer: ArrayBuffer, name: string) => {
		const blob = new Blob([buffer], { type: 'application/octet-stream' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = name;
		document.body.appendChild(a);
		a.click();
		a.remove();
		// Defer revoke so Safari/Firefox have a tick to start the download
		// before the URL goes invalid (matches saveBundle pattern).
		setTimeout(() => URL.revokeObjectURL(url), 0);
	};

	const finishExport = (runs: ReturnType<typeof runMigrations>, name: string) => {
		if (!bundle || !preset) return;
		setSaving(true);
		try {
			const buffer = applyExport(bundle, preset, runs.runs);
			triggerDownload(buffer, name);
			toast.success(`Exported ${preset.label}`, {
				description: `Wrote ${(buffer.byteLength / 1024).toFixed(1)} KB to ${name}.`,
			});
			handleClose(false);
		} catch (error) {
			console.error('Export failed:', error);
			toast.error('Export failed', {
				description: error instanceof Error ? error.message : 'Unknown error',
			});
			setSaving(false);
		}
	};

	const handleExportClick = () => {
		if (!analysis || !bundle || !preset) return;
		if (analysis.blockers.length > 0) return;
		const runs = runMigrations(analysis.migrations);
		const name = effectiveFilename;
		// Lossy entries trigger the explicit confirm step. Defaulted-only
		// migrations are routine — no need to interrupt the user.
		if (runs.lossy.length > 0) {
			setPendingConfirm({ runs, filename: name });
			return;
		}
		finishExport(runs, name);
	};

	const handleConfirmLossy = () => {
		if (!pendingConfirm) return;
		finishExport(pendingConfirm.runs, pendingConfirm.filename);
	};

	const handleBackFromConfirm = () => setPendingConfirm(null);

	if (!bundle) return null;

	const blockerCount = analysis?.blockers.length ?? 0;
	const migrationCount = analysis?.migrations.length ?? 0;
	const exportDisabled =
		!preset || blockerCount > 0 || saving || effectiveFilename.length === 0;

	// ---- Confirmation step ------------------------------------------------
	if (pendingConfirm) {
		return (
			<Dialog open={open} onOpenChange={handleClose}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle className="flex items-center gap-2">
							<AlertTriangle className="w-5 h-5 text-amber-500" />
							Confirm lossy migration
						</DialogTitle>
						<DialogDescription>
							Some fields don't have a clean target equivalent. The migration
							guesses based on fixture analysis — review before exporting.
						</DialogDescription>
					</DialogHeader>
					<div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
						<div className="font-medium text-amber-700 dark:text-amber-400 mb-1">
							Lossy mappings ({pendingConfirm.runs.lossy.length})
						</div>
						<ul className="list-disc list-inside space-y-1 text-xs text-muted-foreground">
							{pendingConfirm.runs.lossy.map((entry) => (
								<li key={entry} className="font-mono break-all">
									{entry}
								</li>
							))}
						</ul>
					</div>
					{pendingConfirm.runs.defaulted.length > 0 && (
						<div className="rounded-md border bg-muted/30 p-3 text-sm">
							<div className="font-medium mb-1">
								Defaulted fields ({pendingConfirm.runs.defaulted.length})
							</div>
							<ul className="list-disc list-inside space-y-1 text-xs text-muted-foreground">
								{pendingConfirm.runs.defaulted.map((entry) => (
									<li key={entry} className="font-mono break-all">
										{entry}
									</li>
								))}
							</ul>
						</div>
					)}
					<DialogFooter>
						<Button
							variant="outline"
							onClick={handleBackFromConfirm}
							disabled={saving}
						>
							Back
						</Button>
						<Button onClick={handleConfirmLossy} disabled={saving}>
							{saving ? 'Exporting…' : 'Export anyway'}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		);
	}

	// ---- Picker step ------------------------------------------------------
	return (
		<Dialog open={open} onOpenChange={handleClose}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Export to game version…</DialogTitle>
					<DialogDescription>
						Migrate every resource in <strong>{bundle.id}</strong> to a target
						game version, then save the result as a new file. The bundle in
						the workspace stays untouched.
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-4">
					<div className="space-y-2">
						<Label htmlFor="export-preset">Target version</Label>
						<Select value={presetId} onValueChange={setPresetId}>
							<SelectTrigger id="export-preset">
								<SelectValue placeholder="Pick a target version" />
							</SelectTrigger>
							<SelectContent>
								{TARGET_PRESETS.map((p) => (
									<SelectItem key={p.id} value={p.id}>
										{p.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>

					<div className="space-y-2">
						<Label htmlFor="export-filename">Save as</Label>
						<Input
							id="export-filename"
							value={effectiveFilename}
							onChange={(e) => setFilename(e.target.value)}
							placeholder={expectedFilename}
						/>
					</div>

					{analysis && (
						<AnalysisSummary
							migrationCount={migrationCount}
							blockers={analysis.blockers}
						/>
					)}
				</div>

				<DialogFooter>
					<Button variant="outline" onClick={() => handleClose(false)} disabled={saving}>
						Cancel
					</Button>
					<Button onClick={handleExportClick} disabled={exportDisabled}>
						{saving ? 'Exporting…' : 'Export'}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

/**
 * Inline summary block under the preset dropdown. Three branches:
 *  - blockers.length > 0     → red "cannot export" panel listing what's missing
 *  - migrationCount === 0    → neutral "ready, no migrations needed" note
 *  - migrationCount > 0      → blue info note with the migration count
 *
 * Lossy/defaulted breakdowns only surface in the confirmation step — the
 * picker stage doesn't run migrations, so it can't show those numbers
 * without speculatively executing.
 */
function AnalysisSummary({
	migrationCount,
	blockers,
}: {
	migrationCount: number;
	blockers: Blocker[];
}) {
	if (blockers.length > 0) {
		return (
			<div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
				<div className="flex items-center gap-2 font-medium text-destructive mb-1">
					<AlertTriangle className="w-4 h-4" />
					Cannot export — missing migrations
				</div>
				<ul className="list-disc list-inside space-y-1 text-xs text-muted-foreground">
					{blockers.map((b) => (
						<li key={`${b.resourceKey}:${b.index}:${b.targetKind}`}>
							{b.message}
						</li>
					))}
				</ul>
			</div>
		);
	}
	if (migrationCount === 0) {
		return (
			<div className="rounded-md border bg-muted/30 p-3 text-sm flex items-start gap-2">
				<Info className="w-4 h-4 mt-0.5 text-muted-foreground" />
				<div className="text-muted-foreground">
					Ready to export — no resources need migrating for this version.
				</div>
			</div>
		);
	}
	return (
		<div className="rounded-md border bg-muted/30 p-3 text-sm flex items-start gap-2">
			<Info className="w-4 h-4 mt-0.5 text-muted-foreground" />
			<div>
				<div>
					{migrationCount} resource{migrationCount === 1 ? '' : 's'} will be
					migrated.
				</div>
				<div className="text-xs text-muted-foreground mt-0.5">
					Lossy mappings (if any) will be confirmed before the file is written.
				</div>
			</div>
		</div>
	);
}
