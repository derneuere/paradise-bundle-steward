// Junctions table — editable list view over ParsedStreetData.junctions.
//
// Extracted from the old monolithic StreetDataEditor.tsx.

import React from 'react';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { ParsedStreetData, Junction } from '@/lib/core/streetData';
import { NumberCell, StringCell } from './cells';

type Props = {
	data: ParsedStreetData;
	onChange: (next: ParsedStreetData) => void;
};

export const JunctionsTab: React.FC<Props> = ({ data, onChange }) => {
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

export default JunctionsTab;
