import { describe, expect, it } from 'vitest';
import {
	parseDeformationSpecData, writeDeformationSpecData, type Vec3,
} from '../../../../src/lib/core/deformationSpec';
import { canLeaveCar, crashBehaviour, NEVER_DETACH_SQUARED } from '../parts';
import {
	adoptTargetPhysics, bindPartToGfx, boxRemap, engineProblems, neutralizePart, ownWheelMeshes, partTags, placeWheels,
	remapSpec, specSkinRows, stripJoints, toHandlingSpace, toMeshSpace,
} from '../spec';
import { joint, makeBody, makeSpec } from './fixture';

const close = (a: readonly number[], b: readonly number[]) => a.forEach((v, k) => expect(v).toBeCloseTo(b[k], 6));
const partOf = (spec: ReturnType<typeof makeSpec>, type: number) => spec.ikParts.find((p) => p.partType === type)!;

describe('crashBehaviour', () => {
	it('follows the engine rules for how a part leaves the car', () => {
		const spec = makeSpec();
		const b = (type: number) => crashBehaviour(partOf(spec, type), spec.tagPoints);
		expect(b(8)).toBe('hinges, breaks off');
		expect(b(3)).toBe('hinges, never breaks'); // the bonnet pops open but never comes off
		expect(b(46)).toBe('dent only');
		expect(b(999)).toBe('inert'); // no mesh to detach
		const door = partOf(spec, 8);
		door.jointSpecs = [joint(-1)];
		expect(b(8)).toBe('hinges, never breaks');
		for (const t of partTags(spec, door)) t.jointIndex = -1;
		expect(b(8)).toBe('flies off');
		expect(canLeaveCar(b(8))).toBe(true);
	});
});

describe('engineProblems', () => {
	it('passes a well-formed spec', () => {
		expect(engineProblems(makeSpec(), 7, specSkinRows(makeSpec()))).toEqual([]);
	});

	it('catches a tag pointing at a joint its part no longer has', () => {
		const spec = makeSpec();
		partOf(spec, 48).jointSpecs = [];
		expect(engineProblems(spec).join()).toMatch(/tag joint 0 >= 0 joints/);
	});

	it('catches dangling wheel, locator and range indices', () => {
		const spec = makeSpec();
		spec.wheels[2].iValue = spec.tagPoints.length;
		spec.genericTags[0].ikPartIndex = spec.ikParts.length;
		partOf(spec, 46).numberOfTagPoints = 200;
		const p = engineProblems(spec, 7).join('\n');
		expect(p).toMatch(/header wheel 2/);
		expect(p).toMatch(/locator ikPartIndex/);
		expect(p).toMatch(/tag range ends/);
	});

	it('flags a mesh that addresses a different number of skin rows', () => {
		const spec = makeSpec();
		expect(engineProblems(spec, 7, specSkinRows(spec) + 1).join()).toMatch(/dent the wrong vertices/);
	});
});

describe('specSkinRows', () => {
	it('counts the leading run of skinned tags plus every driven point', () => {
		const spec = makeSpec();
		const skinned = spec.tagPoints.length - 4; // the four wheel tags are unskinned and last
		expect(specSkinRows(spec)).toBe(skinned + spec.drivenPoints.length);
		spec.tagPoints[1].skinnedPoint = false;
		expect(specSkinRows(spec)).toBe(1 + spec.drivenPoints.length);
	});
});

describe('part edits', () => {
	it('stripJoints clears the tag joint indices with the joints', () => {
		const spec = makeSpec();
		stripJoints(spec, partOf(spec, 8));
		expect(partTags(spec, partOf(spec, 8)).every((t) => t.jointIndex === -1)).toBe(true);
		expect(engineProblems(spec)).toEqual([]);
	});

	it('neutralizePart keeps the points but the part can never move or leave', () => {
		const spec = makeSpec();
		const before = { tags: spec.tagPoints.length, rows: specSkinRows(spec) };
		const door = partOf(spec, 8);
		neutralizePart(spec, door);
		expect(door.partGraphics).toBe(-1);
		expect(door.jointSpecs).toEqual([]);
		expect(partTags(spec, door).every((t) => t.fDetachThresholdSquared >= NEVER_DETACH_SQUARED)).toBe(true);
		expect(crashBehaviour(door, spec.tagPoints)).toBe('inert');
		expect({ tags: spec.tagPoints.length, rows: specSkinRows(spec) }).toEqual(before);
	});

	it('bindPartToGfx copies the mesh locator into graphicsTransform', () => {
		const spec = makeSpec(), body = makeBody();
		bindPartToGfx(partOf(spec, 8), body.parts[1]);
		expect(partOf(spec, 8).partGraphics).toBe(1);
		expect(partOf(spec, 8).graphicsTransform).toEqual(body.parts[1].locator);
	});
});

