// Hand-written schema for ParsedPropPhysics (resource type 0x1000F).
//
// Mirrors the types in `src/lib/core/propPhysics.ts`. Keep these in lockstep
// with the parser/writer — any field added to the parser needs a matching
// entry here, or the schema walker reports it as drift.
//
// Domain: the global prop-physics catalogue (one resource in the whole game,
// PROPS/PROPPHYSICS.BUNDLE). PropTypeData[i] is the physics of PROP_TYPES[i]
// — the same index PropInstanceData placements store — so the tree labels
// each entry with its prop name. Per entry: mass/inertia, the speed
// thresholds that decide whether a hit prop leans, moves, or smashes (MPH),
// joint behaviour, rw::collision volumes, and breakable parts with their own
// mass and volumes.
//
// Entry add/remove is disabled: the catalogue index space is shared with
// every PropInstanceData placement in the game, so inserting or removing an
// entry would silently retarget every placed prop after it. Volumes/parts
// within an entry are freely editable — the writer re-derives the whole
// layout (pointers, tables, counts, size).

import type {
	FieldSchema,
	RecordSchema,
	ResourceSchema,
	SchemaRegistry,
} from '../types';
import { PROP_JOINT_TYPES, VOLUME_TYPE_LABELS } from '@/lib/core/propPhysics';
import { propTypeLabel } from '@/lib/core/propTypes';

// ---------------------------------------------------------------------------
// Local helpers (mirroring propInstanceData.ts)
// ---------------------------------------------------------------------------

const u8 = (): FieldSchema => ({ kind: 'u8' });
const u32 = (): FieldSchema => ({ kind: 'u32' });
const f32 = (): FieldSchema => ({ kind: 'f32' });
const vec3 = (): FieldSchema => ({ kind: 'vec3' });
const matrix44 = (): FieldSchema => ({ kind: 'matrix44' });
const record = (type: string): FieldSchema => ({ kind: 'record', type });
const bigintId = (): FieldSchema => ({ kind: 'bigint', bytes: 8, hex: true });

const fixedList = (item: FieldSchema, length: number): FieldSchema => ({
	kind: 'list',
	item,
	minLength: length,
	maxLength: length,
	addable: false,
	removable: false,
});

const recordList = (
	type: string,
	opts: { addable: boolean },
	itemLabel?: (item: unknown, index: number) => string,
): FieldSchema => ({
	kind: 'list',
	item: record(type),
	addable: opts.addable,
	removable: opts.addable,
	itemLabel: itemLabel ? (item, index) => itemLabel(item, index) : undefined,
});

// ---------------------------------------------------------------------------
// Enum tables
// ---------------------------------------------------------------------------

const VOLUME_TYPE_VALUES = Object.entries(VOLUME_TYPE_LABELS).map(([value, label]) => ({
	value: Number(value),
	label,
}));

const JOINT_TYPE_VALUES = PROP_JOINT_TYPES.map((j) => ({ value: j.value, label: j.label }));

const EXTRA_TYPE_VALUES = [
	{ value: 0, label: 'None' },
	{ value: 1, label: 'Is overhead sign' },
];

const VOLUME_FLAG_BITS = [
	{ mask: 0x1, label: 'Enabled (VOLUMEFLAG_ISENABLED)' },
];

// ---------------------------------------------------------------------------
// Tree-label helpers
// ---------------------------------------------------------------------------

function propTypeEntryLabel(t: unknown, index: number): string {
	try {
		if (!t || typeof t !== 'object') return `#${index}`;
		const e = t as { mfMass?: number; parts?: unknown[]; volumes?: unknown[] };
		const bits = [`#${index} · ${propTypeLabel(index)}`];
		if (e.mfMass != null) bits.push(`${e.mfMass} kg`);
		if (e.parts?.length) bits.push(`${e.parts.length} part${e.parts.length === 1 ? '' : 's'}`);
		return bits.join(' · ');
	} catch {
		return `#${index}`;
	}
}

function volumeLabel(v: unknown, index: number): string {
	try {
		if (!v || typeof v !== 'object') return `#${index}`;
		const e = v as { vType?: number; mUnion?: number[]; mfRadius?: number };
		const kind = VOLUME_TYPE_LABELS[e.vType ?? -1] ?? `type ${e.vType}`;
		if (e.vType === 4 && e.mUnion) {
			return `#${index} · Box ${e.mUnion.map((h) => (h * 2).toFixed(1)).join('×')} m`;
		}
		if (e.vType === 2 && e.mUnion) {
			return `#${index} · Capsule h=${(e.mUnion[0] * 2).toFixed(1)} r=${(e.mfRadius ?? 0).toFixed(2)} m`;
		}
		return `#${index} · ${kind} r=${(e.mfRadius ?? 0).toFixed(2)} m`;
	} catch {
		return `#${index}`;
	}
}

function partLabel(p: unknown, index: number): string {
	try {
		if (!p || typeof p !== 'object') return `#${index}`;
		const e = p as { mfMass?: number; volumes?: unknown[] };
		return `#${index} · ${e.mfMass ?? '?'} kg · ${e.volumes?.length ?? 0} vol${e.volumes?.length === 1 ? '' : 's'}`;
	} catch {
		return `#${index}`;
	}
}

