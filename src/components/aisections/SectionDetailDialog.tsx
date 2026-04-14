import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Trash2 } from 'lucide-react';
import type { AISection, Portal, BoundaryLine, Vector2 } from '@/lib/core/aiSections';

type Props = {
	section: AISection;
	index: number;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onUpdate: (index: number, section: AISection) => void;
};

function FloatInput(props: { value: number; onChange: (v: number) => void; label?: string; width?: string }) {
	const { value, onChange, label, width = 'w-24' } = props;
	return (
		<div>
			{label && <Label className="text-[10px] text-muted-foreground">{label}</Label>}
			<Input
				type="number"
				step="any"
				className={`h-7 ${width} font-mono text-xs`}
				value={Number.isFinite(value) ? value : 0}
				onChange={(e) => {
					const v = parseFloat(e.target.value);
					onChange(Number.isFinite(v) ? v : 0);
				}}
			/>
		</div>
	);
}

function IntInput(props: { value: number; onChange: (v: number) => void; label?: string; width?: string }) {
	const { value, onChange, label, width = 'w-20' } = props;
	return (
		<div>
			{label && <Label className="text-[10px] text-muted-foreground">{label}</Label>}
			<Input
				type="number"
				className={`h-7 ${width} font-mono text-xs`}
				value={Number.isFinite(value) ? value : 0}
				onChange={(e) => {
					const v = parseInt(e.target.value, 10);
					onChange(Number.isFinite(v) ? v : 0);
				}}
			/>
		</div>
	);
}

// -- Boundary Line Row --
const BoundaryLineRow: React.FC<{
	bl: BoundaryLine;
	onChange: (bl: BoundaryLine) => void;
	onRemove: () => void;
	index: number;
}> = ({ bl, onChange, onRemove, index }) => (
	<div className="flex items-end gap-1 mb-1">
		<span className="text-[10px] text-muted-foreground w-6 pb-2">{index}</span>
		<FloatInput label="X1" value={bl.verts.x} onChange={(v) => onChange({ verts: { ...bl.verts, x: v } })} width="w-20" />
		<FloatInput label="Y1" value={bl.verts.y} onChange={(v) => onChange({ verts: { ...bl.verts, y: v } })} width="w-20" />
		<FloatInput label="X2" value={bl.verts.z} onChange={(v) => onChange({ verts: { ...bl.verts, z: v } })} width="w-20" />
		<FloatInput label="Y2" value={bl.verts.w} onChange={(v) => onChange({ verts: { ...bl.verts, w: v } })} width="w-20" />
		<Button size="sm" variant="ghost" className="h-7 px-1 text-destructive" onClick={onRemove}>
			<Trash2 className="h-3 w-3" />
		</Button>
	</div>
);

// -- Portals Tab --
const PortalsTab: React.FC<{ section: AISection; onUpdate: (s: AISection) => void }> = ({ section, onUpdate }) => {
	const updatePortal = (pi: number, patch: Partial<Portal>) => {
		const portals = section.portals.map((p, i) => (i === pi ? { ...p, ...patch } : p));
		onUpdate({ ...section, portals });
	};

	const updatePortalBL = (pi: number, bi: number, bl: BoundaryLine) => {
		const portals = section.portals.map((p, i) => {
			if (i !== pi) return p;
			const boundaryLines = p.boundaryLines.map((b, j) => (j === bi ? bl : b));
			return { ...p, boundaryLines };
		});
		onUpdate({ ...section, portals });
	};

	const removePortalBL = (pi: number, bi: number) => {
		const portals = section.portals.map((p, i) => {
			if (i !== pi) return p;
			return { ...p, boundaryLines: p.boundaryLines.filter((_, j) => j !== bi) };
		});
		onUpdate({ ...section, portals });
	};

	const addPortalBL = (pi: number) => {
		const portals = section.portals.map((p, i) => {
			if (i !== pi) return p;
			return { ...p, boundaryLines: [...p.boundaryLines, { verts: { x: 0, y: 0, z: 0, w: 0 } }] };
		});
		onUpdate({ ...section, portals });
	};

	const addPortal = () => {
		const newPortal: Portal = {
			positionX: 0, positionY: 0, positionZ: 0,
			boundaryLines: [],
			linkSection: 0,
		};
		onUpdate({ ...section, portals: [...section.portals, newPortal] });
	};

	const removePortal = (pi: number) => {
		onUpdate({ ...section, portals: section.portals.filter((_, i) => i !== pi) });
	};

	return (
		<div className="space-y-3 max-h-[50vh] overflow-auto pr-1">
			{section.portals.map((portal, pi) => (
				<div key={pi} className="border rounded p-2 space-y-2">
					<div className="flex items-center justify-between">
						<span className="text-xs font-medium">Portal {pi}</span>
						<Button size="sm" variant="ghost" className="h-6 px-1 text-destructive" onClick={() => removePortal(pi)}>
							<Trash2 className="h-3 w-3" />
						</Button>
					</div>
					<div className="flex gap-2 flex-wrap">
						<FloatInput label="Position X" value={portal.positionX} onChange={(v) => updatePortal(pi, { positionX: v })} />
						<FloatInput label="Position Y" value={portal.positionZ} onChange={(v) => updatePortal(pi, { positionZ: v })} />
						<FloatInput label="Position Z (up)" value={portal.positionY} onChange={(v) => updatePortal(pi, { positionY: v })} />
						<IntInput label="Link Section" value={portal.linkSection} onChange={(v) => updatePortal(pi, { linkSection: v })} />
					</div>
					{portal.boundaryLines.length > 0 && (
						<div>
							<Label className="text-[10px] text-muted-foreground">Boundary Lines</Label>
							{portal.boundaryLines.map((bl, bi) => (
								<BoundaryLineRow
									key={bi}
									bl={bl}
									index={bi}
									onChange={(next) => updatePortalBL(pi, bi, next)}
									onRemove={() => removePortalBL(pi, bi)}
								/>
							))}
						</div>
					)}
					<Button size="sm" variant="outline" className="h-6 text-xs" onClick={() => addPortalBL(pi)}>
						+ Boundary Line
					</Button>
				</div>
			))}
			<Button size="sm" variant="outline" onClick={addPortal}>+ Portal</Button>
		</div>
	);
};

