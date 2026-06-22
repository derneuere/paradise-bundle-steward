// Recursive renderer for one decoded save-profile field. Walks the same
// TypeSpec the codec uses; leaf kinds get an inline editor that writes back
// through SaveProfileContext.editField (patch-in-place at the field's offset).

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { useSaveProfile } from '@/context/SaveProfileContext';
import type { Path, Field } from '@/lib/core/profileSave';
import type { TypeSpec, StructRegistry } from '@/lib/core/profileSave/struct';

type Props = {
	chunkKey: string;
	label: string;
	type: TypeSpec;
	value: unknown;
	path: Path;
	reg: StructRegistry;
	note?: string;
};

const inputCls = 'h-7 w-full max-w-[22rem] font-mono text-xs';

export function FieldRow({ chunkKey, label, type, value, path, reg, note }: Props) {
	const { editField } = useSaveProfile();
	const set = (v: number | bigint | boolean | string) => editField(chunkKey, path, v);

	switch (type.kind) {
		case 'i8': case 'u8': case 'i16': case 'u16': case 'i32': case 'u32':
			return (
				<Row label={label} note={note}>
					<Input type="number" defaultValue={String(value)} className={inputCls}
						onBlur={(e) => set(parseInt(e.target.value || '0', 10) | 0)} />
				</Row>
			);
		case 'f32':
			return (
				<Row label={label} note={note}>
					<Input type="number" step="any" defaultValue={String(value)} className={inputCls}
						onBlur={(e) => set(parseFloat(e.target.value || '0'))} />
				</Row>
			);
		case 'u64': case 'cgsid':
			return (
				<Row label={label} note={note}>
					<HexBigIntInput value={value as bigint} onCommit={set} />
				</Row>
			);
		case 'bool':
			return (
				<Row label={label} note={note}>
					<Switch checked={!!value} onCheckedChange={(c) => set(c)} />
				</Row>
			);
		case 'enum':
			return (
				<Row label={label} note={note}>
					<select className={`${inputCls} rounded-md border bg-background px-2`}
						defaultValue={String(value)}
						onChange={(e) => set(parseInt(e.target.value, 10) | 0)}>
						{Object.entries(type.values).map(([v, name]) => (
							<option key={v} value={v}>{v} — {name}</option>
						))}
						{!(String(value) in type.values) && <option value={String(value)}>{String(value)} — (unknown)</option>}
					</select>
				</Row>
			);
		case 'flags':
			return <FlagsRow label={label} note={note} value={value as number} bits={type.bits} onChange={set} />;
		case 'ascii':
			return (
				<Row label={label} note={note}>
					<Input defaultValue={String(value)} maxLength={type.len - 1} className={inputCls}
						onBlur={(e) => set(e.target.value)} />
				</Row>
			);
		case 'vector3': {
			const v = value as { x: number; y: number; z: number };
			return (
				<Row label={label} note={note}>
					<div className="flex gap-1">
						{(['x', 'y', 'z'] as const).map((c) => (
							<Input key={c} type="number" step="any" defaultValue={String(v[c])} className="h-7 w-24 font-mono text-xs"
								onBlur={(e) => editField(chunkKey, [...path, c], parseFloat(e.target.value || '0'))} />
						))}
					</div>
				</Row>
			);
		}
		case 'datetime':
			return <DateTimeRow label={label} note={note} value={value as { mbIsLocal: boolean; mSystemTime: bigint }} />;
		case 'bytes':
			return <BytesRow label={label} note={note} value={value as Uint8Array} />;
		case 'bitset':
			return <BitsetRow chunkKey={chunkKey} label={label} note={note} path={path} bits={type.bits} value={value as number[]} />;
		case 'cgsidset': case 'cgsidarray':
			return <CgsIdSetRow chunkKey={chunkKey} label={label} note={note} path={path} capacity={type.capacity} value={value as { count: number; ids: bigint[] }} />;
		case 'struct':
			return <StructRow chunkKey={chunkKey} label={label} refName={type.ref} value={value as Record<string, unknown>} path={path} reg={reg} />;
		case 'array':
			return <ArrayRow chunkKey={chunkKey} label={label} type={type} value={value as unknown[]} path={path} reg={reg} />;
	}
}

// --- layout helpers --------------------------------------------------------

