import React, { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { ChevronDown, ChevronRight, Trash2, Plus } from 'lucide-react';
import type { ParsedTrafficDataRetail, TrafficFlowType } from '@/lib/core/trafficData';
import { VEHICLE_CLASS_LABELS, countFlowTypeReferences } from './constants';

type Props = {
	data: ParsedTrafficDataRetail;
	onChange: (next: ParsedTrafficDataRetail) => void;
};

// One (vehicleTypeId, cumulativeProb) pair — the editing primitive.
type Entry = { vehicleTypeId: number; cumulativeProb: number };

function flowToEntries(flow: TrafficFlowType): Entry[] {
	const n = Math.max(flow.vehicleTypeIds.length, flow.cumulativeProbs.length);
	const out: Entry[] = [];
	for (let i = 0; i < n; i++) {
		out.push({
			vehicleTypeId: flow.vehicleTypeIds[i] ?? 0,
			cumulativeProb: flow.cumulativeProbs[i] ?? 0,
		});
	}
	return out;
}

function entriesToFlow(entries: Entry[]): TrafficFlowType {
	return {
		vehicleTypeIds: entries.map((e) => e.vehicleTypeId & 0xFFFF),
		cumulativeProbs: entries.map((e) => e.cumulativeProb & 0xFF),
		muNumVehicleTypes: entries.length,
	};
}

function vehicleTypeLabel(data: ParsedTrafficDataRetail, index: number): string {
	const vt = data.vehicleTypes[index];
	if (!vt) return `#${index} (missing)`;
	const cls = VEHICLE_CLASS_LABELS[vt.muVehicleClass] ?? `class ${vt.muVehicleClass}`;
	return `#${index} — ${cls} · asset ${vt.muAssetId}`;
}

// ---------------------------------------------------------------------------
// Entry row
// ---------------------------------------------------------------------------

const EntryRow: React.FC<{
	data: ParsedTrafficDataRetail;
	entry: Entry;
	prevProb: number;
	onChange: (next: Entry) => void;
	onRemove: () => void;
}> = ({ data, entry, prevProb, onChange, onRemove }) => {
	const slice = Math.max(0, entry.cumulativeProb - prevProb);
	const pct = ((slice / 255) * 100).toFixed(1);
	const missing = !data.vehicleTypes[entry.vehicleTypeId];

	return (
		<div className="flex items-center gap-2 py-1">
			<select
				className={`h-7 border rounded px-1 text-xs bg-background flex-1 ${missing ? 'border-destructive text-destructive' : ''}`}
				value={entry.vehicleTypeId}
				onChange={(e) => onChange({ ...entry, vehicleTypeId: parseInt(e.target.value, 10) })}
			>
				{data.vehicleTypes.map((_, i) => (
					<option key={i} value={i}>{vehicleTypeLabel(data, i)}</option>
				))}
				{missing && <option value={entry.vehicleTypeId}>{`#${entry.vehicleTypeId} (missing)`}</option>}
			</select>
			<div className="flex items-center gap-1">
				<Input
					type="number"
					min={0}
					max={255}
					className="h-7 w-16 text-xs"
					value={entry.cumulativeProb}
					onChange={(e) => {
						const v = parseInt(e.target.value, 10);
						if (Number.isFinite(v)) onChange({ ...entry, cumulativeProb: Math.max(0, Math.min(255, v)) });
					}}
				/>
				<span className="text-[10px] text-muted-foreground w-14 tabular-nums">
					slice {pct}%
				</span>
			</div>
			<Button size="sm" variant="ghost" className="h-6 px-1 text-destructive" onClick={onRemove}>
				<Trash2 className="h-3 w-3" />
			</Button>
		</div>
	);
};

// ---------------------------------------------------------------------------
// Flow type card (collapsed + expanded)
// ---------------------------------------------------------------------------

const FlowTypeCard: React.FC<{
	data: ParsedTrafficDataRetail;
	flow: TrafficFlowType;
	index: number;
	onChange: (next: TrafficFlowType) => void;
	onRemove: () => void;
}> = ({ data, flow, index, onChange, onRemove }) => {
	const [expanded, setExpanded] = useState(false);
	const entries = useMemo(() => flowToEntries(flow), [flow]);
	const refs = useMemo(() => countFlowTypeReferences(data, index), [data, index]);
	const totalRefs = refs.sectionFlows + refs.staticVehicles + refs.trailers;

	const updateEntry = (ei: number, next: Entry) => {
		const nextEntries = entries.map((e, i) => (i === ei ? next : e));
		onChange(entriesToFlow(nextEntries));
	};

	const removeEntry = (ei: number) => {
		onChange(entriesToFlow(entries.filter((_, i) => i !== ei)));
	};

	const addEntry = () => {
		const lastProb = entries.length > 0 ? entries[entries.length - 1].cumulativeProb : 0;
		onChange(entriesToFlow([...entries, { vehicleTypeId: 0, cumulativeProb: Math.min(255, lastProb) }]));
	};

	// Quick summary of the mix for collapsed state
	const summary = useMemo(() => {
		if (entries.length === 0) return 'empty';
		return entries
			.slice(0, 3)
			.map((e, i) => {
				const prev = i === 0 ? 0 : entries[i - 1].cumulativeProb;
				const slice = Math.max(0, e.cumulativeProb - prev);
				const pct = Math.round((slice / 255) * 100);
				const vt = data.vehicleTypes[e.vehicleTypeId];
				const cls = vt ? (VEHICLE_CLASS_LABELS[vt.muVehicleClass] ?? '?') : '?';
				return `${cls} ${pct}%`;
			})
			.join(', ') + (entries.length > 3 ? ` +${entries.length - 3} more` : '');
	}, [entries, data.vehicleTypes]);

	// Monotonic-prob warning — cumulative probs must be non-decreasing.
	const monotonicOK = useMemo(() => {
		for (let i = 1; i < entries.length; i++) {
			if (entries[i].cumulativeProb < entries[i - 1].cumulativeProb) return false;
		}
		return true;
	}, [entries]);

	return (
		<Card>
			<CardContent className="p-2 space-y-1">
				<div className="flex items-center gap-2">
					<Button
						size="sm"
						variant="ghost"
						className="h-7 px-1"
						onClick={() => setExpanded((v) => !v)}
					>
						{expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
					</Button>
					<span className="font-mono text-xs w-10 text-muted-foreground">#{index}</span>
					<span className="text-xs flex-1 truncate">{summary}</span>
					{!monotonicOK && (
						<Badge variant="destructive" className="text-[10px]">non-monotonic</Badge>
					)}
					{totalRefs > 0 ? (
						<Badge variant="outline" className="text-[10px]" title={`sections: ${refs.sectionFlows}, static: ${refs.staticVehicles}, trailers: ${refs.trailers}`}>
							{totalRefs} ref{totalRefs === 1 ? '' : 's'}
						</Badge>
					) : (
						<Badge variant="outline" className="text-[10px] text-muted-foreground">unused</Badge>
					)}
					<Button
						size="sm"
						variant="ghost"
						className="h-7 px-1 text-destructive"
						onClick={onRemove}
						disabled={totalRefs > 0}
						title={totalRefs > 0 ? 'Remove references first' : 'Remove flow type'}
					>
						<Trash2 className="h-3 w-3" />
					</Button>
				</div>

				{expanded && (
					<div className="pl-8 pr-2 pb-1 space-y-0.5 border-t pt-2">
						{entries.length === 0 && (
							<div className="text-xs text-muted-foreground italic">No vehicle types — add one below.</div>
						)}
						{entries.map((e, ei) => (
							<EntryRow
								key={ei}
								data={data}
								entry={e}
								prevProb={ei === 0 ? 0 : entries[ei - 1].cumulativeProb}
								onChange={(next) => updateEntry(ei, next)}
								onRemove={() => removeEntry(ei)}
							/>
						))}
						<Button size="sm" variant="outline" className="h-7 mt-1" onClick={addEntry}>
							<Plus className="h-3 w-3 mr-1" /> Add Entry
						</Button>
					</div>
				)}
			</CardContent>
		</Card>
	);
};

// ---------------------------------------------------------------------------
// Main tab
// ---------------------------------------------------------------------------

export const FlowTypesTab: React.FC<Props> = ({ data, onChange }) => {
	const updateFlow = (index: number, next: TrafficFlowType) => {
		const flows = data.flowTypes.map((f, i) => (i === index ? next : f));
		onChange({ ...data, flowTypes: flows });
	};

	const addFlow = () => {
		const empty: TrafficFlowType = {
			vehicleTypeIds: [],
			cumulativeProbs: [],
			muNumVehicleTypes: 0,
		};
		onChange({ ...data, flowTypes: [...data.flowTypes, empty] });
	};

	const removeFlow = (index: number) => {
		onChange({ ...data, flowTypes: data.flowTypes.filter((_, i) => i !== index) });
	};

	return (
		<div className="space-y-2">
			<div className="flex items-center justify-between">
				<span className="text-sm text-muted-foreground">{data.flowTypes.length} flow types</span>
				<Button size="sm" variant="outline" onClick={addFlow}>
					<Plus className="h-3 w-3 mr-1" /> Add Flow Type
				</Button>
			</div>

			<div className="space-y-1 max-h-[65vh] overflow-auto pr-1">
				{data.flowTypes.map((flow, i) => (
					<FlowTypeCard
						key={i}
						data={data}
						flow={flow}
						index={i}
						onChange={(next) => updateFlow(i, next)}
						onRemove={() => removeFlow(i)}
					/>
				))}
			</div>
		</div>
	);
};
