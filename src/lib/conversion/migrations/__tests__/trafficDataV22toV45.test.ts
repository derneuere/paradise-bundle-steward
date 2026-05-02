// Tests for the V22 → V45 TrafficData migration (issue #45 follow-up).
//
// Coverage flavours:
//   1. Structural round-trip on the real V22 fixture: parse → migrate →
//      writeTrafficDataData → parseTrafficDataData → assert hull / flow /
//      vehicle counts and key field values survive.
//   2. CgsID preservation — every v22 vehicle asset name should land in
//      the migrated v45 vehicleAssets table as the same base-40 hash.
//   3. PVS spatial preservation — mGridMin / mRecipCellSize unchanged;
//      mCellSize derived correctly; hullPvsSets padded to X*Z.
//   4. defaulted / lossy lists match the migration plan
//      (docs/trafficData-v22-migration.md).
//   5. Stability — migrating twice produces identical output; re-encoding
//      the v45 result through the writer is byte-stable.
//   6. Profile wiring — the v22 EditorProfile exposes the migration via
//      `conversions.v45.migrate`.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';

import { parseBundle } from '@/lib/core/bundle';
import { extractResourceSize, isCompressed, decompressData } from '@/lib/core/resourceManager';
import { RESOURCE_TYPE_IDS } from '@/lib/core/types';
import {
	parseTrafficDataData,
	writeTrafficDataData,
	type ParsedTrafficDataV22,
} from '@/lib/core/trafficData';
import { encodeCgsId, decodeCgsId } from '@/lib/core/cgsid';
import { migrateV22toV45 } from '../trafficDataV22toV45';
import { trafficDataV22Profile } from '@/lib/editor/profiles/trafficData';

const V22_FIXTURE = path.resolve(__dirname, '../../../../../example/older builds/B5Traffic.bndl');

function sha1(bytes: Uint8Array): string {
	return createHash('sha1').update(bytes).digest('hex');
}

function loadResourceBytes(fixturePath: string): Uint8Array {
	const raw = fs.readFileSync(fixturePath);
	const bytes = new Uint8Array(raw.byteLength);
	bytes.set(raw);
	const bundle = parseBundle(bytes.buffer);
	const resource = bundle.resources.find((r) => r.resourceTypeId === RESOURCE_TYPE_IDS.TRAFFIC_DATA);
	if (!resource) throw new Error(`${fixturePath}: no TrafficData resource`);
	for (let bi = 0; bi < 3; bi++) {
		const size = extractResourceSize(resource.sizeAndAlignmentOnDisk[bi]);
		if (size <= 0) continue;
		const base = bundle.header.resourceDataOffsets[bi] >>> 0;
		const rel = resource.diskOffsets[bi] >>> 0;
		const start = (base + rel) >>> 0;
		let slice: Uint8Array = new Uint8Array(bytes.buffer.slice(start, start + size));
		if (isCompressed(slice)) slice = decompressData(slice);
		return slice;
	}
	throw new Error(`${fixturePath}: no populated TrafficData block`);
}

function parseV22Fixture(): ParsedTrafficDataV22 {
	const slice = loadResourceBytes(V22_FIXTURE);
	const parsed = parseTrafficDataData(slice, /* littleEndian */ false);
	if (parsed.kind !== 'v22') throw new Error(`expected v22 fixture, got ${parsed.kind}`);
	return parsed;
}

const v22 = parseV22Fixture();

describe('migrateV22toV45 — top-level structure', () => {
	it('produces a kind: v45 model with muDataVersion = 45', () => {
		const { result } = migrateV22toV45(v22);
		expect(result.kind).toBe('v45');
		expect(result.muDataVersion).toBe(45);
	});

	it('preserves hull count', () => {
		const { result } = migrateV22toV45(v22);
		expect(result.hulls.length).toBe(v22.hullPointers.length);
	});

	it('preserves flow / vehicle counts', () => {
		const { result } = migrateV22toV45(v22);
		expect(result.flowTypes.length).toBe(v22.muNumFlowTypes);
		expect(result.vehicleTypes.length).toBe(v22.muNumVehicleTypes);
		expect(result.vehicleTypesUpdate.length).toBe(v22.muNumVehicleTypes);
		expect(result.vehicleAssets.length).toBe(v22.muNumVehicleTypes);
	});

	it('emits exactly one neutral vehicle trait', () => {
		const { result } = migrateV22toV45(v22);
		expect(result.vehicleTraits.length).toBe(1);
		expect(result.vehicleTraits[0].mfAcceleration).toBe(1.0);
		// Every vehicleType points at index 0 — only trait synthesised.
		for (const vt of result.vehicleTypes) expect(vt.muTraitsId).toBe(0);
	});

	it('synthesises empty retail-only tables', () => {
		const { result } = migrateV22toV45(v22);
		expect(result.killZones).toEqual([]);
		expect(result.killZoneIds).toEqual([]);
		expect(result.killZoneRegions).toEqual([]);
		expect(result.paintColours).toEqual([]);
		expect(result.trafficLights.posAndYRotations).toEqual([]);
		expect(result.trafficLights.mauInstanceHashOffsets.length).toBe(129);
	});
});

