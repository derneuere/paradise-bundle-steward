// Schema for the structured ICE Take Dictionary (resource type 0x41).
//
// Mirrors the model in `src/lib/core/iceTakeDictionary.ts`:
//   IceTakeDictionary { kind, indexOffset, entries: IceDictionaryEntry[] }
//   IceDictionaryEntry { key: bigint, userFlags, take: IceTake }
//   IceTake { nodeBase, guid, name, nameBytes, lengthSeconds, allocated,
//             elementCounts[12], indices[], parameters[], alignPadBytes, runs[] }
//
// The dictionary is a list of camera takes. Each take's editable surface is its
// metadata (guid, name, length) plus the 48 keyframed channel elements. Those
// elements can't be a static record — the control for each value depends on the
// element-descriptions table — so the take's `runs` array is a `custom` field
// rendered by the `iceTakeChannels` extension (see iceTakeDictionaryExtensions).
//
// Structural / derived fields (the entry table offset, per-take node links, the
// indices / parameters / alignment-pad bookkeeping, and the per-channel element
// counts) are preserved by the walker's structural sharing and are marked
// readOnly or hidden — they are rebuilt by the byte-exact writer, not edited.

import type {
	FieldSchema,
	RecordSchema,
	ResourceSchema,
	SchemaRegistry,
} from '../types';

// ---------------------------------------------------------------------------
// Local field helpers
// ---------------------------------------------------------------------------

const u32 = (): FieldSchema => ({ kind: 'u32' });
const f32 = (): FieldSchema => ({ kind: 'f32' });
const string = (): FieldSchema => ({ kind: 'string' });
const record = (type: string): FieldSchema => ({ kind: 'record', type });

const numberList = (): FieldSchema => ({
	kind: 'list',
	item: { kind: 'u32' },
	addable: false,
	removable: false,
});

// ---------------------------------------------------------------------------
// ICE channel names — the ICEChannels enum, one per channel slot.
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

function takeNameFor(take: unknown): string {
	if (!take || typeof take !== 'object') return '?';
	const t = take as { name?: string; guid?: number };
	if (t.name && t.name.length > 0) return t.name;
	return t.guid != null ? `guid ${t.guid}` : '?';
}

function entryLabel(entry: unknown, index: number): string {
	if (!entry || typeof entry !== 'object') return `#${index}`;
	const e = entry as { take?: { lengthSeconds?: number } };
	const name = takeNameFor(e.take);
	const dur = typeof e.take?.lengthSeconds === 'number' ? e.take.lengthSeconds.toFixed(2) : '?';
	return `#${index} · ${name} · ${dur}s`;
}

function elementCountLabel(ec: unknown, index: number): string {
	const name = ICE_CHANNEL_NAMES[index] ?? `Channel ${index}`;
	if (!ec || typeof ec !== 'object') return name;
	const e = ec as { keys?: number; intervals?: number };
	return `${name} · ${e.keys ?? 0} keys · ${e.intervals ?? 0} intervals`;
}

// ---------------------------------------------------------------------------
// Record schemas
// ---------------------------------------------------------------------------

const IceElementCount: RecordSchema = {
	name: 'IceElementCount',
	description: 'Per-channel key/interval value counts. One entry per ICE channel (12 total).',
	fields: {
		intervals: u32(),
		keys: u32(),
	},
	fieldMetadata: {
		// Counts drive how many values each element holds; changing one would
		// desync the keyframe runs from the header, so they are structural.
		intervals: { label: 'Intervals', readOnly: true },
		keys: { label: 'Keys', readOnly: true },
	},
	label: (value, index) => elementCountLabel(value, index ?? 0),
};

