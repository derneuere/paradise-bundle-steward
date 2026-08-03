// The trigger-data resolver: packing, field preservation, reference identity,
// the silent-skip range policy, orientation composition and the axis profile.
//
// Ported from the deleted `triggerDataOps/{translateRigid,bulk,transformAxes}
// .test.ts`. Assertions that only re-verified median / pivot / rotate-about-
// pivot / no-op-guard maths are deliberately NOT ported — those live once in
// `__tests__/math.test.ts` and `__tests__/transform.test.ts` now.
//
// Trigger boxes already rotated with three.js's `makeRotationFromEuler`, so
// unlike the four XZ-packed families the yaw sign here is UNCHANGED by the
// merge: +PI/2 about +Y still takes (10,0,0) to (0,0,-10).
//
// Orientation is compared via quaternion dot, never `toEqual` on the Euler
// triple — the compose-then-decompose is representation-collapsing by design.

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';

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
} from '../../../triggerData';
import {
	GenericRegionType,
	StuntCameraType,
	TriggerRegionType,
} from '../../../triggerData';
import {
	TRIGGER_BOX_EULER_ORDER,
	triggerDataResolver,
	type TriggerDataRef,
} from '../../resolvers/triggerData';
import { selectionPivot, transform } from '../../transform';
import { TRANSFORM_AXES_FULL_3D } from '../../../transformAxes';
import { delta, expectPoint } from '../_helpers';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const v3 = (x: number, y: number, z: number): Vector3 => ({ x, y, z });
const v4 = (x: number, y: number, z: number, w = 0): Vector4 => ({ x, y, z, w });

function makeBox(pos: Vector3, rot: Vector3 = v3(0, 0, 0)): BoxRegion {
	return { position: pos, rotation: rot, dimensions: v3(2, 4, 6) };
}
function makeLandmark(pos: Vector3, rot: Vector3 = v3(0, 0, 0)): Landmark {
	return {
		box: makeBox(pos, rot), id: 1, regionIndex: 0,
		type: TriggerRegionType.E_TYPE_LANDMARK, enabled: 1,
		startingGrids: [], designIndex: 7, district: 3, flags: 2,
	};
}
function makeGeneric(pos: Vector3, id = 2): GenericRegion {
	return {
		box: makeBox(pos), id, regionIndex: 0,
		type: TriggerRegionType.E_TYPE_GENERIC_REGION, enabled: 1,
		groupId: 0, cameraCut1: 0, cameraCut2: 0,
		cameraType1: StuntCameraType.E_STUNT_CAMERA_TYPE_NO_CUTS,
		cameraType2: StuntCameraType.E_STUNT_CAMERA_TYPE_NO_CUTS,
		genericType: GenericRegionType.E_TYPE_JUNK_YARD, isOneWay: 0,
	};
}
function makeBlackspot(pos: Vector3): Blackspot {
	return {
		box: makeBox(pos), id: 3, regionIndex: 0,
		type: TriggerRegionType.E_TYPE_BLACKSPOT, enabled: 1,
		scoreType: 0, scoreAmount: 0,
	};
}
function makeVfx(pos: Vector3): VFXBoxRegion {
	return {
		box: makeBox(pos), id: 4, regionIndex: 0,
		type: TriggerRegionType.E_TYPE_VFXBOX_REGION, enabled: 1,
	};
}
const makeRoaming = (pos: Vector4): RoamingLocation => ({ position: pos, districtIndex: 5 });
const makeSpawn = (pos: Vector4): SpawnLocation => ({
	position: pos, direction: v4(1, 0, 0), junkyardId: 9n, type: 0 as SpawnLocation['type'],
});

function makeModel(over: Partial<ParsedTriggerData> = {}): ParsedTriggerData {
	return {
		version: 0, size: 0,
		playerStartPosition: v4(1, 2, 3, 4), playerStartDirection: v4(1, 0, 0),
		landmarks: [], onlineLandmarkCount: 0, signatureStunts: [],
		genericRegions: [], killzones: [], blackspots: [], vfxBoxRegions: [],
		roamingLocations: [], spawnLocations: [],
		...over,
	};
}

