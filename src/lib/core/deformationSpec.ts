// DeformationSpec resource parser and writer.
// Resource type ID: 0x1001C (a.k.a. StreamedDeformation / StreamedDeformationSpec).
// Wiki: none yet (this file documents the observed layout).
// Blender reference: import_bpr_models.py:2368 (read_deformationspec).
// Fixture: example/VEH_CARBRWDS_AT.BIN
//
// DeformationSpec carries all per-vehicle physics and crash-deformation
// data: a handling-body AABB, 4 wheel mount points, 20 deformation sensors,
// per-tag-point / per-driven-point linkage for the soft-body solver, a
// 33-part IK hierarchy with per-part joint specs, glass-pane panels that
// shatter on impact, and three parallel tables of transform tags
// (generic / camera / light) used for locators, camera mounts, and
// headlight placements.
//
// Round-trip strategy mirrors `polygonSoupList.ts`:
//
//   - Parser produces a structured model with region pointers (and
//     `paJointSpecsOffset` per IK part) preserved as bookkeeping. No raw
//     bytes are stored.
//
//   - Writer always calls `normalizeDeformationSpecLayout` first to get a
//     fresh, canonical layout, then allocates a zero-filled buffer of the
//     normalized totalSize and writes every structured field at its
//     known position. Padding bytes stay zero. Empirically verified
//     against the fixture: all 582 padding spans in VEH_CARBRWDS_AT.BIN
//     are already zero, so this gives byte-exact round-trip on unchanged
//     input and well-defined output for any add/remove edit.
//
// Canonical region order (matches the fixture):
//
//   header(0x000..0x6B0)   inline data
//   tagPoints              numTagPoints * 0x50
//   drivenPoints           numDrivenPoints * 0x20
//   ikParts (struct array) numIKParts * 0x1E0
//   jointSpecs             concatenated, in IK-part order, only for parts
//                          with joints; 0x40 each
//   glassPanes             numGlassPanes * 0x70
//   genericTags            numGenericTags * 0x50
//   cameraTags             numCameraTags * 0x50
//   lightTags              numLightTags * 0x50
//
// IK parts with no joints keep `paJointSpecsOffset = 0` after normalization.
//
// ---- Header layout (inline, +0x00 .. +0x6B0) ----
//
//   +0x00  i32  miVersionNumber                   observed: 1
//   +0x04  u32  maTagPointData                    pointer (recomputed)
//   +0x08  i32  miNumberOfTagPoints               derived from .tagPoints.length
//   +0x0C  u32  maDrivenPointData                 pointer (recomputed)
//   +0x10  i32  miNumberOfDrivenPoints
//   +0x14  u32  maIKPartData                      pointer (recomputed)
//   +0x18  i32  miNumberOfIKParts
//   +0x1C  u32  maGlassPaneData                   pointer (recomputed)
//   +0x20  i32  miNumGlassPanes
//   +0x24  u32  numGenericTags                    derived
//   +0x28  u32  mGenericTags.ptr                  pointer (recomputed)
//   +0x2C  u32  numCameraTags
//   +0x30  u32  mCameraTags.ptr                   pointer (recomputed)
//   +0x34  u32  numLightTags
//   +0x38  u32  mLightTags.ptr                    pointer (recomputed)
//   +0x3C  u32  padding
//   +0x40  4xf32 mHandlingBodyDimensions
//   +0x50  4 × WheelSpec (0x30 each)              FR, FL, RR, RL order
//   +0x110 20 × DeformationSensorSpec (0x40)
//   +0x610 4x4 f32 mCarModelSpaceToHandlingBody
//   +0x650 4 × u8 (specID, numVehicleBodies, numDeformationSensors,
//                    numGraphicsParts) + 0xC padding
//   +0x660 5 × Vec4 (currentCOMOffset, meshOffset, rigidBodyOffset,
//                     collisionOffset, inertiaTensor)
//   +0x6B0 end of inline header — variable-length regions follow

// =============================================================================
// Constants
// =============================================================================

export const DEFORMATION_SPEC_TYPE_ID = 0x1001C;

export const DS_WHEEL_SPEC_STRIDE       = 0x30;
export const DS_SENSOR_SPEC_STRIDE      = 0x40;
export const DS_TAG_POINT_STRIDE        = 0x50;
export const DS_DRIVEN_POINT_STRIDE     = 0x20;
export const DS_TAG_STRIDE              = 0x50; // generic/camera/light
export const DS_IK_PART_STRIDE          = 0x1E0;
export const DS_JOINT_SPEC_STRIDE       = 0x40;
export const DS_GLASS_PANE_STRIDE       = 0x70;
export const DS_NUM_WHEELS              = 4;
export const DS_NUM_SENSOR_SLOTS        = 20;

export const DS_HEADER_END = 0x6B0;

// =============================================================================
// Numeric-vector aliases
// =============================================================================

