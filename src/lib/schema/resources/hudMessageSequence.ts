// Hand-written schema for ParsedHudMessageSequence (resource type 0x2E).
//
// Mirrors the types in `src/lib/core/hudMessageSequences.ts`. Keep these in
// lockstep with the parser/writer — any field added to the parser needs a
// matching entry here, or the schema walker reports it as drift.
//
// Domain: a sequence is an ordered set of HUD message CgsIDs displayed one
// after another, each with its own duration. The on-disk struct has a FIXED
// 8-slot message array; the parser only surfaces the active miMessageCount
// slots, so this list caps at 8 and the writer regenerates the default
// pattern for the rest. mSequenceIdHash is derived data — every retail hash
// equals encodeCgsId(macSequenceId.toUpperCase()) — so it is read-only here
// and a `derive` hook keeps it in sync when the name is edited.

import type {
	FieldSchema,
	RecordSchema,
	ResourceSchema,
	SchemaRegistry,
} from '../types';
import {
	HUD_MESSAGE_PARAM_TYPES,
	DEFAULT_MESSAGE_LENGTH_SECONDS,
	MAX_NAME_CHARS,
	SEQUENCE_MESSAGE_SLOTS,
	SEQUENCE_PARAM_SLOTS,
} from '@/lib/core/hudMessageSequences';
import { decodeCgsId, encodeCgsId } from '@/lib/core/cgsid';

// ---------------------------------------------------------------------------
// Local helpers (mirroring staticSoundMap.ts)
// ---------------------------------------------------------------------------

const i32 = (): FieldSchema => ({ kind: 'i32' });
const u8 = (): FieldSchema => ({ kind: 'u8' });
const u32 = (): FieldSchema => ({ kind: 'u32' });
const f32 = (): FieldSchema => ({ kind: 'f32' });
const str = (): FieldSchema => ({ kind: 'string' });
const cgsId = (): FieldSchema => ({ kind: 'bigint', bytes: 8, hex: true });

const fixedList = (item: FieldSchema, length: number): FieldSchema => ({
	kind: 'list',
	item,
	addable: false,
	removable: false,
	minLength: length,
	maxLength: length,
});

const paramTypeEnum = (): FieldSchema => ({
	kind: 'enum',
	storage: 'i32',
	values: HUD_MESSAGE_PARAM_TYPES.map((p) => ({ value: p.value, label: p.label })),
});

// ---------------------------------------------------------------------------
// Tree-label helpers
// ---------------------------------------------------------------------------

function messageLabel(msg: unknown, index: number): string {
	try {
		if (!msg || typeof msg !== 'object') return `#${index}`;
		const m = msg as { mMessageId?: bigint; mfMessageLength?: number };
		const id = m.mMessageId != null ? decodeCgsId(m.mMessageId) : '';
		const len = m.mfMessageLength != null ? `${m.mfMessageLength}s` : '?';
		return `#${index} · ${id || '(no id)'} · ${len}`;
	} catch {
		return `#${index}`;
	}
}

// ---------------------------------------------------------------------------
// Record schemas
// ---------------------------------------------------------------------------

const HudMessageSequenceMessage: RecordSchema = {
	name: 'HudMessageSequenceMessage',
	description: 'One step of the sequence — a HUD message CgsID and how long it stays on screen. Retail never passes params: every id is -1.',
	fields: {
		mMessageId: cgsId(),
		mfMessageLength: f32(),
		maiParam1Ids: fixedList(i32(), 4),
		maiParam2Ids: fixedList(i32(), 4),
		_pad2C: u32(),
	},
	fieldMetadata: {
		mMessageId: {
			label: 'Message ID',
			description: 'CgsID of the HUD Message to display — the uppercase-folded hash of the message name (e.g. DTARMING). Resolved against the HUD Message resources, not this bundle.',
		},
		mfMessageLength: {
			label: 'Display time',
			description: `Time to display the message in seconds. Retail always uses ${DEFAULT_MESSAGE_LENGTH_SECONDS}.`,
		},
		maiParam1Ids: {
			label: 'Param IDs 1',
			description: 'Parameter IDs 1 — always -1 (unused) in retail.',
		},
		maiParam2Ids: {
			label: 'Param IDs 2',
			description: 'Parameter IDs 2 — always -1 (unused) in retail.',
		},
		_pad2C: {
			label: 'pad +0x2C',
			description: 'Record pad (0 in retail); preserved verbatim.',
			hidden: true,
		},
	},
	propertyGroups: [
		{ title: 'Message', properties: ['mMessageId', 'mfMessageLength'] },
		{ title: 'Parameters', properties: ['maiParam1Ids', 'maiParam2Ids'] },
	],
	label: (value, index) => messageLabel(value, index ?? 0),
};

