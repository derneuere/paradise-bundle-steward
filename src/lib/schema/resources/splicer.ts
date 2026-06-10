// Hand-written schema for ParsedSplicer (resource type 0xA025).
//
// Mirrors the types in `src/lib/core/splicer.ts`. Keep these in lockstep
// with the parser/writer — any field added to the parser needs a matching
// entry here, or the schema walker reports it as drift.
//
// Domain: a splicer is a self-contained bank of triggered sounds. Each
// *splice* is one playable event built from *sample refs* — playback
// instructions pointing into the table of audio samples embedded at the
// tail of the same resource (48 kHz EA-XAS streams; no external wave
// references). Game events bind to splices by hardcoded order, which is why
// SpliceIndex is read-only and the samples list is fixed: removing or
// reordering either silently rebinds every event behind it.
//
// Units (validated against all six retail fixtures): volumes are LINEAR
// amplitude multipliers (retail authors them on the 2^(n/6) ladder — about
// 1 dB per step, 6 dB per doubling). Pitches are frequency RATIOS (retail
// uses 2^(n/12) — semitone steps). All timing fields are seconds.

import type {
	FieldSchema,
	RecordSchema,
	ResourceSchema,
	SchemaRegistry,
} from '../types';
import { splicerSampleInfo, type SpliceSampleRef } from '@/lib/core/splicer';

// ---------------------------------------------------------------------------
// Local helpers (mirroring staticSoundMap.ts)
// ---------------------------------------------------------------------------

const f32 = (opts?: { min?: number; max?: number }): FieldSchema => ({ kind: 'f32', ...opts });
const u8 = (): FieldSchema => ({ kind: 'u8' });
const i8 = (): FieldSchema => ({ kind: 'i8' });
const u16 = (): FieldSchema => ({ kind: 'u16' });
const u32 = (): FieldSchema => ({ kind: 'u32' });
const record = (type: string): FieldSchema => ({ kind: 'record', type });
const rawBytes = (): FieldSchema => ({ kind: 'custom', component: 'rawBytes' });

// ---------------------------------------------------------------------------
// Tree-label helpers
// ---------------------------------------------------------------------------

function spliceLabel(value: unknown, index: number): string {
	try {
		if (!value || typeof value !== 'object') return `#${index}`;
		const s = value as { Volume?: number; sampleRefs?: unknown[] };
		const n = s.sampleRefs?.length ?? 0;
		const vol = s.Volume != null ? `vol ×${s.Volume.toFixed(2)}` : '';
		return `#${index} · ${n} ref${n === 1 ? '' : 's'}${vol ? ` · ${vol}` : ''}`;
	} catch {
		return `#${index}`;
	}
}

function sampleRefLabel(value: unknown, index: number): string {
	try {
		if (!value || typeof value !== 'object') return `#${index}`;
		const r = value as Partial<SpliceSampleRef>;
		const dur = r.Duration != null ? ` · ${r.Duration.toFixed(2)} s` : '';
		const pitch = r.Pitch != null && r.Pitch !== 1 ? ` · pitch ×${r.Pitch.toFixed(2)}` : '';
		return `#${index} · sample ${r.SampleIndex ?? '?'}${dur}${pitch}`;
	} catch {
		return `#${index}`;
	}
}

export function sampleLabel(value: unknown, index: number): string {
	try {
		if (!(value instanceof Uint8Array)) return `#${index}`;
		const info = splicerSampleInfo(value);
		if (!info) return `#${index} · ${value.byteLength} B`;
		return `#${index} · ${info.seconds.toFixed(2)} s · ${info.channels === 1 ? 'mono' : 'stereo'} · ${value.byteLength} B`;
	} catch {
		return `#${index}`;
	}
}

// ---------------------------------------------------------------------------
// Record schemas
// ---------------------------------------------------------------------------

