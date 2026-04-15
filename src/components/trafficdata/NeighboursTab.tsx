import React, { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Trash2, Plus } from 'lucide-react';
import type { ParsedTrafficData, TrafficNeighbour } from '@/lib/core/trafficData';
import { updateHullField } from './constants';

type Props = {
	data: ParsedTrafficData;
	hullIndex: number;
	onChange: (next: ParsedTrafficData) => void;
};

function NumCell({ value, onChange, max = 255 }: { value: number; onChange: (v: number) => void; max?: number }) {
	return (
		<Input
			type="number"
			min={0}
			max={max}
			className="h-7 w-20 text-xs"
			value={value}
			onChange={(e) => {
				const v = parseInt(e.target.value, 10);
				if (Number.isFinite(v)) onChange(Math.max(0, Math.min(max, v)));
			}}
		/>
	);
}

export const NeighboursTab: React.FC<Props> = ({ data, hullIndex, onChange }) => {
	const [search, setSearch] = useState('');
	const hull = data.hulls[hullIndex];
	if (!hull) return null;

	const filtered = useMemo(() => {
		let list = hull.neighbours.map((n, i) => ({ n, i }));
		if (search) {
			const q = search.toLowerCase();
			list = list.filter(({ i, n }) => i.toString().includes(q) || n.muSection.toString().includes(q));
		}
		return list;
	}, [hull.neighbours, search]);

	const updateNeighbour = (index: number, patch: Partial<TrafficNeighbour>) => {
		onChange(updateHullField(data, hullIndex, 'neighbours', (arr) =>
			arr.map((n, i) => (i === index ? { ...n, ...patch } : n)),
		));
	};

	const addNeighbour = () => {
		const empty: TrafficNeighbour = { muSection: 0, muSharedLength: 0, muOurStartRung: 0, muTheirStartRung: 0 };
		onChange(updateHullField(data, hullIndex, 'neighbours', (arr) => [...arr, empty]));
	};

	const removeNeighbour = (index: number) => {
		onChange(updateHullField(data, hullIndex, 'neighbours', (arr) => arr.filter((_, i) => i !== index)));
	};

	return (
		<div className="space-y-2">
			<div className="flex items-center gap-2">
				<Input
					placeholder="Search by index or section..."
					className="h-8 w-56"
					value={search}
					onChange={(e) => setSearch(e.target.value)}
				/>
				<Button size="sm" variant="outline" className="h-7" onClick={addNeighbour}>
					<Plus className="h-3 w-3 mr-1" /> Add Neighbour
				</Button>
				<span className="text-xs text-muted-foreground ml-auto">
					{filtered.length} / {hull.neighbours.length}
				</span>
			</div>

			<div className="max-h-[60vh] overflow-auto border rounded">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead className="w-12">#</TableHead>
							<TableHead>Section</TableHead>
							<TableHead>Shared Length</TableHead>
							<TableHead>Our Start Rung</TableHead>
							<TableHead>Their Start Rung</TableHead>
							<TableHead className="w-12" />
						</TableRow>
					</TableHeader>
					<TableBody>
						{filtered.map(({ n, i }) => (
							<TableRow key={i}>
								<TableCell className="font-mono text-xs">{i}</TableCell>
								<TableCell><NumCell value={n.muSection} onChange={(v) => updateNeighbour(i, { muSection: v })} /></TableCell>
								<TableCell><NumCell value={n.muSharedLength} onChange={(v) => updateNeighbour(i, { muSharedLength: v })} /></TableCell>
								<TableCell><NumCell value={n.muOurStartRung} onChange={(v) => updateNeighbour(i, { muOurStartRung: v })} /></TableCell>
								<TableCell><NumCell value={n.muTheirStartRung} onChange={(v) => updateNeighbour(i, { muTheirStartRung: v })} /></TableCell>
								<TableCell>
									<Button size="sm" variant="ghost" className="h-6 px-1 text-destructive" onClick={() => removeNeighbour(i)}>
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
