// BulkImportDialog — modal for pasting / loading a steward.bulk envelope
// onto a V12 AI Sections destination (Slice 2).
//
// Two entry surfaces:
//   - "Paste from clipboard" reads navigator.clipboard.readText().
//   - "From file…" mounts a hidden <input type=file> and reads .json.
//
// Both flows funnel through `decodeBulkEnvelope` → preview state → import.
// The preview live-runs `importAISectionsBulk` against the current mode +
// startId so the user sees defaulted / lossy / unlinked-portal counts
// before confirming.
//
// V4 schema is frozen — mounting this dialog against a V4 model is a bug
// at the call site, not something this dialog defends against.

import { useMemo, useRef, useState } from 'react';
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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { AlertTriangle, Info } from 'lucide-react';
import { toast } from 'sonner';
import { decodeBulkEnvelope } from '@/lib/clipboard/bulkEnvelope';
import {
	importAISectionsBulk,
	type ImportMode,
	type AISectionsBulkImportResult,
} from '@/lib/clipboard/aiSectionsBulkImport';
import type { AISectionsBulkItem } from '@/lib/clipboard/aiSectionsBulkExport';
import {
	parseStartingId,
	defaultStartingId,
	detectIdCollisions,
	formatIdLabel,
} from './bulkImportDialog.helpers';
import type { ParsedAISectionsV12 } from '@/lib/core/aiSections';
import type { BulkEnvelope } from '@/lib/clipboard/bulkEnvelope';

type Props = {
	open: boolean;
	onOpenChange: (next: boolean) => void;
	destination: ParsedAISectionsV12;
	bundleId: string;
	onConfirm: (result: ParsedAISectionsV12) => void;
};

type EnvelopeState =
	| { kind: 'idle' }
	| { kind: 'error'; reason: string }
	| { kind: 'ready'; envelope: BulkEnvelope<AISectionsBulkItem> };

