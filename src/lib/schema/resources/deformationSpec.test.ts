// Schema coverage for deformationSpecResourceSchema.
//
// The model stores vectors/matrices as plain float arrays, so this asserts
// the schema describes them as fixed-length primitive lists (not the
// `{x,y,z}` structured leaves) and that every record reference resolves —
// the typo class that would silently make a field uneditable.

import { describe, it, expect } from 'vitest';
import { deformationSpecResourceSchema as S } from './deformationSpec';
import { resolveSchemaAtPath } from '../walk';
import type { FieldSchema, ListFieldSchema, RecordFieldSchema } from '../types';

describe('deformationSpecResourceSchema', () => {
	it('has a resolvable root type', () => {
		expect(S.registry[S.rootType]).toBeTruthy();
	});

	it('every record / list<record> reference resolves in the registry', () => {
		const dangling: string[] = [];
		const checkField = (owner: string, name: string, f: FieldSchema) => {
			if (f.kind === 'record') {
				const t = (f as RecordFieldSchema).type;
				if (!S.registry[t]) dangling.push(`${owner}.${name} -> ${t}`);
			} else if (f.kind === 'list') {
				const item = (f as ListFieldSchema).item;
				if (item.kind === 'record' && !S.registry[(item as RecordFieldSchema).type]) {
					dangling.push(`${owner}.${name}[] -> ${(item as RecordFieldSchema).type}`);
				}
			}
		};
		for (const [recName, rec] of Object.entries(S.registry)) {
			for (const [fieldName, field] of Object.entries(rec.fields)) {
				checkField(recName, fieldName, field);
			}
		}
		expect(dangling).toEqual([]);
	});

	it('models Vec4 fields as fixed-length f32 grid lists', () => {
		const loc = resolveSchemaAtPath(S, ['handlingBodyDimensions']);
		expect(loc?.field?.kind).toBe('list');
		const f = loc!.field as ListFieldSchema;
		expect(f.item.kind).toBe('f32');
		expect(f.minLength).toBe(4);
		expect(f.maxLength).toBe(4);
		expect(f.displayAs).toBe('grid');
	});

	it('models Mat4 as a length-4 list of Vec4 lists (nested)', () => {
		const loc = resolveSchemaAtPath(S, ['carModelSpaceToHandlingBodySpace']);
		const f = loc!.field as ListFieldSchema;
		expect(f.kind).toBe('list');
		expect(f.minLength).toBe(4);
		expect(f.item.kind).toBe('list');
		expect((f.item as ListFieldSchema).item.kind).toBe('f32');
	});

	it('resolves representative deep paths into records', () => {
		expect(resolveSchemaAtPath(S, ['wheels', 0, 'iValue'])?.field?.kind).toBe('i32');
		expect(resolveSchemaAtPath(S, ['sensors', 0, 'radius'])?.field?.kind).toBe('f32');
		expect(resolveSchemaAtPath(S, ['tagPoints', 0, 'skinnedPoint'])?.field?.kind).toBe('bool');
		expect(resolveSchemaAtPath(S, ['ikParts', 0, 'jointSpecs', 0, 'jointType'])?.field?.kind).toBe('i32');
		expect(resolveSchemaAtPath(S, ['glassPanes', 0, 'partType'])?.field?.kind).toBe('i32');
		// Nested skin binding under an IK part.
		expect(resolveSchemaAtPath(S, ['ikParts', 0, 'centerSkin', 'vertex'])?.field?.kind).toBe('list');
	});

	it('keeps all lists field-only (no add/remove) to preserve writer-derived counts', () => {
		for (const rec of Object.values(S.registry)) {
			for (const field of Object.values(rec.fields)) {
				if (field.kind === 'list') {
					expect(field.addable ?? false).toBe(false);
					expect(field.removable ?? false).toBe(false);
				}
			}
		}
	});
});
