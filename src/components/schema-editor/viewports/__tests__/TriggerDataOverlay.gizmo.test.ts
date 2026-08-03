// TriggerDataOverlay gizmo-wiring unit tests (issue #77).
//
// Pins the *pure-function* contract the overlay exposes for the unified
// Bulk-transform gizmo:
//
//   - `bulkKeyToRef` decodes workspace bulk path-keys to `TriggerDataRef`s.
//   - `selectionToRef` decodes the inspector pick to a `TriggerDataRef`.
//   - both feed the shared transform core unchanged.
//
// The overlay no longer owns a translate/rotate dispatcher: the gesture goes
// straight to `transform(data, refs, delta, triggerDataResolver)`. What that
// gesture does to the model is pinned once, in
// `src/lib/core/transform/__tests__/resolvers/triggerData.test.ts`; what is
// left here is the ref plumbing plus one end-to-end check that the refs this
// overlay produces are the refs the resolver accepts.
//
// The repo's vitest env is `node` (no jsdom) so we don't mount the overlay.

import { describe, expect, it } from 'vitest';
import { bulkKeyToRef, selectionToRef } from '../TriggerDataOverlay';
import { transform } from '@/lib/core/transform';
import { triggerDataResolver } from '@/lib/core/transform/resolvers/triggerData';
import type {
	Landmark,
	GenericRegion,
	Blackspot,
	VFXBoxRegion,
	RoamingLocation,
	SpawnLocation,
	ParsedTriggerData,
	BoxRegion,
	Vector3,
	Vector4,
} from '@/lib/core/triggerData';
import {
	GenericRegionType,
	StuntCameraType,
	TriggerRegionType,
} from '@/lib/core/triggerData';
import type { Selection } from '../selection';

function v3(x: number, y: number, z: number): Vector3 {
	return { x, y, z };
}
function v4(x: number, y: number, z: number, w: number = 0): Vector4 {
	return { x, y, z, w };
}
function makeBox(pos: Vector3, rot: Vector3 = v3(0, 0, 0)): BoxRegion {
	return { position: pos, rotation: rot, dimensions: v3(2, 2, 2) };
}
function makeLandmark(pos: Vector3, rot: Vector3 = v3(0, 0, 0)): Landmark {
	return {
		box: makeBox(pos, rot),
		id: 1,
		regionIndex: 0,
		type: TriggerRegionType.E_TYPE_LANDMARK,
		enabled: 1,
		startingGrids: [],
		designIndex: 0,
		district: 0,
		flags: 0,
	};
}
function makeGeneric(pos: Vector3): GenericRegion {
	return {
		box: makeBox(pos),
		id: 2,
		regionIndex: 0,
		type: TriggerRegionType.E_TYPE_GENERIC_REGION,
		enabled: 1,
		groupId: 0,
		cameraCut1: 0,
		cameraCut2: 0,
		cameraType1: StuntCameraType.E_STUNT_CAMERA_TYPE_NO_CUTS,
		cameraType2: StuntCameraType.E_STUNT_CAMERA_TYPE_NO_CUTS,
		genericType: GenericRegionType.E_TYPE_JUNK_YARD,
		isOneWay: 0,
	};
}
function makeBlackspot(pos: Vector3): Blackspot {
	return {
		box: makeBox(pos),
		id: 3,
		regionIndex: 0,
		type: TriggerRegionType.E_TYPE_BLACKSPOT,
		enabled: 1,
		scoreType: 0,
		scoreAmount: 0,
	};
}
function makeVfx(pos: Vector3): VFXBoxRegion {
	return {
		box: makeBox(pos),
		id: 4,
		regionIndex: 0,
		type: TriggerRegionType.E_TYPE_VFXBOX_REGION,
		enabled: 1,
	};
}
function makeRoaming(pos: Vector4): RoamingLocation {
	return { position: pos, districtIndex: 0 };
}
function makeSpawn(pos: Vector4): SpawnLocation {
	return {
		position: pos,
		direction: v4(1, 0, 0),
		junkyardId: 0n,
		type: 0 as SpawnLocation['type'],
	};
}

