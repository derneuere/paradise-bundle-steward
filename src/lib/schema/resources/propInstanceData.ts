// Hand-written schema for ParsedPropInstanceData (resource type 0x10011).
//
// Mirrors the types in `src/lib/core/propInstanceData.ts`. Keep these in
// lockstep with the parser/writer — any field added to the parser needs a
// matching entry here, or the schema walker reports it as drift.
//
// Domain: a PropZoneData places "props" (signs, lampposts, cones, spinning
// billboards, collectibles, …) into a track unit. The resource is a flat array
// of prop instances partitioned into spatial cells (a coarse XZ grid) so the
// runtime streams/spawns props near the player. Each instance references a prop
// TYPE — an index into the 247-entry PROP_TYPES table (propTypes.ts) — and
// carries a full world transform.
//
// Ordering is load-bearing: within a cell the instances are grouped by respawn
// behaviour (muNumberOfRespawnDifferent first, then muNumberOfDontRespawn, then
// the rest). Collectibles and other respawn-sensitive props only work in that
// order, so the inspector must not reorder instances within a cell.

import type {
	FieldSchema,
	RecordSchema,
	ResourceSchema,
	SchemaContext,
	SchemaRegistry,
} from '../types';
import { PROP_INSTANCE_FLAGS } from '@/lib/core/propInstanceData';
import { PROP_ALT_TYPE_NONE, PROP_TYPES, propTypeLabel } from '@/lib/core/propTypes';

// ---------------------------------------------------------------------------
// Local helpers (mirroring zoneList.ts)
// ---------------------------------------------------------------------------

const u8 = (): FieldSchema => ({ kind: 'u8' });
const i8 = (): FieldSchema => ({ kind: 'i8' });
const u16 = (): FieldSchema => ({ kind: 'u16' });
const u32 = (): FieldSchema => ({ kind: 'u32' });
const matrix44 = (): FieldSchema => ({ kind: 'matrix44' });
const record = (type: string): FieldSchema => ({ kind: 'record', type });
// Raw byte buffer used for round-trip-only preservation fields. The default
// form renderer hides custom fields without a registered component, which is
// fine — users shouldn't edit these directly.
const rawBytes = (): FieldSchema => ({ kind: 'custom', component: 'rawBytes' });

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
	itemLabel?: (item: unknown, index: number, ctx: SchemaContext) => string,
): FieldSchema => ({
	kind: 'list',
	item: record(type),
	addable: true,
	removable: true,
	itemLabel,
});

// ---------------------------------------------------------------------------
// Enum / flag tables (data-derived from PROP_TYPES — 247 entries)
// ---------------------------------------------------------------------------

// typeId enum: index → human prop name. The on-disk value is the lower 26 bits
// of muTypeIdAndFlags; the parser already split off the 6-bit flags field.
const PROP_TYPE_VALUES = PROP_TYPES.map((p) => ({ value: p.index, label: p.name }));

// muAlternativeType enum: the same prop indices plus the 0xFFFF "(none)"
// sentinel that means "no alternative prop".
const ALT_TYPE_VALUES = [
	{ value: PROP_ALT_TYPE_NONE, label: '(none)' },
	...PROP_TYPE_VALUES,
];

const PROP_INSTANCE_FLAG_BITS = [
	{ mask: PROP_INSTANCE_FLAGS.DISABLE_PHYSICS, label: 'Disable physics' },
];

// ---------------------------------------------------------------------------
// Tree-label helpers
// ---------------------------------------------------------------------------

function instanceLabel(inst: unknown, index: number): string {
	try {
		if (!inst || typeof inst !== 'object') return `#${index}`;
		const i = inst as { typeId?: number; muInstanceID?: number; mWorldTransform?: number[] };
		const name = i.typeId != null ? propTypeLabel(i.typeId) : '?';
		const id = i.muInstanceID != null ? i.muInstanceID : '?';
		const t = i.mWorldTransform;
		const x = t && t[12] != null ? t[12].toFixed(0) : '?';
		const z = t && t[14] != null ? t[14].toFixed(0) : '?';
		return `#${index} · ${name} · id ${id} · (${x}, ${z})`;
	} catch {
		return `#${index}`;
	}
}

