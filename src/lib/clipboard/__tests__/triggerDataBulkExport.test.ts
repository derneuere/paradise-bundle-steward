import { describe, it, expect } from 'vitest';
import {
	exportTriggerDataBulk,
	type TriggerDataBulkExportInput,
	type WireSpawnLocation,
} from '../triggerDataBulkExport';
import type {
	ParsedTriggerData,
	Vector4,
	Landmark,
	GenericRegion,
	Blackspot,
	VFXBoxRegion,
	SpawnLocation,
	RoamingLocation,
	BoxRegion,
} from '@/lib/core/triggerData';

const vec4 = (n: number): Vector4 => ({ x: n, y: n + 1, z: n + 2, w: n + 3 });

const box = (n: number): BoxRegion => ({
	position: { x: n, y: n, z: n },
	rotation: { x: 0, y: 0, z: 0 },
	dimensions: { x: 1, y: 1, z: 1 },
});

const SPAWN_JUNKYARD_ID = 0x1122334455667788n;

function makeModel(): ParsedTriggerData {
	const landmark: Landmark = {
		box: box(1),
		id: 100,
		regionIndex: 0,
		type: 0,
		enabled: 1,
		startingGrids: [],
		designIndex: 7,
		district: 2,
		flags: 0,
	};
	const genericRegion: GenericRegion = {
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
	};
	const blackspot: Blackspot = {
		box: box(3),
		id: 300,
		regionIndex: 2,
		type: 1,
		enabled: 1,
		scoreType: 0,
		scoreAmount: 5000,
	};
	const vfxBoxRegion: VFXBoxRegion = {
		box: box(4),
		id: 400,
		regionIndex: 3,
		type: 3,
		enabled: 1,
	};
	const spawnLocation: SpawnLocation = {
		position: vec4(10),
		direction: vec4(20),
		junkyardId: SPAWN_JUNKYARD_ID,
		type: 0,
	};
	const roamingLocation: RoamingLocation = {
		position: vec4(30),
		districtIndex: 4,
	};

	return {
		version: 9,
		size: 1024,
		playerStartPosition: vec4(0),
		playerStartDirection: vec4(0),
		landmarks: [landmark],
		onlineLandmarkCount: 0,
		signatureStunts: [],
		genericRegions: [genericRegion],
		killzones: [],
		blackspots: [blackspot],
		vfxBoxRegions: [vfxBoxRegion],
		roamingLocations: [roamingLocation],
		spawnLocations: [spawnLocation],
	};
}

