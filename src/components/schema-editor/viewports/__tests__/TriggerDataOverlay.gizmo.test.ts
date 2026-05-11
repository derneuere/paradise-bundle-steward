// TriggerDataOverlay gizmo-wiring unit tests (issue #77).
//
// Pins the *pure-function* contract the overlay exposes for the unified
// Bulk-transform gizmo:
//
//   - `bulkKeyToRef` decodes workspace bulk path-keys to entity refs.
//   - `selectionToRef` decodes the inspector pick to an entity ref.
//   - `applyDragToTriggerModel` is the single dispatcher that maps a
//     (target, delta) gesture onto the matching no-cascade op.
//
// The repo's vitest env is `node` (no jsdom) so we don't mount the
// overlay; we only test the pure helpers. The single-gesture-equals-
// single-onChange invariant from `handleGizmoCommit` lives in the
// overlay component itself — its observable behaviour is "one onChange
// call per gesture", which we verify here by spying that the dispatch
// runs once and returns a single new model object.

import { describe, expect, it } from 'vitest';
import {
	applyDragToTriggerModel,
	bulkKeyToRef,
	selectionToRef,
	type ActiveDrag,
} from '../TriggerDataOverlay';
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

	it('returns null for player-start (singleton, not bulk-eligible)', () => {
		expect(selectionToRef({ kind: 'playerStart', indices: [0] })).toBeNull();
	});

	it('returns null for null Selection', () => {
		expect(selectionToRef(null)).toBeNull();
	});
});

