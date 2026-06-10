// Hand-written schema for ParsedRegistry (resource type 0xA000).
//
// Mirrors the types in `src/lib/core/soundRegistry.ts`. Keep these in
// lockstep with the parser/writer — any field added to the parser needs a
// matching entry here, or the schema walker reports it as drift.
//
// Domain: a Registry is the sound engine's name-hash phone book. Every
// entity is (name hash, type hash, payload); the payload shape follows the
// type. Exactly ONE of an entity's payload fields is non-null — except
// ContentClass entities, which have no payload at all. The hash table,
// counts, sizes, and pointers are all re-derived on write, so renaming,
// adding, and removing entities is safe; what is NOT safe is editing
// mTypeName without swapping the payload to match, which is why it is
// read-only here.
//
// Hashes are CgsSound sound hashes of the strings in the resource's own
// debug string pool — labels below resolve them back to plain text via
// soundHash() over `strings`, so the tree shows 'GinsuPlayer', not
// 0x720B821B.

import type { FieldSchema, RecordSchema, ResourceSchema, SchemaRegistry } from '../types';
import {
	makeEmptyRegistryEntity,
	soundHash,
	REGISTRY_TYPE_LABELS,
	type ParsedRegistry,
} from '@/lib/core/soundRegistry';

// ---------------------------------------------------------------------------
// Local helpers (mirroring staticSoundMap.ts)
// ---------------------------------------------------------------------------

const f32 = (): FieldSchema => ({ kind: 'f32' });
const u8 = (): FieldSchema => ({ kind: 'u8' });
const u16 = (): FieldSchema => ({ kind: 'u16' });
const u32 = (): FieldSchema => ({ kind: 'u32' });
const str = (): FieldSchema => ({ kind: 'string' });
const record = (type: string): FieldSchema => ({ kind: 'record', type });
const rawBytes = (): FieldSchema => ({ kind: 'custom', component: 'rawBytes' });

// ---------------------------------------------------------------------------
// Hash → string resolution against the resource's own string pool
// ---------------------------------------------------------------------------

/** Resolve a sound hash to its plain-text name via the registry's debug
 *  string pool. Falls back to uppercase hex when the pool has no match
 *  (e.g. after the user renamed an entity by hash). */
export function resolveHash(root: unknown, hash: number | undefined): string {
	if (hash == null) return '?';
	const strings = (root as ParsedRegistry | undefined)?.strings;
	if (Array.isArray(strings)) {
		for (const s of strings) {
			if (typeof s === 'string' && soundHash(s) === hash) return s;
		}
	}
	return `0x${(hash >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;
}

function entityLabel(item: unknown, index: number, root: unknown): string {
	try {
		if (!item || typeof item !== 'object') return `#${index}`;
		const e = item as { mName?: number; mTypeName?: number };
		const kind = e.mTypeName != null ? REGISTRY_TYPE_LABELS[e.mTypeName] ?? resolveHash(root, e.mTypeName) : '?';
		return `#${index} · ${kind} · ${resolveHash(root, e.mName)}`;
	} catch {
		return `#${index}`;
	}
}

function paramBindingLabel(item: unknown, index: number, root: unknown): string {
	try {
		if (!item || typeof item !== 'object') return `#${index}`;
		const p = item as { mParamName?: number; mu16BlockIndex?: number; mu16ParamIndex?: number };
		return `#${index} · ${resolveHash(root, p.mParamName)} → block ${p.mu16BlockIndex ?? '?'}[${p.mu16ParamIndex ?? '?'}]`;
	} catch {
		return `#${index}`;
	}
}

function slotBindingLabel(item: unknown, index: number, root: unknown): string {
	try {
		if (!item || typeof item !== 'object') return `#${index}`;
		const s = item as { mSlotName?: number };
		return `#${index} · ${resolveHash(root, s.mSlotName)}`;
	} catch {
		return `#${index}`;
	}
}

// ---------------------------------------------------------------------------
// Record schemas
// ---------------------------------------------------------------------------

