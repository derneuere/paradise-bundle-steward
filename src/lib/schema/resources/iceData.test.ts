// Schema coverage + path-resolution tests for iceDataResourceSchema (0x1000D).
//
// ICE Data is one standalone camera take. The take record schema is shared with
// the dictionary, so these tests focus on the ICE Data wrapper: that the root
// record covers the model fields, that paths resolve down through the shared
// take record (including the custom channel-editor field at take.runs), and that
// the trailing-bytes field is hidden/read-only.
//
// There is no 0x1000D fixture, so the model under test is built from a take in
// CAMERAS.BUNDLE wrapped as ParsedIceData (with a synthetic `trailing` so the
// coverage walk sees every declared field).

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { parseBundle } from '../../core/bundle';
import { extractResourceRaw } from '../../core/registry';
import {
	parseIceTakeDictionaryStructured,
	isStructuredDictionary,
} from '../../core/iceTakeDictionary';
import type { ParsedIceData } from '../../core/iceData';

import { iceDataResourceSchema } from './iceData';
import {
	getAtPath,
	resolveSchemaAtPath,
	updateAtPath,
	walkResource,
	formatPath,
} from '../walk';
import type { FieldSchema } from '../types';

const FIXTURE = path.resolve(__dirname, '../../../../example/CAMERAS.BUNDLE');
const ICE_TAKE_DICTIONARY_TYPE_ID = 0x41;
const HAS_FIXTURE = fs.existsSync(FIXTURE);
const maybe = HAS_FIXTURE ? it : it.skip;

function loadIceDataModel(): ParsedIceData {
	const fileBytes = fs.readFileSync(FIXTURE);
	const buffer = new Uint8Array(fileBytes.byteLength);
	buffer.set(fileBytes);
	const bundle = parseBundle(buffer.buffer);
	const resource = bundle.resources.find((r) => r.resourceTypeId === ICE_TAKE_DICTIONARY_TYPE_ID);
	if (!resource) throw new Error('CAMERAS.BUNDLE has no IceTakeDictionary resource');
	const raw = extractResourceRaw(buffer.buffer, bundle, resource);
	const model = parseIceTakeDictionaryStructured(raw, true);
	if (!isStructuredDictionary(model)) throw new Error('fixture did not parse to the structured model');
	// Wrap the first take as a standalone ICE Data model. Include a synthetic
	// `trailing` so the "every schema field is represented" walk sees it.
	return { take: model.entries[0].take, trailing: new Uint8Array([0, 0]) };
}

// `runs` is a custom field (no descent) but is a present key on the take.
const CUSTOM_LEAF_KEYS = new Set(['runs']);

const model: ParsedIceData | null = HAS_FIXTURE ? loadIceDataModel() : null;

