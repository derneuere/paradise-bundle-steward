// Schema coverage + round-trip tests for trafficDataResourceSchema.
//
// Loads the B5TRAFFIC fixture, parses it, walks it against the schema, and
// asserts:
//   1. Every field in the parsed model is described by the schema (no
//      unknown fields slipping through).
//   2. Every record type referenced by the schema exists in the registry.
//   3. getAtPath / updateAtPath round-trip through a few representative
//      edits (set, insert, remove) and preserve the rest of the tree.
//   4. Walking then writing produces byte-identical output to the original.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';

import { parseBundle } from '../../core/bundle';
import { RESOURCE_TYPE_IDS } from '../../core/types';
import { extractResourceSize, isCompressed, decompressData } from '../../core/resourceManager';
import {
	parseTrafficDataData,
	writeTrafficDataData,
	type ParsedTrafficData,
} from '../../core/trafficData';

import { trafficDataResourceSchema } from './trafficData';
import {
	getAtPath,
	setAtPath,
	updateAtPath,
	insertListItem,
	removeListItem,
	resolveSchemaAtPath,
	walkResource,
	formatPath,
	type NodePath,
} from '../walk';
import type { FieldSchema, RecordSchema } from '../types';

// ---------------------------------------------------------------------------
// Fixture loader
// ---------------------------------------------------------------------------

const FIXTURE = path.resolve(__dirname, '../../../../example/B5TRAFFIC.BNDL');

function sha1(bytes: Uint8Array): string {
	return createHash('sha1').update(bytes).digest('hex');
}

function loadTrafficDataRaw(): Uint8Array {
	const raw = fs.readFileSync(FIXTURE);
	const bytes = new Uint8Array(raw.byteLength);
	bytes.set(raw);
	const bundle = parseBundle(bytes.buffer);
	const resource = bundle.resources.find((r) => r.resourceTypeId === RESOURCE_TYPE_IDS.TRAFFIC_DATA);
	if (!resource) throw new Error('Fixture missing TrafficData resource');
	for (let bi = 0; bi < 3; bi++) {
		const size = extractResourceSize(resource.sizeAndAlignmentOnDisk[bi]);
		if (size <= 0) continue;
		const base = bundle.header.resourceDataOffsets[bi] >>> 0;
		const rel = resource.diskOffsets[bi] >>> 0;
		const start = (base + rel) >>> 0;
		let slice = new Uint8Array(bytes.buffer.slice(start, start + size));
		if (isCompressed(slice)) slice = decompressData(slice) as Uint8Array;
		return slice;
	}
	throw new Error('Fixture has no non-empty TrafficData payload');
}

const rawTraffic = loadTrafficDataRaw();
const parsedTraffic = parseTrafficDataData(rawTraffic, true);

// ---------------------------------------------------------------------------
// 1. Schema coverage — every parsed field has a schema entry
// ---------------------------------------------------------------------------