const SpliceSampleRefRecord: RecordSchema = {
	name: 'SpliceSampleRef',
	description: 'One playback instruction inside a splice: which embedded sample to play and how — volume, pitch, delay, duration, fades, and per-trigger randomisation.',
	fields: {
		SampleIndex: u16(),
		Volume: f32({ min: 0 }),
		Pitch: f32({ min: 0 }),
		Offset: f32({ min: 0 }),
		Az: f32(),
		Duration: f32({ min: 0 }),
		FadeIn: f32({ min: 0 }),
		FadeOut: f32({ min: 0 }),
		RND_Vol: f32(),
		RND_Pitch: f32(),
		Priority: u8(),
		eSpliceType: i8(),
		eRollOffType: u8(),
		_pad03: u8(),
		_pad2A: u16(),
	},
	fieldMetadata: {
		SampleIndex: {
			label: 'Sample',
			description: 'Index into the splicer\'s embedded sample list. The writer rejects out-of-range values.',
		},
		Volume: {
			label: 'Volume',
			description: 'Linear amplitude multiplier (1 = as recorded). Retail authors on the 2^(n/6) ladder (≈1 dB steps); observed 0.0039–2.',
		},
		Pitch: {
			label: 'Pitch',
			description: 'Frequency ratio (1 = original; 2^(n/12) = n semitones). Retail observed 0.0014–2.',
		},
		Offset: {
			label: 'Delay',
			description: 'Seconds between the splice trigger and this sample starting. Retail observed 0–8.75.',
		},
		Az: {
			label: 'Azimuth',
			description: 'Wiki: "typically 0 or -127". Retail values run -127..121 (collision/presentation banks use ±35–61) — looks like degrees with -127 as a sentinel, unverified.',
		},
		Duration: {
			label: 'Duration',
			description: 'Seconds of the sample to play. Always > 0 in retail (0.0001–15 observed).',
		},
		FadeIn: {
			label: 'Fade in',
			description: 'Fade-in length in seconds (0 = hard start).',
		},
		FadeOut: {
			label: 'Fade out',
			description: 'Fade-out length in seconds (0 = hard stop).',
		},
		RND_Vol: {
			label: 'Random volume',
			description: 'Per-trigger volume randomisation bound (1 = none). Retail observed 0.5–1.2.',
		},
		RND_Pitch: {
			label: 'Random pitch',
			description: 'Per-trigger pitch randomisation offset (0 = none). Retail observed -0.41..0.79.',
		},
		Priority: {
			label: 'Priority',
			description: 'Always 0 in retail; runtime meaning unverified.',
			readOnly: true,
		},
		eSpliceType: {
			label: 'Splice type',
			description: 'Undocumented enum — 0 in every known instance (the values are absent from the debug data).',
			readOnly: true,
		},
		eRollOffType: {
			label: 'Roll-off type',
			description: 'Undocumented enum — 0 in every known instance.',
			readOnly: true,
		},
		_pad03: {
			label: 'pad +0x03',
			description: 'Pad byte (0 in retail); preserved verbatim.',
			hidden: true,
		},
		_pad2A: {
			label: 'pad +0x2A',
			description: 'Pad u16 (0 in retail); preserved verbatim.',
			hidden: true,
		},
	},
	propertyGroups: [
		{ title: 'Sample', properties: ['SampleIndex', 'Volume', 'Pitch'] },
		{ title: 'Timing', properties: ['Offset', 'Duration', 'FadeIn', 'FadeOut'] },
		{ title: 'Variation', properties: ['RND_Vol', 'RND_Pitch', 'Az', 'Priority', 'eSpliceType', 'eRollOffType'] },
	],
	label: (value, index) => sampleRefLabel(value, index ?? 0),
};

