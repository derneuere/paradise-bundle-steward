// V22 prototype TrafficData schema (Burnout 5 dev builds — Nov 2006 X360).
//
// Backs `ParsedTrafficDataV22`. The retail v44/v45 schema in `./trafficData.ts`
// can't describe v22 because the on-disk shape is structurally different:
// no kill-zone / vehicle / TLC / paint-colour tables, hull contents not
// interpreted (captured raw), four trailing pointer regions whose semantics
// we don't yet have a spec for.
//
// This schema describes only what the v22 parser actually populates: the
// header pointer fields, the v22-shaped `Pvs` (no forward `mCellSize`), the
// hull pointer table, and the four tail-byte regions as opaque buffers.
// The editor profile freezes this schema via `freezeSchema()` so every
// field renders as read-only and lists can't be added to / removed from.

import type {
	FieldSchema,
	RecordSchema,
	ResourceSchema,
	SchemaRegistry,
} from '../types';

// ---------------------------------------------------------------------------
// Field constructors (kept local — too small to share with the retail schema)
// ---------------------------------------------------------------------------

const u16 = (): FieldSchema => ({ kind: 'u16' });
const u32 = (): FieldSchema => ({ kind: 'u32' });
const vec4 = (): FieldSchema => ({ kind: 'vec4' });
const record = (type: string): FieldSchema => ({ kind: 'record', type });

// Fixed-size primitive list — used for the 8-entry hull-id arrays inside
// each PvsHullSet.
const fixedList = (item: FieldSchema, length: number): FieldSchema => ({
	kind: 'list',
	item,
	minLength: length,
	maxLength: length,
	addable: false,
	removable: false,
});

// Variable-length record list. Read-only via `freezeSchema()` at profile
// registration time, so the addable/removable defaults don't matter.
const recordList = (type: string): FieldSchema => ({
	kind: 'list',
	item: record(type),
	addable: true,
	removable: true,
});

// Variable-length primitive list.
const primList = (item: FieldSchema): FieldSchema => ({
	kind: 'list',
	item,
	addable: true,
	removable: true,
});

// Opaque byte buffer — surfaced as a custom field. No renderer is registered
// at the editor binding layer for v22 yet; the inspector falls back to
// "no editor" placeholder, which is fine for the read-only diagnostic view.
const bytes = (): FieldSchema => ({ kind: 'custom', component: 'V22HexViewer' });

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

const PvsHullSetV22: RecordSchema = {
	name: 'PvsHullSetV22',
	description: 'PVS cell — up to 8 visible hulls. Same layout as retail.',
	fields: {
		mauItems: fixedList(u16(), 8),
		muCount: u32(),
	},
	fieldMetadata: {
		mauItems: { label: 'Hull indexes' },
		muCount: { label: 'Count' },
	},
};

const TrafficPvsV22: RecordSchema = {
	name: 'TrafficPvsV22',
	description:
		'V22 Potentially Visible Set — same conceptual structure as retail minus the forward mCellSize Vec4 (cell size can be reconstructed at runtime as 1/mRecipCellSize).',
	fields: {
		mGridMin: vec4(),
		mRecipCellSize: vec4(),
		muNumCells_X: u32(),
		muNumCells_Z: u32(),
		muNumCells: u32(),
		ptrHullPvs: u32(),
		hullPvsSets: recordList('PvsHullSetV22'),
	},
	fieldMetadata: {
		mGridMin: { label: 'Grid min (world)', swapYZ: true },
		mRecipCellSize: { label: 'Recip cell size', swapYZ: true },
		muNumCells: {
			label: 'Num cells (populated)',
			description: 'Count of populated hullPvsSets — NOT muNumCells_X * muNumCells_Z.',
		},
		ptrHullPvs: { label: 'Hull-PVS pointer (raw)', description: 'On-disk offset; informational only.' },
	},
};