export type Vec3 = [number, number, number];
export type Vec4 = [number, number, number, number];
/** 4×4 float matrix as 4 rows of 4 floats, row-major (matches the on-disk
 *  layout in Blender's reader — transpose to column-major for THREE.js). */
export type Mat4 = [Vec4, Vec4, Vec4, Vec4];

// =============================================================================
// Structured types
// =============================================================================

/** Per-wheel mount point. One each for FR, FL, RR, RL in that order. */
export type WheelSpec = {
	position: Vec4;
	direction: Vec4;
	/** Integer slot value — small wheel-kind tag in practice. */
	iValue: number;
};

/** One of 20 deformation sensors — sphere-of-influence for damage propagation. */
export type DeformationSensorSpec = {
	initialOffset: Vec3;
	directionParams: [number, number, number, number, number, number];
	radius: number;
	/** 6 adjacency indices for crash propagation (u8 each). */
	nextSensor: [number, number, number, number, number, number];
	sceneIndex: number;       // u8
	absorbtionLevel: number;  // u8
	nextBoundarySensor: [number, number]; // 2 u8
};

/** Soft-body tag point — every mesh vertex that can move on impact. */
export type TagPointSpec = {
	offsetFromA: Vec3;
	weightA: number;
	offsetFromB: Vec3;
	weightB: number;
	initialPosition: Vec3;
	detachThreshold: number;
	// Redundant float copies (the game reads these separately at runtime).
	fWeightA: number;
	fWeightB: number;
	fDetachThresholdSquared: number;
	deformationSensorA: number; // i16
	deformationSensorB: number; // i16
	jointIndex: number;         // i8
	skinnedPoint: boolean;      // u8
};

/** Driven point — point whose position is derived from two tag points. */
export type DrivenPoint = {
	initialPos: Vec3;
	distanceFromA: number;
	distanceFromB: number;
	tagPointIndexA: number; // i16
	tagPointIndexB: number; // i16
};

/** Shared shape for generic / camera / light transform tags. */
export type TransformTag = {
	locator: Mat4;
	tagPointType: number; // i32
	ikPartIndex: number;  // i16
	skinPoint: number;    // u8
};

/** One skin-binding entry (vertex + 3 bone weights + 3 bone indices). */
export type SkinBinding = {
	vertex: Vec4;
	weights: Vec3;
	boneIndices: [number, number, number];
};

/** One joint spec inside an IK part's variable-length joint array. */
export type JointSpec = {
	position: Vec4;
	axis: Vec4;
	defaultDirection: Vec4;
	maxJointAngle: number;
	jointDetachThreshold: number;
	jointType: number; // i32
};

/** One IK part — a rigid segment of the vehicle body with its own bbox, joint
 *  chain, and range of tag / driven points. */
export type IKPart = {
	graphicsTransform: Mat4;
	orientation: Mat4;
	cornerSkin: [SkinBinding, SkinBinding, SkinBinding, SkinBinding,
	              SkinBinding, SkinBinding, SkinBinding, SkinBinding];
	centerSkin: SkinBinding;
	jointSkin: SkinBinding;
	/** Absolute pointer into the resource for this part's joint-spec block.
	 *  Recomputed by the normalizer for parts with joints; preserved for
	 *  parts with `jointSpecs.length === 0` (typically 0 in practice). */
	paJointSpecsOffset: number;
	partGraphics: number;              // i32
	startIndexOfDrivenPoints: number;  // i32
	numberOfDrivenPoints: number;      // i32
	startIndexOfTagPoints: number;     // i32
	numberOfTagPoints: number;         // i32
	partType: number;                  // i32
	jointSpecs: JointSpec[];           // length = on-disk numJoints
};

/** Glass pane — shatters on impact. Layout notes:
 *
 *   +0x00  Vec4         normal + distance (plane form)
 *   +0x10  Mat4         pane→world transform
 *   +0x50  4 × i16      tag-point indices at the corners
 *   +0x58  4 × u8
 *   +0x5C  i16
 *   +0x5E  i16
 *   +0x60  i16
 *   +0x62  2 bytes padding
 *   +0x64  i32          mePartType (enum)
 *   +0x68  8 bytes padding
 */
export type GlassPane = {
	plane: Vec4;
	matrix: Mat4;
	cornerTagIndices: [number, number, number, number];
	bytes58: [number, number, number, number];
	short5C: number;
	short5E: number;
	short60: number;
	partType: number; // i32
};

// =============================================================================
// Top-level model
// =============================================================================