const RegistryParameterSchema: RecordSchema = {
	name: 'RegistryParameterSchema',
	description: 'ParameterSchema payload — the legal range and direction of one named sound parameter.',
	fields: {
		mf32Minimum: f32(),
		mf32Maximum: f32(),
		mu32Direction: {
			kind: 'enum',
			storage: 'u32',
			values: [
				{ value: 0, label: 'Input', description: 'Set by the game (E_PARAMETER_INPUT).' },
				{ value: 1, label: 'Output', description: 'Read back from the DSP ("Get*" parameters, E_PARAMETER_OUTPUT).' },
			],
		},
	},
	fieldMetadata: {
		mf32Minimum: { label: 'Minimum', description: 'Lower bound of the parameter value (units depend on the parameter — Hz for frequencies, ratios for pitch).' },
		mf32Maximum: { label: 'Maximum', description: 'Upper bound of the parameter value.' },
		mu32Direction: { label: 'Direction' },
	},
};

const RegistryFeatureSchema: RecordSchema = {
	name: 'RegistryFeatureSchema',
	description: 'FeatureSchema payload — declares which parameters and slots a sound feature exposes, each referenced by sound hash. The on-disk counts are re-derived from the two lists on write.',
	fields: {
		mu32OutputParamCount: u32(),
		parameterHashes: { kind: 'list', item: u32(), makeEmpty: () => 0 },
		slotHashes: { kind: 'list', item: u32(), makeEmpty: () => 0 },
	},
	fieldMetadata: {
		mu32OutputParamCount: {
			label: 'Output param count',
			description: 'Always 0 in retail; its on-disk meaning is unverified, so treat with care.',
			readOnly: true,
		},
		parameterHashes: {
			label: 'Parameter hashes',
			description: 'Sound hashes of the feature\'s ParameterSchema entities, in declaration order (stored before the slot hashes on disk).',
		},
		slotHashes: {
			label: 'Slot hashes',
			description: 'Sound hashes of the feature\'s SlotSchema entities.',
		},
	},
};

const RwacDspBlock: RecordSchema = {
	name: 'RwacDspBlock',
	description: 'One DSP block inside an RWAC feature, identified by a 4-character code (Pn21 panner, Rsp0 resampler, Pau0 pause, Gns0 Ginsu music decoder, JStr stream reader, …).',
	fields: {
		code: str(),
		mUnknown04: u32(),
		mUnknown08: u32(),
	},
	fieldMetadata: {
		code: {
			label: 'Block code',
			description: 'Exactly 4 printable characters; stored byte-reversed on disk as a multi-char constant.',
		},
		mUnknown04: { label: 'Unknown +0x4', description: '0 in every retail block; meaning unknown.' },
		mUnknown08: { label: 'Unknown +0x8', description: 'Varies per block kind (6 on Pn21, 2 on RM10, 0/1 elsewhere); meaning unknown.' },
	},
	label: (value, index) => {
		const code = (value as { code?: string }).code;
		return `#${index ?? 0} · ${code ?? '?'}`;
	},
};

const RwacParamBinding: RecordSchema = {
	name: 'RwacParamBinding',
	description: 'Routes one named parameter to a (block, parameter) pair inside the feature\'s DSP chain — e.g. GinsuSetPitch → resampler block, parameter 0.',
	fields: {
		mParamName: u32(),
		mu16BlockIndex: u16(),
		mu16ParamIndex: u16(),
	},
	fieldMetadata: {
		mParamName: { label: 'Parameter hash', description: 'Sound hash of the parameter name (the matching ParameterSchema lives in the playback registry).' },
		mu16BlockIndex: { label: 'Block index', description: 'Index into this feature\'s DSP block list.' },
		mu16ParamIndex: { label: 'Param index', description: 'Parameter index within that block.' },
	},
	label: (value, index, ctx) => paramBindingLabel(value, index ?? 0, ctx.root),
};

