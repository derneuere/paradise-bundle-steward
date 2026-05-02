// Reset-pairs editor — add, edit, and remove SectionResetPair rows.
//
// Extracted from `AISectionsEditor.tsx` so the schema editor can register it
// as a customRenderer on the root `sectionResetPairs` list field. The old
// tab-bar editor held it inline; this standalone copy is identical in UI.

import React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { ParsedAISectionsV12, SectionResetPair } from '@/lib/core/aiSections';
import { EResetSpeedType } from '@/lib/core/aiSections';
import { RESET_SPEED_LABELS } from './constants';

type Props = {
	data: ParsedAISectionsV12;
	onChange: (next: ParsedAISectionsV12) => void;
};

function NumberCell(props: { value: number; onChange: (v: number) => void; width?: string }) {
	const { value, onChange, width = 'w-20' } = props;
	return (
		<Input
			type="number"
			className={`h-7 ${width}`}
			value={Number.isFinite(value) ? value : 0}
			onChange={(e) => {
				const next = parseInt(e.target.value, 10);
				onChange(Number.isFinite(next) ? next : 0);
			}}
		/>
	);
}

export const ResetPairsTable: React.FC<Props> = ({ data, onChange }) => {
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
		onChange({
			...data,
			sectionResetPairs: data.sectionResetPairs.filter((_, i) => i !== index),
		});
	};

	return (
		<div className="space-y-2">
			<div className="flex items-center justify-between">
				<span className="text-sm text-muted-foreground">
					{data.sectionResetPairs.length} pairs
				</span>
				<Button size="sm" variant="outline" onClick={addPair}>
					Add Pair
				</Button>
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
										onChange={(e) =>
											updatePair(i, {
												resetSpeed: parseInt(e.target.value, 10) as EResetSpeedType,
											})
										}
									>
										{Object.entries(RESET_SPEED_LABELS).map(([v, label]) => (
											<option key={v} value={v}>
												{label}
											</option>
										))}
									</select>
								</TableCell>
								<TableCell>
									<NumberCell
										value={pair.startSectionIndex}
										onChange={(v) => updatePair(i, { startSectionIndex: v })}
									/>
								</TableCell>
								<TableCell>
									<NumberCell
										value={pair.resetSectionIndex}
										onChange={(v) => updatePair(i, { resetSectionIndex: v })}
									/>
								</TableCell>
								<TableCell>
									<Button
										size="sm"
										variant="ghost"
										className="h-6 px-2 text-xs text-destructive"
										onClick={() => removePair(i)}
									>
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

export default ResetPairsTable;
