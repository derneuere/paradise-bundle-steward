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
// owning prop. The Model references are BND2 imports — modelled here as the
// editable `mpModelId` (the on-disk pointer is 0; the real id lives in the
// resource's inline import table, which the writer rebuilds). Entries are
// addable/removable: a prop instance whose type isn't catalogued needs a new
// PropGraphics row mapping type → Model. The bundle envelope's import metadata
// follows a count change via the handler's importTable() hook.

import type {
	FieldSchema,
	RecordSchema,
	ResourceSchema,
	SchemaContext,
	SchemaRegistry,
} from '../types';
import { PROP_TYPES, propTypeLabel } from '@/lib/core/propTypes';

// ---------------------------------------------------------------------------
// Local helpers (mirroring environmentTimeLine.ts)
// ---------------------------------------------------------------------------

const u32 = (): FieldSchema => ({ kind: 'u32' });
const resourceId = (): FieldSchema => ({ kind: 'bigint', bytes: 8, hex: true });
const record = (type: string): FieldSchema => ({ kind: 'record', type });

// typeId enum sourced from the 247-entry prop-types table (same vocabulary as
// PropInstanceData), so the dropdown shows human prop names.
const PROP_TYPE_VALUES = PROP_TYPES.map((p) => ({ value: p.index, label: p.name }));
const propTypeEnum = (): FieldSchema => ({ kind: 'enum', storage: 'u32', values: PROP_TYPE_VALUES });

const recordList = (
	type: string,
	makeEmpty: (ctx: SchemaContext) => unknown,
	itemLabel?: (item: unknown, index: number, ctx: SchemaContext) => string,
	addable = true,
): FieldSchema => ({
	kind: 'list',
	item: record(type),
	addable,
	removable: addable,
	makeEmpty,
	itemLabel,
});

const hex = (n: number | bigint | undefined): string =>
	n != null ? `0x${n.toString(16).toUpperCase()}` : '?';

// ---------------------------------------------------------------------------
// Tree-label helpers
// ---------------------------------------------------------------------------

function propLabel(prop: unknown, index: number): string {
	try {
		if (!prop || typeof prop !== 'object') return `#${index}`;
		const p = prop as { muTypeId?: number; mpModelId?: bigint };
		const name = p.muTypeId != null ? propTypeLabel(p.muTypeId) : '?';
		return `#${index} · ${name} · model ${hex(p.mpModelId)}`;
	} catch {
		return `#${index}`;
	}
}

function partLabel(part: unknown, index: number): string {
	try {
		if (!part || typeof part !== 'object') return `#${index}`;
		const p = part as { muTypeId?: number; muPartId?: number; mpModelId?: bigint };
		const name = p.muTypeId != null ? propTypeLabel(p.muTypeId) : '?';
		return `#${index} · ${name} · part ${p.muPartId ?? '?'} · model ${hex(p.mpModelId)}`;
	} catch {
		return `#${index}`;
	}
}

// ---------------------------------------------------------------------------
// Record schemas
// ---------------------------------------------------------------------------

const PropGraphics: RecordSchema = {
	name: 'PropGraphics',
	description: 'One whole prop — its type plus the Model resource the runtime spawns for the body mesh. The Model is a BND2 import (the on-disk pointer is 0); edit it via the Model id.',
	fields: {
		muTypeId: propTypeEnum(),
		mpModelId: resourceId(),
		// Internal pointer (mpParts) modelled as a part-array index; null = the
		// prop has no destructible parts. Round-trip-only — hidden.
		firstPartIndex: { kind: 'i32' },
	},
	fieldMetadata: {
		muTypeId: {
			label: 'Prop type',
			description: 'Which prop this Model catalogue entry is for — an index into the 247-entry prop-types table (same vocabulary as PropInstanceData).',
		},
		mpModelId: {
			label: 'Model',
			description: 'Resource id of the Model (0x2A) the runtime spawns for this prop. Stored as a BND2 import (the on-disk pointer is 0 until load); the writer rebuilds the import table from this id, so it is freely editable. Prop Models usually live in GLOBALPROPS.BIN.',
		},
		firstPartIndex: {
			label: 'First part index',
			description: 'Internal pointer to this prop\'s first destructible part (an index into the parts array; absent when the prop has none). Recomputed into a resource-relative offset on write; users shouldn\'t edit it.',
			hidden: true,
			readOnly: true,
		},
	},
	propertyGroups: [
		{ title: 'Identity', properties: ['muTypeId', 'mpModelId'] },
	],
	label: (value, index) => propLabel(value, index ?? 0),
};

