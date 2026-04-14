import React, { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { ParsedTrafficData, TrafficLightCollection, Vec4 } from '@/lib/core/trafficData';

type Props = {
	data: ParsedTrafficData;
	onChange: (next: ParsedTrafficData) => void;
};

function updateTL(data: ParsedTrafficData, patch: Partial<TrafficLightCollection>): ParsedTrafficData {
	return { ...data, trafficLights: { ...data.trafficLights, ...patch } };
}

function NumCell({ value, onChange, float, width = 'w-20' }: {
	value: number; onChange: (v: number) => void; float?: boolean; width?: string;
}) {
	return (
		<Input
			type="number"
			step={float ? 0.1 : 1}
			className={`h-7 ${width} text-xs`}
			value={float ? value.toFixed(2) : value}
			onChange={(e) => {
				const v = float ? parseFloat(e.target.value) : parseInt(e.target.value, 10);
				if (Number.isFinite(v)) onChange(v);
			}}
		/>
	);
}

// ---------------------------------------------------------------------------
// Instances sub-tab
// ---------------------------------------------------------------------------

const InstancesTable: React.FC<Props> = ({ data, onChange }) => {
	const tl = data.trafficLights;
	const count = tl.posAndYRotations.length;

	const updatePos = (index: number, patch: Partial<Vec4>) => {
		const next = tl.posAndYRotations.map((p, i) => (i === index ? { ...p, ...patch } : p));
		onChange(updateTL(data, { posAndYRotations: next }));
	};

	return (
		<div className="max-h-[55vh] overflow-auto border rounded">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead className="w-8">#</TableHead>
						<TableHead>X</TableHead>
						<TableHead>Y</TableHead>
						<TableHead>Z</TableHead>
						<TableHead>Y Rot</TableHead>
						<TableHead>Instance ID</TableHead>
						<TableHead>Instance Type</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{Array.from({ length: count }, (_, i) => (
						<TableRow key={i}>
							<TableCell className="font-mono text-xs">{i}</TableCell>
							<TableCell><NumCell value={tl.posAndYRotations[i].x} onChange={(v) => updatePos(i, { x: v })} float /></TableCell>
							<TableCell><NumCell value={tl.posAndYRotations[i].y} onChange={(v) => updatePos(i, { y: v })} float /></TableCell>
							<TableCell><NumCell value={tl.posAndYRotations[i].z} onChange={(v) => updatePos(i, { z: v })} float /></TableCell>
							<TableCell><NumCell value={tl.posAndYRotations[i].w} onChange={(v) => updatePos(i, { w: v })} float /></TableCell>
							<TableCell className="font-mono text-xs">{tl.instanceIDs[i] ?? '—'}</TableCell>
							<TableCell className="font-mono text-xs">{tl.instanceTypes[i] ?? '—'}</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</div>
	);
};

// ---------------------------------------------------------------------------
// Light Types sub-tab
// ---------------------------------------------------------------------------

const LightTypesTable: React.FC<Props> = ({ data, onChange }) => {
	const tl = data.trafficLights;

	return (
		<div className="max-h-[55vh] overflow-auto border rounded">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead className="w-8">#</TableHead>
						<TableHead>Corona Offset</TableHead>
						<TableHead>Num Coronas</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{tl.trafficLightTypes.map((lt, i) => (
						<TableRow key={i}>
							<TableCell className="font-mono text-xs">{i}</TableCell>
							<TableCell className="font-mono text-xs">{lt.muCoronaOffset}</TableCell>
							<TableCell className="font-mono text-xs">{lt.muNumCoronas}</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</div>
	);
};

// ---------------------------------------------------------------------------
// Coronas sub-tab
// ---------------------------------------------------------------------------

const CoronasTable: React.FC<Props> = ({ data, onChange }) => {
	const tl = data.trafficLights;
	const count = tl.coronaPositions.length;

	return (
		<div className="max-h-[55vh] overflow-auto border rounded">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead className="w-8">#</TableHead>
						<TableHead>Type</TableHead>
						<TableHead>X</TableHead>
						<TableHead>Y</TableHead>
						<TableHead>Z</TableHead>
						<TableHead>W</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{Array.from({ length: count }, (_, i) => (
						<TableRow key={i}>
							<TableCell className="font-mono text-xs">{i}</TableCell>
							<TableCell className="font-mono text-xs">{tl.coronaTypes[i] ?? '—'}</TableCell>
							<TableCell className="font-mono text-xs">{tl.coronaPositions[i].x.toFixed(2)}</TableCell>
							<TableCell className="font-mono text-xs">{tl.coronaPositions[i].y.toFixed(2)}</TableCell>
							<TableCell className="font-mono text-xs">{tl.coronaPositions[i].z.toFixed(2)}</TableCell>
							<TableCell className="font-mono text-xs">{tl.coronaPositions[i].w.toFixed(2)}</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</div>
	);
};

// ---------------------------------------------------------------------------
// Hash Table sub-tab (read-only)
// ---------------------------------------------------------------------------

const HashTableView: React.FC<Props> = ({ data }) => {
	const tl = data.trafficLights;

	return (
		<div className="space-y-2 text-sm">
			<Card>
				<CardHeader><CardTitle className="text-sm">Hash Offsets ({tl.mauInstanceHashOffsets.length})</CardTitle></CardHeader>
				<CardContent>
					<div className="font-mono text-xs max-h-32 overflow-auto border rounded p-2 bg-muted/20">
						{tl.mauInstanceHashOffsets.join(', ')}
					</div>
				</CardContent>
			</Card>
			<Card>
				<CardHeader><CardTitle className="text-sm">Hash Table ({tl.instanceHashTable.length})</CardTitle></CardHeader>
				<CardContent>
					<div className="font-mono text-xs max-h-32 overflow-auto border rounded p-2 bg-muted/20">
						{tl.instanceHashTable.join(', ')}
					</div>
				</CardContent>
			</Card>
			<Card>
				<CardHeader><CardTitle className="text-sm">Hash → Index Lookup ({tl.instanceHashToIndexLookup.length})</CardTitle></CardHeader>
				<CardContent>
					<div className="font-mono text-xs max-h-32 overflow-auto border rounded p-2 bg-muted/20">
						{tl.instanceHashToIndexLookup.join(', ')}
					</div>
				</CardContent>
			</Card>
		</div>
	);
};

// ---------------------------------------------------------------------------
// Main Traffic Lights Tab
// ---------------------------------------------------------------------------

export const TrafficLightsTab: React.FC<Props> = ({ data, onChange }) => {
	const [sub, setSub] = useState('instances');
	const tl = data.trafficLights;

	return (
		<div className="space-y-2">
			<div className="text-sm text-muted-foreground">
				{tl.posAndYRotations.length} lights | {tl.trafficLightTypes.length} types | {tl.coronaPositions.length} coronas
			</div>

			<Tabs value={sub} onValueChange={setSub}>
				<TabsList>
					<TabsTrigger value="instances">Instances ({tl.posAndYRotations.length})</TabsTrigger>
					<TabsTrigger value="types">Light Types ({tl.trafficLightTypes.length})</TabsTrigger>
					<TabsTrigger value="coronas">Coronas ({tl.coronaPositions.length})</TabsTrigger>
					<TabsTrigger value="hash">Hash Table</TabsTrigger>
				</TabsList>
				<TabsContent value="instances"><InstancesTable data={data} onChange={onChange} /></TabsContent>
				<TabsContent value="types"><LightTypesTable data={data} onChange={onChange} /></TabsContent>
				<TabsContent value="coronas"><CoronasTable data={data} onChange={onChange} /></TabsContent>
				<TabsContent value="hash"><HashTableView data={data} onChange={onChange} /></TabsContent>
			</Tabs>
		</div>
	);
};
