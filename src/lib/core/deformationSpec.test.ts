// DeformationSpec tests.
//
// Three groups:
//   1. Round-trip on the unchanged fixture must stay byte-exact (regression
//      guard for the layout normalizer not perturbing canonical layouts).
//   2. Field-level edits (no array length change) round-trip and the new
//      value comes back on re-parse.
//   3. Add and remove operations on every variable-length array — these
//      require the layout normalizer to recompute pointers and totalSize.
//      These tests fail until normalizeDeformationSpecLayout is wired up.
//
// Helper: makeBlank<Type>() factories produce a minimal valid instance for
// each struct type. Keeping them in this file (vs a fixtures module) so the
// invariants the test asserts are obvious from the test that uses them.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';

import { parseBundle } from './bundle';
import { extractResourceRaw, resourceCtxFromBundle } from './registry';
import {
	parseDeformationSpecData,
	writeDeformationSpecData,
	type ParsedDeformationSpec,
	type TagPointSpec,
	type DrivenPoint,
	type TransformTag,
	type IKPart,
	type JointSpec,
	type GlassPane,
	type SkinBinding,
	type Mat4,
} from './deformationSpec';

const FIXTURE = path.resolve(__dirname, '../../../example/VEH_CARBRWDS_AT.BIN');
const DEFORMATION_SPEC_TYPE_ID = 0x1001C;

function sha1(b: Uint8Array): string {
	return createHash('sha1').update(b).digest('hex');
}

function loadFixture(): { raw: Uint8Array; ctxLE: boolean } {
	const file = fs.readFileSync(FIXTURE);
	const bytes = new Uint8Array(file.byteLength);
	bytes.set(file);
	const buffer = bytes.buffer;
	const bundle = parseBundle(buffer);
	const ctx = resourceCtxFromBundle(bundle);
	const r = bundle.resources.find((r) => r.resourceTypeId === DEFORMATION_SPEC_TYPE_ID);
	if (!r) throw new Error('No DeformationSpec in fixture');
	return { raw: extractResourceRaw(buffer, bundle, r), ctxLE: ctx.littleEndian };
}

const IDENTITY_MAT: Mat4 = [
	[1, 0, 0, 0],
	[0, 1, 0, 0],
	[0, 0, 1, 0],
	[0, 0, 0, 1],
];

function makeSkinBinding(): SkinBinding {
	return { vertex: [0, 0, 0, 1], weights: [1, 0, 0], boneIndices: [0, 0, 0] };
}

function makeTagPoint(): TagPointSpec {
	return {
		offsetFromA: [0, 0, 0],
		weightA: 1,
		offsetFromB: [0, 0, 0],
		weightB: 0,
		initialPosition: [0, 0, 0],
		detachThreshold: 100,
		fWeightA: 1,
		fWeightB: 0,
		fDetachThresholdSquared: 10000,
		deformationSensorA: 0,
		deformationSensorB: -1,
		jointIndex: -1,
		skinnedPoint: false,
	};
}

function makeDrivenPoint(): DrivenPoint {
	return {
		initialPos: [0, 0, 0],
		distanceFromA: 1,
		distanceFromB: 1,
		tagPointIndexA: 0,
		tagPointIndexB: 1,
	};
}

function makeTransformTag(): TransformTag {
	return { locator: IDENTITY_MAT, tagPointType: 0, ikPartIndex: -1, skinPoint: 0 };
}

function makeJointSpec(): JointSpec {
	return {
		position: [0, 0, 0, 1],
		axis: [0, 1, 0, 0],
		defaultDirection: [1, 0, 0, 0],
		maxJointAngle: 1.5,
		jointDetachThreshold: 1000,
		jointType: 0,
	};
}

