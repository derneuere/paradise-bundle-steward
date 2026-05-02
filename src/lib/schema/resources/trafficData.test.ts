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
	type ParsedTrafficDataRetail,
} from '../../core/trafficData';

import { trafficDataResourceSchema } from './trafficData';
import {
	applyDerives,
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
const parsedTrafficRaw = parseTrafficDataData(rawTraffic, true);
// Fixture is the v45 retail bundle; the rest of this test file is written
// against the retail field shape, so narrow once at the top and let the
// later assertions read `.hulls` / `.flowTypes` without re-narrowing.
if (parsedTrafficRaw.kind === 'v22') {
	throw new Error('Fixture B5TRAFFIC.BNDL parsed as v22; expected retail v44/v45.');
}
const parsedTraffic: ParsedTrafficDataRetail = parsedTrafficRaw;

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
		const next = setAtPath(parsedTraffic, ['paintColours', 0], { x: 0, y: 0, z: 0, w: 0 } as ParsedTrafficDataRetail['paintColours'][number]);
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
		const modified: ParsedTrafficDataRetail = { ...parsedTraffic, hulls };

		// The stale count is still present on the model …
		expect(modified.hulls[hullIdx].muNumSections).toBe(originalCount);
		// … but the array is shorter by one.
		expect(modified.hulls[hullIdx].sections.length).toBe(originalCount - 1);

		// Write → parse. The re-parsed bundle should see the NEW length, not
		// the stale count, because the writer derives from length.
		const bytes = writeTrafficDataData(modified, true);
		const roundTripped = parseTrafficDataData(bytes, true);
		if (roundTripped.kind === 'v22') throw new Error('round-trip parsed as v22');

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
		const modified: ParsedTrafficDataRetail = { ...parsedTraffic, flowTypes: flows };

		expect(modified.flowTypes[flowIdx].muNumVehicleTypes).toBe(originalCount);
		expect(modified.flowTypes[flowIdx].vehicleTypeIds.length).toBe(originalCount - 1);

		const bytes = writeTrafficDataData(modified, true);
		const roundTripped = parseTrafficDataData(bytes, true);
		if (roundTripped.kind === 'v22') throw new Error('round-trip parsed as v22');

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
		const modified: ParsedTrafficDataRetail = { ...parsedTraffic, hulls };

		expect(modified.hulls[hullIdx].muNumRungs).toBe(originalCount);

		const bytes = writeTrafficDataData(modified, true);
		const roundTripped = parseTrafficDataData(bytes, true);
		if (roundTripped.kind === 'v22') throw new Error('round-trip parsed as v22');

		expect(roundTripped.hulls[hullIdx].rungs.length).toBe(originalCount - 1);
		expect(roundTripped.hulls[hullIdx].muNumRungs).toBe(originalCount - 1);
	});
});

// ---------------------------------------------------------------------------
// 6. Schema-level derive hook (TrafficSectionSpan.mfMaxVehicleRecip)
// ---------------------------------------------------------------------------

