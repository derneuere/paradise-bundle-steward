// Hand-written schema for ParsedHudMessageSequenceDictionary (resource type
// 0x2F). Mirrors the types in `src/lib/core/hudMessageSequences.ts` — keep in
// lockstep with the parser/writer or the schema walker reports drift.
//
// Domain: the dictionary is the game's index of HUD Message Sequences. Each
// entry is the macSequenceId string of one 0x2E resource in the same bundle
// (set equality holds in retail) — sequences are referenced BY NAME, so an
// entry without a matching sequence (or vice versa) is orphaned at runtime.

import type {
	FieldSchema,
	RecordSchema,
	ResourceSchema,
	SchemaRegistry,
} from '../types';
import { MAX_NAME_CHARS } from '@/lib/core/hudMessageSequences';

const u32 = (): FieldSchema => ({ kind: 'u32' });

function nameLabel(item: unknown, index: number): string {
	return typeof item === 'string' && item.length > 0 ? `#${index} · ${item}` : `#${index} · (empty)`;
}

const ParsedHudMessageSequenceDictionary: RecordSchema = {
	name: 'ParsedHudMessageSequenceDictionary',
	description: 'Root record for the HUD Message Sequence Dictionary resource (0x2F): the name list enumerating every HUD Message Sequence (0x2E) in the bundle. Same on-disk shape as the HUD Message List.',
	fields: {
		sequenceNames: {
			kind: 'list',
			item: { kind: 'string' },
			addable: true,
			removable: true,
			makeEmpty: () => 'NewSequence',
			itemLabel: (item, index) => nameLabel(item, index),
		},
		_pad0C: u32(),
	},
	fieldMetadata: {
		sequenceNames: {
			label: 'Sequence names',
			description: `Each entry must equal the macSequenceId of a sequence in the bundle — the game resolves sequences by this exact string. Max ${MAX_NAME_CHARS} chars (char[13] on disk).`,
		},
		_pad0C: {
			label: 'pad +0x0C',
			description: 'Undocumented header pad before the name-pointer array (0 in retail); preserved verbatim.',
			hidden: true,
		},
	},
	propertyGroups: [
		{ title: 'Sequences', properties: ['sequenceNames'] },
	],
};

const registry: SchemaRegistry = {
	ParsedHudMessageSequenceDictionary,
};

export const hudMessageSequenceDictionaryResourceSchema: ResourceSchema = {
	key: 'hudMessageSequenceDictionary',
	name: 'HUD Message Sequence Dictionary',
	rootType: 'ParsedHudMessageSequenceDictionary',
	registry,
};
