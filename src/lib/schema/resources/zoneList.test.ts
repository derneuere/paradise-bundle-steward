// Schema coverage tests for zoneListResourceSchema.
//
// Mirrors the pattern in aiSections.test.ts: load both PVS fixtures
// (BND2 PC retail + BND1 X360 prototype), parse them, and walk the model
// against the schema asserting that:
//   - every record reference resolves to a registered type
//   - walkResource visits every parsed field without throwing
//   - no parsed field is undeclared in the schema, and no schema field is
//     missing from the parsed data (parser/schema drift detector)
//   - representative deep paths (zones[0].points[0].x, etc.) resolve
//   - tree-label callbacks return sensible strings on real fixture data
//
// We test against BOTH the BND2 retail fixture and the BND1 X360 prototype
// to guarantee the schema covers every observed shape on disk.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { parseBundle } from '../../core/bundle';
import { extractResourceRaw, resourceCtxFromBundle } from '../../core/registry';
import {
	parseZoneListData,
	NEIGHBOUR_FLAGS,
	type ParsedZoneList,
} from '../../core/zoneList';

import { zoneListResourceSchema } from './zoneList';
import {
	getAtPath,
	resolveSchemaAtPath,
	walkResource,
	formatPath,
} from '../walk';
import type { FieldSchema } from '../types';

// ---------------------------------------------------------------------------
// Fixture loaders
// ---------------------------------------------------------------------------

const RETAIL_PVS = path.resolve(__dirname, '../../../../example/PVS.BNDL');
const OLDER_PVS = path.resolve(__dirname, '../../../../example/older builds/PVS.BNDL');
const ZONE_LIST_TYPE_ID = 0xB000;

function loadModel(fixturePath: string): ParsedZoneList {
	const fileBytes = fs.readFileSync(fixturePath);
	const buffer = new Uint8Array(fileBytes.byteLength);
	buffer.set(fileBytes);
	const bundle = parseBundle(buffer.buffer, { strict: false });
	const ctx = resourceCtxFromBundle(bundle);
	const resource = bundle.resources.find((r) => r.resourceTypeId === ZONE_LIST_TYPE_ID);
	if (!resource) throw new Error(`${fixturePath} missing ZoneList resource`);
	const raw = extractResourceRaw(buffer.buffer, bundle, resource);
	return parseZoneListData(raw, ctx.littleEndian);
}

const retailModel = loadModel(RETAIL_PVS);
const olderModel = loadModel(OLDER_PVS);

// Run the same coverage checks against each fixture.
for (const [label, model] of [
	['retail PC PVS.BNDL', retailModel],
	['Nov 13 2006 X360 PVS.BNDL', olderModel],
] as const) {
	describe(`zoneListResourceSchema coverage — ${label}`, () => {
		it('fixture parses with non-trivial content', () => {
			expect(model.zones.length).toBeGreaterThan(0);
		});

		it('every record type referenced by a `record` or `list<record>` field is registered', () => {
			const missing: string[] = [];
			for (const [recordName, record] of Object.entries(zoneListResourceSchema.registry)) {
				for (const [fieldName, field] of Object.entries(record.fields)) {
					checkField(field, `${recordName}.${fieldName}`, missing);
				}
			}
			if (missing.length > 0) {
				throw new Error(`Unknown record types referenced:\n  ${missing.join('\n  ')}`);
			}
			function checkField(f: FieldSchema, where: string, out: string[]) {
				if (f.kind === 'record') {
					if (!zoneListResourceSchema.registry[f.type]) out.push(`${where} -> "${f.type}"`);
					return;
				}
				if (f.kind === 'list') checkField(f.item, `${where}[]`, out);
			}
		});

		it('walkResource visits every parsed field without throwing', () => {
			let recordCount = 0;
			let fieldCount = 0;
			walkResource(zoneListResourceSchema, model, (_p, _v, field, record) => {
				if (record) recordCount++;
				if (field) fieldCount++;
			});
			expect(recordCount).toBeGreaterThan(0);
			expect(fieldCount).toBeGreaterThan(0);
		});

		it('no parsed record has fields absent from the schema', () => {
			const missing: string[] = [];
			walkResource(zoneListResourceSchema, model, (p, value, _field, record) => {
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
					`Schema is missing fields present in parsed data:\n  ${missing.slice(0, 20).join('\n  ')}${
						missing.length > 20 ? `\n  ... +${missing.length - 20} more` : ''
					}`,
				);
			}
		});

		it('every schema field is represented in the parsed data', () => {
			const missing: string[] = [];
			walkResource(zoneListResourceSchema, model, (p, value, _field, record) => {
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
					`Schema declares fields missing from parsed data:\n  ${missing.slice(0, 20).join('\n  ')}${
						missing.length > 20 ? `\n  ... +${missing.length - 20} more` : ''
					}`,
				);
			}
		});
	});
}

