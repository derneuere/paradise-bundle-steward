// Spec for the TriggerData additions to the BulkPanel export helpers.

import { describe, it, expect } from 'vitest';
import {
	triggerBulkPathKeysToEntries,
	buildTriggerEnvelopeFromBulk,
	exportTriggerEnvelopeFilename,
} from '../bulkPanelExport.helpers';
import type { WorkspaceTriggerDataBulkSummary } from '../TriggerDataBulkProvider';
import {
	TriggerRegionType,
	GenericRegionType,
	SpawnType,
	type ParsedTriggerData,
	type Landmark,
	type GenericRegion,
	type SpawnLocation,
} from '@/lib/core/triggerData';

function box() {
	return {
		position: { x: 0, y: 0, z: 0 },
		rotation: { x: 0, y: 0, z: 0 },
		dimensions: { x: 1, y: 1, z: 1 },
	};
}

function landmark(id: number): Landmark {
	return {
		box: box(),
		id,
		regionIndex: id,
		type: TriggerRegionType.E_TYPE_LANDMARK,
		enabled: 1,
		startingGrids: [],
		designIndex: 0,
		district: 0,
		flags: 0,
	};
}

function genericRegion(id: number): GenericRegion {
	return {
		box: box(),
		id,
		regionIndex: id,
		type: TriggerRegionType.E_TYPE_GENERIC_REGION,
		enabled: 1,
		groupId: 0,
		cameraCut1: 0,
		cameraCut2: 0,
		cameraType1: 0,
		cameraType2: 0,
		genericType: GenericRegionType.E_TYPE_JUMP,
		isOneWay: 0,
	};
}

function spawn(junkyardId: bigint): SpawnLocation {
	return {
		position: { x: 0, y: 0, z: 0, w: 1 },
		direction: { x: 1, y: 0, z: 0, w: 0 },
		junkyardId,
		type: SpawnType.E_TYPE_PLAYER_SPAWN,
	};
}

function model(over: Partial<ParsedTriggerData> = {}): ParsedTriggerData {
	return {
		version: 5,
		size: 0,
		playerStartPosition: { x: 0, y: 0, z: 0, w: 1 },
		playerStartDirection: { x: 1, y: 0, z: 0, w: 0 },
		landmarks: [],
		onlineLandmarkCount: 0,
		signatureStunts: [],
		genericRegions: [],
		killzones: [],
		blackspots: [],
		vfxBoxRegions: [],
		roamingLocations: [],
		spawnLocations: [],
		...over,
	};
}

function summary(pathKeys: string[]): WorkspaceTriggerDataBulkSummary {
	return {
		bundleId: 'TRIGGERS.DAT',
		index: 0,
		count: pathKeys.length,
		lastTouchedAt: 1000,
		pathKeys: new Set(pathKeys),
	};
}

describe('triggerBulkPathKeysToEntries', () => {
	it('decodes per-list path keys into {listKey,index} entries', () => {
		const md = model({
			landmarks: [landmark(1), landmark(2)],
			genericRegions: [genericRegion(10)],
		});
		const entries = triggerBulkPathKeysToEntries(
			new Set(['landmarks/0', 'landmarks/1', 'genericRegions/0']),
			md,
		);
		expect(entries).toEqual(
			expect.arrayContaining([
				{ listKey: 'landmarks', index: 0 },
				{ listKey: 'landmarks', index: 1 },
				{ listKey: 'genericRegions', index: 0 },
			]),
		);
		expect(entries).toHaveLength(3);
	});

	it('drops indices out of range for the model', () => {
		const md = model({ landmarks: [landmark(1)] });
		const entries = triggerBulkPathKeysToEntries(
			new Set(['landmarks/0', 'landmarks/5']),
			md,
		);
		expect(entries).toEqual([{ listKey: 'landmarks', index: 0 }]);
	});

	it('drops malformed / non-bulk path keys', () => {
		const md = model({ landmarks: [landmark(1)] });
		const entries = triggerBulkPathKeysToEntries(
			new Set(['playerStartPosition', 'header/flags', 'a/b/c', 'killzones/0']),
			md,
		);
		expect(entries).toEqual([]);
	});
});

describe('buildTriggerEnvelopeFromBulk', () => {
	it('produces a triggerData envelope from model + path keys', () => {
		const md = model({
			landmarks: [landmark(1), landmark(2)],
			genericRegions: [genericRegion(10)],
		});
		const env = buildTriggerEnvelopeFromBulk(
			md,
			summary(['landmarks/0', 'genericRegions/0']),
			'TRIGGERS.DAT',
		);
		expect(env.resourceKey).toBe('triggerData');
		expect(env.profile).toBe('5'); // version coerced to string
		expect(env.sourceBundle).toBe('TRIGGERS.DAT');
		expect(env.items.map((i) => i.listKey)).toEqual(['landmarks', 'genericRegions']);
	});

	it('serialises a spawn junkyardId bigint as a hex string (JSON-safe)', () => {
		const md = model({ spawnLocations: [spawn(0xdeadn)] });
		const env = buildTriggerEnvelopeFromBulk(
			md,
			summary(['spawnLocations/0']),
			'TRIGGERS.DAT',
		);
		// The whole point of the wire conversion: JSON.stringify would throw on
		// a raw bigint. Round-trip through JSON to prove the envelope is safe.
		const json = JSON.stringify(env);
		expect(json).toContain('0xdead');
		const wire = env.items[0].entry as { junkyardId: string };
		expect(wire.junkyardId).toBe('0xdead');
	});
});

describe('exportTriggerEnvelopeFilename', () => {
	it('uses the triggerdata slug with a stable timestamp', () => {
		const d = new Date(2026, 4, 5, 13, 7, 9); // 2026-05-05 13:07:09 local
		expect(exportTriggerEnvelopeFilename('TRIGGERS.DAT', d)).toBe(
			'bulk-triggerdata-TRIGGERS-20260505-130709.json',
		);
	});
});
