// Coverage for the TriggerData bulk-import pipeline.

import { describe, it, expect } from 'vitest';
import {
	parseTriggerDataData,
	writeTriggerDataData,
	type ParsedTriggerData,
	type Vector4,
	type Landmark,
	type GenericRegion,
	type Blackspot,
	type VFXBoxRegion,
	type SpawnLocation,
	type RoamingLocation,
	type BoxRegion,
} from '@/lib/core/triggerData';
import { exportTriggerDataBulk } from '../triggerDataBulkExport';
import type {
	TriggerDataBulkItem,
	TriggerDataBulkListKey,
} from '../triggerDataBulkExport';
import { importTriggerDataBulk } from '../triggerDataBulkImport';
import type { BulkEnvelope } from '../bulkEnvelope';

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

const vec4 = (n: number): Vector4 => ({ x: n, y: n + 1, z: n + 2, w: n + 3 });

const box = (n: number): BoxRegion => ({
	position: { x: n, y: n, z: n },
	rotation: { x: 0, y: 0, z: 0 },
	dimensions: { x: 1, y: 1, z: 1 },
});

function landmark(over: Partial<Landmark> = {}): Landmark {
	return {
		box: box(1),
		id: 100,
		regionIndex: 0,
		type: 0,
		enabled: 1,
		startingGrids: [],
		designIndex: 7,
		district: 2,
		flags: 0,
		...over,
	};
}

function genericRegion(over: Partial<GenericRegion> = {}): GenericRegion {
	return {
		box: box(2),
		id: 200,
		regionIndex: 1,
		type: 2,
		enabled: 1,
		groupId: 42,
		cameraCut1: 0,
		cameraCut2: 0,
		cameraType1: 0,
		cameraType2: 0,
		genericType: 8,
		isOneWay: 0,
		...over,
	};
}

function blackspot(over: Partial<Blackspot> = {}): Blackspot {
	return {
		box: box(3),
		id: 300,
		regionIndex: 2,
		type: 1,
		enabled: 1,
		scoreType: 0,
		scoreAmount: 5000,
		...over,
	};
}

function vfxBoxRegion(over: Partial<VFXBoxRegion> = {}): VFXBoxRegion {
	return {
		box: box(4),
		id: 400,
		regionIndex: 3,
		type: 3,
		enabled: 1,
		...over,
	};
}

function spawnLocation(over: Partial<SpawnLocation> = {}): SpawnLocation {
	return {
		position: vec4(10),
		direction: vec4(20),
		junkyardId: 0x1122334455667788n,
		type: 0,
		...over,
	};
}

function roamingLocation(over: Partial<RoamingLocation> = {}): RoamingLocation {
	return { position: vec4(30), districtIndex: 4, ...over };
}

function makeDestination(over: Partial<ParsedTriggerData> = {}): ParsedTriggerData {
	return {
		version: 9,
		size: 1024,
		playerStartPosition: vec4(0),
		playerStartDirection: vec4(0),
		landmarks: [landmark()],
		onlineLandmarkCount: 1,
		signatureStunts: [],
		genericRegions: [genericRegion()],
		killzones: [],
		blackspots: [blackspot()],
		vfxBoxRegions: [vfxBoxRegion()],
		roamingLocations: [roamingLocation()],
		spawnLocations: [spawnLocation()],
		...over,
	};
}

/** Build an envelope by exporting the named entries from a source model. */
function envelopeFrom(
	source: ParsedTriggerData,
	selected: ReadonlyArray<{ listKey: TriggerDataBulkListKey; index: number }>,
): BulkEnvelope<TriggerDataBulkItem> {
	return exportTriggerDataBulk({ model: source, selectedEntries: selected });
}

/** Max id / regionIndex across the four box-region lists. */
function boxMaxes(td: ParsedTriggerData): { id: number; ri: number } {
	let id = 0;
	let ri = 0;
	for (const list of [td.landmarks, td.genericRegions, td.blackspots, td.vfxBoxRegions]) {
		for (const r of list) {
			if (r.id > id) id = r.id;
			if (r.regionIndex > ri) ri = r.regionIndex;
		}
	}
	return { id, ri };
}

function allBoxRegionIndices(td: ParsedTriggerData): number[] {
	return [
		...td.landmarks.map((r) => r.regionIndex),
		...td.genericRegions.map((r) => r.regionIndex),
		...td.blackspots.map((r) => r.regionIndex),
		...td.vfxBoxRegions.map((r) => r.regionIndex),
	];
}

