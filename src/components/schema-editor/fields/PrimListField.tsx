import { Button } from '@/components/ui/button';
import { Trash2, Plus } from 'lucide-react';
import { FieldShell, type FieldRendererProps } from './common';
import { FieldRenderer } from './FieldRenderer';
import type { ListFieldSchema } from '@/lib/schema/types';

type Props = FieldRendererProps<unknown[]> & {
	schema: ListFieldSchema;
};

// Inline editable table for a list of primitives / structured primitives.
// Used for things like `cumulativeRungLengths: f32[]`, `mauStateTimings: u16[16]`,
// `paintColours: Vec4[]`, etc.
//
// Lists of records (e.g., `hulls: TrafficHull[]`) never reach this renderer —
// they're handled by ListNavField (summary with "go to" buttons) because the
// item editors are too large to nest inline.
export function PrimListField({ label, value, onChange, meta, schema }: Props) {
	const items = value ?? [];
	const fixedLength =
		schema.minLength != null && schema.maxLength != null && schema.minLength === schema.maxLength;
	const canAdd = (schema.addable ?? true) && !fixedLength && !meta?.readOnly;
	const canRemove = (schema.removable ?? true) && !fixedLength && !meta?.readOnly;

	const updateItem = (idx: number, nextItem: unknown) => {
		const next = items.slice();
		next[idx] = nextItem;
		onChange(next);
	};

	const removeItem = (idx: number) => {
		onChange(items.filter((_, i) => i !== idx));
	};

	const addItem = () => {
		const next = items.slice();
		next.push(defaultFor(schema.item));
		onChange(next);
	};

	return (
		<FieldShell
			label={`${label} (${items.length})`}
			description={meta?.description}
			warning={meta?.warning}
		>
			<div className="space-y-1 max-h-[40vh] overflow-auto border rounded p-2 bg-background/40">
				{items.length === 0 && (
					<div className="text-[11px] text-muted-foreground italic">empty</div>
				)}
				{items.map((item, i) => (
					<div key={i} className="flex items-start gap-2">
						<span className="text-[10px] font-mono text-muted-foreground w-8 pt-2">{i}</span>
						<div className="flex-1 min-w-0">
							<FieldRenderer
								label=""
								field={schema.item}
								value={item}
								onChange={(next) => updateItem(i, next)}
								meta={{ readOnly: meta?.readOnly }}
								hideLabel
							/>
						</div>
						{canRemove && (
							<Button
								size="sm"
								variant="ghost"
								className="h-6 px-1 text-destructive shrink-0"
								onClick={() => removeItem(i)}
							>
								<Trash2 className="h-3 w-3" />
							</Button>
						)}
					</div>
				))}
				{canAdd && (
					<Button size="sm" variant="outline" className="h-7 mt-2" onClick={addItem}>
						<Plus className="h-3 w-3 mr-1" /> Add
					</Button>
				)}
			</div>
		</FieldShell>
	);
}

// Best-effort default for a fresh primitive item. Records flow through
// ListNavField, not this one, so we don't need to handle `kind === 'record'`.
function defaultFor(field: ListFieldSchema['item']): unknown {
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
		case 'list': {
			const len = field.minLength ?? 0;
			return new Array(len).fill(defaultFor(field.item));
		}
		case 'record':
		case 'custom':
			return null;
	}
}
