// Schema coverage + round-trip tests for triggerDataResourceSchema.
//
// Loads example/TRIGGERS.DAT, parses it, walks it against the schema, and
// asserts:
//   1. Every parsed field has a schema entry (no unknown keys).
//   2. Every record type referenced by a record/list<record> field is
//      registered.
//   3. resolveSchemaAtPath resolves primitives, records, and deep
//      list-inside-list paths.
//   4. getAtPath / updateAtPath round-trip a primitive edit with
//      structural sharing.
//   5. The fixture parse → write cycle is byte-identical (sha1 match),
//      which covers the round-trip expectation the handler already
//      declares via fixtures/stressScenarios.
//   6. Label callbacks produce the expected shape for fixture data.
//   7. The drive-thru validator fires the expected severity when the
//      count exceeds the documented buffer reservations.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';

import { parseBundle } from '../../core/bundle';
import { extractResourceRaw, resourceCtxFromBundle } from '../../core/registry';
import {
	parseTriggerDataData,
	writeTriggerDataData,
	type ParsedTriggerData,
} from '../../core/triggerData';

import { triggerDataResourceSchema } from './triggerData';
import {
	getAtPath,
	setAtPath,
	updateAtPath,
	insertListItem,
	removeListItem,
	resolveSchemaAtPath,
	walkResource,
	formatPath,
} from '../walk';
import type { FieldSchema, RecordSchema } from '../types';

// ---------------------------------------------------------------------------
// Fixture loader
// ---------------------------------------------------------------------------

const TRIGGER_DATA_TYPE_ID = 0x10003;
const FIXTURE = path.resolve(__dirname, '../../../../example/TRIGGERS.DAT');

function sha1(bytes: Uint8Array): string {
	return createHash('sha1').update(bytes).digest('hex');
}

function loadTriggerDataRaw(): Uint8Array {
	const fileBytes = fs.readFileSync(FIXTURE);
	const buffer = new Uint8Array(fileBytes.byteLength);
	buffer.set(fileBytes);
	const bundle = parseBundle(buffer.buffer);
	const ctx = resourceCtxFromBundle(bundle);
	const resource = bundle.resources.find((r) => r.resourceTypeId === TRIGGER_DATA_TYPE_ID);
	if (!resource) throw new Error('Fixture missing TriggerData resource');
	const raw = extractResourceRaw(buffer.buffer, bundle, resource);
	return raw instanceof Uint8Array ? raw : new Uint8Array(raw);
	// Silence unused `ctx` — kept around in case future tests need the ResourceCtx.
	void ctx;
}

const rawTrigger = loadTriggerDataRaw();
const parsedTrigger = parseTriggerDataData(rawTrigger, true);

// ---------------------------------------------------------------------------
// 1. Schema coverage — every parsed field has a schema entry
// ---------------------------------------------------------------------------

