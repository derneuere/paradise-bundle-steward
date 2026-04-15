import React, { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Trash2, Plus } from 'lucide-react';
import type { ParsedTrafficData, TrafficSectionFlow } from '@/lib/core/trafficData';
import { updateHullField, VEHICLE_CLASS_LABELS } from './constants';

type Props = {
	data: ParsedTrafficData;
	hullIndex: number;
	onChange: (next: ParsedTrafficData) => void;
};

// Short summary of a flow type for the dropdown.
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

export const SectionFlowsTab: React.FC<Props> = ({ data, hullIndex, onChange }) => {
	const [search, setSearch] = useState('');
	const hull = data.hulls[hullIndex];
	if (!hull) return null;

	const filtered = useMemo(() => {
		let list = hull.sectionFlows.map((f, i) => ({ f, i }));
		if (search) {
			const q = search.toLowerCase();
			list = list.filter(({ i }) => i.toString().includes(q));
		}
		return list;
	}, [hull.sectionFlows, search]);

	const updateFlow = (index: number, patch: Partial<TrafficSectionFlow>) => {
		onChange(updateHullField(data, hullIndex, 'sectionFlows', (arr) =>
			arr.map((f, i) => (i === index ? { ...f, ...patch } : f)),
		));
	};

	const addFlow = () => {
		const empty: TrafficSectionFlow = { muFlowTypeId: 0, muVehiclesPerMinute: 0 };
		onChange(updateHullField(data, hullIndex, 'sectionFlows', (arr) => [...arr, empty]));
	};

	const removeFlow = (index: number) => {
		onChange(updateHullField(data, hullIndex, 'sectionFlows', (arr) => arr.filter((_, i) => i !== index)));
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
				<Button size="sm" variant="outline" className="h-7" onClick={addFlow}>
					<Plus className="h-3 w-3 mr-1" /> Add Section Flow
				</Button>
				<span className="text-xs text-muted-foreground ml-auto">
					{filtered.length} / {hull.sectionFlows.length}
				</span>
			</div>

			<div className="max-h-[60vh] overflow-auto border rounded">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead className="w-12">#</TableHead>
							<TableHead>Flow Type</TableHead>
							<TableHead>Vehicles / Minute</TableHead>
							<TableHead className="w-12" />
						</TableRow>
					</TableHeader>
					<TableBody>
						{filtered.map(({ f, i }) => {
							const missing = !data.flowTypes[f.muFlowTypeId];
							return (
								<TableRow key={i}>
									<TableCell className="font-mono text-xs">{i}</TableCell>
									<TableCell>
										<div className="flex items-center gap-2">
											<select
												className={`h-7 border rounded px-1 text-xs bg-background w-64 ${missing ? 'border-destructive text-destructive' : ''}`}
												value={f.muFlowTypeId}
												onChange={(e) => updateFlow(i, { muFlowTypeId: parseInt(e.target.value, 10) & 0xFFFF })}
											>
												{data.flowTypes.map((_, fi) => (
													<option key={fi} value={fi}>{flowTypeLabel(data, fi)}</option>
												))}
												{missing && <option value={f.muFlowTypeId}>{`#${f.muFlowTypeId} (missing)`}</option>}
											</select>
											{missing && <Badge variant="destructive" className="text-[10px]">dangling</Badge>}
										</div>
									</TableCell>
									<TableCell>
										<Input
											type="number"
											min={0}
											max={65535}
											className="h-7 w-24 text-xs"
											value={f.muVehiclesPerMinute}
											onChange={(e) => {
												const v = parseInt(e.target.value, 10);
												if (Number.isFinite(v)) updateFlow(i, { muVehiclesPerMinute: Math.max(0, Math.min(65535, v)) });
											}}
										/>
									</TableCell>
									<TableCell>
										<Button size="sm" variant="ghost" className="h-6 px-1 text-destructive" onClick={() => removeFlow(i)}>
											<Trash2 className="h-3 w-3" />
										</Button>
									</TableCell>
								</TableRow>
							);
						})}
					</TableBody>
				</Table>
			</div>
		</div>
	);
};
