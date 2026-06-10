// Hand-written schema for ParsedIdList (resource type 0x25).
//
// Mirrors the types in `src/lib/core/idList.ts`. Keep these in lockstep with
// the parser/writer — any field added to the parser needs a matching entry
// here, or the schema walker reports it as drift.
//
// Domain: one IdList per track unit in the collision bundle, listing the
// unit's collision resource ids. Every retail IdList holds exactly one id —
// the sibling PolygonSoupList (TRK_COL_<N>) in the same bundle — so the type
// is redundant in practice, but the engine still reads the count, so the
// list stays editable.

import type {
	FieldSchema,
	RecordSchema,
	ResourceSchema,
	SchemaRegistry,
} from '../types';

// ---------------------------------------------------------------------------
// Local helpers (mirroring staticSoundMap.ts)
// ---------------------------------------------------------------------------

const resourceId = (): FieldSchema => ({ kind: 'bigint', bytes: 8, hex: true });
const rawBytes = (): FieldSchema => ({ kind: 'custom', component: 'rawBytes' });

// ---------------------------------------------------------------------------
// Tree-label helpers
// ---------------------------------------------------------------------------

function idLabel(item: unknown, index: number): string {
	try {
		return typeof item === 'bigint'
			? `#${index} · 0x${item.toString(16).toUpperCase().padStart(8, '0')}`
			: `#${index}`;
	} catch {
		return `#${index}`;
	}
}

// ---------------------------------------------------------------------------
// Root + registry export
// ---------------------------------------------------------------------------

const ParsedIdList: RecordSchema = {
	name: 'ParsedIdList',
	description: 'Root record for the IdList resource (0x25): the collision resource ids for one track unit. Retail always lists exactly the sibling PolygonSoupList (TRK_COL_<N>) in the same bundle.',
	fields: {
		ids: {
			kind: 'list',
			item: resourceId(),
			addable: true,
			removable: true,
			makeEmpty: () => 0n,
			itemLabel: (item, index) => idLabel(item, index),
		},
		_pad08: rawBytes(),
		_trailingPad: rawBytes(),
	},
	fieldMetadata: {
		ids: {
			label: 'Resource IDs',
			description: 'Resource ids (u64) of this track unit\'s collision resources — ids of resources in the SAME bundle, not CgsID name hashes. Pointing one at a missing resource breaks the unit\'s collision at load.',
		},
		_pad08: {
			label: 'pad +0x08',
			description: 'Header pad — uninitialised bundler heap memory in every retail resource, NOT zeros; preserved verbatim for byte-exact round-trip.',
			hidden: true,
		},
		_trailingPad: {
			label: 'Trailing pad',
			description: 'Pad after the last id (8 bytes in retail; garbage in TRK_CLIL99); preserved verbatim.',
			hidden: true,
		},
	},
	propertyGroups: [
		{ title: 'Collision resources', properties: ['ids'] },
	],
};

const registry: SchemaRegistry = {
	ParsedIdList,
};

export const idListResourceSchema: ResourceSchema = {
	key: 'idList',
	name: 'ID List',
	rootType: 'ParsedIdList',
	registry,
};
