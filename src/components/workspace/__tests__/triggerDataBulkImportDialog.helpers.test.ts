// Coverage for TriggerDataBulkImportDialog's pure helpers.

import { describe, it, expect } from 'vitest';
import {
	decodeTriggerEnvelope,
	buildTriggerImportPreview,
	formatTriggerIdLabel,
	defaultTriggerStartId,
	detectTriggerIdCollisions,
	previewBoxRegionCount,
	parseStartingId,
	TRIGGER_PREVIEW_LIST_ORDER,
} from '../triggerDataBulkImportDialog.helpers';
import { parseStartingId as aiParseStartingId } from '../bulkImportDialog.helpers';
import { exportTriggerDataBulk } from '@/lib/clipboard/triggerDataBulkExport';
import type {
	TriggerDataBulkItem,
	TriggerDataBulkListKey,
} from '@/lib/clipboard/triggerDataBulkExport';
import type { BulkEnvelope } from '@/lib/clipboard/bulkEnvelope';
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

// ---------------------------------------------------------------------------
// Builders (mirror the import-pipeline test's fixtures)
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
	return { box: box(4), id: 400, regionIndex: 3, type: 3, enabled: 1, ...over };
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

function envelopeFrom(
	source: ParsedTriggerData,
	selected: ReadonlyArray<{ listKey: TriggerDataBulkListKey; index: number }>,
): BulkEnvelope<TriggerDataBulkItem> {
	return exportTriggerDataBulk({ model: source, selectedEntries: selected });
}

// ---------------------------------------------------------------------------
// decodeTriggerEnvelope
// ---------------------------------------------------------------------------

describe('decodeTriggerEnvelope', () => {
	it('accepts a well-formed triggerData envelope', () => {
		const env = envelopeFrom(makeDestination(), [{ listKey: 'genericRegions', index: 0 }]);
		const raw = JSON.stringify(env);
		const decoded = decodeTriggerEnvelope(raw);
		expect(decoded.ok).toBe(true);
		if (decoded.ok) {
			expect(decoded.envelope.resourceKey).toBe('triggerData');
			expect(decoded.envelope.items).toHaveLength(1);
		}
	});

	it('rejects an envelope for a different resource (aiSections)', () => {
		const env: BulkEnvelope = {
			kind: 'steward.bulk',
			version: 1,
			resourceKey: 'aiSections',
			profile: 'v12',
			exportedAt: new Date().toISOString(),
			items: [],
		};
		const decoded = decodeTriggerEnvelope(JSON.stringify(env));
		expect(decoded.ok).toBe(false);
		if (!decoded.ok) {
			expect(decoded.reason).toMatch(/aiSections/);
			expect(decoded.reason).toMatch(/expected triggerData/);
		}
	});

	it('rejects malformed JSON, surfacing the decoder reason', () => {
		const decoded = decodeTriggerEnvelope('{ not json ');
		expect(decoded.ok).toBe(false);
		if (!decoded.ok) expect(decoded.reason).toMatch(/not valid json/i);
	});

	it('rejects a non-bulk JSON object', () => {
		const decoded = decodeTriggerEnvelope(JSON.stringify({ hello: 'world' }));
		expect(decoded.ok).toBe(false);
		if (!decoded.ok) expect(decoded.reason).toMatch(/steward\.bulk|kind/i);
	});
});

// ---------------------------------------------------------------------------
// buildTriggerImportPreview
// ---------------------------------------------------------------------------

