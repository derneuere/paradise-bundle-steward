// "Starting ID" field for TriggerDataBulkImportDialog. Split out of the dialog
// so the dialog stays under the file-size soft cap and this owns the input +
// non-blocking collision warning.
//
// The field controls the box-region mId base ONLY. regionIndex still
// auto-assigns above the destination max (it is the writer's dense/unique
// region-table sort key, not a user-tracked id), so this field never mentions
// it. Blank / unparseable input falls back to the default upstream — the field
// never blocks the import, mirroring the AI Sections dialog.

import { AlertTriangle } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatTriggerIdLabel } from './triggerDataBulkImportDialog.helpers';

export function TriggerStartIdField({
	value,
	onChange,
	placeholder,
	collisions,
}: {
	value: string;
	onChange: (next: string) => void;
	placeholder: string;
	collisions: number[];
}) {
	return (
		<div className="space-y-2">
			<Label htmlFor="trigger-import-startid">Starting ID</Label>
			<Input
				id="trigger-import-startid"
				value={value}
				onChange={(e) => onChange(e.target.value)}
				placeholder={placeholder}
			/>
			<p className="text-[11px] text-muted-foreground">
				Base mId for the first appended region — decimal or hex with <code>0x</code> prefix.
				Usually you want this high; collisions with the GameDB will crash the game. The
				pre-filled value is a safe-above-the-current-max suggestion. Region indices are always
				assigned automatically. Leave blank to use the default.
			</p>
			{collisions.length > 0 && (
				<div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-[11px]">
					<div className="flex items-center gap-1.5 font-medium text-amber-700 dark:text-amber-400">
						<AlertTriangle className="h-3 w-3" />
						{collisions.length} collision{collisions.length === 1 ? '' : 's'} with existing destination IDs
					</div>
					<div className="mt-1 font-mono text-muted-foreground">
						{collisions.slice(0, 5).map(formatTriggerIdLabel).join(', ')}
						{collisions.length > 5 ? ` … +${collisions.length - 5} more` : ''}
					</div>
				</div>
			)}
		</div>
	);
}
