// Hand-written schema for ParsedCommsToolListDefinition (resource type 0x45).
//
// Mirrors the types in `src/lib/core/commsToolListDefinition.ts`. Keep these
// in lockstep with the parser/writer — any field added to the parser needs a
// matching entry here, or the schema walker reports it as drift.
//
// Domain: a definition is the field schema of the Comms Database — Burnout's
// server-pushed gameplay tuning (the DOWNLOADED folder). It names each
// tunable value (by Language hash; the strings live in the executable) and
// fixes its byte offset inside the Comms Tool List (0x46) payloads that
// reference this definition by matching name/version hashes. Field sizes are
// NOT stored: a field runs from its offset to the next-higher offset (the
// last one to the payload end), so the list data length is load-bearing.
//
// Adding/removing fields is disabled in the UI: sibling 0x46 resources live
// in OTHER bundles, so steward cannot keep their payloads in sync with a
// reshaped field table. The writer itself supports count changes (used by
// the stress scenarios); only the editor affordance is locked.

import type {
	FieldSchema,
	RecordSchema,
	ResourceSchema,
} from '../types';
import { COMMS_VERSION_HASH_NOTES } from '@/lib/core/commsToolListDefinition';
import { resolveCommsToolName } from '@/lib/core/commsToolNames';

// ---------------------------------------------------------------------------
// Local helpers (mirroring staticSoundMap.ts)
// ---------------------------------------------------------------------------

const u32 = (): FieldSchema => ({ kind: 'u32' });
const record = (type: string): FieldSchema => ({ kind: 'record', type });

// ---------------------------------------------------------------------------
// Tree-label helpers
// ---------------------------------------------------------------------------

export function hashLabel(hash: number): string {
	return resolveCommsToolName(hash) ?? `0x${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function fieldDefLabel(value: unknown, index: number): string {
	try {
		if (!value || typeof value !== 'object') return `#${index}`;
		const f = value as { mFieldNameHash?: number; mCategoryNameHash?: number; mOffset?: number };
		const name = f.mFieldNameHash != null ? hashLabel(f.mFieldNameHash) : '?';
		const cat = f.mCategoryNameHash != null ? hashLabel(f.mCategoryNameHash) : '?';
		const off = f.mOffset != null ? `+0x${f.mOffset.toString(16)}` : '?';
		return `#${index} · ${cat} · ${name} · ${off}`;
	} catch {
		return `#${index}`;
	}
}

// ---------------------------------------------------------------------------
// Record schemas
// ---------------------------------------------------------------------------

const CommsToolFieldDefinition: RecordSchema = {
	name: 'CommsToolFieldDefinition',
	description: 'One tunable value: its name and category (as Language hashes of strings in the executable) and its byte offset inside the Comms Tool List payload. Its size is the gap to the next-higher offset.',
	fields: {
		mUnknownHash: u32(),
		mCategoryNameHash: u32(),
		mFieldNameHash: u32(),
		mOffset: u32(),
	},
	fieldMetadata: {
		mUnknownHash: {
			label: 'Unknown hash',
			description: 'Per-field hash of unknown derivation — matches the wiki\'s "Unknown" column but is NOT the Language hash of the field or category name. Preserved verbatim.',
			readOnly: true,
		},
		mCategoryNameHash: {
			label: 'Category hash',
			description: 'Language hash (JAMCRC) of the category name — e.g. ServerControls, TakedownPhysics, Wheelie. Steward resolves wiki-known names in the tree label.',
		},
		mFieldNameHash: {
			label: 'Field name hash',
			description: 'Language hash (JAMCRC) of the field name the game looks this value up by — e.g. TEMP_EXTRA_CAR_36, SLAM_RECOVERY_TIMES_NETWORK.',
		},
		mOffset: {
			label: 'Payload offset',
			description: 'Byte offset of this field\'s value inside the Comms Tool List data payload. Must stay below the list data length. Moving it changes where the game reads — the sibling list\'s bytes do not move with it.',
		},
	},
	propertyGroups: [
		{ title: 'Identity', properties: ['mFieldNameHash', 'mCategoryNameHash', 'mUnknownHash'] },
		{ title: 'Layout', properties: ['mOffset'] },
	],
	label: (value, index) => fieldDefLabel(value, index ?? 0),
};

// ---------------------------------------------------------------------------
// Root + registry export
// ---------------------------------------------------------------------------

const ParsedCommsToolListDefinition: RecordSchema = {
	name: 'ParsedCommsToolListDefinition',
	description: 'Root record for a Comms Tool List Definition (0x45): the field schema that gives a Comms Tool List (0x46) payload its meaning. Lists in other bundles reference this definition by matching name and version hashes.',
	fields: {
		mDefinitionNameHash: u32(),
		mVersionHash: u32(),
		mListDataLength: u32(),
		fields: {
			kind: 'list',
			item: record('CommsToolFieldDefinition'),
			addable: false,
			removable: false,
			itemLabel: (item, index) => fieldDefLabel(item, index),
		},
	},
	fieldMetadata: {
		mDefinitionNameHash: {
			label: 'Definition name hash',
			description: 'Language hash of the definition name — retail uses Gameplay (0x0E31492C), Car, Motorbike, and PassThePadDef. Sibling lists carry the same hash; changing it orphans them.',
		},
		mVersionHash: {
			label: 'Version hash',
			description: `Opaque version id (its derivation is unknown). A Comms Tool List only decodes against a definition whose version hash matches. Known retail values: ${Object.entries(COMMS_VERSION_HASH_NOTES).map(([v, note]) => `0x${Number(v).toString(16).toUpperCase()} = ${note}`).join('; ')}.`,
		},
		mListDataLength: {
			label: 'List data length',
			description: 'Byte size of the data payload in every Comms Tool List using this definition. Also fixes the LAST field\'s size (sizes are offset gaps). Sibling lists in other bundles must carry a payload of exactly this length.',
		},
		fields: {
			label: 'Fields',
			description: 'The tunable values, stored on disk as four parallel hash/offset chunks. Add/remove is disabled: the value payloads live in other bundles and would desync.',
		},
	},
	propertyGroups: [
		{ title: 'Identity', properties: ['mDefinitionNameHash', 'mVersionHash', 'mListDataLength'] },
		{ title: 'Fields', properties: ['fields'] },
	],
};

export const commsToolListDefinitionResourceSchema: ResourceSchema = {
	key: 'commsToolListDefinition',
	name: 'Comms Tool List Definition',
	rootType: 'ParsedCommsToolListDefinition',
	registry: {
		ParsedCommsToolListDefinition,
		CommsToolFieldDefinition,
	},
};