export type ParsedDeformationSpec = {
	// Decoded header fields.
	version: number;

	// Region pointers — preserved for inspection, but the writer always
	// re-derives them from the canonical layout via the normalizer.
	tagPointDataOffset: number;
	drivenPointDataOffset: number;
	ikPartDataOffset: number;
	glassPaneDataOffset: number;
	genericTagsOffset: number;
	cameraTagsOffset: number;
	lightTagsOffset: number;

	handlingBodyDimensions: Vec4;

	// Fixed-count inline arrays.
	wheels: WheelSpec[];              // always length 4
	sensors: DeformationSensorSpec[]; // always length 20

	carModelSpaceToHandlingBodySpace: Mat4;

	specID: number;                // u8
	numVehicleBodies: number;      // u8
	numDeformationSensors: number; // u8
	numGraphicsParts: number;      // u8

	currentCOMOffset: Vec4;
	meshOffset: Vec4;
	rigidBodyOffset: Vec4;
	collisionOffset: Vec4;
	inertiaTensor: Vec4;

	// Variable-count pointer-resolved arrays. The on-disk header counts
	// (`miNumberOfTagPoints`, etc.) are derived from these arrays' lengths
	// at write time — there's no separate `numXxx` field on the model.
	tagPoints: TagPointSpec[];
	drivenPoints: DrivenPoint[];
	genericTags: TransformTag[];
	cameraTags: TransformTag[];
	lightTags: TransformTag[];
	ikParts: IKPart[];
	glassPanes: GlassPane[];

	/** Total resource byte length. Recomputed by the normalizer. */
	totalSize: number;
};

// =============================================================================
// Low-level vector readers / writers
// =============================================================================

function readVec3(dv: DataView, off: number): Vec3 {
	return [dv.getFloat32(off, true), dv.getFloat32(off + 4, true), dv.getFloat32(off + 8, true)];
}
function readVec4(dv: DataView, off: number): Vec4 {
	return [
		dv.getFloat32(off, true), dv.getFloat32(off + 4, true),
		dv.getFloat32(off + 8, true), dv.getFloat32(off + 12, true),
	];
}
function readMat4(dv: DataView, off: number): Mat4 {
	return [readVec4(dv, off), readVec4(dv, off + 16), readVec4(dv, off + 32), readVec4(dv, off + 48)];
}

function writeVec3(dv: DataView, off: number, v: Vec3): void {
	dv.setFloat32(off, v[0], true); dv.setFloat32(off + 4, v[1], true); dv.setFloat32(off + 8, v[2], true);
}
function writeVec4(dv: DataView, off: number, v: Vec4): void {
	dv.setFloat32(off, v[0], true); dv.setFloat32(off + 4, v[1], true);
	dv.setFloat32(off + 8, v[2], true); dv.setFloat32(off + 12, v[3], true);
}
function writeMat4(dv: DataView, off: number, m: Mat4): void {
	writeVec4(dv, off, m[0]); writeVec4(dv, off + 16, m[1]);
	writeVec4(dv, off + 32, m[2]); writeVec4(dv, off + 48, m[3]);
}

function readSkinBinding(dv: DataView, off: number): SkinBinding {
	return {
		vertex: readVec4(dv, off),
		weights: [dv.getFloat32(off + 16, true), dv.getFloat32(off + 20, true), dv.getFloat32(off + 24, true)],
		boneIndices: [dv.getUint8(off + 28), dv.getUint8(off + 29), dv.getUint8(off + 30)],
	};
}
function writeSkinBinding(dv: DataView, off: number, s: SkinBinding): void {
	writeVec4(dv, off, s.vertex);
	dv.setFloat32(off + 16, s.weights[0], true);
	dv.setFloat32(off + 20, s.weights[1], true);
	dv.setFloat32(off + 24, s.weights[2], true);
	dv.setUint8(off + 28, s.boneIndices[0] & 0xFF);
	dv.setUint8(off + 29, s.boneIndices[1] & 0xFF);
	dv.setUint8(off + 30, s.boneIndices[2] & 0xFF);
}

// =============================================================================
// Parser
// =============================================================================

