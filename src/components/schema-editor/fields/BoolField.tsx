import { Checkbox } from '@/components/ui/checkbox';
import { FieldShell, type FieldRendererProps } from './common';

export function BoolField({ label, value, onChange, meta }: FieldRendererProps<boolean>) {
	return (
		<FieldShell label={label} description={meta?.description} warning={meta?.warning}>
			<Checkbox
				checked={!!value}
				disabled={meta?.readOnly}
				onCheckedChange={(checked) => onChange(!!checked)}
			/>
		</FieldShell>
	);
}
