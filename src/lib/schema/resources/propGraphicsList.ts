// Hand-written schema for ParsedPropGraphicsList (resource type 0x10010).
//
// Mirrors the types in `src/lib/core/propGraphicsList.ts`. Keep these in
// lockstep with the parser/writer — any field added to the parser needs a
// matching entry here, or the schema walker reports it as drift.
//
// Domain: a PropGraphicsList is the per-track-unit catalogue mapping every prop
// TYPE placed in that unit (see PropInstanceData / 0x10011) to the Model
// resource(s) the runtime spawns for it. Two parallel arrays: one PropGraphics
// per whole prop (its body Model) and one PropPartGraphics per destructible
// sub-piece (e.g. a billboard panel that breaks off), grouped contiguously by
// owning prop. The Model references are BND2 imports — every mpPropModel is 0 on
// disk; the real resource id is resolved at render time from the inline import
// table by the field's byte offset (same pattern as InstanceList's mpModel).
// That import table lives in `_tail`, so adding/removing props or parts (which
// would shift the table's field offsets) is out of scope; field edits are fine.

import type {
	FieldSchema,
	RecordSchema,
	ResourceSchema,
	SchemaContext,
	SchemaRegistry,
} from '../types';

// ---------------------------------------------------------------------------
// Local helpers (mirroring instanceList.ts)
// ---------------------------------------------------------------------------

const u32 = (): FieldSchema => ({ kind: 'u32' });
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
	// Add/remove is out of scope: a prop/part count change shifts the inline
	// import table's field offsets, breaking every Model reference. Keep the
	// arrays fixed-length so the inspector only exposes field edits.
	addable: false,
	removable: false,
	itemLabel,
});

const hex = (n: number | undefined): string =>
	n != null ? `0x${n.toString(16).toUpperCase()}` : '?';

// ---------------------------------------------------------------------------
// Tree-label helpers
// ---------------------------------------------------------------------------

function propLabel(prop: unknown, index: number): string {
	try {
		if (!prop || typeof prop !== 'object') return `#${index}`;
		const p = prop as { muTypeId?: number };
		return `#${index} · type ${hex(p.muTypeId)}`;
	} catch {
		return `#${index}`;
	}
}

function partLabel(part: unknown, index: number): string {
	try {
		if (!part || typeof part !== 'object') return `#${index}`;
		const p = part as { muTypeId?: number; muPartId?: number };
		return `#${index} · type ${hex(p.muTypeId)} · part ${p.muPartId ?? '?'}`;
	} catch {
		return `#${index}`;
	}
}

// ---------------------------------------------------------------------------
// Record schemas
// ---------------------------------------------------------------------------

const PropGraphics: RecordSchema = {
	name: 'PropGraphics',
	description: 'One whole prop — its type id plus a (locally-zero) import pointer to the body Model the runtime spawns, and an internal pointer to the prop\'s first destructible part.',
	fields: {
		muTypeId: u32(),
		mpPropModel: u32(),
		mpParts: u32(),
	},
	fieldMetadata: {
		muTypeId: {
			label: 'Prop type',
			description: 'Prop TYPE index (into the prop-types table). Identifies which prop placed in this track unit this Model catalogue entry is for.',
		},
		mpPropModel: {
			label: 'Model pointer',
			description: 'Import pointer to the body Model this prop spawns. Always 0 on disk — the real Model id is a BND2 import resolved at render time by the field offset, not stored in the payload. Preserved verbatim.',
			readOnly: true,
		},
		mpParts: {
			label: 'Parts pointer',
			description: 'Internal resource-relative pointer to this prop\'s first PropPartGraphics (0 when the prop has no parts). Parts are grouped contiguously by owning prop; preserved verbatim.',
			readOnly: true,
		},
	},
	propertyGroups: [
		{ title: 'Identity', properties: ['muTypeId', 'mpPropModel', 'mpParts'] },
	],
	label: (value, index) => propLabel(value, index ?? 0),
};

const PropPartGraphics: RecordSchema = {
	name: 'PropPartGraphics',
	description: 'One destructible sub-piece of a prop (e.g. a billboard panel that breaks off) — the owning prop\'s type id, the part index within that prop, and a (locally-zero) import pointer to the part\'s Model.',
	fields: {
		muTypeId: u32(),
		muPartId: u32(),
		mpPropModel: u32(),
	},
	fieldMetadata: {
		muTypeId: {
			label: 'Prop type',
			description: 'The owning prop\'s TYPE index. Parts are grouped contiguously by this value, matching the PropGraphics entry they belong to.',
		},
		muPartId: {
			label: 'Part ID',
			description: 'Index of this part within its owning prop (0, 1, 2, …). Identifies which destructible sub-piece this Model entry drives.',
		},
		mpPropModel: {
			label: 'Model pointer',
			description: 'Import pointer to this part\'s Model. Always 0 on disk — the real Model id is a BND2 import resolved at render time by the field offset. Preserved verbatim.',
			readOnly: true,
		},
	},
	propertyGroups: [
		{ title: 'Identity', properties: ['muTypeId', 'muPartId', 'mpPropModel'] },
	],
	label: (value, index) => partLabel(value, index ?? 0),
};

// ---------------------------------------------------------------------------
// Root + registry export
// ---------------------------------------------------------------------------

const ParsedPropGraphicsList: RecordSchema = {
	name: 'ParsedPropGraphicsList',
	description: 'Root record for the PropGraphicsList resource (0x10010). Maps every prop TYPE placed in one track unit to its Model(s): a props array (one body Model per prop) plus a parts array (one Model per destructible sub-piece).',
	fields: {
		muZoneNumber: u32(),
		muSizeInBytes: u32(),
		props: recordList('PropGraphics', propLabel),
		parts: recordList('PropPartGraphics', partLabel),
		_tail: rawBytes(),
	},
	fieldMetadata: {
		muZoneNumber: {
			label: 'Zone number',
			description: 'PVS zone / track-unit id this prop catalogue belongs to (e.g. 9). Editable.',
		},
		muSizeInBytes: {
			label: 'Size in bytes',
			description: 'Internal stored size field. Does NOT consistently equal a derivable offset (it is the part-array end when parts exist, but align16(prop-array end) when there are none); preserved verbatim so the writer reproduces the header byte-for-byte.',
			readOnly: true,
		},
		props: {
			label: 'Props',
			description: 'One entry per whole prop type in this track unit, mapping it to its body Model. Fixed-length: adding/removing entries would shift the inline import table\'s field offsets and break every Model reference.',
		},
		parts: {
			label: 'Parts',
			description: 'One entry per destructible prop sub-piece, mapping it to its Model. Grouped contiguously by owning prop. Fixed-length for the same import-offset reason as props.',
		},
		_tail: {
			label: 'Tail',
			description: 'Bytes from the end of the last array to the end of the payload: an align16 pad followed by the inline BND2 import table (one entry per prop + per part). Re-emitted verbatim to reproduce the exact length and keep every Model import valid; users shouldn\'t edit this.',
			hidden: true,
		},
	},
	propertyGroups: [
		{ title: 'Header', properties: ['muZoneNumber', 'muSizeInBytes'] },
		{ title: 'Props', properties: ['props'] },
		{ title: 'Parts', properties: ['parts'] },
	],
};

const registry: SchemaRegistry = {
	ParsedPropGraphicsList,
	PropGraphics,
	PropPartGraphics,
};

export const propGraphicsListResourceSchema: ResourceSchema = {
	key: 'propGraphicsList',
	name: 'Prop Graphics List',
	rootType: 'ParsedPropGraphicsList',
	registry,
};
