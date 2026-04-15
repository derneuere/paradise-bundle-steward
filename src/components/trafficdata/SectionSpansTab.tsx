import React, { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Trash2, Plus } from 'lucide-react';
import type { ParsedTrafficData, TrafficSectionSpan } from '@/lib/core/trafficData';
import { updateHullField } from './constants';

type Props = {
	data: ParsedTrafficData;
	hullIndex: number;
	onChange: (next: ParsedTrafficData) => void;
};

// Keep the reciprocal derived from muMaxVehicles — the game uses this in
// tight inner loops so the two must agree.
function recipFromMax(max: number): number {
	return max > 0 ? 1 / max : 0;
}

export const SectionSpansTab: React.FC<Props> = ({ data, hullIndex, onChange }) => {
	const [search, setSearch] = useState('');
	const hull = data.hulls[hullIndex];
	if (!hull) return null;

	const filtered = useMemo(() => {
		let list = hull.sectionSpans.map((s, i) => ({ s, i }));
		if (search) {
			const q = search.toLowerCase();
			list = list.filter(({ i }) => i.toString().includes(q));
		}
		return list;
	}, [hull.sectionSpans, search]);

	const updateMax = (index: number, max: number) => {
		const clamped = Math.max(0, Math.min(65535, max));
		onChange(updateHullField(data, hullIndex, 'sectionSpans', (arr) =>
			arr.map((s, i) => (i === index ? { ...s, muMaxVehicles: clamped, mfMaxVehicleRecip: recipFromMax(clamped) } : s)),
		));
	};

	const addSpan = () => {
		const empty: TrafficSectionSpan = {
			muMaxVehicles: 0,
			_pad02: [0, 0],
			mfMaxVehicleRecip: 0,
		};
		onChange(updateHullField(data, hullIndex, 'sectionSpans', (arr) => [...arr, empty]));
	};

	const removeSpan = (index: number) => {
		onChange(updateHullField(data, hullIndex, 'sectionSpans', (arr) => arr.filter((_, i) => i !== index)));
	};

	return (
		<div className="space-y-2">
			<div className="flex items-center gap-2">
				<Input
					placeholder="Search by index..."
					className="h-8 w-48"
					value={search}
					onChange={(e) => setSearch(e.target.value)}
				/>
				<Button size="sm" variant="outline" className="h-7" onClick={addSpan}>
					<Plus className="h-3 w-3 mr-1" /> Add Span
				</Button>
				<span className="text-xs text-muted-foreground ml-auto">
					{filtered.length} / {hull.sectionSpans.length}
				</span>
			</div>

			<div className="max-h-[60vh] overflow-auto border rounded">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead className="w-12">#</TableHead>
							<TableHead>Max Vehicles</TableHead>
							<TableHead>Recip (auto)</TableHead>
							<TableHead className="w-12" />
						</TableRow>
					</TableHeader>
					<TableBody>
						{filtered.map(({ s, i }) => (
							<TableRow key={i}>
								<TableCell className="font-mono text-xs">{i}</TableCell>
								<TableCell>
									<Input
										type="number"
										min={0}
										max={65535}
										className="h-7 w-24 text-xs"
										value={s.muMaxVehicles}
										onChange={(e) => {
											const v = parseInt(e.target.value, 10);
											if (Number.isFinite(v)) updateMax(i, v);
										}}
									/>
								</TableCell>
								<TableCell className="font-mono text-xs text-muted-foreground">
									{s.mfMaxVehicleRecip.toFixed(6)}
								</TableCell>
								<TableCell>
									<Button size="sm" variant="ghost" className="h-6 px-1 text-destructive" onClick={() => removeSpan(i)}>
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
