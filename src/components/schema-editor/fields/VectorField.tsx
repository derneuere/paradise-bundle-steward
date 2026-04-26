import React, { useState } from 'react';
import { Link2, Unlink2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { FieldShell, type FieldRendererProps } from './common';

type Vec2 = { x: number; y: number };
type Vec3 = { x: number; y: number; z: number };
type Vec4 = { x: number; y: number; z: number; w: number };

type Vec2Props = FieldRendererProps<Vec2>;
type Vec3Props = FieldRendererProps<Vec3>;
type Vec4Props = FieldRendererProps<Vec4>;

function axisInput(
	label: string,
	value: number,
	onChange: (v: number) => void,
	readOnly?: boolean,
) {
	return (
		<div className="flex flex-col gap-0.5" key={label}>
			<span className="text-[10px] text-muted-foreground">{label}</span>
			<Input
				type="number"
				step="any"
				disabled={readOnly}
				className="h-7 w-full font-mono text-xs"
				value={Number.isFinite(value) ? value : 0}
				onChange={(e) => {
					const v = parseFloat(e.target.value);
					if (Number.isFinite(v)) onChange(v);
				}}
			/>
		</div>
	);
}

// Toggle that controls uniform-scale linking across the spatial axes of a
// Vec3/Vec4 field. Renders inline with the field label.
function LinkToggle({
	linked,
	onToggle,
	disabled,
}: {
	linked: boolean;
	onToggle: () => void;
	disabled?: boolean;
}) {
	const Icon = linked ? Link2 : Unlink2;
	return (
		<button
			type="button"
			onClick={onToggle}
			disabled={disabled}
			title={linked ? 'Unlink axes (independent edits)' : 'Link axes (uniform scale)'}
			aria-pressed={linked}
			className={
				'inline-flex h-5 w-5 items-center justify-center rounded transition-colors ' +
				(linked
					? 'text-primary hover:bg-primary/10'
					: 'text-muted-foreground hover:bg-muted hover:text-foreground') +
				(disabled ? ' cursor-not-allowed opacity-50' : '')
			}
		>
			<Icon size={12} />
		</button>
	);
}

// When axes are linked, an edit to one axis scales the participating axes
// by `typed / previous`. If the previous value is zero we can't compute a
// ratio, so the linked behavior degenerates to an independent edit on that
// component — matching how Unity / Blender behave when one axis was zero.
function scaleLinkedAxes<T extends Record<'x' | 'y' | 'z', number>>(
	current: T,
	axis: 'x' | 'y' | 'z',
	typed: number,
): T {
	const prev = current[axis];
	if (prev === 0 || !Number.isFinite(prev)) {
		return { ...current, [axis]: typed };
	}
	const ratio = typed / prev;
	return {
		...current,
		x: current.x * ratio,
		y: current.y * ratio,
		z: current.z * ratio,
		[axis]: typed,
	};
}

export function Vec2Field({ label, value, onChange, meta }: Vec2Props) {
	const current = value ?? { x: 0, y: 0 };
	return (
		<FieldShell label={label} description={meta?.description} warning={meta?.warning}>
			<div className="grid grid-cols-2 gap-2">
				{axisInput('X', current.x, (v) => onChange({ ...current, x: v }), meta?.readOnly)}
				{axisInput('Y', current.y, (v) => onChange({ ...current, y: v }), meta?.readOnly)}
			</div>
		</FieldShell>
	);
}

// LabelWithLink renders the field label and the chain toggle on the same row.
// Wrapping with FieldShell would put the toggle below the label, which is the
// wrong visual hierarchy for a per-field control.
function LabelWithLink({
	label,
	description,
	warning,
	linked,
	onToggle,
	disabled,
	children,
}: {
	label: string;
	description?: string;
	warning?: string;
	linked: boolean;
	onToggle: () => void;
	disabled?: boolean;
	children: React.ReactNode;
}) {
	return (
		<div className="space-y-1">
			<div className="flex items-center gap-1.5">
				<span className="text-xs font-medium text-muted-foreground">{label}</span>
				<LinkToggle linked={linked} onToggle={onToggle} disabled={disabled} />
			</div>
			{children}
			{description && <p className="text-[11px] text-muted-foreground/80">{description}</p>}
			{warning && (
				<p className="text-[11px] text-yellow-600 dark:text-yellow-500">{warning}</p>
			)}
		</div>
	);
}

// Spatial swap: Burnout files store Z-up (game X=east, Y=depth, Z=up), but
// the editor presents Y-up (display X=east, Y=up, Z=depth). When `meta.swapYZ`
// is set the label "Y" binds to `value.z` and label "Z" binds to `value.y`,
// while the underlying model is left untouched so round-trip stays byte-exact.
export function Vec3Field({ label, value, onChange, meta }: Vec3Props) {
	const current = value ?? { x: 0, y: 0, z: 0 };
	const swap = meta?.swapYZ;
	const [linked, setLinked] = useState(false);

	const handleAxis = (axis: 'x' | 'y' | 'z', typed: number) => {
		if (linked && !meta?.readOnly) {
			onChange(scaleLinkedAxes(current, axis, typed));
		} else {
			onChange({ ...current, [axis]: typed });
		}
	};

	const grid = (
		<div className="grid grid-cols-3 gap-2">
			{axisInput('X', current.x, (v) => handleAxis('x', v), meta?.readOnly)}
			{swap
				? axisInput('Y', current.z, (v) => handleAxis('z', v), meta?.readOnly)
				: axisInput('Y', current.y, (v) => handleAxis('y', v), meta?.readOnly)}
			{swap
				? axisInput('Z', current.y, (v) => handleAxis('y', v), meta?.readOnly)
				: axisInput('Z', current.z, (v) => handleAxis('z', v), meta?.readOnly)}
		</div>
	);

	if (!meta?.linkable) {
		return (
			<FieldShell label={label} description={meta?.description} warning={meta?.warning}>
				{grid}
			</FieldShell>
		);
	}

	return (
		<LabelWithLink
			label={label}
			description={meta?.description}
			warning={meta?.warning}
			linked={linked}
			onToggle={() => setLinked((v) => !v)}
			disabled={meta?.readOnly}
		>
			{grid}
		</LabelWithLink>
	);
}

export function Vec4Field({ label, value, onChange, meta }: Vec4Props) {
	const current = value ?? { x: 0, y: 0, z: 0, w: 0 };
	const swap = meta?.swapYZ;
	const [linked, setLinked] = useState(false);

	// Linked edits only scale x/y/z; w is preserved verbatim because it is
	// never a spatial axis (it carries padding / rotation / radius / 1.0).
	const handleAxis = (axis: 'x' | 'y' | 'z' | 'w', typed: number) => {
		if (axis === 'w' || !linked || meta?.readOnly) {
			onChange({ ...current, [axis]: typed });
			return;
		}
		const scaled = scaleLinkedAxes(current, axis, typed);
		onChange({ ...current, x: scaled.x, y: scaled.y, z: scaled.z });
	};

	const grid = (
		<div className="grid grid-cols-4 gap-2">
			{axisInput('X', current.x, (v) => handleAxis('x', v), meta?.readOnly)}
			{swap
				? axisInput('Y', current.z, (v) => handleAxis('z', v), meta?.readOnly)
				: axisInput('Y', current.y, (v) => handleAxis('y', v), meta?.readOnly)}
			{swap
				? axisInput('Z', current.y, (v) => handleAxis('y', v), meta?.readOnly)
				: axisInput('Z', current.z, (v) => handleAxis('z', v), meta?.readOnly)}
			{axisInput('W', current.w, (v) => handleAxis('w', v), meta?.readOnly)}
		</div>
	);

	if (!meta?.linkable) {
		return (
			<FieldShell label={label} description={meta?.description} warning={meta?.warning}>
				{grid}
			</FieldShell>
		);
	}

	return (
		<LabelWithLink
			label={label}
			description={meta?.description}
			warning={meta?.warning}
			linked={linked}
			onToggle={() => setLinked((v) => !v)}
			disabled={meta?.readOnly}
		>
			{grid}
		</LabelWithLink>
	);
}
