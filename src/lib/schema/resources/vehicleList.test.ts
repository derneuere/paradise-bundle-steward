// Schema coverage + round-trip for vehicleListResourceSchema.
//
// Loads VEHICLELIST.BUNDLE, extracts the VehicleList resource (via the
// shared extractor so the nested-bundle handling stays centralized), and
// asserts:
//   1. Every parsed field is covered by the schema (no drift in either
//      direction).
//   2. resolveSchemaAtPath walks root → vehicles[N].gamePlayData.flags.
//   3. getAtPath / updateAtPath round-trip edits with structural sharing.
//   4. parse → write is byte-identical.
//   5. Tree-label callbacks produce the expected `#N · ID · class` format.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';

import { parseBundle } from '../../core/bundle';
import { extractResourceRaw, resourceCtxFromBundle } from '../../core/registry';
import {
	parseVehicleListData,
	writeVehicleListData,
	type ParsedVehicleList,
	VehicleType,
} from '../../core/vehicleList';

import { vehicleListResourceSchema } from './vehicleList';
import {
	getAtPath,
	resolveSchemaAtPath,
	setAtPath,
	updateAtPath,
	walkResource,
	formatPath,
} from '../walk';

// ---------------------------------------------------------------------------
// Fixture loader
// ---------------------------------------------------------------------------

const FIXTURE = path.resolve(__dirname, '../../../../example/VEHICLELIST.BUNDLE');
const VEHICLE_LIST_TYPE_ID = 0x10005;

function sha1(bytes: Uint8Array): string {
	return createHash('sha1').update(bytes).digest('hex');
}

function loadVehicleListRaw(): { raw: Uint8Array; parsed: ParsedVehicleList } {
	const fileBytes = fs.readFileSync(FIXTURE);
	const buffer = new Uint8Array(fileBytes.byteLength);
	buffer.set(fileBytes);
	const bundle = parseBundle(buffer.buffer);
	const ctx = resourceCtxFromBundle(bundle);
	const resource = bundle.resources.find((r) => r.resourceTypeId === VEHICLE_LIST_TYPE_ID);
	if (!resource) throw new Error('VEHICLELIST.BUNDLE missing VehicleList resource');
	const raw = extractResourceRaw(buffer.buffer, bundle, resource);
	const parsed = parseVehicleListData(raw, { littleEndian: ctx.littleEndian });
	return { raw, parsed };
}

const { raw: rawVehicleList, parsed: parsedVehicleList } = loadVehicleListRaw();

// ---------------------------------------------------------------------------
// 1. Schema coverage
// ---------------------------------------------------------------------------

