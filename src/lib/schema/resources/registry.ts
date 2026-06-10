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
		_unknownPayload: {
			label: 'Unknown payload',
			description: 'Verbatim payload bytes for entity types this build does not decode (ContentSpec, VoiceSchema, VoiceSpec, …); preserved for byte-exact round-trip.',
			hidden: true,
		},
	},
	propertyGroups: [
		{ title: 'Identity', properties: ['mName', 'mTypeName'] },
		{ title: 'Payload', properties: ['mpContentClass', 'parameterSchema', 'featureSchema', 'rwacFeature'] },
	],
	label: (value, index, ctx) => entityLabel(value, index ?? 0, ctx.root),
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
