// Hand-written schema for ParsedIceTakeDictionary (resource type 0x41).
//
// Mirrors the types in `src/lib/core/iceTakeDictionary.ts`. The parser uses a
// heuristic byte-scan over the raw payload to locate header-shaped regions,
// so the parsed model is NOT a full dictionary round-trip — it's a list of
// `ICETakeHeader` snapshots, each tagged with the `offset` they were found
// at. Those metadata fields (`offset`, per-take `is64Bit`) don't correspond
// to anything the user edits directly and are marked readOnly + hidden.
//
// The handler is read-only (`caps.write: false`), so this schema's purpose is
// navigation + inspection, not mutation. The default field renderers cover
// every field here — no extensions required.

import type {
	FieldSchema,
	RecordSchema,
	ResourceSchema,
	SchemaRegistry,
	SchemaContext,
} from '../types';

// ---------------------------------------------------------------------------
// Local field helpers
// ---------------------------------------------------------------------------

const u16 = (): FieldSchema => ({ kind: 'u16' });
const u32 = (): FieldSchema => ({ kind: 'u32' });
const f32 = (): FieldSchema => ({ kind: 'f32' });
const bool = (): FieldSchema => ({ kind: 'bool' });
const string = (): FieldSchema => ({ kind: 'string' });
const record = (type: string): FieldSchema => ({ kind: 'record', type });

const fixedRecordList = (type: string, length: number): FieldSchema => ({
	kind: 'list',
	item: record(type),
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
// ICE channel names — taken from the ICEChannels enum in
// src/lib/core/iceTakeDictionary.ts. Pinned 12 entries; index is the channel
// slot (eICE_CHANNEL_MAIN = 0, …, eICE_CHANNEL_SHAKE_DATA = 11).
// ---------------------------------------------------------------------------

const ICE_CHANNEL_NAMES = [
	'Main',
	'Blend',
	'Raw Focus',
	'Shake',
	'Time',
	'Tag',
	'Overlay',
	'Letterbox',
	'Fade',
	'PostFX',
	'Assembly',
	'Shake Data',
] as const;

// ---------------------------------------------------------------------------
// Tree-label helpers
// ---------------------------------------------------------------------------

function takeLabel(take: unknown, index: number): string {
	if (!take || typeof take !== 'object') return `#${index}`;
	const t = take as {
		name?: string;
		guid?: number;
		lengthSeconds?: number;
	};
	const nameOrId = t.name && t.name.length > 0
		? t.name
		: (t.guid != null ? `guid ${t.guid}` : '?');
	const dur = typeof t.lengthSeconds === 'number' ? t.lengthSeconds.toFixed(2) : '?';
	return `#${index} · ${nameOrId} · ${dur}s`;
}

function elementCountLabel(ec: unknown, index: number): string {
	const name = ICE_CHANNEL_NAMES[index] ?? `Channel ${index}`;
	if (!ec || typeof ec !== 'object') return name;
	const e = ec as { mu16Keys?: number; mu16Intervals?: number };
	const keys = e.mu16Keys ?? 0;
	const ivl = e.mu16Intervals ?? 0;
	return `${name} · ${keys} keys · ${ivl} intervals`;
}

// ---------------------------------------------------------------------------
// Record schemas
// ---------------------------------------------------------------------------

const ICEElementCount: RecordSchema = {
	name: 'ICEElementCount',
	description: 'Per-channel key/interval counts for a take. One entry per ICE channel (12 total).',
	fields: {
		mu16Intervals: u16(),
		mu16Keys: u16(),
	},
	fieldMetadata: {
		mu16Intervals: { label: 'Intervals' },
		mu16Keys: { label: 'Keys' },
	},
	label: (value, index) => elementCountLabel(value, index ?? 0),
};

const ICETakeHeader: RecordSchema = {
	name: 'ICETakeHeader',
	description: 'One ICE take — a camera cut with keyframed channels.',
	fields: {
		guid: u32(),
		name: string(),
		lengthSeconds: f32(),
		allocated: u32(),
		elementCounts: fixedRecordList('ICEElementCount', 12),
		offset: u32(),
		is64Bit: bool(),
	},
	fieldMetadata: {
		guid: { label: 'GUID', description: 'CRC32 hash of the lowercase take name.' },
		name: { label: 'Name', description: 'UTF-8 decoded from the fixed char[32] macTakeName field.' },
		lengthSeconds: { label: 'Length (seconds)', description: 'mfLength — total duration of the take.' },
		allocated: { label: 'Allocated', description: 'muAllocated — opaque count from the runtime header.' },
		elementCounts: {
			label: 'Element counts (12 channels)',
			description: 'Parallel to the ICEChannels enum: Main, Blend, Raw Focus, Shake, Time, Tag, Overlay, Letterbox, Fade, PostFX, Assembly, Shake Data.',
		},
		offset: {
			label: 'Scan offset',
			readOnly: true,
			hidden: true,
			description: 'Byte offset within the raw payload where the header was located by the heuristic scanner. Not part of the on-disk layout.',
		},
		is64Bit: {
			label: '64-bit layout',
			readOnly: true,
			hidden: true,
			description: 'Whether the scanner matched the 64-bit header shape (0x6C bytes) vs 32-bit (0x64 bytes). Duplicated from the root flag to preserve per-take provenance.',
		},
	},
	label: (value, index) => takeLabel(value, index ?? 0),
};

const IceTakeDictionary: RecordSchema = {
	name: 'IceTakeDictionary',
	description: 'Root record for the ICE Take Dictionary resource (0x41). A list of camera takes recovered by a heuristic byte-scan of the raw payload.',
	fields: {
		takes: recordList('ICETakeHeader', (v, i) => takeLabel(v, i)),
		is64Bit: bool(),
		totalTakes: u32(),
	},
	fieldMetadata: {
		takes: { label: 'Takes' },
		is64Bit: {
			label: '64-bit layout',
			readOnly: true,
			description: 'Whether the scanner picked the 64-bit header layout for this resource. Determined by whichever layout/endianness matched the most plausible headers.',
		},
		totalTakes: {
			label: 'Total takes',
			readOnly: true,
			hidden: true,
			derivedFrom: 'takes',
			description: 'Convenience count — always equals takes.length.',
		},
	},
	propertyGroups: [
		{ title: 'Summary', properties: ['is64Bit', 'totalTakes'] },
		{ title: 'Takes', properties: ['takes'] },
	],
};

// ---------------------------------------------------------------------------
// Registry + resource
// ---------------------------------------------------------------------------

const registry: SchemaRegistry = {
	IceTakeDictionary,
	ICETakeHeader,
	ICEElementCount,
};

export const iceTakeDictionaryResourceSchema: ResourceSchema = {
	key: 'iceTakeDictionary',
	name: 'ICE Take Dictionary',
	rootType: 'IceTakeDictionary',
	registry,
};
