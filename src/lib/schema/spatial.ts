// Spatial transforms over schema-tagged records.
//
// Drives the schema-editor's "drag to translate" gesture (and, eventually,
// scale/rotate). Any field tagged with `spatial` in its `FieldMetadata` —
// see `FieldMetadata.spatial` in ./types — is recognised here and shifted
// by the supplied offset; everything else is passed through unchanged.
//
// The walker is recursive: nested records and lists-of-records are
// descended into so a translate on an outer record cascades into every
// spatially-tagged field below it. This is how a single call on an
// AISection moves its corners + every portal's position + every boundary
// line + every noGo line in one pass — without the AISection schema
// having to author a bespoke translate function.
//
// Cross-resource side effects (e.g., AISection's "if I move section A,
// also move the matching portal on neighbour B") are out of scope. Those
// are best implemented as a per-resource override on top of this generic
// walk; for v1 of the gizmo we accept that connections drift visibly when
// a section is moved.

import type {
	FieldMetadata,
	FieldSchema,
	RecordSchema,
	SchemaRegistry,
} from './types';

// =============================================================================
// Types
// =============================================================================

export type Offset3 = { x: number; y: number; z: number };

// =============================================================================
// Public API
// =============================================================================

/**
 * Translate every spatially-tagged field inside `record` by `offset`.
 * Returns a new object — the input is not mutated.
 *
 * @param record         The record value to translate (e.g., an AISection).
 * @param recordSchema   The schema describing `record`'s fields.
 * @param offset         World-space delta to apply.
 * @param registry       Used to resolve nested record types.
 */
export function translateRecordBySpatial(
	record: Record<string, unknown>,
	recordSchema: RecordSchema,
	offset: Offset3,
	registry: SchemaRegistry,
): Record<string, unknown> {
	const out: Record<string, unknown> = { ...record };
	for (const [name, field] of Object.entries(recordSchema.fields)) {
		const meta = recordSchema.fieldMetadata?.[name];
		const value = record[name];
		out[name] = translateFieldValue(value, field, meta, offset, registry);
	}
	return out;
}

// =============================================================================
// Internals
// =============================================================================

function translateFieldValue(
	value: unknown,
	field: FieldSchema,
	meta: FieldMetadata | undefined,
	offset: Offset3,
	registry: SchemaRegistry,
): unknown {
	if (value == null) return value;

	// Spatial-tagged field: transform the value (or every list item) directly.
	// We intentionally don't recurse further into a spatial field — its shape
	// is by definition a leaf coordinate, even if the field schema is a list.
	if (meta?.spatial) {
		if (field.kind === 'list' && Array.isArray(value)) {
			return value.map((item) => applySpatial(item, meta.spatial!, offset));
		}
		return applySpatial(value, meta.spatial, offset);
	}

	// Untagged record: recurse so any spatial fields inside still get shifted.
	if (field.kind === 'record') {
		const sub = registry[field.type];
		if (sub && typeof value === 'object') {
			return translateRecordBySpatial(value as Record<string, unknown>, sub, offset, registry);
		}
		return value;
	}

	// Untagged list: if items are records, recurse into each; otherwise keep
	// the list as-is.
	if (field.kind === 'list' && Array.isArray(value)) {
		const itemField = field.item;
		if (itemField.kind === 'record') {
			const sub = registry[itemField.type];
			if (!sub) return value;
			return value.map((item) => {
				if (item == null || typeof item !== 'object') return item;
				return translateRecordBySpatial(item as Record<string, unknown>, sub, offset, registry);
			});
		}
		return value;
	}

	return value;
}

function applySpatial(value: unknown, kind: NonNullable<FieldMetadata['spatial']>, offset: Offset3): unknown {
	if (value == null || typeof value !== 'object') return value;
	switch (kind) {
		case 'vec2-xz': {
			const v = value as { x: number; y: number };
			return { ...v, x: v.x + offset.x, y: v.y + offset.z };
		}
		case 'vec3': {
			const v = value as { x: number; y: number; z: number };
			return { ...v, x: v.x + offset.x, y: v.y + offset.y, z: v.z + offset.z };
		}
		case 'segment2d-xz': {
			const v = value as { x: number; y: number; z: number; w: number };
			return {
				...v,
				x: v.x + offset.x,
				y: v.y + offset.z,
				z: v.z + offset.x,
				w: v.w + offset.z,
			};
		}
	}
}
