// Schema coverage tests for commsToolListResourceSchema.
//
// Coverage fixture: example/DOWNLOADED/GAMEPLAYDATA.BIN — the retail
// server-pushed 'Gameplay' value payload. Mirrors staticSoundMap.test.ts:
// parse the model and walk it against the schema asserting walkResource
// visits cleanly, no parser/schema field drift in either direction, and
// representative paths resolve with the expected field kinds.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { parseBundle } from '../../core/bundle';
import { extractResourceRaw, resourceCtxFromBundle } from '../../core/registry';
import { parseCommsToolList, type ParsedCommsToolList } from '../../core/commsToolList';

import { commsToolListResourceSchema, nameHashLabel } from './commsToolList';
import { resolveSchemaAtPath, walkResource, formatPath } from '../walk';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const BUNDLE_FIXTURE = path.resolve(REPO_ROOT, 'example/DOWNLOADED/GAMEPLAYDATA.BIN');
const LIST_TYPE_ID = 0x46;

function loadModel(fixturePath: string): ParsedCommsToolList {
	const fileBytes = fs.readFileSync(fixturePath);
	const buffer = new Uint8Array(fileBytes.byteLength);
	buffer.set(fileBytes);
	const bundle = parseBundle(buffer.buffer, { strict: false });
	const ctx = resourceCtxFromBundle(bundle);
	const res = bundle.resources.find((r) => r.resourceTypeId === LIST_TYPE_ID)!;
	return parseCommsToolList(extractResourceRaw(buffer.buffer, bundle, res), ctx.littleEndian);
}

const model = loadModel(BUNDLE_FIXTURE);

describe('commsToolListResourceSchema coverage', () => {
	it('fixture parses with non-trivial content', () => {
		expect(model.data.byteLength).toBeGreaterThan(0);
	});

	it('walkResource visits every parsed field without throwing', () => {
		let recordCount = 0;
		let fieldCount = 0;
		walkResource(commsToolListResourceSchema, model, (_p, _v, field, rec) => {
			if (rec) recordCount++;
			if (field) fieldCount++;
		});
		expect(recordCount).toBeGreaterThan(0);
		expect(fieldCount).toBeGreaterThan(0);
	});

	it('no parsed record has fields absent from the schema', () => {
		const missing: string[] = [];
		walkResource(commsToolListResourceSchema, model, (p, value, _field, rec) => {
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
		walkResource(commsToolListResourceSchema, model, (p, value, _field, rec) => {
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

describe('commsToolList path resolution', () => {
	it('resolves the root', () => {
		const loc = resolveSchemaAtPath(commsToolListResourceSchema, []);
		expect(loc).not.toBeNull();
		expect(loc!.record?.name).toBe('ParsedCommsToolList');
	});

	it('resolves mNameHash as u32', () => {
		const loc = resolveSchemaAtPath(commsToolListResourceSchema, ['mNameHash']);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('u32');
	});

	it('resolves data as the rawBytes custom component', () => {
		const loc = resolveSchemaAtPath(commsToolListResourceSchema, ['data']);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('custom');
	});
});

describe('nameHashLabel', () => {
	it('resolves the fixture name hash to the definition name', () => {
		expect(nameHashLabel(model.mNameHash)).toBe('Gameplay');
	});

	it('falls back to hex for unknown hashes', () => {
		expect(nameHashLabel(0xdeadbeef)).toBe('0xdeadbeef');
	});
});