describe('triggerDataResourceSchema coverage', () => {
	it('fixture has representative data in every list', () => {
		// Sanity check that the fixture is usable. If any of these are
		// empty the coverage test becomes weaker (we can't walk records
		// that don't exist in the parsed data), so flag it up front.
		expect(parsedTrigger.landmarks.length).toBeGreaterThan(0);
		expect(parsedTrigger.genericRegions.length).toBeGreaterThan(0);
		expect(parsedTrigger.spawnLocations.length).toBeGreaterThan(0);
	});

	it('root type exists in registry', () => {
		expect(triggerDataResourceSchema.registry.TriggerData).toBeDefined();
	});

	it('every record type referenced by a `record` or `list<record>` field is registered', () => {
		const missing: string[] = [];
		for (const [recordName, record] of Object.entries(triggerDataResourceSchema.registry)) {
			for (const [fieldName, field] of Object.entries(record.fields)) {
				checkField(field, `${recordName}.${fieldName}`, missing);
			}
		}
		if (missing.length > 0) {
			throw new Error(`Unknown record types referenced:\n  ${missing.join('\n  ')}`);
		}

		function checkField(f: FieldSchema, where: string, out: string[]) {
			if (f.kind === 'record') {
				if (!triggerDataResourceSchema.registry[f.type]) {
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
		walkResource(triggerDataResourceSchema, parsedTrigger, (_p, _v, field, record) => {
			if (record) recordCount++;
			if (field) fieldCount++;
		});
		expect(recordCount).toBeGreaterThan(0);
		expect(fieldCount).toBeGreaterThan(0);
	});

	it('no parsed record has fields absent from the schema', () => {
		// Walk the parsed model. For every record we visit, check that
		// the record's declared fields include every key on the parsed
		// object. Any missing entry is a schema bug — the walker and
		// inspector will silently drop that field, breaking round-trip.
		const missing: string[] = [];
		walkResource(triggerDataResourceSchema, parsedTrigger, (p, value, _field, record) => {
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
				`Schema is missing fields present in parsed data:\n  ${missing.slice(0, 20).join('\n  ')}${missing.length > 20 ? `\n  ... +${missing.length - 20} more` : ''}`,
			);
		}
	});

	it('every schema field is represented in the parsed data', () => {
		// Inverse check: if the schema declares a field the parser
		// doesn't emit, that's a typo or a stale field.
		const missing: string[] = [];
		walkResource(triggerDataResourceSchema, parsedTrigger, (p, value, _field, record) => {
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
				`Schema declares fields missing from parsed data:\n  ${missing.slice(0, 20).join('\n  ')}${missing.length > 20 ? `\n  ... +${missing.length - 20} more` : ''}`,
			);
		}
	});
});

// ---------------------------------------------------------------------------
// 2. Path resolution
// ---------------------------------------------------------------------------

describe('resolveSchemaAtPath', () => {
	it('resolves the root', () => {
		const loc = resolveSchemaAtPath(triggerDataResourceSchema, []);
		expect(loc).not.toBeNull();
		expect(loc!.record?.name).toBe('TriggerData');
	});

	it('resolves a top-level primitive field', () => {
		const loc = resolveSchemaAtPath(triggerDataResourceSchema, ['version']);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('i32');
		expect(loc!.parentRecord?.name).toBe('TriggerData');
	});

	it('resolves a vec4 leaf', () => {
		const loc = resolveSchemaAtPath(triggerDataResourceSchema, ['playerStartPosition']);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('vec4');
	});

	it('resolves a list item and lands on its record', () => {
		if (parsedTrigger.landmarks.length === 0) return;
		const loc = resolveSchemaAtPath(triggerDataResourceSchema, ['landmarks', 0]);
		expect(loc).not.toBeNull();
		expect(loc!.record?.name).toBe('Landmark');
	});

	it('resolves a deep record-inside-record path (landmarks[0].box)', () => {
		if (parsedTrigger.landmarks.length === 0) return;
		const loc = resolveSchemaAtPath(triggerDataResourceSchema, ['landmarks', 0, 'box']);
		expect(loc).not.toBeNull();
		expect(loc!.record?.name).toBe('BoxRegion');
	});

	it('resolves a primitive inside a nested box record', () => {
		if (parsedTrigger.landmarks.length === 0) return;
		const loc = resolveSchemaAtPath(
			triggerDataResourceSchema,
			['landmarks', 0, 'box', 'position'],
		);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('vec3');
	});

	it('resolves a primitive list item (killzones[0].triggerIds[0])', () => {
		const kzIdx = parsedTrigger.killzones.findIndex((k) => k.triggerIds.length > 0);
		if (kzIdx < 0) return;
		const loc = resolveSchemaAtPath(
			triggerDataResourceSchema,
			['killzones', kzIdx, 'triggerIds', 0],
		);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('i32');
	});

	it('resolves an enum field on a generic region', () => {
		if (parsedTrigger.genericRegions.length === 0) return;
		const loc = resolveSchemaAtPath(
			triggerDataResourceSchema,
			['genericRegions', 0, 'genericType'],
		);
		expect(loc).not.toBeNull();
		expect(loc!.field?.kind).toBe('enum');
	});

	it('returns null for an unknown field', () => {
		const loc = resolveSchemaAtPath(triggerDataResourceSchema, ['nonexistent']);
		expect(loc).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// 3. Data get / update — structural sharing
// ---------------------------------------------------------------------------

describe('getAtPath / updateAtPath', () => {
	it('getAtPath returns the root for empty path', () => {
		expect(getAtPath(parsedTrigger, [])).toBe(parsedTrigger);
	});

	it('getAtPath returns a nested primitive', () => {
		expect(getAtPath(parsedTrigger, ['version'])).toBe(parsedTrigger.version);
	});

	it('getAtPath returns a nested list item', () => {
		if (parsedTrigger.landmarks.length === 0) return;
		const first = getAtPath(parsedTrigger, ['landmarks', 0]);
		expect(first).toBe(parsedTrigger.landmarks[0]);
	});

	it('setAtPath replaces a primitive and leaves siblings intact', () => {
		const before = parsedTrigger.onlineLandmarkCount;
		const next = setAtPath(parsedTrigger, ['onlineLandmarkCount'], 42);
		expect(next.onlineLandmarkCount).toBe(42);
		// Other top-level fields share references with the original.
		expect(next.landmarks).toBe(parsedTrigger.landmarks);
		expect(next.genericRegions).toBe(parsedTrigger.genericRegions);
		expect(parsedTrigger.onlineLandmarkCount).toBe(before);
	});

	it('updateAtPath deep-edits a box field and preserves siblings', () => {
		if (parsedTrigger.landmarks.length === 0) return;
		const next = updateAtPath(
			parsedTrigger,
			['landmarks', 0, 'box', 'position', 'x'],
			() => 9999,
		);
		expect(next.landmarks[0].box.position.x).toBe(9999);
		// Un-edited landmarks share references (structural sharing proof).
		for (let i = 1; i < parsedTrigger.landmarks.length; i++) {
			expect(next.landmarks[i]).toBe(parsedTrigger.landmarks[i]);
		}
		// Original untouched.
		expect(parsedTrigger.landmarks[0].box.position.x).not.toBe(9999);
	});

	it('insertListItem appends and removeListItem removes', () => {
		if (parsedTrigger.blackspots.length === 0) return;
		const sample = parsedTrigger.blackspots[0];
		const withExtra = insertListItem(
			parsedTrigger,
			['blackspots'],
			{ ...sample, box: { ...sample.box }, id: sample.id + 10_000 },
		);
		expect(withExtra.blackspots.length).toBe(parsedTrigger.blackspots.length + 1);
		const backOut = removeListItem(
			withExtra,
			['blackspots'],
			withExtra.blackspots.length - 1,
		);
		expect(backOut.blackspots.length).toBe(parsedTrigger.blackspots.length);
	});
});

// ---------------------------------------------------------------------------
// 4. Byte-exact round-trip — writer output must match the fixture's sha1
// ---------------------------------------------------------------------------

describe('triggerData byte round-trip', () => {
	it('parse → write reproduces the original bytes', () => {
		const written = writeTriggerDataData(parsedTrigger, true);
		expect(written.length).toBe(rawTrigger.length);
		expect(sha1(written)).toBe(sha1(rawTrigger));
	});

	it('parse → walk → write is byte-identical (walker must not mutate)', () => {
		let visitCount = 0;
		walkResource(triggerDataResourceSchema, parsedTrigger, () => {
			visitCount++;
		});
		expect(visitCount).toBeGreaterThan(50);
		const written = writeTriggerDataData(parsedTrigger, true);
		expect(sha1(written)).toBe(sha1(rawTrigger));
	});

	it('setAtPath on a primitive produces a writable model', () => {
		const next = setAtPath(parsedTrigger, ['onlineLandmarkCount'], 0);
		expect(() => writeTriggerDataData(next, true)).not.toThrow();
	});
});

// ---------------------------------------------------------------------------
// 5. Label callbacks
// ---------------------------------------------------------------------------

describe('schema labels', () => {
	const ctx = {
		root: parsedTrigger,
		resource: triggerDataResourceSchema,
	};

	it('landmark label describes id + position', () => {
		if (parsedTrigger.landmarks.length === 0) return;
		const field = triggerDataResourceSchema.registry.TriggerData.fields.landmarks;
		if (field.kind !== 'list') throw new Error('expected list');
		const label = field.itemLabel?.(parsedTrigger.landmarks[0], 0, ctx);
		expect(label).toMatch(/^#0/);
		expect(label).toMatch(/id/);
	});

	it('generic region label names the generic type', () => {
		if (parsedTrigger.genericRegions.length === 0) return;
		const field = triggerDataResourceSchema.registry.TriggerData.fields.genericRegions;
		if (field.kind !== 'list') throw new Error('expected list');
		const label = field.itemLabel?.(parsedTrigger.genericRegions[0], 0, ctx);
		expect(label).toMatch(/^#0/);
		// The GenericRegionType enum has all distinct labels; any of them
		// should appear in the output (except the "type N" fallback).
		expect(label).not.toMatch(/type \?/);
	});

	it('spawn location label names the spawn type', () => {
		if (parsedTrigger.spawnLocations.length === 0) return;
		const field = triggerDataResourceSchema.registry.TriggerData.fields.spawnLocations;
		if (field.kind !== 'list') throw new Error('expected list');
		const label = field.itemLabel?.(parsedTrigger.spawnLocations[0], 0, ctx);
		expect(label).toMatch(/^#0/);
	});

	it('signature stunt label renders the CgsID as hex', () => {
		if (parsedTrigger.signatureStunts.length === 0) return;
		const field = triggerDataResourceSchema.registry.TriggerData.fields.signatureStunts;
		if (field.kind !== 'list') throw new Error('expected list');
		const label = field.itemLabel?.(parsedTrigger.signatureStunts[0], 0, ctx);
		expect(label).toMatch(/0x[0-9A-F]+/);
	});

	it('label callbacks don\'t throw on empty / malformed inputs', () => {
		const record = triggerDataResourceSchema.registry.Landmark;
		expect(() => record.label?.({}, 0, ctx)).not.toThrow();
		const field = triggerDataResourceSchema.registry.TriggerData.fields.landmarks;
		if (field.kind !== 'list') throw new Error('expected list');
		expect(() => field.itemLabel?.(undefined, 7, ctx)).not.toThrow();
	});
});

// ---------------------------------------------------------------------------
// 6. Drive-thru buffer validator
// ---------------------------------------------------------------------------

describe('drive-thru buffer validation', () => {
	const ctx = {
		root: parsedTrigger,
		resource: triggerDataResourceSchema,
	};

	it('validates the fixture without errors', () => {
		// The retail TRIGGERS.DAT fixture is sized for v1.9 / Remastered
		// (53 drive-thru slots) and has 51 drive-thrus — over the v1.0
		// limit of 46, so the validator will emit a warning. That's
		// correct behavior; we only assert that no ERROR results fire.
		const results = triggerDataResourceSchema.registry.TriggerData.validate?.(
			parsedTrigger as unknown as Record<string, unknown>,
			ctx,
		);
		const errors = (results ?? []).filter((r) => r.severity === 'error');
		expect(errors).toEqual([]);
	});

	it('warns when drive-thru count exceeds v1.0 but not v1.9', () => {
		// Build a synthetic generic region list with exactly 47 drive-thrus.
		const gr47 = Array.from({ length: 47 }, (_, i) => ({
			box: {
				position: { x: 0, y: 0, z: 0 },
				rotation: { x: 0, y: 0, z: 0 },
				dimensions: { x: 1, y: 1, z: 1 },
			},
			id: i,
			regionIndex: i,
			type: 2,
			enabled: 1,
			groupId: 0,
			cameraCut1: 0,
			cameraCut2: 0,
			cameraType1: 0,
			cameraType2: 0,
			genericType: 0, // Junk Yard = drive-thru
			isOneWay: 0,
		}));
		const results = triggerDataResourceSchema.registry.TriggerData.validate?.(
			{ genericRegions: gr47 } as Record<string, unknown>,
			ctx,
		);
		expect(results?.length).toBe(1);
		expect(results?.[0].severity).toBe('warning');
		expect(results?.[0].field).toBe('genericRegions');
		expect(results?.[0].message).toMatch(/v1\.0/);
	});

	it('errors when drive-thru count exceeds v1.9', () => {
		const gr54 = Array.from({ length: 54 }, (_, i) => ({ genericType: 0 }));
		const results = triggerDataResourceSchema.registry.TriggerData.validate?.(
			{ genericRegions: gr54 } as Record<string, unknown>,
			ctx,
		);
		expect(results?.length).toBe(1);
		expect(results?.[0].severity).toBe('error');
		expect(results?.[0].message).toMatch(/Remastered|v1\.9/);
	});

	it('ignores non-drive-thru generic region types', () => {
		const jumps = Array.from({ length: 100 }, (_, i) => ({ genericType: 8 }));
		const results = triggerDataResourceSchema.registry.TriggerData.validate?.(
			{ genericRegions: jumps } as Record<string, unknown>,
			ctx,
		);
		expect(results ?? []).toEqual([]);
	});
});

// Silence type-only imports so tsc doesn't whine about unused bindings.
void (null as unknown as RecordSchema);
