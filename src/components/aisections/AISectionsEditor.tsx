import React, { useMemo, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { ParsedAISections, AISection, SectionResetPair } from '@/lib/core/aiSections';
import { SectionSpeed, EResetSpeedType, SECTION_SPEED_COUNT } from '@/lib/core/aiSections';
import { SPEED_LABELS, FLAG_NAMES, RESET_SPEED_LABELS } from './constants';
import { SectionsList } from './SectionsList';
import { AddSectionDialog } from './AddSectionDialog';
import { SectionDetailDialog } from './SectionDetailDialog';

type Props = {
	data: ParsedAISections;
	onChange: (next: ParsedAISections) => void;
};

function NumberCell(props: { value: number; onChange: (v: number) => void; step?: number; int?: boolean; width?: string }) {
	const { value, onChange, step = 1, int = true, width = 'w-24' } = props;
	return (
		<Input
			type="number"
			step={step}
			className={`h-7 ${width}`}
			value={Number.isFinite(value) ? value : 0}
			onChange={(e) => {
				const next = int ? parseInt(e.target.value, 10) : parseFloat(e.target.value);
				onChange(Number.isFinite(next) ? next : 0);
			}}
		/>
	);
}

// ---- Overview ----

const OverviewTab: React.FC<Props> = ({ data, onChange }) => {
	const flagCounts = useMemo(() => {
		const counts: Record<string, number> = {};
		for (const { flag, label } of FLAG_NAMES) {
			counts[label] = data.sections.filter(s => s.flags & flag).length;
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
				<div><span className="text-muted-foreground">Version:</span> {data.version}</div>
				<div><span className="text-muted-foreground">Sections:</span> {data.sections.length}</div>
				<div><span className="text-muted-foreground">Reset Pairs:</span> {data.sectionResetPairs.length}</div>
				<div><span className="text-muted-foreground">Total Portals:</span> {data.sections.reduce((a, s) => a + s.portals.length, 0)}</div>
			</div>

			<Card>
				<CardHeader><CardTitle className="text-sm">Speed Limits</CardTitle></CardHeader>
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
											int={false}
											step={0.1}
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
											int={false}
											step={0.1}
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
				<CardHeader><CardTitle className="text-sm">Flag Distribution</CardTitle></CardHeader>
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

// ---- Reset Pairs Table ----

const ResetPairsTab: React.FC<Props> = ({ data, onChange }) => {
	const updatePair = (index: number, patch: Partial<SectionResetPair>) => {
		const next = data.sectionResetPairs.map((p, i) => (i === index ? { ...p, ...patch } : p));
		onChange({ ...data, sectionResetPairs: next });
	};

	const addPair = () => {
		const empty: SectionResetPair = {
			resetSpeed: EResetSpeedType.E_RESET_SPEED_TYPE_NONE,
			startSectionIndex: 0,
			resetSectionIndex: 0,
		};
		onChange({ ...data, sectionResetPairs: [...data.sectionResetPairs, empty] });
	};

	const removePair = (index: number) => {
		onChange({ ...data, sectionResetPairs: data.sectionResetPairs.filter((_, i) => i !== index) });
	};

	return (
		<div className="space-y-2">
			<div className="flex items-center justify-between">
				<span className="text-sm text-muted-foreground">{data.sectionResetPairs.length} pairs</span>
				<Button size="sm" variant="outline" onClick={addPair}>Add Pair</Button>
			</div>

			<div className="max-h-[60vh] overflow-auto border rounded">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead className="w-12">#</TableHead>
							<TableHead>Reset Speed</TableHead>
							<TableHead>Start Section</TableHead>
							<TableHead>Reset Section</TableHead>
							<TableHead className="w-12" />
						</TableRow>
					</TableHeader>
					<TableBody>
						{data.sectionResetPairs.map((pair, i) => (
							<TableRow key={i}>
								<TableCell className="text-xs">{i}</TableCell>
								<TableCell>
									<select
										className="h-7 border rounded px-1 text-xs bg-background"
										value={pair.resetSpeed}
										onChange={(e) => updatePair(i, { resetSpeed: parseInt(e.target.value, 10) as EResetSpeedType })}
									>
										{Object.entries(RESET_SPEED_LABELS).map(([v, label]) => (
											<option key={v} value={v}>{label}</option>
										))}
									</select>
								</TableCell>
								<TableCell>
									<NumberCell value={pair.startSectionIndex} onChange={(v) => updatePair(i, { startSectionIndex: v })} width="w-20" />
								</TableCell>
								<TableCell>
									<NumberCell value={pair.resetSectionIndex} onChange={(v) => updatePair(i, { resetSectionIndex: v })} width="w-20" />
								</TableCell>
								<TableCell>
									<Button size="sm" variant="ghost" className="h-6 px-2 text-xs text-destructive" onClick={() => removePair(i)}>
										X
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

// ---- Editor ----

export const AISectionsEditor: React.FC<Props> = ({ data, onChange }) => {
	const [addDialogOpen, setAddDialogOpen] = useState(false);
	const [detailIndex, setDetailIndex] = useState<number | null>(null);
	const scrollToIndexRef = useRef<((index: number) => void) | null>(null);

	const handleAddSection = (section: AISection) => {
		const newIndex = data.sections.length;
		onChange({ ...data, sections: [...data.sections, section] });
		// Scroll to new section after React re-renders
		requestAnimationFrame(() => {
			scrollToIndexRef.current?.(newIndex);
		});
	};

	const handleUpdateSection = (index: number, section: AISection) => {
		const next = data.sections.map((s, i) => (i === index ? section : s));
		onChange({ ...data, sections: next });
	};

	return (
		<>
			<Tabs defaultValue="overview">
				<TabsList>
					<TabsTrigger value="overview">Overview</TabsTrigger>
					<TabsTrigger value="sections">Sections ({data.sections.length})</TabsTrigger>
					<TabsTrigger value="resets">Reset Pairs ({data.sectionResetPairs.length})</TabsTrigger>
				</TabsList>
				<TabsContent value="overview">
					<OverviewTab data={data} onChange={onChange} />
				</TabsContent>
				<TabsContent value="sections">
					<SectionsList
						data={data}
						onChange={onChange}
						onAddClick={() => setAddDialogOpen(true)}
						onDetailClick={setDetailIndex}
						scrollToIndexRef={scrollToIndexRef}
					/>
				</TabsContent>
				<TabsContent value="resets">
					<ResetPairsTab data={data} onChange={onChange} />
				</TabsContent>
			</Tabs>

			<AddSectionDialog
				open={addDialogOpen}
				onOpenChange={setAddDialogOpen}
				onAdd={handleAddSection}
			/>

			{detailIndex !== null && data.sections[detailIndex] && (
				<SectionDetailDialog
					section={data.sections[detailIndex]}
					index={detailIndex}
					open={true}
					onOpenChange={(open) => { if (!open) setDetailIndex(null); }}
					onUpdate={handleUpdateSection}
				/>
			)}
		</>
	);
};
