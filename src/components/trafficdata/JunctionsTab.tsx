import React, { useMemo, useState, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { ParsedTrafficData, TrafficJunctionLogicBox, TrafficLightController } from '@/lib/core/trafficData';
import type { TrafficDataSelection } from './useTrafficSelection';
import { updateHullField } from './constants';

function makeEmptyJunction(): TrafficJunctionLogicBox {
	const zeros16 = Array.from({ length: 16 }, () => 0);
	const controllers: TrafficLightController[] = Array.from({ length: 8 }, () => ({
		mauTrafficLightIds: [0, 0],
		mauStopLineIds: [0, 0, 0, 0, 0, 0],
		mauStopLineHulls: [0, 0, 0, 0, 0, 0],
		muNumStopLines: 0,
		muNumTrafficLights: 0,
	}));
	return {
		muID: 0,
		mauStateTimings: zeros16.slice(),
		mauStoppedLightStates: zeros16.slice(),
		muNumStates: 0,
		muNumLights: 0,
		_pad36: [0, 0],
		muEventJunctionID: 0,
		miOfflineStartDataIndex: -1,
		miOnlineStartDataIndex: -1,
		miBikeStartDataIndex: -1,
		maTrafficLightControllers: controllers,
		_pad108: [0, 0, 0, 0, 0, 0, 0, 0],
		mPosition: { x: 0, y: 0, z: 0, w: 1 },
	};
}

type Props = {
	data: ParsedTrafficData;
	hullIndex: number;
	onChange: (next: ParsedTrafficData) => void;
	selected: TrafficDataSelection;
	onSelect: (sel: TrafficDataSelection) => void;
	scrollToIndexRef: React.MutableRefObject<((index: number) => void) | null>;
};

// ---------------------------------------------------------------------------
// Junction Detail Dialog
// ---------------------------------------------------------------------------

function JunctionDetailDialog({
	junction,
	index,
	open,
	onOpenChange,
	onUpdate,
}: {
	junction: TrafficJunctionLogicBox;
	index: number;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onUpdate: (index: number, j: TrafficJunctionLogicBox) => void;
}) {
	const updateTiming = (ti: number, val: number) => {
		const timings = junction.mauStateTimings.slice();
		timings[ti] = val & 0xFFFF;
		onUpdate(index, { ...junction, mauStateTimings: timings });
	};

	const updateLightState = (si: number, val: number) => {
		const states = junction.mauStoppedLightStates.slice();
		states[si] = val & 0xFF;
		onUpdate(index, { ...junction, mauStoppedLightStates: states });
	};

	const patch = (p: Partial<TrafficJunctionLogicBox>) => onUpdate(index, { ...junction, ...p });

	const intInput = (
		label: string,
		value: number,
		onSet: (v: number) => void,
		opts: { min?: number; max?: number; width?: string } = {},
	) => (
		<div>
			<Label className="text-[10px] text-muted-foreground">{label}</Label>
			<Input
				type="number"
				min={opts.min}
				max={opts.max}
				className={`h-7 ${opts.width ?? 'w-24'} text-xs`}
				value={value}
				onChange={(e) => {
					const v = parseInt(e.target.value, 10);
					if (Number.isFinite(v)) onSet(v);
				}}
			/>
		</div>
	);

	const floatInput = (
		label: string,
		value: number,
		onSet: (v: number) => void,
	) => (
		<div>
			<Label className="text-[10px] text-muted-foreground">{label}</Label>
			<Input
				type="number"
				step="any"
				className="h-7 w-24 text-xs font-mono"
				value={Number.isFinite(value) ? value : 0}
				onChange={(e) => {
					const v = parseFloat(e.target.value);
					if (Number.isFinite(v)) onSet(v);
				}}
			/>
		</div>
	);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-3xl max-h-[80vh] overflow-auto">
				<DialogHeader>
					<DialogTitle>Junction {index} — ID {junction.muID}</DialogTitle>
				</DialogHeader>

				<div className="space-y-4">
					{/* Editable header fields */}
					<div className="flex flex-wrap gap-3">
						{intInput('Junction ID', junction.muID, (v) => patch({ muID: v >>> 0 }))}
						{intInput('Event Junction ID', junction.muEventJunctionID, (v) => patch({ muEventJunctionID: v >>> 0 }))}
						{intInput('Num States', junction.muNumStates, (v) => patch({ muNumStates: Math.max(0, Math.min(16, v)) }), { min: 0, max: 16, width: 'w-16' })}
						{intInput('Num Lights', junction.muNumLights, (v) => patch({ muNumLights: Math.max(0, Math.min(8, v)) }), { min: 0, max: 8, width: 'w-16' })}
						{intInput('Offline Start', junction.miOfflineStartDataIndex, (v) => patch({ miOfflineStartDataIndex: v | 0 }))}
						{intInput('Online Start', junction.miOnlineStartDataIndex, (v) => patch({ miOnlineStartDataIndex: v | 0 }))}
						{intInput('Bike Start', junction.miBikeStartDataIndex, (v) => patch({ miBikeStartDataIndex: v | 0 }))}
					</div>

					{/* Position */}
					<div className="flex items-end gap-2">
						<span className="text-xs text-muted-foreground pb-2">Position</span>
						{floatInput('X', junction.mPosition.x, (v) => patch({ mPosition: { ...junction.mPosition, x: v } }))}
						{floatInput('Y', junction.mPosition.y, (v) => patch({ mPosition: { ...junction.mPosition, y: v } }))}
						{floatInput('Z', junction.mPosition.z, (v) => patch({ mPosition: { ...junction.mPosition, z: v } }))}
					</div>

					{/* State Timings */}
					<div>
						<h4 className="text-sm font-medium mb-1">State Timings ({junction.muNumStates} states)</h4>
						<div className="grid grid-cols-8 gap-1">
							{junction.mauStateTimings.map((t, ti) => (
								<div key={ti} className="text-center">
									<span className="text-[10px] text-muted-foreground">{ti}</span>
									<Input
										type="number"
										className={`h-7 text-xs text-center ${ti >= junction.muNumStates ? 'opacity-30' : ''}`}
										value={t}
										onChange={(e) => {
											const v = parseInt(e.target.value, 10);
											if (Number.isFinite(v)) updateTiming(ti, v);
										}}
									/>
								</div>
							))}
						</div>
					</div>

					{/* Stopped Light States */}
					<div>
						<h4 className="text-sm font-medium mb-1">Stopped Light States</h4>
						<div className="grid grid-cols-8 gap-1">
							{junction.mauStoppedLightStates.map((s, si) => (
								<div key={si} className="text-center">
									<span className="text-[10px] text-muted-foreground">{si}</span>
									<Input
										type="number"
										className={`h-7 text-xs text-center ${si >= junction.muNumStates ? 'opacity-30' : ''}`}
										value={s}
										onChange={(e) => {
											const v = parseInt(e.target.value, 10);
											if (Number.isFinite(v)) updateLightState(si, v);
										}}
									/>
								</div>
							))}
						</div>
					</div>

					{/* Traffic Light Controllers */}
					<div>
						<h4 className="text-sm font-medium mb-1">Traffic Light Controllers ({junction.muNumLights} lights)</h4>
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead className="w-8">#</TableHead>
									<TableHead>Light IDs</TableHead>
									<TableHead>Stop Lines</TableHead>
									<TableHead>Stop Line Hulls</TableHead>
									<TableHead>Num SL</TableHead>
									<TableHead>Num TL</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{junction.maTrafficLightControllers.map((tlc, ci) => (
									<TableRow key={ci} className={ci >= junction.muNumLights ? 'opacity-30' : ''}>
										<TableCell className="font-mono text-xs">{ci}</TableCell>
										<TableCell className="font-mono text-xs">{tlc.mauTrafficLightIds.join(', ')}</TableCell>
										<TableCell className="font-mono text-xs">{tlc.mauStopLineIds.join(', ')}</TableCell>
										<TableCell className="font-mono text-xs">{tlc.mauStopLineHulls.join(', ')}</TableCell>
										<TableCell>{tlc.muNumStopLines}</TableCell>
										<TableCell>{tlc.muNumTrafficLights}</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}

// ---------------------------------------------------------------------------
// Main Junctions Tab
// ---------------------------------------------------------------------------

export const JunctionsTab: React.FC<Props> = ({ data, hullIndex, onChange, selected, onSelect, scrollToIndexRef }) => {
	const [search, setSearch] = useState('');
	const [detailIndex, setDetailIndex] = useState<number | null>(null);
	const parentRef = useRef<HTMLDivElement>(null);
	const hull = data.hulls[hullIndex];
	if (!hull) return null;

	const filtered = useMemo(() => {
		let list = hull.junctions.map((j, i) => ({ j, i }));
		if (search) {
			const q = search.toLowerCase();
			list = list.filter(({ j, i }) =>
				i.toString().includes(q) || j.muID.toString().includes(q),
			);
		}
		return list;
	}, [hull.junctions, search]);

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

	const updateJunction = (index: number, junction: TrafficJunctionLogicBox) => {
		onChange(updateHullField(data, hullIndex, 'junctions', (arr) =>
			arr.map((j, i) => (i === index ? junction : j)),
		));
	};

	const addJunction = () => {
		const newIndex = hull.junctions.length;
		onChange(updateHullField(data, hullIndex, 'junctions', (arr) => [...arr, makeEmptyJunction()]));
		requestAnimationFrame(() => scrollToIndexRef.current?.(newIndex));
	};

	const removeJunction = (junctionIndex: number) => {
		onChange(updateHullField(data, hullIndex, 'junctions', (arr) => arr.filter((_, i) => i !== junctionIndex)));
	};

	const selectedJunctionIndex = selected?.hullIndex === hullIndex && selected.sub?.type === 'junction'
		? selected.sub.index : -1;

	const items = rowVirtualizer.getVirtualItems();
	const gridCols = 'grid-cols-[3rem_5rem_8rem_4rem_4rem_5rem_3rem_2rem]';

	return (
		<div className="space-y-2">
			<div className="flex items-center gap-2">
				<Input
					placeholder="Search by index or ID..."
					className="h-8 w-48"
					value={search}
					onChange={(e) => setSearch(e.target.value)}
				/>
				<Button size="sm" variant="outline" className="h-7" onClick={addJunction}>Add Junction</Button>
				<span className="text-xs text-muted-foreground ml-auto">{filtered.length} / {hull.junctions.length}</span>
			</div>

			{/* Header */}
			<div className={`grid ${gridCols} gap-1 text-xs text-muted-foreground px-2 border-b pb-1`}>
				<span>#</span>
				<span>ID</span>
				<span>Position</span>
				<span>States</span>
				<span>Lights</span>
				<span>Event Jnc</span>
				<span />
				<span />
			</div>

			{/* Virtualized rows */}
			<div ref={parentRef} className="h-[60vh] overflow-auto border rounded">
				<div style={{ height: rowVirtualizer.getTotalSize(), width: '100%', position: 'relative' }}>
					{items.map((vi) => {
						const { j, i } = filtered[vi.index];
						const isSel = i === selectedJunctionIndex;
						return (
							<div
								key={vi.key}
								data-index={vi.index}
								ref={rowVirtualizer.measureElement}
								className={`absolute left-0 right-0 px-2 py-1 border-b border-border/30 cursor-pointer ${isSel ? 'bg-orange-500/10' : 'hover:bg-muted/30'}`}
								style={{ transform: `translateY(${vi.start}px)` }}
								onClick={() => onSelect({ hullIndex, sub: { type: 'junction', index: i } })}
							>
								<div className={`grid ${gridCols} gap-1 items-center`}>
									<span className="font-mono text-xs">{i}</span>
									<span className="font-mono text-xs">{j.muID}</span>
									<span className="font-mono text-xs">
										({j.mPosition.x.toFixed(1)}, {j.mPosition.y.toFixed(1)}, {j.mPosition.z.toFixed(1)})
									</span>
									<span className="text-xs text-center">{j.muNumStates}</span>
									<span className="text-xs text-center">{j.muNumLights}</span>
									<span className="text-xs">{j.muEventJunctionID}</span>
									<Button
										size="sm"
										variant="ghost"
										className="h-6 px-1 text-xs"
										onClick={(e) => { e.stopPropagation(); setDetailIndex(i); }}
									>
										...
									</Button>
									<Button
										size="sm"
										variant="ghost"
										className="h-6 px-1 text-xs text-destructive"
										onClick={(e) => { e.stopPropagation(); removeJunction(i); }}
									>
										X
									</Button>
								</div>
							</div>
						);
					})}
				</div>
			</div>

			{/* Detail dialog */}
			{detailIndex !== null && hull.junctions[detailIndex] && (
				<JunctionDetailDialog
					junction={hull.junctions[detailIndex]}
					index={detailIndex}
					open={true}
					onOpenChange={(open) => { if (!open) setDetailIndex(null); }}
					onUpdate={updateJunction}
				/>
			)}
		</div>
	);
};
