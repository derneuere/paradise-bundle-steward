import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { FieldShell, type FieldRendererProps } from './common';
import { floatsToHex, parseHex, bytesToFloats } from './matrix44Bytes';
import { RotationVisualizer } from './RotationVisualizer';

// Matrix44Affine stored as 16 f32s in row-major order. For static traffic
// vehicles the meaningful editable parts are the translation row (indices
// 12, 13, 14) — we expose that prominently and fold the rotation matrix
// into a collapsed raw-grid view so users can see it's there.
//
// Spatial swap: for world-space affine transforms the game's vertical
// component lands in slot 13 (row-major translation row is ty), but the
// editor presents "Z" as the up/down axis. When `meta.swapYZ` is set the
// UI "Y" field binds to slot 14 and UI "Z" binds to slot 13 — mirroring
// how Vec3Field / Vec4Field handle the same convention for positional
// vec3/vec4 fields. Matrices without the flag (e.g. renderable's
// boundingMatrix, which is column-major and not world-space) are rendered
// verbatim. The raw 4×4 view always shows the matrix in storage order.
export function Matrix44Field({
	label,
	value,
	onChange,
	meta,
}: FieldRendererProps<number[]>) {
	const m = value ?? new Array(16).fill(0);
	const swap = meta?.swapYZ ?? false;
	// Editor X / Y / Z → matrix slot. Swapped mode puts slot 13 (vertical)
	// under the Z label and slot 14 under Y.
	const translationSlots = swap ? ([12, 14, 13] as const) : ([12, 13, 14] as const);
	const tx = m[translationSlots[0]] ?? 0;
	const ty = m[translationSlots[1]] ?? 0;
	const tz = m[translationSlots[2]] ?? 0;

	const setSlot = (slot: number, v: number) => {
		const next = m.slice();
		next[slot] = v;
		onChange(next);
	};

	const defaultDescription = swap
		? 'Matrix44Affine. Translation row is the most commonly edited. Z is up/down.'
		: 'Matrix44Affine. Translation row is the most commonly edited.';

	// ---------------- Hex bytes row ----------------
	// The textbox follows external changes to `m` (drags in the preview,
	// edits in the 4×4 grid, X/Y/Z edits) UNLESS the user is actively
	// typing in it. The `dirty` flag tracks active typing; while it's
	// false, `displayedHex` is derived from `m` directly — no effect
	// needed. Once the user types, we mirror their text from local state
	// until commit (Apply) or revert (blur) clears the dirty flag.
	const canonicalHex = floatsToHex(m.slice(0, 12));
	const [hexDraft, setHexDraft] = useState('');
	const [dirty, setDirty] = useState(false);
	const [hexError, setHexError] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);
	const hexText = dirty ? hexDraft : canonicalHex;

	const applyHex = () => {
		const parsed = parseHex(hexText);
		if ('error' in parsed) {
			setHexError(parsed.error);
			return;
		}
		const floats = bytesToFloats(parsed.bytes);
		const next = m.slice();
		for (let i = 0; i < floats.length && i < 16; i++) next[i] = floats[i];
		onChange(next);
		setHexError(null);
		setDirty(false);
	};

	const copyHex = async () => {
		try {
			await navigator.clipboard.writeText(canonicalHex);
			setCopied(true);
			setTimeout(() => setCopied(false), 1000);
		} catch {
			// clipboard blocked — fall back to selecting the input text.
		}
	};

	return (
		<FieldShell
			label={label}
			description={meta?.description ?? defaultDescription}
			warning={meta?.warning}
		>
			<div className="space-y-2">
				<div>
					<div className="text-[10px] text-muted-foreground mb-1">
						{swap ? 'Translation (X / Y / Z, Z is up)' : 'Translation (X / Y / Z)'}
					</div>
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
											if (Number.isFinite(v)) setSlot(translationSlots[i], v);
										}}
									/>
								</div>
							);
						})}
					</div>
				</div>

				<div>
					<div className="text-[10px] text-muted-foreground mb-1">
						Raw bytes (48 = rotation only · 64 = full matrix · little-endian f32)
					</div>
					<div className="flex gap-1">
						<Input
							type="text"
							spellCheck={false}
							disabled={meta?.readOnly}
							className="h-7 font-mono text-[10px] flex-1"
							value={hexText}
							onChange={(e) => { setDirty(true); setHexDraft(e.target.value); }}
							onBlur={() => { setDirty(false); setHexError(null); }}
							onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyHex(); } }}
						/>
						<Button
							type="button"
							variant="outline"
							size="sm"
							disabled={meta?.readOnly}
							className="h-7 px-2 text-[10px]"
							// Prevent the mousedown from shifting focus off the hex input,
							// which would fire onBlur and reset hexText to the OLD canonical
							// value before onClick runs — turning the apply into a no-op.
							// Default action of mousedown on a button is "move focus here";
							// preventDefault cancels just the focus move, onClick still fires.
							onMouseDown={(e) => e.preventDefault()}
							onClick={applyHex}
						>
							Apply
						</Button>
						<Button
							type="button"
							variant="outline"
							size="sm"
							className="h-7 px-2 text-[10px]"
							onClick={copyHex}
						>
							{copied ? 'Copied' : 'Copy'}
						</Button>
					</div>
					{hexError && (
						<p className="text-[10px] text-destructive mt-1">{hexError}</p>
					)}
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
								className="h-6 rounded border border-input bg-background text-foreground px-1 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
								value={Number.isFinite(cell) ? cell.toFixed(3) : 0}
								onChange={(e) => {
									const v = parseFloat(e.target.value);
									if (Number.isFinite(v)) setSlot(i, v);
								}}
							/>
						))}
					</div>
				</details>

				<div>
					<div className="text-[10px] text-muted-foreground mb-1">
						Rotation preview (drag to rotate)
					</div>
					<RotationVisualizer
						matrix={m}
						onChange={onChange}
						readOnly={meta?.readOnly}
					/>
				</div>
			</div>
		</FieldShell>
	);
}
