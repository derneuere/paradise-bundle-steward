import React, { useMemo, useState, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Trash2, Plus } from 'lucide-react';
import type { ParsedTrafficData, TrafficStaticVehicle } from '@/lib/core/trafficData';
import type { TrafficDataSelection } from './useTrafficSelection';
import { updateHullField, VEHICLE_CLASS_LABELS } from './constants';

type Props = {
	data: ParsedTrafficData;
	hullIndex: number;
	onChange: (next: ParsedTrafficData) => void;
	selected: TrafficDataSelection;
	onSelect: (sel: TrafficDataSelection) => void;
	scrollToIndexRef: React.MutableRefObject<((index: number) => void) | null>;
};

// Matrix44Affine layout (row-major 4x4, affine = last row is identity).
// Translation row lives at indices 12, 13, 14 (mTransform[12..15] = (tx, ty, tz, 1)).
const TX = 12, TY = 13, TZ = 14;

function identityTransform(): number[] {
	const m = new Array(16).fill(0);
	m[0] = 1; m[5] = 1; m[10] = 1; m[15] = 1;
	return m;
}

function flowTypeLabel(data: ParsedTrafficData, index: number): string {
	const ft = data.flowTypes[index];
	if (!ft) return `#${index} (missing)`;
	if (ft.vehicleTypeIds.length === 0) return `#${index} (empty)`;
	const first = ft.vehicleTypeIds[0];
	const vt = data.vehicleTypes[first];
	const cls = vt ? (VEHICLE_CLASS_LABELS[vt.muVehicleClass] ?? '?') : '?';
	const more = ft.vehicleTypeIds.length > 1 ? ` +${ft.vehicleTypeIds.length - 1}` : '';
	return `#${index} — ${cls}${more}`;
}

// BrnTraffic::StaticTrafficVehicle does not have named flag bits in the wiki,
// so expose muFlags as a raw u8 for now.