const LM0: TriggerDataRef = { kind: 'landmark', idx: 0 };
const YAW_90 = { x: 0, y: Math.PI / 2, z: 0 };

function quat(e: Vector3): THREE.Quaternion {
	return new THREE.Quaternion().setFromEuler(
		new THREE.Euler(e.x, e.y, e.z, TRIGGER_BOX_EULER_ORDER),
	);
}
/** Quaternions q and -q are the same rotation, so compare via |dot| ≈ 1. */
function expectSameOrientation(a: Vector3, b: Vector3) {
	expect(Math.abs(quat(a).dot(quat(b)))).toBeCloseTo(1, 6);
}

// ---------------------------------------------------------------------------

describe('TRIGGER_BOX_EULER_ORDER', () => {
	it('is XYZ — the order the viewport renders box.rotation with', () => {
		expect(TRIGGER_BOX_EULER_ORDER).toBe('XYZ');
	});
});

describe('triggerDataResolver — slots', () => {
	it('expands every transformable ref to itself, with a kind-qualified key', () => {
		const model = makeModel({ landmarks: [makeLandmark(v3(0, 0, 0))] });
		expect(triggerDataResolver.expand(model, LM0)).toEqual([LM0]);
		// The four box lists are parallel, so the key MUST carry the kind or a
		// landmark and a generic region at the same index would collide.
		expect(triggerDataResolver.key(LM0)).toBe('landmark:0');
		expect(triggerDataResolver.key({ kind: 'generic', idx: 0 })).toBe('generic:0');
	});

	it('expands playerStart to nothing — selectable, deliberately not transformable', () => {
		const model = makeModel();
		expect(triggerDataResolver.expand(model, { kind: 'playerStart' })).toEqual([]);
		const next = transform(
			model, [{ kind: 'playerStart' }], delta({ translate: { x: 5, y: 5, z: 5 } }),
			triggerDataResolver,
		);
		expect(next).toBe(model);
		expect(next.playerStartPosition).toEqual(v4(1, 2, 3, 4));
	});

	it('resolves a box position as a copy, and a Vector4 location without its .w', () => {
		const model = makeModel({
			landmarks: [makeLandmark(v3(9, 8, 7))],
			roamingLocations: [makeRoaming(v4(1, 2, 3, 42))],
		});
		const p = triggerDataResolver.resolve(model, LM0);
		expect(p).toEqual({ x: 9, y: 8, z: 7 });
		expect(p).not.toBe(model.landmarks[0].box.position);
		expect(triggerDataResolver.resolve(model, { kind: 'roaming', idx: 0 }))
			.toEqual({ x: 1, y: 2, z: 3 });
	});

	it('resolves an out-of-range index to null instead of throwing', () => {
		const model = makeModel({ landmarks: [makeLandmark(v3(0, 0, 0))] });
		expect(triggerDataResolver.resolve(model, { kind: 'landmark', idx: 9 })).toBeNull();
		expect(triggerDataResolver.resolve(model, { kind: 'spawn', idx: 0 })).toBeNull();
		// End to end: a stale ref is dropped and the live one still moves.
		const next = transform(
			model, [{ kind: 'landmark', idx: 9 }, LM0],
			delta({ translate: { x: 5, y: 0, z: 0 } }), triggerDataResolver,
		);
		expect(next.landmarks[0].box.position).toEqual(v3(5, 0, 0));
	});
});