function makeIKPart(joints: JointSpec[] = []): IKPart {
	return {
		graphicsTransform: IDENTITY_MAT,
		orientation: IDENTITY_MAT,
		cornerSkin: [
			makeSkinBinding(), makeSkinBinding(), makeSkinBinding(), makeSkinBinding(),
			makeSkinBinding(), makeSkinBinding(), makeSkinBinding(), makeSkinBinding(),
		],
		centerSkin: makeSkinBinding(),
		jointSkin: makeSkinBinding(),
		paJointSpecsOffset: 0, // normalizer fills in
		partGraphics: 0,
		startIndexOfDrivenPoints: 0,
		numberOfDrivenPoints: 0,
		startIndexOfTagPoints: 0,
		numberOfTagPoints: 0,
		partType: 0,
		jointSpecs: joints,
	};
}

function makeGlassPane(): GlassPane {
	return {
		plane: [0, 1, 0, 0],
		matrix: IDENTITY_MAT,
		cornerTagIndices: [0, 1, 2, 3],
		bytes58: [0, 0, 0, 0],
		short5C: 0,
		short5E: 0,
		short60: 0,
		partType: 0,
	};
}

function parseAndReparse(model: ParsedDeformationSpec): ParsedDeformationSpec {
	const bytes = writeDeformationSpecData(model, true);
	return parseDeformationSpecData(bytes, true);
}

// =============================================================================
// 1. Byte-exact baseline round-trip
// =============================================================================

describe('DeformationSpec: unchanged fixture round-trips byte-exact', () => {
	it('writes the same bytes the parser was handed', () => {
		const { raw } = loadFixture();
		const m = parseDeformationSpecData(raw, true);
		const out = writeDeformationSpecData(m, true);
		expect(out.byteLength).toBe(raw.byteLength);
		expect(sha1(out)).toBe(sha1(raw));
	});

	it('writer is idempotent (write twice → identical bytes)', () => {
		const { raw } = loadFixture();
		const m1 = parseDeformationSpecData(raw, true);
		const w1 = writeDeformationSpecData(m1, true);
		const m2 = parseDeformationSpecData(w1, true);
		const w2 = writeDeformationSpecData(m2, true);
		expect(sha1(w2)).toBe(sha1(w1));
	});
});

// =============================================================================
// 2. Field-level edits (no array length change) round-trip
// =============================================================================

describe('DeformationSpec: scalar edits round-trip', () => {
	it('preserves tag point initial-position edits', () => {
		const { raw } = loadFixture();
		const m = parseDeformationSpecData(raw, true);
		m.tagPoints[0].initialPosition = [1, 2, 3];
		const re = parseAndReparse(m);
		expect(re.tagPoints[0].initialPosition).toEqual([1, 2, 3]);
	});

	it('preserves wheel position edits across all 4 wheels', () => {
		const { raw } = loadFixture();
		const m = parseDeformationSpecData(raw, true);
		for (let i = 0; i < 4; i++) m.wheels[i].position = [i, i, i, 1];
		const re = parseAndReparse(m);
		for (let i = 0; i < 4; i++) expect(re.wheels[i].position).toEqual([i, i, i, 1]);
	});

	it('preserves IK part joint angle edits without disturbing pointers', () => {
		const { raw } = loadFixture();
		const m = parseDeformationSpecData(raw, true);
		const partWithJoints = m.ikParts.find((p) => p.jointSpecs.length > 0);
		if (!partWithJoints) throw new Error('test fixture lacks an IK part with joints');
		partWithJoints.jointSpecs[0].maxJointAngle = 0.42;
		const re = parseAndReparse(m);
		const ri = m.ikParts.indexOf(partWithJoints);
		expect(re.ikParts[ri].jointSpecs[0].maxJointAngle).toBeCloseTo(0.42, 6);
	});
});

// =============================================================================
// 3. Add / remove array elements — exercises the layout normalizer
// =============================================================================

describe('DeformationSpec: appending a tag point', () => {
	it('grows totalSize by one stride and shifts every region after tagPoints', () => {
		const { raw } = loadFixture();
		const m = parseDeformationSpecData(raw, true);
		const originalTotal = m.totalSize;
		const originalDrivenPtr = m.drivenPointDataOffset;

		m.tagPoints.push(makeTagPoint());

		const out = writeDeformationSpecData(m, true);
		// totalSize grows by exactly one tag-point stride (0x50).
		expect(out.byteLength).toBe(originalTotal + 0x50);

		const re = parseDeformationSpecData(out, true);
		// On-disk count is implied by tagPoints.length.
		expect(re.tagPoints.length).toBe(m.tagPoints.length);
		// drivenPointDataOffset must shift by exactly one tag-point stride.
		expect(re.drivenPointDataOffset).toBe(originalDrivenPtr + 0x50);
		// And the new (last) tag point is the one we appended (default zeros).
		const last = re.tagPoints[re.tagPoints.length - 1];
		expect(last.weightA).toBe(1);
		expect(last.detachThreshold).toBe(100);
	});
});