export function parseDeformationSpecData(
	raw: Uint8Array,
	littleEndian: boolean = true,
): ParsedDeformationSpec {
	if (!littleEndian) {
		throw new Error('DeformationSpec parser is little-endian only (no BE fixture)');
	}
	if (raw.byteLength < DS_HEADER_END) {
		throw new Error(
			`DeformationSpec too small (${raw.byteLength} bytes, need at least ${DS_HEADER_END})`,
		);
	}
	const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
	const u32 = (off: number) => dv.getUint32(off, true);
	const i32 = (off: number) => dv.getInt32(off, true);

	// ---- Top-level header ----
	const version            = i32(0x00);
	const tagPointDataOffset = u32(0x04);
	const numTagPoints       = i32(0x08);
	const drivenPointDataOffset = u32(0x0C);
	const numDrivenPoints    = i32(0x10);
	const ikPartDataOffset   = u32(0x14);
	const numIKParts         = i32(0x18);
	const glassPaneDataOffset = u32(0x1C);
	const numGlassPanes      = i32(0x20);
	const numGenericTags     = u32(0x24);
	const genericTagsOffset  = u32(0x28);
	const numCameraTags      = u32(0x2C);
	const cameraTagsOffset   = u32(0x30);
	const numLightTags       = u32(0x34);
	const lightTagsOffset    = u32(0x38);
	// 0x3C: 4 bytes padding (verified zero in fixture)

	const handlingBodyDimensions: Vec4 = readVec4(dv, 0x40);

	// ---- Wheels (4 × WheelSpec at +0x50) ----
	const wheels: WheelSpec[] = [];
	for (let i = 0; i < DS_NUM_WHEELS; i++) {
		const base = 0x50 + i * DS_WHEEL_SPEC_STRIDE;
		wheels.push({
			position: readVec4(dv, base + 0x00),
			direction: readVec4(dv, base + 0x10),
			iValue: i32(base + 0x20),
		});
	}

	// ---- Deformation sensors (20 × 0x40 at +0x110) ----
	const sensors: DeformationSensorSpec[] = [];
	const sensorBase = 0x50 + DS_NUM_WHEELS * DS_WHEEL_SPEC_STRIDE;
	for (let i = 0; i < DS_NUM_SENSOR_SLOTS; i++) {
		const base = sensorBase + i * DS_SENSOR_SPEC_STRIDE;
		sensors.push({
			initialOffset: readVec3(dv, base),
			directionParams: [
				dv.getFloat32(base + 0x10, true), dv.getFloat32(base + 0x14, true),
				dv.getFloat32(base + 0x18, true), dv.getFloat32(base + 0x1C, true),
				dv.getFloat32(base + 0x20, true), dv.getFloat32(base + 0x24, true),
			],
			radius: dv.getFloat32(base + 0x28, true),
			nextSensor: [
				dv.getUint8(base + 0x2C), dv.getUint8(base + 0x2D),
				dv.getUint8(base + 0x2E), dv.getUint8(base + 0x2F),
				dv.getUint8(base + 0x30), dv.getUint8(base + 0x31),
			],
			sceneIndex: dv.getUint8(base + 0x32),
			absorbtionLevel: dv.getUint8(base + 0x33),
			nextBoundarySensor: [dv.getUint8(base + 0x34), dv.getUint8(base + 0x35)],
		});
	}

	// ---- Car model → handling body transform (0x40 at +0x610) ----
	const transformBase = sensorBase + DS_NUM_SENSOR_SLOTS * DS_SENSOR_SPEC_STRIDE;
	const carModelSpaceToHandlingBodySpace: Mat4 = readMat4(dv, transformBase);

	// ---- Counts + inertia block (+0x650..+0x6B0) ----
	const countsBase = transformBase + 0x40;
	const specID = dv.getUint8(countsBase + 0);
	const numVehicleBodies = dv.getUint8(countsBase + 1);
	const numDeformationSensors = dv.getUint8(countsBase + 2);
	const numGraphicsParts = dv.getUint8(countsBase + 3);
	// +0x654..+0x65F: 12 bytes padding

	const inertiaBase = countsBase + 0x10;
	const currentCOMOffset: Vec4 = readVec4(dv, inertiaBase + 0x00);
	const meshOffset: Vec4       = readVec4(dv, inertiaBase + 0x10);
	const rigidBodyOffset: Vec4  = readVec4(dv, inertiaBase + 0x20);
	const collisionOffset: Vec4  = readVec4(dv, inertiaBase + 0x30);
	const inertiaTensor: Vec4    = readVec4(dv, inertiaBase + 0x40);

	// ---- Tag points ----
	const tagPoints: TagPointSpec[] = [];
	for (let i = 0; i < numTagPoints; i++) {
		const base = tagPointDataOffset + i * DS_TAG_POINT_STRIDE;
		if (base + DS_TAG_POINT_STRIDE > raw.byteLength) {
			throw new Error(`TagPoint[${i}] at 0x${base.toString(16)} runs past resource`);
		}
		tagPoints.push({
			offsetFromA: readVec3(dv, base + 0x00),
			weightA: dv.getFloat32(base + 0x0C, true),
			offsetFromB: readVec3(dv, base + 0x10),
			weightB: dv.getFloat32(base + 0x1C, true),
			initialPosition: readVec3(dv, base + 0x20),
			detachThreshold: dv.getFloat32(base + 0x2C, true),
			fWeightA: dv.getFloat32(base + 0x30, true),
			fWeightB: dv.getFloat32(base + 0x34, true),
			fDetachThresholdSquared: dv.getFloat32(base + 0x38, true),
			deformationSensorA: dv.getInt16(base + 0x3C, true),
			deformationSensorB: dv.getInt16(base + 0x3E, true),
			jointIndex: dv.getInt8(base + 0x40),
			skinnedPoint: dv.getUint8(base + 0x41) !== 0,
		});
	}

	// ---- Driven points ----
	const drivenPoints: DrivenPoint[] = [];
	for (let i = 0; i < numDrivenPoints; i++) {
		const base = drivenPointDataOffset + i * DS_DRIVEN_POINT_STRIDE;
		if (base + DS_DRIVEN_POINT_STRIDE > raw.byteLength) {
			throw new Error(`DrivenPoint[${i}] at 0x${base.toString(16)} runs past resource`);
		}
		drivenPoints.push({
			initialPos: readVec3(dv, base + 0x00),
			distanceFromA: dv.getFloat32(base + 0x10, true),
			distanceFromB: dv.getFloat32(base + 0x14, true),
			tagPointIndexA: dv.getInt16(base + 0x18, true),
			tagPointIndexB: dv.getInt16(base + 0x1A, true),
		});
	}

	// ---- Transform tags (generic / camera / light, all same shape) ----
	const readTagTable = (ptr: number, count: number, label: string): TransformTag[] => {
		const out: TransformTag[] = [];
		for (let i = 0; i < count; i++) {
			const base = ptr + i * DS_TAG_STRIDE;
			if (base + DS_TAG_STRIDE > raw.byteLength) {
				throw new Error(`${label}[${i}] at 0x${base.toString(16)} runs past resource`);
			}
			out.push({
				locator: readMat4(dv, base + 0x00),
				tagPointType: dv.getInt32(base + 0x40, true),
				ikPartIndex: dv.getInt16(base + 0x44, true),
				skinPoint: dv.getUint8(base + 0x46),
			});
		}
		return out;
	};
	const genericTags = readTagTable(genericTagsOffset, numGenericTags, 'genericTag');
	const cameraTags  = readTagTable(cameraTagsOffset,  numCameraTags,  'cameraTag');
	const lightTags   = readTagTable(lightTagsOffset,   numLightTags,   'lightTag');

	// ---- IK parts ----
	const ikParts: IKPart[] = [];
	for (let i = 0; i < numIKParts; i++) {
		const base = ikPartDataOffset + i * DS_IK_PART_STRIDE;
		if (base + DS_IK_PART_STRIDE > raw.byteLength) {
			throw new Error(`IKPart[${i}] at 0x${base.toString(16)} runs past resource`);
		}
		const cornerSkin = [
			readSkinBinding(dv, base + 0x80 + 0 * 0x20),
			readSkinBinding(dv, base + 0x80 + 1 * 0x20),
			readSkinBinding(dv, base + 0x80 + 2 * 0x20),
			readSkinBinding(dv, base + 0x80 + 3 * 0x20),
			readSkinBinding(dv, base + 0x80 + 4 * 0x20),
			readSkinBinding(dv, base + 0x80 + 5 * 0x20),
			readSkinBinding(dv, base + 0x80 + 6 * 0x20),
			readSkinBinding(dv, base + 0x80 + 7 * 0x20),
		] as IKPart['cornerSkin'];
		const centerSkin = readSkinBinding(dv, base + 0x180);
		const jointSkin  = readSkinBinding(dv, base + 0x1A0);
		const paJointSpecsOffset      = u32(base + 0x1C0);
		const numJoints               = i32(base + 0x1C4);
		const partGraphics            = i32(base + 0x1C8);
		const startIndexOfDrivenPoints = i32(base + 0x1CC);
		const numberOfDrivenPoints    = i32(base + 0x1D0);
		const startIndexOfTagPoints   = i32(base + 0x1D4);
		const numberOfTagPoints       = i32(base + 0x1D8);
		const partType                = i32(base + 0x1DC);

		const jointSpecs: JointSpec[] = [];
		for (let j = 0; j < numJoints; j++) {
			const jbase = paJointSpecsOffset + j * DS_JOINT_SPEC_STRIDE;
			if (jbase + DS_JOINT_SPEC_STRIDE > raw.byteLength) {
				throw new Error(`IKPart[${i}].jointSpec[${j}] at 0x${jbase.toString(16)} runs past resource`);
			}
			jointSpecs.push({
				position: readVec4(dv, jbase + 0x00),
				axis: readVec4(dv, jbase + 0x10),
				defaultDirection: readVec4(dv, jbase + 0x20),
				maxJointAngle: dv.getFloat32(jbase + 0x30, true),
				jointDetachThreshold: dv.getFloat32(jbase + 0x34, true),
				jointType: i32(jbase + 0x38),
			});
		}

		ikParts.push({
			graphicsTransform: readMat4(dv, base + 0x00),
			orientation:       readMat4(dv, base + 0x40),
			cornerSkin,
			centerSkin,
			jointSkin,
			paJointSpecsOffset,
			partGraphics,
			startIndexOfDrivenPoints,
			numberOfDrivenPoints,
			startIndexOfTagPoints,
			numberOfTagPoints,
			partType,
			jointSpecs,
		});
	}

	// ---- Glass panes ----
	const glassPanes: GlassPane[] = [];
	for (let i = 0; i < numGlassPanes; i++) {
		const base = glassPaneDataOffset + i * DS_GLASS_PANE_STRIDE;
		if (base + DS_GLASS_PANE_STRIDE > raw.byteLength) {
			throw new Error(`GlassPane[${i}] at 0x${base.toString(16)} runs past resource`);
		}
		glassPanes.push({
			plane: readVec4(dv, base + 0x00),
			matrix: readMat4(dv, base + 0x10),
			cornerTagIndices: [
				dv.getInt16(base + 0x50, true), dv.getInt16(base + 0x52, true),
				dv.getInt16(base + 0x54, true), dv.getInt16(base + 0x56, true),
			],
			bytes58: [
				dv.getUint8(base + 0x58), dv.getUint8(base + 0x59),
				dv.getUint8(base + 0x5A), dv.getUint8(base + 0x5B),
			],
			short5C: dv.getInt16(base + 0x5C, true),
			short5E: dv.getInt16(base + 0x5E, true),
			short60: dv.getInt16(base + 0x60, true),
			partType: i32(base + 0x64),
		});
	}

	return {
		version,
		tagPointDataOffset,
		drivenPointDataOffset,
		ikPartDataOffset,
		glassPaneDataOffset,
		genericTagsOffset,
		cameraTagsOffset,
		lightTagsOffset,
		handlingBodyDimensions,
		wheels,
		sensors,
		carModelSpaceToHandlingBodySpace,
		specID,
		numVehicleBodies,
		numDeformationSensors,
		numGraphicsParts,
		currentCOMOffset,
		meshOffset,
		rigidBodyOffset,
		collisionOffset,
		inertiaTensor,
		tagPoints,
		drivenPoints,
		genericTags,
		cameraTags,
		lightTags,
		ikParts,
		glassPanes,
		totalSize: raw.byteLength,
	};
}

