// TriggerDataBulkImportDialog — modal for pasting / loading a steward.bulk
// envelope onto a TriggerData destination.
//
// Mirrors BulkImportDialog (AI Sections) but is typed to ParsedTriggerData and
// drives the TriggerData import pipeline. One difference from the AI dialog:
//
//   - Six heterogeneous lists, so the preview is a per-list count breakdown
//     rather than a single section count. The "Starting ID" field controls the
//     box-region mId base only — regionIndex still auto-assigns above the
//     destination max (it is the writer's dense/unique region-table sort key,
//     not a user-tracked id).
//
// The preview never re-derives assignment math — buildTriggerImportPreview runs
// the real import so what's shown is exactly what Confirm produces.

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
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
	importTriggerDataBulk,
	type TriggerImportMode,
} from '@/lib/clipboard/triggerDataBulkImport';
import {
	decodeTriggerEnvelope,
	buildTriggerImportPreview,
	defaultTriggerStartId,
	detectTriggerIdCollisions,
	parseStartingId,
	previewBoxRegionCount,
} from './triggerDataBulkImportDialog.helpers';
import { TriggerImportPreviewBlock } from './TriggerImportPreviewBlock';
import { TriggerStartIdField } from './TriggerStartIdField';
import type { TriggerDataBulkItem } from '@/lib/clipboard/triggerDataBulkExport';
import type { BulkEnvelope } from '@/lib/clipboard/bulkEnvelope';
import type { ParsedTriggerData } from '@/lib/core/triggerData';

type Props = {
	open: boolean;
	onOpenChange: (next: boolean) => void;
	destination: ParsedTriggerData;
	bundleId: string;
	onConfirm: (result: ParsedTriggerData) => void;
};

type EnvelopeState =
	| { kind: 'idle' }
	| { kind: 'error'; reason: string }
	| { kind: 'ready'; envelope: BulkEnvelope<TriggerDataBulkItem> };

