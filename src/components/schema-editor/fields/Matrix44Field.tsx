import { Input } from '@/components/ui/input';
import { FieldShell, type FieldRendererProps } from './common';

// Matrix44Affine stored as 16 f32s in row-major order. For static traffic
// vehicles the meaningful editable parts are the translation row (indices
// 12, 13, 14) — we expose that prominently and fold the rotation matrix
// into a collapsed raw-grid view so users can see it's there.
export function Matrix44Field({
	label,
	value,
	onChange,
	meta,
}: FieldRendererProps<number[]>) {
	const m = value ?? new Array(16).fill(0);
	const tx = m[12] ?? 0;
	const ty = m[13] ?? 0;
	const tz = m[14] ?? 0;

	const setSlot = (slot: number, v: number) => {
		const next = m.slice();
		next[slot] = v;
		onChange(next);
	};

	return (
		<FieldShell
			label={label}
			description={meta?.description ?? 'Matrix44Affine. Translation row is the most commonly edited.'}
			warning={meta?.warning}
		>
			<div className="space-y-2">
				<div>
					<div className="text-[10px] text-muted-foreground mb-1">Translation (X / Y / Z)</div>
					<div className="grid grid-cols-3 gap-2">
						{(['X', 'Y', 'Z'] as const).map((axis, i) => {
							const current = [tx, ty, tz][i];
							return (
								<div key={axis} className="flex flex-col gap-0.5">
									<span className="text-[10px] text-muted-foreground">{axis}</span>
									<Input
										type="number"
										step="any"
										disabled={meta?.readOnly}
										className="h-7 font-mono text-xs"
										value={Number.isFinite(current) ? current : 0}
										onChange={(e) => {
											const v = parseFloat(e.target.value);
											if (Number.isFinite(v)) setSlot(12 + i, v);
										}}
									/>
								</div>
							);
						})}
					</div>
				</div>
				<details>
					<summary className="text-[11px] text-muted-foreground cursor-pointer">
						Raw 4×4 (rotation + scale)
					</summary>
					<div className="grid grid-cols-4 gap-1 mt-2 font-mono text-[10px]">
						{m.map((cell, i) => (
							<input
								key={i}
								type="number"
								step="any"
								disabled={meta?.readOnly}
								className="h-6 border rounded px-1"
								value={Number.isFinite(cell) ? cell.toFixed(3) : 0}
								onChange={(e) => {
									const v = parseFloat(e.target.value);
									if (Number.isFinite(v)) setSlot(i, v);
								}}
							/>
						))}
					</div>
				</details>
			</div>
		</FieldShell>
	);
}
