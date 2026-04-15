import { Input } from '@/components/ui/input';
import { FieldShell, type FieldRendererProps } from './common';

export function FloatField({ label, value, onChange, meta }: FieldRendererProps<number>) {
	return (
		<FieldShell label={label} description={meta?.description} warning={meta?.warning}>
			<Input
				type="number"
				step="any"
				disabled={meta?.readOnly}
				className="h-8 font-mono text-xs"
				value={Number.isFinite(value) ? value : 0}
				onChange={(e) => {
					const v = parseFloat(e.target.value);
					if (Number.isFinite(v)) onChange(v);
				}}
			/>
		</FieldShell>
	);
}
