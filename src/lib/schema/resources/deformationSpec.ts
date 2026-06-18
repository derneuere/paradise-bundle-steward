// Schema for DeformationSpec (resource type 0x1001C) — vehicle crash data.
//
// The parsed model (`ParsedDeformationSpec`) stores vectors as plain float
// arrays (`Vec3 = [x,y,z]`, `Vec4`, `Mat4 = Vec4[]`), not the `{x,y,z}`
// objects the structured `vec*`/`matrix44` leaf editors expect. So those
// fields are described as fixed-length primitive `list`s instead: a
// `list<f32>` renders an array verbatim through PrimListField, and a
// `list<list<f32>>` renders the nested Mat4 as a 4×4 of inputs — both edit
// the model in place with no representation change, keeping the writer's
// byte-exact round-trip intact.
//
// Every list is field-only (no add/remove): the writer derives the on-disk
// counts and re-lays-out the resource from each array's length, so the editor
// edits existing entries without changing array lengths (mirrors the original
// per-resource page).

import type {
	FieldSchema,
	ListFieldSchema,
	RecordSchema,
	ResourceSchema,
	SchemaRegistry,
} from '../types';

// ---------------------------------------------------------------------------
// Fixed-length primitive tuple helpers (the model's Vec3/Vec4/Mat4 are arrays)
// ---------------------------------------------------------------------------

const fixedList = (item: FieldSchema, len: number, cols: number): ListFieldSchema => ({
	kind: 'list',
	item,
	minLength: len,
	maxLength: len,
	addable: false,
	removable: false,
	displayAs: 'grid',
	gridCols: cols,
});

const f32: FieldSchema = { kind: 'f32' };
const vec3 = (): ListFieldSchema => fixedList(f32, 3, 3);
const vec4 = (): ListFieldSchema => fixedList(f32, 4, 4);
// Mat4 = Vec4[4] (nested arrays, row-major). Outer list (one row per item)
// of inner Vec4 grids — renders as a readable 4×4 of inputs.
const mat4 = (): ListFieldSchema => ({
	kind: 'list',
	item: vec4(),
	minLength: 4,
	maxLength: 4,
	addable: false,
	removable: false,
});
const intTuple = (kind: FieldSchema, len: number): ListFieldSchema =>
	fixedList(kind, len, len);

const recordList = (type: string, itemLabel?: ListFieldSchema['itemLabel'], fixedLen?: number): ListFieldSchema => ({
	kind: 'list',
	item: { kind: 'record', type },
	addable: false,
	removable: false,
	...(fixedLen != null ? { minLength: fixedLen, maxLength: fixedLen } : {}),
	itemLabel,
});

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

const WHEEL_LABELS = ['FR', 'FL', 'RR', 'RL'];