// =============================================================================
// Layout normalizer
// =============================================================================

/**
 * Recompute every region pointer and `paJointSpecsOffset` from the model's
 * array contents, and recompute `totalSize`. Returns a new model — does not
 * mutate the input. Inline header arrays (wheels, sensors) and inline
 * scalars are passed through unchanged.
 *
 * IK parts whose `jointSpecs` are empty keep their existing
 * `paJointSpecsOffset` (typically 0 — a defensive convention the runtime
 * relies on). IK parts with joints get a fresh pointer assigned in the
 * canonical concatenated joint-spec block.
 *
 * Canonical region order matches the on-disk fixture:
 *   header → tagPoints → drivenPoints → ikParts → jointSpecs →
 *   glassPanes → genericTags → cameraTags → lightTags
 */
export function normalizeDeformationSpecLayout(
	model: ParsedDeformationSpec,
): ParsedDeformationSpec {
	if (model.wheels.length !== DS_NUM_WHEELS) {
		throw new Error(`DeformationSpec wheels must stay at ${DS_NUM_WHEELS} entries (got ${model.wheels.length})`);
	}
	if (model.sensors.length !== DS_NUM_SENSOR_SLOTS) {
		throw new Error(`DeformationSpec sensors must stay at ${DS_NUM_SENSOR_SLOTS} entries (got ${model.sensors.length})`);
	}

	let pos = DS_HEADER_END;
	const tagPointDataOffset = pos;
	pos += model.tagPoints.length * DS_TAG_POINT_STRIDE;

	const drivenPointDataOffset = pos;
	pos += model.drivenPoints.length * DS_DRIVEN_POINT_STRIDE;

	const ikPartDataOffset = pos;
	pos += model.ikParts.length * DS_IK_PART_STRIDE;

	// Joint specs follow IK part headers, concatenated in IK-part order.
	const newIKParts: IKPart[] = model.ikParts.map((part) => {
		if (part.jointSpecs.length === 0) {
			// Preserve the on-disk convention: empty joint chains have
			// paJointSpecsOffset == 0 (any non-zero value would be a stale
			// pointer that the runtime never dereferences anyway, since
			// numJoints == 0).
			return { ...part, paJointSpecsOffset: 0 };
		}
		const paJointSpecsOffset = pos;
		pos += part.jointSpecs.length * DS_JOINT_SPEC_STRIDE;
		return { ...part, paJointSpecsOffset };
	});

	const glassPaneDataOffset = pos;
	pos += model.glassPanes.length * DS_GLASS_PANE_STRIDE;

	const genericTagsOffset = pos;
	pos += model.genericTags.length * DS_TAG_STRIDE;

	const cameraTagsOffset = pos;
	pos += model.cameraTags.length * DS_TAG_STRIDE;

	const lightTagsOffset = pos;
	pos += model.lightTags.length * DS_TAG_STRIDE;

	return {
		...model,
		tagPointDataOffset,
		drivenPointDataOffset,
		ikPartDataOffset,
		glassPaneDataOffset,
		genericTagsOffset,
		cameraTagsOffset,
		lightTagsOffset,
		ikParts: newIKParts,
		totalSize: pos,
	};
}

