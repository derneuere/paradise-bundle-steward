import { Button } from '@/components/ui/button';
import { ChevronRight, Plus, Trash2 } from 'lucide-react';
import { FieldShell, type FieldRendererProps } from './common';
import type { ListFieldSchema, RecordFieldSchema, SchemaContext } from '@/lib/schema/types';
import { useSchemaEditor } from '../context';

type Props = FieldRendererProps<unknown[]> & {
	schema: ListFieldSchema;
	/** Absolute path to this list in the resource data. */
	path: (string | number)[];
};

// Inspector renderer for a list of records. Shows a scrollable summary with
// per-item "jump" buttons and add/remove affordances. The actual record
// editor is shown by the inspector when the user jumps into an item.
export function ListNavField({ label, value, schema, path, meta }: Props) {
	const { resource, data, selectPath, insertAt, removeAt } = useSchemaEditor();

	if (schema.item.kind !== 'record') {
		return <div className="text-xs text-destructive">ListNavField misused on non-record list</div>;
	}
	const itemType = (schema.item as RecordFieldSchema).type;
	const recordSchema = resource.registry[itemType];
	const items = value ?? [];

	const ctx: SchemaContext = { root: data, resource };

	const fixedLength =
		schema.minLength != null && schema.maxLength != null && schema.minLength === schema.maxLength;
	const canAdd = (schema.addable ?? true) && !fixedLength && !meta?.readOnly;
	const canRemove = (schema.removable ?? true) && !fixedLength && !meta?.readOnly;

	const labelFor = (item: unknown, idx: number) => {
		// Prefer a per-list itemLabel from the parent record, then fall back
		// to the item type's own label(), then to `#idx`.
		if (schema.itemLabel) {
			try {
				return schema.itemLabel(item, idx, ctx);
			} catch {
				// fall through
			}
		}
		if (recordSchema?.label) {
			try {
				return recordSchema.label(item as Record<string, unknown>, idx, ctx);
			} catch {
				// fall through
			}
		}
		return `#${idx}`;
	};

	const addItem = () => {
		// List nav add creates a shallow-empty record by walking the schema.
		// Good enough for most types; callers that need richer defaults
		// should register a custom extension.
		const fresh = makeEmptyRecord(recordSchema, resource);
		insertAt(path, fresh);
	};

	return (
		<FieldShell
			label={`${label} (${items.length})`}
			description={meta?.description}
			warning={meta?.warning}
		>
			<div className="space-y-1 max-h-[50vh] overflow-auto border rounded bg-background/40">
				{items.length === 0 && (
					<div className="text-[11px] text-muted-foreground italic p-3">empty</div>
				)}
				{items.map((item, i) => (
					<div
						key={i}
						className="flex items-center gap-1 px-2 py-1 text-xs border-b border-border/30 hover:bg-muted/40 cursor-pointer"
						onClick={() => selectPath([...path, i])}
					>
						<ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
						<span className="flex-1 truncate">{labelFor(item, i)}</span>
						{canRemove && (
							<Button
								size="sm"
								variant="ghost"
								className="h-6 px-1 text-destructive shrink-0"
								onClick={(e) => {
									e.stopPropagation();
									removeAt(path, i);
								}}
							>
								<Trash2 className="h-3 w-3" />
							</Button>
						)}
					</div>
				))}
			</div>
			{canAdd && (
				<Button size="sm" variant="outline" className="h-7 mt-2" onClick={addItem}>
					<Plus className="h-3 w-3 mr-1" /> Add {itemType}
				</Button>
			)}
		</FieldShell>
	);
}

// ---------------------------------------------------------------------------
// Fresh-record synthesis
// ---------------------------------------------------------------------------

import type { FieldSchema, RecordSchema, ResourceSchema } from '@/lib/schema/types';

// Walks a record's fields and fills each slot with a zero-ish value of the
// right shape. Keeps the writer happy for most Phase 2 record types — any
// type that needs richer defaults (like a TrafficHull with its dozen
// sub-arrays) can be covered by a custom extension in Phase C.
function makeEmptyRecord(record: RecordSchema | undefined, resource: ResourceSchema): Record<string, unknown> {
	if (!record) return {};
	const out: Record<string, unknown> = {};
	for (const [name, field] of Object.entries(record.fields)) {
		out[name] = makeEmptyField(field, resource);
	}
	return out;
}

function makeEmptyField(field: FieldSchema, resource: ResourceSchema): unknown {
	switch (field.kind) {
		case 'u8': case 'u16': case 'u32':
		case 'i8': case 'i16': case 'i32':
		case 'f32':
			return 0;
		case 'bigint':
			return 0n;
		case 'bool':
			return false;
		case 'string':
			return '';
		case 'vec2':
			return { x: 0, y: 0 };
		case 'vec3':
			return { x: 0, y: 0, z: 0 };
		case 'vec4':
			return { x: 0, y: 0, z: 0, w: 0 };
		case 'matrix44': {
			const m = new Array(16).fill(0);
			m[0] = 1; m[5] = 1; m[10] = 1; m[15] = 1;
			return m;
		}
		case 'enum':
			return field.values[0]?.value ?? 0;
		case 'flags':
			return 0;
		case 'ref':
			return field.nullValue ?? 0;
		case 'record':
			return makeEmptyRecord(resource.registry[field.type], resource);
		case 'list': {
			const fixed = field.minLength != null && field.maxLength != null && field.minLength === field.maxLength;
			if (fixed) {
				return new Array(field.minLength).fill(null).map(() => makeEmptyField(field.item, resource));
			}
			return [];
		}
		case 'custom':
			return null;
	}
}
