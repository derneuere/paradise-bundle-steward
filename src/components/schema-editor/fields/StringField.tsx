import { Input } from '@/components/ui/input';
import { FieldShell, type FieldRendererProps } from './common';

export function StringField({ label, value, onChange, meta }: FieldRendererProps<string>) {
	return (
		<FieldShell label={label} description={meta?.description} warning={meta?.warning}>
			<Input
				className="h-8 text-xs"
				disabled={meta?.readOnly}
				value={value ?? ''}
				onChange={(e) => onChange(e.target.value)}
			/>
		</FieldShell>
	);
}
