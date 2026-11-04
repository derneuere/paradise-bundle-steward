// A small but complete synthetic car spec + body for the deform-rig tests:
// door, bonnet, body shell, four wheel arches and the root with its four
// wheel tags (unskinned and last, as in every retail car).

import type {
	IKPart, JointSpec, Mat4, ParsedDeformationSpec, SkinBinding, TagPointSpec, Vec3,
} from '../../../../src/lib/core/deformationSpec';
import type { GfxPart, TargetBody } from '../geometry';
import { NEVER_DETACH_VALUE } from '../parts';

export const IDENTITY: Mat4 = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
const translate = (p: Vec3): Mat4 => [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [p[0], p[1], p[2], 1]];
const skin = (): SkinBinding => ({ vertex: [0, 0, 0, 0], weights: [0, 0, 0], boneIndices: [0, 0, 0] });

export function tag(p: Vec3, o: Partial<TagPointSpec> = {}): TagPointSpec {
	return {
		offsetFromA: [0, 0, 0], weightA: 1, offsetFromB: [0, 0, 0], weightB: 0, initialPosition: p,
		detachThreshold: NEVER_DETACH_VALUE, fWeightA: 1, fWeightB: 0, fDetachThresholdSquared: NEVER_DETACH_VALUE,
		deformationSensorA: 0, deformationSensorB: 1, jointIndex: -1, skinnedPoint: true, ...o,
	};
}

export const joint = (detach: number): JointSpec => ({
	position: [0.8, 0.7, 1, 1], axis: [0, 1, 0, 0], defaultDirection: [0, 0, 1, 0],
	maxJointAngle: 1.05, jointDetachThreshold: detach, jointType: 1,
});

type PartDef = { type: number; gfx: number; tags: TagPointSpec[]; driven: number; joints?: JointSpec[] };

const DETACHABLE = { detachThreshold: 0.3, fDetachThresholdSquared: 0.09 };

export function makeSpec(shiftY = -0.6): ParsedDeformationSpec {
	const wheelPos: Vec3[] = [[-0.8, 0.0, 1.3], [0.8, 0.0, 1.3], [-0.8, 0.0, -1.3], [0.8, 0.0, -1.3]];
	const defs: PartDef[] = [
		{ type: 8, gfx: 1, tags: [tag([0.9, 0.3, 0.5], { ...DETACHABLE, jointIndex: 0 }), tag([0.9, 0.3, 0.9], DETACHABLE)], driven: 2, joints: [joint(0.8)] },
		{ type: 3, gfx: 2, tags: [tag([0, 0.5, 1.5], { ...DETACHABLE, jointIndex: 0 })], driven: 1, joints: [joint(0.9)] },
		{ type: 46, gfx: 0, tags: [tag([-1, 0, -2]), tag([1, 0.8, 2]), tag([0, 0.4, 0])], driven: 2 },
		{ type: 48, gfx: 3, tags: [tag([-0.8, 0.2, 1.3], { jointIndex: 0 })], driven: 0, joints: [joint(-1)] },
		{ type: 49, gfx: 4, tags: [tag([0.8, 0.2, 1.3])], driven: 0 },
		{ type: 50, gfx: 5, tags: [tag([-0.8, 0.2, -1.3])], driven: 0 },
		{ type: 51, gfx: 6, tags: [tag([0.8, 0.2, -1.3])], driven: 0 },
		{ type: 999, gfx: -1, tags: wheelPos.map((p) => tag(p, { ...DETACHABLE, skinnedPoint: false })), driven: 0 },
	];
	const tagPoints: TagPointSpec[] = [];
	let driven = 0;
	const ikParts: IKPart[] = defs.map((d) => {
		const part: IKPart = {
			graphicsTransform: JSON.parse(JSON.stringify(IDENTITY)), orientation: JSON.parse(JSON.stringify(IDENTITY)),
			cornerSkin: [skin(), skin(), skin(), skin(), skin(), skin(), skin(), skin()], centerSkin: skin(), jointSkin: skin(),
			paJointSpecsOffset: 0, partGraphics: d.gfx,
			startIndexOfDrivenPoints: driven, numberOfDrivenPoints: d.driven,
			startIndexOfTagPoints: tagPoints.length, numberOfTagPoints: d.tags.length,
			partType: d.type, jointSpecs: d.joints ?? [],
		};
		tagPoints.push(...d.tags);
		driven += d.driven;
		return part;
	});
	return {
		version: 1, tagPointDataOffset: 0, drivenPointDataOffset: 0, ikPartDataOffset: 0, glassPaneDataOffset: 0,
		genericTagsOffset: 0, cameraTagsOffset: 0, lightTagsOffset: 0,
		handlingBodyDimensions: [1, 0.5, 2, 0],
		wheels: wheelPos.map((p, i) => ({ position: [...p, 1], direction: [0.35, 0.65, 0.65, 0], iValue: tagPoints.length - 4 + i })),
		sensors: Array.from({ length: 20 }, (_, i) => ({
			initialOffset: (i < 2 ? [i ? 1 : -1, 0.3, 0] : [0, 0, 0]) as Vec3, directionParams: [0, 0, 0, 0, 0, 0], radius: 0.5,
			nextSensor: [0, 0, 0, 0, 0, 0], sceneIndex: 0, absorbtionLevel: 0, nextBoundarySensor: [0, 0],
		})),
		carModelSpaceToHandlingBodySpace: translate([0, shiftY, 0]),
		specID: 0, numVehicleBodies: 1, numDeformationSensors: 2, numGraphicsParts: 40,
		currentCOMOffset: [0, 0, 0, 0], meshOffset: [0, -shiftY, 0, 0], rigidBodyOffset: [0, -shiftY, 0, 0],
		collisionOffset: [0, -shiftY, 0, 0], inertiaTensor: [1, 1, 1, 0],
		tagPoints,
		drivenPoints: Array.from({ length: driven }, () => ({
			initialPos: [0, 0.4, 0] as Vec3, distanceFromA: 0, distanceFromB: 0, tagPointIndexA: 0, tagPointIndexB: 1,
		})),
		genericTags: [{ locator: translate([0, 0.5, 2]), tagPointType: 0, ikPartIndex: 2, skinPoint: 0 }],
		cameraTags: [], lightTags: [], ikParts, glassPanes: [], totalSize: 0,
	};
}