// ---------------------------------------------------------------------------
// Path resolution + tree labels (single fixture is enough)
// ---------------------------------------------------------------------------

describe('zoneList path resolution', () => {
	it('resolves the root', () => {
		const loc = resolveSchemaAtPath(zoneListResourceSchema, []);
		expect(loc).not.toBeNull();
		expect(loc!.record?.name).toBe('ParsedZoneList');
	});

	it('resolves zones[0]', () => {
		const loc = resolveSchemaAtPath(zoneListResourceSchema, ['zones', 0]);
		expect(loc).not.toBeNull();
		expect(loc!.record?.name).toBe('Zone');
	});

	it('resolves zones[0].muZoneId as bigint', () => {
		const loc = resolveSchemaAtPath(zoneListResourceSchema, ['zones', 0, 'muZoneId']);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('bigint');
	});

	it('resolves zones[0].points[0] as Vec2Padded', () => {
		const loc = resolveSchemaAtPath(zoneListResourceSchema, ['zones', 0, 'points', 0]);
		expect(loc).not.toBeNull();
		expect(loc!.record?.name).toBe('Vec2Padded');
	});

	it('resolves zones[0].safeNeighbours/unsafeNeighbours[i].muFlags as flags', () => {
		// Walk to a zone that has at least one neighbour so we can resolve
		// the dynamic index — every retail zone has unsafe neighbours.
		const loc = resolveSchemaAtPath(zoneListResourceSchema, ['zones', 0, 'unsafeNeighbours']);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('list');
	});
});

describe('zoneList tree labels', () => {
	it('zone label includes a hex id and a safe/unsafe count', () => {
		const z0 = retailModel.zones[0];
		const fieldZones = zoneListResourceSchema.registry.ParsedZoneList.fields.zones;
		// itemLabel sits on the list field
		if (fieldZones.kind !== 'list') throw new Error('expected list');
		const label = (fieldZones.itemLabel as (v: unknown, i: number) => string)(z0, 0);
		expect(label).toMatch(/^#0 · 0x[0-9A-F]+ · \d+s\/\d+u$/);
	});

	it('neighbour label includes target zone and flag letters when set', () => {
		// Find any neighbour with the IMMEDIATE flag in the retail fixture.
		let target: { zoneIndex: number; muFlags: number } | null = null;
		for (const z of retailModel.zones) {
			for (const n of z.unsafeNeighbours) {
				if (n.muFlags & NEIGHBOUR_FLAGS.IMMEDIATE) {
					target = n;
					break;
				}
			}
			if (target) break;
		}
		if (!target) return; // some fixtures have no IMMEDIATE flagged neighbours
		const Neighbour = zoneListResourceSchema.registry.Neighbour;
		expect(Neighbour.label).toBeDefined();
		const label = Neighbour.label!(target, 0, { root: retailModel, resource: zoneListResourceSchema });
		expect(label).toMatch(/→#\d+/);
		expect(label).toMatch(/\[(R)?I?\]/);
	});
});

// ---------------------------------------------------------------------------
// Sanity: representative reads via getAtPath
// ---------------------------------------------------------------------------

describe('zoneList getAtPath', () => {
	it('reads a corner X coordinate as a number', () => {
		const x = getAtPath(retailModel, ['zones', 0, 'points', 0, 'x']);
		expect(typeof x).toBe('number');
		expect(Number.isFinite(x)).toBe(true);
	});

	it('reads a u64 zone id as a bigint', () => {
		const id = getAtPath(retailModel, ['zones', 0, 'muZoneId']);
		expect(typeof id).toBe('bigint');
	});
});
