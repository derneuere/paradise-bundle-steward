// Hand-written schema for ParsedWheelList (resource type 0x10009).
//
// Mirrors the types in `src/lib/core/wheelList.ts`. Keep these in lockstep
// with the parser/writer — any field added to the parser needs a matching
// entry here, or the schema walker reports it as drift.
//
// Domain: the global wheel catalogue — one entry per wheel in the game. The
// CgsID mId is NOT a hash of the wheel name (names exceed CgsID's 12-char
// cap): it encodes a separate authored wheel CODE. decodeCgsId(mId) names the
// wheel's graphics bundle (WHE_<code>_GR.BNDL) and the WheelGraphicsSpec
// resource inside it (<code>_Graphics), so both fields are independently
// editable and there is no derive hook.

import type {
	FieldSchema,
	RecordSchema,
	ResourceSchema,
	SchemaRegistry,
} from '../types';
import { MAX_WHEEL_NAME_CHARS } from '@/lib/core/wheelList';
import { decodeCgsId } from '@/lib/core/cgsid';

// ---------------------------------------------------------------------------
// Local helpers (mirroring staticSoundMap.ts)
// ---------------------------------------------------------------------------

const str = (): FieldSchema => ({ kind: 'string' });
const cgsId = (): FieldSchema => ({ kind: 'bigint', bytes: 8, hex: true });
const rawBytes = (): FieldSchema => ({ kind: 'custom', component: 'rawBytes' });

// ---------------------------------------------------------------------------
// Tree-label helpers
// ---------------------------------------------------------------------------

function entryLabel(entry: unknown, index: number): string {
	try {
		if (!entry || typeof entry !== 'object') return `#${index}`;
		const e = entry as { mId?: bigint; macWheelName?: string };
		const code = e.mId != null ? decodeCgsId(e.mId) : '';
		const name = e.macWheelName || '(unnamed)';
		return code ? `${name} · ${code}` : name;
	} catch {
		return `#${index}`;
	}
}

// ---------------------------------------------------------------------------
// Record schemas
// ---------------------------------------------------------------------------

const WheelListEntry: RecordSchema = {
	name: 'WheelListEntry',
	description: 'One wheel — a CgsID wheel code plus a human-readable name. The decoded code names the wheel\'s graphics bundle (WHE_<code>_GR.BNDL).',
	fields: {
		mId: cgsId(),
		macWheelName: str(),
	},
	fieldMetadata: {
		mId: {
			label: 'Wheel ID',
			description: 'CgsID encoding the ≤12-char wheel code (e.g. 00218650). The code names the WHE_<code>_GR.BNDL graphics bundle and its WheelGraphicsSpec (<code>_Graphics) — retargeting this repoints the wheel at different graphics.',
		},
		macWheelName: {
			label: 'Wheel name',
			description: `Human-readable wheel name, max ${MAX_WHEEL_NAME_CHARS} chars (char[64] on disk). Convention: <spokes>Spoke_<variant>_<rim inches>_<width mm>, e.g. 5Spoke_04_20_650. Not the source of the ID — codes are authored separately.`,
		},
	},
	propertyGroups: [
		{ title: 'Wheel', properties: ['mId', 'macWheelName'] },
	],
	label: (value, index) => entryLabel(value, index ?? 0),
};

// ---------------------------------------------------------------------------
// Root + registry export
// ---------------------------------------------------------------------------

const ParsedWheelList: RecordSchema = {
	name: 'ParsedWheelList',
	description: 'Root record for the WheelList resource (0x10009): the global catalogue of every wheel in the game — 172 entries in retail.',
	fields: {
		entries: {
			kind: 'list',
			item: { kind: 'record', type: 'WheelListEntry' },
			addable: true,
			removable: true,
			makeEmpty: () => ({ mId: 0n, macWheelName: '' }),
			itemLabel: (item, index) => entryLabel(item, index),
		},
		_pad08: rawBytes(),
		_trailingPad: rawBytes(),
	},
	fieldMetadata: {
		entries: {
			label: 'Wheels',
			description: 'Every wheel in the game, in disk order. The on-disk count is recomputed from this list on write.',
		},
		_pad08: {
			label: 'pad +0x08',
			description: 'Header pad (0 in retail); preserved verbatim for byte-exact round-trip.',
			hidden: true,
		},
		_trailingPad: {
			label: 'Trailing pad',
			description: 'Bytes after the last entry (empty in retail); preserved verbatim.',
			hidden: true,
		},
	},
	propertyGroups: [
		{ title: 'Wheels', properties: ['entries'] },
	],
};

const registry: SchemaRegistry = {
	ParsedWheelList,
	WheelListEntry,
};

export const wheelListResourceSchema: ResourceSchema = {
	key: 'wheelList',
	name: 'Wheel List',
	rootType: 'ParsedWheelList',
	registry,
};