const registry: SchemaRegistry = {
	WheelSpec: {
		name: 'WheelSpec',
		fields: {
			position: vec4(),
			direction: vec4(),
			iValue: { kind: 'i32' },
		},
		label: (_v, i) => `Wheel ${i ?? 0} · ${WHEEL_LABELS[i ?? 0] ?? '?'}`,
	},

	DeformationSensorSpec: {
		name: 'DeformationSensorSpec',
		fields: {
			initialOffset: vec3(),
			directionParams: fixedList(f32, 6, 6),
			radius: f32,
			nextSensor: intTuple({ kind: 'u8' }, 6),
			sceneIndex: { kind: 'u8' },
			absorbtionLevel: { kind: 'u8' },
			nextBoundarySensor: intTuple({ kind: 'u8' }, 2),
		},
		label: (v, i) => `Sensor ${i ?? 0} · r=${Number((v as { radius: number }).radius ?? 0).toFixed(2)}`,
	},

	TagPointSpec: {
		name: 'TagPointSpec',
		fields: {
			offsetFromA: vec3(),
			weightA: f32,
			offsetFromB: vec3(),
			weightB: f32,
			initialPosition: vec3(),
			detachThreshold: f32,
			fWeightA: f32,
			fWeightB: f32,
			fDetachThresholdSquared: f32,
			deformationSensorA: { kind: 'i16' },
			deformationSensorB: { kind: 'i16' },
			jointIndex: { kind: 'i8' },
			skinnedPoint: { kind: 'bool' },
		},
		label: (_v, i) => `TagPoint ${i ?? 0}`,
	},

	DrivenPoint: {
		name: 'DrivenPoint',
		fields: {
			initialPos: vec3(),
			distanceFromA: f32,
			distanceFromB: f32,
			tagPointIndexA: { kind: 'i16' },
			tagPointIndexB: { kind: 'i16' },
		},
		label: (_v, i) => `DrivenPoint ${i ?? 0}`,
	},

	TransformTag: {
		name: 'TransformTag',
		fields: {
			locator: mat4(),
			tagPointType: { kind: 'i32' },
			ikPartIndex: { kind: 'i16' },
			skinPoint: { kind: 'u8' },
		},
		label: (v, i) => `Tag ${i ?? 0} · type=${(v as { tagPointType: number }).tagPointType ?? 0}`,
	},

	SkinBinding: {
		name: 'SkinBinding',
		fields: {
			vertex: vec4(),
			weights: vec3(),
			boneIndices: intTuple({ kind: 'u8' }, 3),
		},
		label: (_v, i) => `Skin ${i ?? 0}`,
	},

	JointSpec: {
		name: 'JointSpec',
		fields: {
			position: vec4(),
			axis: vec4(),
			defaultDirection: vec4(),
			maxJointAngle: f32,
			jointDetachThreshold: f32,
			jointType: { kind: 'i32' },
		},
		label: (_v, i) => `Joint ${i ?? 0}`,
	},

	IKPart: {
		name: 'IKPart',
		fields: {
			graphicsTransform: mat4(),
			orientation: mat4(),
			cornerSkin: recordList('SkinBinding', undefined, 8),
			centerSkin: { kind: 'record', type: 'SkinBinding' },
			jointSkin: { kind: 'record', type: 'SkinBinding' },
			paJointSpecsOffset: { kind: 'i32' },
			partGraphics: { kind: 'i32' },
			startIndexOfDrivenPoints: { kind: 'i32' },
			numberOfDrivenPoints: { kind: 'i32' },
			startIndexOfTagPoints: { kind: 'i32' },
			numberOfTagPoints: { kind: 'i32' },
			partType: { kind: 'i32' },
			jointSpecs: recordList('JointSpec'),
		},
		fieldMetadata: {
			// Absolute pointer recomputed by the writer's normalizer — preserved
			// for round-trip but not user-editable.
			paJointSpecsOffset: { hidden: true },
		},
		label: (v, i) => `IKPart ${i ?? 0} · type=${(v as { partType: number }).partType ?? 0}`,
	},

	GlassPane: {
		name: 'GlassPane',
		fields: {
			plane: vec4(),
			matrix: mat4(),
			cornerTagIndices: intTuple({ kind: 'i16' }, 4),
			bytes58: intTuple({ kind: 'u8' }, 4),
			short5C: { kind: 'i16' },
			short5E: { kind: 'i16' },
			short60: { kind: 'i16' },
			partType: { kind: 'i32' },
		},
		label: (_v, i) => `GlassPane ${i ?? 0}`,
	},

	DeformationSpec: {
		name: 'DeformationSpec',
		fields: {
			version: { kind: 'u32' },

			// Region pointers — re-derived by the writer's layout normalizer.
			tagPointDataOffset: { kind: 'u32' },
			drivenPointDataOffset: { kind: 'u32' },
			ikPartDataOffset: { kind: 'u32' },
			glassPaneDataOffset: { kind: 'u32' },
			genericTagsOffset: { kind: 'u32' },
			cameraTagsOffset: { kind: 'u32' },
			lightTagsOffset: { kind: 'u32' },

			handlingBodyDimensions: vec4(),

			wheels: recordList('WheelSpec', undefined, 4),
			sensors: recordList('DeformationSensorSpec', undefined, 20),

			carModelSpaceToHandlingBodySpace: mat4(),

			specID: { kind: 'u8' },
			numVehicleBodies: { kind: 'u8' },
			numDeformationSensors: { kind: 'u8' },
			numGraphicsParts: { kind: 'u8' },

			currentCOMOffset: vec4(),
			meshOffset: vec4(),
			rigidBodyOffset: vec4(),
			collisionOffset: vec4(),
			inertiaTensor: vec4(),

			tagPoints: recordList('TagPointSpec'),
			drivenPoints: recordList('DrivenPoint'),
			genericTags: recordList('TransformTag'),
			cameraTags: recordList('TransformTag'),
			lightTags: recordList('TransformTag'),
			ikParts: recordList('IKPart'),
			glassPanes: recordList('GlassPane'),

			totalSize: { kind: 'u32' },
		},
		fieldMetadata: {
			// Offsets + total size are recomputed by the writer at save time —
			// edits to them are ignored, so hide the pointers and lock the size.
			tagPointDataOffset: { hidden: true },
			drivenPointDataOffset: { hidden: true },
			ikPartDataOffset: { hidden: true },
			glassPaneDataOffset: { hidden: true },
			genericTagsOffset: { hidden: true },
			cameraTagsOffset: { hidden: true },
			lightTagsOffset: { hidden: true },
			totalSize: { readOnly: true, label: 'totalSize (bytes, recomputed)' },
		},
		propertyGroups: [
			{
				title: 'Header',
				properties: [
					'version', 'specID', 'numVehicleBodies', 'numDeformationSensors',
					'numGraphicsParts', 'totalSize',
				],
			},
			{
				title: 'Handling body',
				properties: [
					'handlingBodyDimensions', 'currentCOMOffset', 'meshOffset',
					'rigidBodyOffset', 'collisionOffset', 'inertiaTensor',
					'carModelSpaceToHandlingBodySpace',
				],
			},
			{ title: 'Wheels', properties: ['wheels'] },
			{ title: 'Sensors', properties: ['sensors'] },
			{ title: 'Tag / driven points', properties: ['tagPoints', 'drivenPoints'] },
			{ title: 'IK parts', properties: ['ikParts'] },
			{ title: 'Glass panes', properties: ['glassPanes'] },
			{ title: 'Transform tags', properties: ['genericTags', 'cameraTags', 'lightTags'] },
		],
	} satisfies RecordSchema,
};

export const deformationSpecResourceSchema: ResourceSchema = {
	key: 'deformationSpec',
	name: 'Deformation Spec',
	rootType: 'DeformationSpec',
	registry,
};