describe('schema derive hook', () => {
	it('recomputes mfMaxVehicleRecip when muMaxVehicles changes', () => {
		const hullIdx = parsedTraffic.hulls.findIndex((h) => h.sectionSpans.length > 0);
		if (hullIdx < 0) return;
		const spanPath: NodePath = ['hulls', hullIdx, 'sectionSpans', 0];
		const field: NodePath = [...spanPath, 'muMaxVehicles'];

		const originalMax = parsedTraffic.hulls[hullIdx].sectionSpans[0].muMaxVehicles;
		const newMax = Math.max(1, originalMax + 5);

		// Simulate a field-level edit exactly the way SchemaEditorContext
		// does: apply the primitive set, then run derive against the
		// enclosing record path.
		const next = setAtPath(parsedTraffic, field, newMax);
		const reconciled = applyDerives(parsedTraffic, next, field, trafficDataResourceSchema);

		const patched = reconciled.hulls[hullIdx].sectionSpans[0];
		expect(patched.muMaxVehicles).toBe(newMax);
		// Derive recomputed the cached reciprocal — should match 1/newMax
		// within f32 precision.
		expect(patched.mfMaxVehicleRecip).toBeCloseTo(1 / newMax, 5);
		// Other spans in the same hull were NOT touched.
		if (parsedTraffic.hulls[hullIdx].sectionSpans.length > 1) {
			expect(reconciled.hulls[hullIdx].sectionSpans[1]).toBe(
				parsedTraffic.hulls[hullIdx].sectionSpans[1],
			);
		}
	});

	it('leaves unrelated records untouched when no derive runs', () => {
		// Editing a field on a record with NO derive hook (TrafficSection)
		// should not invoke any derive — reconciliation is a no-op.
		const hullIdx = parsedTraffic.hulls.findIndex((h) => h.sections.length > 0);
		if (hullIdx < 0) return;
		const path: NodePath = ['hulls', hullIdx, 'sections', 0, 'mfSpeed'];

		const next = setAtPath(parsedTraffic, path, 42);
		const reconciled = applyDerives(parsedTraffic, next, path, trafficDataResourceSchema);

		// The section's speed is updated; nothing else should change.
		expect(reconciled.hulls[hullIdx].sections[0].mfSpeed).toBe(42);
		// And structural sharing holds for sibling sections.
		if (parsedTraffic.hulls[hullIdx].sections.length > 1) {
			expect(reconciled.hulls[hullIdx].sections[1]).toBe(
				parsedTraffic.hulls[hullIdx].sections[1],
			);
		}
	});

	it('skips derive when muMaxVehicles is unchanged', () => {
		// If derive compared prev vs next with a no-op edit (same value),
		// it should return `{}` and not touch mfMaxVehicleRecip.
		const hullIdx = parsedTraffic.hulls.findIndex((h) => h.sectionSpans.length > 0);
		if (hullIdx < 0) return;
		const field: NodePath = ['hulls', hullIdx, 'sectionSpans', 0, 'muMaxVehicles'];
		const originalMax = parsedTraffic.hulls[hullIdx].sectionSpans[0].muMaxVehicles;
		const originalRecip = parsedTraffic.hulls[hullIdx].sectionSpans[0].mfMaxVehicleRecip;

		const next = setAtPath(parsedTraffic, field, originalMax);
		const reconciled = applyDerives(parsedTraffic, next, field, trafficDataResourceSchema);

		// No-op write returns the same recip the original file stored.
		expect(reconciled.hulls[hullIdx].sectionSpans[0].mfMaxVehicleRecip).toBe(originalRecip);
	});

	// ── TrafficPvs ─────────────────────────────────────────────────────────
	// The runtime derives world→cell-index lookups from `mRecipCellSize`
	// and asserts `hullPvsSets.length === muNumCells`, so every edit to a
	// source-of-truth PVS field must keep the cached fields consistent.

	it('recomputes mRecipCellSize when mCellSize is edited', () => {
		const cellSize = parsedTraffic.pvs.mCellSize;
		const newSize = { ...cellSize, x: cellSize.x * 2, z: cellSize.z * 2 };
		const field: NodePath = ['pvs', 'mCellSize'];

		const next = setAtPath(parsedTraffic, field, newSize);
		const reconciled = applyDerives(parsedTraffic, next, field, trafficDataResourceSchema);

		expect(reconciled.pvs.mCellSize).toEqual(newSize);
		expect(reconciled.pvs.mRecipCellSize.x).toBeCloseTo(1 / newSize.x, 6);
		expect(reconciled.pvs.mRecipCellSize.y).toBeCloseTo(newSize.y !== 0 ? 1 / newSize.y : 0, 6);
		expect(reconciled.pvs.mRecipCellSize.z).toBeCloseTo(1 / newSize.z, 6);
		// w is preserved verbatim — it isn't a spatial axis.
		expect(reconciled.pvs.mRecipCellSize.w).toBe(newSize.w);
	});

	it('recomputes mRecipCellSize via component-level edit', () => {
		// Edit only mCellSize.x — the derive should still fire because the
		// vec4 was structurally rebuilt by updateAtPath.
		const originalX = parsedTraffic.pvs.mCellSize.x;
		const field: NodePath = ['pvs', 'mCellSize', 'x'];
		const next = setAtPath(parsedTraffic, field, originalX * 4);
		const reconciled = applyDerives(parsedTraffic, next, field, trafficDataResourceSchema);

		expect(reconciled.pvs.mCellSize.x).toBe(originalX * 4);
		expect(reconciled.pvs.mRecipCellSize.x).toBeCloseTo(1 / (originalX * 4), 6);
	});

	it('guards against divide-by-zero in mRecipCellSize', () => {
		const cellSize = parsedTraffic.pvs.mCellSize;
		const newSize = { x: 0, y: cellSize.y, z: 0, w: cellSize.w };
		const field: NodePath = ['pvs', 'mCellSize'];

		const next = setAtPath(parsedTraffic, field, newSize);
		const reconciled = applyDerives(parsedTraffic, next, field, trafficDataResourceSchema);

		// Zero source → zero recip, never Infinity / NaN.
		expect(reconciled.pvs.mRecipCellSize.x).toBe(0);
		expect(Number.isFinite(reconciled.pvs.mRecipCellSize.x)).toBe(true);
		expect(reconciled.pvs.mRecipCellSize.z).toBe(0);
	});

	it('skips PVS derive when mCellSize is unchanged', () => {
		// Editing mGridMin should not recompute the recip — only mCellSize
		// drives that field.
		const originalRecip = parsedTraffic.pvs.mRecipCellSize;
		const field: NodePath = ['pvs', 'mGridMin', 'x'];
		const next = setAtPath(parsedTraffic, field, parsedTraffic.pvs.mGridMin.x + 100);
		const reconciled = applyDerives(parsedTraffic, next, field, trafficDataResourceSchema);

		// Reference equality — derive returned `{}` for the recip key.
		expect(reconciled.pvs.mRecipCellSize).toBe(originalRecip);
	});

	it('grows hullPvsSets and updates muNumCells when grid resolution increases', () => {
		const origX = parsedTraffic.pvs.muNumCells_X;
		const origZ = parsedTraffic.pvs.muNumCells_Z;
		const origLen = parsedTraffic.pvs.hullPvsSets.length;
		const field: NodePath = ['pvs', 'muNumCells_X'];
		const next = setAtPath(parsedTraffic, field, origX + 2);
		const reconciled = applyDerives(parsedTraffic, next, field, trafficDataResourceSchema);

		const expectedTotal = (origX + 2) * origZ;
		expect(reconciled.pvs.muNumCells_X).toBe(origX + 2);
		expect(reconciled.pvs.muNumCells).toBe(expectedTotal);
		expect(reconciled.pvs.hullPvsSets.length).toBe(expectedTotal);

		// Existing cells preserved verbatim.
		for (let i = 0; i < origLen; i++) {
			expect(reconciled.pvs.hullPvsSets[i]).toBe(parsedTraffic.pvs.hullPvsSets[i]);
		}
		// New cells are empty PvsHullSets.
		const tail = reconciled.pvs.hullPvsSets[expectedTotal - 1];
		expect(tail.muCount).toBe(0);
		expect(tail.mauItems).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
	});

	it('shrinks hullPvsSets from the tail when grid resolution decreases', () => {
		const origX = parsedTraffic.pvs.muNumCells_X;
		const origZ = parsedTraffic.pvs.muNumCells_Z;
		// Skip if the fixture is too small to shrink meaningfully.
		if (origX <= 1) return;

		const field: NodePath = ['pvs', 'muNumCells_X'];
		const next = setAtPath(parsedTraffic, field, origX - 1);
		const reconciled = applyDerives(parsedTraffic, next, field, trafficDataResourceSchema);

		const expectedTotal = (origX - 1) * origZ;
		expect(reconciled.pvs.muNumCells).toBe(expectedTotal);
		expect(reconciled.pvs.hullPvsSets.length).toBe(expectedTotal);
		// Front of the list is preserved (we trim from the end).
		for (let i = 0; i < expectedTotal; i++) {
			expect(reconciled.pvs.hullPvsSets[i]).toBe(parsedTraffic.pvs.hullPvsSets[i]);
		}
	});

	it('resizes both axes when X and Z change in the same edit', () => {
		const origX = parsedTraffic.pvs.muNumCells_X;
		const origZ = parsedTraffic.pvs.muNumCells_Z;
		// Apply two primitive edits, then run derive once at the deepest
		// shared ancestor (the pvs record).
		let next = setAtPath(parsedTraffic, ['pvs', 'muNumCells_X'], origX + 1);
		next = setAtPath(next, ['pvs', 'muNumCells_Z'], origZ + 1);
		const reconciled = applyDerives(parsedTraffic, next, ['pvs', 'muNumCells_Z'], trafficDataResourceSchema);

		const expectedTotal = (origX + 1) * (origZ + 1);
		expect(reconciled.pvs.muNumCells).toBe(expectedTotal);
		expect(reconciled.pvs.hullPvsSets.length).toBe(expectedTotal);
	});

	it('leaves hullPvsSets alone when the user mutates it directly', () => {
		// Direct list edits (e.g., setting an existing cell's hull list)
		// must not invalidate the user's change just because the list ref
		// changed. Only X/Z edits trigger a resize.
		if (parsedTraffic.pvs.hullPvsSets.length === 0) return;
		const origLen = parsedTraffic.pvs.hullPvsSets.length;
		const field: NodePath = ['pvs', 'hullPvsSets', 0, 'muCount'];
		const originalCount = parsedTraffic.pvs.hullPvsSets[0].muCount;
		const next = setAtPath(parsedTraffic, field, originalCount + 1);
		const reconciled = applyDerives(parsedTraffic, next, field, trafficDataResourceSchema);

		expect(reconciled.pvs.hullPvsSets.length).toBe(origLen);
		expect(reconciled.pvs.hullPvsSets[0].muCount).toBe(originalCount + 1);
		// muNumCells didn't move either.
		expect(reconciled.pvs.muNumCells).toBe(parsedTraffic.pvs.muNumCells);
	});
});