describe('DeformationSpec: removing the last tag point', () => {
	it('shrinks totalSize and re-shifts later regions inward', () => {
		const { raw } = loadFixture();
		const m = parseDeformationSpecData(raw, true);
		const originalTotal = m.totalSize;
		const originalDrivenPtr = m.drivenPointDataOffset;

		m.tagPoints.pop();

		const out = writeDeformationSpecData(m, true);
		expect(out.byteLength).toBe(originalTotal - 0x50);

		const re = parseDeformationSpecData(out, true);
		expect(re.tagPoints.length).toBe(m.tagPoints.length);
		expect(re.drivenPointDataOffset).toBe(originalDrivenPtr - 0x50);
	});
});

describe('DeformationSpec: appending a driven point', () => {
	it('shifts ikPartDataOffset and downstream regions by one driven-point stride (0x20)', () => {
		const { raw } = loadFixture();
		const m = parseDeformationSpecData(raw, true);
		const originalIkPtr = m.ikPartDataOffset;
		const originalGlassPtr = m.glassPaneDataOffset;

		m.drivenPoints.push(makeDrivenPoint());

		const out = writeDeformationSpecData(m, true);
		const re = parseDeformationSpecData(out, true);
		expect(re.drivenPoints.length).toBe(m.drivenPoints.length);
		expect(re.ikPartDataOffset).toBe(originalIkPtr + 0x20);
		expect(re.glassPaneDataOffset).toBe(originalGlassPtr + 0x20);
	});
});

describe('DeformationSpec: removing a driven point', () => {
	it('shrinks downstream offsets', () => {
		const { raw } = loadFixture();
		const m = parseDeformationSpecData(raw, true);
		const originalIkPtr = m.ikPartDataOffset;
		m.drivenPoints.pop();
		const out = writeDeformationSpecData(m, true);
		const re = parseDeformationSpecData(out, true);
		expect(re.drivenPoints.length).toBe(m.drivenPoints.length);
		expect(re.ikPartDataOffset).toBe(originalIkPtr - 0x20);
	});
});

describe('DeformationSpec: appending an IK part with no joints', () => {
	it('grows by 0x1E0 (one IK-part header) and updates downstream pointers', () => {
		const { raw } = loadFixture();
		const m = parseDeformationSpecData(raw, true);
		const originalGlassPtr = m.glassPaneDataOffset;

		m.ikParts.push(makeIKPart([]));

		const out = writeDeformationSpecData(m, true);
		const re = parseDeformationSpecData(out, true);
		expect(re.ikParts.length).toBe(m.ikParts.length);
		// Glass pane region pushed back by exactly one IK-part stride.
		expect(re.glassPaneDataOffset).toBe(originalGlassPtr + 0x1E0);
		// The appended IK part lands at the end of the IK array.
		const last = re.ikParts[re.ikParts.length - 1];
		expect(last.jointSpecs).toHaveLength(0);
	});
});

describe('DeformationSpec: appending a joint to an existing IK part', () => {
	it('adds 0x40 to total joint-spec block, downstream regions shift accordingly', () => {
		const { raw } = loadFixture();
		const m = parseDeformationSpecData(raw, true);
		const originalGlassPtr = m.glassPaneDataOffset;
		const partWithJoints = m.ikParts.find((p) => p.jointSpecs.length > 0);
		if (!partWithJoints) throw new Error('test fixture lacks an IK part with joints');

		partWithJoints.jointSpecs.push(makeJointSpec());

		const out = writeDeformationSpecData(m, true);
		const re = parseDeformationSpecData(out, true);
		expect(re.glassPaneDataOffset).toBe(originalGlassPtr + 0x40);
		// The mutated IK part now reports the new joint count + a non-zero
		// paJointSpecsOffset that lies in the joint-spec region (between
		// the IK part struct array end and the glass-pane region start).
		const ri = m.ikParts.indexOf(partWithJoints);
		expect(re.ikParts[ri].jointSpecs).toHaveLength(partWithJoints.jointSpecs.length);
	});
});

