// Schema coverage tests for aemsBankResourceSchema.
//
// Coverage fixtures: GEARWHINEPATCHBANK (the smallest retail bank) and INAIR
// (the only two-module bank, with two interface references) — together they
// exercise every schema field with real values.
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
import { parseAemsBank, type ParsedAemsBank } from '../../core/aemsBank';

import { aemsBankResourceSchema } from './aemsBank';
import { resolveSchemaAtPath, walkResource, formatPath } from '../walk';
import type { FieldSchema } from '../types';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const AEMS_BANK_TYPE_ID = 0xa022;

function loadModel(bundleFile: string): ParsedAemsBank {
	const fileBytes = fs.readFileSync(path.resolve(REPO_ROOT, bundleFile));
	const buffer = new Uint8Array(fileBytes.byteLength);
	buffer.set(fileBytes);
	const bundle = parseBundle(buffer.buffer, { strict: false });
	const ctx = resourceCtxFromBundle(bundle);
	const resource = bundle.resources.find((r) => r.resourceTypeId === AEMS_BANK_TYPE_ID)!;
	return parseAemsBank(extractResourceRaw(buffer.buffer, bundle, resource), ctx.littleEndian);
}

for (const [label, bundleFile] of [
	['GearWhine (single module)', 'example/SOUND/AEMS/GEARWHINEPATCHBANK.BUNDLE'],
	['InAir (two modules, two refs)', 'example/SOUND/AEMS/INAIR.BUNDLE'],
] as const) {
	describe(`aemsBankResourceSchema coverage — ${label}`, () => {
		const model = loadModel(bundleFile);

		it('fixture parses with non-trivial content', () => {
			expect(model.interfaceRefs.length).toBeGreaterThan(0);
			expect(model.funcFixups.length).toBeGreaterThan(0);
			expect(model._sfxBank.byteLength).toBeGreaterThan(0);
		});

		it('every record type referenced by a `record` or `list<record>` field is registered', () => {
			const missing: string[] = [];
			for (const [recordName, rec] of Object.entries(aemsBankResourceSchema.registry)) {
				for (const [fieldName, field] of Object.entries(rec.fields)) {
					checkField(field, `${recordName}.${fieldName}`, missing);
				}
			}
			if (missing.length > 0) {
				throw new Error(`Unknown record types referenced:\n  ${missing.join('\n  ')}`);
			}
			function checkField(f: FieldSchema, where: string, out: string[]) {
				if (f.kind === 'record') {
					if (!aemsBankResourceSchema.registry[f.type]) out.push(`${where} -> "${f.type}"`);
					return;
				}
				if (f.kind === 'list') checkField(f.item, `${where}[]`, out);
			}
		});

		it('walkResource visits every parsed field without throwing', () => {
			let recordCount = 0;
			let fieldCount = 0;
			walkResource(aemsBankResourceSchema, model, (_p, _v, field, rec) => {
				if (rec) recordCount++;
				if (field) fieldCount++;
			});
			expect(recordCount).toBeGreaterThan(0);
			expect(fieldCount).toBeGreaterThan(0);
		});

		it('no parsed record has fields absent from the schema', () => {
			const missing: string[] = [];
			walkResource(aemsBankResourceSchema, model, (p, value, _field, rec) => {
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
			walkResource(aemsBankResourceSchema, model, (p, value, _field, rec) => {
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

describe('aemsBank path resolution', () => {
	it('resolves the root', () => {
		const loc = resolveSchemaAtPath(aemsBankResourceSchema, []);
		expect(loc).not.toBeNull();
		expect(loc!.record?.name).toBe('ParsedAemsBank');
	});

	it('resolves interfaceRefs[0] as an AemsInterfaceReference', () => {
		const loc = resolveSchemaAtPath(aemsBankResourceSchema, ['interfaceRefs', 0]);
		expect(loc).not.toBeNull();
		expect(loc!.record?.name).toBe('AemsInterfaceReference');
	});

	it('resolves interfaceRefs[0] CrcAndKey lanes as u16 and the name as string', () => {
		expect(resolveSchemaAtPath(aemsBankResourceSchema, ['interfaceRefs', 0, 'idCrc'])!.field?.kind).toBe('u16');
		expect(resolveSchemaAtPath(aemsBankResourceSchema, ['interfaceRefs', 0, 'idKey'])!.field?.kind).toBe('u16');
		expect(resolveSchemaAtPath(aemsBankResourceSchema, ['interfaceRefs', 0, 'idName'])!.field?.kind).toBe('string');
	});

	it('resolves funcFixups as a list of u32', () => {
		const loc = resolveSchemaAtPath(aemsBankResourceSchema, ['funcFixups']);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('list');
		expect((loc!.field as { item: FieldSchema }).item.kind).toBe('u32');
	});

	it('resolves targetType as an enum', () => {
		const loc = resolveSchemaAtPath(aemsBankResourceSchema, ['targetType']);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('enum');
	});
});