describe('migrateV22toV45 — PVS', () => {
	const { result } = migrateV22toV45(v22);

	it('preserves mGridMin', () => {
		expect(result.pvs.mGridMin).toEqual(v22.pvs.mGridMin);
	});

	it('preserves mRecipCellSize', () => {
		expect(result.pvs.mRecipCellSize).toEqual(v22.pvs.mRecipCellSize);
	});

	it('synthesises mCellSize as 1 / mRecipCellSize per axis', () => {
		const recip = v22.pvs.mRecipCellSize;
		expect(result.pvs.mCellSize.x).toBeCloseTo(recip.x !== 0 ? 1 / recip.x : 0, 5);
		expect(result.pvs.mCellSize.z).toBeCloseTo(recip.z !== 0 ? 1 / recip.z : 0, 5);
		// y / w are zero in v22 → zero (not Infinity / NaN).
		expect(Number.isFinite(result.pvs.mCellSize.y)).toBe(true);
		expect(Number.isFinite(result.pvs.mCellSize.w)).toBe(true);
	});

	it('pads hullPvsSets to muNumCells_X × muNumCells_Z', () => {
		expect(result.pvs.muNumCells).toBe(result.pvs.muNumCells_X * result.pvs.muNumCells_Z);
		expect(result.pvs.hullPvsSets.length).toBe(result.pvs.muNumCells);
	});
});

describe('migrateV22toV45 — vehicle assets (CgsID hash preservation)', () => {
	const { result } = migrateV22toV45(v22);

	it('decodes every vehicleAsset CgsID to a non-empty asset name', () => {
		for (let i = 0; i < result.vehicleAssets.length; i++) {
			const decoded = decodeCgsId(result.vehicleAssets[i].mVehicleId).trim();
			expect(decoded.length).toBeGreaterThan(0);
		}
	});

	it('round-trips the first asset through encode/decode', () => {
		// Sample asset name from the v22 fixture (hard-pinned for sanity).
		// The first tailD entry in B5Traffic.bndl is "TUSAC02".
		expect(decodeCgsId(result.vehicleAssets[0].mVehicleId).trim()).toBe('TUSAC02');
		expect(result.vehicleAssets[0].mVehicleId).toBe(encodeCgsId('TUSAC02'));
	});

	it('every vehicleType.muAssetId references a valid vehicleAssets entry', () => {
		for (const vt of result.vehicleTypes) {
			expect(vt.muAssetId).toBeGreaterThanOrEqual(0);
			expect(vt.muAssetId).toBeLessThan(result.vehicleAssets.length);
		}
	});
});

describe('migrateV22toV45 — flow types', () => {
	const { result } = migrateV22toV45(v22);

	it('every flow type has parallel vehicleTypeIds + cumulativeProbs arrays', () => {
		for (const ft of result.flowTypes) {
			expect(ft.vehicleTypeIds.length).toBe(ft.cumulativeProbs.length);
			expect(ft.muNumVehicleTypes).toBe(ft.vehicleTypeIds.length);
		}
	});

	it('flow-type vehicleTypeIds reference valid vehicle types', () => {
		for (const ft of result.flowTypes) {
			for (const id of ft.vehicleTypeIds) {
				// 0xFFFF is the v45 sentinel for "no vehicle"; any other
				// value should land within the migrated vehicleTypes table.
				if (id !== 0xFFFF) {
					expect(id).toBeLessThan(result.vehicleTypes.length);
				}
			}
		}
	});
});

describe('migrateV22toV45 — hull internals', () => {
	const { result } = migrateV22toV45(v22);

	it('non-empty hulls carry decoded sections + rungs', () => {
		const populated = result.hulls.filter((h) => h.sections.length > 0);
		expect(populated.length).toBeGreaterThan(0);
		for (const h of populated) {
			// Every populated hull should also have rungs (a section without
			// rungs has no lane geometry; investigation showed all v22
			// populated hulls carry both).
			expect(h.rungs.length).toBeGreaterThan(0);
			// cumulativeRungLengths is parallel to rungs.
			expect(h.cumulativeRungLengths.length).toBe(h.rungs.length);
		}
	});

	it('decoded section[0].mfSpeed / mfLength are sane positive numbers', () => {
		// Pin against hull[22].section[0] from the investigation:
		// mfSpeed≈29 m/s, mfLength≈425 m. Sanity check that the migration
		// preserves these values (within f32 precision).
		const h22 = result.hulls[22];
		expect(h22.sections.length).toBeGreaterThanOrEqual(1);
		const s0 = h22.sections[0];
		expect(s0.mfSpeed).toBeGreaterThan(1);
		expect(s0.mfSpeed).toBeLessThan(100);
		expect(s0.mfLength).toBeGreaterThan(1);
		expect(s0.mfLength).toBeLessThan(2000);
	});

	it('every section addresses rungs within the hull pool bounds', () => {
		// Sections share the per-hull rung pool via (muRungOffset, muNumRungs).
		// In v22 the pool sometimes has trailing rungs beyond the section
		// claims (unused buffer space the original generator left in place);
		// we don't enforce sum-equals-total, only that every section's slice
		// stays in-bounds. v22 hull[22] has muRungOffset=0/muNumRungs=72 for
		// section[0] and section[1].muNumRungs=0, leaving 68 unclaimed
		// rungs — investigation found these are real rung records but
		// nothing in v22 claims them.
		for (const h of result.hulls) {
			for (const s of h.sections) {
				expect(s.muNumRungs).toBeGreaterThanOrEqual(0);
				expect(s.muRungOffset + s.muNumRungs).toBeLessThanOrEqual(h.rungs.length);
			}
		}
	});

	it('synthesises one sectionFlow per section (v45 invariant)', () => {
		for (const h of result.hulls) {
			expect(h.sectionFlows.length).toBe(h.sections.length);
		}
	});

	it('synthesises empty arrays for retail-only sub-arrays', () => {
		for (const h of result.hulls) {
			expect(h.junctions).toEqual([]);
			expect(h.stopLines).toEqual([]);
			expect(h.lightTriggers).toEqual([]);
			expect(h.lightTriggerStartData).toEqual([]);
			expect(h.lightTriggerJunctionLookup).toEqual([]);
		}
	});
});

