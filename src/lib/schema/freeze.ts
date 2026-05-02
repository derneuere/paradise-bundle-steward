// Schema freezing — produce a read-only clone of a `ResourceSchema`.
//
// Editability lives in schema metadata (per the project pet peeve in
// CLAUDE.md): every editor surface reads `readOnly` / `addable` /
// `removable` / `hidden` from the schema, never a parallel cap flag at
// the EditorProfile / handler / page layer. So when the editor wants
// to render a schema in read-only mode (e.g. a V4 prototype payload
// loaded for inspection but not edits), the right knob is to flip those
// metadata flags — not introduce a new "editable" boolean somewhere.
//
// `freezeSchema` walks every record in the registry, every field in
// every record, and produces a deep clone with:
//   - `readOnly: true` on every field's `fieldMetadata`
//   - `addable: false` and `removable: false` on every list field
//
// Records, fields, and metadata in the input are never mutated. The
// returned schema is structurally independent from the source.

import type {
	FieldSchema,
	ListFieldSchema,
	RecordSchema,
	ResourceSchema,
	SchemaRegistry,
} from './types';

function freezeField(field: FieldSchema): FieldSchema {
	if (field.kind === 'list') {
		const list: ListFieldSchema = {
			...field,
			addable: false,
			removable: false,
			item: freezeField(field.item),
		};
		return list;
	}
	return { ...field };
}

function freezeRecord(record: RecordSchema): RecordSchema {
	const fields: Record<string, FieldSchema> = {};
	const fieldMetadata: Record<string, NonNullable<RecordSchema['fieldMetadata']>[string]> = {};

	for (const [name, field] of Object.entries(record.fields)) {
		fields[name] = freezeField(field);
		const sourceMeta = record.fieldMetadata?.[name];
		fieldMetadata[name] = { ...(sourceMeta ?? {}), readOnly: true };
	}

	return {
		...record,
		fields,
		fieldMetadata,
	};
}

/**
 * Walks a `ResourceSchema` and returns a deep-cloned copy with every
 * field marked `readOnly: true` and every list marked
 * `addable: false, removable: false`. The input schema is left untouched.
 *
 * Used by read-only EditorProfiles (e.g. legacy AI-Sections V4/V6 once
 * those land schemas — for the V12-only first slice this helper is wired
 * up but not yet consumed).
 */
export function freezeSchema(schema: ResourceSchema): ResourceSchema {
	const frozenRegistry: SchemaRegistry = {};
	for (const [name, record] of Object.entries(schema.registry)) {
		frozenRegistry[name] = freezeRecord(record);
	}
	return {
		...schema,
		registry: frozenRegistry,
	};
}
