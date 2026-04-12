import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import type { AISection } from '@/lib/core/aiSections';
import { SectionSpeed, AISectionFlag } from '@/lib/core/aiSections';
import { SPEED_LABELS, FLAG_NAMES } from './constants';

type Props = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onAdd: (section: AISection) => void;
};

function makeEmpty(): AISection {
	return {
		portals: [],
		noGoLines: [],
		corners: [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }],
		id: 0,
		spanIndex: -1,
		speed: SectionSpeed.E_SECTION_SPEED_NORMAL,
		district: 0,
		flags: 0,
	};
}

export const AddSectionDialog: React.FC<Props> = ({ open, onOpenChange, onAdd }) => {
	const [draft, setDraft] = useState<AISection>(makeEmpty);

	const handleAdd = () => {
		onAdd(draft);
		setDraft(makeEmpty());
		onOpenChange(false);
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-md">
				<DialogHeader>
					<DialogTitle>Add Section</DialogTitle>
				</DialogHeader>

				<div className="grid grid-cols-2 gap-3">
					<div>
						<Label className="text-xs">ID (hex)</Label>
						<Input
							className="h-8 font-mono"
							value={`0x${(draft.id >>> 0).toString(16).toUpperCase()}`}
							onChange={(e) => {
								const raw = e.target.value.replace(/^0x/i, '');
								const v = parseInt(raw, 16);
								if (Number.isFinite(v)) setDraft({ ...draft, id: v >>> 0 });
							}}
						/>
					</div>
					<div>
						<Label className="text-xs">Span Index</Label>
						<Input
							type="number"
							className="h-8"
							value={draft.spanIndex}
							onChange={(e) => {
								const v = parseInt(e.target.value, 10);
								setDraft({ ...draft, spanIndex: Number.isFinite(v) ? v : -1 });
							}}
						/>
					</div>
					<div>
						<Label className="text-xs">Speed</Label>
						<select
							className="h-8 w-full border rounded px-2 text-sm bg-background"
							value={draft.speed}
							onChange={(e) => setDraft({ ...draft, speed: parseInt(e.target.value, 10) as SectionSpeed })}
						>
							{Object.entries(SPEED_LABELS).map(([v, label]) => (
								<option key={v} value={v}>{label}</option>
							))}
						</select>
					</div>
					<div>
						<Label className="text-xs">District</Label>
						<Input
							type="number"
							className="h-8"
							value={draft.district}
							onChange={(e) => {
								const v = parseInt(e.target.value, 10);
								setDraft({ ...draft, district: Number.isFinite(v) ? v & 0xFF : 0 });
							}}
						/>
					</div>
				</div>

				<div>
					<Label className="text-xs">Flags</Label>
					<div className="flex gap-1 flex-wrap mt-1">
						{FLAG_NAMES.map(({ flag, label }) => (
							<Badge
								key={flag}
								variant={draft.flags & flag ? 'default' : 'outline'}
								className="cursor-pointer text-xs px-2"
								onClick={() => setDraft({ ...draft, flags: (draft.flags ^ flag) & 0xFF })}
							>
								{label}
							</Badge>
						))}
					</div>
				</div>

				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
					<Button onClick={handleAdd}>Add</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
};