export const StaticVehiclesTab: React.FC<Props> = ({
	data, hullIndex, onChange, selected, onSelect, scrollToIndexRef,
}) => {
	const [search, setSearch] = useState('');
	const parentRef = useRef<HTMLDivElement>(null);
	const hull = data.hulls[hullIndex];
	if (!hull) return null;

	const filtered = useMemo(() => {
		let list = hull.staticTrafficVehicles.map((v, i) => ({ v, i }));
		if (search) {
			const q = search.toLowerCase();
			list = list.filter(({ i }) => i.toString().includes(q));
		}
		return list;
	}, [hull.staticTrafficVehicles, search]);

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

	const updateVehicle = (index: number, patch: Partial<TrafficStaticVehicle>) => {
		onChange(updateHullField(data, hullIndex, 'staticTrafficVehicles', (arr) =>
			arr.map((v, i) => (i === index ? { ...v, ...patch } : v)),
		));
	};

	const updateTransform = (index: number, slot: number, value: number) => {
		onChange(updateHullField(data, hullIndex, 'staticTrafficVehicles', (arr) =>
			arr.map((v, i) => {
				if (i !== index) return v;
				const m = v.mTransform.slice();
				m[slot] = value;
				return { ...v, mTransform: m };
			}),
		));
	};

	const addVehicle = () => {
		const empty: TrafficStaticVehicle = {
			mTransform: identityTransform(),
			mFlowTypeID: 0,
			mExistsAtAllChance: 255,
			muFlags: 0,
			_pad43: new Array(12).fill(0),
		};
		const newIndex = hull.staticTrafficVehicles.length;
		onChange(updateHullField(data, hullIndex, 'staticTrafficVehicles', (arr) => [...arr, empty]));
		requestAnimationFrame(() => scrollToIndexRef.current?.(newIndex));
	};

	const removeVehicle = (index: number) => {
		onChange(updateHullField(data, hullIndex, 'staticTrafficVehicles', (arr) => arr.filter((_, i) => i !== index)));
	};

	const selectedIndex = selected?.hullIndex === hullIndex && selected.sub?.type === 'staticVehicle'
		? selected.sub.index : -1;

	const items = rowVirtualizer.getVirtualItems();
	const gridCols = 'grid-cols-[3rem_6rem_6rem_6rem_12rem_5rem_5rem_2rem]';

	return (
		<div className="space-y-2">
			<div className="flex items-center gap-2">
				<Input
					placeholder="Search by index..."
					className="h-8 w-48"
					value={search}
					onChange={(e) => setSearch(e.target.value)}
				/>
				<Button size="sm" variant="outline" className="h-7" onClick={addVehicle}>
					<Plus className="h-3 w-3 mr-1" /> Add Static Vehicle
				</Button>
				<span className="text-xs text-muted-foreground ml-auto">
					{filtered.length} / {hull.staticTrafficVehicles.length}
				</span>
			</div>

			<div className={`grid ${gridCols} gap-1 text-xs text-muted-foreground px-2 border-b pb-1`}>
				<span>#</span>
				<span>X</span>
				<span>Y</span>
				<span>Z</span>
				<span>Flow Type</span>
				<span>Exists</span>
				<span>Flags</span>
				<span />
			</div>

			<div ref={parentRef} className="h-[60vh] overflow-auto border rounded">
				<div style={{ height: rowVirtualizer.getTotalSize(), width: '100%', position: 'relative' }}>
					{items.map((vi) => {
						const { v, i } = filtered[vi.index];
						const isSel = i === selectedIndex;
						const missingFlow = !data.flowTypes[v.mFlowTypeID];
						return (
							<div
								key={vi.key}
								data-index={vi.index}
								ref={rowVirtualizer.measureElement}
								className={`absolute left-0 right-0 px-2 py-1 border-b border-border/30 cursor-pointer ${isSel ? 'bg-orange-500/10' : 'hover:bg-muted/30'}`}
								style={{ transform: `translateY(${vi.start}px)` }}
								onClick={() => onSelect({ hullIndex, sub: { type: 'staticVehicle', index: i } })}
							>
								<div className={`grid ${gridCols} gap-1 items-center`}>
									<span className="font-mono text-xs">{i}</span>
									<Input
										type="number"
										step="any"
										className="h-7 w-[5.5rem] text-xs font-mono"
										value={v.mTransform[TX]?.toFixed(2) ?? '0'}
										onChange={(e) => {
											const nv = parseFloat(e.target.value);
											if (Number.isFinite(nv)) updateTransform(i, TX, nv);
										}}
										onClick={(e) => e.stopPropagation()}
									/>
									<Input
										type="number"
										step="any"
										className="h-7 w-[5.5rem] text-xs font-mono"
										value={v.mTransform[TY]?.toFixed(2) ?? '0'}
										onChange={(e) => {
											const nv = parseFloat(e.target.value);
											if (Number.isFinite(nv)) updateTransform(i, TY, nv);
										}}
										onClick={(e) => e.stopPropagation()}
									/>
									<Input
										type="number"
										step="any"
										className="h-7 w-[5.5rem] text-xs font-mono"
										value={v.mTransform[TZ]?.toFixed(2) ?? '0'}
										onChange={(e) => {
											const nv = parseFloat(e.target.value);
											if (Number.isFinite(nv)) updateTransform(i, TZ, nv);
										}}
										onClick={(e) => e.stopPropagation()}
									/>
									<div className="flex items-center gap-1">
										<select
											className={`h-7 border rounded px-1 text-xs bg-background w-full ${missingFlow ? 'border-destructive text-destructive' : ''}`}
											value={v.mFlowTypeID}
											onChange={(e) => updateVehicle(i, { mFlowTypeID: parseInt(e.target.value, 10) & 0xFFFF })}
											onClick={(e) => e.stopPropagation()}
										>
											{data.flowTypes.map((_, fi) => (
												<option key={fi} value={fi}>{flowTypeLabel(data, fi)}</option>
											))}
											{missingFlow && <option value={v.mFlowTypeID}>{`#${v.mFlowTypeID} (missing)`}</option>}
										</select>
										{missingFlow && <Badge variant="destructive" className="text-[10px]">!</Badge>}
									</div>
									<Input
										type="number"
										min={0}
										max={255}
										className="h-7 w-14 text-xs"
										value={v.mExistsAtAllChance}
										onChange={(e) => {
											const nv = parseInt(e.target.value, 10);
											if (Number.isFinite(nv)) updateVehicle(i, { mExistsAtAllChance: Math.max(0, Math.min(255, nv)) });
										}}
										onClick={(e) => e.stopPropagation()}
									/>
									<Input
										type="number"
										min={0}
										max={255}
										className="h-7 w-14 text-xs"
										value={v.muFlags}
										onChange={(e) => {
											const nv = parseInt(e.target.value, 10);
											if (Number.isFinite(nv)) updateVehicle(i, { muFlags: nv & 0xFF });
										}}
										onClick={(e) => e.stopPropagation()}
									/>
									<Button
										size="sm"
										variant="ghost"
										className="h-6 px-1 text-destructive"
										onClick={(e) => { e.stopPropagation(); removeVehicle(i); }}
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