const RwacSlotBinding: RecordSchema = {
	name: 'RwacSlotBinding',
	description: 'Binds one named content slot to its implementation class — where the feature\'s audio content gets plugged in.',
	fields: {
		mSlotName: u32(),
		mSlotClass: u32(),
		mu16Index: u16(),
		_pad0A: u16(),
	},
	fieldMetadata: {
		mSlotName: { label: 'Slot hash', description: 'Sound hash of the slot name (matches a SlotSchema in the playback registry).' },
		mSlotClass: { label: 'Slot class hash', description: 'Sound hash of the slot implementation class, e.g. ~GenericRwacContentSlot~.' },
		mu16Index: { label: 'Index', description: '0 in retail (single-slot features).' },
		_pad0A: {
			label: 'pad +0xA',
			description: 'Uninitialised tail bytes (0xCDCD allocator fill in retail); preserved verbatim.',
			hidden: true,
		},
	},
	label: (value, index, ctx) => slotBindingLabel(value, index ?? 0, ctx.root),
};

const RegistryRwacFeature: RecordSchema = {
	name: 'RegistryRwacFeature',
	description: 'GenericRwacFeatureImplementation payload (undocumented on the wiki) — a concrete DSP feature: its block chain, parameter routing, and content slots. All three counts are re-derived from the lists on write.',
	fields: {
		blocks: {
			kind: 'list',
			item: record('RwacDspBlock'),
			itemLabel: (item, index) => `#${index} · ${(item as { code?: string })?.code ?? '?'}`,
			makeEmpty: () => ({ code: 'Xxx0', mUnknown04: 0, mUnknown08: 0 }),
		},
		params: {
			kind: 'list',
			item: record('RwacParamBinding'),
			itemLabel: (item, index, ctx) => paramBindingLabel(item, index, ctx.root),
			makeEmpty: () => ({ mParamName: 0, mu16BlockIndex: 0, mu16ParamIndex: 0 }),
		},
		slots: {
			kind: 'list',
			item: record('RwacSlotBinding'),
			itemLabel: (item, index, ctx) => slotBindingLabel(item, index, ctx.root),
			makeEmpty: () => ({ mSlotName: 0, mSlotClass: 0, mu16Index: 0, _pad0A: 0xcdcd }),
		},
		_uninit08: u32(),
	},
	fieldMetadata: {
		blocks: { label: 'DSP blocks', description: 'The feature\'s processing chain in execution order; param bindings reference blocks by index, so reordering needs the bindings updated too.' },
		params: { label: 'Parameter bindings' },
		slots: { label: 'Slot bindings' },
		_uninit08: {
			label: 'uninit +0x8',
			description: 'Uninitialised u32 at the payload start (0xCDCDCDCD allocator fill in retail); preserved verbatim.',
			hidden: true,
		},
	},
};

const RegistryContentSpec: RecordSchema = {
	name: 'RegistryContentSpec',
	description: 'ContentSpec payload — what a named sound loads: an inline content path (usually a gamedb:// URL to a wave or AEMS bank) plus its load attributes. The on-disk path length and 4-byte alignment pad are re-derived on write.',
	fields: {
		mpContentType: u32(),
		mu8LoadMethod: {
			kind: 'enum',
			storage: 'u8',
			values: [
				{ value: 0, label: 'Invalid', description: 'E_CONTENT_LOAD_INVALID — never seen in retail.' },
				{ value: 1, label: 'Resource module', description: 'E_CONTENT_LOAD_RESOURCE_MODULE — the only value in retail.' },
			],
		},
		mu8LoadTime: {
			kind: 'enum',
			storage: 'u8',
			values: [
				{ value: 0, label: 'Just in time', description: 'E_CONTENT_LOAD_JUST_IN_TIME — never seen in retail.' },
				{ value: 1, label: 'Immediate', description: 'E_CONTENT_LOAD_IMMEDIATE — the only value in retail.' },
			],
		},
		path: str(),
		_padTail: rawBytes(),
	},
	fieldMetadata: {
		mpContentType: { label: 'Content type hash', description: 'Name hash of a ContentType entity (in PLAYBACKREGISTRY) saying what kind of content the path points at — e.g. ~GenericRwacWaveContent::SK_WAVE_DATA_CONTENT_TYPE~ for waves, ~SplicerContent::SK_CONTENT_TYPE~ for splice banks.' },
		mu8LoadMethod: { label: 'Load method' },
		mu8LoadTime: { label: 'Load time' },
		path: { label: 'Content path', description: 'Inline content locator, usually a gamedb:// URL. The entity name often equals soundHash(path) but not always (CSIS bank specs differ), so renaming the path does not rename the entity.' },
		_padTail: {
			label: 'pad tail',
			description: 'Uninitialised 0–3 alignment bytes after the NUL (0xCD allocator fill in retail); preserved verbatim, recomputed when the path length changes.',
			hidden: true,
		},
	},
};

