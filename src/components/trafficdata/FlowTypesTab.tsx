import React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { ParsedTrafficData, TrafficFlowType } from '@/lib/core/trafficData';

type Props = {
	data: ParsedTrafficData;
	onChange: (next: ParsedTrafficData) => void;
};

export const FlowTypesTab: React.FC<Props> = ({ data, onChange }) => {
	const updateFlow = (index: number, patch: Partial<TrafficFlowType>) => {
		const next = data.flowTypes.map((f, i) => (i === index ? { ...f, ...patch } : f));
		onChange({ ...data, flowTypes: next });
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
				<Button size="sm" variant="outline" onClick={addFlow}>Add Flow Type</Button>
			</div>

			<div className="max-h-[60vh] overflow-auto border rounded">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead className="w-12">#</TableHead>
							<TableHead>Num Vehicle Types</TableHead>
							<TableHead>Vehicle Type IDs</TableHead>
							<TableHead>Cumulative Probs</TableHead>
							<TableHead className="w-12" />
						</TableRow>
					</TableHeader>
					<TableBody>
						{data.flowTypes.map((flow, i) => (
							<TableRow key={i}>
								<TableCell className="font-mono text-xs">{i}</TableCell>
								<TableCell>{flow.muNumVehicleTypes}</TableCell>
								<TableCell>
									<Input
										className="h-7 text-xs font-mono w-64"
										value={flow.vehicleTypeIds.join(', ')}
										onChange={(e) => {
											const ids = e.target.value.split(',').map(s => parseInt(s.trim(), 10)).filter(Number.isFinite);
											updateFlow(i, { vehicleTypeIds: ids, muNumVehicleTypes: ids.length });
										}}
									/>
								</TableCell>
								<TableCell>
									<Input
										className="h-7 text-xs font-mono w-64"
										value={flow.cumulativeProbs.join(', ')}
										onChange={(e) => {
											const probs = e.target.value.split(',').map(s => parseInt(s.trim(), 10)).filter(Number.isFinite);
											updateFlow(i, { cumulativeProbs: probs });
										}}
									/>
								</TableCell>
								<TableCell>
									<Button size="sm" variant="ghost" className="h-6 px-2 text-xs text-destructive" onClick={() => removeFlow(i)}>X</Button>
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</div>
		</div>
	);
};