const ParsedHudMessageSequence: RecordSchema = {
	name: 'ParsedHudMessageSequence',
	description: 'Root record for the HUD Message Sequence resource (0x2E): an ordered set of HUD message IDs shown back-to-back. A dev-era feature — the six retail sequences are all online Dirty Tricks arming flows.',
	fields: {
		mSequenceIdHash: cgsId(),
		macSequenceId: str(),
		miPriority: i32(),
		miParamCount: i32(),
		maeParams: fixedList(paramTypeEnum(), SEQUENCE_PARAM_SLOTS),
		messages: {
			kind: 'list',
			item: { kind: 'record', type: 'HudMessageSequenceMessage' },
			addable: true,
			removable: true,
			maxLength: SEQUENCE_MESSAGE_SLOTS,
			makeEmpty: () => ({
				mMessageId: 0n,
				mfMessageLength: DEFAULT_MESSAGE_LENGTH_SECONDS,
				maiParam1Ids: [-1, -1, -1, -1],
				maiParam2Ids: [-1, -1, -1, -1],
				_pad2C: 0,
			}),
			itemLabel: (item, index) => messageLabel(item, index),
		},
		_pad15: fixedList(u8(), 3),
	},
	fieldMetadata: {
		mSequenceIdHash: {
			label: 'Sequence ID hash',
			description: 'CgsID of the sequence — derived: encodeCgsId(name.toUpperCase()) in every retail resource. Kept in sync automatically when the name is edited.',
			readOnly: true,
			derivedFrom: 'macSequenceId',
		},
		macSequenceId: {
			label: 'Sequence name',
			description: `Sequence name, max ${MAX_NAME_CHARS} chars (char[13] on disk). The dictionary (0x2F) references sequences by this exact string — renaming here without updating the dictionary orphans the sequence.`,
		},
		miPriority: {
			label: 'Priority',
			description: 'Sequence priority. Always 1 in retail.',
		},
		miParamCount: {
			label: 'Param count',
			description: 'Number of used maeParams slots. Always 0 in retail — sequences pass no parameters.',
		},
		maeParams: {
			label: 'Param types',
			description: 'HudMessageParamTypes[8] — fixed on-disk array. All Unused in retail.',
		},
		messages: {
			label: 'Messages',
			description: `The messages shown in order. The on-disk array is fixed at ${SEQUENCE_MESSAGE_SLOTS} slots — the writer fills unused slots with the default pattern (no id, ${DEFAULT_MESSAGE_LENGTH_SECONDS} s, params -1).`,
		},
		_pad15: {
			label: 'pad +0x15',
			description: 'Name-field alignment pad (0 in retail); preserved verbatim.',
			hidden: true,
		},
	},
	propertyGroups: [
		{ title: 'Identity', properties: ['macSequenceId', 'mSequenceIdHash', 'miPriority'] },
		{ title: 'Messages', properties: ['messages'] },
		{ title: 'Parameters', properties: ['miParamCount', 'maeParams'] },
	],
	label: (value) => {
		const name = (value as { macSequenceId?: string }).macSequenceId;
		return typeof name === 'string' && name.length > 0 ? name : 'HudMessageSequence';
	},
	derive: (prev, next) => {
		if (prev.macSequenceId === next.macSequenceId) return {};
		const name = typeof next.macSequenceId === 'string' ? next.macSequenceId : '';
		// encodeCgsId throws beyond 12 chars; leave the hash alone then — the
		// writer rejects the over-long name anyway, with a clearer message.
		try {
			return { mSequenceIdHash: encodeCgsId(name.toUpperCase()) };
		} catch {
			return {};
		}
	},
};

// ---------------------------------------------------------------------------
// Registry export
// ---------------------------------------------------------------------------

const registry: SchemaRegistry = {
	ParsedHudMessageSequence,
	HudMessageSequenceMessage,
};

export const hudMessageSequenceResourceSchema: ResourceSchema = {
	key: 'hudMessageSequence',
	name: 'HUD Message Sequence',
	rootType: 'ParsedHudMessageSequence',
	registry,
};