function cellLabel(cell: unknown, index: number): string {
	try {
		if (!cell || typeof cell !== 'object') return `#${index}`;
		const c = cell as {
			muX?: number;
			muZ?: number;
			muStartIndex?: number;
			muCount?: number;
			muNumberOfRespawnDifferent?: number;
			muNumberOfDontRespawn?: number;
		};
		const start = c.muStartIndex ?? 0;
		const end = start + (c.muCount ?? 0);
		const r = c.muNumberOfRespawnDifferent ?? 0;
		const d = c.muNumberOfDontRespawn ?? 0;
		return `(X=${c.muX ?? '?'}, Z=${c.muZ ?? '?'}) · #${start}..#${end} · R${r}/D${d}`;
	} catch {
		return `#${index}`;
	}
}

// ---------------------------------------------------------------------------
// Record schemas
// ---------------------------------------------------------------------------

const PropInstance: RecordSchema = {
	name: 'PropInstance',
	description: 'One placed prop — a world transform plus a reference to a prop type (index into the 247-entry prop-types table). Within a cell, instance order encodes respawn grouping and must be preserved.',
	fields: {
		mWorldTransform: matrix44(),
		typeId: { kind: 'enum', storage: 'u32', values: PROP_TYPE_VALUES },
		flags: { kind: 'flags', storage: 'u32', bits: PROP_INSTANCE_FLAG_BITS },
		muInstanceID: u32(),
		muAlternativeType: { kind: 'enum', storage: 'u16', values: ALT_TYPE_VALUES },
		mn8RotSpeed: i8(),
		mn8MaxAngle: u8(),
		mn8MinAngle: u8(),
		_pad4D: fixedList(u8(), 3),
	},
	fieldMetadata: {
		mWorldTransform: {
			label: 'World transform',
			description: 'Matrix44Affine (16 f32, row-major). Translation = the last row — indices 12/13/14 carry world X/Y/Z, so this is where the prop sits on the map.',
		},
		typeId: {
			label: 'Prop type',
			description: 'Which prop this instance is — an index into the prop-types table (the asset bundle / model that gets spawned). Stored as the lower 26 bits of muTypeIdAndFlags.',
		},
		flags: {
			label: 'Flags',
			description: 'The upper 6 bits of muTypeIdAndFlags. DISABLE_PHYSICS makes the prop static (no knock-down / collision response).',
		},
		muInstanceID: {
			label: 'Instance ID',
			description: 'Per-instance id (u32), unique within the track unit. Used to reference a specific placed prop at runtime.',
		},
		muAlternativeType: {
			label: 'Alternative type',
			description: 'A second prop type the runtime may substitute (e.g. a damaged / destroyed variant). 0xFFFF = (none).',
		},
		mn8RotSpeed: {
			label: 'Rotation speed',
			description: 'Signed rotation speed for spinning props (billboards, fans, windmills). -64 is common; 0 for static props.',
		},
		mn8MaxAngle: { label: 'Max angle' },
		mn8MinAngle: { label: 'Min angle' },
		_pad4D: {
			label: 'pad +0x4D',
			description: '3 bytes of trailing pad on the on-disk instance record. Zero in every fixture; preserved verbatim for byte-exact round-trip.',
			hidden: true,
		},
	},
	propertyGroups: [
		{ title: 'Transform', properties: ['mWorldTransform'] },
		{ title: 'Identity', properties: ['typeId', 'muInstanceID', 'muAlternativeType'] },
		{ title: 'Behaviour', properties: ['flags', 'mn8RotSpeed', 'mn8MaxAngle', 'mn8MinAngle'] },
	],
	label: (value, index) => instanceLabel(value, index ?? 0),
};