describe('triggerDataResolver — translate', () => {
	it('shifts every selected entity across all six lists in lockstep', () => {
		const model = makeModel({
			landmarks: [makeLandmark(v3(0, 0, 0))],
			genericRegions: [makeGeneric(v3(10, 0, 0))],
			blackspots: [makeBlackspot(v3(20, 0, 0))],
			vfxBoxRegions: [makeVfx(v3(30, 0, 0))],
			roamingLocations: [makeRoaming(v4(40, 0, 0, 11))],
			spawnLocations: [makeSpawn(v4(50, 0, 0, 12))],
		});
		const refs: TriggerDataRef[] = [
			LM0, { kind: 'generic', idx: 0 }, { kind: 'blackspot', idx: 0 },
			{ kind: 'vfx', idx: 0 }, { kind: 'roaming', idx: 0 }, { kind: 'spawn', idx: 0 },
		];
		const next = transform(model, refs, delta({ translate: { x: 3, y: 1, z: -2 } }), triggerDataResolver);
		expect(next.landmarks[0].box.position).toEqual(v3(3, 1, -2));
		expect(next.genericRegions[0].box.position).toEqual(v3(13, 1, -2));
		expect(next.blackspots[0].box.position).toEqual(v3(23, 1, -2));
		expect(next.vfxBoxRegions[0].box.position).toEqual(v3(33, 1, -2));
		// `.w` is storage padding, not a coordinate — it echoes back verbatim.
		expect(next.roamingLocations[0].position).toEqual(v4(43, 1, -2, 11));
		expect(next.spawnLocations[0].position).toEqual(v4(53, 1, -2, 12));
	});

	it('preserves rotation, dimensions and every non-spatial field', () => {
		const model = makeModel({
			landmarks: [makeLandmark(v3(0, 0, 0), v3(0.1, 0.2, 0.3))],
			genericRegions: [makeGeneric(v3(0, 0, 0), 0x4321)],
			spawnLocations: [makeSpawn(v4(0, 0, 0, 7))],
		});
		const next = transform(
			model, [LM0, { kind: 'generic', idx: 0 }, { kind: 'spawn', idx: 0 }],
			delta({ translate: { x: 5, y: 0, z: 0 } }), triggerDataResolver,
		);
		const lm = next.landmarks[0];
		expect(lm.box.rotation).toEqual(v3(0.1, 0.2, 0.3));
		// `dimensions` is a box EXTENT, not a position — a translate must never
		// touch it, and it comes back by reference.
		expect(lm.box.dimensions).toBe(model.landmarks[0].box.dimensions);
		expect(lm.designIndex).toBe(7);
		expect(lm.district).toBe(3);
		// World-space sub-entities that are never slots.
		expect(lm.startingGrids).toBe(model.landmarks[0].startingGrids);
		// The writer throws "Missing GenericRegion offset for id X" if this is lost.
		expect(next.genericRegions[0].id).toBe(0x4321);
		// Spawn facing is orientation data the transform deliberately leaves alone.
		expect(next.spawnLocations[0].direction).toBe(model.spawnLocations[0].direction);
		expect(next.spawnLocations[0].junkyardId).toBe(9n);
	});

	it('hands untouched entries, untouched lists and sibling data back by reference', () => {
		const model = makeModel({
			landmarks: [makeLandmark(v3(0, 0, 0)), makeLandmark(v3(50, 0, 0))],
			genericRegions: [makeGeneric(v3(0, 0, 0))],
			roamingLocations: [makeRoaming(v4(0, 0, 0))],
		});
		const next = transform(model, [LM0], delta({ translate: { x: 1, y: 0, z: 0 } }), triggerDataResolver);
		// Structural sharing is the BND2 writeback contract: an untouched entity
		// must re-encode to the exact bytes it was parsed from.
		expect(next.landmarks[1]).toBe(model.landmarks[1]);
		expect(next.landmarks[0]).not.toBe(model.landmarks[0]);
		expect(next.genericRegions).toBe(model.genericRegions);
		expect(next.roamingLocations).toBe(model.roamingLocations);
		expect(next.killzones).toBe(model.killzones);
		expect(next.signatureStunts).toBe(model.signatureStunts);
	});
});