const gfxPart = (index: number, min: Vec3, max: Vec3, locator = IDENTITY): GfxPart => {
	const centroid = [0, 1, 2].map((k) => (min[k] + max[k]) / 2) as Vec3;
	const box = { min: { x: min[0], y: min[1], z: min[2] }, max: { x: max[0], y: max[1], z: max[2] } };
	return {
		index, locator, translation: [locator[3][0], locator[3][1], locator[3][2]], centroid,
		// TODO(types): the tests only read min/max off the box, not the full THREE.Box3 API
		box: box as unknown as GfxPart['box'],
		volume: (max[0] - min[0]) * (max[1] - min[1]) * (max[2] - min[2]),
	};
};

// A body box of [-1,1] x [0,1] x [-2,2] in mesh space.
export function makeBody(): TargetBody {
	const parts = [
		gfxPart(0, [-1, 0, -2], [1, 1, 2]),
		gfxPart(1, [0.8, 0.2, 0.4], [1, 0.6, 1], translate([0.9, 0.4, 0.7])),
		gfxPart(2, [-0.5, 0.6, 1], [0.5, 0.8, 1.8]),
		gfxPart(3, [-0.9, 0.3, 1.1], [-0.7, 0.7, 1.5], translate([-0.8, 0.5, 1.3])),
		gfxPart(4, [0.7, 0.3, 1.1], [0.9, 0.7, 1.5], translate([0.8, 0.5, 1.3])),
		gfxPart(5, [-0.9, 0.3, -1.5], [-0.7, 0.7, -1.1], translate([-0.8, 0.5, -1.3])),
		gfxPart(6, [0.7, 0.3, -1.5], [0.9, 0.7, -1.1], translate([0.8, 0.5, -1.3])),
	];
	const corners = new Map([48, 49, 50, 51].map((arch, i) => [arch, { arch, gfx: 3 + i, position: parts[3 + i].translation }]));
	return {
		parts, skinRows: 0, corners, wheelMeshes: new Set([3, 4, 5, 6]),
		wheelPartGfx: new Map([...corners.values()].map((c) => [c.arch, c.gfx])),
		min: [-1, 0, -2], max: [1, 1, 2], center: [0, 0.5, 0], half: [1, 0.5, 2], shellGfx: 0,
	};
}