const RegistryVoiceSchema: RecordSchema = {
	name: 'RegistryVoiceSchema',
	description: 'VoiceSchema payload — declares which DSP FeatureSchemas a voice class instantiates, each referenced by sound hash. The on-disk count is re-derived from the list on write. (The wiki\'s struct table for this type is self-overlapping and wrong; this layout is taken from the bytes.)',
	fields: {
		mu32SlotCount: u32(),
		mu32ParameterCount: u32(),
		mu32OutputParamCount: u32(),
		featureSchemaHashes: { kind: 'list', item: u32(), makeEmpty: () => 0 },
	},
	fieldMetadata: {
		mu32SlotCount: { label: 'Slot count', description: 'Always 0 in retail; which of the wiki\'s three remaining counts sits at this offset is unverifiable.', readOnly: true },
		mu32ParameterCount: { label: 'Parameter count', description: 'Always 0 in retail; meaning unverified.', readOnly: true },
		mu32OutputParamCount: { label: 'Output param count', description: 'Always 0 in retail; meaning unverified.', readOnly: true },
		featureSchemaHashes: { label: 'Feature schema hashes', description: 'Sound hashes of the FeatureSchema entities this voice class chains together (e.g. PlayerVoice + Panning + Pause).' },
	},
};

const RegistryVoiceSpec: RecordSchema = {
	name: 'RegistryVoiceSpec',
	description: 'VoiceSpec payload — a concrete voice the engine can allocate: its schema, channel layout, type, and the submix/master voices it sends into. The on-disk send count is re-derived from the list on write.',
	fields: {
		mpVoiceSchema: u32(),
		mu8ProcessingStage: u8(),
		mu8ChannelCount: u8(),
		mu8VoiceType: {
			kind: 'enum',
			storage: 'u8',
			values: [
				{ value: 0, label: 'Player', description: 'E_PLAYER_VOICE — plays content.' },
				{ value: 1, label: 'Submix', description: 'E_SUBMIX_VOICE — mixes other voices.' },
				{ value: 2, label: 'Master', description: 'E_MASTER_VOICE — the output bus.' },
			],
		},
		sendHashes: { kind: 'list', item: u32(), makeEmpty: () => 0 },
	},
	fieldMetadata: {
		mpVoiceSchema: { label: 'Voice schema hash', description: 'Name hash of the VoiceSchema entity describing this voice\'s DSP chain — possibly defined in a different registry (CSIS voice regs reference schemas from their entity regs).' },
		mu8ProcessingStage: { label: 'Processing stage', description: 'Bitmask-looking values in retail (0x00, 0x01, 0x3E, 0x3F, 0x7F, 0xBF, 0xF0); meaning unknown.' },
		mu8ChannelCount: { label: 'Channel count', description: '1 mono, 2 stereo, 4 quad, 6 = 5.1 (the values seen in retail).' },
		mu8VoiceType: { label: 'Voice type' },
		sendHashes: { label: 'Send hashes', description: 'Sound hashes of the voices this one feeds (submixes / the master voice).' },
	},
};

