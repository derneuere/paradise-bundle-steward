import { Button } from '@/components/ui/button';
import { ExternalLink } from 'lucide-react';
import { FieldShell, type FieldRendererProps } from './common';
import type { RecordFieldSchema } from '@/lib/schema/types';
import { useSchemaEditor } from '../context';

type Props = FieldRendererProps<Record<string, unknown>> & {
	schema: RecordFieldSchema;
	path: (string | number)[];
};

// Renders a nested record as a labeled card + jump button. We don't inline
// the full sub-form — the inspector would get too deep. Clicking "Open"
// navigates the tree to this path.
export function RecordInlineField({ label, value, meta, schema, path }: Props) {
	const { resource, selectPath } = useSchemaEditor();
	const record = resource.registry[schema.type];
	const description = meta?.description ?? record?.description;

	// Show a one-line summary using the record's own label() if it has one.
	const summary = record?.label
		? (() => {
				try {
					return record.label!(
						(value ?? {}) as Record<string, unknown>,
						null,
						{ root: null, resource },
					);
				} catch {
					return schema.type;
				}
			})()
		: schema.type;

	return (
		<FieldShell label={label} description={description} warning={meta?.warning}>
			<div className="flex items-center gap-2 border rounded p-2 bg-background/40">
				<span className="text-xs flex-1 truncate">{summary}</span>
				<Button
					size="sm"
					variant="outline"
					className="h-7 px-2"
					onClick={() => selectPath(path)}
				>
					<ExternalLink className="h-3 w-3 mr-1" /> Open
				</Button>
			</div>
		</FieldShell>
	);
}
