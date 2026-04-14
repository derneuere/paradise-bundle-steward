import React, { useMemo, useState, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Input } from '@/components/ui/input';
import type { ParsedTrafficData, Vec4 } from '@/lib/core/trafficData';
import { updateHullField, buildRungToSectionMap } from './constants';

type Props = {
	data: ParsedTrafficData;
	hullIndex: number;
	onChange: (next: ParsedTrafficData) => void;
	scrollToIndexRef: React.MutableRefObject<((index: number) => void) | null>;
};

function V4Cell({ value, onChange }: { value: Vec4; onChange: (v: Vec4) => void }) {
	const set = (key: keyof Vec4, raw: string) => {
		const v = parseFloat(raw);
		if (Number.isFinite(v)) onChange({ ...value, [key]: v });
	};
	return (
		<div className="flex gap-0.5">
			{(['x', 'y', 'z', 'w'] as const).map((k) => (
				<Input
					key={k}
					type="number"
					step={0.1}
					className="h-7 w-[4.5rem] text-xs font-mono"
					value={value[k].toFixed(2)}
					onChange={(e) => set(k, e.target.value)}
				/>
			))}
		</div>
	);
}

export const LaneRungsTab: React.FC<Props> = ({ data, hullIndex, onChange, scrollToIndexRef }) => {
	const [search, setSearch] = useState('');
	const parentRef = useRef<HTMLDivElement>(null);
	const hull = data.hulls[hullIndex];
	if (!hull) return null;

	const rungToSection = useMemo(() => buildRungToSectionMap(hull), [hull]);

	const filtered = useMemo(() => {
		let list = hull.rungs.map((r, i) => ({ r, i }));
		if (search) {
			const q = search.toLowerCase();
			list = list.filter(({ i }) => i.toString().includes(q));
		}
		return list;
	}, [hull.rungs, search]);

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

	const updateRung = (index: number, pointIdx: 0 | 1, value: Vec4) => {
		onChange(updateHullField(data, hullIndex, 'rungs', (arr) =>
			arr.map((r, i) => {
				if (i !== index) return r;
				const pts: [Vec4, Vec4] = [r.maPoints[0], r.maPoints[1]];
				pts[pointIdx] = value;
				return { maPoints: pts };
			}),
		));
	};

	const items = rowVirtualizer.getVirtualItems();

	return (
		<div className="space-y-2">
			<div className="flex items-center gap-2">
				<Input
					placeholder="Search by index..."
					className="h-8 w-48"
					value={search}
					onChange={(e) => setSearch(e.target.value)}
				/>
				<span className="text-xs text-muted-foreground ml-auto">{filtered.length} / {hull.rungs.length}</span>
			</div>

			{/* Header */}
			<div className="grid grid-cols-[3rem_1fr_1fr_4rem_5rem] gap-1 text-xs text-muted-foreground px-2 border-b pb-1">
				<span>#</span>
				<span>Point A (x, y, z, w)</span>
				<span>Point B (x, y, z, w)</span>
				<span>Sec</span>
				<span>Cum Len</span>
			</div>

			{/* Virtualized rows */}
			<div ref={parentRef} className="h-[60vh] overflow-auto border rounded">
				<div style={{ height: rowVirtualizer.getTotalSize(), width: '100%', position: 'relative' }}>
					{items.map((vi) => {
						const { r, i } = filtered[vi.index];
						return (
							<div
								key={vi.key}
								data-index={vi.index}
								ref={rowVirtualizer.measureElement}
								className="absolute left-0 right-0 px-2 py-1 border-b border-border/30 hover:bg-muted/30"
								style={{ transform: `translateY(${vi.start}px)` }}
							>
								<div className="grid grid-cols-[3rem_1fr_1fr_4rem_5rem] gap-1 items-center">
									<span className="font-mono text-xs">{i}</span>
									<V4Cell value={r.maPoints[0]} onChange={(v) => updateRung(i, 0, v)} />
									<V4Cell value={r.maPoints[1]} onChange={(v) => updateRung(i, 1, v)} />
									<span className="text-xs text-center">{rungToSection[i] >= 0 ? rungToSection[i] : '—'}</span>
									<span className="text-xs font-mono">{hull.cumulativeRungLengths[i]?.toFixed(2) ?? '—'}</span>
								</div>
							</div>
						);
					})}
				</div>
			</div>
		</div>
	);
};
