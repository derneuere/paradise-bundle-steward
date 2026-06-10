// Hand-written schema for ParsedHudMessage (resource type 0x2C).
//
// Mirrors the types in `src/lib/core/hudMessage.ts`. Keep these in lockstep
// with the parser/writer — any field added to the parser needs a matching
// entry here, or the schema walker reports it as drift.
//
// Domain: the single retail HUD message catalogue (HUDMESSAGES.HM). Each
// message has up to three lines; a line's string id is a SYMBOLIC reference
// into the Language (0x27) string table ('HUDMESSAGE_GENERIC1' → the
// translated text), so renaming an id here without a matching Language entry
// silently blanks the line in game. mMessageIdHash is derived — it must
// equal encodeCgsId(macMessageId.toUpperCase()) (verified across all 308
// retail records) because the game fires messages by the hash; the derive
// hook below keeps the pair in sync on rename.

import type {
	FieldSchema,
	RecordSchema,
	ResourceSchema,
	SchemaRegistry,
	ValidationResult,
} from '../types';
import {
	HUD_MESSAGE_AVAILABILITY_FLAGS,
	HUD_MESSAGE_GROUPS,
	HUD_MESSAGE_PARAM_TYPES,
	HUD_MESSAGE_LINES,
	HUD_MESSAGE_PARAMS_PER_LINE,
	type HudMessage,
	type HudMessageLine,
} from '@/lib/core/hudMessage';
import { encodeCgsId } from '@/lib/core/cgsid';

// ---------------------------------------------------------------------------
// Local helpers (mirroring staticSoundMap.ts / propPhysics.ts)
// ---------------------------------------------------------------------------

const f32 = (min?: number, max?: number): FieldSchema => ({ kind: 'f32', min, max });
const i32 = (min?: number, max?: number): FieldSchema => ({ kind: 'i32', min, max });
const u8 = (): FieldSchema => ({ kind: 'u8' });
const u32 = (): FieldSchema => ({ kind: 'u32' });
const str = (): FieldSchema => ({ kind: 'string' });
const cgsId = (): FieldSchema => ({ kind: 'bigint', bytes: 8, hex: true });
const record = (type: string): FieldSchema => ({ kind: 'record', type });

const groupEnum = (): FieldSchema => ({
	kind: 'enum',
	storage: 'i32',
	values: HUD_MESSAGE_GROUPS.map((g) => ({ value: g.value, label: g.label })),
});

const availabilityFlags = (): FieldSchema => ({
	kind: 'flags',
	storage: 'u32',
	bits: HUD_MESSAGE_AVAILABILITY_FLAGS.map((f) => ({ mask: f.mask, label: f.label, description: f.description })),
});

const paramTypesList = (): FieldSchema => ({
	kind: 'list',
	item: {
		kind: 'enum',
		storage: 'u32',
		values: HUD_MESSAGE_PARAM_TYPES.map((p) => ({ value: p.value, label: p.label })),
	},
	addable: false,
	removable: false,
	minLength: HUD_MESSAGE_PARAMS_PER_LINE,
	maxLength: HUD_MESSAGE_PARAMS_PER_LINE,
	itemLabel: (item, index) => `slot ${index} · ${paramTypeName(item)}`,
});

const fixedList = (item: FieldSchema, n: number): FieldSchema => ({
	kind: 'list',
	item,
	addable: false,
	removable: false,
	minLength: n,
	maxLength: n,
});

// ---------------------------------------------------------------------------
// Tree-label helpers
// ---------------------------------------------------------------------------

export function paramTypeName(value: unknown): string {
	const entry = HUD_MESSAGE_PARAM_TYPES.find((p) => p.value === value);
	return entry ? entry.label : `?${value}`;
}

function lineLabel(line: unknown, index: number): string {
	try {
		if (!line || typeof line !== 'object') return `#${index}`;
		const l = line as Partial<HudMessageLine>;
		if (!l.macStringId) return `#${index} · (unused)`;
		const params = (l.miParamCount ?? 0) > 0 ? ` · ${l.miParamCount} param${l.miParamCount === 1 ? '' : 's'}` : '';
		return `#${index} · ${l.macStringId}${params}`;
	} catch {
		return `#${index}`;
	}
}

