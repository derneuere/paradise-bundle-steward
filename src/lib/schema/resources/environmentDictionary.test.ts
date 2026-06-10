// Schema coverage tests for environmentDictionaryResourceSchema.
//
// Coverage fixture: example/ENVIRONMENTSETTINGS/DICTIONARY.BUNDLE — the single
// ENV_DICTIONARY (0x10014) resource, 4 seasons + 1 location.
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
import {
	parseEnvironmentDictionary,
	type ParsedEnvironmentDictionary,
} from '../../core/environmentDictionary';

import { environmentDictionaryResourceSchema } from './environmentDictionary';
import { resolveSchemaAtPath, walkResource, formatPath } from '../walk';
import type { FieldSchema } from '../types';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const BUNDLE_FIXTURE = path.resolve(REPO_ROOT, 'example/ENVIRONMENTSETTINGS/DICTIONARY.BUNDLE');
const ENV_DICTIONARY_TYPE_ID = 0x10014;

function loadModel(fixturePath: string): ParsedEnvironmentDictionary {
	const fileBytes = fs.readFileSync(fixturePath);
	const buffer = new Uint8Array(fileBytes.byteLength);
	buffer.set(fileBytes);
	const bundle = parseBundle(buffer.buffer, { strict: false });
	const ctx = resourceCtxFromBundle(bundle);
	const resource = bundle.resources.find((r) => r.resourceTypeId === ENV_DICTIONARY_TYPE_ID);
	expect(resource).toBeDefined();
	return parseEnvironmentDictionary(extractResourceRaw(buffer.buffer, bundle, resource!), ctx.littleEndian);
}

const model = loadModel(BUNDLE_FIXTURE);

describe('environmentDictionaryResourceSchema coverage', () => {
	it('fixture parses with non-trivial content', () => {
		expect(model.seasons.length).toBeGreaterThan(0);
		expect(model.locations.length).toBeGreaterThan(0);
	});

	it('every record type referenced by a `record` or `list<record>` field is registered', () => {
		const missing: string[] = [];
		for (const [recordName, rec] of Object.entries(environmentDictionaryResourceSchema.registry)) {
			for (const [fieldName, field] of Object.entries(rec.fields)) {
				checkField(field, `${recordName}.${fieldName}`, missing);
			}
		}
		if (missing.length > 0) {
			throw new Error(`Unknown record types referenced:\n  ${missing.join('\n  ')}`);
		}
		function checkField(f: FieldSchema, where: string, out: string[]) {
			if (f.kind === 'record') {
				if (!environmentDictionaryResourceSchema.registry[f.type]) out.push(`${where} -> "${f.type}"`);
				return;
			}
			if (f.kind === 'list') checkField(f.item, `${where}[]`, out);
		}
	});

	it('walkResource visits every parsed field without throwing', () => {
		let recordCount = 0;
		let fieldCount = 0;
		walkResource(environmentDictionaryResourceSchema, model, (_p, _v, field, rec) => {
			if (rec) recordCount++;
			if (field) fieldCount++;
		});
		expect(recordCount).toBeGreaterThan(0);
		expect(fieldCount).toBeGreaterThan(0);
	});

	it('no parsed record has fields absent from the schema', () => {
		const missing: string[] = [];
		walkResource(environmentDictionaryResourceSchema, model, (p, value, _field, rec) => {
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
		walkResource(environmentDictionaryResourceSchema, model, (p, value, _field, rec) => {
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

describe('environmentDictionary path resolution', () => {
	it('resolves the root', () => {
		const loc = resolveSchemaAtPath(environmentDictionaryResourceSchema, []);
		expect(loc).not.toBeNull();
		expect(loc!.record?.name).toBe('ParsedEnvironmentDictionary');
	});

	it('resolves seasons[0] as an EnvironmentDictionarySeason', () => {
		const loc = resolveSchemaAtPath(environmentDictionaryResourceSchema, ['seasons', 0]);
		expect(loc).not.toBeNull();
		expect(loc!.record?.name).toBe('EnvironmentDictionarySeason');
	});

	it('resolves seasons[0].macBundle as a string', () => {
		const loc = resolveSchemaAtPath(environmentDictionaryResourceSchema, ['seasons', 0, 'macBundle']);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('string');
	});

	it('resolves locations[0].macName as a string', () => {
		const loc = resolveSchemaAtPath(environmentDictionaryResourceSchema, ['locations', 0, 'macName']);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('string');
	});
});

describe('environmentDictionary labels and validation', () => {
	const seasonRec = environmentDictionaryResourceSchema.registry.EnvironmentDictionarySeason;
	const locationRec = environmentDictionaryResourceSchema.registry.EnvironmentDictionaryLocation;
	const ctx = { root: model, resource: environmentDictionaryResourceSchema };

	it('season labels strip the redundant ENV_TL_ prefix', () => {
		const label = seasonRec.label!(model.seasons[0] as unknown as Record<string, unknown>, 0, ctx);
		expect(label).toBe('#0 · 000_DLC24hr_SUN_A');
	});

	it('location labels show the name', () => {
		const label = locationRec.label!(model.locations[0] as unknown as Record<string, unknown>, 0, ctx);
		expect(label).toBe('#0 · city');
	});

	it('validate flags a bundle path that overflows its 64-byte field', () => {
		const overlong = { ...model.seasons[0], macBundle: 'x'.repeat(64) };
		const results = seasonRec.validate!(overlong as unknown as Record<string, unknown>, ctx);
		expect(results).toEqual([
			expect.objectContaining({ severity: 'error', field: 'macBundle' }),
		]);
	});

	it('validate passes every retail entry', () => {
		for (const s of model.seasons) {
			expect(seasonRec.validate!(s as unknown as Record<string, unknown>, ctx)).toEqual([]);
		}
		for (const l of model.locations) {
			expect(locationRec.validate!(l as unknown as Record<string, unknown>, ctx)).toEqual([]);
		}
	});
});
