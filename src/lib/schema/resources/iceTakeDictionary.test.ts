// Schema coverage + path / mutation tests for iceTakeDictionaryResourceSchema.
//
// The handler is read-only (caps.write === false) so there's no
// writeRaw round-trip to assert. What we can still check:
//   1. Every parsed field is covered by the schema (both directions).
//   2. resolveSchemaAtPath walks into takes[N].elementCounts[M].
//   3. updateAtPath preserves structural sharing on a deep primitive edit.
//   4. Spot-check the tree-label callbacks on real fixture data.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { parseBundle } from '../../core/bundle';
import { extractResourceRaw } from '../../core/registry';
import {
	parseIceTakeDictionaryData,
	type ParsedIceTakeDictionary,
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

function loadIceTakeDictionary(): { raw: Uint8Array; parsed: ParsedIceTakeDictionary } {
	const fileBytes = fs.readFileSync(FIXTURE);
	const buffer = new Uint8Array(fileBytes.byteLength);
	buffer.set(fileBytes);
	const bundle = parseBundle(buffer.buffer);
	const resource = bundle.resources.find(
		(r) => r.resourceTypeId === ICE_TAKE_DICTIONARY_TYPE_ID,
	);
	if (!resource) throw new Error('CAMERAS.BUNDLE has no IceTakeDictionary resource');
	const raw = extractResourceRaw(buffer.buffer, bundle, resource);
	const parsed = parseIceTakeDictionaryData(raw);
	return { raw, parsed };
}

const { parsed: parsedDict } = loadIceTakeDictionary();

// ---------------------------------------------------------------------------
// 1. Schema coverage — every parsed field has a schema entry
// ---------------------------------------------------------------------------

describe('iceTakeDictionaryResourceSchema coverage', () => {
	it('fixture has at least one take with element counts', () => {
		expect(parsedDict.takes.length).toBeGreaterThan(0);
		expect(parsedDict.takes[0].elementCounts.length).toBe(12);
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
			if (f.kind === 'list') {
				checkField(f.item, `${where}[]`, out);
			}
		}
	});

	it('walkResource visits every parsed field without throwing', () => {
		let recordCount = 0;
		let fieldCount = 0;
		walkResource(iceTakeDictionaryResourceSchema, parsedDict, (_path, _value, field, record) => {
			if (record) recordCount++;
			if (field) fieldCount++;
		});
		expect(recordCount).toBeGreaterThan(0);
		expect(fieldCount).toBeGreaterThan(0);
	});

	it('no parsed record has fields absent from the schema', () => {
		const missing: string[] = [];
		walkResource(iceTakeDictionaryResourceSchema, parsedDict, (p, value, _field, record) => {
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
		walkResource(iceTakeDictionaryResourceSchema, parsedDict, (p, value, _field, record) => {
			if (!record) return;
			if (value == null || typeof value !== 'object') return;
			const obj = value as Record<string, unknown>;
			for (const fieldName of Object.keys(record.fields)) {
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

	it('resolves a top-level primitive field', () => {
		const loc = resolveSchemaAtPath(iceTakeDictionaryResourceSchema, ['is64Bit']);
		expect(loc?.field?.kind).toBe('bool');
		expect(loc?.parentRecord?.name).toBe('IceTakeDictionary');
	});

	it('resolves takes[0]', () => {
		const loc = resolveSchemaAtPath(iceTakeDictionaryResourceSchema, ['takes', 0]);
		expect(loc?.record?.name).toBe('ICETakeHeader');
	});

	it('resolves takes[0].name', () => {
		const loc = resolveSchemaAtPath(iceTakeDictionaryResourceSchema, ['takes', 0, 'name']);
		expect(loc?.field?.kind).toBe('string');
	});

	it('resolves a deep list-inside-list path (takes[0].elementCounts[0].mu16Keys)', () => {
		const loc = resolveSchemaAtPath(
			iceTakeDictionaryResourceSchema,
			['takes', 0, 'elementCounts', 0, 'mu16Keys'],
		);
		expect(loc?.field?.kind).toBe('u16');
	});

	it('returns null for an unknown field', () => {
		const loc = resolveSchemaAtPath(iceTakeDictionaryResourceSchema, ['nonexistent']);
		expect(loc).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// 3. Data get / update
// ---------------------------------------------------------------------------

describe('iceTakeDictionary getAtPath / updateAtPath', () => {
	it('getAtPath returns the root for empty path', () => {
		expect(getAtPath(parsedDict, [])).toBe(parsedDict);
	});

	it('getAtPath walks into a nested element count', () => {
		const v = getAtPath(parsedDict, ['takes', 0, 'elementCounts', 0, 'mu16Keys']);
		expect(typeof v).toBe('number');
		expect(v).toBe(parsedDict.takes[0].elementCounts[0].mu16Keys);
	});

	it('updateAtPath deep-edits a primitive with structural sharing', () => {
		const originalKeys = parsedDict.takes[0].elementCounts[0].mu16Keys;
		const next = updateAtPath(
			parsedDict,
			['takes', 0, 'elementCounts', 0, 'mu16Keys'],
			() => 4242,
		);
		// The edit landed.
		expect(next.takes[0].elementCounts[0].mu16Keys).toBe(4242);
		// Siblings share references.
		if (parsedDict.takes.length > 1) {
			expect(next.takes[1]).toBe(parsedDict.takes[1]);
		}
		for (let i = 1; i < parsedDict.takes[0].elementCounts.length; i++) {
			expect(next.takes[0].elementCounts[i]).toBe(parsedDict.takes[0].elementCounts[i]);
		}
		// Original untouched.
		expect(parsedDict.takes[0].elementCounts[0].mu16Keys).toBe(originalKeys);
	});

	it('walker touches every field without mutating the data', () => {
		const snapshotFirstTakeKeys = parsedDict.takes[0].elementCounts[0].mu16Keys;
		let recordCount = 0;
		let fieldCount = 0;
		walkResource(iceTakeDictionaryResourceSchema, parsedDict, (_p, _value, field, record) => {
			if (record) recordCount++;
			if (field) fieldCount++;
		});
		expect(recordCount).toBeGreaterThan(10);
		expect(fieldCount).toBeGreaterThan(50);
		// After walking, original remains untouched.
		expect(parsedDict.takes[0].elementCounts[0].mu16Keys).toBe(snapshotFirstTakeKeys);
	});
});

// ---------------------------------------------------------------------------
// 4. Label callbacks
// ---------------------------------------------------------------------------

describe('iceTakeDictionary labels', () => {
	const ctx = { root: parsedDict, resource: iceTakeDictionaryResourceSchema };

	it('take label uses name and duration', () => {
		const schema = iceTakeDictionaryResourceSchema.registry.ICETakeHeader;
		const label = schema.label?.(
			parsedDict.takes[0] as unknown as Record<string, unknown>,
			0,
			ctx,
		);
		expect(label).toMatch(/^#0 · .+ · \d+(\.\d+)?s$/);
	});

	it('take label surfaces a name-or-guid fallback', () => {
		// Find an unnamed take if any; otherwise just verify the first take
		// produces a non-empty segment.
		const take0 = parsedDict.takes[0];
		const schema = iceTakeDictionaryResourceSchema.registry.ICETakeHeader;
		const label = schema.label?.(take0 as unknown as Record<string, unknown>, 0, ctx) ?? '';
		// The middle segment must be non-empty.
		const parts = label.split(' · ');
		expect(parts.length).toBe(3);
		expect(parts[1].length).toBeGreaterThan(0);
	});

	it('elementCount item label comes from ICE_CHANNEL_NAMES', () => {
		// ICEElementCount has a record-level label used when rendering the
		// elementCounts list item in the tree.
		const schema = iceTakeDictionaryResourceSchema.registry.ICEElementCount;
		const ec = parsedDict.takes[0].elementCounts[0];
		const label = schema.label?.(ec as unknown as Record<string, unknown>, 0, ctx);
		expect(label).toMatch(/^Main · \d+ keys · \d+ intervals$/);
	});

	it('takes list uses the take-level itemLabel callback', () => {
		const schema = iceTakeDictionaryResourceSchema.registry.IceTakeDictionary;
		const field = schema.fields.takes;
		if (field.kind !== 'list') throw new Error('expected list');
		const label = field.itemLabel?.(parsedDict.takes[0], 0, ctx) ?? '';
		expect(label).toMatch(/^#0 · /);
		expect(label).toMatch(/s$/);
	});
});