function messageLabel(msg: unknown, index: number): string {
	try {
		if (!msg || typeof msg !== 'object') return `#${index}`;
		const m = msg as Partial<HudMessage>;
		const id = m.macMessageId || '(no id)';
		const firstLine = m.lines?.[0]?.macStringId;
		return firstLine ? `#${index} · ${id} · ${firstLine}` : `#${index} · ${id}`;
	} catch {
		return `#${index}`;
	}
}

function makeEmptyMessage(): HudMessage {
	return {
		lines: Array.from({ length: HUD_MESSAGE_LINES }, () => ({
			macStringId: '',
			miParamCount: 0,
			maeParamTypes: Array.from({ length: HUD_MESSAGE_PARAMS_PER_LINE }, () => 0),
		})),
		macMessageStyle: 'NeutralMessage',
		macDefaultIcon: 'invisible',
		macMessageId: '',
		mMessageIdHash: 0n,
		muAvailabilityBitSet: 0x3f,
		mfDuration: 2,
		mfTimeToWait: 0,
		miPriority: 50,
		miForceRemoveThreshold: 0,
		meMessageGroup: 3,
		_padMessageId: [0, 0, 0],
		_padTail: 0,
	};
}

// ---------------------------------------------------------------------------
// Record schemas
// ---------------------------------------------------------------------------

const HudMessageLineRecord: RecordSchema = {
	name: 'HudMessageLine',
	description: 'One text line of a HUD message. The string id is looked up in the Language (0x27) string table at runtime; param slots are printf-style substitutions the triggering game code fills in.',
	fields: {
		macStringId: str(),
		miParamCount: i32(0, HUD_MESSAGE_PARAMS_PER_LINE),
		maeParamTypes: paramTypesList(),
	},
	fieldMetadata: {
		macStringId: {
			label: 'String id',
			description: 'Symbolic id into the Language (0x27) string table, e.g. HUDMESSAGE_GENERIC1. Empty = this line is unused. Max 63 chars. An id with no matching Language entry blanks the line in game.',
		},
		miParamCount: {
			label: 'Param count',
			description: 'Number of leading param slots this line consumes (0–4). Retail packs params as a prefix: non-Unused up to the count, Unused after.',
		},
		maeParamTypes: {
			label: 'Param types',
			description: 'Always 4 slots. The types the triggering code must supply, in order — retail only ever uses String, Int, Float, and StringId.',
		},
	},
	label: (value, index) => lineLabel(value, index ?? 0),
	validate: (value): ValidationResult[] => {
		const results: ValidationResult[] = [];
		const l = value as Partial<HudMessageLine>;
		const count = l.miParamCount ?? 0;
		if (count > 0 && !l.macStringId) {
			results.push({ severity: 'warning', field: 'miParamCount', message: 'Params declared on a line with no string id — no retail message does this.' });
		}
		const types = l.maeParamTypes ?? [];
		types.forEach((p, idx) => {
			if (idx < count && p === 0) {
				results.push({ severity: 'warning', field: 'maeParamTypes', message: `Slot ${idx} is Unused but sits inside the declared param count (${count}).` });
			}
			if (idx >= count && p !== 0) {
				results.push({ severity: 'warning', field: 'maeParamTypes', message: `Slot ${idx} has a type but lies beyond the declared param count (${count}) — the game won't read it.` });
			}
		});
		return results;
	},
};

