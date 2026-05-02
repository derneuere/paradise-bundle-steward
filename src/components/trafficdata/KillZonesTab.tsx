import React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { ParsedTrafficDataRetail, TrafficKillZone, TrafficKillZoneRegion } from '@/lib/core/trafficData';

type Props = {
	data: ParsedTrafficDataRetail;
	onChange: (next: ParsedTrafficDataRetail) => void;
};

function NumberCell({ value, onChange, width = 'w-20' }: { value: number; onChange: (v: number) => void; width?: string }) {
	return (
		<Input
			type="number"
			className={`h-7 ${width} text-xs`}
			value={Number.isFinite(value) ? value : 0}
			onChange={(e) => {
				const v = parseInt(e.target.value, 10);
				if (Number.isFinite(v)) onChange(v);
			}}
		/>
	);
}

export const KillZonesTab: React.FC<Props> = ({ data, onChange }) => {
	// Kill Zones + IDs (paired arrays)
	const updateKillZone = (index: number, patch: Partial<TrafficKillZone>) => {
		const next = data.killZones.map((k, i) => (i === index ? { ...k, ...patch } : k));
		onChange({ ...data, killZones: next });
	};

	const addKillZone = () => {
		const empty: TrafficKillZone = { muOffset: 0, muCount: 0, _pad03: 0 };
		onChange({
			...data,
			killZoneIds: [...data.killZoneIds, 0n],
			killZones: [...data.killZones, empty],
		});
	};

	const removeKillZone = (index: number) => {
		onChange({
			...data,
			killZoneIds: data.killZoneIds.filter((_, i) => i !== index),
			killZones: data.killZones.filter((_, i) => i !== index),
		});
	};

	// Kill Zone Regions
	const updateRegion = (index: number, patch: Partial<TrafficKillZoneRegion>) => {
		const next = data.killZoneRegions.map((r, i) => (i === index ? { ...r, ...patch } : r));
		onChange({ ...data, killZoneRegions: next });
	};

	const addRegion = () => {
		const empty: TrafficKillZoneRegion = { muHull: 0, muSection: 0, muStartRung: 0, muEndRung: 0, _pad05: 0 };
		onChange({ ...data, killZoneRegions: [...data.killZoneRegions, empty] });
	};

	const removeRegion = (index: number) => {
		onChange({ ...data, killZoneRegions: data.killZoneRegions.filter((_, i) => i !== index) });
	};

	return (
		<div className="space-y-4">
			{/* Kill Zones */}
			<Card>
				<CardHeader>
					<div className="flex items-center justify-between">
						<CardTitle className="text-sm">Kill Zones ({data.killZones.length})</CardTitle>
						<Button size="sm" variant="outline" onClick={addKillZone}>Add</Button>
					</div>
				</CardHeader>
				<CardContent>
					<div className="max-h-[30vh] overflow-auto border rounded">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead className="w-12">#</TableHead>
									<TableHead>ID (hex)</TableHead>
									<TableHead>Offset</TableHead>
									<TableHead>Count</TableHead>
									<TableHead className="w-12" />
								</TableRow>
							</TableHeader>
							<TableBody>
								{data.killZones.map((kz, i) => (
									<TableRow key={i}>
										<TableCell className="font-mono text-xs">{i}</TableCell>
										<TableCell>
											<Input
												className="h-7 w-40 font-mono text-xs"
												value={`0x${data.killZoneIds[i]?.toString(16).toUpperCase() ?? '0'}`}
												onChange={(e) => {
													const raw = e.target.value.replace(/^0x/i, '');
													try {
														const v = BigInt(`0x${raw || '0'}`);
														const ids = data.killZoneIds.slice();
														ids[i] = v;
														onChange({ ...data, killZoneIds: ids });
													} catch { /* ignore invalid */ }
												}}
											/>
										</TableCell>
										<TableCell><NumberCell value={kz.muOffset} onChange={(v) => updateKillZone(i, { muOffset: v })} /></TableCell>
										<TableCell><NumberCell value={kz.muCount} onChange={(v) => updateKillZone(i, { muCount: v })} /></TableCell>
										<TableCell>
											<Button size="sm" variant="ghost" className="h-6 px-2 text-xs text-destructive" onClick={() => removeKillZone(i)}>X</Button>
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</div>
				</CardContent>
			</Card>

			{/* Kill Zone Regions */}
			<Card>
				<CardHeader>
					<div className="flex items-center justify-between">
						<CardTitle className="text-sm">Kill Zone Regions ({data.killZoneRegions.length})</CardTitle>
						<Button size="sm" variant="outline" onClick={addRegion}>Add</Button>
					</div>
				</CardHeader>
				<CardContent>
					<div className="max-h-[30vh] overflow-auto border rounded">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead className="w-12">#</TableHead>
									<TableHead>Hull</TableHead>
									<TableHead>Section</TableHead>
									<TableHead>Start Rung</TableHead>
									<TableHead>End Rung</TableHead>
									<TableHead className="w-12" />
								</TableRow>
							</TableHeader>
							<TableBody>
								{data.killZoneRegions.map((r, i) => (
									<TableRow key={i}>
										<TableCell className="font-mono text-xs">{i}</TableCell>
										<TableCell><NumberCell value={r.muHull} onChange={(v) => updateRegion(i, { muHull: v })} /></TableCell>
										<TableCell><NumberCell value={r.muSection} onChange={(v) => updateRegion(i, { muSection: v })} /></TableCell>
										<TableCell><NumberCell value={r.muStartRung} onChange={(v) => updateRegion(i, { muStartRung: v })} /></TableCell>
										<TableCell><NumberCell value={r.muEndRung} onChange={(v) => updateRegion(i, { muEndRung: v })} /></TableCell>
										<TableCell>
											<Button size="sm" variant="ghost" className="h-6 px-2 text-xs text-destructive" onClick={() => removeRegion(i)}>X</Button>
										</TableCell>
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
