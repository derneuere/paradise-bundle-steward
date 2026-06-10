// Hand-written schema for ParsedGenericRwacWaveContent (resource type 0xA020).
//
// Mirrors the types in `src/lib/core/genericRwacWaveContent.ts`. Keep these in
// lockstep with the parser/writer — any field added to the parser needs a
// matching entry here, or the schema walker reports it as drift.
//
// Domain: one EA SndPlayer wave (RWAC audio). The audio itself is an opaque
// codec payload (EALayer3 in retail) that steward preserves verbatim — only
// the header metadata is meaningfully editable. Sample rate retunes playback
// (pitch shift) without re-encoding; the loop point can be moved or cleared.
// Codec/channels/version describe how the payload bytes were ENCODED, so
// editing them without swapping the payload corrupts playback — read-only.
// numSamples is re-derived from the chunk list on write for RAM waves.

import type { FieldSchema, RecordSchema, ResourceSchema, SchemaRegistry } from '../types';
import { SNDPLAYER_CODECS, SNDPLAYER_PLAY_TYPES } from '@/lib/core/genericRwacWaveContent';

// ---------------------------------------------------------------------------
// Local helpers (mirroring staticSoundMap.ts)
// ---------------------------------------------------------------------------

const u8 = (): FieldSchema => ({ kind: 'u8' });
const u32 = (): FieldSchema => ({ kind: 'u32' });
const record = (type: string): FieldSchema => ({ kind: 'record', type });
const rawBytes = (): FieldSchema => ({ kind: 'custom', component: 'rawBytes' });

const codecEnum = (): FieldSchema => ({
	kind: 'enum',
	storage: 'u8',
	values: SNDPLAYER_CODECS.map((label, value) => ({ value, label })),
});

const PLAY_TYPE_DESCRIPTIONS = [
	'Self-contained — all audio data lives in this resource as chunks.',
	'Audio data lives outside this resource in persistent memory.',
	'Stream with a RAM-resident head so playback starts before the stream seeks.',
];

const playTypeEnum = (): FieldSchema => ({
	kind: 'enum',
	storage: 'u8',
	values: SNDPLAYER_PLAY_TYPES.map((label, value) => ({
		value,
		label,
		description: PLAY_TYPE_DESCRIPTIONS[value],
	})),
});

function chunkLabel(item: unknown, index: number): string {
	try {
		if (!item || typeof item !== 'object') return `#${index}`;
		const c = item as { samples?: number; data?: { byteLength?: number } };
		return `#${index} · ${c.samples ?? '?'} samples · ${c.data?.byteLength ?? '?'} B`;
	} catch {
		return `#${index}`;
	}
}

// ---------------------------------------------------------------------------
// Record schemas
// ---------------------------------------------------------------------------

const WaveDataChunk: RecordSchema = {
	name: 'WaveDataChunk',
	description: 'One load-play-unload unit of encoded audio. The runtime streams chunks in sequence to bound RAM usage; a looped wave\'s chunk boundary lands exactly on the loop start sample so the decoder can restart there.',
	fields: {
		samples: u32(),
		data: rawBytes(),
	},
	fieldMetadata: {
		samples: {
			label: 'Samples',
			description: 'Sample frames this chunk decodes to. Must match the encoded payload — the game trusts it for chunk scheduling.',
			readOnly: true,
		},
		data: {
			label: 'Codec data',
			description: 'Opaque encoded audio (EALayer3 in retail). Preserved verbatim; produce replacements with EALayer3 / EA Sound Exchange.',
			readOnly: true,
		},
	},
	label: (value, index) => chunkLabel(value, index ?? 0),
};