describe('trafficDataResourceSchema coverage', () => {
	it('root type exists in registry', () => {
		expect(trafficDataResourceSchema.registry.TrafficData).toBeDefined();
	});

	it('every record type referenced by a `record` or `list<record>` field is registered', () => {
		const missing: string[] = [];
		for (const [recordName, record] of Object.entries(trafficDataResourceSchema.registry)) {
			for (const [fieldName, field] of Object.entries(record.fields)) {
				checkField(field, `${recordName}.${fieldName}`, missing);
			}
		}
		if (missing.length > 0) {
			throw new Error(`Unknown record types referenced:\n  ${missing.join('\n  ')}`);
		}

		function checkField(f: FieldSchema, where: string, out: string[]) {
			if (f.kind === 'record') {
				if (!trafficDataResourceSchema.registry[f.type]) {
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
		walkResource(trafficDataResourceSchema, parsedTraffic, (_path, _value, field, record) => {
			if (record) recordCount++;
			if (field) fieldCount++;
		});
		expect(recordCount).toBeGreaterThan(0);
		expect(fieldCount).toBeGreaterThan(0);
	});

	it('no parsed record has fields absent from the schema', () => {
		// Walk in parallel: for every object the walker visits with a record
		// schema, check that the record's Object.keys() is a superset of the
		// parsed object's own keys. If the parsed data has a key the schema
		// doesn't declare, that's a bug — the writer will crash when round-
		// tripping.
		const missing: string[] = [];
		walkResource(trafficDataResourceSchema, parsedTraffic, (p, value, _field, record) => {
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
			throw new Error(`Schema is missing fields present in parsed data:\n  ${missing.slice(0, 20).join('\n  ')}${missing.length > 20 ? `\n  ... +${missing.length - 20} more` : ''}`);
		}
	});

	it('every record-level field in the schema is represented in the parsed data', () => {
		// Inverse check: the schema shouldn't declare fields that don't exist
		// in the parsed data (typo in the schema, stale field, etc.).
		const missing: string[] = [];
		walkResource(trafficDataResourceSchema, parsedTraffic, (p, value, _field, record) => {
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
			throw new Error(`Schema declares fields missing from parsed data:\n  ${missing.slice(0, 20).join('\n  ')}${missing.length > 20 ? `\n  ... +${missing.length - 20} more` : ''}`);
		}
	});
});

// ---------------------------------------------------------------------------
// 2. Path resolution
// ---------------------------------------------------------------------------

describe('resolveSchemaAtPath', () => {
	it('resolves the root', () => {
		const loc = resolveSchemaAtPath(trafficDataResourceSchema, []);
		expect(loc).not.toBeNull();
		expect(loc!.record?.name).toBe('TrafficData');
	});

	it('resolves a top-level primitive field', () => {
		const loc = resolveSchemaAtPath(trafficDataResourceSchema, ['muDataVersion']);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('u8');
		expect(loc!.parentRecord?.name).toBe('TrafficData');
	});

	it('resolves a nested record', () => {
		const loc = resolveSchemaAtPath(trafficDataResourceSchema, ['pvs']);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('record');
	});

	it('resolves a list item and lands on its record', () => {
		if (parsedTraffic.hulls.length === 0) return;
		const loc = resolveSchemaAtPath(trafficDataResourceSchema, ['hulls', 0]);
		expect(loc).not.toBeNull();
		expect(loc!.record?.name).toBe('TrafficHull');
	});

	it('resolves a deep list-inside-list path', () => {
		const hi = parsedTraffic.hulls.findIndex((h) => h.sectionFlows.length > 0);
		if (hi < 0) return;
		const loc = resolveSchemaAtPath(
			trafficDataResourceSchema,
			['hulls', hi, 'sectionFlows', 0, 'muFlowTypeId'],
		);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('ref');
	});

	it('returns null for an unknown field', () => {
		const loc = resolveSchemaAtPath(trafficDataResourceSchema, ['nonexistent']);
		expect(loc).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// 3. Data get / update round-trips
// ---------------------------------------------------------------------------

describe('getAtPath / updateAtPath', () => {
	it('getAtPath returns the root for empty path', () => {
		expect(getAtPath(parsedTraffic, [])).toBe(parsedTraffic);
	});

	it('getAtPath returns a nested primitive', () => {
		expect(getAtPath(parsedTraffic, ['muDataVersion'])).toBe(parsedTraffic.muDataVersion);
	});

	it('getAtPath returns a nested list item', () => {
		if (parsedTraffic.flowTypes.length === 0) return;
		const first = getAtPath(parsedTraffic, ['flowTypes', 0]);
		expect(first).toBe(parsedTraffic.flowTypes[0]);
	});

	it('setAtPath replaces a primitive and leaves the rest intact', () => {
		const before = parsedTraffic.muDataVersion;
		const next = setAtPath(parsedTraffic, ['muDataVersion'], 99);
		expect(next.muDataVersion).toBe(99);
		// Other top-level fields unchanged by reference (structural sharing)
		expect(next.hulls).toBe(parsedTraffic.hulls);
		expect(next.flowTypes).toBe(parsedTraffic.flowTypes);
		// Original untouched
		expect(parsedTraffic.muDataVersion).toBe(before);
	});

	it('updateAtPath deep-edits a list-of-list item', () => {
		const hi = parsedTraffic.hulls.findIndex((h) => h.sectionFlows.length > 0);
		if (hi < 0) return;
		const next = updateAtPath(
			parsedTraffic,
			['hulls', hi, 'sectionFlows', 0, 'muVehiclesPerMinute'],
			() => 42,
		);
		expect(next.hulls[hi].sectionFlows[0].muVehiclesPerMinute).toBe(42);
		// The un-edited hulls share references
		for (let i = 0; i < parsedTraffic.hulls.length; i++) {
			if (i !== hi) expect(next.hulls[i]).toBe(parsedTraffic.hulls[i]);
		}
		// Original untouched
		expect(parsedTraffic.hulls[hi].sectionFlows[0].muVehiclesPerMinute)
			.not.toBe(42);
	});

	it('insertListItem appends and removeListItem removes', () => {
		if (parsedTraffic.flowTypes.length === 0) return;
		const withExtra = insertListItem(
			parsedTraffic,
			['flowTypes'],
			{ vehicleTypeIds: [], cumulativeProbs: [], muNumVehicleTypes: 0 },
		);
		expect(withExtra.flowTypes.length).toBe(parsedTraffic.flowTypes.length + 1);
		const backOut = removeListItem(withExtra, ['flowTypes'], withExtra.flowTypes.length - 1);
		expect(backOut.flowTypes.length).toBe(parsedTraffic.flowTypes.length);
	});
});

// ---------------------------------------------------------------------------
// 4. Byte-exact round-trip — writer output must match the fixture's sha1
// ---------------------------------------------------------------------------

describe('trafficData byte round-trip', () => {
	it('parse → write reproduces the original bytes', () => {
		const written = writeTrafficDataData(parsedTraffic, true);
		// Writer may pad at the end; match only up to the common length.
		const common = Math.min(written.length, rawTraffic.length);
		expect(written.length).toBe(rawTraffic.length);
		expect(sha1(written)).toBe(sha1(rawTraffic));
		expect(common).toBe(rawTraffic.length);
	});

	it('parse → walk → write is byte-identical (walker must not mutate)', () => {
		// Walk the entire tree (read-only) then write.
		let visitCount = 0;
		walkResource(trafficDataResourceSchema, parsedTraffic, () => { visitCount++; });
		expect(visitCount).toBeGreaterThan(100);
		const written = writeTrafficDataData(parsedTraffic, true);
		expect(sha1(written)).toBe(sha1(rawTraffic));
	});

	// Path-rebasing sanity — make sure list edits through updateAtPath
	// produce a model that still writes cleanly (caller is responsible for
	// keeping count fields in sync; here we verify the walker does NOT break
	// the writer invariants).
	it('updateAtPath on a primitive produces a writable model', () => {
		const next = setAtPath(parsedTraffic, ['paintColours', 0], { x: 0, y: 0, z: 0, w: 0 } as ParsedTrafficData['paintColours'][number]);
		expect(() => writeTrafficDataData(next, true)).not.toThrow();
	});
});

// ---------------------------------------------------------------------------
// 5. Count-field reconciliation — the writer must derive muNum* fields from
//    actual array lengths, so editors can mutate arrays without touching the
//    redundant count fields.
// ---------------------------------------------------------------------------

describe('count-field reconciliation', () => {
	it('removing a hull section without touching muNumSections still writes a valid bundle', () => {
		const hullIdx = parsedTraffic.hulls.findIndex((h) => h.sections.length > 1);
		if (hullIdx < 0) return; // fixture has no suitable hull
		const originalCount = parsedTraffic.hulls[hullIdx].sections.length;

		// Build a modified copy: drop the last section but LEAVE muNumSections
		// stale on purpose. Also drop the parallel sectionFlow so the writer's
		// ordering invariants hold.
		const hulls = parsedTraffic.hulls.slice();
		hulls[hullIdx] = {
			...hulls[hullIdx],
			sections: hulls[hullIdx].sections.slice(0, -1),
			sectionFlows: hulls[hullIdx].sectionFlows.slice(0, -1),
			// muNumSections deliberately NOT updated
		};
		const modified: ParsedTrafficData = { ...parsedTraffic, hulls };

		// The stale count is still present on the model …
		expect(modified.hulls[hullIdx].muNumSections).toBe(originalCount);
		// … but the array is shorter by one.
		expect(modified.hulls[hullIdx].sections.length).toBe(originalCount - 1);

		// Write → parse. The re-parsed bundle should see the NEW length, not
		// the stale count, because the writer derives from length.
		const bytes = writeTrafficDataData(modified, true);
		const roundTripped = parseTrafficDataData(bytes, true);

		expect(roundTripped.hulls[hullIdx].sections.length).toBe(originalCount - 1);
		expect(roundTripped.hulls[hullIdx].muNumSections).toBe(originalCount - 1);
	});

	it('removing a flowType vehicleTypeId without touching muNumVehicleTypes still writes a valid bundle', () => {
		const flowIdx = parsedTraffic.flowTypes.findIndex((f) => f.vehicleTypeIds.length > 1);
		if (flowIdx < 0) return;
		const originalCount = parsedTraffic.flowTypes[flowIdx].vehicleTypeIds.length;

		const flows = parsedTraffic.flowTypes.slice();
		flows[flowIdx] = {
			...flows[flowIdx],
			vehicleTypeIds: flows[flowIdx].vehicleTypeIds.slice(0, -1),
			cumulativeProbs: flows[flowIdx].cumulativeProbs.slice(0, -1),
			// muNumVehicleTypes deliberately NOT updated
		};
		const modified: ParsedTrafficData = { ...parsedTraffic, flowTypes: flows };

		expect(modified.flowTypes[flowIdx].muNumVehicleTypes).toBe(originalCount);
		expect(modified.flowTypes[flowIdx].vehicleTypeIds.length).toBe(originalCount - 1);

		const bytes = writeTrafficDataData(modified, true);
		const roundTripped = parseTrafficDataData(bytes, true);

		expect(roundTripped.flowTypes[flowIdx].vehicleTypeIds.length).toBe(originalCount - 1);
		expect(roundTripped.flowTypes[flowIdx].muNumVehicleTypes).toBe(originalCount - 1);
	});

	it('removing a hull rung without touching muNumRungs still writes a valid bundle', () => {
		const hullIdx = parsedTraffic.hulls.findIndex((h) => h.rungs.length > 1);
		if (hullIdx < 0) return;
		const originalCount = parsedTraffic.hulls[hullIdx].rungs.length;

		const hulls = parsedTraffic.hulls.slice();
		hulls[hullIdx] = {
			...hulls[hullIdx],
			rungs: hulls[hullIdx].rungs.slice(0, -1),
			cumulativeRungLengths: hulls[hullIdx].cumulativeRungLengths.slice(0, -1),
			// muNumRungs deliberately NOT updated
		};
		const modified: ParsedTrafficData = { ...parsedTraffic, hulls };

		expect(modified.hulls[hullIdx].muNumRungs).toBe(originalCount);

		const bytes = writeTrafficDataData(modified, true);
		const roundTripped = parseTrafficDataData(bytes, true);

		expect(roundTripped.hulls[hullIdx].rungs.length).toBe(originalCount - 1);
		expect(roundTripped.hulls[hullIdx].muNumRungs).toBe(originalCount - 1);
	});
});

// ---------------------------------------------------------------------------
// 6. Label callbacks
// ---------------------------------------------------------------------------

describe('schema labels', () => {
	const ctx = {
		root: parsedTraffic,
		resource: trafficDataResourceSchema,
	};

	it('hull label describes contents', () => {
		if (parsedTraffic.hulls.length === 0) return;
		const schema = trafficDataResourceSchema.registry.TrafficHull;
		const label = schema.label?.(parsedTraffic.hulls[0] as unknown as Record<string, unknown>, 0, ctx);
		expect(label).toMatch(/Hull 0/);
		expect(label).toMatch(/sec/);
	});

	it('flow type label references vehicle class', () => {
		if (parsedTraffic.flowTypes.length === 0) return;
		const schema = trafficDataResourceSchema.registry.TrafficFlowType;
		const label = schema.label?.(parsedTraffic.flowTypes[0] as unknown as Record<string, unknown>, 0, ctx);
		expect(label).toMatch(/^#0/);
	});

	it('section flow label names its flow type', () => {
		const hi = parsedTraffic.hulls.findIndex((h) => h.sectionFlows.length > 0);
		if (hi < 0) return;
		const hullSchema = trafficDataResourceSchema.registry.TrafficHull;
		const field = hullSchema.fields.sectionFlows;
		if (field.kind !== 'list') throw new Error('expected list');
		const label = field.itemLabel?.(parsedTraffic.hulls[hi].sectionFlows[0], 0, ctx);
		expect(label).toMatch(/→ FlowType/);
	});
});

// Silence unused-import warnings for types used only in JSDoc-like comments.
void (null as unknown as NodePath);
void (null as unknown as RecordSchema);
