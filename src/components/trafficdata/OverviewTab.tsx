import React, { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { ParsedTrafficData } from '@/lib/core/trafficData';
import { hullColor } from './constants';

type Props = {
	data: ParsedTrafficData;
	onChange: (next: ParsedTrafficData) => void;
	onHullClick: (index: number) => void;
};

export const OverviewTab: React.FC<Props> = ({ data, onChange, onHullClick }) => {
	const totals = useMemo(() => {
		let sections = 0, rungs = 0, junctions = 0, stopLines = 0, lightTriggers = 0, staticVehicles = 0, neighbours = 0;
		for (const h of data.hulls) {
			sections += h.sections.length;
			rungs += h.rungs.length;
			junctions += h.junctions.length;
			stopLines += h.stopLines.length;
			lightTriggers += h.lightTriggers.length;
			staticVehicles += h.staticTrafficVehicles.length;
			neighbours += h.neighbours.length;
		}
		return { sections, rungs, junctions, stopLines, lightTriggers, staticVehicles, neighbours };
	}, [data.hulls]);

	return (
		<div className="space-y-4">
			{/* Summary stats */}
			<div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2 text-sm">
				<div><span className="text-muted-foreground">Version:</span>{' '}
					<Input
						type="number"
						className="inline-block h-7 w-16"
						value={data.muDataVersion}
						onChange={(e) => {
							const v = parseInt(e.target.value, 10);
							if (Number.isFinite(v)) onChange({ ...data, muDataVersion: v & 0xFF });
						}}
					/>
				</div>
				<div><span className="text-muted-foreground">Hulls:</span> {data.hulls.length}</div>
				<div><span className="text-muted-foreground">Sections:</span> {totals.sections}</div>
				<div><span className="text-muted-foreground">Rungs:</span> {totals.rungs}</div>
				<div><span className="text-muted-foreground">Junctions:</span> {totals.junctions}</div>
				<div><span className="text-muted-foreground">Stop Lines:</span> {totals.stopLines}</div>
				<div><span className="text-muted-foreground">Light Triggers:</span> {totals.lightTriggers}</div>
				<div><span className="text-muted-foreground">Static Vehicles:</span> {totals.staticVehicles}</div>
				<div><span className="text-muted-foreground">Neighbours:</span> {totals.neighbours}</div>
				<div><span className="text-muted-foreground">Flow Types:</span> {data.flowTypes.length}</div>
				<div><span className="text-muted-foreground">Vehicle Types:</span> {data.vehicleTypes.length}</div>
				<div><span className="text-muted-foreground">Paint Colours:</span> {data.paintColours.length}</div>
			</div>

			{/* PVS info */}
			<Card>
				<CardHeader><CardTitle className="text-sm">PVS (Potentially Visible Set)</CardTitle></CardHeader>
				<CardContent>
					<div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
						<div><span className="text-muted-foreground">Grid Min:</span> ({data.pvs.mGridMin.x.toFixed(1)}, {data.pvs.mGridMin.y.toFixed(1)}, {data.pvs.mGridMin.z.toFixed(1)})</div>
						<div><span className="text-muted-foreground">Cell Size:</span> ({data.pvs.mCellSize.x.toFixed(1)}, {data.pvs.mCellSize.z.toFixed(1)})</div>
						<div><span className="text-muted-foreground">Cells:</span> {data.pvs.muNumCells_X} x {data.pvs.muNumCells_Z} = {data.pvs.muNumCells}</div>
						<div><span className="text-muted-foreground">Hull PVS Sets:</span> {data.pvs.hullPvsSets.length}</div>
					</div>
				</CardContent>
			</Card>

			{/* Per-hull summary */}
			<Card>
				<CardHeader><CardTitle className="text-sm">Hulls</CardTitle></CardHeader>
				<CardContent>
					<div className="max-h-[40vh] overflow-auto border rounded">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead className="w-12">#</TableHead>
									<TableHead>Sections</TableHead>
									<TableHead>Rungs</TableHead>
									<TableHead>Neighbours</TableHead>
									<TableHead>Junctions</TableHead>
									<TableHead>Stop Lines</TableHead>
									<TableHead>Triggers</TableHead>
									<TableHead>Static</TableHead>
									<TableHead>Spans</TableHead>
									<TableHead>Assets</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{data.hulls.map((h, i) => (
									<TableRow
										key={i}
										className="cursor-pointer hover:bg-muted/50"
										onClick={() => onHullClick(i)}
									>
										<TableCell>
											<span className="font-mono text-xs" style={{ color: hullColor(i) }}>{i}</span>
										</TableCell>
										<TableCell>{h.sections.length}</TableCell>
										<TableCell>{h.rungs.length}</TableCell>
										<TableCell>{h.neighbours.length}</TableCell>
										<TableCell>{h.junctions.length}</TableCell>
										<TableCell>{h.stopLines.length}</TableCell>
										<TableCell>{h.lightTriggers.length}</TableCell>
										<TableCell>{h.staticTrafficVehicles.length}</TableCell>
										<TableCell>{h.sectionSpans.length}</TableCell>
										<TableCell>{h.muNumVehicleAssets}</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</div>
				</CardContent>
			</Card>
		</div>
	);
};