const PropPartGraphics: RecordSchema = {
	name: 'PropPartGraphics',
	description: 'One destructible sub-piece of a prop (e.g. a billboard panel that breaks off) — the owning prop\'s type, the part index within that prop, and the Model the runtime spawns for it.',
	fields: {
		muTypeId: propTypeEnum(),
		muPartId: u32(),
		mpModelId: resourceId(),
	},
	fieldMetadata: {
		muTypeId: {
			label: 'Prop type',
			description: 'The owning prop\'s type. Parts are grouped contiguously by this value, matching the PropGraphics entry they belong to.',
		},
		muPartId: {
			label: 'Part ID',
			description: 'Index of this part within its owning prop (0, 1, 2, …).',
		},
		mpModelId: {
			label: 'Model',
			description: 'Resource id of the Model (0x2A) for this destructible part. Same import mechanism as a whole prop — the writer rebuilds the import table from this id.',
		},
	},
	propertyGroups: [
		{ title: 'Identity', properties: ['muTypeId', 'muPartId', 'mpModelId'] },
	],
	label: (value, index) => partLabel(value, index ?? 0),
};

// ---------------------------------------------------------------------------
// Root + registry export
// ---------------------------------------------------------------------------

const ParsedPropGraphicsList: RecordSchema = {
	name: 'ParsedPropGraphicsList',
	description: 'Root record for the PropGraphicsList resource (0x10010). Maps every prop TYPE placed in one track unit to its Model(s): a props array (one body Model per prop) plus a parts array (one Model per destructible sub-piece). Add a prop entry to catalogue a newly-placed prop type.',
	fields: {
		muZoneNumber: u32(),
		props: recordList('PropGraphics', () => ({ muTypeId: 0, mpModelId: 0n, firstPartIndex: null }), propLabel),
		// Parts are field-editable but NOT addable/removable: a prop's link to its
		// parts is the internal firstPartIndex pointer (hidden, not user-settable),
		// so adding a part can't be wired to a prop, and removing/inserting one
		// would shift the part indices that surviving props point at — silently
		// re-owning the wrong parts. Edit a prop's parts by editing existing rows;
		// structural part changes belong in the Blender exporter.
		parts: recordList('PropPartGraphics', () => ({ muTypeId: 0, muPartId: 0, mpModelId: 0n }), partLabel, false),
	},
	fieldMetadata: {
		muZoneNumber: {
			label: 'Zone number',
			description: 'PVS zone / track-unit id this prop catalogue belongs to (e.g. 9). Editable.',
		},
		props: {
			label: 'Props',
			description: 'One entry per whole prop type in this track unit, mapping it to its body Model. Add an entry (type + Model id) to catalogue a prop type you have newly placed via PropInstanceData; the import table is rebuilt on export.',
		},
		parts: {
			label: 'Parts',
			description: 'One entry per destructible prop sub-piece, mapping it to its Model. Grouped contiguously by owning prop. Fields are editable, but rows can\'t be added/removed here — a part\'s owning-prop link is an internal pointer the UI doesn\'t expose, so structural changes would mis-assign ownership.',
		},
	},
	propertyGroups: [
		{ title: 'Header', properties: ['muZoneNumber'] },
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
