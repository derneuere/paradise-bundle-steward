// Single-entity rigid ops for trigger boxes (issue #77).
//
// Pins the cardinality-1 behaviour every higher slice (bulk, overlay,
// gizmo) trusts: translating a box updates only position; rotating a box
// around its own position updates only rotation; the Euler ↔ Quaternion
// round-trip stays in the pinned 'XYZ' order so the on-screen orientation
// is preserved even when the numeric triple shifts.

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
	rotateBlackspotRigid,
	rotateBoxRigid,
	rotateGenericRigid,
	rotateLandmarkRigid,
	rotateVfxRigid,
	translateBlackspotRigid,
	translateBoxRigid,
	translateGenericRigid,
	translateLandmarkRigid,
	translateRoamingRigid,
	translateSpawnRigid,
	translateVfxRigid,
	TRIGGER_BOX_EULER_ORDER,
} from './translateRigid';
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

function v3(x: number, y: number, z: number): Vector3 {
	return { x, y, z };
}
function v4(x: number, y: number, z: number, w: number = 0): Vector4 {
	return { x, y, z, w };
}

function makeBox(pos: Vector3, rot: Vector3 = v3(0, 0, 0), dims: Vector3 = v3(2, 2, 2)): BoxRegion {
	return { position: pos, rotation: rot, dimensions: dims };
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
function makeBlackspot(pos: Vector3, rot: Vector3 = v3(0, 0, 0)): Blackspot {
	return {
		box: makeBox(pos, rot),
		id: 3,
		regionIndex: 0,
		type: TriggerRegionType.E_TYPE_BLACKSPOT,
		enabled: 1,
		scoreType: 0,
		scoreAmount: 0,
	};
}
function makeVfx(pos: Vector3, rot: Vector3 = v3(0, 0, 0)): VFXBoxRegion {
	return {
		box: makeBox(pos, rot),
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

// Compose-then-decompose order: pin three.js's default Euler order so the
// renderer's `dummy.rotation.set(x, y, z)` matches the round-trip used by
// the ops. If this ever drifts, every rotate test below will catch it.
describe('TRIGGER_BOX_EULER_ORDER', () => {
	it('is XYZ (matches three.js default and BatchedRegionBoxes renderer)', () => {
		expect(TRIGGER_BOX_EULER_ORDER).toBe('XYZ');
	});
});

describe('translateBoxRigid', () => {
	it('shifts position, leaves rotation and dimensions untouched', () => {
		const box = makeBox(v3(1, 2, 3), v3(0.1, 0.2, 0.3), v3(10, 20, 30));
		const next = translateBoxRigid(box, { x: 5, y: 0, z: -5 });
		expect(next.position).toEqual(v3(6, 2, -2));
		expect(next.rotation).toEqual(v3(0.1, 0.2, 0.3));
		expect(next.dimensions).toEqual(v3(10, 20, 30));
	});

	it('returns input reference on zero offset (byte-for-byte writeback)', () => {
		const box = makeBox(v3(1, 2, 3));
		expect(translateBoxRigid(box, { x: 0, y: 0, z: 0 })).toBe(box);
	});
});

describe('rotateBoxRigid — yaw around own position', () => {
	it('updates rotation.y, leaves position unchanged when pivot = own position', () => {
		const box = makeBox(v3(10, 5, 20), v3(0, 0, 0));
		const next = rotateBoxRigid(box, { x: 10, y: 5, z: 20 }, { x: 0, y: Math.PI / 4, z: 0 });
		// Position stays (no orbit when pivot == own position).
		expect(next.position.x).toBeCloseTo(10, 6);
		expect(next.position.y).toBeCloseTo(5, 6);
		expect(next.position.z).toBeCloseTo(20, 6);
		expect(next.rotation.y).toBeCloseTo(Math.PI / 4, 5);
		expect(next.rotation.x).toBeCloseTo(0, 5);
		expect(next.rotation.z).toBeCloseTo(0, 5);
	});

	it('orbits position around a different pivot AND updates rotation.y', () => {
		// Box at (10, 0, 0), pivot at origin, yaw by 90° (CCW around +Y).
		// Yaw 90° around +Y (XYZ Euler): rotation matrix R(Y, theta) maps
		//   (1, 0, 0) → (0, 0, -1) [using three.js right-hand convention]
		// Sanity check: three.js's Quaternion.setFromEuler with order 'XYZ'
		// for a pure y rotation produces this orbit direction.
		const box = makeBox(v3(10, 0, 0));
		const next = rotateBoxRigid(box, { x: 0, y: 0, z: 0 }, { x: 0, y: Math.PI / 2, z: 0 });
		expect(next.position.x).toBeCloseTo(0, 5);
		expect(next.position.y).toBeCloseTo(0, 5);
		// Three.js convention: applyQuaternion of (1,0,0) by yaw(pi/2) → (0,0,-1).
		expect(next.position.z).toBeCloseTo(-10, 5);
		// Orientation: pure y rotation composed onto identity returns pure y.
		expect(next.rotation.y).toBeCloseTo(Math.PI / 2, 5);
	});

	it('returns input reference on zero delta', () => {
		const box = makeBox(v3(1, 2, 3));
		expect(rotateBoxRigid(box, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 })).toBe(box);
	});

	it('preserves orientation across compose-then-decompose for an arbitrary delta', () => {
		// Build a box at arbitrary orientation, apply an arbitrary delta,
		// and verify that the resulting Quaternion equals delta * own_q
		// (modulo float epsilon). This pins the rigid-body composition.
		const ownEuler = v3(0.3, 0.5, -0.7);
		const box = makeBox(v3(0, 0, 0), ownEuler);
		const delta = v3(0.1, -0.2, 0.4);
		const next = rotateBoxRigid(box, { x: 0, y: 0, z: 0 }, delta);

		const ownQ = new THREE.Quaternion().setFromEuler(
			new THREE.Euler(ownEuler.x, ownEuler.y, ownEuler.z, TRIGGER_BOX_EULER_ORDER),
		);
		const deltaQ = new THREE.Quaternion().setFromEuler(
			new THREE.Euler(delta.x, delta.y, delta.z, TRIGGER_BOX_EULER_ORDER),
		);
		const expectedQ = deltaQ.clone().multiply(ownQ);

		const gotQ = new THREE.Quaternion().setFromEuler(
			new THREE.Euler(next.rotation.x, next.rotation.y, next.rotation.z, TRIGGER_BOX_EULER_ORDER),
		);

		// Quaternions q and -q represent the same rotation; compare via dot.
		const dot = Math.abs(gotQ.dot(expectedQ));
		expect(dot).toBeCloseTo(1, 6);
	});
});

describe('translateLandmarkRigid', () => {
	it('shifts position, leaves rotation/dimensions intact', () => {
		const model = emptyTriggerData({
			landmarks: [makeLandmark(v3(0, 0, 0), v3(0.1, 0.2, 0.3))],
		});
		const next = translateLandmarkRigid(model, 0, { x: 10, y: 5, z: -3 });
		expect(next.landmarks[0].box.position).toEqual(v3(10, 5, -3));
		expect(next.landmarks[0].box.rotation).toEqual(v3(0.1, 0.2, 0.3));
		expect(next.landmarks[0].box.dimensions).toEqual(v3(2, 2, 2));
	});

	it('returns input reference on zero offset (BND2 invariant)', () => {
		const model = emptyTriggerData({ landmarks: [makeLandmark(v3(0, 0, 0))] });
		expect(translateLandmarkRigid(model, 0, { x: 0, y: 0, z: 0 })).toBe(model);
	});

	it('throws RangeError on out-of-bounds index', () => {
		const model = emptyTriggerData({ landmarks: [makeLandmark(v3(0, 0, 0))] });
		expect(() => translateLandmarkRigid(model, 5, { x: 1, y: 0, z: 0 })).toThrow(RangeError);
	});
});

describe('rotateLandmarkRigid — single-entity yaw around own position', () => {
	it('updates rotation.y when pivot = own position; position unchanged', () => {
		const model = emptyTriggerData({
			landmarks: [makeLandmark(v3(10, 0, 20), v3(0, 0, 0))],
		});
		const pivot = { x: 10, y: 0, z: 20 };
		const next = rotateLandmarkRigid(model, 0, pivot, { x: 0, y: Math.PI / 6, z: 0 });
		expect(next.landmarks[0].box.position.x).toBeCloseTo(10, 5);
		expect(next.landmarks[0].box.position.z).toBeCloseTo(20, 5);
		expect(next.landmarks[0].box.rotation.y).toBeCloseTo(Math.PI / 6, 5);
	});

	it('returns input reference on zero delta', () => {
		const model = emptyTriggerData({ landmarks: [makeLandmark(v3(0, 0, 0))] });
		expect(rotateLandmarkRigid(model, 0, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 })).toBe(model);
	});
});

describe('translateGenericRigid / rotateGenericRigid', () => {
	it('shifts the targeted region only', () => {
		const model = emptyTriggerData({
			genericRegions: [makeGeneric(v3(0, 0, 0)), makeGeneric(v3(50, 0, 50))],
		});
		const next = translateGenericRigid(model, 1, { x: 1, y: 0, z: 0 });
		expect(next.genericRegions[0]).toBe(model.genericRegions[0]); // untouched ref
		expect(next.genericRegions[1].box.position).toEqual(v3(51, 0, 50));
	});

	it('rotates only the targeted region', () => {
		const model = emptyTriggerData({
			genericRegions: [makeGeneric(v3(0, 0, 0)), makeGeneric(v3(0, 0, 0))],
		});
		const next = rotateGenericRigid(model, 0, { x: 0, y: 0, z: 0 }, { x: 0, y: 0.1, z: 0 });
		expect(next.genericRegions[1]).toBe(model.genericRegions[1]); // untouched ref
		expect(next.genericRegions[0].box.rotation.y).toBeCloseTo(0.1, 5);
	});
});

describe('translateBlackspotRigid / rotateBlackspotRigid', () => {
	it('translate shifts box; rotate composes Euler', () => {
		const m1 = emptyTriggerData({ blackspots: [makeBlackspot(v3(0, 0, 0))] });
		const t = translateBlackspotRigid(m1, 0, { x: 3, y: 0, z: 0 });
		expect(t.blackspots[0].box.position).toEqual(v3(3, 0, 0));
		const r = rotateBlackspotRigid(t, 0, { x: 3, y: 0, z: 0 }, { x: 0, y: 0.5, z: 0 });
		expect(r.blackspots[0].box.rotation.y).toBeCloseTo(0.5, 5);
	});
});

describe('translateVfxRigid / rotateVfxRigid', () => {
	it('translate then rotate composes correctly', () => {
		const m1 = emptyTriggerData({ vfxBoxRegions: [makeVfx(v3(1, 2, 3))] });
		const t = translateVfxRigid(m1, 0, { x: 1, y: 0, z: 0 });
		expect(t.vfxBoxRegions[0].box.position).toEqual(v3(2, 2, 3));
		const r = rotateVfxRigid(t, 0, { x: 2, y: 2, z: 3 }, { x: 0, y: Math.PI, z: 0 });
		// pivot == own position → position unchanged
		expect(r.vfxBoxRegions[0].box.position.x).toBeCloseTo(2, 5);
	});
});

describe('translateRoamingRigid / translateSpawnRigid', () => {
	it('roaming: position.w preserved verbatim', () => {
		const model = emptyTriggerData({ roamingLocations: [makeRoaming(v4(0, 0, 0, 42))] });
		const next = translateRoamingRigid(model, 0, { x: 1, y: 2, z: 3 });
		expect(next.roamingLocations[0].position).toEqual(v4(1, 2, 3, 42));
	});

	it('spawn: position shifts, direction is preserved', () => {
		const model = emptyTriggerData({ spawnLocations: [makeSpawn(v4(0, 0, 0, 7))] });
		const next = translateSpawnRigid(model, 0, { x: 5, y: 0, z: 5 });
		expect(next.spawnLocations[0].position).toEqual(v4(5, 0, 5, 7));
		expect(next.spawnLocations[0].direction).toEqual(v4(1, 0, 0));
	});

	it('roaming: identity offset returns input model reference', () => {
		const model = emptyTriggerData({ roamingLocations: [makeRoaming(v4(0, 0, 0))] });
		expect(translateRoamingRigid(model, 0, { x: 0, y: 0, z: 0 })).toBe(model);
	});
});
