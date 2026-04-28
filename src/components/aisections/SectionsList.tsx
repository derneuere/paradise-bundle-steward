import React, { useMemo, useState, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { ParsedAISections, AISection } from '@/lib/core/aiSections';
import { SectionSpeed } from '@/lib/core/aiSections';
import { deleteSection } from '@/lib/core/aiSectionsOps';
import { SPEED_LABELS, FLAG_NAMES } from './constants';

type Props = {
	data: ParsedAISections;
	onChange: (next: ParsedAISections) => void;
	onAddClick: () => void;
	onDetailClick: (index: number) => void;
	scrollToIndexRef: React.MutableRefObject<((index: number) => void) | null>;
};

export const SectionsList: React.FC<Props> = ({ data, onChange, onAddClick, onDetailClick, scrollToIndexRef }) => {
	const [search, setSearch] = useState('');
	const [flagFilter, setFlagFilter] = useState<number | null>(null);
	const parentRef = useRef<HTMLDivElement>(null);

	const filtered = useMemo(() => {
		let list = data.sections.map((s, i) => ({ s, i }));
		if (search) {
			const q = search.toLowerCase();
			const hexQ = q.startsWith('0x') ? parseInt(q, 16) : NaN;
			list = list.filter(({ s, i }) =>
				i.toString().includes(q)
				|| s.id.toString(16).toLowerCase().includes(q.replace('0x', ''))
				|| (!isNaN(hexQ) && s.id === hexQ)
			);
		}
		if (flagFilter !== null) {
			list = list.filter(({ s }) => s.flags & flagFilter);
		}
		return list;
	}, [data.sections, search, flagFilter]);

	const rowVirtualizer = useVirtualizer({
		count: filtered.length,
		getScrollElement: () => parentRef.current,
		estimateSize: () => 44,
		overscan: 12,
	});

	// Expose scroll-to for the parent (used after add)
	scrollToIndexRef.current = (originalIndex: number) => {
		// Find the filtered position of the original index
		const filteredIdx = filtered.findIndex(({ i }) => i === originalIndex);
		if (filteredIdx >= 0) {
			rowVirtualizer.scrollToIndex(filteredIdx, { align: 'center' });
		}
	};

	const updateSection = (index: number, patch: Partial<AISection>) => {
		const next = data.sections.map((s, i) => (i === index ? { ...s, ...patch } : s));
		onChange({ ...data, sections: next });
	};

	const removeSection = (index: number) => {
		// Use the safe op so cross-references stay consistent: it drops portals
		// pointing AT the deleted section, decrements `linkSection` indices
		// `> index` by one, and re-threads `sectionResetPairs` the same way.
		// A naive `sections.filter` would silently leave dangling references.
		onChange(deleteSection(data, index));
	};

	const items = rowVirtualizer.getVirtualItems();

	// Grid column template matching the header
	const gridCols = 'grid-cols-[3rem_7rem_5rem_6rem_5rem_18rem_3rem_3rem_3rem_2rem]';

	return (
		<div className="space-y-2">
			<div className="flex items-center gap-2 flex-wrap">
				<Input
					placeholder="Search by index or ID..."
					className="h-8 w-64"
					value={search}
					onChange={(e) => setSearch(e.target.value)}
				/>
				<div className="flex gap-1">
					{FLAG_NAMES.map(({ flag, label }) => (
						<Button
							key={flag}
							size="sm"
							variant={flagFilter === flag ? 'default' : 'outline'}
							className="h-7 px-2 text-xs"
							onClick={() => setFlagFilter(flagFilter === flag ? null : flag)}
						>
							{label}
						</Button>
					))}
				</div>
				<Button size="sm" variant="outline" className="h-7" onClick={onAddClick}>Add Section</Button>
				<span className="text-xs text-muted-foreground ml-auto">{filtered.length} / {data.sections.length}</span>
			</div>

			{/* Header */}
			<div className={`grid ${gridCols} gap-1 text-xs text-muted-foreground px-2 border-b pb-1`}>
				<span>#</span>
				<span>ID</span>
				<span>Span</span>
				<span>Speed</span>
				<span>District</span>
				<span>Flags</span>
				<span>Ptl</span>
				<span>NoGo</span>
				<span></span>
				<span></span>
			</div>

			{/* Virtualized rows */}
			<div ref={parentRef} className="h-[60vh] overflow-auto border rounded">
				<div style={{ height: rowVirtualizer.getTotalSize(), width: '100%', position: 'relative' }}>
					{items.map((vi) => {
						const { s, i } = filtered[vi.index];
						return (
							<div
								key={vi.key}
								data-index={vi.index}
								ref={rowVirtualizer.measureElement}
								className="absolute left-0 right-0 px-2 py-1 border-b border-border/30 hover:bg-muted/30"
								style={{ transform: `translateY(${vi.start}px)` }}
							>
								<div className={`grid ${gridCols} gap-1 items-center`}>
									{/* # */}
									<span className="font-mono text-xs">{i}</span>

									{/* ID (hex, editable) */}
									<Input
										className="h-7 w-[6.5rem] font-mono text-xs"
										value={`0x${(s.id >>> 0).toString(16).toUpperCase()}`}
										onChange={(e) => {
											const raw = e.target.value.replace(/^0x/i, '');
											const v = parseInt(raw, 16);
											if (Number.isFinite(v)) updateSection(i, { id: v >>> 0 });
										}}
									/>

									{/* Span */}
									<Input
										type="number"
										className="h-7 w-[4.5rem] text-xs"
										value={s.spanIndex}
										onChange={(e) => {
											const v = parseInt(e.target.value, 10);
											if (Number.isFinite(v)) updateSection(i, { spanIndex: v });
										}}
									/>

									{/* Speed */}
									<select
										className="h-7 border rounded px-1 text-xs bg-background w-[5.5rem]"
										value={s.speed}
										onChange={(e) => updateSection(i, { speed: parseInt(e.target.value, 10) as SectionSpeed })}
									>
										{Object.entries(SPEED_LABELS).map(([v, label]) => (
											<option key={v} value={v}>{label}</option>
										))}
									</select>

									{/* District */}
									<Input
										type="number"
										className="h-7 w-[4.5rem] text-xs"
										value={s.district}
										onChange={(e) => {
											const v = parseInt(e.target.value, 10);
											if (Number.isFinite(v)) updateSection(i, { district: v & 0xFF });
										}}
									/>

									{/* Flags */}
									<div className="flex gap-0.5 flex-wrap">
										{FLAG_NAMES.map(({ flag, label }) => (
											<Badge
												key={flag}
												variant={s.flags & flag ? 'default' : 'outline'}
												className="cursor-pointer text-[10px] px-1"
												onClick={() => updateSection(i, { flags: (s.flags ^ flag) & 0xFF })}
											>
												{label}
											</Badge>
										))}
									</div>

									{/* Portals count */}
									<span className="text-xs text-center">{s.portals.length}</span>

									{/* NoGo count */}
									<span className="text-xs text-center">{s.noGoLines.length}</span>

									{/* Detail button */}
									<Button
										size="sm"
										variant="ghost"
										className="h-6 px-1 text-xs"
										onClick={() => onDetailClick(i)}
									>
										...
									</Button>

									{/* Remove */}
									<Button
										size="sm"
										variant="ghost"
										className="h-6 px-1 text-xs text-destructive"
										onClick={() => removeSection(i)}
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