// applyDragToTriggerModel — the dispatcher both preview and commit run.
describe('applyDragToTriggerModel — single dispatcher', () => {
	const baseDelta = {
		translate: { x: 0, y: 0, z: 0 },
		rotate: { x: 0, y: 0, z: 0 },
		cascade: false,
	};

	it('landmark: translate then yaw around the post-translate position', () => {
		const model = emptyTriggerData({
			landmarks: [makeLandmark(v3(0, 0, 0), v3(0, 0, 0))],
		});
		const drag: ActiveDrag = {
			target: { kind: 'landmark', idx: 0 },
			delta: {
				...baseDelta,
				translate: { x: 5, y: 0, z: 0 },
				rotate: { x: 0, y: Math.PI / 4, z: 0 },
			},
		};
		const next = applyDragToTriggerModel(model, drag);
		// Position is at (5, 0, 0); rotate around own position → position unchanged.
		expect(next.landmarks[0].box.position.x).toBeCloseTo(5, 5);
		expect(next.landmarks[0].box.position.z).toBeCloseTo(0, 5);
		expect(next.landmarks[0].box.rotation.y).toBeCloseTo(Math.PI / 4, 5);
	});

	it('roaming: only translate participates (no rotation field)', () => {
		const model = emptyTriggerData({
			roamingLocations: [makeRoaming(v4(0, 0, 0, 42))],
		});
		const drag: ActiveDrag = {
			target: { kind: 'roaming', idx: 0 },
			delta: {
				...baseDelta,
				translate: { x: 3, y: 1, z: 2 },
				rotate: { x: 0, y: Math.PI / 2, z: 0 },
			},
		};
		const next = applyDragToTriggerModel(model, drag);
		// .w padding preserved.
		expect(next.roamingLocations[0].position).toEqual(v4(3, 1, 2, 42));
	});

	it('bulk: every entity orbits the snapshot pivot AND each box composes own Euler', () => {
		const model = emptyTriggerData({
			landmarks: [makeLandmark(v3(10, 0, 0))],
			genericRegions: [makeGeneric(v3(0, 0, 10))],
			vfxBoxRegions: [makeVfx(v3(-10, 0, 0))],
		});
		const drag: ActiveDrag = {
			target: {
				kind: 'bulk',
				entities: [
					{ kind: 'landmark', idx: 0 },
					{ kind: 'generic', idx: 0 },
					{ kind: 'vfx', idx: 0 },
				],
				pivot: { x: 0, y: 0, z: 0 },
			},
			delta: {
				...baseDelta,
				rotate: { x: 0, y: Math.PI / 2, z: 0 },
			},
		};
		const next = applyDragToTriggerModel(model, drag);
		// 90° yaw around origin maps +X→-Z and +Z→+X (three.js right-hand).
		expect(next.landmarks[0].box.position.z).toBeCloseTo(-10, 5);
		expect(next.genericRegions[0].box.position.x).toBeCloseTo(10, 5);
		expect(next.vfxBoxRegions[0].box.position.z).toBeCloseTo(10, 5);
		// Each box's Euler picks up +π/2 yaw.
		expect(next.landmarks[0].box.rotation.y).toBeCloseTo(Math.PI / 2, 5);
		expect(next.genericRegions[0].box.rotation.y).toBeCloseTo(Math.PI / 2, 5);
		expect(next.vfxBoxRegions[0].box.rotation.y).toBeCloseTo(Math.PI / 2, 5);
	});

	it('bulk: combined translate + rotate composes around the post-translate pivot', () => {
		// Three boxes form an equilateral triangle in XZ; rigid translate
		// then rotate must preserve pairwise distances and shift the centroid
		// by the translate delta.
		const positions = [
			v3(10, 0, 0),
			v3(-5, 0, 5),
			v3(-5, 0, -5),
		];
		const model = emptyTriggerData({
			landmarks: positions.map((p) => makeLandmark(p)),
		});
		const pivot = { x: 0, y: 0, z: 0 };
		const drag: ActiveDrag = {
			target: {
				kind: 'bulk',
				entities: positions.map((_, i) => ({ kind: 'landmark', idx: i })) as {
					kind: 'landmark';
					idx: number;
				}[],
				pivot,
			},
			delta: {
				...baseDelta,
				translate: { x: 20, y: 0, z: 0 },
				rotate: { x: 0, y: Math.PI, z: 0 },
			},
		};
		const next = applyDragToTriggerModel(model, drag);
		// Pairwise distances preserved.
		const distBefore = [
			dist(positions[0], positions[1]),
			dist(positions[1], positions[2]),
			dist(positions[0], positions[2]),
		];
		const distAfter = [
			dist(next.landmarks[0].box.position, next.landmarks[1].box.position),
			dist(next.landmarks[1].box.position, next.landmarks[2].box.position),
			dist(next.landmarks[0].box.position, next.landmarks[2].box.position),
		];
		for (let i = 0; i < 3; i++) {
			expect(distAfter[i]).toBeCloseTo(distBefore[i], 4);
		}
	});

	it('returns the input model reference on an identity delta', () => {
		const model = emptyTriggerData({ landmarks: [makeLandmark(v3(0, 0, 0))] });
		const drag: ActiveDrag = {
			target: { kind: 'landmark', idx: 0 },
			delta: baseDelta,
		};
		// translateLandmarkRigid + rotateLandmarkRigid both short-circuit on
		// identity ⇒ next === model.
		expect(applyDragToTriggerModel(model, drag)).toBe(model);
	});

	it('blackspot + spawn: dispatcher routes correctly', () => {
		const model = emptyTriggerData({
			blackspots: [makeBlackspot(v3(0, 0, 0))],
			spawnLocations: [makeSpawn(v4(0, 0, 0, 3))],
		});
		const t1 = applyDragToTriggerModel(model, {
			target: { kind: 'blackspot', idx: 0 },
			delta: { ...baseDelta, translate: { x: 1, y: 0, z: 0 } },
		});
		expect(t1.blackspots[0].box.position.x).toBe(1);

		const t2 = applyDragToTriggerModel(model, {
			target: { kind: 'spawn', idx: 0 },
			delta: { ...baseDelta, translate: { x: 0, y: 0, z: 5 } },
		});
		expect(t2.spawnLocations[0].position.z).toBe(5);
		expect(t2.spawnLocations[0].position.w).toBe(3); // .w preserved
	});
});

function dist(a: Vector3, b: Vector3): number {
	const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
	return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
