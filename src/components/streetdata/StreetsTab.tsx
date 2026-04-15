// Streets table — editable list view over ParsedStreetData.streets.
//
// Extracted from the old monolithic StreetDataEditor.tsx so the schema
// editor's extension registry can reuse it as a custom renderer on the
// `streets` list field.

import React from 'react';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { ParsedStreetData, Street } from '@/lib/core/streetData';
import { NumberCell } from './cells';

type Props = {
	data: ParsedStreetData;
	onChange: (next: ParsedStreetData) => void;
};

export const StreetsTab: React.FC<Props> = ({ data, onChange }) => {
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

export default StreetsTab;
