// Schema for ICE Data (resource type 0x1000D) — one standalone camera take.
//
// Mirrors the model in `src/lib/core/iceData.ts`:
//   ParsedIceData { take: IceTake, trailing?: Uint8Array }
//
// ICE Data is the early-development standalone form of a single ICETakeData —
// the exact structure the ICE Take Dictionary (0x41) wraps many of. So the take
// record schema is shared verbatim from the dictionary schema's registry
// (IceTake + its IceElementCount dependency); keeping one definition means the
// take's editable surface — guid/name/length editable; node/allocated/counts/
// indices/parameters/pad read-only-or-hidden; the 48 keyframed channels via the
// `iceTakeChannels` custom field — stays in lockstep across both resource types.
//
// `trailing` is any tail padding after the take payload, re-emitted verbatim for
// byte-exactness — hidden and read-only.

import type {
	RecordSchema,
	ResourceSchema,
	SchemaRegistry,
} from '../types';
import { iceTakeDictionaryResourceSchema } from './iceTakeDictionary';

// Reuse the dictionary's take record schemas so the two resource types share a
// single source of truth for the take layout and field metadata.
const IceTake = iceTakeDictionaryResourceSchema.registry.IceTake;
const IceElementCount = iceTakeDictionaryResourceSchema.registry.IceElementCount;

function takeLabel(take: unknown): string {
	if (!take || typeof take !== 'object') return 'ICE Data';
	const t = take as { name?: string; guid?: number; lengthSeconds?: number };
	const name = t.name && t.name.length > 0 ? t.name : t.guid != null ? `guid ${t.guid}` : '?';
	const dur = typeof t.lengthSeconds === 'number' ? t.lengthSeconds.toFixed(2) : '?';
	return `${name} · ${dur}s`;
}

const ParsedIceData: RecordSchema = {
	name: 'ParsedIceData',
	description:
		'Root record for the ICE Data resource (0x1000D): a single camera take. An early-development type superseded by the ICE Take Dictionary (0x41).',
	fields: {
		take: { kind: 'record', type: 'IceTake' },
		// Tail padding after the take payload, preserved verbatim. Modelled as a
		// byte list but hidden — not user-editable.
		trailing: { kind: 'list', item: { kind: 'u8' }, addable: false, removable: false },
	},
	fieldMetadata: {
		take: { label: 'Take' },
		trailing: {
			label: 'Trailing bytes',
			description: 'Tail padding after the take payload. Re-emitted verbatim for byte-exact round-trip.',
			hidden: true,
			readOnly: true,
		},
	},
	label: (value) => {
		const v = value as { take?: unknown } | undefined;
		return takeLabel(v?.take);
	},
	propertyGroups: [{ title: 'Take', properties: ['take'] }],
};

const registry: SchemaRegistry = {
	ParsedIceData,
	IceTake,
	IceElementCount,
};

export const iceDataResourceSchema: ResourceSchema = {
	key: 'iceData',
	name: 'ICE Data',
	rootType: 'ParsedIceData',
	registry,
};