describe('triggerDataResolver — rotate', () => {
	it('orbits the position AND left-multiplies the delta into the box Euler', () => {
		// +PI/2 about +Y takes +X toward -Z (right-hand rule / three.js), which is
		// what the viewport's `dummy.rotation.set(...)` renders.
		const model = makeModel({
			landmarks: [makeLandmark(v3(10, 0, 0)), makeLandmark(v3(0, 0, 10))],
		});
		const next = transform(
			model, [LM0, { kind: 'landmark', idx: 1 }],
			delta({ rotate: YAW_90, pivot: { x: 0, y: 0, z: 0 } }), triggerDataResolver,
		);
		expectPoint(next.landmarks[0].box.position, { x: 0, y: 0, z: -10 });
		expectPoint(next.landmarks[1].box.position, { x: 10, y: 0, z: 0 });
		expectSameOrientation(next.landmarks[0].box.rotation, v3(0, Math.PI / 2, 0));
		expectSameOrientation(next.landmarks[1].box.rotation, v3(0, Math.PI / 2, 0));
	});

	it('composes delta * own (not own * delta) for an already-rotated box', () => {
		// Reversing the operands compiles and passes every yaw-from-identity test
		// while corrupting every box that already had a rotation.
		const own = v3(0.3, 0.5, -0.7);
		const spin = { x: 0.1, y: -0.2, z: 0.4 };
		const model = makeModel({ landmarks: [makeLandmark(v3(0, 0, 0), own)] });
		const next = transform(
			model, [LM0], delta({ rotate: spin, pivot: { x: 0, y: 0, z: 0 } }), triggerDataResolver,
		);
		const expected = quat(spin).multiply(quat(own));
		expect(Math.abs(quat(next.landmarks[0].box.rotation).dot(expected))).toBeCloseTo(1, 6);
	});

	it('leaves a lone box in place while turning it when the pivot is its own position', () => {
		const model = makeModel({ landmarks: [makeLandmark(v3(10, 5, 20))] });
		const next = transform(
			model, [LM0], delta({ rotate: { x: 0, y: Math.PI / 6, z: 0 } }), triggerDataResolver,
		);
		// No explicit pivot ⇒ the median of the one slot ⇒ its own position.
		expectPoint(next.landmarks[0].box.position, { x: 10, y: 5, z: 20 });
		expectSameOrientation(next.landmarks[0].box.rotation, v3(0, Math.PI / 6, 0));
	});

	it('orbits Vector4 locations but gives them no orientation, and keeps .w', () => {
		const model = makeModel({
			roamingLocations: [makeRoaming(v4(0, 0, 10, 7))],
			spawnLocations: [makeSpawn(v4(10, 0, 0, 3))],
		});
		const next = transform(
			model, [{ kind: 'roaming', idx: 0 }, { kind: 'spawn', idx: 0 }],
			delta({ rotate: YAW_90, pivot: { x: 0, y: 0, z: 0 } }), triggerDataResolver,
		);
		expect(next.roamingLocations[0].position.x).toBeCloseTo(10, 6);
		expect(next.roamingLocations[0].position.w).toBe(7);
		expect(next.spawnLocations[0].position.z).toBeCloseTo(-10, 6);
		expect(next.spawnLocations[0].position.w).toBe(3);
		// Direction is NOT rotated — the inspector edits a spawn's facing separately.
		expect(next.spawnLocations[0].direction).toEqual(v4(1, 0, 0));
		expect(next.roamingLocations[0].districtIndex).toBe(5);
	});

	it('preserves pairwise distances and relative orientations (rigid body)', () => {
		const positions = [v3(0, 0, 0), v3(10, 5, 0), v3(-3, 2, 8), v3(15, -2, -5)];
		const model = makeModel({
			landmarks: [
				makeLandmark(positions[0], v3(0.1, 0.2, 0)),
				makeLandmark(positions[1], v3(0, 0.3, 0.4)),
				makeLandmark(positions[2]),
				makeLandmark(positions[3]),
			],
		});
		const refs = positions.map((_, i): TriggerDataRef => ({ kind: 'landmark', idx: i }));
		const next = transform(
			model, refs,
			delta({ rotate: { x: 0.3, y: -0.4, z: 0.2 }, pivot: { x: 5, y: 1, z: 1 } }),
			triggerDataResolver,
		);
		for (let i = 0; i < positions.length; i++) {
			for (let j = i + 1; j < positions.length; j++) {
				expect(dist(next.landmarks[i].box.position, next.landmarks[j].box.position))
					.toBeCloseTo(dist(positions[i], positions[j]), 4);
			}
		}
		// Every member picks up the SAME delta, so the relative rotation between
		// two boxes is invariant.
		const relBefore = quat(model.landmarks[0].box.rotation).invert().multiply(quat(model.landmarks[1].box.rotation));
		const relAfter = quat(next.landmarks[0].box.rotation).invert().multiply(quat(next.landmarks[1].box.rotation));
		expect(Math.abs(relBefore.dot(relAfter))).toBeCloseTo(1, 5);
	});
});

