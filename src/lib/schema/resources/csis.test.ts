// Schema coverage tests for csisResourceSchema.
//
// Coverage fixture: example/SOUND/AEMS/CSIS.BUNDLE — all ten retail Csis
// resources. BoostCsis matters most (the only one with functions AND a
// class); the drift checks still walk every resource so an entry shape
// change anywhere gets caught.
//
// Mirrors staticSoundMap.test.ts: parse each model and walk it against the
// schema asserting record references resolve, walkResource visits cleanly,
// no parser/schema field drift in either direction, and representative deep
// paths resolve with the expected field kinds.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { parseBundle } from '../../core/bundle';
import { extractResourceRaw, resourceCtxFromBundle } from '../../core/registry';
import { parseCsis, type ParsedCsis } from '../../core/csis';

import { csisResourceSchema } from './csis';
import { resolveSchemaAtPath, walkResource, formatPath } from '../walk';
import type { FieldSchema } from '../types';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const BUNDLE_FIXTURE = path.resolve(REPO_ROOT, 'example/SOUND/AEMS/CSIS.BUNDLE');
const CSIS_TYPE_ID = 0xa023;

function loadAllModels(fixturePath: string): ParsedCsis[] {
	const fileBytes = fs.readFileSync(fixturePath);
	const buffer = new Uint8Array(fileBytes.byteLength);
	buffer.set(fileBytes);
	const bundle = parseBundle(buffer.buffer, { strict: false });
	const ctx = resourceCtxFromBundle(bundle);
	return bundle.resources
		.filter((r) => r.resourceTypeId === CSIS_TYPE_ID)
		.map((r) => parseCsis(extractResourceRaw(buffer.buffer, bundle, r), ctx.littleEndian));
}

const models = loadAllModels(BUNDLE_FIXTURE);

describe('csisResourceSchema coverage — all ten retail resources', () => {
	it('fixture parses with non-trivial content', () => {
		expect(models.length).toBe(10);
		expect(models.some((m) => m.functions.length > 0)).toBe(true);
		expect(models.every((m) => m.classes.length > 0)).toBe(true);
	});

	it('every record type referenced by a `record` or `list<record>` field is registered', () => {
		const missing: string[] = [];
		for (const [recordName, rec] of Object.entries(csisResourceSchema.registry)) {
			for (const [fieldName, field] of Object.entries(rec.fields)) {
				checkField(field, `${recordName}.${fieldName}`, missing);
			}
		}
		if (missing.length > 0) {
			throw new Error(`Unknown record types referenced:\n  ${missing.join('\n  ')}`);
		}
		function checkField(f: FieldSchema, where: string, out: string[]) {
			if (f.kind === 'record') {
				if (!csisResourceSchema.registry[f.type]) out.push(`${where} -> "${f.type}"`);
				return;
			}
			if (f.kind === 'list') checkField(f.item, `${where}[]`, out);
		}
	});

	it('walkResource visits every parsed field without throwing', () => {
		for (const model of models) {
			let recordCount = 0;
			let fieldCount = 0;
			walkResource(csisResourceSchema, model, (_p, _v, field, rec) => {
				if (rec) recordCount++;
				if (field) fieldCount++;
			});
			expect(recordCount).toBeGreaterThan(0);
			expect(fieldCount).toBeGreaterThan(0);
		}
	});

	it('no parsed record has fields absent from the schema', () => {
		const missing: string[] = [];
		for (const model of models) {
			walkResource(csisResourceSchema, model, (p, value, _field, rec) => {
				if (!rec) return;
				if (value == null || typeof value !== 'object') return;
				const declared = new Set(Object.keys(rec.fields));
				for (const key of Object.keys(value as Record<string, unknown>)) {
					if (!declared.has(key)) {
						missing.push(`${formatPath(p)}.${key}  (record "${rec.name}")`);
					}
				}
			});
		}
		if (missing.length > 0) {
			throw new Error(`Schema is missing fields present in parsed data:\n  ${missing.join('\n  ')}`);
		}
	});

	it('every schema field is represented in the parsed data', () => {
		const missing: string[] = [];
		for (const model of models) {
			walkResource(csisResourceSchema, model, (p, value, _field, rec) => {
				if (!rec) return;
				if (value == null || typeof value !== 'object') return;
				const obj = value as Record<string, unknown>;
				for (const fieldName of Object.keys(rec.fields)) {
					if (!(fieldName in obj)) {
						missing.push(`${formatPath(p)}.${fieldName}  (record "${rec.name}")`);
					}
				}
			});
		}
		if (missing.length > 0) {
			throw new Error(`Schema declares fields missing from parsed data:\n  ${missing.join('\n  ')}`);
		}
	});
});

describe('csis path resolution', () => {
	it('resolves the root', () => {
		const loc = resolveSchemaAtPath(csisResourceSchema, []);
		expect(loc).not.toBeNull();
		expect(loc!.record?.name).toBe('ParsedCsis');
	});

	it('resolves classes[0] as a CsisEntry', () => {
		const loc = resolveSchemaAtPath(csisResourceSchema, ['classes', 0]);
		expect(loc).not.toBeNull();
		expect(loc!.record?.name).toBe('CsisEntry');
	});

	it('resolves classes[0].name as string and .crc as u16', () => {
		expect(resolveSchemaAtPath(csisResourceSchema, ['classes', 0, 'name'])!.field?.kind).toBe('string');
		expect(resolveSchemaAtPath(csisResourceSchema, ['classes', 0, 'crc'])!.field?.kind).toBe('u16');
	});

	it('resolves globalVariables[0] as a CsisGlobalVariable with a curVal u32', () => {
		const loc = resolveSchemaAtPath(csisResourceSchema, ['globalVariables', 0]);
		expect(loc).not.toBeNull();
		expect(loc!.record?.name).toBe('CsisGlobalVariable');
		expect(resolveSchemaAtPath(csisResourceSchema, ['globalVariables', 0, 'curVal'])!.field?.kind).toBe('u32');
	});

	it('resolves platform as an enum', () => {
		const loc = resolveSchemaAtPath(csisResourceSchema, ['platform']);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('enum');
	});
});