export function TriggerDataBulkImportDialog({
	open,
	onOpenChange,
	destination,
	bundleId,
	onConfirm,
}: Props) {
	const [envelopeState, setEnvelopeState] = useState<EnvelopeState>({ kind: 'idle' });
	const [pasteText, setPasteText] = useState('');
	const [mode, setMode] = useState<TriggerImportMode>('append');
	const defaultStart = useMemo(() => defaultTriggerStartId(destination), [destination]);
	const [startIdInput, setStartIdInput] = useState<string>(() => formatIdInputDefault(defaultStart));
	const fileInputRef = useRef<HTMLInputElement | null>(null);

	// Blank / unparseable falls back to the default so the preview + confirm stay
	// live while the user edits — the field never blocks the import.
	const resolvedStartId = useMemo(() => {
		const parsed = parseStartingId(startIdInput);
		return parsed ?? defaultStart;
	}, [startIdInput, defaultStart]);

	const preview = useMemo(
		() =>
			envelopeState.kind === 'ready'
				? buildTriggerImportPreview(envelopeState.envelope, destination, mode, resolvedStartId)
				: null,
		[envelopeState, destination, mode, resolvedStartId],
	);

	const collisions = useMemo(
		() =>
			preview && !preview.error
				? detectTriggerIdCollisions(destination, resolvedStartId, previewBoxRegionCount(preview))
				: [],
		[preview, destination, resolvedStartId],
	);

	const reset = () => {
		setEnvelopeState({ kind: 'idle' });
		setPasteText('');
		setMode('append');
		setStartIdInput(formatIdInputDefault(defaultStart));
	};

	const handleClose = (next: boolean) => {
		if (!next) reset();
		onOpenChange(next);
	};

	const decodeInto = (raw: string) => {
		const decoded = decodeTriggerEnvelope(raw);
		if (!decoded.ok) {
			setEnvelopeState({ kind: 'error', reason: decoded.reason });
			return;
		}
		setEnvelopeState({ kind: 'ready', envelope: decoded.envelope });
	};

	const handlePasteChange = (raw: string) => {
		setPasteText(raw);
		if (raw.trim().length === 0) {
			setEnvelopeState({ kind: 'idle' });
			return;
		}
		decodeInto(raw);
	};

	const handleFile = async (file: File) => {
		try {
			const raw = await file.text();
			setPasteText(raw);
			decodeInto(raw);
		} catch (err) {
			console.error('File read failed:', err);
			toast.error('Could not read file', {
				description: err instanceof Error ? err.message : 'Unknown error',
			});
		}
	};

	const handleConfirm = () => {
		if (envelopeState.kind !== 'ready' || !preview || preview.error) return;
		const out = importTriggerDataBulk({
			envelope: envelopeState.envelope,
			destination,
			mode,
			startId: resolvedStartId,
		});
		onConfirm(out.result);
		const counts = preview.perList
			.filter((l) => l.count > 0)
			.map((l) => `${l.count} ${l.listKey}`)
			.join(', ');
		toast.success(`Imported ${preview.total} ${preview.total === 1 ? 'entry' : 'entries'}`, {
			description: counts.length > 0 ? counts : undefined,
		});
		handleClose(false);
	};

	const confirmDisabled =
		envelopeState.kind !== 'ready' ||
		preview == null ||
		preview.error != null ||
		preview.total === 0;

	return (
		<Dialog open={open} onOpenChange={handleClose}>
			<DialogContent className="max-w-2xl">
				<DialogHeader>
					<DialogTitle>Import bulk JSON</DialogTitle>
					<DialogDescription>
						Paste a Steward bulk envelope or load it from a JSON file. Imports merge into{' '}
						<strong>{bundleId}</strong>.
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-3">
					<div className="flex items-center justify-between gap-2">
						<Label htmlFor="trigger-import-paste">Envelope JSON</Label>
						<div>
							<Button
								type="button"
								variant="outline"
								size="sm"
								onClick={() => fileInputRef.current?.click()}
							>
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
					<textarea
						id="trigger-import-paste"
						value={pasteText}
						onChange={(e) => handlePasteChange(e.target.value)}
						placeholder="Paste the exported bulk JSON here…"
						spellCheck={false}
						className={cn(
							'flex min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs',
							'ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none',
							'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
						)}
					/>
				</div>

				{envelopeState.kind === 'error' && (
					<div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
						<div className="mb-1 flex items-center gap-2 font-medium text-destructive">
							<AlertTriangle className="h-4 w-4" />
							Could not parse envelope
						</div>
						<p className="break-all text-xs text-muted-foreground">{envelopeState.reason}</p>
					</div>
				)}

				{envelopeState.kind === 'ready' && (
					<div className="space-y-4">
						<div className="rounded-md border bg-muted/30 p-3 text-sm">
							<div className="mb-1 font-medium">Envelope</div>
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
								onValueChange={(v) => setMode(v as TriggerImportMode)}
								className="flex flex-row gap-4"
							>
								<div className="flex items-center gap-2">
									<RadioGroupItem value="append" id="trigger-import-append" />
									<Label htmlFor="trigger-import-append" className="cursor-pointer text-xs">
										Append (default)
									</Label>
								</div>
								<div className="flex items-center gap-2">
									<RadioGroupItem value="replace" id="trigger-import-replace" />
									<Label htmlFor="trigger-import-replace" className="cursor-pointer text-xs">
										Replace
									</Label>
								</div>
							</RadioGroup>
							<p className="text-[11px] text-muted-foreground">
								Replace empties only the lists present in this import; lists you didn't bring data
								for are left untouched.
							</p>
						</div>

						<TriggerStartIdField
							value={startIdInput}
							onChange={setStartIdInput}
							placeholder={formatIdInputDefault(defaultStart)}
							collisions={collisions}
						/>

						{preview && <TriggerImportPreviewBlock preview={preview} mode={mode} />}
					</div>
				)}

				<DialogFooter>
					<Button variant="outline" onClick={() => handleClose(false)}>
						Cancel
					</Button>
					<Button onClick={handleConfirm} disabled={confirmDisabled}>
						{preview && preview.total > 0
							? `Import ${preview.total} ${preview.total === 1 ? 'entry' : 'entries'}`
							: 'Import'}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

// Hex form (no decimal suffix) for the input's pre-filled value / placeholder —
// mirrors the AI dialog so the two Starting-ID fields read the same.
function formatIdInputDefault(id: number): string {
	return `0x${(id >>> 0).toString(16).toUpperCase()}`;
}