const ParsedTrafficDataV22Root: RecordSchema = {
	name: 'ParsedTrafficDataV22',
	description:
		'Root record for the Traffic Data resource (0x10002), v22 Burnout 5 prototype variant. Read-only structural view: header / Pvs / hull pointer table parse cleanly; hull contents and four trailing pointer regions are captured as raw bytes (no spec for the internals yet). Frozen by the editor profile so every field renders read-only.',
	fields: {
		// Discriminator on the runtime model — always 'v22' on this schema.
		kind: { kind: 'string' },
		muDataVersion: { kind: 'u8' },
		muSizeInBytes: u32(),
		pvs: record('TrafficPvsV22'),
		// Header pointer fields — preserved verbatim from the on-disk header.
		// Surfaced for diagnostic inspection; not editable.
		ptrPvs: u32(),
		ptrHulls: u32(),
		ptrTailA: u32(),
		muNumFlowTypes: u16(),
		muNumVehicleTypes: u16(),
		ptrTailB: u32(),
		ptrTailC: u32(),
		ptrTailD: u32(),
		// Hull pointer table — one u32 per hull, pointing into the bundle at
		// 0x30 strides. The hulls themselves are captured as raw bytes.
		hullPointers: primList(u32()),
		hullsRaw: primList(bytes()),
		// Four trailing regions; positional names only — no semantic claim.
		tailABytes: bytes(),
		tailBBytes: bytes(),
		tailCBytes: bytes(),
		tailDBytes: bytes(),
	},
	fieldMetadata: {
		kind: { hidden: true, readOnly: true },
		muDataVersion: { description: 'Always 22 for the Burnout 5 prototype dev build.' },
		muSizeInBytes: { readOnly: true, hidden: true },
		ptrPvs: { label: 'Pvs pointer (raw)' },
		ptrHulls: { label: 'Hulls pointer (raw)' },
		ptrTailA: { label: 'Tail A pointer (raw)', description: 'Likely flow types — ~1792 B in the sample fixture.' },
		ptrTailB: { label: 'Tail B pointer (raw)', description: '~432 B in the sample fixture.' },
		ptrTailC: { label: 'Tail C pointer (raw)', description: '~544 B in the sample fixture.' },
		ptrTailD: { label: 'Tail D pointer (raw)', description: '~324 B; runs to EOF in the sample fixture.' },
		hullPointers: { description: 'Raw hull pointer table — one u32 per hull, 0x30-byte stride.' },
		hullsRaw: {
			description:
				'Per-hull raw 0x30-byte buffers. Hull internals are not interpreted — confidently labelling those fields would need either a v22 spec or several more fixtures to triangulate.',
		},
		tailABytes: { description: 'Bytes referenced by ptrTailA — opaque.' },
		tailBBytes: { description: 'Bytes referenced by ptrTailB — opaque.' },
		tailCBytes: { description: 'Bytes referenced by ptrTailC — opaque.' },
		tailDBytes: { description: 'Bytes referenced by ptrTailD — opaque.' },
	},
	propertyGroups: [
		{
			title: 'Header',
			properties: [
				'muDataVersion',
				'muSizeInBytes',
				'muNumFlowTypes',
				'muNumVehicleTypes',
			],
		},
		{
			title: 'PVS',
			properties: ['pvs'],
		},
		{
			title: 'Hulls (structural)',
			properties: ['hullPointers', 'hullsRaw'],
		},
		{
			title: 'Tail regions',
			properties: ['tailABytes', 'tailBBytes', 'tailCBytes', 'tailDBytes'],
		},
		{
			title: 'Raw pointers',
			properties: ['ptrPvs', 'ptrHulls', 'ptrTailA', 'ptrTailB', 'ptrTailC', 'ptrTailD'],
		},
	],
};

// ---------------------------------------------------------------------------
// Exported resource (the editor profile applies `freezeSchema` at registration
// time — kept raw here so the schema definition stays single-sourced).
// ---------------------------------------------------------------------------

const v22Registry: SchemaRegistry = {
	ParsedTrafficDataV22: ParsedTrafficDataV22Root,
	TrafficPvsV22,
	PvsHullSetV22,
};

export const trafficDataV22ResourceSchema: ResourceSchema = {
	key: 'trafficData',
	name: 'Traffic Data (v22 prototype)',
	rootType: 'ParsedTrafficDataV22',
	registry: v22Registry,
};