export function BulkImportDialog({
	open,
	onOpenChange,
	destination,
	bundleId,
	onConfirm,
}: Props) {
	const [envelopeState, setEnvelopeState] = useState<EnvelopeState>({ kind: 'idle' });
	const [mode, setMode] = useState<ImportMode>('append');
	const defaultStart = useMemo(() => defaultStartingId(destination), [destination]);
	const [startIdInput, setStartIdInput] = useState<string>(() => formatIdInputDefault(defaultStart));
	const fileInputRef = useRef<HTMLInputElement | null>(null);

	const startIdParsed = useMemo(() => parseStartingId(startIdInput), [startIdInput]);

	// Live preview — runs the import against a hypothetical input so the
	// user sees defaulted/lossy/unlinked counts before confirming. If the
	// startId is unparseable we still show the count + defaulted/lossy
	// using a placeholder of 0 so the dialog stays useful while the user
	// is mid-edit.
	const preview = useMemo<AISectionsBulkImportResult | null>(() => {
		if (envelopeState.kind !== 'ready') return null;
		try {
			return importAISectionsBulk({
				envelope: envelopeState.envelope,
				destination,
				mode,
				startId: startIdParsed ?? 0,
			});
		} catch (err) {
			console.error('Bulk import preview failed:', err);
			return null;
		}
	}, [envelopeState, destination, mode, startIdParsed]);

	const collisions = useMemo(
		() =>
			envelopeState.kind === 'ready' && startIdParsed != null
				? detectIdCollisions(destination, startIdParsed, envelopeState.envelope.items.length)
				: [],
		[destination, startIdParsed, envelopeState],
	);

	const reset = () => {
		setEnvelopeState({ kind: 'idle' });
		setMode('append');
		setStartIdInput(formatIdInputDefault(defaultStart));
	};

	const handleClose = (next: boolean) => {
		if (!next) reset();
		onOpenChange(next);
	};

	const handleRaw = (raw: string) => {
		const parsed = decodeBulkEnvelope(raw);
		if (!parsed.ok) {
			setEnvelopeState({ kind: 'error', reason: parsed.reason });
			return;
		}
		if (parsed.envelope.resourceKey !== 'aiSections') {
			setEnvelopeState({
				kind: 'error',
				reason: `Wrong resource type: envelope is for ${parsed.envelope.resourceKey}, expected aiSections.`,
			});
			return;
		}
		// Cast the items to the AI-Sections-specific shape — `decodeBulkEnvelope`
		// returns unknown items by design.
		// TODO(types): the envelope's items are decoded as `unknown[]`; a per-
		// resource validator that narrows item shape lives outside this slice.
		setEnvelopeState({
			kind: 'ready',
			envelope: parsed.envelope as BulkEnvelope<AISectionsBulkItem>,
		});
	};

	const handlePasteClipboard = async () => {
		try {
			if (!navigator.clipboard?.readText) {
				toast.error('Clipboard API unavailable', {
					description: 'Use [From file…] instead — your browser blocks clipboard reads.',
				});
				return;
			}
			const raw = await navigator.clipboard.readText();
			if (raw.trim().length === 0) {
				setEnvelopeState({ kind: 'error', reason: 'Clipboard is empty.' });
				return;
			}
			handleRaw(raw);
		} catch (err) {
			console.error('Clipboard read failed:', err);
			toast.error('Could not read clipboard', {
				description: err instanceof Error ? err.message : 'Unknown error',
			});
		}
	};

	const handleFile = async (file: File) => {
		try {
			const raw = await file.text();
			handleRaw(raw);
		} catch (err) {
			console.error('File read failed:', err);
			toast.error('Could not read file', {
				description: err instanceof Error ? err.message : 'Unknown error',
			});
		}
	};

	const handleConfirm = () => {
		if (envelopeState.kind !== 'ready' || !preview || startIdParsed == null) return;
		onConfirm(preview.result);
		toast.success(
			`Imported ${envelopeState.envelope.items.length} section${envelopeState.envelope.items.length === 1 ? '' : 's'}`,
			{
				description: preview.assignedIdRange
					? `IDs ${formatIdLabel(preview.assignedIdRange.firstId)} – ${formatIdLabel(preview.assignedIdRange.lastId)}`
					: undefined,
			},
		);
		handleClose(false);
	};

	const itemCount = envelopeState.kind === 'ready' ? envelopeState.envelope.items.length : 0;
	const confirmDisabled =
		envelopeState.kind !== 'ready' ||
		startIdParsed == null ||
		itemCount === 0 ||
		preview == null;

	return (
		<Dialog open={open} onOpenChange={handleClose}>
			<DialogContent className="max-w-2xl">
				<DialogHeader>
					<DialogTitle>Import bulk JSON</DialogTitle>
					<DialogDescription>
						Paste a Steward bulk envelope from the clipboard or load it from a JSON file.
						Imports merge into <strong>{bundleId}</strong>.
					</DialogDescription>
				</DialogHeader>

				{envelopeState.kind === 'idle' && (
					<div className="space-y-3">
						<div className="flex flex-wrap gap-2">
							<Button type="button" variant="outline" onClick={() => void handlePasteClipboard()}>
								Paste from clipboard
							</Button>
							<Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()}>
								From file…
							</Button>
							<input
								ref={fileInputRef}
								type="file"
								accept="application/json,.json"
								className="hidden"
								onChange={(e) => {
									const f = e.target.files?.[0];
									if (f) void handleFile(f);
									// Reset so re-selecting the same file fires onChange again.
									if (e.target) e.target.value = '';
								}}
							/>
						</div>
					</div>
				)}

				{envelopeState.kind === 'error' && (
					<div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
						<div className="flex items-center gap-2 font-medium text-destructive mb-1">
							<AlertTriangle className="w-4 h-4" />
							Could not parse envelope
						</div>
						<p className="text-xs text-muted-foreground break-all">{envelopeState.reason}</p>
						<div className="mt-2">
							<Button type="button" variant="outline" size="sm" onClick={() => setEnvelopeState({ kind: 'idle' })}>
								Try again
							</Button>
						</div>
					</div>
				)}

				{envelopeState.kind === 'ready' && (
					<div className="space-y-4">
						<div className="rounded-md border bg-muted/30 p-3 text-sm">
							<div className="font-medium mb-1">Envelope</div>
							<dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
								<dt className="text-muted-foreground">Source profile</dt>
								<dd className="font-mono">{envelopeState.envelope.profile}</dd>
								<dt className="text-muted-foreground">Source bundle</dt>
								<dd className="font-mono">{envelopeState.envelope.sourceBundle ?? '—'}</dd>
								<dt className="text-muted-foreground">Items</dt>
								<dd>{envelopeState.envelope.items.length}</dd>
								<dt className="text-muted-foreground">Exported at</dt>
								<dd className="font-mono">{envelopeState.envelope.exportedAt}</dd>
							</dl>
						</div>

						<div className="space-y-2">
							<Label>Mode</Label>
							<RadioGroup
								value={mode}
								onValueChange={(v) => setMode(v as ImportMode)}
								className="flex flex-row gap-4"
							>
								<div className="flex items-center gap-2">
									<RadioGroupItem value="append" id="bulk-import-append" />
									<Label htmlFor="bulk-import-append" className="text-xs cursor-pointer">
										Append (default)
									</Label>
								</div>
								<div className="flex items-center gap-2">
									<RadioGroupItem value="replace" id="bulk-import-replace" />
									<Label htmlFor="bulk-import-replace" className="text-xs cursor-pointer">
										Replace
									</Label>
								</div>
							</RadioGroup>
						</div>

						<div className="space-y-2">
							<Label htmlFor="bulk-import-startid">Starting ID</Label>
							<Input
								id="bulk-import-startid"
								value={startIdInput}
								onChange={(e) => setStartIdInput(e.target.value)}
								placeholder={formatIdInputDefault(defaultStart)}
							/>
							<p className="text-[11px] text-muted-foreground">
								Decimal or hex with <code>0x</code> prefix. Usually you want this high — collisions with the GameDB
								will crash the game. The pre-filled value is just a safe-above-the-current-max suggestion.
							</p>
							{startIdParsed == null && (
								<p className="text-[11px] text-destructive">Unparseable starting id.</p>
							)}
							{collisions.length > 0 && (
								<div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-[11px]">
									<div className="flex items-center gap-1.5 font-medium text-amber-700 dark:text-amber-400">
										<AlertTriangle className="w-3 h-3" />
										{collisions.length} collision{collisions.length === 1 ? '' : 's'} with existing destination IDs
									</div>
									<div className="mt-1 font-mono text-muted-foreground">
										{collisions.slice(0, 5).map(formatIdLabel).join(', ')}
										{collisions.length > 5 ? ` … +${collisions.length - 5} more` : ''}
									</div>
								</div>
							)}
						</div>

						{preview && (
							<div className="rounded-md border bg-muted/30 p-3 text-sm space-y-2">
								<div className="font-medium">Preview</div>
								<div className="text-xs">
									{itemCount} section{itemCount === 1 ? '' : 's'} will be imported in {mode} mode.
								</div>
								{preview.assignedIdRange && (
									<div className="text-xs text-muted-foreground">
										IDs assigned: {formatIdLabel(preview.assignedIdRange.firstId)} – {formatIdLabel(preview.assignedIdRange.lastId)}
									</div>
								)}
								{preview.defaulted.length > 0 && (
									<div className="text-xs">
										<span className="text-muted-foreground">Defaulted fields:</span>{' '}
										<span className="font-mono">{preview.defaulted.join(', ')}</span>
									</div>
								)}
								{preview.lossy.length > 0 && (
									<div className="text-xs">
										<span className="text-muted-foreground">Lossy fields:</span>{' '}
										<span className="font-mono">{preview.lossy.join(', ')}</span>
									</div>
								)}
								{preview.unlinkedPortals.length > 0 && (
									<div className="text-xs">
										<span className="text-muted-foreground">
											Unlinked portals: {preview.unlinkedPortals.length}
										</span>
										<ul className="mt-1 ml-4 list-disc space-y-0.5">
											{preview.unlinkedPortals.slice(0, 5).map((u, i) => (
												<li key={i} className="font-mono">
													Section #{u.destinationSectionIdx} portal #{u.portalIdx} → was linkSection {u.originalLinkSection}, now -1
												</li>
											))}
											{preview.unlinkedPortals.length > 5 && (
												<li className="text-muted-foreground italic">
													… +{preview.unlinkedPortals.length - 5} more
												</li>
											)}
										</ul>
									</div>
								)}
								{preview.defaulted.length === 0 &&
									preview.lossy.length === 0 &&
									preview.unlinkedPortals.length === 0 && (
										<div className="flex items-center gap-1.5 text-xs text-muted-foreground">
											<Info className="w-3 h-3" />
											Lossless import — no defaults, no field drops, every portal link resolved.
										</div>
									)}
							</div>
						)}
					</div>
				)}

				<DialogFooter>
					<Button variant="outline" onClick={() => handleClose(false)}>
						Cancel
					</Button>
					<Button onClick={handleConfirm} disabled={confirmDisabled}>
						{itemCount > 0 ? `Import ${itemCount} section${itemCount === 1 ? '' : 's'}` : 'Import'}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function formatIdInputDefault(id: number): string {
	return `0x${(id >>> 0).toString(16).toUpperCase()}`;
}
