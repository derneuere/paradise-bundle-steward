import React, { useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Trash2, Plus } from 'lucide-react';
import type {
	ParsedTrafficData,
	TrafficLightTrigger,
	TrafficStopLine,
	TrafficLightTriggerStartData,
	Vec4,
} from '@/lib/core/trafficData';
import type { TrafficDataSelection } from './useTrafficSelection';
import { updateHullField } from './constants';

type Props = {
	data: ParsedTrafficData;
	hullIndex: number;
	onChange: (next: ParsedTrafficData) => void;
	selected: TrafficDataSelection;
	onSelect: (sel: TrafficDataSelection) => void;
	scrollToIndexRef: React.MutableRefObject<((index: number) => void) | null>;
};

// ---------------------------------------------------------------------------
// Shared number cell
// ---------------------------------------------------------------------------

function IntCell({ value, onChange, width = 'w-20', max = 65535 }: { value: number; onChange: (v: number) => void; width?: string; max?: number }) {
	return (
		<Input
			type="number"
			min={0}
			max={max}
			className={`h-7 ${width} text-xs`}
			value={value}
			onChange={(e) => {
				const v = parseInt(e.target.value, 10);
				if (Number.isFinite(v)) onChange(Math.max(0, Math.min(max, v)));
			}}
		/>
	);
}

function FloatCell({ value, onChange, width = 'w-20' }: { value: number; onChange: (v: number) => void; width?: string }) {
	return (
		<Input
			type="number"
			step="any"
			className={`h-7 ${width} text-xs font-mono`}
			value={Number.isFinite(value) ? value : 0}
			onChange={(e) => {
				const v = parseFloat(e.target.value);
				if (Number.isFinite(v)) onChange(v);
			}}
		/>
	);
}

// ---------------------------------------------------------------------------
// Stop Lines sub-tab
// ---------------------------------------------------------------------------

