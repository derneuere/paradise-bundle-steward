// File-level metadata: platform variant, header format, and (for RGMH/PC) the
// editable Rich Game Media strings + GUID. MC02/headerless have nothing the
// user should hand-edit (checksums are recomputed on save).

import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useSaveProfile } from '@/context/SaveProfileContext';
import type { ProfileSave, RgmhStringField } from '@/lib/core/profileSave';

export function HeaderInfoPanel({ save }: { save: ProfileSave }) {
	const { setHeaderString, setHeaderGuid } = useSaveProfile();
	const h = save.header;

	return (
		<div>
			<div className="mb-3 flex items-center gap-2">
				<h2 className="text-lg font-semibold">File Header</h2>
				<Badge variant="outline">{save.variant.label}</Badge>
				<Badge variant="outline" className="uppercase font-mono">{h.kind}</Badge>
				<Badge variant="outline" className="font-mono">{(save.fileSize / 1024).toFixed(1)} KB</Badge>
			</div>

			{h.kind === 'rgmh' && (
				<div className="space-y-2">
					<p className="text-xs text-muted-foreground">
						Rich Game Media header (no protection). These metadata strings are shown by Windows;
						editing them is safe and round-trips byte-exact.
					</p>
					{([
						['gameName', 'Game name'], ['saveName', 'Save name'],
						['levelName', 'Level name'], ['comments', 'Comments'],
					] as [RgmhStringField, string][]).map(([field, label]) => (
						<LabeledInput key={field} label={label} defaultValue={h[field]} onCommit={(v) => setHeaderString(field, v)} />
					))}
					<LabeledInput label="Game GUID" mono defaultValue={h.guid} onCommit={setHeaderGuid} />
					<div className="text-[11px] text-muted-foreground font-mono pt-1">
						header 0x{h.headerSize.toString(16)} · thumbnail 0x{h.thumbnailSize.toString(16)} B
					</div>
				</div>
			)}

			{h.kind === 'mc02' && (
				<div className="space-y-1 text-xs text-muted-foreground font-mono">
					<p className="text-sm">Xbox 360 MC02 header — the three CRC32 checksums are recomputed automatically on save.</p>
					<div>fileSize 0x{h.fileSize.toString(16)} · userBody 0x{h.userBodySize.toString(16)}</div>
					<div>body CRC 0x{h.userBodySignature.toString(16).padStart(8, '0')} · header CRC 0x{h.fileHeaderSignature.toString(16).padStart(8, '0')}</div>
				</div>
			)}

			{h.kind === 'none' && (
				<p className="text-sm text-muted-foreground">
					{save.variant.label} profiles have no game-specific header — the file is the raw ProfileStoredData body.
				</p>
			)}
		</div>
	);
}

function LabeledInput({ label, defaultValue, onCommit, mono }: { label: string; defaultValue: string; onCommit: (v: string) => void; mono?: boolean }) {
	return (
		<div className="flex items-center gap-3">
			<div className="w-28 shrink-0 text-xs text-muted-foreground">{label}</div>
			<Input defaultValue={defaultValue} className={`h-8 max-w-md text-sm ${mono ? 'font-mono text-xs' : ''}`}
				onBlur={(e) => { if (e.target.value !== defaultValue) onCommit(e.target.value); }} />
		</div>
	);
}