const HudMessageRecord: RecordSchema = {
	name: 'HudMessage',
	description: 'One HUD message: up to three Language-string lines plus display style, icon, timing, queue priority, and the event contexts it may appear in. The game fires it by the CgsID of its message id.',
	fields: {
		macMessageId: str(),
		mMessageIdHash: cgsId(),
		lines: fixedList(record('HudMessageLine'), HUD_MESSAGE_LINES),
		macMessageStyle: str(),
		macDefaultIcon: str(),
		muAvailabilityBitSet: availabilityFlags(),
		meMessageGroup: groupEnum(),
		mfDuration: f32(0),
		mfTimeToWait: f32(0),
		miPriority: i32(0, 100),
		miForceRemoveThreshold: i32(0, 100),
		_padMessageId: fixedList(u8(), 3),
		_padTail: u32(),
	},
	fieldMetadata: {
		macMessageId: {
			label: 'Message id',
			description: 'Trigger id the game fires this message by, max 12 chars (e.g. AggDrBstStrt). Must be unique — renaming auto-updates the CgsID hash.',
		},
		mMessageIdHash: {
			label: 'Message CgsID',
			description: 'CgsID encoding of the uppercased message id — the actual lookup key at runtime. Derived from the message id; equal to encodeCgsId(id.toUpperCase()) in every retail record.',
			readOnly: true,
			derivedFrom: 'macMessageId',
		},
		lines: {
			label: 'Lines',
			description: 'The three on-disk text lanes. Retail: 163 of 308 messages use line 1, 18 use line 2.',
		},
		macMessageStyle: {
			label: 'Style',
			description: 'GUI style key controlling colour and placement, e.g. NeutralMessage, PosMessageBott01, NegMessage01. Retail uses 30 distinct styles. Max 31 chars.',
		},
		macDefaultIcon: {
			label: 'Icon',
			description: "Icon key shown beside the text — 'invisible' for none, 'EventSpecific' to follow the active event. Retail uses 22 distinct icons. Max 31 chars.",
		},
		muAvailabilityBitSet: {
			label: 'Availability',
			description: 'Event contexts the message may appear in. A message with no bits set can never display.',
		},
		meMessageGroup: {
			label: 'Group',
			description: 'Message queue group. Retail only uses Online live revenge (1), Online dirty tricks (2), and In-game messages (3).',
		},
		mfDuration: {
			label: 'Duration',
			description: 'Time the message stays on screen, in seconds. Retail range 0.7–10.',
		},
		mfTimeToWait: {
			label: 'Delay',
			description: 'Wait before displaying, in seconds. Retail range 0–30.',
		},
		miPriority: {
			label: 'Priority',
			description: 'Percent priority (0–100) for the message queue — higher displaces lower.',
		},
		miForceRemoveThreshold: {
			label: 'Force-remove threshold',
			description: 'Priority threshold (0–100) related to evicting queued messages; 0 for most retail messages.',
		},
		_padMessageId: {
			label: 'pad +0x10D',
			description: 'Build-tool heap garbage after the message id terminator (constant f9 1c 00 in retail). Preserved for byte-exact round-trip.',
			hidden: true,
		},
		_padTail: {
			label: 'pad +0x16C',
			description: 'Build-tool heap garbage in the record tail (constant 0x001cf974 in retail). Preserved for byte-exact round-trip.',
			hidden: true,
		},
	},
	propertyGroups: [
		{ title: 'Identity', properties: ['macMessageId', 'mMessageIdHash'] },
		{ title: 'Content', properties: ['lines', 'macMessageStyle', 'macDefaultIcon'] },
		{ title: 'Behaviour', properties: ['muAvailabilityBitSet', 'meMessageGroup', 'mfDuration', 'mfTimeToWait', 'miPriority', 'miForceRemoveThreshold'] },
	],
	label: (value, index) => messageLabel(value, index ?? 0),
	derive: (prev, next) => {
		// The game fires messages by the CgsID, so it must follow id renames.
		if (prev.macMessageId !== next.macMessageId) {
			return { mMessageIdHash: encodeCgsId(String(next.macMessageId ?? '').toUpperCase()) };
		}
		return {};
	},
};

// ---------------------------------------------------------------------------
// Root + registry export
// ---------------------------------------------------------------------------

const ParsedHudMessage: RecordSchema = {
	name: 'ParsedHudMessage',
	description: 'Root record for the HudMessage resource (0x2C): the game-wide HUD message catalogue. Retail ships exactly one, in HUDMESSAGES.HM (308 messages).',
	fields: {
		messages: {
			kind: 'list',
			item: record('HudMessage'),
			makeEmpty: () => makeEmptyMessage(),
			itemLabel: (item, index) => messageLabel(item, index),
		},
	},
	fieldMetadata: {
		messages: {
			label: 'Messages',
			description: 'Every HUD message the game can display, in disk order. Order is not gameplay-significant (lookup is by CgsID), but keeping it stable minimises diffs.',
		},
	},
	propertyGroups: [
		{ title: 'Messages', properties: ['messages'] },
	],
};

const registry: SchemaRegistry = {
	ParsedHudMessage,
	HudMessage: HudMessageRecord,
	HudMessageLine: HudMessageLineRecord,
};

export const hudMessageResourceSchema: ResourceSchema = {
	key: 'hudMessage',
	name: 'HUD Message',
	rootType: 'ParsedHudMessage',
	registry,
};
