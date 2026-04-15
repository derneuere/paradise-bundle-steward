import { FieldShell, type FieldRendererProps } from './common';
import type { CustomFieldSchema } from '@/lib/schema/types';
import { useSchemaEditor } from '../context';

type Props = FieldRendererProps<unknown> & {
	schema: CustomFieldSchema;
	path: (string | number)[];
};

// Escape hatch — looks up a component by name in the editor extension
// registry and embeds it with the standard extension props. If the
// extension is not registered, renders a soft warning without crashing.
export function CustomField({ label, value, onChange, meta, schema, path }: Props) {
	const { getExtension, data, resource, setAtPath } = useSchemaEditor();
	const Component = getExtension(schema.component);
	return (
		<FieldShell label={label} description={meta?.description} warning={meta?.warning}>
			{Component ? (
				<Component
					path={path}
					value={value}
					setValue={onChange}
					setData={(next) => setAtPath([], next)}
					data={data}
					resource={resource}
				/>
			) : (
				<div className="text-xs text-yellow-600 dark:text-yellow-500 border border-yellow-500/30 rounded p-2 bg-yellow-500/5">
					Extension <span className="font-mono">&quot;{schema.component}&quot;</span> is not registered.
				</div>
			)}
		</FieldShell>
	);
}