describe('DeformationSpec: removing all joints from an IK part', () => {
	it('shrinks downstream regions correspondingly', () => {
		const { raw } = loadFixture();
		const m = parseDeformationSpecData(raw, true);
		const partWithJoints = m.ikParts.find((p) => p.jointSpecs.length > 0);
		if (!partWithJoints) throw new Error('test fixture lacks an IK part with joints');
		const droppedCount = partWithJoints.jointSpecs.length;
		const originalGlassPtr = m.glassPaneDataOffset;

		partWithJoints.jointSpecs = [];

		const out = writeDeformationSpecData(m, true);
		const re = parseDeformationSpecData(out, true);
		expect(re.glassPaneDataOffset).toBe(originalGlassPtr - droppedCount * 0x40);
		const ri = m.ikParts.indexOf(partWithJoints);
		expect(re.ikParts[ri].jointSpecs).toHaveLength(0);
	});
});

describe('DeformationSpec: appending a glass pane', () => {
	it('shifts generic/camera/light-tag regions by one glass-pane stride (0x70)', () => {
		const { raw } = loadFixture();
		const m = parseDeformationSpecData(raw, true);
		const originalGenericPtr = m.genericTagsOffset;
		const originalCameraPtr = m.cameraTagsOffset;
		const originalLightPtr = m.lightTagsOffset;

		m.glassPanes.push(makeGlassPane());

		const out = writeDeformationSpecData(m, true);
		const re = parseDeformationSpecData(out, true);
		expect(re.glassPanes.length).toBe(m.glassPanes.length);
		expect(re.genericTagsOffset).toBe(originalGenericPtr + 0x70);
		expect(re.cameraTagsOffset).toBe(originalCameraPtr + 0x70);
		expect(re.lightTagsOffset).toBe(originalLightPtr + 0x70);
	});
});

describe('DeformationSpec: removing a glass pane', () => {
	it('shrinks downstream offsets by one glass-pane stride', () => {
		const { raw } = loadFixture();
		const m = parseDeformationSpecData(raw, true);
		const originalGenericPtr = m.genericTagsOffset;
		m.glassPanes.pop();
		const out = writeDeformationSpecData(m, true);
		const re = parseDeformationSpecData(out, true);
		expect(re.glassPanes.length).toBe(m.glassPanes.length);
		expect(re.genericTagsOffset).toBe(originalGenericPtr - 0x70);
	});
});

describe('DeformationSpec: appending a generic transform tag', () => {
	it('shifts cameraTags and lightTags pointers by 0x50', () => {
		const { raw } = loadFixture();
		const m = parseDeformationSpecData(raw, true);
		const originalCameraPtr = m.cameraTagsOffset;
		const originalLightPtr = m.lightTagsOffset;

		m.genericTags.push(makeTransformTag());

		const out = writeDeformationSpecData(m, true);
		const re = parseDeformationSpecData(out, true);
		expect(re.genericTags.length).toBe(m.genericTags.length);
		expect(re.cameraTagsOffset).toBe(originalCameraPtr + 0x50);
		expect(re.lightTagsOffset).toBe(originalLightPtr + 0x50);
	});
});

describe('DeformationSpec: removing a light tag', () => {
	it('shrinks totalSize by one tag stride', () => {
		const { raw } = loadFixture();
		const m = parseDeformationSpecData(raw, true);
		const originalTotal = m.totalSize;

		m.lightTags.pop();

		const out = writeDeformationSpecData(m, true);
		expect(out.byteLength).toBe(originalTotal - 0x50);
		const re = parseDeformationSpecData(out, true);
		expect(re.lightTags.length).toBe(m.lightTags.length);
	});
});
