// Schema-coverage tests for the V6 prototype AI Sections schema.
//
// Loads `example/older builds/AI v6.DAT` (Burnout 5 2007-02-22 X360 build),
// extracts the V6 AISections resource, parses it via the discriminated union,
// and walks it against `aiSectionsV6ResourceSchema`. Mirrors the V4/V12
// coverage tests — the goal is to catch any schema/data drift the moment a
// field is added to the parser without a matching schema entry, or vice
// versa.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { parseBundle } from '../../../core/bundle';
import { extractResourceRaw, resourceCtxFromBundle } from '../../../core/registry';
import {
	parseAISectionsData,
	type ParsedAISectionsV6,
} from '../../../core/aiSections';

import { aiSectionsV6ResourceSchema } from './v6';
import { walkResource, formatPath } from '../../walk';
import type { FieldSchema } from '../../types';

// ---------------------------------------------------------------------------
// Fixture loader
// ---------------------------------------------------------------------------

const FIXTURE = path.resolve(__dirname, '../../../../../example/older builds/AI v6.DAT');
const AI_SECTIONS_TYPE_ID = 0x10001;

function loadV6Fixture(): { raw: Uint8Array; parsed: ParsedAISectionsV6 } {
	const fileBytes = fs.readFileSync(FIXTURE);
	const buffer = new Uint8Array(fileBytes.byteLength);
	buffer.set(fileBytes);
	const bundle = parseBundle(buffer.buffer);
	const ctx = resourceCtxFromBundle(bundle);
	const resource = bundle.resources.find((r) => r.resourceTypeId === AI_SECTIONS_TYPE_ID);
	if (!resource) throw new Error('example/older builds/AI v6.DAT missing AISections resource');
	const raw = extractResourceRaw(buffer.buffer, bundle, resource);
	const parsed = parseAISectionsData(raw, ctx.littleEndian);
	if (parsed.kind !== 'v6') throw new Error(`Expected v6 fixture, got ${parsed.kind}`);
	return { raw, parsed };
}

const { parsed: parsedV6 } = loadV6Fixture();

// ---------------------------------------------------------------------------
// Schema coverage
// ---------------------------------------------------------------------------

describe('aiSectionsV6ResourceSchema coverage', () => {
	it('fixture parses with the expected V6 section count (3,900 sections)', () => {
		expect(parsedV6.legacy.sections.length).toBe(3900);
	});

	it('captures the on-disk muVersion=4 quirk in legacy.headerVersion', () => {
		// The 2007-02-22 prototype writes `4` to muVersion even though its
		// section layout is V6. The parser preserves that field separately so
		// the writer can echo it back for byte-exact round-trip.
		expect(parsedV6.legacy.headerVersion).toBe(4);
		expect(parsedV6.legacy.version).toBe(6);
	});

	it('root type exists in registry', () => {
		expect(aiSectionsV6ResourceSchema.registry.ParsedAISectionsV6).toBeDefined();
	});

	it('every record type referenced by a `record` or `list<record>` field is registered', () => {
		const missing: string[] = [];
		for (const [recordName, record] of Object.entries(aiSectionsV6ResourceSchema.registry)) {
			for (const [fieldName, field] of Object.entries(record.fields)) {
				const f = field as FieldSchema;
				if (f.kind === 'record') {
					if (!aiSectionsV6ResourceSchema.registry[f.type]) {
						missing.push(`${recordName}.${fieldName} → ${f.type}`);
					}
				} else if (f.kind === 'list' && f.item.kind === 'record') {
					if (!aiSectionsV6ResourceSchema.registry[f.item.type]) {
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
		walkResource(aiSectionsV6ResourceSchema, parsedV6, (_path, _value, field, record) => {
			if (record) recordCount++;
			if (field) fieldCount++;
		});
		expect(recordCount).toBeGreaterThan(0);
		expect(fieldCount).toBeGreaterThan(0);
	});

	it('no parsed record has fields absent from the schema', () => {
		const missing: string[] = [];
		walkResource(aiSectionsV6ResourceSchema, parsedV6, (p, value, _field, record) => {
			if (!record) return;
			if (value == null || typeof value !== 'object') return;
			const declared = new Set(Object.keys(record.fields));
			for (const key of Object.keys(value as Record<string, unknown>)) {
				if (!declared.has(key)) {
					missing.push(`${formatPath(p)}.${key}  (record "${record.name}")`);
				}
			}
		});
		expect(missing).toEqual([]);
	});
});
