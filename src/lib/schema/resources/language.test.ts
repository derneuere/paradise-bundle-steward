// Schema coverage tests for languageResourceSchema.
//
// Coverage fixture: example/LANGUAGE/0002.BUNDLE (retail English UK — carries
// both padded entries and the trailing filler entry, so the walker sees every
// model shape the parser can produce).
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
import { parseLanguage, type ParsedLanguage } from '../../core/language';

import { languageResourceSchema, formatHash } from './language';
import { resolveSchemaAtPath, walkResource, formatPath } from '../walk';
import type { FieldSchema } from '../types';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const BUNDLE_FIXTURE = path.resolve(REPO_ROOT, 'example/LANGUAGE/0002.BUNDLE');
const LANGUAGE_TYPE_ID = 0x27;

function loadModel(fixturePath: string): ParsedLanguage {
	const fileBytes = fs.readFileSync(fixturePath);
	const buffer = new Uint8Array(fileBytes.byteLength);
	buffer.set(fileBytes);
	const bundle = parseBundle(buffer.buffer, { strict: false });
	const ctx = resourceCtxFromBundle(bundle);
	const resource = bundle.resources.find((r) => r.resourceTypeId === LANGUAGE_TYPE_ID)!;
	return parseLanguage(extractResourceRaw(buffer.buffer, bundle, resource), ctx.littleEndian);
}

const model = loadModel(BUNDLE_FIXTURE);

describe('languageResourceSchema coverage', () => {
	it('fixture parses with non-trivial content', () => {
		expect(model.entries.length).toBeGreaterThan(0);
	});

	it('every record type referenced by a `record` or `list<record>` field is registered', () => {
		const missing: string[] = [];
		for (const [recordName, rec] of Object.entries(languageResourceSchema.registry)) {
			for (const [fieldName, field] of Object.entries(rec.fields)) {
				checkField(field, `${recordName}.${fieldName}`, missing);
			}
		}
		if (missing.length > 0) {
			throw new Error(`Unknown record types referenced:\n  ${missing.join('\n  ')}`);
		}
		function checkField(f: FieldSchema, where: string, out: string[]) {
			if (f.kind === 'record') {
				if (!languageResourceSchema.registry[f.type]) out.push(`${where} -> "${f.type}"`);
				return;
			}
			if (f.kind === 'list') checkField(f.item, `${where}[]`, out);
		}
	});

	it('walkResource visits every parsed field without throwing', () => {
		let recordCount = 0;
		let fieldCount = 0;
		walkResource(languageResourceSchema, model, (_p, _v, field, rec) => {
			if (rec) recordCount++;
			if (field) fieldCount++;
		});
		expect(recordCount).toBeGreaterThan(0);
		expect(fieldCount).toBeGreaterThan(0);
	});

	it('no parsed record has fields absent from the schema', () => {
		const missing: string[] = [];
		walkResource(languageResourceSchema, model, (p, value, _field, rec) => {
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
		walkResource(languageResourceSchema, model, (p, value, _field, rec) => {
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

describe('language path resolution', () => {
	it('resolves the root', () => {
		const loc = resolveSchemaAtPath(languageResourceSchema, []);
		expect(loc).not.toBeNull();
		expect(loc!.record?.name).toBe('ParsedLanguage');
	});

	it('resolves meLanguageID as an enum carrying every ELanguage value', () => {
		const loc = resolveSchemaAtPath(languageResourceSchema, ['meLanguageID']);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('enum');
		if (loc!.field?.kind === 'enum') {
			expect(loc!.field.values.length).toBe(25);
			expect(loc!.field.values.find((v) => v.value === 8)?.label).toBe('English (UK)');
		}
	});

	it('resolves entries[0] as a LanguageEntry', () => {
		const loc = resolveSchemaAtPath(languageResourceSchema, ['entries', 0]);
		expect(loc).not.toBeNull();
		expect(loc!.record?.name).toBe('LanguageEntry');
	});

	it('resolves entries[0].text as an editable string', () => {
		const loc = resolveSchemaAtPath(languageResourceSchema, ['entries', 0, 'text']);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('string');
	});

	it('resolves entries[0].muHash as u32', () => {
		const loc = resolveSchemaAtPath(languageResourceSchema, ['entries', 0, 'muHash']);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('u32');
	});
});

describe('language tree labels', () => {
	const entrySchema = languageResourceSchema.registry.LanguageEntry;
	const ctx = { root: model, resource: languageResourceSchema, path: ['entries', 0] };

	it('shows hash and truncated text', () => {
		const label = entrySchema.label!(
			{ muHash: 0x7e1c1cc8, text: 'No motion blur.', _padAfter: 0 },
			0,
			ctx,
		);
		expect(label).toBe('#0 · 0x7E1C1CC8 · "No motion blur."');
	});

	it('truncates long strings so the tree stays readable', () => {
		const label = entrySchema.label!(
			{ muHash: 0x12345678, text: 'x'.repeat(100), _padAfter: 0 },
			5,
			ctx,
		);
		expect(label.length).toBeLessThan(60);
		expect(label).toContain('…');
	});

	it('labels the retail filler entry instead of dumping 500k A characters', () => {
		const filler = model.entries[model.entries.length - 1];
		const label = entrySchema.label!(filler as unknown as Record<string, unknown>, model.entries.length - 1, ctx);
		expect(label).toContain('filler');
		expect(label.length).toBeLessThan(80);
	});

	it('formatHash pads to 8 hex digits', () => {
		expect(formatHash(0x27)).toBe('0x00000027');
		expect(formatHash(0xf12fd364)).toBe('0xF12FD364');
	});
});
