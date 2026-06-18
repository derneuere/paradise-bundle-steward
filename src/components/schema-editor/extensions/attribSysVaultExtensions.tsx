// Schema-editor extension for AttribSys Vault (resource type 0x1C).
//
// The vault's structure (version, collections, strings, the attributes list)
// is described by `attribSysVaultResourceSchema`, but each attribute's
// `fields` is a per-class record whose shape depends on the attribute's
// class (resolved at runtime via `getSchemaByClassHash`). A static
// ResourceSchema can't enumerate a discriminated union of records, so the
// `fields` value is a `custom` field rendered here: given the attribute's
// className we look up its typed field schema and render the right inputs.
//
// Only numeric-ish fields are editable: f32 / int / bool / vec4 / bytes8 /
// i32_array. Bigint / refspec fields are shown read-only; padding is hidden.
// The writer preserves every field regardless of whether the UI exposed it.

import React, { useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import type { ExtensionRegistry, WholeResourceExtensionProps } from '../context';
import type { ParsedAttribSys } from '@/lib/core/attribSys';
import {
	getSchemaByClassHash,
	type AttribSchema,
	type RefSpecValue,
} from '@/lib/core/vehicleAttribs';
import { getFieldMeta, type FieldMeta } from './attribSysFieldMeta';

// ---------------------------------------------------------------------------
// bytes8 codec (exported for unit tests)
// ---------------------------------------------------------------------------

function hex64(v: bigint): string {
	return '0x' + BigInt.asUintN(64, v).toString(16).toUpperCase().padStart(16, '0');
}

function hex8(bytes: number[]): string {
	return bytes.map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
}

// bytes8 fields carry short ASCII names in practice (VehicleID="CARBRWDS",
// InGameName packed text, etc.). Decode up to the first null; fall back to
// hex if the payload isn't all printable ASCII.
export function decodeBytes8(bytes: number[]): { ascii: string | null; hex: string } {
	const hex = hex8(bytes);
	const out: number[] = [];
	for (const b of bytes) {
		if (b === 0) break;
		out.push(b);
	}
	if (out.length === 0) return { ascii: '', hex };
	const printable = out.every((b) => b >= 0x20 && b < 0x7f);
	return { ascii: printable ? String.fromCharCode(...out) : null, hex };
}

export function encodeBytes8(text: string): number[] {
	const out = new Array(8).fill(0);
	for (let i = 0; i < Math.min(text.length, 8); i++) {
		out[i] = text.charCodeAt(i) & 0xff;
	}
	return out;
}

function refspecClassName(classKey: bigint): string {
	const schema = getSchemaByClassHash(classKey);
	return schema?.name ?? hex64(classKey);
}

// ---------------------------------------------------------------------------
// Leaf editors
// ---------------------------------------------------------------------------

function F32Input({ value, onChange, min, max }: { value: number; onChange: (v: number) => void; min?: number; max?: number }) {
	return (
		<Input
			type="number"
			step="any"
			min={min}
			max={max}
			className="h-8"
			value={Number.isFinite(value) ? value : 0}
			onChange={(e) => {
				const n = parseFloat(e.target.value);
				if (Number.isFinite(n)) onChange(n);
			}}
		/>
	);
}

function IntInput({ value, onChange, min, max }: { value: number; onChange: (v: number) => void; min?: number; max?: number }) {
	return (
		<Input
			type="number"
			step="1"
			min={min}
			max={max}
			className="h-8"
			value={Number.isFinite(value) ? value : 0}
			onChange={(e) => {
				const n = parseInt(e.target.value, 10);
				if (Number.isFinite(n)) onChange(n);
			}}
		/>
	);
}

// Categorical dropdown — if the current value isn't a whitelisted retail
// value it's prepended with an "(off-retail)" marker so edits preserve the
// user's existing override rather than silently clamping it.
function CategoricalSelect({ value, values, onChange }: { value: number; values: number[]; onChange: (v: number) => void }) {
	const hasCurrent = values.includes(value);
	const options = hasCurrent ? values : [value, ...values];
	return (
		<select
			className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
			value={value}
			onChange={(e) => {
				const n = Number(e.target.value);
				if (Number.isFinite(n)) onChange(n);
			}}
		>
			{options.map((v) => (
				<option key={v} value={v}>
					{!hasCurrent && v === value ? `${v} (off-retail)` : v}
				</option>
			))}
		</select>
	);
}

function Vec4Input({ value, onChange }: { value: number[]; onChange: (v: number[]) => void }) {
	return (
		<div className="grid grid-cols-4 gap-2">
			{[0, 1, 2, 3].map((i) => (
				<F32Input
					key={i}
					value={value[i] ?? 0}
					onChange={(n) => {
						const next = value.slice();
						next[i] = n;
						onChange(next);
					}}
				/>
			))}
		</div>
	);
}

function I32ArrayInput({ value, onChange }: { value: number[]; onChange: (v: number[]) => void }) {
	return (
		<div className="flex flex-wrap gap-1">
			{value.map((n, i) => (
				<Input
					key={i}
					type="number"
					step="1"
					className="h-7 w-20 text-xs"
					value={n}
					onChange={(e) => {
						const parsed = parseInt(e.target.value, 10);
						if (!Number.isFinite(parsed)) return;
						const next = value.slice();
						next[i] = parsed;
						onChange(next);
					}}
				/>
			))}
		</div>
	);
}

function FieldRow({
	fieldName,
	spec,
	value,
	set,
	meta,
}: {
	fieldName: string;
	spec: AttribSchema['fields'][number];
	value: unknown;
	set: (v: unknown) => void;
	meta: FieldMeta;
}) {
	const label = fieldName;

	switch (spec.type) {
		case 'pad':
		case 'align16':
			return null;

		case 'f32':
			return (
				<div className="space-y-1">
					<Label className="text-xs">
						{label}
						{meta.constant && <span className="ml-2 text-muted-foreground/60">(retail-constant)</span>}
					</Label>
					{meta.values
						? <CategoricalSelect value={value as number} values={meta.values} onChange={set} />
						: <F32Input value={value as number} onChange={set} min={meta.min} max={meta.max} />}
				</div>
			);

		case 'i32':
		case 'u16':
		case 'u8':
			return (
				<div className="space-y-1">
					<Label className="text-xs">
						{label}
						{meta.constant && <span className="ml-2 text-muted-foreground/60">(retail-constant)</span>}
					</Label>
					{meta.values
						? <CategoricalSelect value={value as number} values={meta.values} onChange={set} />
						: <IntInput value={value as number} onChange={set} min={meta.min} max={meta.max} />}
				</div>
			);

		case 'bool':
			return (
				<div className="flex items-center justify-between pr-2">
					<Label className="text-xs">{label}</Label>
					<Switch checked={!!value} onCheckedChange={set} />
				</div>
			);

		case 'vec4':
			return (
				<div className="space-y-1 col-span-full">
					<Label className="text-xs">{label}</Label>
					<Vec4Input value={value as number[]} onChange={set} />
				</div>
			);

		case 'u64':
		case 'i64':
			return (
				<div className="space-y-1">
					<Label className="text-xs">{label}</Label>
					<Input readOnly className="h-8 font-mono text-xs" value={hex64(value as bigint)} />
				</div>
			);

		case 'bytes8': {
			const bytes = value as number[];
			const { ascii, hex } = decodeBytes8(bytes);
			if (ascii !== null) {
				return (
					<div className="space-y-1">
						<Label className="text-xs">{label} · ASCII</Label>
						<Input
							className="h-8 font-mono text-xs"
							value={ascii}
							maxLength={8}
							onChange={(e) => set(encodeBytes8(e.target.value))}
						/>
					</div>
				);
			}
			return (
				<div className="space-y-1">
					<Label className="text-xs">{label} · bytes</Label>
					<Input readOnly className="h-8 font-mono text-xs" value={hex} />
				</div>
			);
		}

		case 'refspec': {
			const rs = value as RefSpecValue;
			return (
				<div className="space-y-1">
					<Label className="text-xs">{label} · ref to {refspecClassName(rs.classKey)}</Label>
					<Input readOnly className="h-8 font-mono text-xs" value={`key=${hex64(rs.collectionKey)}`} />
				</div>
			);
		}

		case 'refspec_array': {
			const arr = value as RefSpecValue[];
			return (
				<div className="space-y-1 col-span-full">
					<Label className="text-xs">{label} · {arr.length} refs</Label>
					<div className="text-[11px] text-muted-foreground font-mono">
						{arr.map((r, i) => (
							<div key={i}>
								[{i}] {refspecClassName(r.classKey)} · key={hex64(r.collectionKey)}
							</div>
						))}
					</div>
				</div>
			);
		}

		case 'i32_array':
			return (
				<div className="space-y-1 col-span-full">
					<Label className="text-xs">{label}</Label>
					<I32ArrayInput value={value as number[]} onChange={set} />
				</div>
			);
	}
}

// ---------------------------------------------------------------------------
// Custom field — one attribute's typed fields
// ---------------------------------------------------------------------------

// The custom field sits at `attributes[i].fields`; `value` is the fields
// record. We read the attribute's classHash from the resource root at the
// parent path to pick the right per-class field schema.
function AttribSysFieldsField({ path, value, setValue, data }: WholeResourceExtensionProps<Record<string, unknown>>) {
	const [showAdvanced, setShowAdvanced] = useState(false);
	const attrIndex = typeof path[1] === 'number' ? path[1] : Number(path[1]);
	const root = data as ParsedAttribSys | undefined;
	const attr = root?.attributes?.[attrIndex];
	const fields = (value ?? {}) as Record<string, unknown>;

	const schema = attr ? getSchemaByClassHash(attr.classHash) : undefined;
	const className = attr?.className ?? '';

	const visibleSpecs = useMemo(() => {
		if (!schema) return [];
		return schema.fields.filter((spec) => {
			if (spec.type === 'pad' || spec.type === 'align16') return false;
			const meta = getFieldMeta(className, spec.name);
			return showAdvanced || !meta.constant;
		});
	}, [schema, className, showAdvanced]);

	if (!attr) {
		return <div className="text-xs text-muted-foreground">Attribute not found.</div>;
	}
	if (!schema) {
		return (
			<div className="text-xs text-muted-foreground">
				No schema available for classHash {hex64(attr.classHash)} — field editing disabled.
			</div>
		);
	}

	const set = (fieldName: string, v: unknown) => setValue({ ...fields, [fieldName]: v });

	return (
		<div className="space-y-3">
			<label className="flex items-center gap-2 text-xs text-muted-foreground">
				<Switch checked={showAdvanced} onCheckedChange={setShowAdvanced} />
				Show advanced (retail-constant fields)
			</label>
			<div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
				{visibleSpecs.map((spec) => (
					<FieldRow
						key={spec.name}
						fieldName={spec.name}
						spec={spec}
						value={fields[spec.name]}
						set={(v) => set(spec.name, v)}
						meta={getFieldMeta(className, spec.name)}
					/>
				))}
			</div>
		</div>
	);
}

export const attribSysVaultExtensions: ExtensionRegistry = {
	attribSysFields: AttribSysFieldsField as ExtensionRegistry[string],
};
