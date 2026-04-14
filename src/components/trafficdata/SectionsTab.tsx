import React, { useMemo, useState, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import type { ParsedTrafficData, TrafficSection } from '@/lib/core/trafficData';
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

export const SectionsTab: React.FC<Props> = ({ data, hullIndex, onChange, selected, onSelect, scrollToIndexRef }) => {
	const [search, setSearch] = useState('');
	const parentRef = useRef<HTMLDivElement>(null);
	const hull = data.hulls[hullIndex];
	if (!hull) return null;

	const filtered = useMemo(() => {
		let list = hull.sections.map((s, i) => ({ s, i }));
		if (search) {
			const q = search.toLowerCase();
			list = list.filter(({ i }) => i.toString().includes(q));
		}
		return list;
	}, [hull.sections, search]);

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

	const updateSection = (index: number, patch: Partial<TrafficSection>) => {
		onChange(updateHullField(data, hullIndex, 'sections', (arr) =>
			arr.map((s, i) => (i === index ? { ...s, ...patch } : s)),
		));
	};

	const removeSection = (index: number) => {
		onChange(updateHullField(data, hullIndex, 'sections', (arr) =>
			arr.filter((_, i) => i !== index),
		));
	};

	const selectedSectionIndex = selected?.hullIndex === hullIndex && selected.sub?.type === 'section'
		? selected.sub.index : -1;

	const items = rowVirtualizer.getVirtualItems();
	const gridCols = 'grid-cols-[3rem_5rem_5rem_4rem_4rem_4rem_4rem_4rem_4rem_2rem]';

	return (
		<div className="space-y-2">
			<div className="flex items-center gap-2">
				<Input
					placeholder="Search by index..."
					className="h-8 w-48"
					value={search}
					onChange={(e) => setSearch(e.target.value)}
				/>
				<span className="text-xs text-muted-foreground ml-auto">{filtered.length} / {hull.sections.length}</span>
			</div>

			{/* Header */}
			<div className={`grid ${gridCols} gap-1 text-xs text-muted-foreground px-2 border-b pb-1`}>
				<span>#</span>
				<span>Speed</span>
				<span>Length</span>
				<span>L Turn</span>
				<span>R Turn</span>
				<span>L Lane</span>
				<span>R Lane</span>
				<span>Span</span>
				<span>Rungs</span>
				<span />
			</div>

			{/* Virtualized rows */}
			<div ref={parentRef} className="h-[60vh] overflow-auto border rounded">
				<div style={{ height: rowVirtualizer.getTotalSize(), width: '100%', position: 'relative' }}>
					{items.map((vi) => {
						const { s, i } = filtered[vi.index];
						const isSel = i === selectedSectionIndex;
						return (
							<div
								key={vi.key}
								data-index={vi.index}
								ref={rowVirtualizer.measureElement}
								className={`absolute left-0 right-0 px-2 py-1 border-b border-border/30 cursor-pointer ${isSel ? 'bg-orange-500/10' : 'hover:bg-muted/30'}`}
								style={{ transform: `translateY(${vi.start}px)` }}
								onClick={() => onSelect({ hullIndex, sub: { type: 'section', index: i } })}
							>
								<div className={`grid ${gridCols} gap-1 items-center`}>
									<span className="font-mono text-xs">{i}</span>
									<Input
										type="number"
										step={0.1}
										className="h-7 w-[4.5rem] text-xs"
										value={s.mfSpeed.toFixed(2)}
										onChange={(e) => {
											const v = parseFloat(e.target.value);
											if (Number.isFinite(v)) updateSection(i, { mfSpeed: v });
										}}
										onClick={(e) => e.stopPropagation()}
									/>
									<Input
										type="number"
										step={0.1}
										className="h-7 w-[4.5rem] text-xs"
										value={s.mfLength.toFixed(2)}
										onChange={(e) => {
											const v = parseFloat(e.target.value);
											if (Number.isFinite(v)) updateSection(i, { mfLength: v });
										}}
										onClick={(e) => e.stopPropagation()}
									/>
									<span className="text-xs text-center">{s.muTurnLeftProb}</span>
									<span className="text-xs text-center">{s.muTurnRightProb}</span>
									<span className="text-xs text-center">{s.muChangeLeftProb}</span>
									<span className="text-xs text-center">{s.muChangeRightProb}</span>
									<span className="text-xs text-center">{s.muSpanIndex}</span>
									<span className="text-xs text-center">{s.muNumRungs}</span>
									<Button
										size="sm"
										variant="ghost"
										className="h-6 px-1 text-xs text-destructive"
										onClick={(e) => { e.stopPropagation(); removeSection(i); }}
									>
										X
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
