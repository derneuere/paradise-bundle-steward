// Bulk-transform multi-Selection ops for trigger boxes (issue #77).
//
// Pins the rigid-body invariants every higher slice (overlay, gizmo,
// undo stack) relies on:
//
//   - Bulk translate shifts every entity by the same delta (relative
//     positions preserved exactly).
//   - Bulk rotate orbits each position around the shared pivot AND
//     composes the delta Euler into each box's own orientation.
//   - Pairwise distances between box positions are preserved across a
//     bulk rotate (the rigid-body property).
//   - Identity gestures return the input `model` reference (byte-for-byte
//     writeback invariant).

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
	bulkRotateTriggerBoxes,
	bulkTranslateTriggerBoxes,
	bulkTriggerBoxPivot,
	type TriggerBoxEntityRef,
} from './bulk';
import { TRIGGER_BOX_EULER_ORDER } from './translateRigid';
import type {
	Blackspot,
	BoxRegion,
	GenericRegion,
	Landmark,
	ParsedTriggerData,
	RoamingLocation,
	SpawnLocation,
	VFXBoxRegion,
	Vector3,
	Vector4,
} from '../triggerData';
import {
	GenericRegionType,
	StuntCameraType,
	TriggerRegionType,
} from '../triggerData';

// ---------------------------------------------------------------------------
// Fixture builders — same shape as triggerData fixtures in the overlay test.
// ---------------------------------------------------------------------------

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
function makeGeneric(pos: Vector3, rot: Vector3 = v3(0, 0, 0)): GenericRegion {
	return {
		box: makeBox(pos, rot),
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

// ---------------------------------------------------------------------------
// bulkTriggerBoxPivot — median per-component across selected refs.
// ---------------------------------------------------------------------------

describe('bulkTriggerBoxPivot', () => {
	it('returns the median across box positions', () => {
		const model = emptyTriggerData({
			landmarks: [
				makeLandmark(v3(0, 0, 0)),
				makeLandmark(v3(10, 0, 10)),
				makeLandmark(v3(100, 0, 100)),
			],
		});
		const refs: TriggerBoxEntityRef[] = [
			{ kind: 'landmark', idx: 0 },
			{ kind: 'landmark', idx: 1 },
			{ kind: 'landmark', idx: 2 },
		];
		expect(bulkTriggerBoxPivot(model, refs)).toEqual(v3(10, 0, 10));
	});

	it('mixes box-positions and Vector4 positions', () => {
		const model = emptyTriggerData({
			landmarks: [makeLandmark(v3(0, 0, 0))],
			roamingLocations: [makeRoaming(v4(20, 4, 20))],
		});
		const refs: TriggerBoxEntityRef[] = [
			{ kind: 'landmark', idx: 0 },
			{ kind: 'roaming', idx: 0 },
		];
		// Median of [0, 20] = 10, [0, 4] = 2, [0, 20] = 10.
		expect(bulkTriggerBoxPivot(model, refs)).toEqual(v3(10, 2, 10));
	});

	it('returns null on empty refs list', () => {
		expect(bulkTriggerBoxPivot(emptyTriggerData(), [])).toBeNull();
	});

	it('skips out-of-range refs', () => {
		const model = emptyTriggerData({ landmarks: [makeLandmark(v3(5, 0, 5))] });
		const refs: TriggerBoxEntityRef[] = [
			{ kind: 'landmark', idx: 0 },
			{ kind: 'landmark', idx: 99 },
		];
		expect(bulkTriggerBoxPivot(model, refs)).toEqual(v3(5, 0, 5));
	});
});

// ---------------------------------------------------------------------------
// bulkTranslateTriggerBoxes — every entity shifts by the same offset.
// ---------------------------------------------------------------------------

describe('bulkTranslateTriggerBoxes', () => {
	it('shifts every selected entity, leaves unselected entities untouched', () => {
		const model = emptyTriggerData({
			landmarks: [makeLandmark(v3(0, 0, 0)), makeLandmark(v3(10, 0, 10))],
			genericRegions: [makeGeneric(v3(50, 0, 50))],
			roamingLocations: [makeRoaming(v4(100, 0, 100, 5))],
		});
		const refs: TriggerBoxEntityRef[] = [
			{ kind: 'landmark', idx: 0 },
			{ kind: 'generic', idx: 0 },
			{ kind: 'roaming', idx: 0 },
		];
		const next = bulkTranslateTriggerBoxes(model, refs, { x: 3, y: 1, z: -2 });
		expect(next.landmarks[0].box.position).toEqual(v3(3, 1, -2));
		expect(next.landmarks[1]).toBe(model.landmarks[1]); // untouched ref
		expect(next.genericRegions[0].box.position).toEqual(v3(53, 1, 48));
		expect(next.roamingLocations[0].position).toEqual(v4(103, 1, 98, 5));
	});

	it('preserves rotation and dimensions on every box', () => {
		const model = emptyTriggerData({
			landmarks: [makeLandmark(v3(0, 0, 0), v3(0.1, 0.2, 0.3))],
		});
		const next = bulkTranslateTriggerBoxes(
			model,
			[{ kind: 'landmark', idx: 0 }],
			{ x: 5, y: 0, z: 0 },
		);
		expect(next.landmarks[0].box.rotation).toEqual(v3(0.1, 0.2, 0.3));
		expect(next.landmarks[0].box.dimensions).toEqual(v3(2, 2, 2));
	});

	it('returns input model reference on identity offset', () => {
		const model = emptyTriggerData({ landmarks: [makeLandmark(v3(0, 0, 0))] });
		expect(
			bulkTranslateTriggerBoxes(model, [{ kind: 'landmark', idx: 0 }], { x: 0, y: 0, z: 0 }),
		).toBe(model);
	});

	it('returns input model reference on empty refs list', () => {
		const model = emptyTriggerData({ landmarks: [makeLandmark(v3(0, 0, 0))] });
		expect(bulkTranslateTriggerBoxes(model, [], { x: 1, y: 0, z: 0 })).toBe(model);
	});

	it('coalesces duplicate refs (same entity translated once)', () => {
		const model = emptyTriggerData({ landmarks: [makeLandmark(v3(0, 0, 0))] });
		const refs: TriggerBoxEntityRef[] = [
			{ kind: 'landmark', idx: 0 },
			{ kind: 'landmark', idx: 0 }, // duplicate
		];
		const next = bulkTranslateTriggerBoxes(model, refs, { x: 1, y: 0, z: 0 });
		expect(next.landmarks[0].box.position).toEqual(v3(1, 0, 0));
	});
});

// ---------------------------------------------------------------------------
// bulkRotateTriggerBoxes — rigid-body composition.
// ---------------------------------------------------------------------------

describe('bulkRotateTriggerBoxes — rigid-body invariants', () => {
	it('orbits each box position around the pivot AND composes own Euler', () => {
		// Two boxes, both rotation = identity, positions (10, 0, 0) and (0, 0, 10).
		// Yaw 90° around origin (CCW around +Y in three.js right-hand convention):
		//   (10, 0, 0) → (0, 0, -10)
		//   (0, 0, 10) → (10, 0, 0)
		// Each box's own Euler picks up +π/2 on Y.
		const model = emptyTriggerData({
			landmarks: [makeLandmark(v3(10, 0, 0)), makeLandmark(v3(0, 0, 10))],
		});
		const refs: TriggerBoxEntityRef[] = [
			{ kind: 'landmark', idx: 0 },
			{ kind: 'landmark', idx: 1 },
		];
		const next = bulkRotateTriggerBoxes(
			model,
			refs,
			{ x: 0, y: 0, z: 0 },
			{ x: 0, y: Math.PI / 2, z: 0 },
		);
		expect(next.landmarks[0].box.position.x).toBeCloseTo(0, 5);
		expect(next.landmarks[0].box.position.z).toBeCloseTo(-10, 5);
		expect(next.landmarks[1].box.position.x).toBeCloseTo(10, 5);
		expect(next.landmarks[1].box.position.z).toBeCloseTo(0, 5);
		expect(next.landmarks[0].box.rotation.y).toBeCloseTo(Math.PI / 2, 5);
		expect(next.landmarks[1].box.rotation.y).toBeCloseTo(Math.PI / 2, 5);
	});

	it('preserves pairwise distances between box positions (rigid-body invariant)', () => {
		// N=4 boxes scattered around in 3D, then arbitrary 3-axis rotate. Pairwise
		// distance matrix must match (modulo float epsilon) before and after.
		const positions: Vector3[] = [
			v3(0, 0, 0),
			v3(10, 5, 0),
			v3(-3, 2, 8),
			v3(15, -2, -5),
		];
		const model = emptyTriggerData({
			landmarks: positions.map((p) => makeLandmark(p)),
		});
		const refs: TriggerBoxEntityRef[] = positions.map((_, i) => ({ kind: 'landmark', idx: i }));
		const pivot = { x: 5, y: 1, z: 1 }; // arbitrary; doesn't have to be centroid
		const delta = { x: 0.3, y: -0.4, z: 0.2 };
		const next = bulkRotateTriggerBoxes(model, refs, pivot, delta);

		const before: number[] = [];
		const after: number[] = [];
		for (let i = 0; i < positions.length; i++) {
			for (let j = i + 1; j < positions.length; j++) {
				before.push(distance(model.landmarks[i].box.position, model.landmarks[j].box.position));
				after.push(distance(next.landmarks[i].box.position, next.landmarks[j].box.position));
			}
		}
		for (let k = 0; k < before.length; k++) {
			expect(after[k]).toBeCloseTo(before[k], 4);
		}
	});

	it('preserves relative orientations between boxes (rigid-body invariant)', () => {
		// Two boxes with different starting rotations. After bulk rotate, the
		// *relative* rotation between them (own_q_a^-1 * own_q_b) must be the
		// same as before — every member picks up the same delta.
		const model = emptyTriggerData({
			landmarks: [
				makeLandmark(v3(10, 0, 0), v3(0.1, 0.2, 0)),
				makeLandmark(v3(0, 0, 10), v3(0, 0.3, 0.4)),
			],
		});
		const refs: TriggerBoxEntityRef[] = [
			{ kind: 'landmark', idx: 0 },
			{ kind: 'landmark', idx: 1 },
		];
		const next = bulkRotateTriggerBoxes(
			model,
			refs,
			{ x: 0, y: 0, z: 0 },
			{ x: 0.05, y: -0.1, z: 0.2 },
		);

		const relBefore = relativeQuat(model.landmarks[0].box.rotation, model.landmarks[1].box.rotation);
		const relAfter = relativeQuat(next.landmarks[0].box.rotation, next.landmarks[1].box.rotation);

		// Quaternions q and -q represent the same rotation; compare via dot.
		const dot = Math.abs(relBefore.dot(relAfter));
		expect(dot).toBeCloseTo(1, 5);
	});

	it('mixes box and vec4 entities — both orbit the same pivot', () => {
		const model = emptyTriggerData({
			landmarks: [makeLandmark(v3(10, 0, 0))],
			roamingLocations: [makeRoaming(v4(0, 0, 10, 7))],
		});
		const refs: TriggerBoxEntityRef[] = [
			{ kind: 'landmark', idx: 0 },
			{ kind: 'roaming', idx: 0 },
		];
		const next = bulkRotateTriggerBoxes(
			model,
			refs,
			{ x: 0, y: 0, z: 0 },
			{ x: 0, y: Math.PI / 2, z: 0 },
		);
		expect(next.landmarks[0].box.position.z).toBeCloseTo(-10, 5);
		expect(next.roamingLocations[0].position.x).toBeCloseTo(10, 5);
		expect(next.roamingLocations[0].position.w).toBe(7); // preserved padding
	});

	it('returns input model reference on identity delta', () => {
		const model = emptyTriggerData({ landmarks: [makeLandmark(v3(10, 0, 0))] });
		expect(
			bulkRotateTriggerBoxes(
				model,
				[{ kind: 'landmark', idx: 0 }],
				{ x: 0, y: 0, z: 0 },
				{ x: 0, y: 0, z: 0 },
			),
		).toBe(model);
	});

	it('returns input model reference on empty refs list', () => {
		const model = emptyTriggerData({ landmarks: [makeLandmark(v3(0, 0, 0))] });
		expect(
			bulkRotateTriggerBoxes(model, [], { x: 0, y: 0, z: 0 }, { x: 0, y: 0.5, z: 0 }),
		).toBe(model);
	});

	it('mixes every BoxRegion kind in one Selection', () => {
		const model = emptyTriggerData({
			landmarks: [makeLandmark(v3(10, 0, 0))],
			genericRegions: [makeGeneric(v3(0, 0, 10))],
			blackspots: [makeBlackspot(v3(-10, 0, 0))],
			vfxBoxRegions: [makeVfx(v3(0, 0, -10))],
		});
		const refs: TriggerBoxEntityRef[] = [
			{ kind: 'landmark', idx: 0 },
			{ kind: 'generic', idx: 0 },
			{ kind: 'blackspot', idx: 0 },
			{ kind: 'vfx', idx: 0 },
		];
		const next = bulkRotateTriggerBoxes(
			model,
			refs,
			{ x: 0, y: 0, z: 0 },
			{ x: 0, y: Math.PI, z: 0 },
		);
		expect(next.landmarks[0].box.position.x).toBeCloseTo(-10, 5);
		expect(next.genericRegions[0].box.position.z).toBeCloseTo(-10, 5);
		expect(next.blackspots[0].box.position.x).toBeCloseTo(10, 5);
		expect(next.vfxBoxRegions[0].box.position.z).toBeCloseTo(10, 5);
	});

	it('spawn locations: position orbits, direction stays put', () => {
		const model = emptyTriggerData({
			spawnLocations: [makeSpawn(v4(10, 0, 0, 0))],
		});
		const refs: TriggerBoxEntityRef[] = [{ kind: 'spawn', idx: 0 }];
		const next = bulkRotateTriggerBoxes(
			model,
			refs,
			{ x: 0, y: 0, z: 0 },
			{ x: 0, y: Math.PI / 2, z: 0 },
		);
		expect(next.spawnLocations[0].position.x).toBeCloseTo(0, 5);
		expect(next.spawnLocations[0].position.z).toBeCloseTo(-10, 5);
		// Direction NOT rotated — only position participates in the gesture
		// (per-entity rotation semantics for spawn locations; the inspector
		// edits direction separately).
		expect(next.spawnLocations[0].direction).toEqual(v4(1, 0, 0));
	});
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function distance(a: Vector3, b: Vector3): number {
	const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
	return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function relativeQuat(eulerA: Vector3, eulerB: Vector3): THREE.Quaternion {
	const a = new THREE.Quaternion().setFromEuler(
		new THREE.Euler(eulerA.x, eulerA.y, eulerA.z, TRIGGER_BOX_EULER_ORDER),
	);
	const b = new THREE.Quaternion().setFromEuler(
		new THREE.Euler(eulerB.x, eulerB.y, eulerB.z, TRIGGER_BOX_EULER_ORDER),
	);
	// rel = a^-1 * b
	return a.clone().invert().multiply(b);
}
