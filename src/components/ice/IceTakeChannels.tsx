// Decoded ICE-take channel editor — the camera-editor surface for one take.
//
// Renders a take's keyframed elements grouped by ICE channel (Main, Blend,
// Raw Focus, Shake, …). Within each channel every animated element shows its
// value list (keys vs intervals), with the right control per data type: token
// dropdowns for enumerated UINTs, hex for hash identifiers, signed/float
// number inputs elsewhere. This mirrors what the in-game camera editor exposed
// per channel.
//
// Presentational + prop-driven: it owns no data fetching. On edit it recomputes
// the packed `raw` via the codec (`encodeEditedValue`) and bubbles a whole new
// IceTake up through `onChange`, so the owning editor marks the resource dirty
// and the byte-exact writer re-emits correct bits. Reusable — both the dictionary
// custom field and a future single-take (ICE Data) editor mount this.

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ICEDataType, type ICEElementDescription } from '@/lib/core/iceElementDescriptions';
import type { IceTake, IceValue } from '@/lib/core/iceVariableData';
import {
	controlKindFor,
	encodeEditedValue,
	groupRunsByChannel,
	setRunValue,
} from './iceTakeChannelModel';
import { IceElementReference } from './IceElementReference';

type Props = {
	take: IceTake;
	onChange: (next: IceTake) => void;
};

export function IceTakeChannels({ take, onChange }: Props) {
	const groups = groupRunsByChannel(take);

	if (groups.length === 0) {
		return (
			<div className="text-xs text-muted-foreground">
				This take animates no channels — nothing to edit.
			</div>
		);
	}

	const editValue = (runIndex: number, valueIndex: number, desc: ICEElementDescription, scalar: number) => {
		const next = encodeEditedValue(desc, scalar);
		onChange(setRunValue(take, runIndex, valueIndex, next));
	};

	return (
		<div className="space-y-3">
			{groups.map((group) => (
				<ChannelSection key={group.channel} group={group} onEdit={editValue} />
			))}
			<ElementReferenceSection />
		</div>
	);
}

// ---------------------------------------------------------------------------
// Element reference — the read-only per-build element schedule, collapsible so
// it stays out of the way until a user wants to look up an element's channel,
// data type, range, or token labels while editing the take above.
// ---------------------------------------------------------------------------

function ElementReferenceSection() {
	const [open, setOpen] = useState(false);

	return (
		<div className="rounded-md border border-dashed border-border">
			<button
				type="button"
				className="flex w-full items-center justify-between px-3 py-2 text-left text-sm font-medium hover:bg-muted/40"
				onClick={() => setOpen((v) => !v)}
			>
				<span>
					<span className="text-muted-foreground mr-1">{open ? '▾' : '▸'}</span>
					Element Reference
				</span>
				<Badge variant="outline" className="text-[10px]">
					read-only
				</Badge>
			</button>
			{open && (
				<div className="px-3 pb-3">
					<IceElementReference />
				</div>
			)}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Channel section (collapsible)
// ---------------------------------------------------------------------------

function ChannelSection({
	group,
	onEdit,
}: {
	group: ReturnType<typeof groupRunsByChannel>[number];
	onEdit: (runIndex: number, valueIndex: number, desc: ICEElementDescription, scalar: number) => void;
}) {
	const [open, setOpen] = useState(true);
	const elementCount = group.runs.length;

	return (
		<div className="rounded-md border border-border">
			<button
				type="button"
				className="flex w-full items-center justify-between px-3 py-2 text-left text-sm font-medium hover:bg-muted/40"
				onClick={() => setOpen((v) => !v)}
			>
				<span>
					<span className="text-muted-foreground mr-1">{open ? '▾' : '▸'}</span>
					{group.name}
				</span>
				<Badge variant="secondary" className="text-[10px]">
					{elementCount} element{elementCount === 1 ? '' : 's'}
				</Badge>
			</button>
			{open && (
				<div className="space-y-3 px-3 pb-3">
					{group.runs.map(({ runIndex, run, desc }) => (
						<ElementRow
							key={run.index}
							desc={desc}
							values={run.values}
							isKey={run.isKey}
							onEdit={(valueIndex, scalar) => onEdit(runIndex, valueIndex, desc, scalar)}
						/>
					))}
				</div>
			)}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Element row — one element's label + its value list
// ---------------------------------------------------------------------------

function ElementRow({
	desc,
	values,
	isKey,
	onEdit,
}: {
	desc: ICEElementDescription;
	values: IceValue[];
	isKey: boolean;
	onEdit: (valueIndex: number, scalar: number) => void;
}) {
	return (
		<div className="space-y-1">
			<div className="flex items-center gap-2">
				<span className="text-xs font-medium">{desc.displayName}</span>
				<Badge variant="outline" className="text-[9px] uppercase tracking-wide">
					{isKey ? 'keys' : 'intervals'}
				</Badge>
				<span className="text-[10px] text-muted-foreground">{values.length}</span>
			</div>
			<div className="flex flex-wrap gap-2">
				{values.map((v, i) => (
					<ValueControl
						key={i}
						desc={desc}
						value={v}
						onChange={(scalar) => onEdit(i, scalar)}
					/>
				))}
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Value control — the per-data-type input
// ---------------------------------------------------------------------------

function ValueControl({
	desc,
	value,
	onChange,
}: {
	desc: ICEElementDescription;
	value: IceValue;
	onChange: (scalar: number) => void;
}) {
	const kind = controlKindFor(desc);

	if (kind === 'token-select') {
		// The stored UINT value is the token index; the dropdown options are the
		// labels. If the raw index is outside the token list (off-retail), keep
		// it selectable so the edit doesn't silently clamp it.
		const current = value.raw >>> 0;
		const known = current < desc.tokens.length;
		return (
			<select
				className="h-8 w-44 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
				value={current}
				onChange={(e) => onChange(Number(e.target.value))}
			>
				{!known && <option value={current}>{current} (off-table)</option>}
				{desc.tokens.map((label, idx) => (
					<option key={idx} value={idx}>
						{label}
					</option>
				))}
			</select>
		);
	}

	if (kind === 'hex') {
		return (
			<Input
				className="h-8 w-36 font-mono text-xs"
				value={'0x' + (value.raw >>> 0).toString(16).toUpperCase().padStart(8, '0')}
				onChange={(e) => {
					const parsed = parseInt(e.target.value.replace(/^0x/i, ''), 16);
					if (Number.isFinite(parsed)) onChange(parsed >>> 0);
				}}
			/>
		);
	}

	// signed / float / number all use a numeric input. FIXED/FLOAT honour
	// min/max; integer types step by 1.
	const isFloat = desc.dataType === ICEDataType.FIXED || desc.dataType === ICEDataType.FLOAT;
	return (
		<Input
			type="number"
			step={isFloat ? 'any' : '1'}
			min={isFloat ? desc.min : undefined}
			max={isFloat ? desc.max : undefined}
			className="h-8 w-28 text-xs"
			value={Number.isFinite(value.value) ? value.value : 0}
			onChange={(e) => {
				const parsed = isFloat ? parseFloat(e.target.value) : parseInt(e.target.value, 10);
				if (Number.isFinite(parsed)) onChange(parsed);
			}}
		/>
	);
}
