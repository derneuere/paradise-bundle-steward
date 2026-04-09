import React, { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type {
	ParsedStreetData,
	Street,
	Junction,
	Road,
	ChallengeParScores,
} from '@/lib/core/streetData';

// Simple editable table components. Each row maps directly onto its model
// entry, and onChange produces a new array, matching the pattern used by the
// ChallengeList and TriggerData editors.

type Props = {
	data: ParsedStreetData;
	onChange: (next: ParsedStreetData) => void;
};

const HEX = (v: number) => `0x${(v >>> 0).toString(16).toUpperCase().padStart(4, '0')}`;

function NumberCell(props: {
	value: number;
	onChange: (v: number) => void;
	step?: number;
	int?: boolean;
	width?: string;
}) {
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

function BigIntCell(props: { value: bigint; onChange: (v: bigint) => void }) {
	const { value, onChange } = props;
	return (
		<Input
			className="h-7 w-44 font-mono"
			value={value.toString()}
			onChange={(e) => {
				const raw = e.target.value.trim();
				try {
					onChange(raw === '' || raw === '-' ? 0n : BigInt(raw));
				} catch {
					// ignore parse errors, keep previous value
				}
			}}
		/>
	);
}

function StringCell(props: { value: string; onChange: (v: string) => void; maxLength: number; width?: string }) {
	const { value, onChange, maxLength, width = 'w-40' } = props;
	return (
		<Input
			className={`h-7 ${width}`}
			maxLength={maxLength}
			value={value.replace(/\0+$/, '')}
			onChange={(e) => onChange(e.target.value)}
		/>
	);
}

// -------------------------------------------------------------------------
// Streets
// -------------------------------------------------------------------------

const StreetsTab: React.FC<Props> = ({ data, onChange }) => {
	const update = (index: number, patch: Partial<Street>) => {
		const next = data.streets.map((s, i) => (i === index ? { ...s, ...patch } : s));
		onChange({ ...data, streets: next });
	};
	const addRow = () => {
		const empty: Street = {
			superSpanBase: { miRoadIndex: 0, miSpanIndex: 0, padding: [0, 0], meSpanType: 0 },
			mAiInfo: { muMaxSpeedMPS: 0, muMinSpeedMPS: 0 },
			padding: [0, 0],
		};
		onChange({ ...data, streets: [...data.streets, empty] });
	};
	const removeRow = (index: number) => {
		onChange({ ...data, streets: data.streets.filter((_, i) => i !== index) });
	};
	return (
		<div className="space-y-2">
			<div className="flex items-center justify-between">
				<div className="text-sm text-muted-foreground">{data.streets.length} streets</div>
				<Button size="sm" onClick={addRow}>Add Street</Button>
			</div>
			<div className="max-h-[60vh] overflow-auto border rounded">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>#</TableHead>
							<TableHead>Road Index</TableHead>
							<TableHead>Span Index</TableHead>
							<TableHead>Span Type</TableHead>
							<TableHead>Max Speed (m/s)</TableHead>
							<TableHead>Min Speed (m/s)</TableHead>
							<TableHead></TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{data.streets.map((s, i) => (
							<TableRow key={i}>
								<TableCell className="text-xs text-muted-foreground">{i}</TableCell>
								<TableCell>
									<NumberCell
										value={s.superSpanBase.miRoadIndex}
										onChange={(v) =>
											update(i, { superSpanBase: { ...s.superSpanBase, miRoadIndex: v } })
										}
									/>
								</TableCell>
								<TableCell>
									<NumberCell
										value={s.superSpanBase.miSpanIndex}
										onChange={(v) =>
											update(i, { superSpanBase: { ...s.superSpanBase, miSpanIndex: v } })
										}
									/>
								</TableCell>
								<TableCell>
									<NumberCell
										value={s.superSpanBase.meSpanType}
										onChange={(v) =>
											update(i, { superSpanBase: { ...s.superSpanBase, meSpanType: v } })
										}
									/>
								</TableCell>
								<TableCell>
									<NumberCell
										value={s.mAiInfo.muMaxSpeedMPS}
										onChange={(v) => update(i, { mAiInfo: { ...s.mAiInfo, muMaxSpeedMPS: v } })}
									/>
								</TableCell>
								<TableCell>
									<NumberCell
										value={s.mAiInfo.muMinSpeedMPS}
										onChange={(v) => update(i, { mAiInfo: { ...s.mAiInfo, muMinSpeedMPS: v } })}
									/>
								</TableCell>
								<TableCell>
									<Button size="sm" variant="ghost" onClick={() => removeRow(i)}>
										Remove
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

// -------------------------------------------------------------------------
// Junctions
// -------------------------------------------------------------------------

const JunctionsTab: React.FC<Props> = ({ data, onChange }) => {
	const update = (index: number, patch: Partial<Junction>) => {
		const next = data.junctions.map((j, i) => (i === index ? { ...j, ...patch } : j));
		onChange({ ...data, junctions: next });
	};
	const addRow = () => {
		const empty: Junction = {
			superSpanBase: { miRoadIndex: 0, miSpanIndex: 0, padding: [0, 0], meSpanType: 1 },
			mpaExits: 0,
			miExitCount: 0,
			macName: '',
		};
		onChange({ ...data, junctions: [...data.junctions, empty] });
	};
	const removeRow = (index: number) => {
		onChange({ ...data, junctions: data.junctions.filter((_, i) => i !== index) });
	};
	return (
		<div className="space-y-2">
			<div className="flex items-center justify-between">
				<div className="text-sm text-muted-foreground">{data.junctions.length} junctions</div>
				<Button size="sm" onClick={addRow}>Add Junction</Button>
			</div>
			<div className="max-h-[60vh] overflow-auto border rounded">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>#</TableHead>
							<TableHead>Road Index</TableHead>
							<TableHead>Span Index</TableHead>
							<TableHead>Span Type</TableHead>
							<TableHead>Name</TableHead>
							<TableHead></TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{data.junctions.map((j, i) => (
							<TableRow key={i}>
								<TableCell className="text-xs text-muted-foreground">{i}</TableCell>
								<TableCell>
									<NumberCell
										value={j.superSpanBase.miRoadIndex}
										onChange={(v) =>
											update(i, { superSpanBase: { ...j.superSpanBase, miRoadIndex: v } })
										}
									/>
								</TableCell>
								<TableCell>
									<NumberCell
										value={j.superSpanBase.miSpanIndex}
										onChange={(v) =>
											update(i, { superSpanBase: { ...j.superSpanBase, miSpanIndex: v } })
										}
									/>
								</TableCell>
								<TableCell>
									<NumberCell
										value={j.superSpanBase.meSpanType}
										onChange={(v) =>
											update(i, { superSpanBase: { ...j.superSpanBase, meSpanType: v } })
										}
									/>
								</TableCell>
								<TableCell>
									<StringCell
										value={j.macName}
										maxLength={16}
										onChange={(v) => update(i, { macName: v })}
									/>
								</TableCell>
								<TableCell>
									<Button size="sm" variant="ghost" onClick={() => removeRow(i)}>
										Remove
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

// -------------------------------------------------------------------------
// Roads
// -------------------------------------------------------------------------

const RoadsTab: React.FC<Props> = ({ data, onChange }) => {
	// Updating a road must also keep challenges.length == roads.length, so
	// add/remove applies to both collections.
	const update = (index: number, patch: Partial<Road>) => {
		const next = data.roads.map((r, i) => (i === index ? { ...r, ...patch } : r));
		onChange({ ...data, roads: next });
	};
	const addRow = () => {
		const emptyRoad: Road = {
			mReferencePosition: { x: 0, y: 0, z: 0 },
			mpaSpans: 0,
			mId: 0n,
			miRoadLimitId0: 0n,
			miRoadLimitId1: 0n,
			macDebugName: '',
			mChallenge: 0,
			miSpanCount: 0,
			unknown: 1,
			padding: [0, 0, 0, 0],
		};
		const emptyChallenge: ChallengeParScores = {
			challengeData: {
				mDirty: [0, 0, 0, 0, 0, 0, 0, 0],
				mValidScore: [0, 0, 0, 0, 0, 0, 0, 0],
				mScoreList: { maScores: [0, 0] },
			},
			mRivals: [0n, 0n],
		};
		onChange({
			...data,
			roads: [...data.roads, emptyRoad],
			challenges: [...data.challenges, emptyChallenge],
		});
	};
	const removeRow = (index: number) => {
		onChange({
			...data,
			roads: data.roads.filter((_, i) => i !== index),
			challenges: data.challenges.filter((_, i) => i !== index),
		});
	};
	return (
		<div className="space-y-2">
			<div className="flex items-center justify-between">
				<div className="text-sm text-muted-foreground">
					{data.roads.length} roads (paired with {data.challenges.length} challenges)
				</div>
				<Button size="sm" onClick={addRow}>Add Road</Button>
			</div>
			<div className="max-h-[60vh] overflow-auto border rounded">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>#</TableHead>
							<TableHead>Debug Name</TableHead>
							<TableHead>Ref X</TableHead>
							<TableHead>Ref Y</TableHead>
							<TableHead>Ref Z</TableHead>
							<TableHead>Challenge</TableHead>
							<TableHead>Id</TableHead>
							<TableHead>Limit 0</TableHead>
							<TableHead>Limit 1</TableHead>
							<TableHead></TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{data.roads.map((r, i) => (
							<TableRow key={i}>
								<TableCell className="text-xs text-muted-foreground">{i}</TableCell>
								<TableCell>
									<StringCell
										value={r.macDebugName}
										maxLength={16}
										onChange={(v) => update(i, { macDebugName: v })}
									/>
								</TableCell>
								<TableCell>
									<NumberCell
										int={false}
										step={0.01}
										value={r.mReferencePosition.x}
										onChange={(v) =>
											update(i, { mReferencePosition: { ...r.mReferencePosition, x: v } })
										}
									/>
								</TableCell>
								<TableCell>
									<NumberCell
										int={false}
										step={0.01}
										value={r.mReferencePosition.y}
										onChange={(v) =>
											update(i, { mReferencePosition: { ...r.mReferencePosition, y: v } })
										}
									/>
								</TableCell>
								<TableCell>
									<NumberCell
										int={false}
										step={0.01}
										value={r.mReferencePosition.z}
										onChange={(v) =>
											update(i, { mReferencePosition: { ...r.mReferencePosition, z: v } })
										}
									/>
								</TableCell>
								<TableCell>
									<NumberCell
										value={r.mChallenge}
										onChange={(v) => update(i, { mChallenge: v })}
									/>
								</TableCell>
								<TableCell>
									<BigIntCell value={r.mId} onChange={(v) => update(i, { mId: v })} />
								</TableCell>
								<TableCell>
									<BigIntCell
										value={r.miRoadLimitId0}
										onChange={(v) => update(i, { miRoadLimitId0: v })}
									/>
								</TableCell>
								<TableCell>
									<BigIntCell
										value={r.miRoadLimitId1}
										onChange={(v) => update(i, { miRoadLimitId1: v })}
									/>
								</TableCell>
								<TableCell>
									<Button size="sm" variant="ghost" onClick={() => removeRow(i)}>
										Remove
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

// -------------------------------------------------------------------------
// Challenges (ChallengeParScores array, indexed against roads)
// -------------------------------------------------------------------------

const ChallengesTab: React.FC<Props> = ({ data, onChange }) => {
	const update = (index: number, patch: Partial<ChallengeParScores>) => {
		const next = data.challenges.map((c, i) => (i === index ? { ...c, ...patch } : c));
		onChange({ ...data, challenges: next });
	};
	return (
		<div className="space-y-2">
			<div className="text-sm text-muted-foreground">
				{data.challenges.length} challenge par scores (one per road; add/remove from the Roads tab)
			</div>
			<div className="max-h-[60vh] overflow-auto border rounded">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Road #</TableHead>
							<TableHead>Debug Name</TableHead>
							<TableHead>Score 0</TableHead>
							<TableHead>Score 1</TableHead>
							<TableHead>Rival 0</TableHead>
							<TableHead>Rival 1</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{data.challenges.map((c, i) => (
							<TableRow key={i}>
								<TableCell className="text-xs text-muted-foreground">{i}</TableCell>
								<TableCell className="text-xs font-mono">
									{data.roads[i]?.macDebugName?.replace(/\0+$/, '') ?? ''}
								</TableCell>
								<TableCell>
									<NumberCell
										value={c.challengeData.mScoreList.maScores[0] ?? 0}
										onChange={(v) =>
											update(i, {
												challengeData: {
													...c.challengeData,
													mScoreList: { maScores: [v, c.challengeData.mScoreList.maScores[1] ?? 0] },
												},
											})
										}
									/>
								</TableCell>
								<TableCell>
									<NumberCell
										value={c.challengeData.mScoreList.maScores[1] ?? 0}
										onChange={(v) =>
											update(i, {
												challengeData: {
													...c.challengeData,
													mScoreList: { maScores: [c.challengeData.mScoreList.maScores[0] ?? 0, v] },
												},
											})
										}
									/>
								</TableCell>
								<TableCell>
									<BigIntCell
										value={c.mRivals[0] ?? 0n}
										onChange={(v) => update(i, { mRivals: [v, c.mRivals[1] ?? 0n] })}
									/>
								</TableCell>
								<TableCell>
									<BigIntCell
										value={c.mRivals[1] ?? 0n}
										onChange={(v) => update(i, { mRivals: [c.mRivals[0] ?? 0n, v] })}
									/>
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</div>
		</div>
	);
};

// -------------------------------------------------------------------------
// Top-level editor
// -------------------------------------------------------------------------

export const StreetDataEditor: React.FC<Props> = ({ data, onChange }) => {
	const [tab, setTab] = useState<'streets' | 'junctions' | 'roads' | 'challenges'>('streets');

	const summary = useMemo(
		() => ({
			version: data.miVersion,
			streets: data.streets.length,
			junctions: data.junctions.length,
			roads: data.roads.length,
			challenges: data.challenges.length,
		}),
		[data],
	);

	return (
		<div className="space-y-4">
			<Card>
				<CardHeader>
					<CardTitle>Street Data Overview</CardTitle>
				</CardHeader>
				<CardContent className="grid grid-cols-2 sm:grid-cols-5 gap-4 text-sm">
					<div>Version: <b>{summary.version}</b></div>
					<div>Streets: <b>{summary.streets}</b></div>
					<div>Junctions: <b>{summary.junctions}</b></div>
					<div>Roads: <b>{summary.roads}</b></div>
					<div>Challenges: <b>{summary.challenges}</b></div>
				</CardContent>
			</Card>

			<Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="w-full">
				<TabsList className="grid grid-cols-4 w-full gap-1">
					<TabsTrigger value="streets">Streets ({summary.streets})</TabsTrigger>
					<TabsTrigger value="junctions">Junctions ({summary.junctions})</TabsTrigger>
					<TabsTrigger value="roads">Roads ({summary.roads})</TabsTrigger>
					<TabsTrigger value="challenges">Challenges ({summary.challenges})</TabsTrigger>
				</TabsList>

				<TabsContent value="streets">
					<Card>
						<CardHeader>
							<CardTitle>Streets</CardTitle>
						</CardHeader>
						<CardContent>
							<StreetsTab data={data} onChange={onChange} />
						</CardContent>
					</Card>
				</TabsContent>

				<TabsContent value="junctions">
					<Card>
						<CardHeader>
							<CardTitle>Junctions</CardTitle>
						</CardHeader>
						<CardContent>
							<JunctionsTab data={data} onChange={onChange} />
						</CardContent>
					</Card>
				</TabsContent>

				<TabsContent value="roads">
					<Card>
						<CardHeader>
							<CardTitle>Roads</CardTitle>
						</CardHeader>
						<CardContent>
							<RoadsTab data={data} onChange={onChange} />
						</CardContent>
					</Card>
				</TabsContent>

				<TabsContent value="challenges">
					<Card>
						<CardHeader>
							<CardTitle>Challenge Par Scores</CardTitle>
						</CardHeader>
						<CardContent>
							<ChallengesTab data={data} onChange={onChange} />
						</CardContent>
					</Card>
				</TabsContent>
			</Tabs>
		</div>
	);
};

export default StreetDataEditor;
// Keep HEX referenced so eslint doesn't flag it (useful for future header-offset panel)
void HEX;