function Row({ label, note, children }: { label: string; note?: string; children: React.ReactNode }) {
	return (
		<div className="flex items-center gap-3 py-1">
			<div className="w-56 shrink-0 text-xs text-muted-foreground truncate" title={`${label}${note ? ` — ${note}` : ''}`}>
				{label}{note && <span className="ml-1 opacity-60">· {note}</span>}
			</div>
			<div className="flex-1 min-w-0">{children}</div>
		</div>
	);
}

function HexBigIntInput({ value, onCommit }: { value: bigint; onCommit: (v: bigint) => void }) {
	const [text, setText] = useState('0x' + value.toString(16).toUpperCase());
	const [bad, setBad] = useState(false);
	return (
		<Input value={text} className={`${inputCls} ${bad ? 'border-red-500' : ''}`}
			onChange={(e) => setText(e.target.value)}
			onBlur={() => {
				try { onCommit(BigInt(text.trim())); setBad(false); }
				catch { setBad(true); }
			}} />
	);
}

function FlagsRow({ label, note, value, bits, onChange }: { label: string; note?: string; value: number; bits: Record<number, string>; onChange: (v: number) => void }) {
	return (
		<Row label={label} note={note}>
			<div className="flex flex-wrap gap-1">
				{Object.entries(bits).map(([mask, name]) => {
					const m = Number(mask);
					const on = (value & m) !== 0;
					return (
						<button key={mask} type="button"
							onClick={() => onChange(on ? value & ~m : value | m)}
							className={`px-2 py-0.5 rounded text-[11px] border ${on ? 'bg-primary/15 border-primary/40 text-primary' : 'border-border text-muted-foreground hover:bg-muted/60'}`}>
							{name}
						</button>
					);
				})}
				<span className="text-[11px] text-muted-foreground self-center">0x{value.toString(16)}</span>
			</div>
		</Row>
	);
}

function DateTimeRow({ label, note, value }: { label: string; note?: string; value: { mbIsLocal: boolean; mSystemTime: bigint } }) {
	// PC/PCR store a Win32 FILETIME (100 ns ticks since 1601-01-01).
	const t = value.mSystemTime;
	let pretty = '(unset)';
	if (t !== 0n) {
		const ms = Number(t / 10000n) - 11644473600000;
		const d = new Date(ms);
		if (!Number.isNaN(d.getTime())) pretty = d.toISOString().replace('T', ' ').replace('.000Z', ' UTC');
	}
	return (
		<Row label={label} note={note}>
			<span className="text-xs font-mono text-muted-foreground">{pretty} {value.mbIsLocal ? '(local)' : ''} · raw 0x{t.toString(16)}</span>
		</Row>
	);
}

function BytesRow({ label, note, value }: { label: string; note?: string; value: Uint8Array }) {
	const preview = Array.from(value.subarray(0, 24)).map((b) => b.toString(16).padStart(2, '0')).join(' ');
	return (
		<Row label={label} note={note}>
			<span className="text-xs font-mono text-muted-foreground">
				<Badge variant="outline" className="mr-2">{value.length.toLocaleString()} B · opaque</Badge>
				{preview}{value.length > 24 ? ' …' : ''}
			</span>
		</Row>
	);
}

function BitsetRow({ chunkKey, label, note, path, bits, value }: { chunkKey: string; label: string; note?: string; path: Path; bits: number; value: number[] }) {
	const { editBit } = useSaveProfile();
	const setBits = new Set(value);
	return (
		<Row label={label} note={`${note ? note + ' · ' : ''}${value.length}/${bits} set`}>
			{bits <= 256 ? (
				<div className="flex flex-wrap gap-0.5 max-h-24 overflow-auto">
					{Array.from({ length: bits }, (_, i) => {
						const on = setBits.has(i);
						return (
							<button key={i} type="button" title={`bit ${i}`}
								onClick={() => editBit(chunkKey, path, i, !on)}
								className={`w-5 h-5 text-[9px] rounded-sm ${on ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/70'}`}>
								{i}
							</button>
						);
					})}
				</div>
			) : (
				<span className="text-xs text-muted-foreground">{value.length} bits set</span>
			)}
		</Row>
	);
}