const StopLinesSubTab: React.FC<Props> = ({ data, hullIndex, onChange }) => {
	const hull = data.hulls[hullIndex];
	if (!hull) return null;

	const updateLine = (index: number, value: number) => {
		onChange(updateHullField(data, hullIndex, 'stopLines', (arr) =>
			arr.map((l, i) => (i === index ? { ...l, muParamFixed: value & 0xFFFF } : l)),
		));
	};

	const addLine = () => {
		const empty: TrafficStopLine = { muParamFixed: 0 };
		onChange(updateHullField(data, hullIndex, 'stopLines', (arr) => [...arr, empty]));
	};

	const removeLine = (index: number) => {
		onChange(updateHullField(data, hullIndex, 'stopLines', (arr) => arr.filter((_, i) => i !== index)));
	};

	return (
		<div className="space-y-2">
			<div className="flex items-center justify-between">
				<span className="text-sm text-muted-foreground">{hull.stopLines.length} stop lines</span>
				<Button size="sm" variant="outline" onClick={addLine}>
					<Plus className="h-3 w-3 mr-1" /> Add Stop Line
				</Button>
			</div>
			<div className="max-h-[55vh] overflow-auto border rounded">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead className="w-12">#</TableHead>
							<TableHead>Param (u16)</TableHead>
							<TableHead className="w-12" />
						</TableRow>
					</TableHeader>
					<TableBody>
						{hull.stopLines.map((sl, i) => (
							<TableRow key={i}>
								<TableCell className="font-mono text-xs">{i}</TableCell>
								<TableCell><IntCell value={sl.muParamFixed} onChange={(v) => updateLine(i, v)} /></TableCell>
								<TableCell>
									<Button size="sm" variant="ghost" className="h-6 px-1 text-destructive" onClick={() => removeLine(i)}>
										<Trash2 className="h-3 w-3" />
									</Button>
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</div>
		</div>
	);
};

// ---------------------------------------------------------------------------
// Light Triggers sub-tab
// ---------------------------------------------------------------------------

const LightTriggersSubTab: React.FC<Props> = ({
	data, hullIndex, onChange, selected, onSelect, scrollToIndexRef,
}) => {
	const [search, setSearch] = useState('');
	const parentRef = useRef<HTMLDivElement>(null);
	const hull = data.hulls[hullIndex];
	if (!hull) return null;

	const filtered = useMemo(() => {
		let list = hull.lightTriggers.map((t, i) => ({ t, i }));
		if (search) {
			const q = search.toLowerCase();
			list = list.filter(({ i }) => i.toString().includes(q));
		}
		return list;
	}, [hull.lightTriggers, search]);

	const rowVirtualizer = useVirtualizer({
		count: filtered.length,
		getScrollElement: () => parentRef.current,
		estimateSize: () => 44,
		overscan: 12,
	});

	scrollToIndexRef.current = (originalIndex: number) => {
		const filteredIdx = filtered.findIndex(({ i }) => i === originalIndex);
		if (filteredIdx >= 0) rowVirtualizer.scrollToIndex(filteredIdx, { align: 'center' });
	};

	const updateTrigger = (index: number, patch: Partial<TrafficLightTrigger>) => {
		onChange(updateHullField(data, hullIndex, 'lightTriggers', (arr) =>
			arr.map((t, i) => (i === index ? { ...t, ...patch } : t)),
		));
	};

	const updateVec = (index: number, key: keyof TrafficLightTrigger, axis: keyof Vec4, value: number) => {
		onChange(updateHullField(data, hullIndex, 'lightTriggers', (arr) =>
			arr.map((t, i) => {
				if (i !== index) return t;
				const v4 = { ...t[key], [axis]: value } as Vec4;
				return { ...t, [key]: v4 };
			}),
		));
	};

	const addTrigger = () => {
		const empty: TrafficLightTrigger = {
			mDimensions: { x: 5, y: 5, z: 5, w: 0 },
			mPosPlusYRot: { x: 0, y: 0, z: 0, w: 0 },
		};
		const newIndex = hull.lightTriggers.length;
		onChange(updateHullField(data, hullIndex, 'lightTriggers', (arr) => [...arr, empty]));
		requestAnimationFrame(() => scrollToIndexRef.current?.(newIndex));
	};

	const removeTrigger = (index: number) => {
		onChange(updateHullField(data, hullIndex, 'lightTriggers', (arr) => arr.filter((_, i) => i !== index)));
	};

	const selectedIndex = selected?.hullIndex === hullIndex && selected.sub?.type === 'lightTrigger'
		? selected.sub.index : -1;

	const items = rowVirtualizer.getVirtualItems();
	const gridCols = 'grid-cols-[3rem_5rem_5rem_5rem_5rem_5rem_5rem_5rem_2rem]';

	return (
		<div className="space-y-2">
			<div className="flex items-center gap-2">
				<Input
					placeholder="Search by index..."
					className="h-8 w-48"
					value={search}
					onChange={(e) => setSearch(e.target.value)}
				/>
				<Button size="sm" variant="outline" className="h-7" onClick={addTrigger}>
					<Plus className="h-3 w-3 mr-1" /> Add Trigger
				</Button>
				<span className="text-xs text-muted-foreground ml-auto">
					{filtered.length} / {hull.lightTriggers.length}
				</span>
			</div>

			<div className={`grid ${gridCols} gap-1 text-xs text-muted-foreground px-2 border-b pb-1`}>
				<span>#</span>
				<span>Dim X</span>
				<span>Dim Y</span>
				<span>Dim Z</span>
				<span>Pos X</span>
				<span>Pos Y</span>
				<span>Pos Z</span>
				<span>Y Rot</span>
				<span />
			</div>

			<div ref={parentRef} className="h-[50vh] overflow-auto border rounded">
				<div style={{ height: rowVirtualizer.getTotalSize(), width: '100%', position: 'relative' }}>
					{items.map((vi) => {
						const { t, i } = filtered[vi.index];
						const isSel = i === selectedIndex;
						return (
							<div
								key={vi.key}
								data-index={vi.index}
								ref={rowVirtualizer.measureElement}
								className={`absolute left-0 right-0 px-2 py-1 border-b border-border/30 cursor-pointer ${isSel ? 'bg-orange-500/10' : 'hover:bg-muted/30'}`}
								style={{ transform: `translateY(${vi.start}px)` }}
								onClick={() => onSelect({ hullIndex, sub: { type: 'lightTrigger', index: i } })}
							>
								<div className={`grid ${gridCols} gap-1 items-center`}>
									<span className="font-mono text-xs">{i}</span>
									<div onClick={(e) => e.stopPropagation()}><FloatCell value={t.mDimensions.x} onChange={(v) => updateVec(i, 'mDimensions', 'x', v)} width="w-[4.5rem]" /></div>
									<div onClick={(e) => e.stopPropagation()}><FloatCell value={t.mDimensions.y} onChange={(v) => updateVec(i, 'mDimensions', 'y', v)} width="w-[4.5rem]" /></div>
									<div onClick={(e) => e.stopPropagation()}><FloatCell value={t.mDimensions.z} onChange={(v) => updateVec(i, 'mDimensions', 'z', v)} width="w-[4.5rem]" /></div>
									<div onClick={(e) => e.stopPropagation()}><FloatCell value={t.mPosPlusYRot.x} onChange={(v) => updateVec(i, 'mPosPlusYRot', 'x', v)} width="w-[4.5rem]" /></div>
									<div onClick={(e) => e.stopPropagation()}><FloatCell value={t.mPosPlusYRot.y} onChange={(v) => updateVec(i, 'mPosPlusYRot', 'y', v)} width="w-[4.5rem]" /></div>
									<div onClick={(e) => e.stopPropagation()}><FloatCell value={t.mPosPlusYRot.z} onChange={(v) => updateVec(i, 'mPosPlusYRot', 'z', v)} width="w-[4.5rem]" /></div>
									<div onClick={(e) => e.stopPropagation()}><FloatCell value={t.mPosPlusYRot.w} onChange={(v) => updateVec(i, 'mPosPlusYRot', 'w', v)} width="w-[4.5rem]" /></div>
									<Button
										size="sm"
										variant="ghost"
										className="h-6 px-1 text-destructive"
										onClick={(e) => { e.stopPropagation(); removeTrigger(i); }}
									>
										<Trash2 className="h-3 w-3" />
									</Button>
								</div>
							</div>
						);
					})}
				</div>
			</div>
		</div>
	);
};

// ---------------------------------------------------------------------------
// Start Data sub-tab
// ---------------------------------------------------------------------------

function makeEmptyStartData(): TrafficLightTriggerStartData {
	const zeroVec: Vec4 = { x: 0, y: 0, z: 0, w: 0 };
	return {
		maStartingPositions: Array.from({ length: 8 }, () => ({ ...zeroVec })),
		maStartingDirections: Array.from({ length: 8 }, () => ({ ...zeroVec })),
		maDestinationIDs: Array.from({ length: 16 }, () => 0n),
		maeDestinationDifficulties: Array.from({ length: 16 }, () => 0),
		muNumStartingPositions: 0,
		muNumDestinations: 0,
		muNumLanes: 0,
		_pad193: new Array(13).fill(0),
	};
}

const StartDataSubTab: React.FC<Props> = ({ data, hullIndex, onChange }) => {
	const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
	const hull = data.hulls[hullIndex];
	if (!hull) return null;

	const updateStart = (index: number, patch: Partial<TrafficLightTriggerStartData>) => {
		onChange(updateHullField(data, hullIndex, 'lightTriggerStartData', (arr) =>
			arr.map((sd, i) => (i === index ? { ...sd, ...patch } : sd)),
		));
	};

	const addStart = () => {
		onChange(updateHullField(data, hullIndex, 'lightTriggerStartData', (arr) => [...arr, makeEmptyStartData()]));
	};

	const removeStart = (index: number) => {
		onChange(updateHullField(data, hullIndex, 'lightTriggerStartData', (arr) => arr.filter((_, i) => i !== index)));
		if (expandedIndex === index) setExpandedIndex(null);
	};

	return (
		<div className="space-y-2">
			<div className="flex items-center justify-between">
				<span className="text-sm text-muted-foreground">{hull.lightTriggerStartData.length} start data entries</span>
				<Button size="sm" variant="outline" onClick={addStart}>
					<Plus className="h-3 w-3 mr-1" /> Add Start Data
				</Button>
			</div>
			<div className="space-y-1 max-h-[55vh] overflow-auto border rounded p-2">
				{hull.lightTriggerStartData.map((sd, i) => (
					<div key={i} className="border rounded p-2 space-y-1">
						<div className="flex items-center gap-2">
							<Button size="sm" variant="ghost" className="h-6 px-2" onClick={() => setExpandedIndex(expandedIndex === i ? null : i)}>
								{expandedIndex === i ? '−' : '+'}
							</Button>
							<span className="font-mono text-xs w-8">#{i}</span>
							<Badge variant="outline" className="text-[10px]">{sd.muNumStartingPositions} start</Badge>
							<Badge variant="outline" className="text-[10px]">{sd.muNumDestinations} dest</Badge>
							<Badge variant="outline" className="text-[10px]">{sd.muNumLanes} lanes</Badge>
							<Button size="sm" variant="ghost" className="h-6 px-1 ml-auto text-destructive" onClick={() => removeStart(i)}>
								<Trash2 className="h-3 w-3" />
							</Button>
						</div>

						{expandedIndex === i && (
							<div className="pl-10 pr-2 pt-1 space-y-2">
								<div className="flex gap-2">
									<IntCell value={sd.muNumStartingPositions} onChange={(v) => updateStart(i, { muNumStartingPositions: v })} max={8} width="w-16" />
									<IntCell value={sd.muNumDestinations} onChange={(v) => updateStart(i, { muNumDestinations: v })} max={16} width="w-16" />
									<IntCell value={sd.muNumLanes} onChange={(v) => updateStart(i, { muNumLanes: v })} max={255} width="w-16" />
								</div>
								<div className="text-[10px] text-muted-foreground">
									Starting positions ({sd.maStartingPositions.length}) and directions ({sd.maStartingDirections.length}) arrays are fixed-size (8 each).
									Destination IDs are CgsID hashes (hex). Difficulty is u8 per destination.
									Raw array editing is out of scope here — populate via game tooling.
								</div>
							</div>
						)}
					</div>
				))}
			</div>
		</div>
	);
};

// ---------------------------------------------------------------------------
// Junction Lookup sub-tab
// ---------------------------------------------------------------------------

const JunctionLookupSubTab: React.FC<Props> = ({ data, hullIndex, onChange }) => {
	const hull = data.hulls[hullIndex];
	if (!hull) return null;

	const updateEntry = (index: number, value: number) => {
		onChange(updateHullField(data, hullIndex, 'lightTriggerJunctionLookup', (arr) => {
			const out = arr.slice();
			out[index] = value & 0xFF;
			return out;
		}));
	};

	const addEntry = () => {
		onChange(updateHullField(data, hullIndex, 'lightTriggerJunctionLookup', (arr) => [...arr, 0]));
	};

	const removeEntry = (index: number) => {
		onChange(updateHullField(data, hullIndex, 'lightTriggerJunctionLookup', (arr) => arr.filter((_, i) => i !== index)));
	};

	return (
		<div className="space-y-2">
			<div className="flex items-center justify-between">
				<span className="text-sm text-muted-foreground">
					{hull.lightTriggerJunctionLookup.length} entries (light trigger → junction)
				</span>
				<Button size="sm" variant="outline" onClick={addEntry}>
					<Plus className="h-3 w-3 mr-1" /> Add Entry
				</Button>
			</div>
			<div className="max-h-[55vh] overflow-auto border rounded">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead className="w-12">#</TableHead>
							<TableHead>Junction Index</TableHead>
							<TableHead className="w-12" />
						</TableRow>
					</TableHeader>
					<TableBody>
						{hull.lightTriggerJunctionLookup.map((entry, i) => (
							<TableRow key={i}>
								<TableCell className="font-mono text-xs">{i}</TableCell>
								<TableCell><IntCell value={entry} onChange={(v) => updateEntry(i, v)} max={255} /></TableCell>
								<TableCell>
									<Button size="sm" variant="ghost" className="h-6 px-1 text-destructive" onClick={() => removeEntry(i)}>
										<Trash2 className="h-3 w-3" />
									</Button>
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</div>
		</div>
	);
};

// ---------------------------------------------------------------------------
// Main tab
// ---------------------------------------------------------------------------

export const LightTriggersTab: React.FC<Props> = (props) => {
	const [sub, setSub] = useState('triggers');
	const hull = props.data.hulls[props.hullIndex];
	if (!hull) return null;

	return (
		<Tabs value={sub} onValueChange={setSub}>
			<TabsList>
				<TabsTrigger value="triggers">Triggers ({hull.lightTriggers.length})</TabsTrigger>
				<TabsTrigger value="stopLines">Stop Lines ({hull.stopLines.length})</TabsTrigger>
				<TabsTrigger value="startData">Start Data ({hull.lightTriggerStartData.length})</TabsTrigger>
				<TabsTrigger value="lookup">Junction Lookup ({hull.lightTriggerJunctionLookup.length})</TabsTrigger>
			</TabsList>
			<TabsContent value="triggers"><LightTriggersSubTab {...props} /></TabsContent>
			<TabsContent value="stopLines"><StopLinesSubTab {...props} /></TabsContent>
			<TabsContent value="startData"><StartDataSubTab {...props} /></TabsContent>
			<TabsContent value="lookup"><JunctionLookupSubTab {...props} /></TabsContent>
		</Tabs>
	);
};
