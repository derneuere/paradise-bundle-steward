// Renders one decoded save chunk. Modelled chunks (currently the PC Remastered
// Progression Profile) group their fields into tabs by the field's `group`
// metadata; everything else falls back to an opaque, byte-preserved view.

import { useMemo } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { useSaveProfile } from '@/context/SaveProfileContext';
import { decodeChunk, type ProfileSave, type ProfileChunk } from '@/lib/core/profileSave';
import { FieldRow } from './FieldRow';

export function ChunkEditor({ save, chunk }: { save: ProfileSave; chunk: ProfileChunk }) {
	const { version } = useSaveProfile();
	// chunk.raw is mutated in place; re-decode whenever an edit bumps `version`.
	const decoded = useMemo(() => decodeChunk(save, chunk), [save, chunk, version]);

	if (!chunk.spec || !decoded) {
		return <OpaqueChunkView chunk={chunk} />;
	}

	const fields = chunk.spec.fields;
	const groups: string[] = [];
	for (const f of fields) {
		const g = f.group ?? 'Fields';
		if (!groups.includes(g)) groups.push(g);
	}

	return (
		<div>
			<div className="mb-3 flex items-center gap-2">
				<h2 className="text-lg font-semibold">{chunk.name}</h2>
				<Badge variant="outline" className="font-mono">{chunk.spec.name}</Badge>
				<Badge variant="outline" className="font-mono">0x{chunk.size.toString(16)} B</Badge>
				{chunk.addedIn && <Badge variant="secondary">added {chunk.addedIn}</Badge>}
			</div>
			<Tabs defaultValue={groups[0]}>
				<TabsList className="flex flex-wrap h-auto">
					{groups.map((g) => <TabsTrigger key={g} value={g} className="text-xs">{g}</TabsTrigger>)}
				</TabsList>
				{groups.map((g) => (
					<TabsContent key={g} value={g} className="mt-3">
						<div className="divide-y divide-border/40">
							{fields.filter((f) => (f.group ?? 'Fields') === g).map((f) => (
								<FieldRow key={f.name} chunkKey={chunk.key} label={f.label ?? f.name} note={f.note}
									type={f} value={(decoded as Record<string, unknown>)[f.name]} path={[f.name]} reg={save.registry} />
							))}
						</div>
					</TabsContent>
				))}
			</Tabs>
		</div>
	);
}

function OpaqueChunkView({ chunk }: { chunk: ProfileChunk }) {
	const preview = Array.from(chunk.raw.subarray(0, 64))
		.map((b) => b.toString(16).padStart(2, '0')).join(' ');
	return (
		<div>
			<div className="mb-3 flex items-center gap-2">
				<h2 className="text-lg font-semibold">{chunk.name}</h2>
				<Badge variant="outline" className="font-mono">0x{chunk.size.toString(16)} B</Badge>
				{chunk.addedIn && <Badge variant="secondary">added {chunk.addedIn}</Badge>}
			</div>
			<p className="text-sm text-muted-foreground mb-3">
				This chunk isn't decoded into fields yet — its layout is documented in
				<code className="mx-1 px-1 rounded bg-muted">docs/save-profile/</code>. It's preserved byte-exact on
				save; the raw bytes are shown below for reference.
			</p>
			<pre className="text-[11px] font-mono leading-5 bg-muted/40 rounded p-3 overflow-auto max-h-72 whitespace-pre-wrap break-all">{preview}{chunk.raw.length > 64 ? '\n…' : ''}</pre>
		</div>
	);
}
