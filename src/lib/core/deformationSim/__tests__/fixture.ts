// A hand-checkable car: two sensors in a front/back chain, a body shell, a
// door with a jointed hinge tag, a joint-less trim piece, and the root with
// its four wheel tags (unskinned and last, as on every retail car). Four more
// sensors under the corners carry the car on the ground; like a retail car's
// underside they may not be crushed upward. The wheels, and so the centre of
// mass, sit 0.25 m off the ground, about as high as a retail car's, so the
// slide friction under a crashing car does not tip it over.

import type {
	IKPart, JointSpec, Mat4, ParsedDeformationSpec, SkinBinding, TagPointSpec, Vec3,
} from '../../deformationSpec';

const IDENTITY: Mat4 = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
const skin = (): SkinBinding => ({ vertex: [0, 0, 0, 0], weights: [0, 0, 0], boneIndices: [0, 0, 0] });
const NEVER = 1e16;

export function tag(p: Vec3, sensorA: number, o: Partial<TagPointSpec> = {}): TagPointSpec {
	return {
		offsetFromA: [0, 0, 0], weightA: 1, offsetFromB: [0, 0, 0], weightB: 0, initialPosition: p,
		detachThreshold: NEVER, fWeightA: 1, fWeightB: 0, fDetachThresholdSquared: NEVER,
		deformationSensorA: sensorA, deformationSensorB: sensorA, jointIndex: -1, skinnedPoint: true, ...o,
	};
}

export const doorJoint = (detach = 0.8): JointSpec => ({
	position: [1, 0.5, 0.5, 0], axis: [0, 1, 0, 0], defaultDirection: [0, 0, 1, 0],
	maxJointAngle: 1.0, jointDetachThreshold: detach, jointType: 1,
});

function part(type: number, gfx: number, tagStart: number, tags: number, drivenStart: number, driven: number, joints: JointSpec[] = []): IKPart {
	return {
		graphicsTransform: JSON.parse(JSON.stringify(IDENTITY)), orientation: JSON.parse(JSON.stringify(IDENTITY)),
		cornerSkin: [skin(), skin(), skin(), skin(), skin(), skin(), skin(), skin()], centerSkin: skin(), jointSkin: skin(),
		paJointSpecsOffset: 0, partGraphics: gfx,
		startIndexOfDrivenPoints: drivenStart, numberOfDrivenPoints: driven,
		startIndexOfTagPoints: tagStart, numberOfTagPoints: tags, partType: type, jointSpecs: joints,
	};
}

// Sensor 0 sits at the front (z = 2), sensor 1 behind it (z = 1); a hit on
// sensor 0 along -Z passes on to sensor 1 (slot 2 = sensor 1) and then to
// the body (slot 0).
export function makeSpec(): ParsedDeformationSpec {
	const sensor = (z: number, nextMinusZ: number) => ({
		initialOffset: [0, 0.5, z] as Vec3, directionParams: [0.2, 0.2, 0.2, 0.2, 0.2, 0.3] as [number, number, number, number, number, number],
		radius: 0.4, nextSensor: [0, 0, 0, 0, 0, nextMinusZ] as [number, number, number, number, number, number],
		sceneIndex: 0, absorbtionLevel: 0, nextBoundarySensor: [0, 0] as [number, number],
	});
	const corner = (x: number, z: number) => ({
		...sensor(z, 0), initialOffset: [x, 0.4, z] as Vec3, absorbtionLevel: 4,
		directionParams: [0.2, 0.2, 0, 0.2, 0.2, 0.2] as [number, number, number, number, number, number],
	});
	const sensors = [sensor(2, 2), sensor(1, 0), corner(-0.8, 1.3), corner(0.8, 1.3), corner(-0.8, -1.3), corner(0.8, -1.3)];
	while (sensors.length < 20) sensors.push({ ...sensor(0, 0), initialOffset: [0, 0, 0] });
	const DOOR = { detachThreshold: 0.05, fDetachThresholdSquared: 0.0025 };
	const tagPoints: TagPointSpec[] = [
		tag([0, 0.5, 2.3], 0),                                  // 0 shell nose
		tag([0, 0.5, 1.2], 1),                                  // 1 shell middle
		tag([1, 0.5, 2.1], 0, { ...DOOR, jointIndex: 0 }),      // 2 door hinge tag
		tag([1, 0.5, 2.2], 0, DOOR),                            // 3 door
		tag([0.5, 0.2, 2.2], 0, DOOR),                          // 4 trim (no joint)
		...([[-0.8, 0, 1.3], [0.8, 0, 1.3], [-0.8, 0, -1.3], [0.8, 0, -1.3]] as Vec3[]).map((p) => tag(p, 1, { skinnedPoint: false })),
	];
	// At rest every tag point sits exactly on its sensor-driven target.
	for (const t of tagPoints) {
		const c = sensors[t.deformationSensorA].initialOffset;
		t.offsetFromA = [t.initialPosition[0] - c[0], t.initialPosition[1] - c[1], t.initialPosition[2] - c[2]];
		t.offsetFromB = t.offsetFromA;
	}
	return {
		version: 1, tagPointDataOffset: 0, drivenPointDataOffset: 0, ikPartDataOffset: 0, glassPaneDataOffset: 0,
		genericTagsOffset: 0, cameraTagsOffset: 0, lightTagsOffset: 0,
		handlingBodyDimensions: [1, 0.5, 1.5, 0],
		wheels: ([[-0.8, 0.25, 1.3], [0.8, 0.25, 1.3], [-0.8, 0.25, -1.3], [0.8, 0.25, -1.3]] as Vec3[]).map((p, i) => ({ position: [...p, 1], direction: [0.3, 0.6, 0.6, 0], iValue: 5 + i })),
		sensors,
		carModelSpaceToHandlingBodySpace: [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]],
		specID: 0, numVehicleBodies: 1, numDeformationSensors: 6, numGraphicsParts: 4,
		currentCOMOffset: [0, 0, 0, 0], meshOffset: [0, 0, 0, 0], rigidBodyOffset: [0, 0, 0, 0],
		collisionOffset: [0, 0, 0, 0], inertiaTensor: [1, 1, 1, 0],
		tagPoints,
		drivenPoints: [
			{ initialPos: [0, 0.8, 1.75], distanceFromA: Math.hypot(0.3, 0.55), distanceFromB: Math.hypot(0.3, 0.55), tagPointIndexA: 0, tagPointIndexB: 1 },
		],
		genericTags: [], cameraTags: [], lightTags: [],
		ikParts: [
			part(46, 0, 0, 2, 0, 1),
			part(8, 1, 2, 2, 1, 0, [doorJoint()]),
			part(113, 2, 4, 1, 1, 0),
			part(999, -1, 5, 4, 1, 0),
		],
		glassPanes: [], totalSize: 0,
	};
}
