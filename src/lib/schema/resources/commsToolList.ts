// Hand-written schema for ParsedCommsToolList (resource type 0x46).
//
// Mirrors the types in `src/lib/core/commsToolList.ts`. Keep these in
// lockstep with the parser/writer — any field added to the parser needs a
// matching entry here, or the schema walker reports it as drift.
//
// Domain: a Comms Tool List carries the actual server-pushed tuning values
// of the Comms Database. Its payload is OPAQUE in isolation — the field
// names, offsets, and sizes live in a Comms Tool List Definition (0x45)
// resource in a different bundle (GAMEPLAYDATA.BIN's payload is keyed by
// GAMEPLAY.BIN's definition), referenced by matching name/version hashes.
// Until steward grows a cross-resource editor (the decode mechanism already
// exists: decodeCommsToolListData in src/lib/core/commsToolList.ts), the
// payload is surfaced as raw bytes.

import type {
	FieldSchema,
	RecordSchema,
	ResourceSchema,
} from '../types';
import { resolveCommsToolName } from '@/lib/core/commsToolNames';

const u32 = (): FieldSchema => ({ kind: 'u32' });
const rawBytes = (): FieldSchema => ({ kind: 'custom', component: 'rawBytes' });

export function nameHashLabel(hash: number): string {
	return resolveCommsToolName(hash) ?? `0x${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

const ParsedCommsToolList: RecordSchema = {
	name: 'ParsedCommsToolList',
	description: 'Root record for a Comms Tool List (0x46): the value payload of the Comms Database, decodable only through the Comms Tool List Definition (0x45) whose name/version hashes match. Retail pushes these to the DOWNLOADED folder for live gameplay tuning.',
	fields: {
		mNameHash: u32(),
		mVersionHash: u32(),
		data: rawBytes(),
	},
	fieldMetadata: {
		mNameHash: {
			label: 'Name hash',
			description: 'Language hash naming this list. In the retail DOWNLOADED pair it equals the DEFINITION\'s name hash (Gameplay, 0x0E31492C) rather than the resource\'s own debug name — it is how the list finds its field schema.',
		},
		mVersionHash: {
			label: 'Version hash',
			description: 'Must match the version hash of the definition this list is decoded against; the game (and steward\'s decoder) refuse mismatched pairs.',
		},
		data: {
			label: 'Value payload',
			description: 'The raw tuning values. Field names/offsets/sizes live in the sibling definition resource (another bundle), so steward shows bytes; the payload length must equal the definition\'s declared list data length.',
		},
	},
	propertyGroups: [
		{ title: 'Identity', properties: ['mNameHash', 'mVersionHash'] },
		{ title: 'Payload', properties: ['data'] },
	],
};

export const commsToolListResourceSchema: ResourceSchema = {
	key: 'commsToolList',
	name: 'Comms Tool List',
	rootType: 'ParsedCommsToolList',
	registry: {
		ParsedCommsToolList,
	},
};