function CgsIdSetRow({ chunkKey, label, note, path, capacity, value }: { chunkKey: string; label: string; note?: string; path: Path; capacity: number; value: { count: number; ids: bigint[] } }) {
	const { editField } = useSaveProfile();
	const [open, setOpen] = useState(false);
	const shown = Math.min(value.count, capacity);
	return (
		<div className="py-1">
			<div className="flex items-center gap-3">
				<div className="w-56 shrink-0 text-xs text-muted-foreground truncate" title={label}>
					{label}{note && <span className="ml-1 opacity-60">· {note}</span>}
				</div>
				<div className="flex items-center gap-2">
					<span className="text-[11px] text-muted-foreground">count</span>
					<Input type="number" defaultValue={String(value.count)} min={0} max={capacity}
						className="h-7 w-20 font-mono text-xs"
						onBlur={(e) => editField(chunkKey, [...path, 'count'], Math.max(0, Math.min(capacity, parseInt(e.target.value || '0', 10))))} />
					<span className="text-[11px] text-muted-foreground">/ {capacity}</span>
					<button type="button" className="text-[11px] text-primary hover:underline" onClick={() => setOpen((o) => !o)}>
						{open ? 'hide' : 'edit IDs'}
					</button>
				</div>
			</div>
			{open && (
				<div className="ml-56 pl-3 mt-1 grid grid-cols-2 gap-1">
					{Array.from({ length: shown }, (_, i) => (
						<HexBigIntInput key={i} value={value.ids[i]} onCommit={(v) => editField(chunkKey, [...path, 'ids', i], v)} />
					))}
				</div>
			)}
		</div>
	);
}

function StructRow({ chunkKey, label, refName, value, path, reg }: { chunkKey: string; label: string; refName: string; value: Record<string, unknown>; path: Path; reg: StructRegistry }) {
	const spec = reg[refName];
	return (
		<div className="py-1">
			<div className="text-xs font-medium text-foreground/80 mb-1">{label}</div>
			<div className="ml-3 border-l pl-3">
				{spec.fields.map((f: Field) => (
					<FieldRow key={f.name} chunkKey={chunkKey} label={f.label ?? f.name} note={f.note}
						type={f} value={value[f.name]} path={[...path, f.name]} reg={reg} />
				))}
			</div>
		</div>
	);
}

function ArrayRow({ chunkKey, label, type, value, path, reg }: { chunkKey: string; label: string; type: Extract<TypeSpec, { kind: 'array' }>; value: unknown[]; path: Path; reg: StructRegistry }) {
	const { editField } = useSaveProfile();
	const [idx, setIdx] = useState(0);
	const el = type.element;
	const isScalar = ['i8', 'u8', 'i16', 'u16', 'i32', 'u32', 'f32'].includes(el.kind);

	// Compact grid for short scalar arrays (per-type counters etc.).
	if (isScalar && type.count <= 32) {
		const commit = (i: number, raw: string) =>
			editField(chunkKey, [...path, i], el.kind === 'f32' ? parseFloat(raw || '0') : parseInt(raw || '0', 10) | 0);
		return (
			<div className="py-1">
				<div className="text-xs text-muted-foreground mb-1">{label} <span className="opacity-60">· {type.count}</span></div>
				<div className="ml-3 grid grid-cols-6 gap-1">
					{value.map((v, i) => (
						<Input key={i} type="number" defaultValue={String(v)} title={`[${i}]`} className="h-7 w-full font-mono text-[11px]"
							onBlur={(e) => commit(i, e.target.value)} />
					))}
				</div>
			</div>
		);
	}

	return (
		<div className="py-1">
			<div className="flex items-center gap-3">
				<div className="w-56 shrink-0 text-xs text-muted-foreground truncate" title={label}>{label} <span className="opacity-60">· {value.length}</span></div>
				<div className="flex items-center gap-2">
					<span className="text-[11px] text-muted-foreground">index</span>
					<Input type="number" value={idx} min={0} max={type.count - 1} className="h-7 w-24 font-mono text-xs"
						onChange={(e) => setIdx(Math.max(0, Math.min(type.count - 1, parseInt(e.target.value || '0', 10))))} />
				</div>
			</div>
			<div className="ml-3 border-l pl-3 mt-1">
				{/* key on idx so the uncontrolled inputs remount with the new entry's values */}
				<FieldRow key={idx} chunkKey={chunkKey} label={`[${idx}]`} type={el} value={value[idx]} path={[...path, idx]} reg={reg} />
			</div>
		</div>
	);
}
