// Schema coverage tests for iceListResourceSchema.
//
// The ICE List is an early-development type with no example fixture, so the
// model under test is built directly from the parser via a synthetic raw
// buffer (matching src/lib/core/__tests__/iceList.test.ts). The schema must
// have no field drift in either direction against that parsed model, every
// referenced record type must resolve, and representative paths must resolve
// with the expected field kinds.

import { describe, it, expect } from 'vitest';

import { parseIceList, type ParsedIceList } from '../../core/iceList';
import { iceListResourceSchema } from './iceList';
import { resolveSchemaAtPath, walkResource, formatPath } from '../walk';
import type { FieldSchema } from '../types';

const HEADER_SIZE = 0x10;
const ENTRY_STRIDE = 0x8;

function buildIceListBytes(entries: bigint[], muPadding: bigint): Uint8Array {
	const bytes = new Uint8Array(HEADER_SIZE + entries.length * ENTRY_STRIDE);
	const dv = new DataView(bytes.buffer);
	dv.setUint32(0x0, entries.length, true);
	dv.setUint32(0x4, entries.length > 0 ? HEADER_SIZE : 0, true);
	dv.setBigUint64(0x8, muPadding, true);
	for (let i = 0; i < entries.length; i++) {
		dv.setBigUint64(HEADER_SIZE + i * ENTRY_STRIDE, entries[i], true);
	}
	return bytes;
}

const populated: ParsedIceList = parseIceList(
	buildIceListBytes([0xAC4A6438n, 0x1122334455667788n, 0xFFFFFFFFFFFFFFFFn], 0xCAFEF00DBAADD00Dn),
);
const empty: ParsedIceList = parseIceList(buildIceListBytes([], 0n));

for (const [label, model] of [
	['populated list', populated],
	['empty list', empty],
] as const) {
	describe(`iceListResourceSchema coverage — ${label}`, () => {
		it('every record type referenced by a `record` or `list<record>` field is registered', () => {
			const missing: string[] = [];
			for (const [recordName, rec] of Object.entries(iceListResourceSchema.registry)) {
				for (const [fieldName, field] of Object.entries(rec.fields)) {
					checkField(field, `${recordName}.${fieldName}`, missing);
				}
			}
			if (missing.length > 0) {
				throw new Error(`Unknown record types referenced:\n  ${missing.join('\n  ')}`);
			}
			function checkField(f: FieldSchema, where: string, out: string[]) {
				if (f.kind === 'record') {
					if (!iceListResourceSchema.registry[f.type]) out.push(`${where} -> "${f.type}"`);
					return;
				}
				if (f.kind === 'list') checkField(f.item, `${where}[]`, out);
			}
		});

		it('walkResource visits parsed fields without throwing', () => {
			let fieldCount = 0;
			walkResource(iceListResourceSchema, model, (_p, _v, field) => {
				if (field) fieldCount++;
			});
			expect(fieldCount).toBeGreaterThan(0);
		});

		it('no parsed record has fields absent from the schema', () => {
			const missing: string[] = [];
			walkResource(iceListResourceSchema, model, (p, value, _field, rec) => {
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
			walkResource(iceListResourceSchema, model, (p, value, _field, rec) => {
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

describe('iceList path resolution', () => {
	it('resolves the root', () => {
		const loc = resolveSchemaAtPath(iceListResourceSchema, []);
		expect(loc).not.toBeNull();
		expect(loc!.record?.name).toBe('ParsedIceList');
	});

	it('resolves entries as an addable/removable list', () => {
		const loc = resolveSchemaAtPath(iceListResourceSchema, ['entries']);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('list');
		if (loc!.field?.kind === 'list') {
			expect(loc!.field.addable).toBe(true);
			expect(loc!.field.removable).toBe(true);
		}
	});

	it('resolves entries[0] as a hex bigint leaf', () => {
		const loc = resolveSchemaAtPath(iceListResourceSchema, ['entries', 0]);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('bigint');
		expect(loc!.listIndex).toBe(0);
	});

	it('marks muPadding hidden + read-only', () => {
		const rec = iceListResourceSchema.registry.ParsedIceList;
		expect(rec.fieldMetadata?.muPadding?.hidden).toBe(true);
		expect(rec.fieldMetadata?.muPadding?.readOnly).toBe(true);
	});
});

describe('iceList tree labels', () => {
	it('labels a movie-id item with its hex value', () => {
		const field = iceListResourceSchema.registry.ParsedIceList.fields.entries;
		if (field.kind !== 'list' || !field.itemLabel) throw new Error('entries must be a labeled list');
		const out = field.itemLabel(populated.entries[0], 0, { root: populated, resource: iceListResourceSchema });
		expect(out).toBe('#0 · 0x00000000AC4A6438');
	});
});