describe('frames and remap', () => {
	it('shifts between mesh and handling frames by the model->handling translation', () => {
		const spec = makeSpec(-0.6);
		close(toHandlingSpace(spec, [0, 0.5, 0]), [0, -0.1, 0]);
		close(toMeshSpace(spec, toHandlingSpace(spec, [0.3, 0.2, 0.1])), [0.3, 0.2, 0.1]);
	});

	it('maps a car onto its own body as the identity', () => {
		const spec = makeSpec(), body = makeBody();
		const { R } = boxRemap(spec, spec, body, body);
		for (const p of [[0, 0, 0], [1, -0.6, 2], [-0.4, 0.3, 1.1]] as Vec3[]) close(R(p), p);
	});

	it('maps donor box corners onto target box corners in the target frame', () => {
		const donor = makeSpec(-0.6), targetSpec = makeSpec(-0.2), body = makeBody();
		const big = { ...body, min: [-2, 0, -4] as Vec3, max: [2, 2, 4] as Vec3, center: [0, 1, 0] as Vec3, half: [2, 1, 4] as Vec3 };
		const { R } = boxRemap(donor, targetSpec, big, body);
		close(R(toHandlingSpace(donor, [1, 1, 2])), toHandlingSpace(targetSpec, [2, 2, 4]));
		close(R(toHandlingSpace(donor, [-1, 0, -2])), toHandlingSpace(targetSpec, [-2, 0, -4]));
	});

	it('remapSpec moves every positional field and keeps tag offsets consistent', () => {
		const spec = makeSpec();
		const R = (p: Vec3): Vec3 => [p[0] * 2, p[1] + 1, p[2]];
		remapSpec(spec, R);
		const t = spec.tagPoints[0], a = spec.sensors[t.deformationSensorA].initialOffset;
		close(t.offsetFromA, [0, 1, 2].map((k) => t.initialPosition[k] - a[k]));
		close(spec.genericTags[0].locator[3].slice(0, 3), [0, 1.5, 2]);
		close(partOf(spec, 8).jointSpecs[0].position.slice(0, 3), [1.6, 1.7, 1]);
	});
});

describe('placeWheels', () => {
	it('adopts the target spec wheels and moves each wheel tag onto its wheel', () => {
		const spec = makeSpec(), target = makeSpec();
		target.wheels.forEach((w, i) => { w.position = [i % 2 ? 0.9 : -0.9, -0.3, i < 2 ? 1.4 : -1.4, 1]; });
		placeWheels(spec, target, makeBody());
		spec.wheels.forEach((w, i) => {
			close(w.position, target.wheels[i].position);
			close(spec.tagPoints[w.iValue].initialPosition, target.wheels[i].position.slice(0, 3));
		});
	});

	it('falls back to the wheel-corner mesh, shifted into the handling frame', () => {
		const spec = makeSpec(-0.6), target = makeSpec(-0.6), body = makeBody();
		target.wheels.forEach((w) => { w.position = [0, 0, 0, 1]; });
		placeWheels(spec, target, body);
		close(spec.wheels[0].position.slice(0, 3), [-0.8, -0.1, 1.3]);
	});
});

describe('ownWheelMeshes / adoptTargetPhysics', () => {
	it('reads which meshes the wheel parts drive', () => {
		const own = ownWheelMeshes(makeSpec());
		expect([...own.arches]).toEqual([[48, 3], [49, 4], [50, 5], [51, 6]]);
		expect(own.pairs.size).toBe(0);
	});

	it('takes the physics and graphics-count fields from the target', () => {
		const spec = makeSpec(-0.6), target = makeSpec(-0.2);
		target.numGraphicsParts = 9;
		adoptTargetPhysics(spec, target);
		expect(spec.carModelSpaceToHandlingBodySpace).toEqual(target.carModelSpaceToHandlingBodySpace);
		expect(spec.meshOffset).toEqual(target.meshOffset);
		expect(spec.numGraphicsParts).toBe(9);
	});
});

it('a neutralised rig survives a write/parse round trip with no engine problems', () => {
	const spec = makeSpec();
	neutralizePart(spec, partOf(spec, 8));
	stripJoints(spec, partOf(spec, 48));
	const back = parseDeformationSpecData(writeDeformationSpecData(spec));
	expect(engineProblems(back, 7, specSkinRows(spec))).toEqual([]);
	expect(back.ikParts.map((p) => p.partGraphics)).toEqual(spec.ikParts.map((p) => p.partGraphics));
	expect(back.wheels.map((w) => w.iValue)).toEqual(spec.wheels.map((w) => w.iValue));
});
