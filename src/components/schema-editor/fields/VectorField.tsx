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

// Spatial swap: Burnout files store Z-up (game X=east, Y=depth, Z=up), but
// the editor presents Y-up (display X=east, Y=up, Z=depth). When `meta.swapYZ`
// is set the label "Y" binds to `value.z` and label "Z" binds to `value.y`,
// while the underlying model is left untouched so round-trip stays byte-exact.
export function Vec3Field({ label, value, onChange, meta }: Vec3Props) {
	const current = value ?? { x: 0, y: 0, z: 0 };
	const swap = meta?.swapYZ;
	return (
		<FieldShell label={label} description={meta?.description} warning={meta?.warning}>
			<div className="grid grid-cols-3 gap-2">
				{axisInput('X', current.x, (v) => onChange({ ...current, x: v }), meta?.readOnly)}
				{swap
					? axisInput('Y', current.z, (v) => onChange({ ...current, z: v }), meta?.readOnly)
					: axisInput('Y', current.y, (v) => onChange({ ...current, y: v }), meta?.readOnly)}
				{swap
					? axisInput('Z', current.y, (v) => onChange({ ...current, y: v }), meta?.readOnly)
					: axisInput('Z', current.z, (v) => onChange({ ...current, z: v }), meta?.readOnly)}
			</div>
		</FieldShell>
	);
}

export function Vec4Field({ label, value, onChange, meta }: Vec4Props) {
	const current = value ?? { x: 0, y: 0, z: 0, w: 0 };
	const swap = meta?.swapYZ;
	return (
		<FieldShell label={label} description={meta?.description} warning={meta?.warning}>
			<div className="grid grid-cols-4 gap-2">
				{axisInput('X', current.x, (v) => onChange({ ...current, x: v }), meta?.readOnly)}
				{swap
					? axisInput('Y', current.z, (v) => onChange({ ...current, z: v }), meta?.readOnly)
					: axisInput('Y', current.y, (v) => onChange({ ...current, y: v }), meta?.readOnly)}
				{swap
					? axisInput('Z', current.y, (v) => onChange({ ...current, y: v }), meta?.readOnly)
					: axisInput('Z', current.z, (v) => onChange({ ...current, z: v }), meta?.readOnly)}
				{axisInput('W', current.w, (v) => onChange({ ...current, w: v }), meta?.readOnly)}
			</div>
		</FieldShell>
	);
}
