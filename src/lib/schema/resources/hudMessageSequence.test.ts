// Schema coverage tests for hudMessageSequenceResourceSchema.
//
// Coverage fixture: example/HUDMESSAGESEQUENCES.HMSC, which carries all SIX
// retail sequences — the same schema must cover every one, so the suite
// walks them all (they share one shape, but walking all six is cheap and
// catches per-resource drift for free).
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
import { parseHudMessageSequence, type ParsedHudMessageSequence } from '../../core/hudMessageSequences';
import { encodeCgsId } from '../../core/cgsid';

import { hudMessageSequenceResourceSchema } from './hudMessageSequence';
import { resolveSchemaAtPath, walkResource, formatPath } from '../walk';
import type { FieldSchema } from '../types';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const BUNDLE_FIXTURE = path.resolve(REPO_ROOT, 'example/HUDMESSAGESEQUENCES.HMSC');
const SEQUENCE_TYPE_ID = 0x2e;

function loadAllModels(fixturePath: string): ParsedHudMessageSequence[] {
	const fileBytes = fs.readFileSync(fixturePath);
	const buffer = new Uint8Array(fileBytes.byteLength);
	buffer.set(fileBytes);
	const bundle = parseBundle(buffer.buffer, { strict: false });
	const ctx = resourceCtxFromBundle(bundle);
	return bundle.resources
		.filter((r) => r.resourceTypeId === SEQUENCE_TYPE_ID)
		.map((r) => parseHudMessageSequence(extractResourceRaw(buffer.buffer, bundle, r), ctx.littleEndian));
}

const models = loadAllModels(BUNDLE_FIXTURE);

describe('hudMessageSequence fixture inventory', () => {
	it('loads all six sequences', () => {
		expect(models.length).toBe(6);
	});
});

for (const model of models) {
	describe(`hudMessageSequenceResourceSchema coverage — ${model.macSequenceId}`, () => {
		it('fixture parses with non-trivial content', () => {
			expect(model.messages.length).toBeGreaterThan(0);
			expect(model.macSequenceId.length).toBeGreaterThan(0);
		});

		it('every record type referenced by a `record` or `list<record>` field is registered', () => {
			const missing: string[] = [];
			for (const [recordName, rec] of Object.entries(hudMessageSequenceResourceSchema.registry)) {
				for (const [fieldName, field] of Object.entries(rec.fields)) {
					checkField(field, `${recordName}.${fieldName}`, missing);
				}
			}
			if (missing.length > 0) {
				throw new Error(`Unknown record types referenced:\n  ${missing.join('\n  ')}`);
			}
			function checkField(f: FieldSchema, where: string, out: string[]) {
				if (f.kind === 'record') {
					if (!hudMessageSequenceResourceSchema.registry[f.type]) out.push(`${where} -> "${f.type}"`);
					return;
				}
				if (f.kind === 'list') checkField(f.item, `${where}[]`, out);
			}
		});

		it('walkResource visits every parsed field without throwing', () => {
			let recordCount = 0;
			let fieldCount = 0;
			walkResource(hudMessageSequenceResourceSchema, model, (_p, _v, field, rec) => {
				if (rec) recordCount++;
				if (field) fieldCount++;
			});
			expect(recordCount).toBeGreaterThan(0);
			expect(fieldCount).toBeGreaterThan(0);
		});

		it('no parsed record has fields absent from the schema', () => {
			const missing: string[] = [];
			walkResource(hudMessageSequenceResourceSchema, model, (p, value, _field, rec) => {
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
			walkResource(hudMessageSequenceResourceSchema, model, (p, value, _field, rec) => {
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
}

describe('hudMessageSequence path resolution', () => {
	it('resolves the root', () => {
		const loc = resolveSchemaAtPath(hudMessageSequenceResourceSchema, []);
		expect(loc).not.toBeNull();
		expect(loc!.record?.name).toBe('ParsedHudMessageSequence');
	});

	it('resolves messages[0] as a HudMessageSequenceMessage', () => {
		const loc = resolveSchemaAtPath(hudMessageSequenceResourceSchema, ['messages', 0]);
		expect(loc).not.toBeNull();
		expect(loc!.record?.name).toBe('HudMessageSequenceMessage');
	});

	it('resolves messages[0].mMessageId as bigint', () => {
		const loc = resolveSchemaAtPath(hudMessageSequenceResourceSchema, ['messages', 0, 'mMessageId']);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('bigint');
	});

	it('resolves maeParams[0] as an enum', () => {
		const loc = resolveSchemaAtPath(hudMessageSequenceResourceSchema, ['maeParams', 0]);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('enum');
	});

	it('resolves macSequenceId as string', () => {
		const loc = resolveSchemaAtPath(hudMessageSequenceResourceSchema, ['macSequenceId']);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('string');
	});
});

describe('hudMessageSequence derive hook (name → hash)', () => {
	const root = hudMessageSequenceResourceSchema.registry.ParsedHudMessageSequence;

	it('recomputes the uppercase-folded hash when the name changes', () => {
		const prev = { ...models[0] } as Record<string, unknown>;
		const next = { ...models[0], macSequenceId: 'NewSeq' } as Record<string, unknown>;
		expect(root.derive!(prev, next)).toEqual({ mSequenceIdHash: encodeCgsId('NEWSEQ') });
	});

	it('returns an empty patch when the name is untouched', () => {
		const prev = { ...models[0] } as Record<string, unknown>;
		const next = { ...models[0], miPriority: 2 } as Record<string, unknown>;
		expect(root.derive!(prev, next)).toEqual({});
	});

	it('leaves the hash alone for an over-long name (the writer rejects it later)', () => {
		const prev = { ...models[0] } as Record<string, unknown>;
		const next = { ...models[0], macSequenceId: 'WayTooLongSequenceName' } as Record<string, unknown>;
		expect(root.derive!(prev, next)).toEqual({});
	});
});
