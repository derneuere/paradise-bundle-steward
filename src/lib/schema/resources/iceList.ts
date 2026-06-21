// Hand-written schema for ParsedIceList (resource type 0x1000C).
//
// Mirrors the types in `src/lib/core/iceList.ts`. Keep these in lockstep with
// the parser/writer — any field added to the parser needs a matching entry
// here, or the schema walker reports it as drift.
//
// Domain: an ICE List is an early-development list of camera-movie IDs. Each
// entry is a single CgsID (an 8-byte id), so the editable surface is just an
// add/removable list of movie IDs. The wiki documents this as the predecessor
// of the ICE Take Dictionary (0x41). muPadding is trailing header padding that
// is re-emitted verbatim, so it is hidden and read-only.

import type {
	FieldSchema,
	RecordSchema,
	ResourceSchema,
	SchemaRegistry,
} from '../types';

// ---------------------------------------------------------------------------
// Local helpers (mirroring idList.ts)
// ---------------------------------------------------------------------------

const cgsId = (): FieldSchema => ({ kind: 'bigint', bytes: 8, hex: true });

// ---------------------------------------------------------------------------
// Tree-label helpers
// ---------------------------------------------------------------------------

function movieIdLabel(item: unknown, index: number): string {
	try {
		return typeof item === 'bigint'
			? `#${index} · 0x${item.toString(16).toUpperCase().padStart(16, '0')}`
			: `#${index}`;
	} catch {
		return `#${index}`;
	}
}

// ---------------------------------------------------------------------------
// Root + registry export
// ---------------------------------------------------------------------------

const ParsedIceList: RecordSchema = {
	name: 'ParsedIceList',
	description: 'Root record for the ICE List resource (0x1000C): a list of camera-movie IDs. An early-development type superseded by the ICE Take Dictionary (0x41).',
	fields: {
		entries: {
			kind: 'list',
			item: cgsId(),
			addable: true,
			removable: true,
			makeEmpty: () => 0n,
			itemLabel: (item, index) => movieIdLabel(item, index),
		},
		muPadding: { kind: 'bigint', bytes: 8, hex: true },
	},
	fieldMetadata: {
		entries: {
			label: 'Movie IDs',
			description: 'The camera-movie IDs in this list. Each entry is a CgsID (an 8-byte id).',
		},
		muPadding: {
			label: 'Padding',
			description: 'Trailing header padding (u64). Re-emitted verbatim for byte-exact round-trip; not user-editable.',
			hidden: true,
			readOnly: true,
		},
	},
	propertyGroups: [
		{ title: 'Movie IDs', properties: ['entries'] },
	],
};

const registry: SchemaRegistry = {
	ParsedIceList,
};

export const iceListResourceSchema: ResourceSchema = {
	key: 'iceList',
	name: 'ICE List',
	rootType: 'ParsedIceList',
	registry,
};
