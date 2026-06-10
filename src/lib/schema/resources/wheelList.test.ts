// Schema coverage tests for wheelListResourceSchema.
//
// Coverage fixture: example/WHEELLIST.BUNDLE (the single B5WheelList
// resource, 172 entries).
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
import { parseWheelList, type ParsedWheelList } from '../../core/wheelList';

import { wheelListResourceSchema } from './wheelList';
import { resolveSchemaAtPath, walkResource, formatPath } from '../walk';
import type { FieldSchema } from '../types';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const BUNDLE_FIXTURE = path.resolve(REPO_ROOT, 'example/WHEELLIST.BUNDLE');
const WHEEL_LIST_TYPE_ID = 0x10009;

function loadModel(fixturePath: string): ParsedWheelList {
	const fileBytes = fs.readFileSync(fixturePath);
	const buffer = new Uint8Array(fileBytes.byteLength);
	buffer.set(fileBytes);
	const bundle = parseBundle(buffer.buffer, { strict: false });
	const ctx = resourceCtxFromBundle(bundle);
	const res = bundle.resources.find((r) => r.resourceTypeId === WHEEL_LIST_TYPE_ID);
	if (!res) throw new Error('No WheelList resource in fixture');
	return parseWheelList(extractResourceRaw(buffer.buffer, bundle, res), ctx.littleEndian);
}

const model = loadModel(BUNDLE_FIXTURE);

describe('wheelListResourceSchema coverage', () => {
	it('fixture parses with non-trivial content', () => {
		expect(model.entries.length).toBeGreaterThan(0);
	});

	it('every record type referenced by a `record` or `list<record>` field is registered', () => {
		const missing: string[] = [];
		for (const [recordName, rec] of Object.entries(wheelListResourceSchema.registry)) {
			for (const [fieldName, field] of Object.entries(rec.fields)) {
				checkField(field, `${recordName}.${fieldName}`, missing);
			}
		}
		if (missing.length > 0) {
			throw new Error(`Unknown record types referenced:\n  ${missing.join('\n  ')}`);
		}
		function checkField(f: FieldSchema, where: string, out: string[]) {
			if (f.kind === 'record') {
				if (!wheelListResourceSchema.registry[f.type]) out.push(`${where} -> "${f.type}"`);
				return;
			}
			if (f.kind === 'list') checkField(f.item, `${where}[]`, out);
		}
	});

	it('walkResource visits every parsed field without throwing', () => {
		let recordCount = 0;
		let fieldCount = 0;
		walkResource(wheelListResourceSchema, model, (_p, _v, field, rec) => {
			if (rec) recordCount++;
			if (field) fieldCount++;
		});
		expect(recordCount).toBeGreaterThan(0);
		expect(fieldCount).toBeGreaterThan(0);
	});

	it('no parsed record has fields absent from the schema', () => {
		const missing: string[] = [];
		walkResource(wheelListResourceSchema, model, (p, value, _field, rec) => {
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
		walkResource(wheelListResourceSchema, model, (p, value, _field, rec) => {
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

describe('wheelList path resolution', () => {
	it('resolves the root', () => {
		const loc = resolveSchemaAtPath(wheelListResourceSchema, []);
		expect(loc).not.toBeNull();
		expect(loc!.record?.name).toBe('ParsedWheelList');
	});

	it('resolves entries[0] as a WheelListEntry', () => {
		const loc = resolveSchemaAtPath(wheelListResourceSchema, ['entries', 0]);
		expect(loc).not.toBeNull();
		expect(loc!.record?.name).toBe('WheelListEntry');
	});

	it('resolves entries[0].mId as a hex bigint', () => {
		const loc = resolveSchemaAtPath(wheelListResourceSchema, ['entries', 0, 'mId']);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('bigint');
	});

	it('resolves entries[0].macWheelName as a string', () => {
		const loc = resolveSchemaAtPath(wheelListResourceSchema, ['entries', 0, 'macWheelName']);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('string');
	});
});

describe('wheelList tree labels', () => {
	it('labels an entry with its name and decoded wheel code', () => {
		const entrySchema = wheelListResourceSchema.registry.WheelListEntry;
		const label = entrySchema.label!(
			model.entries[0] as unknown as Record<string, unknown>,
			0,
			{ root: model, resource: wheelListResourceSchema },
		);
		// decodeCgsId(0x2f9a6e5c310f8000) = "5420650" — the WHE_ bundle code.
		expect(label).toBe('5Spoke_04_20_650 · 5420650');
	});
});
