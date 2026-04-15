import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ExternalLink } from 'lucide-react';
import { FieldShell, type FieldRendererProps } from './common';
import type { RefFieldSchema } from '@/lib/schema/types';
import { getAtPath } from '@/lib/schema/walk';
import { useSchemaEditor } from '../context';

type Props = FieldRendererProps<number> & {
	schema: RefFieldSchema;
};

// Ref fields are integer indexes into another list. The renderer shows a
// dropdown whose options are the labels of the target list items, plus a
// jump button that selects the referenced item in the tree.
export function RefField({ label, value, onChange, meta, schema }: Props) {
	const { data, resource, selectPath } = useSchemaEditor();
	const targetList = getAtPath(data, schema.target.listPath);
	const items = Array.isArray(targetList) ? targetList : [];
	const missing = value != null && value !== schema.nullValue && items[value] == null;
	const isNull = schema.nullValue != null && value === schema.nullValue;

	// Resolve label for each target item — use the item record's label()
	// callback if available, otherwise fall back to `#index`.
	const itemType = schema.target.itemType;
	const recordSchema = resource.registry[itemType];

	const labelFor = (item: unknown, idx: number) => {
		if (recordSchema?.label) {
			try {
				return recordSchema.label(item as Record<string, unknown>, idx, { root: data, resource });
			} catch {
				// fall through
			}
		}
		return `#${idx}`;
	};

	const displayName = schema.target.displayName ?? itemType;

	return (
		<FieldShell
			label={label}
			description={meta?.description ?? `→ ${displayName}`}
			warning={meta?.warning}
		>
			<div className="flex items-center gap-2">
				<select
					className={`h-8 border rounded px-2 text-xs bg-background flex-1 ${
						missing ? 'border-destructive text-destructive' : ''
					}`}
					disabled={meta?.readOnly}
					value={isNull ? '__null__' : value}
					onChange={(e) => {
						if (e.target.value === '__null__' && schema.nullValue != null) {
							onChange(schema.nullValue);
							return;
						}
						onChange(parseInt(e.target.value, 10));
					}}
				>
					{schema.nullValue != null && (
						<option value="__null__">— none —</option>
					)}
					{items.map((item, i) => (
						<option key={i} value={i}>
							{labelFor(item, i)}
						</option>
					))}
					{missing && (
						<option value={value}>
							{`#${value} (missing)`}
						</option>
					)}
				</select>
				<Button
					size="sm"
					variant="outline"
					className="h-8 px-2"
					disabled={isNull || missing || meta?.readOnly}
					onClick={() => {
						if (value == null || isNull) return;
						selectPath([...schema.target.listPath, value]);
					}}
					title="Jump to target"
				>
					<ExternalLink className="h-3 w-3" />
				</Button>
				{missing && <Badge variant="destructive" className="text-[10px]">dangling</Badge>}
			</div>
		</FieldShell>
	);
}