describe('triggerDataResolver — duplicate refs', () => {
	// The overlay unions the workspace bulk set with the inspector pick, so the
	// same entity routinely arrives twice. With `spin` in play a double write is
	// not merely a double translate — it double-composes the orientation.
	it('applies the gesture exactly once to a duplicated ref', () => {
		const model = makeModel({ landmarks: [makeLandmark(v3(10, 0, 0))] });
		const next = transform(
			model, [LM0, { kind: 'landmark', idx: 0 }],
			delta({ translate: { x: 5, y: 0, z: 0 }, rotate: YAW_90, pivot: { x: 0, y: 0, z: 0 } }),
			triggerDataResolver,
		);
		// Translate first, then orbit the TRANSLATE-ADJUSTED pivot (5,0,0):
		// (15,0,0) about (5,0,0) by +90° ⇒ (5,0,-10).
		expectPoint(next.landmarks[0].box.position, { x: 5, y: 0, z: -10 });
		expectSameOrientation(next.landmarks[0].box.rotation, v3(0, Math.PI / 2, 0));
	});

	it('does not let a duplicate skew the pivot median', () => {
		const model = makeModel({
			landmarks: [makeLandmark(v3(0, 0, 0)), makeLandmark(v3(100, 0, 0))],
		});
		const pivot = selectionPivot(
			model, [LM0, LM0, { kind: 'landmark', idx: 1 }], triggerDataResolver,
		);
		expect(pivot).toEqual({ x: 50, y: 0, z: 0 });
	});
});

describe('triggerDataResolver — axes', () => {
	it('gives every box kind full 3D translate and rotate', () => {
		for (const kind of ['landmark', 'generic', 'blackspot', 'vfx'] as const) {
			expect(triggerDataResolver.axes([{ kind, idx: 0 }])).toEqual(TRANSFORM_AXES_FULL_3D);
		}
	});

	it('disables all three rotate rings once a roaming or spawn ref joins', () => {
		for (const kind of ['roaming', 'spawn'] as const) {
			const axes = triggerDataResolver.axes([LM0, { kind, idx: 0 }]);
			expect(axes?.translate).toEqual({ x: true, y: true, z: true });
			expect(axes?.rotate).toEqual({ x: false, y: false, z: false });
		}
	});

	it('skips playerStart rather than AND-ing it to nothing', () => {
		// Picking the gold cone alongside a box must not disable the box's gizmo,
		// but a playerStart-only selection has no gizmo at all.
		expect(triggerDataResolver.axes([LM0, { kind: 'playerStart' }])).toEqual(TRANSFORM_AXES_FULL_3D);
		expect(triggerDataResolver.axes([{ kind: 'playerStart' }])).toBeNull();
	});

	it('reports the same profile for one ref as for many, and null for none', () => {
		// Cardinality is not a factor: the pivot is drag-repositionable, so a lone
		// box genuinely orbits rather than spinning uselessly in place.
		expect(triggerDataResolver.axes([LM0]))
			.toEqual(triggerDataResolver.axes([LM0, { kind: 'vfx', idx: 3 }]));
		expect(triggerDataResolver.axes([])).toBeNull();
	});
});

function dist(a: Vector3, b: Vector3): number {
	const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
	return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