const RegistryAemsVoiceCsis: RecordSchema = {
	name: 'RegistryAemsVoiceCsis',
	description: 'AemsVoiceCsisClass payload (undocumented on the wiki) — binds a CSIS voice class to its AEMS bank content via an inline class label. The entity name is soundHash(\'AEMS_\' + label) in every retail instance and is re-derived when the label is edited.',
	fields: {
		mUnknown08: u32(),
		mUnknown0C: u16(),
		mUnknown10: u32(),
		mUnknown14: u32(),
		label: str(),
		_padTail: rawBytes(),
	},
	fieldMetadata: {
		mUnknown08: { label: 'Unknown +0x8', description: 'Small varying value (6–28 in retail); meaning unknown.' },
		mUnknown0C: { label: 'Unknown +0xC', description: '2 in every retail instance; meaning unknown.', readOnly: true },
		mUnknown10: { label: 'Unknown +0x10', description: 'Shared by all AemsVoiceCsisClass entities in the same registry — likely an AEMS bank id.' },
		mUnknown14: { label: 'Unknown +0x14', description: 'Distinct per entity; meaning unknown.' },
		label: { label: 'Class label', description: 'Inline CSIS class name (e.g. \'Skids\', \'class_horns\'). Editing it re-derives the entity name hash as soundHash(\'AEMS_\' + label); add the AEMS_-prefixed name to the string pool to keep tree labels readable.' },
		_padTail: {
			label: 'pad tail',
			description: 'Uninitialised 0–3 alignment bytes after the NUL (0xCD allocator fill in retail); preserved verbatim, recomputed when the label length changes.',
			hidden: true,
		},
	},
	label: (value, index) => {
		const label = (value as { label?: string }).label;
		return `#${index ?? 0} · ${label ?? '?'}`;
	},
};

const RegistryEntity: RecordSchema = {
	name: 'RegistryEntity',
	description: 'One registry entry: a name hash plus a typed payload. Exactly one payload field is populated, matching the type — ContentClass entities have none. The hash-table slot is re-derived from the name on write, so renaming is safe.',
	fields: {
		mName: u32(),
		mTypeName: u32(),
		mpContentClass: u32(),
		parameterSchema: record('RegistryParameterSchema'),
		featureSchema: record('RegistryFeatureSchema'),
		rwacFeature: record('RegistryRwacFeature'),
		contentSpec: record('RegistryContentSpec'),
		voiceSchema: record('RegistryVoiceSchema'),
		voiceSpec: record('RegistryVoiceSpec'),
		aemsVoiceCsis: record('RegistryAemsVoiceCsis'),
		_unknownPayload: rawBytes(),
	},
	fieldMetadata: {
		mName: {
			label: 'Name hash',
			description: 'Sound hash of the entity name. Compute new values with soundHash() — the hash is NOT case-folded. Add the plain-text name to the string pool so labels stay readable.',
		},
		mTypeName: {
			label: 'Type hash',
			description: 'Sound hash of the type name (~ContentClass~, ~ParameterSchema~, …). Read-only because the payload shape must match it byte-for-byte.',
			readOnly: true,
		},
		mpContentClass: {
			label: 'Content class hash',
			description: 'ContentType / SlotSchema payload only: name hash of the ContentClass entity this one points at. Empty for other entity kinds.',
		},
		parameterSchema: { label: 'Parameter schema', description: 'Populated only on ParameterSchema entities.' },
		featureSchema: { label: 'Feature schema', description: 'Populated only on FeatureSchema entities.' },
		rwacFeature: { label: 'RWAC feature', description: 'Populated only on GenericRwacFeatureImplementation entities.' },
		contentSpec: { label: 'Content spec', description: 'Populated only on ContentSpec entities.' },
		voiceSchema: { label: 'Voice schema', description: 'Populated only on VoiceSchema entities.' },
		voiceSpec: { label: 'Voice spec', description: 'Populated only on VoiceSpec entities.' },
		aemsVoiceCsis: { label: 'AEMS CSIS class', description: 'Populated only on AemsVoiceCsisClass entities. Editing its label re-derives this entity\'s name hash.' },
		_unknownPayload: {
			label: 'Unknown payload',
			description: 'Verbatim payload bytes for entity types this build does not decode; preserved for byte-exact round-trip. All nine retail type names decode, so this only appears on modded data.',
			hidden: true,
		},
	},
	propertyGroups: [
		{ title: 'Identity', properties: ['mName', 'mTypeName'] },
		{ title: 'Payload', properties: ['mpContentClass', 'parameterSchema', 'featureSchema', 'rwacFeature', 'contentSpec', 'voiceSchema', 'voiceSpec', 'aemsVoiceCsis'] },
	],
	label: (value, index, ctx) => entityLabel(value, index ?? 0, ctx.root),
	// Retail invariant (12/12 instances): an AemsVoiceCsisClass entity is
	// registered under soundHash('AEMS_' + label), so a label edit must move
	// the entity's hash-table identity with it.
	derive: (prev, next) => {
		const prevLabel = (prev.aemsVoiceCsis as { label?: string } | null)?.label;
		const nextLabel = (next.aemsVoiceCsis as { label?: string } | null)?.label;
		if (nextLabel != null && nextLabel !== prevLabel) {
			return { mName: soundHash('AEMS_' + nextLabel) };
		}
		return {};
	},
};

