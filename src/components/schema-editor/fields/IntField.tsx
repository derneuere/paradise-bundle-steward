import { Input } from '@/components/ui/input';
import { FieldShell, INT_RANGES, type FieldRendererProps } from './common';
import type { IntKind } from '@/lib/schema/types';

type Props = FieldRendererProps<number> & {
	kind: IntKind;
};

export function IntField({ label, value, onChange, meta, kind }: Props) {
	const { min, max } = INT_RANGES[kind];
	return (
		<FieldShell label={label} description={meta?.description} warning={meta?.warning}>
			<Input
				type="number"
				min={min}
				max={max}
				step={1}
				disabled={meta?.readOnly}
				className="h-8 font-mono text-xs"
				value={Number.isFinite(value) ? value : 0}
				onChange={(e) => {
					const v = parseInt(e.target.value, 10);
					if (!Number.isFinite(v)) return;
					onChange(Math.max(min, Math.min(max, v)));
				}}
			/>
		</FieldShell>
	);
}
