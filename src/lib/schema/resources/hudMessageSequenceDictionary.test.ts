// Schema coverage tests for hudMessageSequenceDictionaryResourceSchema.
//
// Coverage fixture: example/HUDMESSAGESEQUENCES.HMSC — the single retail
// dictionary listing the six DT* sequences.
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
	parseHudMessageSequenceDictionary,
	type ParsedHudMessageSequenceDictionary,
} from '../../core/hudMessageSequences';

import { hudMessageSequenceDictionaryResourceSchema } from './hudMessageSequenceDictionary';
import { resolveSchemaAtPath, walkResource, formatPath } from '../walk';
import type { FieldSchema } from '../types';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const BUNDLE_FIXTURE = path.resolve(REPO_ROOT, 'example/HUDMESSAGESEQUENCES.HMSC');
const DICTIONARY_TYPE_ID = 0x2f;

function loadModel(fixturePath: string): ParsedHudMessageSequenceDictionary {
	const fileBytes = fs.readFileSync(fixturePath);
	const buffer = new Uint8Array(fileBytes.byteLength);
	buffer.set(fileBytes);
	const bundle = parseBundle(buffer.buffer, { strict: false });
	const ctx = resourceCtxFromBundle(bundle);
	const resource = bundle.resources.find((r) => r.resourceTypeId === DICTIONARY_TYPE_ID);
	if (!resource) throw new Error('No HudMessageSequenceDictionary resource in fixture');
	return parseHudMessageSequenceDictionary(extractResourceRaw(buffer.buffer, bundle, resource), ctx.littleEndian);
}

const model = loadModel(BUNDLE_FIXTURE);

describe('hudMessageSequenceDictionaryResourceSchema coverage', () => {
	it('fixture parses with non-trivial content', () => {
		expect(model.sequenceNames.length).toBeGreaterThan(0);
	});

	it('every record type referenced by a `record` or `list<record>` field is registered', () => {
		const missing: string[] = [];
		for (const [recordName, rec] of Object.entries(hudMessageSequenceDictionaryResourceSchema.registry)) {
			for (const [fieldName, field] of Object.entries(rec.fields)) {
				checkField(field, `${recordName}.${fieldName}`, missing);
			}
		}
		if (missing.length > 0) {
			throw new Error(`Unknown record types referenced:\n  ${missing.join('\n  ')}`);
		}
		function checkField(f: FieldSchema, where: string, out: string[]) {
			if (f.kind === 'record') {
				if (!hudMessageSequenceDictionaryResourceSchema.registry[f.type]) out.push(`${where} -> "${f.type}"`);
				return;
			}
			if (f.kind === 'list') checkField(f.item, `${where}[]`, out);
		}
	});

	it('walkResource visits every parsed field without throwing', () => {
		let recordCount = 0;
		let fieldCount = 0;
		walkResource(hudMessageSequenceDictionaryResourceSchema, model, (_p, _v, field, rec) => {
			if (rec) recordCount++;
			if (field) fieldCount++;
		});
		expect(recordCount).toBeGreaterThan(0);
		expect(fieldCount).toBeGreaterThan(0);
	});

	it('no parsed record has fields absent from the schema', () => {
		const missing: string[] = [];
		walkResource(hudMessageSequenceDictionaryResourceSchema, model, (p, value, _field, rec) => {
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
		walkResource(hudMessageSequenceDictionaryResourceSchema, model, (p, value, _field, rec) => {
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

describe('hudMessageSequenceDictionary path resolution', () => {
	it('resolves the root', () => {
		const loc = resolveSchemaAtPath(hudMessageSequenceDictionaryResourceSchema, []);
		expect(loc).not.toBeNull();
		expect(loc!.record?.name).toBe('ParsedHudMessageSequenceDictionary');
	});

	it('resolves sequenceNames as an addable/removable string list', () => {
		const loc = resolveSchemaAtPath(hudMessageSequenceDictionaryResourceSchema, ['sequenceNames']);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('list');
	});

	it('resolves sequenceNames[0] as string', () => {
		const loc = resolveSchemaAtPath(hudMessageSequenceDictionaryResourceSchema, ['sequenceNames', 0]);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('string');
	});

	it('resolves _pad0C as u32', () => {
		const loc = resolveSchemaAtPath(hudMessageSequenceDictionaryResourceSchema, ['_pad0C']);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('u32');
	});
});
