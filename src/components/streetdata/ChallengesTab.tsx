// Challenges table — editable list view over ParsedStreetData.challenges.
//
// Extracted from the old monolithic StreetDataEditor.tsx. Challenges are
// added/removed via the Roads tab because roads.length must equal
// challenges.length (the writer enforces this).

import React from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { ParsedStreetData, ChallengeParScores } from '@/lib/core/streetData';
import { NumberCell, BigIntCell } from './cells';

type Props = {
	data: ParsedStreetData;
	onChange: (next: ParsedStreetData) => void;
};

export const ChallengesTab: React.FC<Props> = ({ data, onChange }) => {
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

export default ChallengesTab;
