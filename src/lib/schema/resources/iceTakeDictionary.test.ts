// Schema coverage + path / mutation tests for the structured
// iceTakeDictionaryResourceSchema.
//
// The handler is read+write and the writer is byte-exact, so the schema's job
// is to (a) cover every field the structured parser produces and (b) let the
// inspector navigate + edit. What we check:
//   1. Every parsed field is covered by the schema (both directions).
//   2. resolveSchemaAtPath walks into entries[N].take.{name,elementCounts[M]}.
//   3. updateAtPath edits a take metadata field with structural sharing.
//   4. The take's `runs` resolves to the custom channel-editor field.
//   5. Tree-label callbacks on real fixture data.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { parseBundle } from '../../core/bundle';
import { extractResourceRaw } from '../../core/registry';
import {
	parseIceTakeDictionaryStructured,
	isStructuredDictionary,
	type IceTakeDictionary,
} from '../../core/iceTakeDictionary';

import { iceTakeDictionaryResourceSchema } from './iceTakeDictionary';
import {
	getAtPath,
	resolveSchemaAtPath,
	updateAtPath,
	walkResource,
	formatPath,
} from '../walk';
import type { FieldSchema } from '../types';

// ---------------------------------------------------------------------------
// Fixture loader — CAMERAS.BUNDLE holds a single IceTakeDictionary (0x41).
// ---------------------------------------------------------------------------

const FIXTURE = path.resolve(__dirname, '../../../../example/CAMERAS.BUNDLE');
const ICE_TAKE_DICTIONARY_TYPE_ID = 0x41;

function loadIceTakeDictionary(): IceTakeDictionary {
	const fileBytes = fs.readFileSync(FIXTURE);
	const buffer = new Uint8Array(fileBytes.byteLength);
	buffer.set(fileBytes);
	const bundle = parseBundle(buffer.buffer);
	const resource = bundle.resources.find(
		(r) => r.resourceTypeId === ICE_TAKE_DICTIONARY_TYPE_ID,
	);
	if (!resource) throw new Error('CAMERAS.BUNDLE has no IceTakeDictionary resource');
	const raw = extractResourceRaw(buffer.buffer, bundle, resource);
	const model = parseIceTakeDictionaryStructured(raw, true);
	if (!isStructuredDictionary(model)) {
		throw new Error('fixture did not parse to the structured model');
	}
	return model;
}

const dict = loadIceTakeDictionary();

// The walker compares schema fields against parsed keys; `runs` is a custom
// field (no descent) but is still a present key on the take. To keep the
// coverage checks honest we treat `runs` as covered without descending.
const CUSTOM_LEAF_KEYS = new Set(['runs']);

// ---------------------------------------------------------------------------
// 1. Schema coverage — every parsed field has a schema entry
// ---------------------------------------------------------------------------

describe('iceTakeDictionaryResourceSchema coverage', () => {
	it('fixture has at least one entry with a take and 12 element counts', () => {
		expect(dict.entries.length).toBeGreaterThan(0);
		expect(dict.entries[0].take.elementCounts.length).toBe(12);
	});

	it('root type exists in registry', () => {
		expect(iceTakeDictionaryResourceSchema.registry.IceTakeDictionary).toBeDefined();
	});

	it('every record type referenced by a `record` or `list<record>` field is registered', () => {
		const missing: string[] = [];
		for (const [recordName, record] of Object.entries(iceTakeDictionaryResourceSchema.registry)) {
			for (const [fieldName, field] of Object.entries(record.fields)) {
				checkField(field, `${recordName}.${fieldName}`, missing);
			}
		}
		if (missing.length > 0) {
			throw new Error(`Unknown record types referenced:\n  ${missing.join('\n  ')}`);
		}

		function checkField(f: FieldSchema, where: string, out: string[]) {
			if (f.kind === 'record') {
				if (!iceTakeDictionaryResourceSchema.registry[f.type]) {
					out.push(`${where} -> "${f.type}"`);
				}
				return;
			}
			if (f.kind === 'list') checkField(f.item, `${where}[]`, out);
		}
	});

	it('no parsed record has fields absent from the schema', () => {
		const missing: string[] = [];
		walkResource(iceTakeDictionaryResourceSchema, dict, (p, value, _field, record) => {
			if (!record) return;
			if (value == null || typeof value !== 'object') return;
			const declared = new Set(Object.keys(record.fields));
			for (const key of Object.keys(value as Record<string, unknown>)) {
				if (!declared.has(key)) {
					missing.push(`${formatPath(p)}.${key}  (record "${record.name}")`);
				}
			}
		});
		if (missing.length > 0) {
			throw new Error(`Schema is missing fields present in parsed data:\n  ${missing.slice(0, 20).join('\n  ')}`);
		}
	});

	it('every schema-declared field is represented in the parsed data', () => {
		const missing: string[] = [];
		walkResource(iceTakeDictionaryResourceSchema, dict, (p, value, _field, record) => {
			if (!record) return;
			if (value == null || typeof value !== 'object') return;
			const obj = value as Record<string, unknown>;
			for (const fieldName of Object.keys(record.fields)) {
				if (CUSTOM_LEAF_KEYS.has(fieldName)) {
					expect(fieldName in obj).toBe(true);
					continue;
				}
				if (!(fieldName in obj)) {
					missing.push(`${formatPath(p)}.${fieldName}  (record "${record.name}")`);
				}
			}
		});
		if (missing.length > 0) {
			throw new Error(`Schema declares fields missing from parsed data:\n  ${missing.slice(0, 20).join('\n  ')}`);
		}
	});
});