describe('iceDataResourceSchema coverage', () => {
	maybe('root + take record types exist in registry', () => {
		expect(iceDataResourceSchema.registry.ParsedIceData).toBeDefined();
		expect(iceDataResourceSchema.registry.IceTake).toBeDefined();
		expect(iceDataResourceSchema.registry.IceElementCount).toBeDefined();
	});

	maybe('every record type referenced by a record / list<record> field is registered', () => {
		const missing: string[] = [];
		for (const [recordName, record] of Object.entries(iceDataResourceSchema.registry)) {
			for (const [fieldName, field] of Object.entries(record.fields)) {
				checkField(field, `${recordName}.${fieldName}`, missing);
			}
		}
		if (missing.length > 0) throw new Error(`Unknown record types referenced:\n  ${missing.join('\n  ')}`);

		function checkField(f: FieldSchema, where: string, out: string[]) {
			if (f.kind === 'record') {
				if (!iceDataResourceSchema.registry[f.type]) out.push(`${where} -> "${f.type}"`);
				return;
			}
			if (f.kind === 'list') checkField(f.item, `${where}[]`, out);
		}
	});

	maybe('no parsed record has fields absent from the schema', () => {
		const missing: string[] = [];
		walkResource(iceDataResourceSchema, model, (p, value, _field, record) => {
			if (!record) return;
			if (value == null || typeof value !== 'object') return;
			const declared = new Set(Object.keys(record.fields));
			for (const key of Object.keys(value as Record<string, unknown>)) {
				if (!declared.has(key)) missing.push(`${formatPath(p)}.${key}  (record "${record.name}")`);
			}
		});
		if (missing.length > 0) {
			throw new Error(`Schema is missing fields present in parsed data:\n  ${missing.slice(0, 20).join('\n  ')}`);
		}
	});

	maybe('every schema-declared field is represented in the parsed data', () => {
		const missing: string[] = [];
		walkResource(iceDataResourceSchema, model, (p, value, _field, record) => {
			if (!record) return;
			if (value == null || typeof value !== 'object') return;
			const obj = value as Record<string, unknown>;
			for (const fieldName of Object.keys(record.fields)) {
				if (CUSTOM_LEAF_KEYS.has(fieldName)) {
					expect(fieldName in obj).toBe(true);
					continue;
				}
				if (!(fieldName in obj)) missing.push(`${formatPath(p)}.${fieldName}  (record "${record.name}")`);
			}
		});
		if (missing.length > 0) {
			throw new Error(`Schema declares fields missing from parsed data:\n  ${missing.slice(0, 20).join('\n  ')}`);
		}
	});
});

describe('iceData path resolution', () => {
	it('resolves the root as ParsedIceData', () => {
		expect(resolveSchemaAtPath(iceDataResourceSchema, [])?.record?.name).toBe('ParsedIceData');
	});

	it('resolves take as an IceTake', () => {
		expect(resolveSchemaAtPath(iceDataResourceSchema, ['take'])?.record?.name).toBe('IceTake');
	});

	it('resolves take.name as a string', () => {
		expect(resolveSchemaAtPath(iceDataResourceSchema, ['take', 'name'])?.field?.kind).toBe('string');
	});

	it('resolves the take runs to the custom channel-editor field at take.runs', () => {
		const loc = resolveSchemaAtPath(iceDataResourceSchema, ['take', 'runs']);
		expect(loc?.field?.kind).toBe('custom');
		if (loc?.field?.kind === 'custom') expect(loc.field.component).toBe('iceTakeChannels');
	});

	it('resolves a deep element-count path (take.elementCounts[0].keys)', () => {
		const loc = resolveSchemaAtPath(iceDataResourceSchema, ['take', 'elementCounts', 0, 'keys']);
		expect(loc?.field?.kind).toBe('u32');
	});

	it('marks the trailing-bytes field hidden + read-only', () => {
		const meta = iceDataResourceSchema.registry.ParsedIceData.fieldMetadata?.trailing;
		expect(meta?.hidden).toBe(true);
		expect(meta?.readOnly).toBe(true);
	});

	it('returns null for an unknown field', () => {
		expect(resolveSchemaAtPath(iceDataResourceSchema, ['nope'])).toBeNull();
	});
});

describe('iceData get / update', () => {
	maybe('getAtPath walks into the take name', () => {
		expect(getAtPath(model, ['take', 'name'])).toBe(model!.take.name);
	});

	maybe('updateAtPath edits the take length with structural sharing', () => {
		const next = updateAtPath(model, ['take', 'lengthSeconds'], () => 7.75) as ParsedIceData;
		expect(next.take.lengthSeconds).toBe(7.75);
		// The trailing buffer reference is shared (untouched edit).
		expect(next.trailing).toBe(model!.trailing);
	});
});

describe('iceData label', () => {
	maybe('root label uses the take name and duration', () => {
		const label = iceDataResourceSchema.registry.ParsedIceData.label?.(
			model as unknown as Record<string, unknown>,
			0,
			{ root: model, resource: iceDataResourceSchema },
		);
		expect(label).toMatch(/ · \d+(\.\d+)?s$/);
	});
});
