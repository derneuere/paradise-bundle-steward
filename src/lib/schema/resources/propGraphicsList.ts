// Hand-written schema for ParsedPropGraphicsList (resource type 0x10010).
//
// Mirrors the types in `src/lib/core/propGraphicsList.ts`. Keep these in
// lockstep with the parser/writer — any field added to the parser needs a
// matching entry here, or the schema walker reports it as drift.
//
// Domain: a PropGraphicsList is the per-track-unit catalogue mapping every prop
// TYPE placed in that unit (see PropInstanceData / 0x10011) to the Model
// resource(s) the runtime spawns for it. Each prop maps to its body Model
// (mpModelId) and owns a list of destructible PARTS (e.g. a billboard panel that
// breaks off), each with its own Model. Parts are nested UNDER their prop here —
// on disk they're a flat array grouped by the owning prop's type id, but
// ownership is unambiguous by type, so nesting makes "add/remove a part of this
// prop" a safe, structural edit (no dangling pointer to mis-set). The Model
// references are BND2 imports (0 on disk) rebuilt from mpModelId on write, so
// props, parts, and their Models are all freely editable; the bundle envelope's
// import metadata follows a count change via the handler's importTable() hook.

import type {
	FieldSchema,
	RecordSchema,
	ResourceSchema,
	SchemaContext,
	SchemaRegistry,
} from '../types';
import { PROP_TYPES, propTypeLabel } from '@/lib/core/propTypes';

// ---------------------------------------------------------------------------
// Local helpers
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
): FieldSchema => ({
	kind: 'list',
	item: record(type),
	addable: true,
	removable: true,
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
		const p = prop as { muTypeId?: number; mpModelId?: bigint; parts?: unknown[] };
		const name = p.muTypeId != null ? propTypeLabel(p.muTypeId) : '?';
		const n = p.parts?.length ?? 0;
		const partsStr = n > 0 ? ` · ${n} part${n === 1 ? '' : 's'}` : '';
		return `#${index} · ${name} · model ${hex(p.mpModelId)}${partsStr}`;
	} catch {
		return `#${index}`;
	}
}

function partLabel(part: unknown, index: number): string {
	try {
		if (!part || typeof part !== 'object') return `#${index}`;
		const p = part as { muPartId?: number; mpModelId?: bigint };
		return `#${index} · part ${p.muPartId ?? '?'} · model ${hex(p.mpModelId)}`;
	} catch {
		return `#${index}`;
	}
}

// ---------------------------------------------------------------------------
// Record schemas
// ---------------------------------------------------------------------------

const PropPartGraphics: RecordSchema = {
	name: 'PropPartGraphics',
	description: 'One destructible sub-piece of a prop (e.g. a billboard panel that breaks off) — its index within the prop and the Model the runtime spawns for it. The owning prop is implicit (this part is nested under it); on disk the part also stores the prop\'s type id, which the writer re-emits.',
	fields: {
		muPartId: u32(),
		mpModelId: resourceId(),
	},
	fieldMetadata: {
		muPartId: {
			label: 'Part ID',
			description: 'Index of this part within its owning prop (0, 1, 2, …).',
		},
		mpModelId: {
			label: 'Model',
			description: 'Resource id of the Model (0x2A) for this destructible part. A BND2 import (0 on disk); the writer rebuilds the import table from this id.',
		},
	},
	propertyGroups: [
		{ title: 'Identity', properties: ['muPartId', 'mpModelId'] },
	],
	label: (value, index) => partLabel(value, index ?? 0),
};

const PropGraphics: RecordSchema = {
	name: 'PropGraphics',
	description: 'One whole prop — its type, the body Model the runtime spawns, and its list of destructible parts. Add a prop to catalogue a newly-placed prop type; add parts to give it breakable sub-pieces.',
	fields: {
		muTypeId: propTypeEnum(),
		mpModelId: resourceId(),
		parts: recordList('PropPartGraphics', () => ({ muPartId: 0, mpModelId: 0n }), partLabel),
		_mpPartsRaw: u32(),
	},
	fieldMetadata: {
		muTypeId: {
			label: 'Prop type',
			description: 'Which prop this Model catalogue entry is for — an index into the 247-entry prop-types table (same vocabulary as PropInstanceData). Also stamps the type id of every part below it.',
		},
		mpModelId: {
			label: 'Model',
			description: 'Resource id of the Model (0x2A) the runtime spawns for this prop\'s body. A BND2 import (0 on disk); the writer rebuilds the import table from this id. Prop Models usually live in GLOBALPROPS.BIN.',
		},
		parts: {
			label: 'Parts',
			description: 'This prop\'s destructible sub-pieces. Add/remove freely — each part takes this prop\'s type id and the writer regroups + rebuilds all pointers on export.',
		},
		_mpPartsRaw: {
			label: 'Raw parts pointer',
			description: 'On-disk pointer to the prop\'s first part — derived on write for a prop that has parts. Preserved verbatim only for a partless prop (where retail ships leftover bytes the runtime ignores); users shouldn\'t edit it.',
			hidden: true,
			readOnly: true,
		},
	},
	propertyGroups: [
		{ title: 'Identity', properties: ['muTypeId', 'mpModelId'] },
		{ title: 'Parts', properties: ['parts'] },
	],
	label: (value, index) => propLabel(value, index ?? 0),
};

// ---------------------------------------------------------------------------
// Root + registry export
// ---------------------------------------------------------------------------

const ParsedPropGraphicsList: RecordSchema = {
	name: 'ParsedPropGraphicsList',
	description: 'Root record for the PropGraphicsList resource (0x10010). Maps every prop TYPE placed in one track unit to its Model and its destructible parts. Add a prop entry to catalogue a newly-placed prop type; the import table is rebuilt on export.',
	fields: {
		muZoneNumber: u32(),
		props: recordList('PropGraphics', () => ({ muTypeId: 0, mpModelId: 0n, parts: [], _mpPartsRaw: 0 }), propLabel),
	},
	fieldMetadata: {
		muZoneNumber: {
			label: 'Zone number',
			description: 'PVS zone / track-unit id this prop catalogue belongs to (e.g. 9). Editable.',
		},
		props: {
			label: 'Props',
			description: 'One entry per whole prop type in this track unit, mapping it to its body Model and its parts. Add an entry (type + Model id) to catalogue a prop type you have newly placed via PropInstanceData.',
		},
	},
	propertyGroups: [
		{ title: 'Header', properties: ['muZoneNumber'] },
		{ title: 'Props', properties: ['props'] },
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
