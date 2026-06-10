// Schema coverage tests for idListResourceSchema.
//
// Coverage fixtures: the first IdList in example/WORLDCOL.BIN (TRK_CLIL109,
// the clean shape) and TRK_CLIL99 (the one resource whose pads carry
// uninitialised garbage) — the same schema must cover both since only the
// hidden verbatim-pad bytes differ.
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
import { parseIdList, type ParsedIdList } from '../../core/idList';

import { idListResourceSchema } from './idList';
import { resolveSchemaAtPath, walkResource, formatPath } from '../walk';
import type { FieldSchema } from '../types';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const BUNDLE_FIXTURE = path.resolve(REPO_ROOT, 'example/WORLDCOL.BIN');
const ID_LIST_TYPE_ID = 0x25;

function loadModels(fixturePath: string): ParsedIdList[] {
	const fileBytes = fs.readFileSync(fixturePath);
	const buffer = new Uint8Array(fileBytes.byteLength);
	buffer.set(fileBytes);
	const bundle = parseBundle(buffer.buffer, { strict: false });
	const ctx = resourceCtxFromBundle(bundle);
	const idLists = bundle.resources.filter((r) => r.resourceTypeId === ID_LIST_TYPE_ID);
	// Index 53 is TRK_CLIL99 — the garbage-pad shape (see core gold test).
	return [idLists[0], idLists[53]].map(
		(r) => parseIdList(extractResourceRaw(buffer.buffer, bundle, r), ctx.littleEndian),
	);
}

const models = loadModels(BUNDLE_FIXTURE);

for (const [label, model] of [
	['clean pads (TRK_CLIL109)', models[0]],
	['garbage pads (TRK_CLIL99)', models[1]],
] as const) {
	describe(`idListResourceSchema coverage — ${label}`, () => {
		it('fixture parses with non-trivial content', () => {
			expect(model.ids.length).toBeGreaterThan(0);
		});

		it('every record type referenced by a `record` or `list<record>` field is registered', () => {
			const missing: string[] = [];
			for (const [recordName, rec] of Object.entries(idListResourceSchema.registry)) {
				for (const [fieldName, field] of Object.entries(rec.fields)) {
					checkField(field, `${recordName}.${fieldName}`, missing);
				}
			}
			if (missing.length > 0) {
				throw new Error(`Unknown record types referenced:\n  ${missing.join('\n  ')}`);
			}
			function checkField(f: FieldSchema, where: string, out: string[]) {
				if (f.kind === 'record') {
					if (!idListResourceSchema.registry[f.type]) out.push(`${where} -> "${f.type}"`);
					return;
				}
				if (f.kind === 'list') checkField(f.item, `${where}[]`, out);
			}
		});

		it('walkResource visits every parsed field without throwing', () => {
			let recordCount = 0;
			let fieldCount = 0;
			walkResource(idListResourceSchema, model, (_p, _v, field, rec) => {
				if (rec) recordCount++;
				if (field) fieldCount++;
			});
			expect(recordCount).toBeGreaterThan(0);
			expect(fieldCount).toBeGreaterThan(0);
		});

		it('no parsed record has fields absent from the schema', () => {
			const missing: string[] = [];
			walkResource(idListResourceSchema, model, (p, value, _field, rec) => {
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
			walkResource(idListResourceSchema, model, (p, value, _field, rec) => {
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

describe('idList path resolution', () => {
	it('resolves the root', () => {
		const loc = resolveSchemaAtPath(idListResourceSchema, []);
		expect(loc).not.toBeNull();
		expect(loc!.record?.name).toBe('ParsedIdList');
	});

	it('resolves ids as an addable/removable list', () => {
		const loc = resolveSchemaAtPath(idListResourceSchema, ['ids']);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('list');
	});

	it('resolves ids[0] as a hex bigint leaf', () => {
		const loc = resolveSchemaAtPath(idListResourceSchema, ['ids', 0]);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('bigint');
		expect(loc!.listIndex).toBe(0);
	});
});

describe('idList tree labels', () => {
	it('labels an id item with its hex value', () => {
		const idsField = idListResourceSchema.registry.ParsedIdList.fields.ids;
		if (idsField.kind !== 'list' || !idsField.itemLabel) throw new Error('ids must be a labeled list');
		const label = idsField.itemLabel(models[0].ids[0], 0, { root: models[0], resource: idListResourceSchema });
		expect(label).toBe('#0 · 0xAC4A6438');
	});
});