const IceTake: RecordSchema = {
	name: 'IceTake',
	description: 'One camera take — keyframed channels played as a single camera cut.',
	fields: {
		guid: u32(),
		name: string(),
		lengthSeconds: f32(),
		nodeBase: { kind: 'list', item: { kind: 'u32' }, addable: false, removable: false },
		allocated: u32(),
		elementCounts: {
			kind: 'list',
			item: record('IceElementCount'),
			minLength: 12,
			maxLength: 12,
			addable: false,
			removable: false,
			itemLabel: (v, i) => elementCountLabel(v, i),
		},
		indices: numberList(),
		parameters: numberList(),
		alignPadBytes: u32(),
		// nameBytes is the raw char[32] preserved for byte-exact padding; it's a
		// Uint8Array, not editable — hidden from the form.
		nameBytes: { kind: 'list', item: { kind: 'u8' }, addable: false, removable: false },
		// The 48 keyframed elements, rendered by the channel editor extension.
		runs: { kind: 'custom', component: 'iceTakeChannels' },
	},
	fieldMetadata: {
		guid: { label: 'GUID', description: 'miGuid — GameDB identifier for the take.' },
		name: {
			label: 'Name',
			description: 'Take name (decoded from the fixed char[32] field).',
		},
		lengthSeconds: { label: 'Length (seconds)', description: 'mfLength — total take duration.' },
		allocated: { label: 'Allocated', readOnly: true, hidden: true },
		nodeBase: { label: 'Node links', readOnly: true, hidden: true },
		elementCounts: {
			label: 'Element counts (12 channels)',
			readOnly: true,
			description:
				'Parallel to the ICEChannels enum: Main, Blend, Raw Focus, Shake, Time, Tag, Overlay, Letterbox, Fade, PostFX, Assembly, Shake Data.',
		},
		indices: { label: 'Indices', readOnly: true, hidden: true },
		parameters: { label: 'Parameters', readOnly: true, hidden: true },
		alignPadBytes: { label: 'Alignment pad', readOnly: true, hidden: true },
		nameBytes: { hidden: true, readOnly: true },
		runs: { label: 'Channels' },
	},
	label: (value) => takeNameFor(value),
	propertyGroups: [
		{ title: 'Take', properties: ['guid', 'name', 'lengthSeconds'] },
		{ title: 'Channels', properties: ['runs'] },
	],
};

const IceDictionaryEntry: RecordSchema = {
	name: 'IceDictionaryEntry',
	description: 'One dictionary entry — a key/flags pair pointing at a take.',
	fields: {
		key: { kind: 'bigint', hex: true },
		userFlags: u32(),
		take: record('IceTake'),
	},
	fieldMetadata: {
		key: {
			label: 'Key',
			readOnly: true,
			// The key is the take-name hash; the writer does not recompute it
			// from an edited name, so editing the name leaves the key stale.
			warning: 'Lookup key (name hash) — NOT recomputed when you edit the take name.',
			description: 'mKey — DictionaryKey hash of the lowercase take name.',
		},
		userFlags: {
			label: 'User flags',
			readOnly: true,
			description: 'mxUserFlags — 0x80000000 in retail.',
		},
		take: { label: 'Take' },
	},
	label: (value, index) => entryLabel(value, index ?? 0),
};

const IceTakeDictionary: RecordSchema = {
	name: 'IceTakeDictionary',
	description: 'Root record for the ICE Take Dictionary resource (0x41) — a list of camera takes.',
	fields: {
		// `kind` is the structural discriminant carried on the model; declared so
		// the coverage walker accounts for it. Hidden — not user-facing.
		kind: string(),
		indexOffset: u32(),
		entries: {
			kind: 'list',
			item: record('IceDictionaryEntry'),
			addable: true,
			removable: true,
			itemLabel: (v, i) => entryLabel(v, i),
		},
	},
	fieldMetadata: {
		kind: { hidden: true, readOnly: true },
		indexOffset: {
			label: 'Index offset',
			readOnly: true,
			hidden: true,
			description: 'mpaIndex — entry-table file offset, rebuilt by the writer.',
		},
		entries: { label: 'Takes' },
	},
	propertyGroups: [{ title: 'Takes', properties: ['entries'] }],
};

// ---------------------------------------------------------------------------
// Registry + resource
// ---------------------------------------------------------------------------

const registry: SchemaRegistry = {
	IceTakeDictionary,
	IceDictionaryEntry,
	IceTake,
	IceElementCount,
};

export const iceTakeDictionaryResourceSchema: ResourceSchema = {
	key: 'iceTakeDictionary',
	name: 'ICE Take Dictionary',
	rootType: 'IceTakeDictionary',
	registry,
};