describe('vehicleListResourceSchema coverage', () => {
	it('fixture has a populated vehicle list', () => {
		expect(parsedVehicleList.vehicles.length).toBeGreaterThan(0);
		expect(parsedVehicleList.header.numVehicles).toBe(parsedVehicleList.vehicles.length);
	});

	it('root type exists in registry', () => {
		expect(vehicleListResourceSchema.registry.VehicleList).toBeDefined();
	});

	it('every record type referenced by a `record` or `list<record>` field is registered', () => {
		const missing: string[] = [];
		for (const [recordName, record] of Object.entries(vehicleListResourceSchema.registry)) {
			for (const [fieldName, field] of Object.entries(record.fields)) {
				checkField(field, `${recordName}.${fieldName}`, missing);
			}
		}
		if (missing.length > 0) {
			throw new Error(`Unknown record types referenced:\n  ${missing.join('\n  ')}`);
		}

		function checkField(f: typeof vehicleListResourceSchema.registry.VehicleList.fields[string], where: string, out: string[]) {
			if (f.kind === 'record') {
				if (!vehicleListResourceSchema.registry[f.type]) {
					out.push(`${where} -> "${f.type}"`);
				}
				return;
			}
			if (f.kind === 'list') {
				checkField(f.item, `${where}[]`, out);
			}
		}
	});

	it('no parsed record has fields absent from the schema', () => {
		const missing: string[] = [];
		walkResource(vehicleListResourceSchema, parsedVehicleList, (p, value, _field, record) => {
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
			throw new Error(`Schema is missing fields present in parsed data:\n  ${missing.slice(0, 10).join('\n  ')}`);
		}
	});

	it('every schema field is represented in the parsed data', () => {
		const missing: string[] = [];
		walkResource(vehicleListResourceSchema, parsedVehicleList, (p, value, _field, record) => {
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
			throw new Error(`Schema declares fields missing from parsed data:\n  ${missing.slice(0, 10).join('\n  ')}`);
		}
	});

	it('walkResource visits a non-trivial number of fields', () => {
		let recordCount = 0;
		let fieldCount = 0;
		walkResource(vehicleListResourceSchema, parsedVehicleList, (_p, _v, field, record) => {
			if (record) recordCount++;
			if (field) fieldCount++;
		});
		// Each vehicle has ~22 leaf fields plus nested records.
		expect(recordCount).toBeGreaterThan(parsedVehicleList.vehicles.length);
		expect(fieldCount).toBeGreaterThan(parsedVehicleList.vehicles.length * 20);
	});
});

// ---------------------------------------------------------------------------
// 2. Path resolution
// ---------------------------------------------------------------------------

describe('resolveSchemaAtPath (vehicleList)', () => {
	it('resolves the root', () => {
		const loc = resolveSchemaAtPath(vehicleListResourceSchema, []);
		expect(loc?.record?.name).toBe('VehicleList');
	});

	it('resolves vehicles[0] as a VehicleListEntry record', () => {
		const loc = resolveSchemaAtPath(vehicleListResourceSchema, ['vehicles', 0]);
		expect(loc?.record?.name).toBe('VehicleListEntry');
	});

	it('resolves vehicles[0].vehicleName as a string', () => {
		const loc = resolveSchemaAtPath(vehicleListResourceSchema, ['vehicles', 0, 'vehicleName']);
		expect(loc?.field?.kind).toBe('string');
	});

	it('resolves the deep list-inside-record path vehicles[0].gamePlayData.flags', () => {
		const loc = resolveSchemaAtPath(
			vehicleListResourceSchema,
			['vehicles', 0, 'gamePlayData', 'flags'],
		);
		expect(loc?.field?.kind).toBe('flags');
	});

	it('resolves vehicles[0].audioData.exhaustName as a bigint', () => {
		const loc = resolveSchemaAtPath(
			vehicleListResourceSchema,
			['vehicles', 0, 'audioData', 'exhaustName'],
		);
		expect(loc?.field?.kind).toBe('bigint');
	});

	it('returns null for an unknown field', () => {
		const loc = resolveSchemaAtPath(vehicleListResourceSchema, ['nonexistent']);
		expect(loc).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// 3. Data get / update round-trips
// ---------------------------------------------------------------------------

describe('getAtPath / updateAtPath (vehicleList)', () => {
	it('getAtPath walks into a nested primitive', () => {
		const name = getAtPath(parsedVehicleList, ['vehicles', 0, 'vehicleName']);
		expect(name).toBe(parsedVehicleList.vehicles[0].vehicleName);
	});

	it('setAtPath replaces a primitive and preserves structural sharing', () => {
		const before = parsedVehicleList.vehicles[0].vehicleName;
		const next = setAtPath(parsedVehicleList, ['vehicles', 0, 'vehicleName'], 'PatchedCar');
		expect(next.vehicles[0].vehicleName).toBe('PatchedCar');
		// Other vehicles untouched by reference.
		for (let i = 1; i < parsedVehicleList.vehicles.length; i++) {
			expect(next.vehicles[i]).toBe(parsedVehicleList.vehicles[i]);
		}
		// Header object reference unchanged (we didn't edit it).
		expect(next.header).toBe(parsedVehicleList.header);
		// Original untouched.
		expect(parsedVehicleList.vehicles[0].vehicleName).toBe(before);
	});

	it('updateAtPath edits a flags field two levels deep', () => {
		const v0 = parsedVehicleList.vehicles[0];
		const before = v0.gamePlayData.flags;
		const next = updateAtPath(
			parsedVehicleList,
			['vehicles', 0, 'gamePlayData', 'flags'],
			() => (before ^ 0x1) >>> 0,
		);
		expect(next.vehicles[0].gamePlayData.flags).toBe((before ^ 0x1) >>> 0);
		// The untouched nested object (audioData) shares its reference.
		expect(next.vehicles[0].audioData).toBe(v0.audioData);
		// Original untouched.
		expect(parsedVehicleList.vehicles[0].gamePlayData.flags).toBe(before);
	});

	it('updateAtPath on a bigint field round-trips', () => {
		const next = updateAtPath(
			parsedVehicleList,
			['vehicles', 0, 'attribCollectionKey'],
			() => 0xDEADBEEFCAFEBABEn,
		);
		expect(next.vehicles[0].attribCollectionKey).toBe(0xDEADBEEFCAFEBABEn);
	});
});

// ---------------------------------------------------------------------------
// 4. Byte-exact round-trip
// ---------------------------------------------------------------------------

describe('vehicleList byte round-trip', () => {
	it('parse → write reproduces the original bytes', () => {
		const written = writeVehicleListData(parsedVehicleList, true);
		expect(written.length).toBe(rawVehicleList.length);
		expect(sha1(written)).toBe(sha1(rawVehicleList));
	});

	it('parse → walk → write is byte-identical (walker must not mutate)', () => {
		let visitCount = 0;
		walkResource(vehicleListResourceSchema, parsedVehicleList, () => {
			visitCount++;
		});
		expect(visitCount).toBeGreaterThan(100);
		const written = writeVehicleListData(parsedVehicleList, true);
		expect(sha1(written)).toBe(sha1(rawVehicleList));
	});

	it('a primitive edit applied via updateAtPath still writes cleanly', () => {
		const next = setAtPath(parsedVehicleList, ['vehicles', 0, 'topSpeedNormal'], 200);
		expect(() => writeVehicleListData(next, true)).not.toThrow();
	});
});

// ---------------------------------------------------------------------------
// 5. Tree label callbacks
// ---------------------------------------------------------------------------

describe('vehicleList schema labels', () => {
	const ctx = { root: parsedVehicleList, resource: vehicleListResourceSchema };

	it('vehicle entry label has the expected "#N · ID · class" shape', () => {
		const schema = vehicleListResourceSchema.registry.VehicleListEntry;
		const label = schema.label?.(
			parsedVehicleList.vehicles[0] as unknown as Record<string, unknown>,
			0,
			ctx,
		);
		expect(label).toMatch(/^#0 · /);
		// Vehicle 0 in the retail fixture should be a Car — but any class label
		// will do. The important bit is the format "#N · <id> · <class>".
		expect(label).toMatch(/ · (Car|Bike|Plane)/);
	});

	it('vehicle entry label tolerates a malformed entry without throwing', () => {
		const schema = vehicleListResourceSchema.registry.VehicleListEntry;
		const label = schema.label?.({} as unknown as Record<string, unknown>, 7, ctx);
		expect(label).toBe('#7');
	});

	it('vehicles list itemLabel matches the record label helper', () => {
		const field = vehicleListResourceSchema.registry.VehicleList.fields.vehicles;
		if (field.kind !== 'list') throw new Error('expected list');
		const label = field.itemLabel?.(parsedVehicleList.vehicles[0], 0, ctx);
		expect(label).toMatch(/^#0 · /);
	});
});

// ---------------------------------------------------------------------------
// 6. Enum sanity — vehicleType is a u8 enum with 3 declared values
// ---------------------------------------------------------------------------

describe('vehicleList enum schema', () => {
	it('vehicleType enum covers CAR/BIKE/PLANE', () => {
		const entrySchema = vehicleListResourceSchema.registry.VehicleListEntry;
		const field = entrySchema.fields.vehicleType;
		if (field.kind !== 'enum') throw new Error('vehicleType should be an enum');
		const values = field.values.map((v) => v.value);
		expect(values).toContain(VehicleType.CAR);
		expect(values).toContain(VehicleType.BIKE);
		expect(values).toContain(VehicleType.PLANE);
	});
});