const PropCell: RecordSchema = {
	name: 'PropCell',
	description: 'A coarse XZ grid cell owning a contiguous run of instances. Cells partition the instance array; muStartIndex/muCount are derived from that partition and recomputed on write.',
	fields: {
		muX: u16(),
		muZ: u16(),
		muNumberOfRespawnDifferent: u16(),
		muNumberOfDontRespawn: u16(),
		muStartIndex: u16(),
		muCount: u16(),
	},
	fieldMetadata: {
		muX: { label: 'Grid X', description: 'Cell column on the coarse XZ streaming grid (PropCellId.muX).' },
		muZ: { label: 'Grid Z', description: 'Cell row on the coarse XZ streaming grid (PropCellId.muZ).' },
		muNumberOfRespawnDifferent: {
			label: 'Respawn different',
			description: 'How many of this cell\'s instances are "respawn different" — they are ordered FIRST within the cell\'s run. Ordering is load-bearing for collectibles.',
		},
		muNumberOfDontRespawn: {
			label: 'Don\'t respawn',
			description: 'How many of this cell\'s instances are "don\'t respawn" — ordered after the respawn-different ones.',
		},
		muStartIndex: {
			label: 'Start index',
			description: 'First instance index this cell owns. Derived: the running sum of prior cells\' counts. Recomputed on write.',
			readOnly: true,
		},
		muCount: {
			label: 'Count',
			description: 'Number of instances in this cell. Derived from the partition; recomputed on write.',
			readOnly: true,
		},
	},
	propertyGroups: [
		{ title: 'Grid', properties: ['muX', 'muZ'] },
		{ title: 'Counts', properties: ['muNumberOfRespawnDifferent', 'muNumberOfDontRespawn', 'muStartIndex', 'muCount'] },
	],
	label: (value, index) => cellLabel(value, index ?? 0),
};

// ---------------------------------------------------------------------------
// Root + registry export
// ---------------------------------------------------------------------------

const ParsedPropInstanceData: RecordSchema = {
	name: 'ParsedPropInstanceData',
	description: 'Root record for the PropInstanceData resource (0x10011). Holds the prop placements for one track unit: a flat instance array plus the cell partition that groups them for streaming.',
	fields: {
		muZoneId: u16(),
		muSizeInBytes: u32(),
		muNumberOfInstances: u32(),
		instances: recordList('PropInstance', instanceLabel),
		cells: recordList('PropCell', cellLabel),
		_trailingPad: rawBytes(),
	},
	fieldMetadata: {
		muZoneId: {
			label: 'Zone ID',
			description: 'Track-unit / zone id this prop set belongs to (e.g. 206).',
		},
		muSizeInBytes: {
			label: 'Size in bytes',
			description: 'Internal stored size field. Does NOT equal the buffer length (varies per fixture); preserved verbatim so the writer reproduces the header byte-for-byte.',
			readOnly: true,
		},
		muNumberOfInstances: {
			label: 'Number of instances',
			description: 'A larger logical count distinct from the stored record count (instances.length). Meaning not fully understood; preserved verbatim.',
			readOnly: true,
		},
		instances: {
			label: 'Instances',
			description: 'Every placed prop, in disk order. Order within a cell encodes respawn grouping (respawn-different first, then don\'t-respawn) — do not reorder.',
		},
		cells: {
			label: 'Cells',
			description: 'The coarse XZ grid partition over the instance array. Each cell owns a contiguous run; muStartIndex/muCount are recomputed from the partition on write.',
		},
		_trailingPad: {
			label: 'Trailing pad',
			description: 'Zero bytes from end-of-cells to end-of-buffer. Captured and re-emitted verbatim to reproduce the exact original length; users shouldn\'t edit this.',
			hidden: true,
		},
	},
	propertyGroups: [
		{ title: 'Header', properties: ['muZoneId', 'muSizeInBytes', 'muNumberOfInstances'] },
		{ title: 'Instances', properties: ['instances'] },
		{ title: 'Cells', properties: ['cells'] },
	],
};

const registry: SchemaRegistry = {
	ParsedPropInstanceData,
	PropInstance,
	PropCell,
};

export const propInstanceDataResourceSchema: ResourceSchema = {
	key: 'propInstanceData',
	name: 'Prop Instance Data',
	rootType: 'ParsedPropInstanceData',
	registry,
};
