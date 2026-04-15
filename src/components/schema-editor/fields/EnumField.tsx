import { FieldShell, type FieldRendererProps } from './common';
import type { EnumFieldSchema } from '@/lib/schema/types';

type Props = FieldRendererProps<number> & {
	schema: EnumFieldSchema;
};

// Native <select> rather than the shadcn Select because our lists can get
// long (e.g., 20+ reset-speed types) and portaled listboxes misbehave inside
// nested scroll containers.
export function EnumField({ label, value, onChange, meta, schema }: Props) {
	return (
		<FieldShell label={label} description={meta?.description} warning={meta?.warning}>
			<select
				className="h-8 border rounded px-2 text-xs bg-background w-full"
				disabled={meta?.readOnly}
				value={value}
				onChange={(e) => onChange(parseInt(e.target.value, 10))}
			>
				{schema.values.map((v) => (
					<option key={v.value} value={v.value}>
						{v.label}
					</option>
				))}
			</select>
		</FieldShell>
	);
}