// ---------------------------------------------------------------------------
// 7. Label callbacks
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

// ---------------------------------------------------------------------------
// 8. V22 prototype variant — discriminated-union smoke test (issue #45)
// ---------------------------------------------------------------------------
//
// The Burnout 5 prototype X360 fixture parses into the `kind: 'v22'` branch
// of the discriminated union. The retail schema can't render it (the field
// shape is structurally different), so the editor registry registers a
// separate `trafficDataV22ResourceSchema` for that branch. The writer
// refuses v22 — there's no spec for hull internals or the tail regions.

import { trafficDataV22ResourceSchema } from './trafficDataV22';

const V22_FIXTURE = path.resolve(__dirname, '../../../../example/older builds/B5Traffic.bndl');

function loadV22Raw(): Uint8Array {
	const raw = fs.readFileSync(V22_FIXTURE);
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
	throw new Error('V22 fixture has no non-empty TrafficData payload');
}

describe('trafficData v22 prototype variant', () => {
	const rawV22 = loadV22Raw();
	// X360 build → big-endian.
	const parsedV22 = parseTrafficDataData(rawV22, false);

	it('parses into the kind: "v22" branch', () => {
		expect(parsedV22.kind).toBe('v22');
	});

	it('reports muDataVersion === 22', () => {
		expect(parsedV22.muDataVersion).toBe(22);
	});

	it('exposes structural fields directly (no v22Raw nesting)', () => {
		if (parsedV22.kind !== 'v22') throw new Error('expected v22');
		expect(parsedV22.hullPointers.length).toBeGreaterThan(0);
		expect(parsedV22.hullPointers.length).toBe(parsedV22.hullsRaw.length);
		expect(parsedV22.tailABytes.byteLength).toBeGreaterThan(0);
		// pvs has the v22-shaped fields (no forward mCellSize Vec4).
		expect(parsedV22.pvs.muNumCells).toBeGreaterThan(0);
	});

	it('writer rejects v22 with a clear error', () => {
		expect(() => writeTrafficDataData(parsedV22, false)).toThrow(/cannot write v22 prototype payload/);
	});

	it('v22 schema root references the correct record type', () => {
		expect(trafficDataV22ResourceSchema.rootType).toBe('ParsedTrafficDataV22');
		expect(trafficDataV22ResourceSchema.registry.ParsedTrafficDataV22).toBeDefined();
	});
});

// Silence unused-import warnings for types used only in JSDoc-like comments.
void (null as unknown as NodePath);
void (null as unknown as RecordSchema);