// ---------------------------------------------------------------------------
// Record schemas
// ---------------------------------------------------------------------------

const PropPhysicsVolume: RecordSchema = {
	name: 'PropPhysicsVolume',
	description: 'One rw::collision volume. The 12-byte type-specific union is exposed as three lanes whose meaning follows the volume type: Box — half extents X/Y/Z; Capsule — half height, rest unused; Sphere — all unused (size lives in Radius).',
	fields: {
		mTransform: matrix44(),
		vType: { kind: 'enum', storage: 'u32', values: VOLUME_TYPE_VALUES },
		mUnion: fixedList(f32(), 3),
		mfRadius: f32(),
		muGroupID: u32(),
		muSurfaceID: u32(),
		muFlags: { kind: 'flags', storage: 'u32', bits: VOLUME_FLAG_BITS },
	},
	fieldMetadata: {
		mTransform: {
			label: 'Local transform',
			description: 'Matrix44Affine placing the volume relative to the prop model (translation in elements 12/13/14).',
		},
		vType: {
			label: 'Volume type',
			description: 'rw::collision::VolumeType. Retail PropPhysics uses Box (442), Capsule (37), and one Sphere — despite the wiki claiming box-only.',
		},
		mUnion: {
			label: 'Type-specific lanes',
			description: 'Box: half extents X/Y/Z (m). Capsule: [0] = half height, [1..2] unused. Sphere: unused.',
		},
		mfRadius: {
			label: 'Radius',
			description: 'Sphere radius / capsule cap radius / box edge fattening (m).',
		},
		muGroupID: { label: 'Group ID', description: 'Collision group tag (0 in retail PropPhysics).' },
		muSurfaceID: { label: 'Surface ID', description: 'Material tag (0 in retail PropPhysics).' },
		muFlags: { label: 'Flags', description: 'rw::collision::VolumeFlag bits; retail only sets Enabled.' },
	},
	propertyGroups: [
		{ title: 'Shape', properties: ['vType', 'mUnion', 'mfRadius'] },
		{ title: 'Placement', properties: ['mTransform'] },
		{ title: 'Tags', properties: ['muGroupID', 'muSurfaceID', 'muFlags'] },
	],
	label: (value, index) => volumeLabel(value, index ?? 0),
};

const PropPartType: RecordSchema = {
	name: 'PropPartType',
	description: 'A breakable piece of the prop (sign face, gate arm, …) with its own mass, inertia, and collision volumes. Only props with parts can be smashed.',
	fields: {
		mOffset: vec3(),
		mInertia: vec3(),
		mfMass: f32(),
		mfSphereRadius: f32(),
		volumes: recordList('PropPhysicsVolume', { addable: true }, volumeLabel),
		_rawVolsPtr: u32(),
		_pad2D: fixedList(u8(), 3),
	},
	fieldMetadata: {
		mOffset: { label: 'Offset', description: 'Positional offset relative to the prop model.' },
		mInertia: { label: 'Inertia', description: 'Rotational inertia (likely kg·m²).' },
		mfMass: { label: 'Mass', description: 'Mass in kg.' },
		mfSphereRadius: { label: 'Sphere radius', description: 'Broad-phase culling sphere radius (m). Wiki: still under investigation.' },
		volumes: { label: 'Collision volumes', description: 'The part\'s own collision volumes.' },
		_rawVolsPtr: {
			label: 'raw volume ptr',
			description: 'Stored maCollisionVolumes pointer — uninitialised garbage when the part has no volumes; preserved verbatim for byte-exact round-trip.',
			hidden: true,
		},
		_pad2D: { label: 'pad', description: 'Record pad bytes, preserved verbatim.', hidden: true },
	},
	propertyGroups: [
		{ title: 'Physics', properties: ['mfMass', 'mInertia', 'mfSphereRadius'] },
		{ title: 'Placement', properties: ['mOffset'] },
		{ title: 'Collision', properties: ['volumes'] },
	],
	label: (value, index) => partLabel(value, index ?? 0),
};

