// Roads table — editable list view over ParsedStreetData.roads.
//
// Extracted from the old monolithic StreetDataEditor.tsx. Add/remove must
// keep challenges.length == roads.length (the writer enforces this), so
// add/remove applies to both collections.

import React from 'react';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { ParsedStreetData, Road, ChallengeParScores } from '@/lib/core/streetData';
import { NumberCell, BigIntCell, StringCell } from './cells';

type Props = {
	data: ParsedStreetData;
	onChange: (next: ParsedStreetData) => void;
};

export const RoadsTab: React.FC<Props> = ({ data, onChange }) => {
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
							<TableHead>Ref Y (up)</TableHead>
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
										value={r.mReferencePosition.z}
										onChange={(v) =>
											update(i, { mReferencePosition: { ...r.mReferencePosition, z: v } })
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

export default RoadsTab;
