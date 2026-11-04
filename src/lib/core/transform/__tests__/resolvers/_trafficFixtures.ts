// Minimal-but-valid `ParsedTrafficDataRetail` builders for the traffic-data
// resolver suites. Only the arrays a test exercises are populated; everything
// else stays empty so a structural-sharing assertion means what it says.

import * as THREE from 'three';

import type {
	ParsedTrafficDataRetail,
	TrafficHull,
	TrafficJunctionLogicBox,
	TrafficLaneRung,
	TrafficLightCollection,
	TrafficLightTrigger,
	TrafficStaticVehicle,
	Vec4,
} from '../../../trafficData';

export function vec4(x: number, y: number, z: number, w: number): Vec4 {
	return { x, y, z, w };
}

export function makeJunction(pos: Vec4): TrafficJunctionLogicBox {
	return {
		muID: 0,
		mauStateTimings: new Array(16).fill(0),
		mauStoppedLightStates: new Array(16).fill(0),
		muNumStates: 0,
		muNumLights: 0,
		_pad36: [0, 0],
		muEventJunctionID: 0,
		miOfflineStartDataIndex: -1,
		miOnlineStartDataIndex: -1,
		miBikeStartDataIndex: -1,
		maTrafficLightControllers: [],
		_pad108: [],
		mPosition: pos,
	};
}

export function makeLightTrigger(pos: Vec4, dims: Vec4 = vec4(1, 2, 3, 0)): TrafficLightTrigger {
	return { mDimensions: dims, mPosPlusYRot: pos };
}

export function makeRung(a: Vec4, b: Vec4): TrafficLaneRung {
	return { maPoints: [a, b] };
}

/**
 * A `TrafficStaticVehicle` composed from position + Euler so the storage
 * layout is the canonical column-major one the parser produces. Pad slots
 * [3], [7], [11], [15] are forced to zero to mirror Matrix44Affine on disk.
 */
export function makeStaticVehicle(
	pos: { x: number; y: number; z: number },
	euler: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 },
): TrafficStaticVehicle {
	const mat = new THREE.Matrix4().compose(
		new THREE.Vector3(pos.x, pos.y, pos.z),
		new THREE.Quaternion().setFromEuler(new THREE.Euler(euler.x, euler.y, euler.z, 'XYZ')),
		new THREE.Vector3(1, 1, 1),
	);
	const arr = mat.toArray();
	arr[3] = 0; arr[7] = 0; arr[11] = 0; arr[15] = 0;
	return {
		mTransform: arr,
		mFlowTypeID: 7,
		mExistsAtAllChance: 100,
		muFlags: 3,
		_pad43: new Array(12).fill(0),
	};
}

export function makeHull(opts: {
	junctions?: TrafficJunctionLogicBox[];
	lightTriggers?: TrafficLightTrigger[];
	rungs?: TrafficLaneRung[];
	cumulativeRungLengths?: number[];
	staticVehicles?: TrafficStaticVehicle[];
} = {}): TrafficHull {
	return {
		muNumSections: 0,
		muNumSectionSpans: 0,
		muNumJunctions: opts.junctions?.length ?? 0,
		muNumStoplines: 0,
		muNumNeighbours: 0,
		muNumStaticTraffic: opts.staticVehicles?.length ?? 0,
		muNumVehicleAssets: 0,
		_pad07: 0,
		muNumRungs: opts.rungs?.length ?? 0,
		muFirstTrafficLight: 0,
		muLastTrafficLight: 0,
		muNumLightTriggers: opts.lightTriggers?.length ?? 0,
		muNumLightTriggersStartData: 0,
		sections: [],
		rungs: opts.rungs ?? [],
		cumulativeRungLengths: opts.cumulativeRungLengths ?? [],
		neighbours: [],
		sectionSpans: [],
		staticTrafficVehicles: opts.staticVehicles ?? [],
		sectionFlows: [],
		junctions: opts.junctions ?? [],
		stopLines: [],
		lightTriggers: opts.lightTriggers ?? [],
		lightTriggerStartData: [],
		lightTriggerJunctionLookup: [],
		mauVehicleAssets: [],
	};
}

export function makeLights(opts: {
	posAndYRotations?: Vec4[];
	coronaPositions?: Vec4[];
} = {}): TrafficLightCollection {
	return {
		posAndYRotations: opts.posAndYRotations ?? [],
		instanceIDs: [],
		instanceTypes: [],
		trafficLightTypes: [],
		coronaTypes: [],
		coronaPositions: opts.coronaPositions ?? [],
		mauInstanceHashOffsets: [],
		instanceHashTable: [],
		instanceHashToIndexLookup: [],
	};
}

export function makeModel(opts: {
	hulls?: TrafficHull[];
	lights?: TrafficLightCollection;
} = {}): ParsedTrafficDataRetail {
	return {
		kind: 'v45',
		muDataVersion: 45,
		muSizeInBytes: 0,
		pvs: {
			mGridMin: vec4(-100, 0, -100, 0),
			mCellSize: vec4(50, 50, 50, 0),
			mRecipCellSize: vec4(0.02, 0.02, 0.02, 0),
			muNumCells_X: 0,
			muNumCells_Z: 0,
			muNumCells: 0,
			hullPvsSets: [],
		},
		hulls: opts.hulls ?? [],
		flowTypes: [],
		killZoneIds: [],
		killZones: [],
		killZoneRegions: [],
		vehicleTypes: [],
		vehicleTypesUpdate: [],
		vehicleAssets: [],
		vehicleTraits: [],
		trafficLights: opts.lights ?? makeLights(),
		paintColours: [],
	};
}

/** Translation column of a static vehicle's `mTransform`. */
export function translationOf(v: TrafficStaticVehicle) {
	return { x: v.mTransform[12], y: v.mTransform[13], z: v.mTransform[14] };
}

/**
 * World-space image of the vehicle's local +X under its rotation portion —
 * i.e. the direction the car is pointing. The homogeneous slot is patched to
 * 1 first because the storage layout keeps zero there.
 */
export function facingOf(v: TrafficStaticVehicle): { x: number; y: number; z: number } {
	const m = new THREE.Matrix4().fromArray(v.mTransform);
	const e = m.elements;
	e[3] = 0; e[7] = 0; e[11] = 0; e[15] = 1;
	const dir = new THREE.Vector3(1, 0, 0).transformDirection(m);
	return { x: dir.x, y: dir.y, z: dir.z };
}

/** Yaw about world +Y decoded from a vehicle's basis, for comparison against
 *  a yaw-packed box's `.w`. */
export function yawOf(v: TrafficStaticVehicle): number {
	const m = new THREE.Matrix4().fromArray(v.mTransform);
	const e = m.elements;
	e[3] = 0; e[7] = 0; e[11] = 0; e[15] = 1;
	const q = new THREE.Quaternion().setFromRotationMatrix(m);
	return new THREE.Euler().setFromQuaternion(q, 'YXZ').y;
}