describe('exportTriggerDataBulk', () => {
	it('emits all six kinds in fixed list order regardless of click order', () => {
		const model = makeModel();
		// Selection given in deliberately scrambled order.
		const input: TriggerDataBulkExportInput = {
			model,
			selectedEntries: [
				{ listKey: 'roamingLocations', index: 0 },
				{ listKey: 'landmarks', index: 0 },
				{ listKey: 'spawnLocations', index: 0 },
				{ listKey: 'blackspots', index: 0 },
				{ listKey: 'vfxBoxRegions', index: 0 },
				{ listKey: 'genericRegions', index: 0 },
			],
		};
		const env = exportTriggerDataBulk(input);
		expect(env.items.map((i) => i.listKey)).toEqual([
			'landmarks',
			'genericRegions',
			'blackspots',
			'vfxBoxRegions',
			'spawnLocations',
			'roamingLocations',
		]);
	});

	it('sorts by index ascending within a list and records sourceIndex', () => {
		const model = makeModel();
		// Three landmarks so within-list index ordering is observable.
		model.landmarks = [
			{ ...model.landmarks[0], id: 100 },
			{ ...model.landmarks[0], id: 101 },
			{ ...model.landmarks[0], id: 102 },
		];
		const env = exportTriggerDataBulk({
			model,
			selectedEntries: [
				{ listKey: 'landmarks', index: 2 },
				{ listKey: 'landmarks', index: 0 },
				{ listKey: 'landmarks', index: 1 },
			],
		});
		expect(env.items.map((i) => i.sourceIndex)).toEqual([0, 1, 2]);
		expect(env.items.map((i) => (i.entry as Landmark).id)).toEqual([
			100, 101, 102,
		]);
	});

	it('produces byte-stable JSON for the same selection in different click orders', () => {
		const model = makeModel();
		const selA = exportTriggerDataBulk({
			model,
			selectedEntries: [
				{ listKey: 'spawnLocations', index: 0 },
				{ listKey: 'landmarks', index: 0 },
				{ listKey: 'blackspots', index: 0 },
			],
		});
		const selB = exportTriggerDataBulk({
			model,
			selectedEntries: [
				{ listKey: 'blackspots', index: 0 },
				{ listKey: 'spawnLocations', index: 0 },
				{ listKey: 'landmarks', index: 0 },
			],
		});
		// Stub the volatile field so only ordering/content differences show.
		const stamp = (e: typeof selA) => JSON.stringify({ ...e, exportedAt: '' });
		expect(stamp(selA)).toEqual(stamp(selB));
	});

	it('dedupes identical (listKey,index) selections', () => {
		const model = makeModel();
		const env = exportTriggerDataBulk({
			model,
			selectedEntries: [
				{ listKey: 'landmarks', index: 0 },
				{ listKey: 'landmarks', index: 0 },
				{ listKey: 'landmarks', index: 0 },
			],
		});
		expect(env.items).toHaveLength(1);
	});

	it('skips out-of-range and negative indices', () => {
		const model = makeModel();
		const env = exportTriggerDataBulk({
			model,
			selectedEntries: [
				{ listKey: 'landmarks', index: 0 },
				{ listKey: 'landmarks', index: 5 },
				{ listKey: 'genericRegions', index: -1 },
			],
		});
		expect(env.items).toHaveLength(1);
		expect(env.items[0].listKey).toBe('landmarks');
		expect(env.items[0].sourceIndex).toBe(0);
	});

	it('emits spawn junkyardId as a round-trippable hex string', () => {
		const model = makeModel();
		const env = exportTriggerDataBulk({
			model,
			selectedEntries: [{ listKey: 'spawnLocations', index: 0 }],
		});
		const wire = env.items[0].entry as WireSpawnLocation;
		expect(typeof wire.junkyardId).toBe('string');
		expect(wire.junkyardId).toBe('0x' + SPAWN_JUNKYARD_ID.toString(16));
		expect(BigInt(wire.junkyardId)).toBe(SPAWN_JUNKYARD_ID);
	});

	it('survives JSON.stringify (no bigint leaks through)', () => {
		const model = makeModel();
		const env = exportTriggerDataBulk({
			model,
			selectedEntries: [{ listKey: 'spawnLocations', index: 0 }],
		});
		expect(() => JSON.stringify(env)).not.toThrow();
	});

	it('deep-clones entries so mutating an item never touches the model', () => {
		const model = makeModel();
		const env = exportTriggerDataBulk({
			model,
			selectedEntries: [
				{ listKey: 'landmarks', index: 0 },
				{ listKey: 'spawnLocations', index: 0 },
			],
		});
		const landmarkItem = env.items.find((i) => i.listKey === 'landmarks')!;
		const lmEntry = landmarkItem.entry as Landmark;
		lmEntry.designIndex = 999;
		lmEntry.box.position.x = -1;
		expect(model.landmarks[0].designIndex).toBe(7);
		expect(model.landmarks[0].box.position.x).toBe(1);

		// The spawn item's junkyardId is now a string; the model's stays bigint.
		expect(typeof model.spawnLocations[0].junkyardId).toBe('bigint');
		expect(model.spawnLocations[0].junkyardId).toBe(SPAWN_JUNKYARD_ID);
	});

	it('labels profile from the model version and sets resourceKey', () => {
		const model = makeModel();
		const env = exportTriggerDataBulk({
			model,
			selectedEntries: [{ listKey: 'landmarks', index: 0 }],
		});
		expect(env.profile).toBe('9');
		expect(env.profile).toBe(String(model.version));
		expect(env.resourceKey).toBe('triggerData');
		expect(env.kind).toBe('steward.bulk');
		expect(env.version).toBe(1);
	});

	it('includes sourceBundle only when a filename is provided', () => {
		const model = makeModel();
		const withName = exportTriggerDataBulk({
			model,
			selectedEntries: [{ listKey: 'landmarks', index: 0 }],
			sourceBundleFilename: 'TRK_UNIT01.BNDL',
		});
		const withoutName = exportTriggerDataBulk({
			model,
			selectedEntries: [{ listKey: 'landmarks', index: 0 }],
		});
		expect(withName.sourceBundle).toBe('TRK_UNIT01.BNDL');
		expect('sourceBundle' in withoutName).toBe(false);
	});
});