const ParsedGenericRwacWaveContent: RecordSchema = {
	name: 'ParsedGenericRwacWaveContent',
	description: 'Root record for a Generic RWAC Wave Content resource (0xA020): one EA SndPlayer wave — header metadata plus the encoded audio in chunks. The big-endian bit-packed header is unpacked here; sizes and the sample total are re-derived on write.',
	fields: {
		version: u8(),
		codec: codecEnum(),
		channels: u8(),
		sampleRate: { kind: 'u32', min: 1, max: 0x3ffff },
		playType: playTypeEnum(),
		numSamples: u32(),
		loopStartSample: u32(),
		gigaResidentSamples: u32(),
		chunks: {
			kind: 'list',
			item: record('WaveDataChunk'),
			addable: false,
			removable: false,
			itemLabel: (item, index) => chunkLabel(item, index),
		},
		_binPad: rawBytes(),
		_trailingPad: rawBytes(),
		_unchunkedData: rawBytes(),
	},
	fieldMetadata: {
		version: {
			label: 'Version',
			description: 'SndPlayer header version — 0 in every Burnout resource.',
			readOnly: true,
		},
		codec: {
			label: 'Codec',
			description: 'How the chunk payloads are encoded (EA::Audio::Core::SndPlayerCodec). Burnout PC uses EALayer3 v1 almost everywhere, XAS for some engine sounds. Read-only: the payload bytes must match.',
			readOnly: true,
		},
		channels: {
			label: 'Channels',
			description: '1 = mono, 2 = stereo (stored as count-1 in a 6-bit field). Read-only: baked into the encoded payload.',
			readOnly: true,
		},
		sampleRate: {
			label: 'Sample rate',
			description: 'Playback rate in Hz (18-bit field, max 262143; retail uses 22050/44100/48000). Editable — retuning pitch-shifts the sound without re-encoding.',
		},
		playType: {
			label: 'Play type',
			description: 'Where the audio data lives at runtime. Read-only: the resource layout follows it (RAM waves carry chunks; stream/gigasample waves keep an opaque blob steward does not decode).',
			readOnly: true,
		},
		numSamples: {
			label: 'Total samples',
			description: 'Sample frames in the whole asset. Re-derived from the chunk list on write for RAM waves — duration is numSamples / sampleRate.',
			readOnly: true,
		},
		loopStartSample: {
			label: 'Loop start sample',
			description: 'Sample the loop restarts from; empty = one-shot (the header field only exists when the loop flag is set). Retail loops restart on a chunk boundary — moving this far from one may glitch playback.',
		},
		gigaResidentSamples: {
			label: 'Gigasample RAM samples',
			description: 'Gigasample waves only: how many samples of the head live in RAM. Empty for RAM/stream waves.',
			readOnly: true,
		},
		chunks: {
			label: 'Audio chunks',
			description: 'Encoded audio in playback order. Fixed list — chunking is decided by the encoder (and the loop point), so add/remove means re-encoding externally.',
		},
		_binPad: {
			label: 'Wrapper pad',
			description: 'Bytes 0x08-0x0F of the BinaryFile wrapper — uninitialised build-machine memory (stale path strings in 4 retail waves). Preserved verbatim.',
			hidden: true,
		},
		_trailingPad: {
			label: 'Trailing pad',
			description: '0-15 bytes padding the resource to 16-byte alignment — sometimes uninitialised garbage. Preserved verbatim while the length fits, regenerated as zeros after a size-changing edit.',
			hidden: true,
		},
		_unchunkedData: {
			label: 'Unchunked data',
			description: 'Stream/gigasample waves only: everything after the header, preserved verbatim (no fixture validates that shape). Empty for RAM waves.',
			hidden: true,
		},
	},
	propertyGroups: [
		{ title: 'Format', properties: ['version', 'codec', 'channels', 'sampleRate', 'playType'] },
		{ title: 'Playback', properties: ['numSamples', 'loopStartSample', 'gigaResidentSamples'] },
		{ title: 'Audio data', properties: ['chunks'] },
	],
};

// ---------------------------------------------------------------------------
// Registry export
// ---------------------------------------------------------------------------

const registry: SchemaRegistry = {
	ParsedGenericRwacWaveContent,
	WaveDataChunk,
};

export const genericRwacWaveContentResourceSchema: ResourceSchema = {
	key: 'genericRwacWaveContent',
	name: 'Generic RWAC Wave Content',
	rootType: 'ParsedGenericRwacWaveContent',
	registry,
};
