import { Badge } from '@/components/ui/badge';
import { FieldShell, type FieldRendererProps } from './common';
import type { FlagsFieldSchema } from '@/lib/schema/types';

type Props = FieldRendererProps<number> & {
	schema: FlagsFieldSchema;
};

export function FlagsField({ label, value, onChange, meta, schema }: Props) {
	const v = value ?? 0;
	return (
		<FieldShell label={label} description={meta?.description} warning={meta?.warning}>
			<div className="flex flex-wrap gap-1">
				{schema.bits.map((bit) => {
					const active = (v & bit.mask) !== 0;
					return (
						<Badge
							key={bit.mask}
							variant={active ? 'default' : 'outline'}
							className="cursor-pointer text-[10px] px-2"
							title={bit.description}
							onClick={() => {
								if (meta?.readOnly) return;
								onChange(v ^ bit.mask);
							}}
						>
							{bit.label}
						</Badge>
					);
				})}
			</div>
		</FieldShell>
	);
}
