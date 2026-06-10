// Schema coverage tests for commsToolListDefinitionResourceSchema.
//
// Coverage fixture: example/DOWNLOADED/GAMEPLAY.BIN — the retail 'Gameplay'
// definition (205 fields). Mirrors staticSoundMap.test.ts: parse the model
// and walk it against the schema asserting record references resolve,
// walkResource visits cleanly, no parser/schema field drift in either
// direction, and representative deep paths resolve with the expected kinds.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { parseBundle } from '../../core/bundle';
import { extractResourceRaw, resourceCtxFromBundle } from '../../core/registry';
import { parseCommsToolListDefinition, type ParsedCommsToolListDefinition } from '../../core/commsToolListDefinition';

import { commsToolListDefinitionResourceSchema, hashLabel } from './commsToolListDefinition';
import { resolveSchemaAtPath, walkResource, formatPath } from '../walk';
import type { FieldSchema } from '../types';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const BUNDLE_FIXTURE = path.resolve(REPO_ROOT, 'example/DOWNLOADED/GAMEPLAY.BIN');
const DEFINITION_TYPE_ID = 0x45;

function loadModel(fixturePath: string): ParsedCommsToolListDefinition {
	const fileBytes = fs.readFileSync(fixturePath);
	const buffer = new Uint8Array(fileBytes.byteLength);
	buffer.set(fileBytes);
	const bundle = parseBundle(buffer.buffer, { strict: false });
	const ctx = resourceCtxFromBundle(bundle);
	const res = bundle.resources.find((r) => r.resourceTypeId === DEFINITION_TYPE_ID)!;
	return parseCommsToolListDefinition(extractResourceRaw(buffer.buffer, bundle, res), ctx.littleEndian);
}

const model = loadModel(BUNDLE_FIXTURE);

describe('commsToolListDefinitionResourceSchema coverage', () => {
	it('fixture parses with non-trivial content', () => {
		expect(model.fields.length).toBeGreaterThan(0);
	});

	it('every record type referenced by a `record` or `list<record>` field is registered', () => {
		const missing: string[] = [];
		for (const [recordName, rec] of Object.entries(commsToolListDefinitionResourceSchema.registry)) {
			for (const [fieldName, field] of Object.entries(rec.fields)) {
				checkField(field, `${recordName}.${fieldName}`, missing);
			}
		}
		if (missing.length > 0) {
			throw new Error(`Unknown record types referenced:\n  ${missing.join('\n  ')}`);
		}
		function checkField(f: FieldSchema, where: string, out: string[]) {
			if (f.kind === 'record') {
				if (!commsToolListDefinitionResourceSchema.registry[f.type]) out.push(`${where} -> "${f.type}"`);
				return;
			}
			if (f.kind === 'list') checkField(f.item, `${where}[]`, out);
		}
	});

	it('walkResource visits every parsed field without throwing', () => {
		let recordCount = 0;
		let fieldCount = 0;
		walkResource(commsToolListDefinitionResourceSchema, model, (_p, _v, field, rec) => {
			if (rec) recordCount++;
			if (field) fieldCount++;
		});
		expect(recordCount).toBeGreaterThan(0);
		expect(fieldCount).toBeGreaterThan(0);
	});

	it('no parsed record has fields absent from the schema', () => {
		const missing: string[] = [];
		walkResource(commsToolListDefinitionResourceSchema, model, (p, value, _field, rec) => {
			if (!rec) return;
			if (value == null || typeof value !== 'object') return;
			const declared = new Set(Object.keys(rec.fields));
			for (const key of Object.keys(value as Record<string, unknown>)) {
				if (!declared.has(key)) {
					missing.push(`${formatPath(p)}.${key}  (record "${rec.name}")`);
				}
			}
		});
		if (missing.length > 0) {
			throw new Error(`Schema is missing fields present in parsed data:\n  ${missing.join('\n  ')}`);
		}
	});

	it('every schema field is represented in the parsed data', () => {
		const missing: string[] = [];
		walkResource(commsToolListDefinitionResourceSchema, model, (p, value, _field, rec) => {
			if (!rec) return;
			if (value == null || typeof value !== 'object') return;
			const obj = value as Record<string, unknown>;
			for (const fieldName of Object.keys(rec.fields)) {
				if (!(fieldName in obj)) {
					missing.push(`${formatPath(p)}.${fieldName}  (record "${rec.name}")`);
				}
			}
		});
		if (missing.length > 0) {
			throw new Error(`Schema declares fields missing from parsed data:\n  ${missing.join('\n  ')}`);
		}
	});
});

describe('commsToolListDefinition path resolution', () => {
	it('resolves the root', () => {
		const loc = resolveSchemaAtPath(commsToolListDefinitionResourceSchema, []);
		expect(loc).not.toBeNull();
		expect(loc!.record?.name).toBe('ParsedCommsToolListDefinition');
	});

	it('resolves fields[0] as a CommsToolFieldDefinition', () => {
		const loc = resolveSchemaAtPath(commsToolListDefinitionResourceSchema, ['fields', 0]);
		expect(loc).not.toBeNull();
		expect(loc!.record?.name).toBe('CommsToolFieldDefinition');
	});

	it('resolves fields[0].mOffset as u32', () => {
		const loc = resolveSchemaAtPath(commsToolListDefinitionResourceSchema, ['fields', 0, 'mOffset']);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('u32');
	});

	it('resolves mListDataLength as u32', () => {
		const loc = resolveSchemaAtPath(commsToolListDefinitionResourceSchema, ['mListDataLength']);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('u32');
	});
});

describe('hashLabel (known-name resolution)', () => {
	it('resolves wiki-known hashes and falls back to hex for strangers', () => {
		expect(hashLabel(0x0e31492c)).toBe('Gameplay');
		expect(hashLabel(0xdeadbeef)).toBe('0xdeadbeef');
	});

	it('labels the first field with category, name, and offset', () => {
		const label = commsToolListDefinitionResourceSchema.registry.CommsToolFieldDefinition.label!(
			// TODO(types): RecordSchema.label takes Record<string, unknown>; the parsed model is structurally compatible
			model.fields[0] as unknown as Record<string, unknown>,
			0,
			{ root: model, resource: commsToolListDefinitionResourceSchema },
		);
		expect(label).toBe('#0 · ServerControls · TEMP_EXTRA_CAR_36 · +0x0');
	});
});
