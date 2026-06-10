// Schema coverage tests for massiveLookupTableResourceSchema.
//
// Coverage fixture: example/MASSIVETABLE.BIN — the single retail
// MassiveLookupTable (20 ad placements).
//
// Mirrors staticSoundMap.test.ts: parse the model and walk it against the
// schema asserting record references resolve, walkResource visits cleanly,
// no parser/schema field drift in either direction, and representative deep
// paths resolve with the expected field kinds.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { parseBundle } from '../../core/bundle';
import { extractResourceRaw, resourceCtxFromBundle } from '../../core/registry';
import { parseMassiveLookupTable, type ParsedMassiveLookupTable } from '../../core/massiveLookupTable';

import { massiveLookupTableResourceSchema } from './massiveLookupTable';
import { resolveSchemaAtPath, walkResource, formatPath } from '../walk';
import type { FieldSchema } from '../types';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const BUNDLE_FIXTURE = path.resolve(REPO_ROOT, 'example/MASSIVETABLE.BIN');
const MASSIVE_LOOKUP_TABLE_TYPE_ID = 0x1001a;

function loadModel(fixturePath: string): ParsedMassiveLookupTable {
	const fileBytes = fs.readFileSync(fixturePath);
	const buffer = new Uint8Array(fileBytes.byteLength);
	buffer.set(fileBytes);
	const bundle = parseBundle(buffer.buffer, { strict: false });
	const ctx = resourceCtxFromBundle(bundle);
	const resource = bundle.resources.find((r) => r.resourceTypeId === MASSIVE_LOOKUP_TABLE_TYPE_ID)!;
	return parseMassiveLookupTable(extractResourceRaw(buffer.buffer, bundle, resource), ctx.littleEndian);
}

const model = loadModel(BUNDLE_FIXTURE);

describe('massiveLookupTableResourceSchema coverage', () => {
	it('fixture parses with non-trivial content', () => {
		expect(model.items.length).toBeGreaterThan(0);
	});

	it('every record type referenced by a `record` or `list<record>` field is registered', () => {
		const missing: string[] = [];
		for (const [recordName, rec] of Object.entries(massiveLookupTableResourceSchema.registry)) {
			for (const [fieldName, field] of Object.entries(rec.fields)) {
				checkField(field, `${recordName}.${fieldName}`, missing);
			}
		}
		if (missing.length > 0) {
			throw new Error(`Unknown record types referenced:\n  ${missing.join('\n  ')}`);
		}
		function checkField(f: FieldSchema, where: string, out: string[]) {
			if (f.kind === 'record') {
				if (!massiveLookupTableResourceSchema.registry[f.type]) out.push(`${where} -> "${f.type}"`);
				return;
			}
			if (f.kind === 'list') checkField(f.item, `${where}[]`, out);
		}
	});

	it('walkResource visits every parsed field without throwing', () => {
		let recordCount = 0;
		let fieldCount = 0;
		walkResource(massiveLookupTableResourceSchema, model, (_p, _v, field, rec) => {
			if (rec) recordCount++;
			if (field) fieldCount++;
		});
		expect(recordCount).toBeGreaterThan(0);
		expect(fieldCount).toBeGreaterThan(0);
	});

	it('no parsed record has fields absent from the schema', () => {
		const missing: string[] = [];
		walkResource(massiveLookupTableResourceSchema, model, (p, value, _field, rec) => {
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
		walkResource(massiveLookupTableResourceSchema, model, (p, value, _field, rec) => {
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

describe('massiveLookupTable path resolution', () => {
	it('resolves the root', () => {
		const loc = resolveSchemaAtPath(massiveLookupTableResourceSchema, []);
		expect(loc).not.toBeNull();
		expect(loc!.record?.name).toBe('ParsedMassiveLookupTable');
	});

	it('resolves items[0] as a MassiveLookupTableItem', () => {
		const loc = resolveSchemaAtPath(massiveLookupTableResourceSchema, ['items', 0]);
		expect(loc).not.toBeNull();
		expect(loc!.record?.name).toBe('MassiveLookupTableItem');
	});

	it('resolves items[0].mBoundingBoxMin as vec3', () => {
		const loc = resolveSchemaAtPath(massiveLookupTableResourceSchema, ['items', 0, 'mBoundingBoxMin']);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('vec3');
	});

	it('resolves items[0].mSceneId as a hex bigint', () => {
		const loc = resolveSchemaAtPath(massiveLookupTableResourceSchema, ['items', 0, 'mSceneId']);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('bigint');
	});

	it('resolves items[0].miIEIndex as i32', () => {
		const loc = resolveSchemaAtPath(massiveLookupTableResourceSchema, ['items', 0, 'miIEIndex']);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('i32');
	});
});