const ParsedRegistry: RecordSchema = {
	name: 'ParsedRegistry',
	description: 'Root record for the Registry resource (0xA000): the sound engine\'s name-hash phone book. The open-addressed hash table, counts, sizes, and pointers are all re-derived on write — only the entities and the debug string pool are real data.',
	fields: {
		entities: {
			kind: 'list',
			item: record('RegistryEntity'),
			itemLabel: (item, index, ctx) => entityLabel(item, index, ctx.root),
			makeEmpty: () => makeEmptyRegistryEntity(),
		},
		strings: {
			kind: 'list',
			item: str(),
			makeEmpty: () => '',
		},
		mu32EntityCapacity: u32(),
		muNameHashMask: u32(),
	},
	fieldMetadata: {
		entities: {
			label: 'Entities',
			description: 'All registry entries in disk (hash-table insertion) order. Order matters only for collision tie-breaks in the rebuilt table; adding and removing is safe.',
		},
		strings: {
			label: 'String pool',
			description: 'Debug reverse-lookup pool: the plain-text names behind the hashes. The game does not need it to resolve entities, but steward\'s labels do — keep it in sync when renaming.',
		},
		mu32EntityCapacity: {
			label: 'Table capacity',
			description: 'Hash-table slot count (0x800 in retail). Read-only: must stay a power of two with mask = capacity - 1.',
			readOnly: true,
		},
		muNameHashMask: {
			label: 'Name hash mask',
			description: 'Always capacity - 1; the writer rejects anything else.',
			readOnly: true,
		},
	},
	propertyGroups: [
		{ title: 'Entities', properties: ['entities'] },
		{ title: 'Strings', properties: ['strings'] },
		{ title: 'Hash table', properties: ['mu32EntityCapacity', 'muNameHashMask'] },
	],
};

// ---------------------------------------------------------------------------
// Registry export
// ---------------------------------------------------------------------------

const registry: SchemaRegistry = {
	ParsedRegistry,
	RegistryEntity,
	RegistryParameterSchema,
	RegistryFeatureSchema,
	RegistryRwacFeature,
	RegistryContentSpec,
	RegistryVoiceSchema,
	RegistryVoiceSpec,
	RegistryAemsVoiceCsis,
	RwacDspBlock,
	RwacParamBinding,
	RwacSlotBinding,
};

export const registryResourceSchema: ResourceSchema = {
	key: 'registry',
	name: 'Registry',
	rootType: 'ParsedRegistry',
	registry,
};
