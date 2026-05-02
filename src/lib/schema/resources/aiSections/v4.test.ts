// Schema-coverage tests for the V4 prototype AI Sections schema.
//
// Loads `example/older builds/AI.dat` (Burnout 5 2006-11-13 X360 dev build),
// extracts the V4 AISections resource, parses it via the discriminated union,
// and walks it against `aiSectionsV4ResourceSchema`. Mirrors the V12 coverage
// test (see `../aiSections.test.ts`) — the goal is to catch any schema/data
// drift the moment a field is added to the parser without a matching schema
// entry, or vice versa.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { parseBundle } from '../../../core/bundle';
import { extractResourceRaw, resourceCtxFromBundle } from '../../../core/registry';
import {
	parseAISectionsData,
	type ParsedAISectionsV4,
} from '../../../core/aiSections';

import { aiSectionsV4ResourceSchema } from './v4';
import { walkResource, formatPath } from '../../walk';
import type { FieldSchema, RecordSchema } from '../../types';

// ---------------------------------------------------------------------------
// Fixture loader
// ---------------------------------------------------------------------------

const FIXTURE = path.resolve(__dirname, '../../../../../example/older builds/AI.dat');
const AI_SECTIONS_TYPE_ID = 0x10001;

function loadV4Fixture(): { raw: Uint8Array; parsed: ParsedAISectionsV4 } {
	const fileBytes = fs.readFileSync(FIXTURE);
	const buffer = new Uint8Array(fileBytes.byteLength);
	buffer.set(fileBytes);
	const bundle = parseBundle(buffer.buffer);
	const ctx = resourceCtxFromBundle(bundle);
	const resource = bundle.resources.find((r) => r.resourceTypeId === AI_SECTIONS_TYPE_ID);
	if (!resource) throw new Error('example/older builds/AI.dat missing AISections resource');
	const raw = extractResourceRaw(buffer.buffer, bundle, resource);
	const parsed = parseAISectionsData(raw, ctx.littleEndian);
	if (parsed.kind !== 'v4') throw new Error(`Expected v4 fixture, got ${parsed.kind}`);
	return { raw, parsed };
}

const { parsed: parsedV4 } = loadV4Fixture();

// ---------------------------------------------------------------------------
// Schema coverage
// ---------------------------------------------------------------------------

describe('aiSectionsV4ResourceSchema coverage', () => {
	it('fixture parses with the expected V4 section count (2,442 sections)', () => {
		expect(parsedV4.legacy.sections.length).toBe(2442);
	});

	it('root type exists in registry', () => {
		expect(aiSectionsV4ResourceSchema.registry.ParsedAISectionsV4).toBeDefined();
	});

	it('every record type referenced by a `record` or `list<record>` field is registered', () => {
		const missing: string[] = [];
		for (const [recordName, record] of Object.entries(aiSectionsV4ResourceSchema.registry)) {
			for (const [fieldName, field] of Object.entries(record.fields)) {
				const f = field as FieldSchema;
				if (f.kind === 'record') {
					if (!aiSectionsV4ResourceSchema.registry[f.type]) {
						missing.push(`${recordName}.${fieldName} → ${f.type}`);
					}
				} else if (f.kind === 'list' && f.item.kind === 'record') {
					if (!aiSectionsV4ResourceSchema.registry[f.item.type]) {
						missing.push(`${recordName}.${fieldName} → ${f.item.type}`);
					}
				}
			}
		}
		expect(missing).toEqual([]);
	});

	it('walks every section + portal + boundary line on the fixture without crashing', () => {
		let recordCount = 0;
		let fieldCount = 0;
		walkResource(aiSectionsV4ResourceSchema, parsedV4, (_path, _value, field, record) => {
			if (record) recordCount++;
			if (field) fieldCount++;
		});
		expect(recordCount).toBeGreaterThan(0);
		expect(fieldCount).toBeGreaterThan(0);
	});

	it('no parsed record has fields absent from the schema', () => {
		const missing: string[] = [];
		walkResource(aiSectionsV4ResourceSchema, parsedV4, (p, value, _field, record) => {
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
			throw new Error(
				`V4 schema is missing fields present in parsed data:\n  ${missing.slice(0, 20).join('\n  ')}${
					missing.length > 20 ? `\n  ... +${missing.length - 20} more` : ''
				}`,
			);
		}
	});

	it('every schema field is represented in the parsed data', () => {
		const missing: string[] = [];
		walkResource(aiSectionsV4ResourceSchema, parsedV4, (p, value, _field, record) => {
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
			throw new Error(
				`Parsed V4 model is missing fields declared in the schema:\n  ${missing.slice(0, 20).join('\n  ')}${
					missing.length > 20 ? `\n  ... +${missing.length - 20} more` : ''
				}`,
			);
		}
	});

	it('every section has exactly four corners on each axis (cornersX/Z f32[4])', () => {
		// Sanity-check the V4-specific shape — corners are inline parallel
		// arrays rather than V12's Vector2[4]. The schema declares
		// `fixedList(f32(), 4)` for both, so any drift here would surface
		// as a schema-coverage drift above. This test makes the constraint
		// explicit so a regression in the parser fails here too.
		for (const sec of parsedV4.legacy.sections) {
			expect(sec.cornersX.length).toBe(4);
			expect(sec.cornersZ.length).toBe(4);
		}
	});
});

// ---------------------------------------------------------------------------
// Read-only / freeze contract
// ---------------------------------------------------------------------------

describe('V4 schema is editable-only via freezeSchema (the EditorProfile freezes it)', () => {
	it('the raw V4 schema does NOT carry readOnly metadata on its own', () => {
		// `freezeSchema()` lives at the EditorProfile boundary so the schema
		// definition stays single-sourced (plain, editable on disk). The
		// profile is responsible for freezing — verifying that here would
		// require importing the profile, which drags overlay components
		// into vitest's node env. Spot-check the unfrozen state instead.
		const root = aiSectionsV4ResourceSchema.registry.ParsedAISectionsV4;
		expect(root.fieldMetadata?.legacy?.readOnly).not.toBe(true);
	});
});
