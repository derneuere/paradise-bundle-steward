// Hand-written schema for ParsedSnapshotData (resource type 0xA029).
//
// Mirrors the types in `src/lib/core/snapshotData.ts`. Keep these in
// lockstep with the parser/writer — any field added there needs a matching
// entry here, or the schema walker reports it as drift.
//
// Domain: snapshots are mixer presets for the companion Nicotine map
// (0xA024) in the same bundle. Each channel record names a Nicotine MASTER
// mix channel by its exact MIXCHID word; each snapshot carries one
// (control, value) datum per channel. Channels and snapshots are
// cross-indexed on disk (snapshot s × channel c), so both lists are locked:
// adding a channel would require adding a datum to all 17 snapshots, an op
// steward doesn't have yet.

import type { FieldSchema, RecordSchema, ResourceSchema, SchemaRegistry } from '../types';
import { hex8 } from './nicotine';

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

const u32 = (): FieldSchema => ({ kind: 'u32' });
const f32 = (): FieldSchema => ({ kind: 'f32' });
const record = (type: string): FieldSchema => ({ kind: 'record', type });

const fixedRecordList = (
	type: string,
	itemLabel?: (item: unknown, index: number) => string,
): FieldSchema => ({
	kind: 'list',
	item: record(type),
	addable: false,
	removable: false,
	itemLabel: itemLabel ? (item, index) => itemLabel(item, index) : undefined,
});

function channelLabel(value: unknown, index: number | null): string {
	const ch = value as { mixChId?: number; channelId?: number } | null;
	return `#${index ?? 0} · ${hex8(ch?.mixChId)} · hash ${hex8(ch?.channelId)}`;
}

function entryLabel(value: unknown, index: number | null): string {
	try {
		const e = value as { control?: number; value?: number } | null;
		const val = typeof e?.value === 'number' ? e.value.toFixed(3) : '?';
		return `ch ${index ?? 0} · ctl ${e?.control ?? '?'} · ${val}`;
	} catch {
		return `#${index ?? 0}`;
	}
}

// ---------------------------------------------------------------------------
// Record schemas
// ---------------------------------------------------------------------------

const SnapshotChannel: RecordSchema = {
	name: 'SnapshotChannel',
	description: 'One mixer channel under snapshot control. References a master mix channel of the companion Nicotine map by its exact MIXCHID word (verified across both retail bundles).',
	fields: {
		mixChId: u32(),
		channelId: u32(),
	},
	fieldMetadata: {
		mixChId: {
			label: 'Mix channel ID',
			description: 'Packed master-mix MIXCHID from the companion Nicotine map (top two bits always set; 0xC0-prefixed in retail). The link to the mixer — changing it detaches every snapshot datum for this channel.',
			readOnly: true,
		},
		channelId: {
			label: 'Channel hash',
			description: 'Hash-like 32-bit id (not a CgsID; source name unknown). Appears nowhere in the Nicotine map — informational, not the link.',
			readOnly: true,
		},
	},
	label: channelLabel,
};

const SnapshotEntry: RecordSchema = {
	name: 'SnapshotEntry',
	description: 'One channel\'s datum within a snapshot. Entry i drives channels[i].',
	fields: {
		control: u32(),
		value: f32(),
	},
	fieldMetadata: {
		control: {
			label: 'Control word',
			description: 'Packed word: the low i16 lane is consistent with a level in hundredths of a dB (0xD8F0 = -10000 = -100.00 dB floor), the high lane is 0 or 1. Retail range 0..130658.',
		},
		value: {
			label: 'Value',
			description: 'Unknown float — the wiki suggests volume. Retail range 0..5.6, typically ~0.25.',
		},
	},
	label: entryLabel,
};

const Snapshot: RecordSchema = {
	name: 'Snapshot',
	description: 'One mixer preset: a (control, value) datum for every channel, in channel-list order.',
	fields: {
		entries: fixedRecordList('SnapshotEntry', (item, index) => entryLabel(item, index)),
	},
	fieldMetadata: {
		entries: {
			label: 'Channel data',
			description: 'One entry per channel — entry i corresponds to channels[i]. The on-disk array is sized snapshots × channels, so the length is locked.',
		},
	},
	label: (_value, index) => `Snapshot #${index ?? 0}`,
};

// ---------------------------------------------------------------------------
// Root + registry export
// ---------------------------------------------------------------------------

const ParsedSnapshotData: RecordSchema = {
	name: 'ParsedSnapshotData',
	description: 'Root record for the Snapshot Data resource (0xA029): mixer-channel snapshots for the companion Nicotine map. Both retail resources are byte-identical (17 snapshots × 72 channels) — stereo/surround differences live in the Nicotine maps.',
	fields: {
		channels: fixedRecordList('SnapshotChannel', (item, index) => channelLabel(item, index)),
		snapshots: fixedRecordList('Snapshot'),
		_pad08: u32(),
		_pad0C: u32(),
	},
	fieldMetadata: {
		channels: {
			label: 'Channels',
			description: 'The master mix channels under snapshot control, each named by its Nicotine MIXCHID. Order is load-bearing: snapshot entries index this list by position.',
		},
		snapshots: {
			label: 'Snapshots',
			description: 'Mixer presets the game crossfades between. Each carries one datum per channel.',
		},
		_pad08: { label: 'maiPad[0]', description: '1 in retail (wiki: "mixer state?"); preserved verbatim.', hidden: true },
		_pad0C: { label: 'maiPad[1]', description: '0x12345678 in retail; preserved verbatim.', hidden: true },
	},
	propertyGroups: [
		{ title: 'Channels', properties: ['channels'] },
		{ title: 'Snapshots', properties: ['snapshots'] },
	],
};

const registry: SchemaRegistry = {
	ParsedSnapshotData,
	SnapshotChannel,
	Snapshot,
	SnapshotEntry,
};

export const snapshotDataResourceSchema: ResourceSchema = {
	key: 'snapshotData',
	name: 'Snapshot Data',
	rootType: 'ParsedSnapshotData',
	registry,
};
