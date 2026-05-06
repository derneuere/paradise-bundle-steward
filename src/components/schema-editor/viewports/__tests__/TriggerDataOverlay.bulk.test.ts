// TriggerDataOverlay marquee centroid hit-test.
//
// The overlay's marquee handler calls `collectMarqueeHits(data, frustum)`
// (extracted as a pure function in the overlay module). Pinning the
// projection here — boxes use `box.position`, spawns / roams use
// `position` — guards against a regression that swapped one of the
// `tryBox`/`tryVec` callsites and would silently misroute every hit.
//
// The repo's vitest env is `node` (no jsdom) so we don't mount the overlay;
// pure-function input → output is enough.

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import type {
	Landmark,
	GenericRegion,
	Blackspot,
	VFXBoxRegion,
	SpawnLocation,
	RoamingLocation,
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
import { collectMarqueeHits } from '../TriggerDataOverlay';

function v3(x: number, y: number, z: number): Vector3 {
	return { x, y, z };
}
function v4(x: number, y: number, z: number, w: number = 0): Vector4 {
	return { x, y, z, w };
}

function makeBoxAt(pos: Vector3): BoxRegion {
	return { position: pos, rotation: v3(0, 0, 0), dimensions: v3(1, 1, 1) };
}

function makeLandmark(pos: Vector3): Landmark {
	return {
		box: makeBoxAt(pos),
		id: 0,
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
		box: makeBoxAt(pos),
		id: 0,
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
		box: makeBoxAt(pos),
		id: 0,
		regionIndex: 0,
		type: TriggerRegionType.E_TYPE_BLACKSPOT,
		enabled: 1,
		scoreType: 0,
		scoreAmount: 0,
	};
}

function makeVfx(pos: Vector3): VFXBoxRegion {
	return {
		box: makeBoxAt(pos),
		id: 0,
		regionIndex: 0,
		type: TriggerRegionType.E_TYPE_VFXBOX_REGION,
		enabled: 1,
	};
}

function makeSpawn(pos: Vector4): SpawnLocation {
	return {
		position: pos,
		direction: v4(1, 0, 0),
		junkyardId: 0n,
		type: 0 as SpawnLocation['type'],
	};
}

function makeRoaming(pos: Vector4): RoamingLocation {
	return { position: pos, districtIndex: 0 };
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

/** Build an axis-aligned box frustum that "contains" any point within the
 *  six bounds. Mirrors the helper in `AISectionsOverlay.bulk.test.ts`. */
function buildBoxFrustum(
	xMin: number, xMax: number,
	yMin: number, yMax: number,
	zMin: number, zMax: number,
): THREE.Frustum {
	const planes = [
		new THREE.Plane(new THREE.Vector3(1, 0, 0), -xMin),
		new THREE.Plane(new THREE.Vector3(-1, 0, 0), xMax),
		new THREE.Plane(new THREE.Vector3(0, 1, 0), -yMin),
		new THREE.Plane(new THREE.Vector3(0, -1, 0), yMax),
		new THREE.Plane(new THREE.Vector3(0, 0, 1), -zMin),
		new THREE.Plane(new THREE.Vector3(0, 0, -1), zMax),
	];
	const f = new THREE.Frustum();
	for (let i = 0; i < 6; i++) f.planes[i].copy(planes[i]);
	return f;
}

describe('TriggerDataOverlay marquee centroid hit-test', () => {
	it('returns paths for every entry whose representative point lies inside the frustum', () => {
		const data = emptyTriggerData({
			landmarks: [
				makeLandmark(v3(0, 0, 0)), // inside
				makeLandmark(v3(1000, 0, 0)), // outside
			],
			genericRegions: [makeGeneric(v3(5, 0, 5))], // inside
			blackspots: [makeBlackspot(v3(2000, 0, 0))], // outside
			vfxBoxRegions: [makeVfx(v3(-5, 0, -5))], // inside
			spawnLocations: [
				makeSpawn(v4(10, 0, 10)), // inside
				makeSpawn(v4(900, 0, 0)), // outside
			],
			roamingLocations: [
				makeRoaming(v4(0, 0, 0)), // inside
				makeRoaming(v4(0, 0, 800)), // outside
			],
		});

		const frustum = buildBoxFrustum(-50, 50, -10, 10, -50, 50);
		const hits = collectMarqueeHits(data, frustum);

		expect(hits).toEqual([
			['landmarks', 0],
			['genericRegions', 0],
			['vfxBoxRegions', 0],
			['spawnLocations', 0],
			['roamingLocations', 0],
		]);
	});

	it('uses box.position for box regions, not box.dimensions or rotation', () => {
		// Place the entry far from origin in `dimensions` and `rotation`, but
		// keep `position` inside the frustum. A regression that read either
		// of the wrong fields would miss this hit.
		const lm = makeLandmark(v3(0, 0, 0));
		lm.box.dimensions = v3(9999, 9999, 9999);
		lm.box.rotation = v3(9999, 9999, 9999);

		const data = emptyTriggerData({ landmarks: [lm] });
		const frustum = buildBoxFrustum(-1, 1, -1, 1, -1, 1);
		expect(collectMarqueeHits(data, frustum)).toEqual([['landmarks', 0]]);
	});

	it('emits an empty array when no entries fall inside the frustum', () => {
		const data = emptyTriggerData({
			landmarks: [makeLandmark(v3(1000, 0, 0))],
			roamingLocations: [makeRoaming(v4(2000, 0, 0))],
		});
		const frustum = buildBoxFrustum(-50, 50, -10, 10, -50, 50);
		expect(collectMarqueeHits(data, frustum)).toEqual([]);
	});

	it('does NOT include player-start singletons (not bulk-eligible)', () => {
		// Place the player-start at the origin; the frustum contains it but
		// the marquee must skip it because there's exactly one player-start
		// per resource and a "set of one" is not a meaningful bulk.
		const data = emptyTriggerData({
			playerStartPosition: v4(0, 0, 0),
			playerStartDirection: v4(1, 0, 0),
		});
		const frustum = buildBoxFrustum(-50, 50, -10, 10, -50, 50);
		expect(collectMarqueeHits(data, frustum)).toEqual([]);
	});
});