// =============================================================================
// Writer
// =============================================================================

export function writeDeformationSpecData(
	model: ParsedDeformationSpec,
	littleEndian: boolean = true,
): Uint8Array {
	if (!littleEndian) {
		throw new Error('DeformationSpec writer is little-endian only');
	}
	// Always normalize so add/remove edits get a fresh layout. For unchanged
	// input the canonical order matches the fixture and the output is
	// byte-exact with the original.
	const m = normalizeDeformationSpecLayout(model);

	const out = new Uint8Array(m.totalSize);
	const dv = new DataView(out.buffer, out.byteOffset, out.byteLength);
	const u32W = (off: number, v: number) => dv.setUint32(off, v >>> 0, true);
	const i32W = (off: number, v: number) => dv.setInt32(off, v | 0, true);

	// ---- Header ----
	i32W(0x00, m.version);
	u32W(0x04, m.tagPointDataOffset);
	i32W(0x08, m.tagPoints.length);
	u32W(0x0C, m.drivenPointDataOffset);
	i32W(0x10, m.drivenPoints.length);
	u32W(0x14, m.ikPartDataOffset);
	i32W(0x18, m.ikParts.length);
	u32W(0x1C, m.glassPaneDataOffset);
	i32W(0x20, m.glassPanes.length);
	u32W(0x24, m.genericTags.length);
	u32W(0x28, m.genericTagsOffset);
	u32W(0x2C, m.cameraTags.length);
	u32W(0x30, m.cameraTagsOffset);
	u32W(0x34, m.lightTags.length);
	u32W(0x38, m.lightTagsOffset);
	writeVec4(dv, 0x40, m.handlingBodyDimensions);

	// ---- Wheels ----
	for (let i = 0; i < DS_NUM_WHEELS; i++) {
		const base = 0x50 + i * DS_WHEEL_SPEC_STRIDE;
		const w = m.wheels[i];
		writeVec4(dv, base + 0x00, w.position);
		writeVec4(dv, base + 0x10, w.direction);
		i32W(base + 0x20, w.iValue);
	}

	// ---- Sensors ----
	const sensorBase = 0x50 + DS_NUM_WHEELS * DS_WHEEL_SPEC_STRIDE;
	for (let i = 0; i < DS_NUM_SENSOR_SLOTS; i++) {
		const base = sensorBase + i * DS_SENSOR_SPEC_STRIDE;
		const s = m.sensors[i];
		writeVec3(dv, base + 0x00, s.initialOffset);
		for (let k = 0; k < 6; k++) {
			dv.setFloat32(base + 0x10 + k * 4, s.directionParams[k], true);
		}
		dv.setFloat32(base + 0x28, s.radius, true);
		for (let k = 0; k < 6; k++) dv.setUint8(base + 0x2C + k, s.nextSensor[k] & 0xFF);
		dv.setUint8(base + 0x32, s.sceneIndex & 0xFF);
		dv.setUint8(base + 0x33, s.absorbtionLevel & 0xFF);
		dv.setUint8(base + 0x34, s.nextBoundarySensor[0] & 0xFF);
		dv.setUint8(base + 0x35, s.nextBoundarySensor[1] & 0xFF);
	}

	// ---- Car → handling-body transform ----
	const transformBase = sensorBase + DS_NUM_SENSOR_SLOTS * DS_SENSOR_SPEC_STRIDE;
	writeMat4(dv, transformBase, m.carModelSpaceToHandlingBodySpace);

	// ---- Counts + inertia block ----
	const countsBase = transformBase + 0x40;
	dv.setUint8(countsBase + 0, m.specID & 0xFF);
	dv.setUint8(countsBase + 1, m.numVehicleBodies & 0xFF);
	dv.setUint8(countsBase + 2, m.numDeformationSensors & 0xFF);
	dv.setUint8(countsBase + 3, m.numGraphicsParts & 0xFF);
	const inertiaBase = countsBase + 0x10;
	writeVec4(dv, inertiaBase + 0x00, m.currentCOMOffset);
	writeVec4(dv, inertiaBase + 0x10, m.meshOffset);
	writeVec4(dv, inertiaBase + 0x20, m.rigidBodyOffset);
	writeVec4(dv, inertiaBase + 0x30, m.collisionOffset);
	writeVec4(dv, inertiaBase + 0x40, m.inertiaTensor);

	// ---- Tag points ----
	for (let i = 0; i < m.tagPoints.length; i++) {
		const base = m.tagPointDataOffset + i * DS_TAG_POINT_STRIDE;
		const t = m.tagPoints[i];
		writeVec3(dv, base + 0x00, t.offsetFromA);
		dv.setFloat32(base + 0x0C, t.weightA, true);
		writeVec3(dv, base + 0x10, t.offsetFromB);
		dv.setFloat32(base + 0x1C, t.weightB, true);
		writeVec3(dv, base + 0x20, t.initialPosition);
		dv.setFloat32(base + 0x2C, t.detachThreshold, true);
		dv.setFloat32(base + 0x30, t.fWeightA, true);
		dv.setFloat32(base + 0x34, t.fWeightB, true);
		dv.setFloat32(base + 0x38, t.fDetachThresholdSquared, true);
		dv.setInt16(base + 0x3C, t.deformationSensorA, true);
		dv.setInt16(base + 0x3E, t.deformationSensorB, true);
		dv.setInt8(base + 0x40, t.jointIndex);
		dv.setUint8(base + 0x41, t.skinnedPoint ? 1 : 0);
	}

	// ---- Driven points ----
	for (let i = 0; i < m.drivenPoints.length; i++) {
		const base = m.drivenPointDataOffset + i * DS_DRIVEN_POINT_STRIDE;
		const d = m.drivenPoints[i];
		writeVec3(dv, base + 0x00, d.initialPos);
		dv.setFloat32(base + 0x10, d.distanceFromA, true);
		dv.setFloat32(base + 0x14, d.distanceFromB, true);
		dv.setInt16(base + 0x18, d.tagPointIndexA, true);
		dv.setInt16(base + 0x1A, d.tagPointIndexB, true);
	}

	// ---- IK parts (+ joint specs) ----
	for (let i = 0; i < m.ikParts.length; i++) {
		const base = m.ikPartDataOffset + i * DS_IK_PART_STRIDE;
		const part = m.ikParts[i];
		writeMat4(dv, base + 0x00, part.graphicsTransform);
		writeMat4(dv, base + 0x40, part.orientation);
		for (let c = 0; c < 8; c++) writeSkinBinding(dv, base + 0x80 + c * 0x20, part.cornerSkin[c]);
		writeSkinBinding(dv, base + 0x180, part.centerSkin);
		writeSkinBinding(dv, base + 0x1A0, part.jointSkin);
		u32W(base + 0x1C0, part.paJointSpecsOffset);
		i32W(base + 0x1C4, part.jointSpecs.length);
		i32W(base + 0x1C8, part.partGraphics);
		i32W(base + 0x1CC, part.startIndexOfDrivenPoints);
		i32W(base + 0x1D0, part.numberOfDrivenPoints);
		i32W(base + 0x1D4, part.startIndexOfTagPoints);
		i32W(base + 0x1D8, part.numberOfTagPoints);
		i32W(base + 0x1DC, part.partType);

		for (let j = 0; j < part.jointSpecs.length; j++) {
			const jbase = part.paJointSpecsOffset + j * DS_JOINT_SPEC_STRIDE;
			const jspec = part.jointSpecs[j];
			writeVec4(dv, jbase + 0x00, jspec.position);
			writeVec4(dv, jbase + 0x10, jspec.axis);
			writeVec4(dv, jbase + 0x20, jspec.defaultDirection);
			dv.setFloat32(jbase + 0x30, jspec.maxJointAngle, true);
			dv.setFloat32(jbase + 0x34, jspec.jointDetachThreshold, true);
			i32W(jbase + 0x38, jspec.jointType);
		}
	}

	// ---- Glass panes ----
	for (let i = 0; i < m.glassPanes.length; i++) {
		const base = m.glassPaneDataOffset + i * DS_GLASS_PANE_STRIDE;
		const g = m.glassPanes[i];
		writeVec4(dv, base + 0x00, g.plane);
		writeMat4(dv, base + 0x10, g.matrix);
		for (let k = 0; k < 4; k++) dv.setInt16(base + 0x50 + k * 2, g.cornerTagIndices[k], true);
		for (let k = 0; k < 4; k++) dv.setUint8(base + 0x58 + k, g.bytes58[k] & 0xFF);
		dv.setInt16(base + 0x5C, g.short5C, true);
		dv.setInt16(base + 0x5E, g.short5E, true);
		dv.setInt16(base + 0x60, g.short60, true);
		i32W(base + 0x64, g.partType);
	}

	// ---- Transform tags ----
	const writeTagArr = (ptr: number, arr: TransformTag[]) => {
		for (let i = 0; i < arr.length; i++) {
			const base = ptr + i * DS_TAG_STRIDE;
			const t = arr[i];
			writeMat4(dv, base + 0x00, t.locator);
			i32W(base + 0x40, t.tagPointType);
			dv.setInt16(base + 0x44, t.ikPartIndex, true);
			dv.setUint8(base + 0x46, t.skinPoint & 0xFF);
		}
	};
	writeTagArr(m.genericTagsOffset, m.genericTags);
	writeTagArr(m.cameraTagsOffset, m.cameraTags);
	writeTagArr(m.lightTagsOffset, m.lightTags);

	return out;
}