const PropPhysicsType: RecordSchema = {
	name: 'PropPhysicsType',
	description: 'Collision physics for one prop type. The entry index is the same id PropInstanceData placements store (PROP_TYPES), which is why entries can\'t be inserted or removed — only edited.',
	fields: {
		mResourceId: bigintId(),
		muSceneUriId: u32(),
		mfMass: f32(),
		mInertia: vec3(),
		mCOMOffset: vec3(),
		mJointLocator: vec3(),
		mfSphereRadius: f32(),
		mfLeanThreshold: f32(),
		mfMoveThreshold: f32(),
		mfSmashThreshold: f32(),
		mu8JointType: { kind: 'enum', storage: 'u8', values: JOINT_TYPE_VALUES },
		mfMaxJointAngleCos: f32(),
		mu8ExtraTypeInfo: { kind: 'enum', storage: 'u8', values: EXTRA_TYPE_VALUES },
		muMaxState: u8(),
		volumes: recordList('PropPhysicsVolume', { addable: true }, volumeLabel),
		parts: recordList('PropPartType', { addable: true }, partLabel),
		_rawVolsPtr: u32(),
		_rawPartsPtr: u32(),
		_padTail: fixedList(u8(), 15),
	},
	fieldMetadata: {
		mResourceId: {
			label: 'Model resource ID',
			description: 'The prop\'s Model resource — matches PROP_TYPES[index].resourceId. Changing it retargets which model this physics entry describes.',
			readOnly: true,
		},
		muSceneUriId: { label: 'GameDB ID', description: 'Model GameDB id — matches PROP_TYPES[index].gameDbId.', readOnly: true },
		mfMass: { label: 'Mass', description: 'Mass in kg.' },
		mInertia: { label: 'Inertia', description: 'Rotational inertia (likely kg·m²).' },
		mCOMOffset: { label: 'Centre of mass', description: 'Centre-of-mass offset relative to the prop model.' },
		mJointLocator: { label: 'Joint locator', description: 'Where the joint sits relative to the prop model (the pivot for lean/tilt).' },
		mfSphereRadius: { label: 'Sphere radius', description: 'Broad-phase culling sphere radius (m). Wiki: still under investigation.' },
		mfLeanThreshold: { label: 'Lean threshold', description: 'Speed required to make the prop lean (MPH).' },
		mfMoveThreshold: { label: 'Move threshold', description: 'Speed required to move the prop (MPH).' },
		mfSmashThreshold: { label: 'Smash threshold', description: 'Speed required to smash the prop (MPH). Only props with parts can smash.' },
		mu8JointType: { label: 'Joint type', description: 'How the prop reacts around its joint: none, lean, or tilt.' },
		mfMaxJointAngleCos: { label: 'Max joint angle (cos)', description: 'Cosine of the maximum joint angle.' },
		mu8ExtraTypeInfo: { label: 'Extra info', description: '1 = overhead sign.' },
		muMaxState: { label: 'Max state', description: 'Always 0 in retail; seemingly unused.', readOnly: true },
		volumes: { label: 'Collision volumes', description: 'The prop body\'s collision volumes.' },
		parts: { label: 'Parts', description: 'Breakable parts, each with its own physics and volumes.' },
		_rawVolsPtr: {
			label: 'raw volume ptr',
			description: 'Stored maCollisionVolumes pointer — garbage when there are no volumes; preserved verbatim.',
			hidden: true,
		},
		_rawPartsPtr: {
			label: 'raw parts ptr',
			description: 'Stored maParts pointer — garbage when there are no parts; preserved verbatim.',
			hidden: true,
		},
		_padTail: { label: 'pad', description: 'Record tail pad bytes, preserved verbatim.', hidden: true },
	},
	propertyGroups: [
		{ title: 'Identity', properties: ['mResourceId', 'muSceneUriId'] },
		{ title: 'Physics', properties: ['mfMass', 'mInertia', 'mCOMOffset', 'mfSphereRadius'] },
		{ title: 'Thresholds', properties: ['mfLeanThreshold', 'mfMoveThreshold', 'mfSmashThreshold'] },
		{ title: 'Joint', properties: ['mu8JointType', 'mJointLocator', 'mfMaxJointAngleCos', 'mu8ExtraTypeInfo', 'muMaxState'] },
		{ title: 'Collision', properties: ['volumes', 'parts'] },
	],
	label: (value, index) => propTypeEntryLabel(value, index ?? 0),
};

// ---------------------------------------------------------------------------
// Root + registry export
// ---------------------------------------------------------------------------

const ParsedPropPhysics: RecordSchema = {
	name: 'ParsedPropPhysics',
	description: 'Root record for the PropPhysics resource (0x1000F) — the game-wide prop collision-physics catalogue. Entries are indexed by the same prop-type id PropInstanceData placements use, so the list is fixed-length: edit entries, never insert or remove them.',
	fields: {
		propTypes: {
			kind: 'list',
			item: record('PropPhysicsType'),
			addable: false,
			removable: false,
			itemLabel: (item, index) => propTypeEntryLabel(item, index),
		},
		muTimeStamp: u32(),
	},
	fieldMetadata: {
		propTypes: {
			label: 'Prop types',
			description: 'One physics entry per prop type, indexed like PROP_TYPES. 247 entries in retail.',
		},
		muTimeStamp: {
			label: 'Build timestamp',
			description: 'time_t the catalogue was built; null (0) in Remastered.',
			readOnly: true,
		},
	},
	propertyGroups: [
		{ title: 'Catalogue', properties: ['propTypes'] },
		{ title: 'Build', properties: ['muTimeStamp'] },
	],
};

const registry: SchemaRegistry = {
	ParsedPropPhysics,
	PropPhysicsType,
	PropPartType,
	PropPhysicsVolume,
};

export const propPhysicsResourceSchema: ResourceSchema = {
	key: 'propPhysics',
	name: 'Prop Physics',
	rootType: 'ParsedPropPhysics',
	registry,
};
