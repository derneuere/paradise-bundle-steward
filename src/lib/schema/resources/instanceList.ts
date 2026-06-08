// Hand-written schema for ParsedInstanceList (resource type 0x23).
//
// Mirrors the types in `src/lib/core/instanceList.ts`. Keep these in lockstep
// with the parser/writer — any field added to the parser needs a matching
// entry here, or the schema walker reports it as drift.
//
// Domain: an InstanceList places Models into the world at a transform. Each
// track unit's _GR bundle carries exactly one; rendering it (Model →
// Renderable per instance, positioned by the instance's mWorldTransform) draws
// the track-unit geometry in the same world space as PropInstanceData, so props
// sit on the rendered track. The structure is near-identical to
// PropInstanceData — a flat array of instances, each a world transform plus a
// (always-zero-on-disk) model import pointer.

import type {
	FieldSchema,
	RecordSchema,
	ResourceSchema,
	SchemaContext,
	SchemaRegistry,
} from '../types';

// ---------------------------------------------------------------------------
// Local helpers (mirroring propInstanceData.ts)
// ---------------------------------------------------------------------------

const u16 = (): FieldSchema => ({ kind: 'u16' });
const u32 = (): FieldSchema => ({ kind: 'u32' });
const i16 = (): FieldSchema => ({ kind: 'i16' });
const f32 = (): FieldSchema => ({ kind: 'f32' });
const matrix44 = (): FieldSchema => ({ kind: 'matrix44' });
const record = (type: string): FieldSchema => ({ kind: 'record', type });
// Raw byte buffer used for round-trip-only preservation fields. The default
// form renderer hides custom fields without a registered component, which is
// fine — users shouldn't edit these directly.
const rawBytes = (): FieldSchema => ({ kind: 'custom', component: 'rawBytes' });

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
// Tree-label helpers
// ---------------------------------------------------------------------------

function instanceLabel(inst: unknown, index: number): string {
	try {
		if (!inst || typeof inst !== 'object') return `#${index}`;
		const i = inst as { mi16BackdropZoneID?: number; mWorldTransform?: number[] };
		const t = i.mWorldTransform;
		const x = t && t[12] != null ? t[12].toFixed(0) : '?';
		const z = t && t[14] != null ? t[14].toFixed(0) : '?';
		const zone = i.mi16BackdropZoneID;
		const backdrop = zone != null && zone !== -1 ? ` · backdrop ${zone}` : '';
		return `#${index} · (${x}, ${z})${backdrop}`;
	} catch {
		return `#${index}`;
	}
}

// ---------------------------------------------------------------------------
// Record schemas
// ---------------------------------------------------------------------------

// The on-disk Instance record carries two padding slots interleaved with the
// real fields (a u16 after the backdrop zone id, then a u32 before the visible
// distance). The parser groups them into a `_pad` sub-object; the schema models
// that as a nested record so the walker descends into it (rather than flagging
// `_pad` as drift), with both slots hidden from the inspector.
const InstanceListPad: RecordSchema = {
	name: 'InstanceListPad',
	description: 'Padding slots interleaved into the on-disk Instance record (a u16 after the backdrop zone id and a u32 before the visible-distance field). Zero in every observed fixture; preserved verbatim for byte-exact round-trip.',
	fields: {
		mu16Pad: u16(),
		mu32Pad: u32(),
	},
	fieldMetadata: {
		mu16Pad: { label: 'pad u16', hidden: true },
		mu32Pad: { label: 'pad u32', hidden: true },
	},
};

const InstanceListEntry: RecordSchema = {
	name: 'InstanceListEntry',
	description: 'One placed Model — a world transform plus a (locally-zero) import pointer to the Model that gets spawned and a backdrop / visibility tag.',
	fields: {
		mpModel: u32(),
		mi16BackdropZoneID: i16(),
		mfMaxVisibleDistanceSquared: f32(),
		mWorldTransform: matrix44(),
		_pad: record('InstanceListPad'),
	},
	fieldMetadata: {
		mpModel: {
			label: 'Model pointer',
			description: 'Import pointer to the Model resource this instance spawns. Always 0 on disk — the real Model id is a BND2 import resolved at render time by the field offset, not stored in the payload. Preserved verbatim.',
			readOnly: true,
		},
		mi16BackdropZoneID: {
			label: 'Backdrop zone ID',
			description: 'i16. The zone this instance belongs to when it is a distant backdrop / skybox piece; -1 means it is not a backdrop (a normal in-world model).',
		},
		mfMaxVisibleDistanceSquared: {
			label: 'Max visible distance²',
			description: 'f32. Squared cull distance — beyond sqrt(this) from the camera the instance is not drawn. 0 = use the default / always considered.',
		},
		mWorldTransform: {
			label: 'World transform',
			description: 'Matrix44Affine (16 f32, row-major). Translation = the last row — indices 12/13/14 carry world X/Y/Z, so this is where the model sits on the map.',
		},
		_pad: {
			label: 'Padding',
			description: 'Interleaved padding slots on the on-disk Instance record. Zero in every fixture; preserved verbatim for byte-exact round-trip.',
			hidden: true,
		},
	},
	propertyGroups: [
		{ title: 'Transform', properties: ['mWorldTransform'] },
		{ title: 'Identity', properties: ['mpModel', 'mi16BackdropZoneID', 'mfMaxVisibleDistanceSquared'] },
	],
	label: (value, index) => instanceLabel(value, index ?? 0),
};

// ---------------------------------------------------------------------------
// Root + registry export
// ---------------------------------------------------------------------------

const ParsedInstanceList: RecordSchema = {
	name: 'ParsedInstanceList',
	description: 'Root record for the InstanceList resource (0x23). Holds the Model placements for one track unit: a flat instance array, each entry positioning a Model by its world transform.',
	fields: {
		muNumInstances: u32(),
		muVersionNumber: u32(),
		instances: recordList('InstanceListEntry', instanceLabel),
		_trailingPad: rawBytes(),
	},
	fieldMetadata: {
		muNumInstances: {
			label: 'Number of instances',
			description: 'Count of complete / renderable entries (indices 0..muNumInstances-1 have valid transforms + locally-resolvable models). Distinct from instances.length, which is the over-allocated array size (muArraySize). Preserved verbatim.',
			readOnly: true,
		},
		muVersionNumber: {
			label: 'Version number',
			description: 'Resource format version — always 1 in observed fixtures. Preserved verbatim so the writer reproduces the header byte-for-byte.',
			readOnly: true,
		},
		instances: {
			label: 'Instances',
			description: 'Every placed Model, in disk order. The array is over-allocated to muArraySize (= instances.length); only the first muNumInstances entries are guaranteed complete.',
		},
		_trailingPad: {
			label: 'Trailing pad',
			description: 'Zero bytes from end-of-array to end-of-buffer. Captured and re-emitted verbatim to reproduce the exact original length; users shouldn\'t edit this.',
			hidden: true,
		},
	},
	propertyGroups: [
		{ title: 'Header', properties: ['muNumInstances', 'muVersionNumber'] },
		{ title: 'Instances', properties: ['instances'] },
	],
};

const registry: SchemaRegistry = {
	ParsedInstanceList,
	InstanceListEntry,
	InstanceListPad,
};

export const instanceListResourceSchema: ResourceSchema = {
	key: 'instanceList',
	name: 'Instance List',
	rootType: 'ParsedInstanceList',
	registry,
};
