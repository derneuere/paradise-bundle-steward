// Overview tab for the AI Sections resource — summary stats, per-speed
// min/max table, and a flag-distribution badge row.
//
// Extracted from the pre-migration `AISectionsEditor.tsx` so the schema
// editor's extension registry can reuse it as a root-level `propertyGroup`
// component without dragging in the rest of the legacy tab bar.

import React, { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { ParsedAISectionsV12 } from '@/lib/core/aiSections';
import { SECTION_SPEED_COUNT } from '@/lib/core/aiSections';
import { SPEED_LABELS, FLAG_NAMES } from './constants';

type Props = {
	data: ParsedAISectionsV12;
	onChange: (next: ParsedAISectionsV12) => void;
};

function NumberCell(props: { value: number; onChange: (v: number) => void }) {
	const { value, onChange } = props;
	return (
		<Input
			type="number"
			step={0.1}
			className="h-7 w-24"
			value={Number.isFinite(value) ? value : 0}
			onChange={(e) => {
				const next = parseFloat(e.target.value);
				onChange(Number.isFinite(next) ? next : 0);
			}}
		/>
	);
}

export const AISectionsOverview: React.FC<Props> = ({ data, onChange }) => {
	const flagCounts = useMemo(() => {
		const counts: Record<string, number> = {};
		for (const { flag, label } of FLAG_NAMES) {
			counts[label] = data.sections.filter((s) => s.flags & flag).length;
		}
		return counts;
	}, [data.sections]);

	const speedCounts = useMemo(() => {
		const counts = new Array(SECTION_SPEED_COUNT).fill(0);
		for (const s of data.sections) {
			if (s.speed < SECTION_SPEED_COUNT) counts[s.speed]++;
		}
		return counts;
	}, [data.sections]);

	return (
		<div className="space-y-4">
			<div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
				<div>
					<span className="text-muted-foreground">Version:</span> {data.version}
				</div>
				<div>
					<span className="text-muted-foreground">Sections:</span> {data.sections.length}
				</div>
				<div>
					<span className="text-muted-foreground">Reset Pairs:</span> {data.sectionResetPairs.length}
				</div>
				<div>
					<span className="text-muted-foreground">Total Portals:</span>{' '}
					{data.sections.reduce((a, s) => a + s.portals.length, 0)}
				</div>
			</div>

			<Card>
				<CardHeader>
					<CardTitle className="text-sm">Speed Limits</CardTitle>
				</CardHeader>
				<CardContent>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Speed</TableHead>
								<TableHead>Min (m/s)</TableHead>
								<TableHead>Max (m/s)</TableHead>
								<TableHead>Sections</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{Array.from({ length: SECTION_SPEED_COUNT }, (_, i) => (
								<TableRow key={i}>
									<TableCell>{SPEED_LABELS[i] ?? i}</TableCell>
									<TableCell>
										<NumberCell
											value={data.sectionMinSpeeds[i] ?? 0}
											onChange={(v) => {
												const speeds = data.sectionMinSpeeds.slice();
												speeds[i] = v;
												onChange({ ...data, sectionMinSpeeds: speeds });
											}}
										/>
									</TableCell>
									<TableCell>
										<NumberCell
											value={data.sectionMaxSpeeds[i] ?? 0}
											onChange={(v) => {
												const speeds = data.sectionMaxSpeeds.slice();
												speeds[i] = v;
												onChange({ ...data, sectionMaxSpeeds: speeds });
											}}
										/>
									</TableCell>
									<TableCell>{speedCounts[i]}</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle className="text-sm">Flag Distribution</CardTitle>
				</CardHeader>
				<CardContent>
					<div className="flex flex-wrap gap-2">
						{FLAG_NAMES.map(({ label }) => (
							<Badge key={label} variant="outline">
								{label}: {flagCounts[label]}
							</Badge>
						))}
					</div>
				</CardContent>
			</Card>
		</div>
	);
};

export default AISectionsOverview;