function allBoxRegionIds(td: ParsedTriggerData): number[] {
	return [
		...td.landmarks.map((r) => r.id),
		...td.genericRegions.map((r) => r.id),
		...td.blackspots.map((r) => r.id),
		...td.vfxBoxRegions.map((r) => r.id),
	];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('importTriggerDataBulk — error paths', () => {
	it('throws on a non-triggerData envelope resourceKey', () => {
		const env: BulkEnvelope<TriggerDataBulkItem> = {
			kind: 'steward.bulk',
			version: 1,
			resourceKey: 'aiSections',
			profile: '9',
			exportedAt: new Date().toISOString(),
			items: [],
		};
		expect(() =>
			importTriggerDataBulk({
				envelope: env,
				destination: makeDestination(),
				mode: 'append',
			}),
		).toThrow(/wrong resourceKey/i);
	});
});

describe('importTriggerDataBulk — profile mismatch', () => {
	it('sets profileMismatch and a note when versions differ, without blocking', () => {
		const source = makeDestination({ version: 7 });
		const env = envelopeFrom(source, [{ listKey: 'genericRegions', index: 0 }]);
		expect(env.profile).toBe('7');
		const out = importTriggerDataBulk({
			envelope: env,
			destination: makeDestination({ version: 9 }),
			mode: 'append',
		});
		expect(out.profileMismatch).toBe(true);
		expect(out.notes.some((n) => /profile/i.test(n))).toBe(true);
		expect(out.result.genericRegions).toHaveLength(2);
	});

	it('clears profileMismatch when versions match', () => {
		const env = envelopeFrom(makeDestination({ version: 9 }), [
			{ listKey: 'genericRegions', index: 0 },
		]);
		const out = importTriggerDataBulk({
			envelope: env,
			destination: makeDestination({ version: 9 }),
			mode: 'append',
		});
		expect(out.profileMismatch).toBe(false);
	});
});

describe('importTriggerDataBulk — append assigns fresh id + regionIndex', () => {
	it('assigns ids/indices strictly above the destination maxes, unique across all four box lists', () => {
		const dest = makeDestination();
		const before = boxMaxes(dest);
		// Import one of every box-region kind from a source model.
		const source = makeDestination();
		const env = envelopeFrom(source, [
			{ listKey: 'landmarks', index: 0 },
			{ listKey: 'genericRegions', index: 0 },
			{ listKey: 'blackspots', index: 0 },
			{ listKey: 'vfxBoxRegions', index: 0 },
		]);
		const out = importTriggerDataBulk({ envelope: env, destination: dest, mode: 'append' });

		const ids = allBoxRegionIds(out.result);
		const indices = allBoxRegionIndices(out.result);

		// The four newly-assigned ids/indices are above the original maxes.
		const newIds = ids.filter((v) => v > before.id);
		const newIndices = indices.filter((v) => v > before.ri);
		expect(newIds).toHaveLength(4);
		expect(newIndices).toHaveLength(4);

		// Unique across the four box lists (writer's region-table sort needs
		// regionIndex unique; ids must not collide with killzone references).
		expect(new Set(ids).size).toBe(ids.length);
		expect(new Set(indices).size).toBe(indices.length);

		// Contiguous range reported.
		expect(out.assignedIdRange).toEqual({ firstId: before.id + 1, lastId: before.id + 4 });
		expect(out.assignedRegionIndexRange).toEqual({ first: before.ri + 1, last: before.ri + 4 });
	});

	it('preserves genericRegion.groupId verbatim', () => {
		const source = makeDestination();
		source.genericRegions = [genericRegion({ groupId: 0xdead })];
		const env = envelopeFrom(source, [{ listKey: 'genericRegions', index: 0 }]);
		const out = importTriggerDataBulk({
			envelope: env,
			destination: makeDestination(),
			mode: 'append',
		});
		const imported = out.result.genericRegions[out.result.genericRegions.length - 1];
		expect(imported.groupId).toBe(0xdead);
	});

	it('restores spawn junkyardId as a bigint and leaves it id/index-free', () => {
		const source = makeDestination();
		source.spawnLocations = [spawnLocation({ junkyardId: 0xaabbccddeeff0011n })];
		const env = envelopeFrom(source, [{ listKey: 'spawnLocations', index: 0 }]);
		const out = importTriggerDataBulk({
			envelope: env,
			destination: makeDestination(),
			mode: 'append',
		});
		const imported = out.result.spawnLocations[out.result.spawnLocations.length - 1];
		expect(typeof imported.junkyardId).toBe('bigint');
		expect(imported.junkyardId).toBe(0xaabbccddeeff0011n);
		// Spawn carries no id/regionIndex; importing one does not assign them.
		expect(out.assignedIdRange).toBeNull();
		expect(out.assignedRegionIndexRange).toBeNull();
	});

	it('leaves onlineLandmarkCount unchanged and notes appended landmarks are offline', () => {
		const dest = makeDestination({ onlineLandmarkCount: 1 });
		const env = envelopeFrom(makeDestination(), [{ listKey: 'landmarks', index: 0 }]);
		const out = importTriggerDataBulk({ envelope: env, destination: dest, mode: 'append' });
		expect(out.result.onlineLandmarkCount).toBe(1);
		expect(out.notes.some((n) => /offline/i.test(n))).toBe(true);
	});

	it('tracks perListCounts', () => {
		const source = makeDestination();
		const env = envelopeFrom(source, [
			{ listKey: 'genericRegions', index: 0 },
			{ listKey: 'blackspots', index: 0 },
			{ listKey: 'spawnLocations', index: 0 },
			{ listKey: 'roamingLocations', index: 0 },
		]);
		const out = importTriggerDataBulk({
			envelope: env,
			destination: makeDestination(),
			mode: 'append',
		});
		expect(out.perListCounts.genericRegions).toBe(1);
		expect(out.perListCounts.blackspots).toBe(1);
		expect(out.perListCounts.spawnLocations).toBe(1);
		expect(out.perListCounts.roamingLocations).toBe(1);
		expect(out.perListCounts.landmarks).toBe(0);
		expect(out.perListCounts.vfxBoxRegions).toBe(0);
	});

	it('does not alias source entries into the destination (deep clone)', () => {
		const source = makeDestination();
		const env = envelopeFrom(source, [{ listKey: 'genericRegions', index: 0 }]);
		const out = importTriggerDataBulk({
			envelope: env,
			destination: makeDestination(),
			mode: 'append',
		});
		const imported = out.result.genericRegions[out.result.genericRegions.length - 1];
		imported.box.position.x = -999;
		expect(source.genericRegions[0].box.position.x).not.toBe(-999);
	});

	it('returns null ranges and unchanged lists for an empty envelope', () => {
		const dest = makeDestination();
		const env = envelopeFrom(makeDestination(), []);
		const out = importTriggerDataBulk({ envelope: env, destination: dest, mode: 'append' });
		expect(out.assignedIdRange).toBeNull();
		expect(out.assignedRegionIndexRange).toBeNull();
		expect(out.result.genericRegions).toHaveLength(1);
		expect(out.result.landmarks).toHaveLength(1);
	});
});

describe('importTriggerDataBulk — replace mode', () => {
	it('empties only the lists present in the envelope, leaving others intact', () => {
		const dest = makeDestination();
		// Import only generic regions; everything else must survive.
		const env = envelopeFrom(makeDestination(), [{ listKey: 'genericRegions', index: 0 }]);
		const out = importTriggerDataBulk({ envelope: env, destination: dest, mode: 'replace' });

		// genericRegions replaced → only the one imported entry.
		expect(out.result.genericRegions).toHaveLength(1);
		// Untouched lists keep the destination's contents.
		expect(out.result.landmarks).toHaveLength(1);
		expect(out.result.blackspots).toHaveLength(1);
		expect(out.result.vfxBoxRegions).toHaveLength(1);
		expect(out.result.spawnLocations).toHaveLength(1);
		expect(out.result.roamingLocations).toHaveLength(1);
	});

	it('reclaims id/index floor from preserved lists, not the emptied one', () => {
		// Destination genericRegion has the highest regionIndex (50). On replace
		// it is emptied, but landmarks/blackspots/vfx still cap the floor.
		const dest = makeDestination({
			genericRegions: [genericRegion({ id: 999, regionIndex: 50 })],
			landmarks: [landmark({ id: 100, regionIndex: 10 })],
			blackspots: [blackspot({ id: 300, regionIndex: 20 })],
			vfxBoxRegions: [vfxBoxRegion({ id: 400, regionIndex: 30 })],
		});
		const env = envelopeFrom(makeDestination(), [{ listKey: 'genericRegions', index: 0 }]);
		const out = importTriggerDataBulk({ envelope: env, destination: dest, mode: 'replace' });
		// Highest surviving regionIndex is 30 (vfx); the import takes 31.
		expect(out.assignedRegionIndexRange).toEqual({ first: 31, last: 31 });
		// Highest surviving id is 400; the import takes 401.
		expect(out.assignedIdRange).toEqual({ firstId: 401, lastId: 401 });
	});
});

describe('importTriggerDataBulk — i16 overflow guard', () => {
	it('throws when the next regionIndex would exceed 32767', () => {
		// Seed the destination with a region already at the i16 max so the next
		// assigned index (32768) overflows.
		const dest = makeDestination({
			genericRegions: [genericRegion({ id: 1, regionIndex: 0x7fff })],
			landmarks: [],
			blackspots: [],
			vfxBoxRegions: [],
		});
		const env = envelopeFrom(makeDestination(), [{ listKey: 'blackspots', index: 0 }]);
		expect(() =>
			importTriggerDataBulk({ envelope: env, destination: dest, mode: 'append' }),
		).toThrow(/regionIndex would overflow i16 \(32767\)/);
	});
});

describe('importTriggerDataBulk — round-trip through the writer', () => {
	it('appends a mixed import and survives writeTriggerDataData → parseTriggerDataData', () => {
		const dest = makeDestination();
		const before = boxMaxes(dest);
		const origGenericId = dest.genericRegions[0].id;
		const origSpawnId = dest.spawnLocations[0].junkyardId;

		// Source carries a distinctive spawn so we can prove its junkyardId
		// survives the hex-string round-trip.
		const source = makeDestination();
		source.spawnLocations = [spawnLocation({ junkyardId: 0x0f0f0f0f0f0f0f0fn })];

		const env = envelopeFrom(source, [
			{ listKey: 'genericRegions', index: 0 },
			{ listKey: 'blackspots', index: 0 },
			{ listKey: 'vfxBoxRegions', index: 0 },
			{ listKey: 'spawnLocations', index: 0 },
		]);
		const out = importTriggerDataBulk({ envelope: env, destination: dest, mode: 'append' });

		// The writer iterates the destination's (empty) killzones/stunts only;
		// imported generic regions are referenced by nobody, so genericOffsets-
		// ById.get is never called for a missing id. Must not throw.
		let bytes: Uint8Array;
		expect(() => {
			bytes = writeTriggerDataData(out.result, true);
		}).not.toThrow();

		const reparsed = parseTriggerDataData(bytes!, true);

		// Appended entries sit at the end of their lists.
		expect(reparsed.genericRegions).toHaveLength(2);
		expect(reparsed.blackspots).toHaveLength(2);
		expect(reparsed.vfxBoxRegions).toHaveLength(2);
		expect(reparsed.spawnLocations).toHaveLength(2);

		// Existing entries unchanged at the head.
		expect(reparsed.genericRegions[0].id).toBe(origGenericId);
		expect(reparsed.spawnLocations[0].junkyardId).toBe(origSpawnId);

		// Imported box-region ids/indices are strictly above the original maxes
		// and unique across the four box lists, even after the writer's
		// regionIndex sort + reparse.
		const ids = allBoxRegionIds(reparsed);
		const indices = allBoxRegionIndices(reparsed);
		expect(new Set(ids).size).toBe(ids.length);
		expect(new Set(indices).size).toBe(indices.length);
		expect(reparsed.genericRegions[1].regionIndex).toBeGreaterThan(before.ri);
		expect(reparsed.blackspots[1].regionIndex).toBeGreaterThan(before.ri);
		expect(reparsed.vfxBoxRegions[1].regionIndex).toBeGreaterThan(before.ri);
		expect(reparsed.genericRegions[1].id).toBeGreaterThan(before.id);

		// Imported spawn junkyardId restored as the correct bigint after the
		// full hex-string export → bigint import → u64 write → u64 read cycle.
		expect(reparsed.spawnLocations[1].junkyardId).toBe(0x0f0f0f0f0f0f0f0fn);
	});

	it('round-trips cleanly when the destination has a killzone referencing a kept region', () => {
		// A destination killzone points at the destination's own generic region.
		// Imported generic regions get fresh ids referenced by nobody — the
		// writer must still resolve the killzone's pointer without throwing.
		const keptGeneric = genericRegion({ id: 200, regionIndex: 1 });
		const dest = makeDestination({
			genericRegions: [keptGeneric],
			killzones: [{ triggerIds: [200], regionIds: [] }],
		});
		const env = envelopeFrom(makeDestination(), [{ listKey: 'genericRegions', index: 0 }]);
		const out = importTriggerDataBulk({ envelope: env, destination: dest, mode: 'append' });

		expect(() => writeTriggerDataData(out.result, true)).not.toThrow();
		const reparsed = parseTriggerDataData(writeTriggerDataData(out.result, true), true);
		// Killzone still resolves to the kept region's id.
		expect(reparsed.killzones[0].triggerIds).toEqual([200]);
		expect(reparsed.genericRegions).toHaveLength(2);
	});
});