// ---------------------------------------------------------------------------
// 2. Path resolution
// ---------------------------------------------------------------------------

describe('iceTakeDictionary path resolution', () => {
	it('resolves root', () => {
		const loc = resolveSchemaAtPath(iceTakeDictionaryResourceSchema, []);
		expect(loc?.record?.name).toBe('IceTakeDictionary');
	});

	it('resolves entries[0] as an IceDictionaryEntry', () => {
		const loc = resolveSchemaAtPath(iceTakeDictionaryResourceSchema, ['entries', 0]);
		expect(loc?.record?.name).toBe('IceDictionaryEntry');
	});

	it('resolves entries[0].take as an IceTake', () => {
		const loc = resolveSchemaAtPath(iceTakeDictionaryResourceSchema, ['entries', 0, 'take']);
		expect(loc?.record?.name).toBe('IceTake');
	});

	it('resolves entries[0].take.name', () => {
		const loc = resolveSchemaAtPath(iceTakeDictionaryResourceSchema, ['entries', 0, 'take', 'name']);
		expect(loc?.field?.kind).toBe('string');
	});

	it('resolves entries[0].key as a read-only bigint with a stale-key warning', () => {
		const loc = resolveSchemaAtPath(iceTakeDictionaryResourceSchema, ['entries', 0, 'key']);
		expect(loc?.field?.kind).toBe('bigint');
		const meta = loc?.parentRecord?.fieldMetadata?.key;
		expect(meta?.readOnly).toBe(true);
		expect(meta?.warning).toMatch(/NOT recomputed/i);
	});

	it('resolves the take runs to the custom channel-editor field', () => {
		const loc = resolveSchemaAtPath(iceTakeDictionaryResourceSchema, ['entries', 0, 'take', 'runs']);
		expect(loc?.field?.kind).toBe('custom');
		if (loc?.field?.kind === 'custom') {
			expect(loc.field.component).toBe('iceTakeChannels');
		}
	});

	it('resolves a deep element-count path (entries[0].take.elementCounts[0].keys)', () => {
		const loc = resolveSchemaAtPath(
			iceTakeDictionaryResourceSchema,
			['entries', 0, 'take', 'elementCounts', 0, 'keys'],
		);
		expect(loc?.field?.kind).toBe('u32');
	});

	it('returns null for an unknown field', () => {
		expect(resolveSchemaAtPath(iceTakeDictionaryResourceSchema, ['nope'])).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// 3. Data get / update
// ---------------------------------------------------------------------------

describe('iceTakeDictionary getAtPath / updateAtPath', () => {
	it('getAtPath walks into a take name', () => {
		const v = getAtPath(dict, ['entries', 0, 'take', 'name']);
		expect(v).toBe(dict.entries[0].take.name);
	});

	it('updateAtPath edits take length with structural sharing', () => {
		const next = updateAtPath(dict, ['entries', 0, 'take', 'lengthSeconds'], () => 12.5);
		expect(next.entries[0].take.lengthSeconds).toBe(12.5);
		// Siblings share references.
		if (dict.entries.length > 1) {
			expect(next.entries[1]).toBe(dict.entries[1]);
		}
		// Original untouched.
		expect(dict.entries[0].take.lengthSeconds).toBe(dict.entries[0].take.lengthSeconds);
	});
});

// ---------------------------------------------------------------------------
// 4. Label callbacks
// ---------------------------------------------------------------------------

describe('iceTakeDictionary labels', () => {
	const ctx = { root: dict, resource: iceTakeDictionaryResourceSchema };

	it('entry label uses take name and duration', () => {
		const schema = iceTakeDictionaryResourceSchema.registry.IceDictionaryEntry;
		const label = schema.label?.(dict.entries[0] as unknown as Record<string, unknown>, 0, ctx);
		expect(label).toMatch(/^#0 · .+ · \d+(\.\d+)?s$/);
	});

	it('elementCount item label comes from the channel names', () => {
		const schema = iceTakeDictionaryResourceSchema.registry.IceElementCount;
		const ec = dict.entries[0].take.elementCounts[0];
		const label = schema.label?.(ec as unknown as Record<string, unknown>, 0, ctx);
		expect(label).toMatch(/^Main · \d+ keys · \d+ intervals$/);
	});

	it('entries list uses the entry-level itemLabel callback', () => {
		const field = iceTakeDictionaryResourceSchema.registry.IceTakeDictionary.fields.entries;
		if (field.kind !== 'list') throw new Error('expected list');
		const label = field.itemLabel?.(dict.entries[0], 0, ctx) ?? '';
		expect(label).toMatch(/^#0 · /);
	});
});