describe('buildTriggerImportPreview', () => {
	it('counts per list in canonical order with zero-filled absent lists', () => {
		const env = envelopeFrom(makeDestination(), [
			{ listKey: 'genericRegions', index: 0 },
			{ listKey: 'blackspots', index: 0 },
			{ listKey: 'spawnLocations', index: 0 },
		]);
		const preview = buildTriggerImportPreview(env, makeDestination(), 'append');
		expect(preview.error).toBeNull();
		expect(preview.total).toBe(3);
		expect(preview.perList.map((l) => l.listKey)).toEqual([...TRIGGER_PREVIEW_LIST_ORDER]);
		const byKey = Object.fromEntries(preview.perList.map((l) => [l.listKey, l.count]));
		expect(byKey.genericRegions).toBe(1);
		expect(byKey.blackspots).toBe(1);
		expect(byKey.spawnLocations).toBe(1);
		expect(byKey.landmarks).toBe(0);
		expect(byKey.vfxBoxRegions).toBe(0);
		expect(byKey.roamingLocations).toBe(0);
	});

	it('reports the box-region id + regionIndex ranges that confirm will assign', () => {
		// Destination box maxes: ids 100/200/300/400, regionIndex 0/1/2/3 → max id
		// 400, max regionIndex 3. Importing two box regions takes 401..402 / 4..5.
		const env = envelopeFrom(makeDestination(), [
			{ listKey: 'genericRegions', index: 0 },
			{ listKey: 'blackspots', index: 0 },
		]);
		const preview = buildTriggerImportPreview(env, makeDestination(), 'append');
		expect(preview.assignedIdRange).toEqual({ firstId: 401, lastId: 402 });
		expect(preview.assignedRegionIndexRange).toEqual({ first: 4, last: 5 });
	});

	it('returns null id/index ranges for a spawn-only import (no box region)', () => {
		const env = envelopeFrom(makeDestination(), [{ listKey: 'spawnLocations', index: 0 }]);
		const preview = buildTriggerImportPreview(env, makeDestination(), 'append');
		expect(preview.total).toBe(1);
		expect(preview.assignedIdRange).toBeNull();
		expect(preview.assignedRegionIndexRange).toBeNull();
	});

	it('append vs replace differ: replace reclaims the floor from preserved lists', () => {
		const dest = makeDestination({
			genericRegions: [genericRegion({ id: 999, regionIndex: 50 })],
			landmarks: [landmark({ id: 100, regionIndex: 10 })],
			blackspots: [blackspot({ id: 300, regionIndex: 20 })],
			vfxBoxRegions: [vfxBoxRegion({ id: 400, regionIndex: 30 })],
		});
		const env = envelopeFrom(makeDestination(), [{ listKey: 'genericRegions', index: 0 }]);

		const appendPreview = buildTriggerImportPreview(env, dest, 'append');
		// Append counts the emptied generic region's 999/50 — next is 1000/51.
		expect(appendPreview.assignedIdRange).toEqual({ firstId: 1000, lastId: 1000 });
		expect(appendPreview.assignedRegionIndexRange).toEqual({ first: 51, last: 51 });

		const replacePreview = buildTriggerImportPreview(env, dest, 'replace');
		// Replace empties genericRegions; floor falls to the surviving lists'
		// max (id 400, regionIndex 30) → next is 401/31.
		expect(replacePreview.assignedIdRange).toEqual({ firstId: 401, lastId: 401 });
		expect(replacePreview.assignedRegionIndexRange).toEqual({ first: 31, last: 31 });
	});

	it('surfaces profileMismatch + a note when source version differs', () => {
		const env = envelopeFrom(makeDestination({ version: 7 }), [
			{ listKey: 'genericRegions', index: 0 },
		]);
		expect(env.profile).toBe('7');
		const preview = buildTriggerImportPreview(env, makeDestination({ version: 9 }), 'append');
		expect(preview.profileMismatch).toBe(true);
		expect(preview.notes.some((n) => /profile/i.test(n))).toBe(true);
	});

	it('clears profileMismatch when source and destination versions match', () => {
		const env = envelopeFrom(makeDestination({ version: 9 }), [
			{ listKey: 'genericRegions', index: 0 },
		]);
		const preview = buildTriggerImportPreview(env, makeDestination({ version: 9 }), 'append');
		expect(preview.profileMismatch).toBe(false);
	});

	it('seeds the previewed assignedIdRange from a supplied startId', () => {
		const env = envelopeFrom(makeDestination(), [
			{ listKey: 'genericRegions', index: 0 },
			{ listKey: 'blackspots', index: 0 },
		]);
		const preview = buildTriggerImportPreview(env, makeDestination(), 'append', 0x90000000);
		expect(preview.assignedIdRange).toEqual({ firstId: 0x90000000, lastId: 0x90000001 });
		// regionIndex stays on the auto path (dest max 3 → 4..5), unaffected by startId.
		expect(preview.assignedRegionIndexRange).toEqual({ first: 4, last: 5 });
	});

	it('falls back to the default id range when startId is omitted', () => {
		const env = envelopeFrom(makeDestination(), [{ listKey: 'genericRegions', index: 0 }]);
		const withStart = buildTriggerImportPreview(env, makeDestination(), 'append');
		// Dest box max id is 400 → default base 401.
		expect(withStart.assignedIdRange).toEqual({ firstId: 401, lastId: 401 });
	});

	it('captures the i16 overflow as an error instead of throwing', () => {
		const dest = makeDestination({
			genericRegions: [genericRegion({ id: 1, regionIndex: 0x7fff })],
			landmarks: [],
			blackspots: [],
			vfxBoxRegions: [],
		});
		const env = envelopeFrom(makeDestination(), [{ listKey: 'blackspots', index: 0 }]);
		const preview = buildTriggerImportPreview(env, dest, 'append');
		expect(preview.error).toMatch(/regionIndex would overflow i16/);
		expect(preview.assignedIdRange).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// parseStartingId (re-exported from the AI dialog — one shared parser)
// ---------------------------------------------------------------------------

describe('parseStartingId re-export', () => {
	it('is the SAME function the AI dialog uses', () => {
		expect(parseStartingId).toBe(aiParseStartingId);
	});

	it('parses decimal and 0x hex, returning null on garbage', () => {
		expect(parseStartingId('12345')).toBe(12345);
		expect(parseStartingId('0x90000000')).toBe(0x90000000);
		expect(parseStartingId('  0xFF  ')).toBe(0xff);
		expect(parseStartingId('')).toBeNull();
		expect(parseStartingId('nope')).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// defaultTriggerStartId
// ---------------------------------------------------------------------------

describe('defaultTriggerStartId', () => {
	it('returns max box-region id + 1 across all four box lists', () => {
		// makeDestination box ids: 100 / 200 / 300 / 400 → default 401.
		expect(defaultTriggerStartId(makeDestination())).toBe(401);
	});

	it('picks the max from whichever box list holds it', () => {
		const dest = makeDestination({
			landmarks: [landmark({ id: 9999 })],
			genericRegions: [genericRegion({ id: 200 })],
			blackspots: [blackspot({ id: 300 })],
			vfxBoxRegions: [vfxBoxRegion({ id: 400 })],
		});
		expect(defaultTriggerStartId(dest)).toBe(10000);
	});

	it('returns 0 when the destination has no box regions', () => {
		const dest = makeDestination({
			landmarks: [],
			genericRegions: [],
			blackspots: [],
			vfxBoxRegions: [],
		});
		expect(defaultTriggerStartId(dest)).toBe(0);
	});

	it('ignores spawn / roaming lists (they carry no mId)', () => {
		const dest = makeDestination({
			landmarks: [],
			genericRegions: [],
			blackspots: [],
			vfxBoxRegions: [],
			spawnLocations: [spawnLocation(), spawnLocation()],
			roamingLocations: [roamingLocation()],
		});
		expect(defaultTriggerStartId(dest)).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// detectTriggerIdCollisions
// ---------------------------------------------------------------------------

describe('detectTriggerIdCollisions', () => {
	it('returns box-region ids in [startId, startId+count-1] that already exist, sorted asc', () => {
		// Box ids present: 100 / 200 / 300 / 400. Range [200, 202] hits 200 only.
		expect(detectTriggerIdCollisions(makeDestination(), 200, 3)).toEqual([200]);
		// Range [98, 102] hits 100.
		expect(detectTriggerIdCollisions(makeDestination(), 98, 5)).toEqual([100]);
	});

	it('detects multiple collisions across the four box lists', () => {
		const dest = makeDestination({
			landmarks: [landmark({ id: 10 })],
			genericRegions: [genericRegion({ id: 11 })],
			blackspots: [blackspot({ id: 12 })],
			vfxBoxRegions: [vfxBoxRegion({ id: 20 })],
		});
		expect(detectTriggerIdCollisions(dest, 10, 11)).toEqual([10, 11, 12, 20]);
	});

	it('returns [] when the range clears every existing id', () => {
		expect(detectTriggerIdCollisions(makeDestination(), 0x90000000, 4)).toEqual([]);
	});

	it('returns [] for a zero box-region count', () => {
		expect(detectTriggerIdCollisions(makeDestination(), 100, 0)).toEqual([]);
	});

	it('does not treat spawn / roaming entries as id collisions', () => {
		// spawn / roaming carry no mId; a starting id in their range never collides.
		const dest = makeDestination({
			landmarks: [],
			genericRegions: [],
			blackspots: [],
			vfxBoxRegions: [],
		});
		expect(detectTriggerIdCollisions(dest, 0, 100)).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// previewBoxRegionCount
// ---------------------------------------------------------------------------

describe('previewBoxRegionCount', () => {
	it('sums only the four box-region lists, excluding spawn / roaming', () => {
		const env = envelopeFrom(makeDestination(), [
			{ listKey: 'landmarks', index: 0 },
			{ listKey: 'genericRegions', index: 0 },
			{ listKey: 'spawnLocations', index: 0 },
			{ listKey: 'roamingLocations', index: 0 },
		]);
		const preview = buildTriggerImportPreview(env, makeDestination(), 'append');
		// 2 box regions (landmark + generic); spawn + roaming excluded.
		expect(previewBoxRegionCount(preview)).toBe(2);
	});

	it('is 0 for a spawn-only import', () => {
		const env = envelopeFrom(makeDestination(), [{ listKey: 'spawnLocations', index: 0 }]);
		const preview = buildTriggerImportPreview(env, makeDestination(), 'append');
		expect(previewBoxRegionCount(preview)).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// formatTriggerIdLabel
// ---------------------------------------------------------------------------

describe('formatTriggerIdLabel', () => {
	it('formats hex + decimal', () => {
		expect(formatTriggerIdLabel(0x9000)).toBe('0x9000 (36864)');
		expect(formatTriggerIdLabel(0)).toBe('0x0 (0)');
	});
});
