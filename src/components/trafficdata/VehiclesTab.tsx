import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type {
	ParsedTrafficData,
	TrafficVehicleTypeData,
	TrafficVehicleTypeUpdateData,
	TrafficVehicleAsset,
	TrafficVehicleTraits,
} from '@/lib/core/trafficData';
import { VEHICLE_FLAG_NAMES } from './constants';

type Props = {
	data: ParsedTrafficData;
	onChange: (next: ParsedTrafficData) => void;
};

function NumCell({ value, onChange, float, step, width = 'w-20' }: {
	value: number; onChange: (v: number) => void; float?: boolean; step?: number; width?: string;
}) {
	return (
		<Input
			type="number"
			step={step ?? (float ? 0.01 : 1)}
			className={`h-7 ${width} text-xs`}
			value={float ? value.toFixed(3) : (Number.isFinite(value) ? value : 0)}
			onChange={(e) => {
				const v = float ? parseFloat(e.target.value) : parseInt(e.target.value, 10);
				if (Number.isFinite(v)) onChange(v);
			}}
		/>
	);
}

// ---------------------------------------------------------------------------
// Vehicle Types sub-tab (paired with VehicleTypesUpdate)
// ---------------------------------------------------------------------------

const VehicleTypesTable: React.FC<Props> = ({ data, onChange }) => {
	const updateType = (index: number, patch: Partial<TrafficVehicleTypeData>) => {
		const next = data.vehicleTypes.map((t, i) => (i === index ? { ...t, ...patch } : t));
		onChange({ ...data, vehicleTypes: next });
	};

	const updateUpdate = (index: number, patch: Partial<TrafficVehicleTypeUpdateData>) => {
		const next = data.vehicleTypesUpdate.map((t, i) => (i === index ? { ...t, ...patch } : t));
		onChange({ ...data, vehicleTypesUpdate: next });
	};

	const addVehicleType = () => {
		const emptyType: TrafficVehicleTypeData = {
			muTrailerFlowTypeId: 0, mxVehicleFlags: 0, muVehicleClass: 0,
			muInitialDirt: 0, muAssetId: 0, muTraitsId: 0, _pad07: 0,
		};
		const emptyUpdate: TrafficVehicleTypeUpdateData = {
			mfWheelRadius: 0.3, mfSuspensionRoll: 0, mfSuspensionPitch: 0,
			mfSuspensionTravel: 0.1, mfMass: 1500,
		};
		onChange({
			...data,
			vehicleTypes: [...data.vehicleTypes, emptyType],
			vehicleTypesUpdate: [...data.vehicleTypesUpdate, emptyUpdate],
		});
	};

	const removeVehicleType = (index: number) => {
		onChange({
			...data,
			vehicleTypes: data.vehicleTypes.filter((_, i) => i !== index),
			vehicleTypesUpdate: data.vehicleTypesUpdate.filter((_, i) => i !== index),
		});
	};

	return (
		<div className="space-y-2">
			<div className="flex items-center justify-between">
				<span className="text-sm text-muted-foreground">{data.vehicleTypes.length} types</span>
				<Button size="sm" variant="outline" onClick={addVehicleType}>Add Type</Button>
			</div>
			<div className="max-h-[55vh] overflow-auto border rounded">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead className="w-8">#</TableHead>
							<TableHead>Class</TableHead>
							<TableHead>Asset</TableHead>
							<TableHead>Traits</TableHead>
							<TableHead>Flags</TableHead>
							<TableHead>Trailer Flow</TableHead>
							<TableHead>Dirt</TableHead>
							<TableHead>Wheel R</TableHead>
							<TableHead>Mass</TableHead>
							<TableHead>Susp Travel</TableHead>
							<TableHead className="w-8" />
						</TableRow>
					</TableHeader>
					<TableBody>
						{data.vehicleTypes.map((vt, i) => {
							const upd = data.vehicleTypesUpdate[i];
							return (
								<TableRow key={i}>
									<TableCell className="font-mono text-xs">{i}</TableCell>
									<TableCell><NumCell value={vt.muVehicleClass} onChange={(v) => updateType(i, { muVehicleClass: v })} width="w-16" /></TableCell>
									<TableCell><NumCell value={vt.muAssetId} onChange={(v) => updateType(i, { muAssetId: v })} width="w-16" /></TableCell>
									<TableCell><NumCell value={vt.muTraitsId} onChange={(v) => updateType(i, { muTraitsId: v })} width="w-16" /></TableCell>
									<TableCell>
										<div className="flex gap-0.5 flex-wrap">
											{VEHICLE_FLAG_NAMES.map(({ flag, label }) => (
												<Badge
													key={flag}
													variant={vt.mxVehicleFlags & flag ? 'default' : 'outline'}
													className="cursor-pointer text-[10px] px-1"
													onClick={() => updateType(i, { mxVehicleFlags: vt.mxVehicleFlags ^ flag })}
												>
													{label}
												</Badge>
											))}
										</div>
									</TableCell>
									<TableCell><NumCell value={vt.muTrailerFlowTypeId} onChange={(v) => updateType(i, { muTrailerFlowTypeId: v })} width="w-16" /></TableCell>
									<TableCell><NumCell value={vt.muInitialDirt} onChange={(v) => updateType(i, { muInitialDirt: v })} width="w-16" /></TableCell>
									<TableCell>{upd && <NumCell value={upd.mfWheelRadius} onChange={(v) => updateUpdate(i, { mfWheelRadius: v })} float width="w-20" />}</TableCell>
									<TableCell>{upd && <NumCell value={upd.mfMass} onChange={(v) => updateUpdate(i, { mfMass: v })} float width="w-20" />}</TableCell>
									<TableCell>{upd && <NumCell value={upd.mfSuspensionTravel} onChange={(v) => updateUpdate(i, { mfSuspensionTravel: v })} float width="w-20" />}</TableCell>
									<TableCell>
										<Button size="sm" variant="ghost" className="h-6 px-2 text-xs text-destructive" onClick={() => removeVehicleType(i)}>X</Button>
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

// ---------------------------------------------------------------------------
// Vehicle Assets sub-tab
// ---------------------------------------------------------------------------

const VehicleAssetsTable: React.FC<Props> = ({ data, onChange }) => {
	const addAsset = () => {
		onChange({ ...data, vehicleAssets: [...data.vehicleAssets, { mVehicleId: 0n }] });
	};

	const removeAsset = (index: number) => {
		onChange({ ...data, vehicleAssets: data.vehicleAssets.filter((_, i) => i !== index) });
	};

	return (
		<div className="space-y-2">
			<div className="flex items-center justify-between">
				<span className="text-sm text-muted-foreground">{data.vehicleAssets.length} assets</span>
				<Button size="sm" variant="outline" onClick={addAsset}>Add Asset</Button>
			</div>
			<div className="max-h-[55vh] overflow-auto border rounded">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead className="w-12">#</TableHead>
							<TableHead>Vehicle ID (hex)</TableHead>
							<TableHead className="w-12" />
						</TableRow>
					</TableHeader>
					<TableBody>
						{data.vehicleAssets.map((a, i) => (
							<TableRow key={i}>
								<TableCell className="font-mono text-xs">{i}</TableCell>
								<TableCell>
									<Input
										className="h-7 w-48 font-mono text-xs"
										value={`0x${a.mVehicleId.toString(16).toUpperCase()}`}
										onChange={(e) => {
											const raw = e.target.value.replace(/^0x/i, '');
											try {
												const v = BigInt(`0x${raw || '0'}`);
												const next = data.vehicleAssets.map((x, j) => (j === i ? { mVehicleId: v } : x));
												onChange({ ...data, vehicleAssets: next });
											} catch { /* ignore invalid */ }
										}}
									/>
								</TableCell>
								<TableCell>
									<Button size="sm" variant="ghost" className="h-6 px-2 text-xs text-destructive" onClick={() => removeAsset(i)}>X</Button>
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</div>
		</div>
	);
};

// ---------------------------------------------------------------------------
// Vehicle Traits sub-tab
// ---------------------------------------------------------------------------

const VehicleTraitsTable: React.FC<Props> = ({ data, onChange }) => {
	const updateTrait = (index: number, patch: Partial<TrafficVehicleTraits>) => {
		const next = data.vehicleTraits.map((t, i) => (i === index ? { ...t, ...patch } : t));
		onChange({ ...data, vehicleTraits: next });
	};

	const addTrait = () => {
		const empty: TrafficVehicleTraits = {
			mfSwervingAmountModifier: 1, mfAcceleration: 1, muCuttingUpChance: 0,
			muTailgatingChance: 0, muPatience: 128, muTantrumAttackCumProb: 0,
			muTantrumStopCumProb: 0, _pad0D: [0, 0, 0],
		};
		onChange({ ...data, vehicleTraits: [...data.vehicleTraits, empty] });
	};

	const removeTrait = (index: number) => {
		onChange({ ...data, vehicleTraits: data.vehicleTraits.filter((_, i) => i !== index) });
	};

	return (
		<div className="space-y-2">
			<div className="flex items-center justify-between">
				<span className="text-sm text-muted-foreground">{data.vehicleTraits.length} traits</span>
				<Button size="sm" variant="outline" onClick={addTrait}>Add Trait</Button>
			</div>
			<div className="max-h-[55vh] overflow-auto border rounded">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead className="w-8">#</TableHead>
							<TableHead>Accel</TableHead>
							<TableHead>Swerve</TableHead>
							<TableHead>Cut Up</TableHead>
							<TableHead>Tailgate</TableHead>
							<TableHead>Patience</TableHead>
							<TableHead>Attack</TableHead>
							<TableHead>Stop</TableHead>
							<TableHead className="w-8" />
						</TableRow>
					</TableHeader>
					<TableBody>
						{data.vehicleTraits.map((t, i) => (
							<TableRow key={i}>
								<TableCell className="font-mono text-xs">{i}</TableCell>
								<TableCell><NumCell value={t.mfAcceleration} onChange={(v) => updateTrait(i, { mfAcceleration: v })} float width="w-20" /></TableCell>
								<TableCell><NumCell value={t.mfSwervingAmountModifier} onChange={(v) => updateTrait(i, { mfSwervingAmountModifier: v })} float width="w-20" /></TableCell>
								<TableCell><NumCell value={t.muCuttingUpChance} onChange={(v) => updateTrait(i, { muCuttingUpChance: v })} width="w-16" /></TableCell>
								<TableCell><NumCell value={t.muTailgatingChance} onChange={(v) => updateTrait(i, { muTailgatingChance: v })} width="w-16" /></TableCell>
								<TableCell><NumCell value={t.muPatience} onChange={(v) => updateTrait(i, { muPatience: v })} width="w-16" /></TableCell>
								<TableCell><NumCell value={t.muTantrumAttackCumProb} onChange={(v) => updateTrait(i, { muTantrumAttackCumProb: v })} width="w-16" /></TableCell>
								<TableCell><NumCell value={t.muTantrumStopCumProb} onChange={(v) => updateTrait(i, { muTantrumStopCumProb: v })} width="w-16" /></TableCell>
								<TableCell>
									<Button size="sm" variant="ghost" className="h-6 px-2 text-xs text-destructive" onClick={() => removeTrait(i)}>X</Button>
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</div>
		</div>
	);
};

// ---------------------------------------------------------------------------
// Main Vehicles Tab
// ---------------------------------------------------------------------------

export const VehiclesTab: React.FC<Props> = ({ data, onChange }) => {
	const [sub, setSub] = useState('types');
	return (
		<Tabs value={sub} onValueChange={setSub}>
			<TabsList>
				<TabsTrigger value="types">Types ({data.vehicleTypes.length})</TabsTrigger>
				<TabsTrigger value="assets">Assets ({data.vehicleAssets.length})</TabsTrigger>
				<TabsTrigger value="traits">Traits ({data.vehicleTraits.length})</TabsTrigger>
			</TabsList>
			<TabsContent value="types"><VehicleTypesTable data={data} onChange={onChange} /></TabsContent>
			<TabsContent value="assets"><VehicleAssetsTable data={data} onChange={onChange} /></TabsContent>
			<TabsContent value="traits"><VehicleTraitsTable data={data} onChange={onChange} /></TabsContent>
		</Tabs>
	);
};
