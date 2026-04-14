import React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { ParsedTrafficData, Vec4 } from '@/lib/core/trafficData';

type Props = {
	data: ParsedTrafficData;
	onChange: (next: ParsedTrafficData) => void;
};

function vec4ToCSS(c: Vec4): string {
	const r = Math.round(Math.min(c.x, 1) * 255);
	const g = Math.round(Math.min(c.y, 1) * 255);
	const b = Math.round(Math.min(c.z, 1) * 255);
	const a = Math.min(c.w, 1);
	return `rgba(${r},${g},${b},${a.toFixed(2)})`;
}

export const PaintColoursTab: React.FC<Props> = ({ data, onChange }) => {
	const updateColour = (index: number, patch: Partial<Vec4>) => {
		const next = data.paintColours.map((c, i) => (i === index ? { ...c, ...patch } : c));
		onChange({ ...data, paintColours: next });
	};

	const addColour = () => {
		onChange({ ...data, paintColours: [...data.paintColours, { x: 0.5, y: 0.5, z: 0.5, w: 1 }] });
	};

	const removeColour = (index: number) => {
		onChange({ ...data, paintColours: data.paintColours.filter((_, i) => i !== index) });
	};

	return (
		<div className="space-y-2">
			<div className="flex items-center justify-between">
				<span className="text-sm text-muted-foreground">{data.paintColours.length} colours</span>
				<Button size="sm" variant="outline" onClick={addColour}>Add Colour</Button>
			</div>

			<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-[60vh] overflow-auto border rounded p-2">
				{data.paintColours.map((c, i) => (
					<div key={i} className="flex items-center gap-2 p-2 border rounded bg-background">
						{/* Colour swatch */}
						<div
							className="w-10 h-10 rounded border flex-shrink-0"
							style={{ backgroundColor: vec4ToCSS(c) }}
						/>
						<div className="flex-1 grid grid-cols-4 gap-1">
							<div className="text-center">
								<span className="text-[10px] text-muted-foreground">R</span>
								<Input
									type="number"
									step={0.01}
									className="h-6 text-xs text-center px-1"
									value={c.x.toFixed(3)}
									onChange={(e) => {
										const v = parseFloat(e.target.value);
										if (Number.isFinite(v)) updateColour(i, { x: v });
									}}
								/>
							</div>
							<div className="text-center">
								<span className="text-[10px] text-muted-foreground">G</span>
								<Input
									type="number"
									step={0.01}
									className="h-6 text-xs text-center px-1"
									value={c.y.toFixed(3)}
									onChange={(e) => {
										const v = parseFloat(e.target.value);
										if (Number.isFinite(v)) updateColour(i, { y: v });
									}}
								/>
							</div>
							<div className="text-center">
								<span className="text-[10px] text-muted-foreground">B</span>
								<Input
									type="number"
									step={0.01}
									className="h-6 text-xs text-center px-1"
									value={c.z.toFixed(3)}
									onChange={(e) => {
										const v = parseFloat(e.target.value);
										if (Number.isFinite(v)) updateColour(i, { z: v });
									}}
								/>
							</div>
							<div className="text-center">
								<span className="text-[10px] text-muted-foreground">A</span>
								<Input
									type="number"
									step={0.01}
									className="h-6 text-xs text-center px-1"
									value={c.w.toFixed(3)}
									onChange={(e) => {
										const v = parseFloat(e.target.value);
										if (Number.isFinite(v)) updateColour(i, { w: v });
									}}
								/>
							</div>
						</div>
						<span className="font-mono text-[10px] text-muted-foreground w-4">{i}</span>
						<Button size="sm" variant="ghost" className="h-6 px-1 text-xs text-destructive" onClick={() => removeColour(i)}>X</Button>
					</div>
				))}
			</div>
		</div>
	);
};