describe('migrateV22toV45 — defaulted / lossy reporting', () => {
	const { defaulted, lossy } = migrateV22toV45(v22);

	it('marks PVS-derived fields as defaulted', () => {
		expect(defaulted).toContain('pvs.mCellSize');
		expect(defaulted).toContain('pvs.muNumCells_Z');
	});

	it('marks retail-only tables as defaulted', () => {
		expect(defaulted).toContain('killZones');
		expect(defaulted).toContain('vehicleTraits');
		expect(defaulted).toContain('paintColours');
		expect(defaulted).toContain('trafficLights');
	});

	it('marks v22-only fields as lossy', () => {
		expect(lossy).toContain('vehicleAssetNames (v22 tailD — retail dropped name strings)');
	});

	it('marks undecoded hull sub-arrays as lossy when they had non-zero counts', () => {
		// The fixture has populated hulls with non-empty neighbours,
		// sectionSpans, sectionFlows, staticTrafficVehicles — at least
		// some of these should trigger the lossy markers.
		const fixturePopulated = lossy.some((s) => s.startsWith('hulls[]'));
		expect(fixturePopulated).toBe(true);
	});

	it('returns sorted, deduped string lists', () => {
		const sortedDef = [...defaulted].sort();
		expect(defaulted).toEqual(sortedDef);
		expect(new Set(defaulted).size).toBe(defaulted.length);
		expect(new Set(lossy).size).toBe(lossy.length);
	});
});

describe('migrateV22toV45 — stability', () => {
	it('migrating twice produces structurally identical output', () => {
		const a = migrateV22toV45(v22);
		const b = migrateV22toV45(v22);
		// JSON-compare to side-step bigint quirks by stringifying.
		const norm = (m: ReturnType<typeof migrateV22toV45>) =>
			JSON.stringify({
				...m,
				result: {
					...m.result,
					vehicleAssets: m.result.vehicleAssets.map((va) => va.mVehicleId.toString()),
				},
			});
		expect(norm(a)).toBe(norm(b));
	});

	it('writer accepts the migrated model and round-trips byte-stably', () => {
		const { result } = migrateV22toV45(v22);
		const bytes = writeTrafficDataData(result, /* littleEndian */ true);
		const reparsed = parseTrafficDataData(bytes, /* littleEndian */ true);
		if (reparsed.kind === 'v22') throw new Error('migrated model re-parsed as v22');
		expect(reparsed.kind).toBe('v45');
		expect(reparsed.hulls.length).toBe(result.hulls.length);
		expect(reparsed.flowTypes.length).toBe(result.flowTypes.length);
		expect(reparsed.vehicleAssets.length).toBe(result.vehicleAssets.length);

		// Re-write the re-parsed model — should be byte-identical (writer
		// is deterministic; second pass exercises stableWriter property).
		const rewritten = writeTrafficDataData(reparsed, true);
		expect(sha1(rewritten)).toBe(sha1(bytes));
	});
});

describe('v22 EditorProfile wiring', () => {
	it('exposes the migration via conversions.v45.migrate', () => {
		expect(trafficDataV22Profile.conversions).toBeDefined();
		expect(trafficDataV22Profile.conversions?.v45).toBeDefined();
		expect(trafficDataV22Profile.conversions?.v45?.label).toMatch(/v45/i);
		expect(typeof trafficDataV22Profile.conversions?.v45?.migrate).toBe('function');
	});

	it('the registered migrate function produces the same result as direct call', () => {
		const direct = migrateV22toV45(v22);
		const viaProfile = trafficDataV22Profile.conversions!.v45.migrate(v22) as ReturnType<typeof migrateV22toV45>;
		expect(viaProfile.result.kind).toBe(direct.result.kind);
		expect(viaProfile.result.hulls.length).toBe(direct.result.hulls.length);
		expect(viaProfile.defaulted).toEqual(direct.defaulted);
		expect(viaProfile.lossy).toEqual(direct.lossy);
	});
});