// -- NoGo Lines Tab --
const NoGoTab: React.FC<{ section: AISection; onUpdate: (s: AISection) => void }> = ({ section, onUpdate }) => {
	const updateLine = (i: number, bl: BoundaryLine) => {
		const noGoLines = section.noGoLines.map((b, j) => (j === i ? bl : b));
		onUpdate({ ...section, noGoLines });
	};

	const removeLine = (i: number) => {
		onUpdate({ ...section, noGoLines: section.noGoLines.filter((_, j) => j !== i) });
	};

	const addLine = () => {
		onUpdate({ ...section, noGoLines: [...section.noGoLines, { verts: { x: 0, y: 0, z: 0, w: 0 } }] });
	};

	return (
		<div className="space-y-1 max-h-[50vh] overflow-auto pr-1">
			{section.noGoLines.map((bl, i) => (
				<BoundaryLineRow key={i} bl={bl} index={i} onChange={(next) => updateLine(i, next)} onRemove={() => removeLine(i)} />
			))}
			<Button size="sm" variant="outline" className="mt-2" onClick={addLine}>+ NoGo Line</Button>
		</div>
	);
};

// -- Corners Tab --
const CornersTab: React.FC<{ section: AISection; onUpdate: (s: AISection) => void }> = ({ section, onUpdate }) => {
	const updateCorner = (i: number, patch: Partial<Vector2>) => {
		const corners = section.corners.map((c, j) => (j === i ? { ...c, ...patch } : c));
		onUpdate({ ...section, corners });
	};

	return (
		<div className="space-y-2">
			{section.corners.map((c, i) => (
				<div key={i} className="flex items-end gap-2">
					<span className="text-xs text-muted-foreground w-16 pb-2">Corner {i}</span>
					<FloatInput label="X" value={c.x} onChange={(v) => updateCorner(i, { x: v })} />
					<FloatInput label="Y" value={c.y} onChange={(v) => updateCorner(i, { y: v })} />
				</div>
			))}
		</div>
	);
};

// -- Main Dialog --
export const SectionDetailDialog: React.FC<Props> = ({ section, index, open, onOpenChange, onUpdate }) => {
	const handleUpdate = (updated: AISection) => {
		onUpdate(index, updated);
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
				<DialogHeader>
					<DialogTitle>
						Section {index} &mdash; 0x{(section.id >>> 0).toString(16).toUpperCase()}
					</DialogTitle>
				</DialogHeader>

				<Tabs defaultValue="portals" className="flex-1 min-h-0">
					<TabsList>
						<TabsTrigger value="portals">Portals ({section.portals.length})</TabsTrigger>
						<TabsTrigger value="nogo">NoGo Lines ({section.noGoLines.length})</TabsTrigger>
						<TabsTrigger value="corners">Corners ({section.corners.length})</TabsTrigger>
					</TabsList>
					<TabsContent value="portals" className="mt-2">
						<PortalsTab section={section} onUpdate={handleUpdate} />
					</TabsContent>
					<TabsContent value="nogo" className="mt-2">
						<NoGoTab section={section} onUpdate={handleUpdate} />
					</TabsContent>
					<TabsContent value="corners" className="mt-2">
						<CornersTab section={section} onUpdate={handleUpdate} />
					</TabsContent>
				</Tabs>
			</DialogContent>
		</Dialog>
	);
};