const SpliceDataRecord: RecordSchema = {
	name: 'SpliceData',
	description: 'One playable sound event. Game code triggers splices by their hardcoded order in this resource, so position is load-bearing. The refs play together (each with its own delay) when the splice fires.',
	fields: {
		Volume: f32({ min: 0 }),
		RND_Pitch: f32(),
		RND_Vol: f32(),
		sampleRefs: {
			kind: 'list',
			item: record('SpliceSampleRef'),
			addable: true,
			removable: true,
			makeEmpty: () => ({
				SampleIndex: 0,
				eSpliceType: 0,
				_pad03: 0,
				Volume: 1,
				Pitch: 1,
				Offset: 0,
				Az: 0,
				Duration: 1,
				FadeIn: 0,
				FadeOut: 0,
				RND_Vol: 1,
				RND_Pitch: 0,
				Priority: 0,
				eRollOffType: 0,
				_pad2A: 0,
			} satisfies SpliceSampleRef),
			itemLabel: (item, index) => sampleRefLabel(item, index),
		},
		SpliceIndex: u16(),
		NameHash: u32(),
		eSpliceType: i8(),
	},
	fieldMetadata: {
		Volume: {
			label: 'Volume',
			description: 'Linear amplitude multiplier for the whole splice, on top of each ref\'s own volume. Retail observed 0.22–10.08 (the 2^(n/6) ladder: ≈1 dB per step).',
		},
		RND_Pitch: {
			label: 'Random pitch',
			description: 'Splice-level pitch randomisation (0 in every retail splice).',
		},
		RND_Vol: {
			label: 'Random volume',
			description: 'Splice-level volume randomisation bound (1 in every retail splice).',
		},
		sampleRefs: {
			label: 'Sample refs',
			description: 'Playback instructions fired together when this splice triggers. Count is stored as a u8 — the writer rejects more than 255.',
		},
		SpliceIndex: {
			label: 'Splice index',
			description: 'Rank in the shared on-disk SampleRef array. Equals the splice\'s position in every retail resource; must stay unique. Read-only — the refs are nested here, so the rank only matters for byte layout.',
			readOnly: true,
		},
		NameHash: {
			label: 'Name hash',
			description: 'Always 0 in retail (the wiki marks it "Always null"). Preserved verbatim.',
			readOnly: true,
		},
		eSpliceType: {
			label: 'Splice type',
			description: 'Undocumented enum — 0 in every known instance.',
			readOnly: true,
		},
	},
	propertyGroups: [
		{ title: 'Playback', properties: ['Volume', 'RND_Vol', 'RND_Pitch', 'sampleRefs'] },
		{ title: 'Identity', properties: ['SpliceIndex', 'NameHash', 'eSpliceType'] },
	],
	label: (value, index) => spliceLabel(value, index ?? 0),
};

// ---------------------------------------------------------------------------
// Root + registry export
// ---------------------------------------------------------------------------

const ParsedSplicerRecord: RecordSchema = {
	name: 'ParsedSplicer',
	description: 'Root record for the Splicer resource (0xA025): a self-contained bank of triggered sounds with the audio sample data embedded at the tail. Nothing here references other resources.',
	fields: {
		splices: {
			kind: 'list',
			item: record('SpliceData'),
			// Adding a splice needs a fresh unique SpliceIndex; removal is safe
			// for the bytes but rebinds the hardcoded game-event order — allowed,
			// with the warning carried on the field description.
			addable: false,
			removable: true,
			itemLabel: (item, index) => spliceLabel(item, index),
		},
		samples: {
			kind: 'list',
			item: rawBytes(),
			// Fixed: SampleIndex refs address this list by position, and steward
			// has no audio-import pipeline to author new EA-XAS streams.
			addable: false,
			removable: false,
			itemLabel: (item, index) => sampleLabel(item, index),
		},
		_wrapperPad: rawBytes(),
	},
	fieldMetadata: {
		splices: {
			label: 'Splices',
			description: 'Playable sound events in trigger order. Game events bind to splices by hardcoded position — removing one rebinds every splice behind it.',
		},
		samples: {
			label: 'Samples',
			description: 'Embedded audio streams (48 kHz EA-XAS, mono or stereo), addressed by each ref\'s Sample index. Opaque bytes — steward preserves them verbatim.',
		},
		_wrapperPad: {
			label: 'Wrapper pad',
			description: 'BinaryFile header pad bytes 0x8–0xF (zero in retail). Preserved for byte-exact round-trip.',
			hidden: true,
		},
	},
	propertyGroups: [
		{ title: 'Splices', properties: ['splices'] },
		{ title: 'Samples', properties: ['samples'] },
	],
};

const registry: SchemaRegistry = {
	ParsedSplicer: ParsedSplicerRecord,
	SpliceData: SpliceDataRecord,
	SpliceSampleRef: SpliceSampleRefRecord,
};

export const splicerResourceSchema: ResourceSchema = {
	key: 'splicer',
	name: 'Splicer',
	rootType: 'ParsedSplicer',
	registry,
};