function emptyTriggerData(over: Partial<ParsedTriggerData> = {}): ParsedTriggerData {
	return {
		version: 0,
		size: 0,
		playerStartPosition: v4(0, 0, 0),
		playerStartDirection: v4(1, 0, 0),
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

describe('bulkKeyToRef', () => {
	it('maps every bulk-eligible list key to the matching ref', () => {
		expect(bulkKeyToRef('landmarks/3')).toEqual({ kind: 'landmark', idx: 3 });
		expect(bulkKeyToRef('genericRegions/5')).toEqual({ kind: 'generic', idx: 5 });
		expect(bulkKeyToRef('blackspots/0')).toEqual({ kind: 'blackspot', idx: 0 });
		expect(bulkKeyToRef('vfxBoxRegions/7')).toEqual({ kind: 'vfx', idx: 7 });
		expect(bulkKeyToRef('roamingLocations/2')).toEqual({ kind: 'roaming', idx: 2 });
		expect(bulkKeyToRef('spawnLocations/9')).toEqual({ kind: 'spawn', idx: 9 });
	});

	it('returns null for unknown list keys', () => {
		expect(bulkKeyToRef('header/0')).toBeNull();
		expect(bulkKeyToRef('signatureStunts/0')).toBeNull();
	});

	it('returns null for malformed keys', () => {
		expect(bulkKeyToRef('')).toBeNull();
		expect(bulkKeyToRef('landmarks')).toBeNull(); // no slash
		expect(bulkKeyToRef('landmarks/abc')).toBeNull(); // non-numeric
		expect(bulkKeyToRef('landmarks/-1')).toBeNull(); // negative
	});
});

describe('selectionToRef', () => {
	it('maps every bulk-eligible Selection.kind to the matching ref', () => {
		const cases: Array<[Selection, ReturnType<typeof selectionToRef>]> = [
			[{ kind: 'landmark', indices: [3] }, { kind: 'landmark', idx: 3 }],
			[{ kind: 'generic', indices: [5] }, { kind: 'generic', idx: 5 }],
			[{ kind: 'blackspot', indices: [0] }, { kind: 'blackspot', idx: 0 }],
			[{ kind: 'vfx', indices: [7] }, { kind: 'vfx', idx: 7 }],
			[{ kind: 'roaming', indices: [2] }, { kind: 'roaming', idx: 2 }],
			[{ kind: 'spawn', indices: [9] }, { kind: 'spawn', idx: 9 }],
		];
		for (const [sel, expected] of cases) {
			expect(selectionToRef(sel)).toEqual(expected);
		}
	});

	it('decodes player-start to its own (non-transformable) ref kind', () => {
		// The gold cone is selectable; it just expands to zero slots, so the
		// resolver — not this codec — is where "no gizmo" is decided.
		expect(selectionToRef({ kind: 'playerStart', indices: [0] })).toEqual({ kind: 'playerStart' });
	});

	it('returns null for null Selection', () => {
		expect(selectionToRef(null)).toBeNull();
	});
});

// The overlay's refs must be exactly what the shared resolver consumes — a
// mismatch here would show up as a gizmo that moves nothing.
describe('overlay refs feed the shared transform', () => {
	it('translates the entities addressed by decoded bulk keys and the inspector pick', () => {
		const model = emptyTriggerData({
			landmarks: [makeLandmark(v3(0, 0, 0)), makeLandmark(v3(100, 0, 0))],
			roamingLocations: [makeRoaming(v4(0, 0, 0, 42))],
		});
		const refs = [
			bulkKeyToRef('landmarks/0')!,
			bulkKeyToRef('roamingLocations/0')!,
			// The inspector pick duplicates a bulk entry — the overlay unions the
			// two sources, so the same entity routinely arrives twice.
			selectionToRef({ kind: 'landmark', indices: [0] })!,
		];
		const next = transform(
			model,
			refs,
			{ translate: { x: 5, y: 0, z: 0 }, rotate: { x: 0, y: 0, z: 0 }, pivot: null },
			triggerDataResolver,
		);
		expect(next.landmarks[0].box.position.x).toBe(5);
		expect(next.landmarks[1]).toBe(model.landmarks[1]);
		expect(next.roamingLocations[0].position).toEqual(v4(5, 0, 0, 42));
	});

	it('renders no gesture at all for a player-start-only selection', () => {
		const model = emptyTriggerData({ landmarks: [makeLandmark(v3(0, 0, 0))] });
		const refs = [selectionToRef({ kind: 'playerStart', indices: [0] })!];
		expect(triggerDataResolver.axes(refs)).toBeNull();
		const next = transform(
			model,
			refs,
			{ translate: { x: 5, y: 5, z: 5 }, rotate: { x: 0, y: 0, z: 0 }, pivot: null },
			triggerDataResolver,
		);
		expect(next).toBe(model);
	});
});

function dist(a: Vector3, b: Vector3): number {
	const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
	return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
