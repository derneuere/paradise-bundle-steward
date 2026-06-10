// Payload codecs for the Registry (0xA000) entity kinds that carry inline
// strings or per-voice arrays: ContentSpec, VoiceSchema, VoiceSpec, and the
// wiki-undocumented AemsVoiceCsisClass. Split out of soundRegistry.ts, which
// owns the container format (header, hash table, string pool) and the
// fixed-shape payloads; this file owns the variable-shape ones found in
// SOUND/SOUNDENTITY.BUNDLE and SOUND/AEMS/CSIS.BUNDLE.
//
// Layouts validated against every instance in those fixtures (115 ContentSpec,
// 26 VoiceSchema, 28 VoiceSpec, 12 AemsVoiceCsisClass):
//
//   ~ContentSpec~ payload — what a named sound loads:
//     u32 mpContentType   name hash of a ContentType entity ("not actually a
//                         pointer", per the wiki)
//     u16 pathLength      length of the inline string, NUL excluded (derived)
//     u8  mu8LoadMethod   EContentLoadMethod — 1 in every fixture instance
//     u8  mu8LoadTime     EContentLoadTime — 1 in every fixture instance
//     then the path string + NUL + 0xCD pad to the next 4-byte boundary.
//     The path is usually a gamedb:// URL (wave or AEMS bank) but plain names
//     occur too. The entity name hash often equals soundHash(path) — but NOT
//     always (34 of 115 differ), so the name is independent data.
//
//   ~VoiceSchema~ payload — which DSP features a voice class instantiates.
//     The wiki's struct table is self-overlapping garbage; the real layout:
//     u32 featureSchemaCount (derived), u32 ×3 always 0 in retail (named
//     after the wiki's remaining fields, order unverifiable), then
//     featureSchemaCount × u32 FeatureSchema entity name hashes.
//
//   ~VoiceSpec~ payload — a concrete voice the engine can allocate:
//     u32 mpVoiceSchema   name hash of a VoiceSchema entity
//     u8  sendCount       (derived from the send list)
//     u8  mu8ProcessingStage  bitmask-looking values (0x00..0xF0) — unknown
//     u8  mu8ChannelCount 1/2/4/6 in retail
//     u8  mu8VoiceType    EVoiceType — 0 player, 1 submix, 2 master
//     then sendCount × u32 send-target name hashes (submix/master voices).
//
//   ~AemsVoiceCsisClass~ payload (absent from the wiki) — binds a CSIS voice
//   class to its AEMS bank content:
//     u32 mUnknown08      small varying value (6..28 in retail)
//     u16 mUnknown0C      2 in every fixture instance
//     u16 labelLength     length of the inline string, NUL excluded (derived)
//     u32 mUnknown10      shared by entities in the same registry (bank id?)
//     u32 mUnknown14      distinct per entity
//     then the label string + NUL + 0xCD pad to 4. The entity name is
//     soundHash('AEMS_' + label) in all 12 retail instances.

import { BinReader, BinWriter } from './binTools';

export type RegistryContentSpec = {
	/** Name hash of a ContentType entity (e.g. ~GenericRwacWaveContent::SK_WAVE_DATA_CONTENT_TYPE~). */
	mpContentType: number;
	/** EContentLoadMethod — 1 (resource module) in every fixture instance. */
	mu8LoadMethod: number;
	/** EContentLoadTime — 1 (immediate) in every fixture instance. */
	mu8LoadTime: number;
	/** Inline content path, usually a gamedb:// URL. Length is re-derived on write. */
	path: string;
	/** 0–3 uninitialised alignment bytes after the NUL (0xCD in retail) — preserved verbatim. */
	_padTail: Uint8Array;
};

export type RegistryVoiceSchema = {
	/** Always 0 in retail; which of the wiki's three remaining counts sits here is unverifiable. */
	mu32SlotCount: number;
	mu32ParameterCount: number;
	mu32OutputParamCount: number;
	/** Name hashes of the FeatureSchema entities this voice class instantiates. */
	featureSchemaHashes: number[];
};

export type RegistryVoiceSpec = {
	/** Name hash of a VoiceSchema entity (may live in a different registry). */
	mpVoiceSchema: number;
	mu8ProcessingStage: number;
	mu8ChannelCount: number;
	/** EVoiceType — 0 player, 1 submix, 2 master. */
	mu8VoiceType: number;
	/** Name hashes of the send targets (submix/master voices) this voice feeds. */
	sendHashes: number[];
};

export type RegistryAemsVoiceCsis = {
	mUnknown08: number;
	/** 2 in every retail instance; meaning unknown. */
	mUnknown0C: number;
	/** Shared by all AemsVoiceCsisClass entities in the same registry (bank id?). */
	mUnknown10: number;
	mUnknown14: number;
	/** Inline class label; the entity name is soundHash('AEMS_' + label) in retail. */
	label: string;
	/** 0–3 uninitialised alignment bytes after the NUL (0xCD in retail) — preserved verbatim. */
	_padTail: Uint8Array;
};

// Entities are packed at 4-byte alignment, so a string payload is followed by
// 0–3 fill bytes. `fixedSize` counts everything before the string, entity
// header included — always a multiple of 4, so only string + NUL matter.
function tailPadLength(stringLength: number): number {
	return (4 - ((stringLength + 1) & 3)) & 3;
}

export function contentSpecPayloadSize(cs: RegistryContentSpec): number {
	return 8 + cs.path.length + 1 + tailPadLength(cs.path.length);
}

export function voiceSchemaPayloadSize(vs: RegistryVoiceSchema): number {
	return 16 + 4 * vs.featureSchemaHashes.length;
}

export function voiceSpecPayloadSize(vs: RegistryVoiceSpec): number {
	return 8 + 4 * vs.sendHashes.length;
}

export function aemsVoiceCsisPayloadSize(a: RegistryAemsVoiceCsis): number {
	return 16 + a.label.length + 1 + tailPadLength(a.label.length);
}

// ---------------------------------------------------------------------------
// Inline-string helpers (latin1, NUL-terminated, 0xCD pad to 4)
// ---------------------------------------------------------------------------

function readInlineString(bytes: Uint8Array, at: number, length: number, who: string): string {
	let s = '';
	for (let i = 0; i < length; i++) {
		const b = bytes[at + i];
		if (b === 0) throw new Error(`Registry: ${who} inline string has an embedded NUL at +${i}`);
		s += String.fromCharCode(b);
	}
	if (bytes[at + length] !== 0) {
		throw new Error(`Registry: ${who} inline string is not NUL-terminated at 0x${(at + length).toString(16)}`);
	}
	return s;
}

function writeInlineString(w: BinWriter, s: string, padTail: Uint8Array, who: string) {
	for (let i = 0; i < s.length; i++) {
		const c = s.charCodeAt(i);
		if (c === 0 || c > 0xff) {
			throw new Error(`Registry writer: ${who} string "${s}" has a byte-unrepresentable character`);
		}
		w.writeU8(c);
	}
	w.writeU8(0);
	// The pad is uninitialised allocator fill — write it back verbatim when the
	// string is untouched; a resized string gets the retail 0xCD fill instead.
	const need = tailPadLength(s.length);
	if (padTail.byteLength === need) {
		w.writeBytes(padTail);
	} else {
		for (let i = 0; i < need; i++) w.writeU8(0xcd);
	}
}

// ---------------------------------------------------------------------------
// Parsers — `r` is positioned at the payload start (entity start + 8);
// `end` bounds the payload (the next entity's offset, or the data end).
// ---------------------------------------------------------------------------

export function parseContentSpec(r: BinReader, bytes: Uint8Array, end: number, who: string): RegistryContentSpec {
	const mpContentType = r.readU32();
	const pathLength = r.readU16();
	const mu8LoadMethod = r.readU8();
	const mu8LoadTime = r.readU8();
	const strAt = r.position;
	const expectedEnd = strAt + pathLength + 1 + tailPadLength(pathLength);
	if (expectedEnd !== end) {
		throw new Error(`Registry: ${who} ContentSpec path length ${pathLength} implies payload end 0x${expectedEnd.toString(16)}, actual 0x${end.toString(16)}`);
	}
	const path = readInlineString(bytes, strAt, pathLength, who);
	const _padTail = bytes.slice(strAt + pathLength + 1, end);
	r.position = end;
	return { mpContentType, mu8LoadMethod, mu8LoadTime, path, _padTail };
}

export function parseVoiceSchema(r: BinReader, payloadSize: number, who: string): RegistryVoiceSchema {
	const count = r.readU32();
	const mu32SlotCount = r.readU32();
	const mu32ParameterCount = r.readU32();
	const mu32OutputParamCount = r.readU32();
	if (payloadSize !== 16 + 4 * count) {
		throw new Error(`Registry: ${who} VoiceSchema has ${payloadSize} payload bytes, expected ${16 + 4 * count} for ${count} features`);
	}
	const featureSchemaHashes: number[] = [];
	for (let i = 0; i < count; i++) featureSchemaHashes.push(r.readU32());
	return { mu32SlotCount, mu32ParameterCount, mu32OutputParamCount, featureSchemaHashes };
}

export function parseVoiceSpec(r: BinReader, payloadSize: number, who: string): RegistryVoiceSpec {
	const mpVoiceSchema = r.readU32();
	const sendCount = r.readU8();
	const mu8ProcessingStage = r.readU8();
	const mu8ChannelCount = r.readU8();
	const mu8VoiceType = r.readU8();
	if (payloadSize !== 8 + 4 * sendCount) {
		throw new Error(`Registry: ${who} VoiceSpec has ${payloadSize} payload bytes, expected ${8 + 4 * sendCount} for ${sendCount} sends`);
	}
	const sendHashes: number[] = [];
	for (let i = 0; i < sendCount; i++) sendHashes.push(r.readU32());
	return { mpVoiceSchema, mu8ProcessingStage, mu8ChannelCount, mu8VoiceType, sendHashes };
}

export function parseAemsVoiceCsis(r: BinReader, bytes: Uint8Array, end: number, who: string): RegistryAemsVoiceCsis {
	const mUnknown08 = r.readU32();
	const mUnknown0C = r.readU16();
	const labelLength = r.readU16();
	const mUnknown10 = r.readU32();
	const mUnknown14 = r.readU32();
	const strAt = r.position;
	const expectedEnd = strAt + labelLength + 1 + tailPadLength(labelLength);
	if (expectedEnd !== end) {
		throw new Error(`Registry: ${who} AemsVoiceCsisClass label length ${labelLength} implies payload end 0x${expectedEnd.toString(16)}, actual 0x${end.toString(16)}`);
	}
	const label = readInlineString(bytes, strAt, labelLength, who);
	const _padTail = bytes.slice(strAt + labelLength + 1, end);
	r.position = end;
	return { mUnknown08, mUnknown0C, mUnknown10, mUnknown14, label, _padTail };
}

// ---------------------------------------------------------------------------
// Writers
// ---------------------------------------------------------------------------

export function writeContentSpec(w: BinWriter, cs: RegistryContentSpec) {
	if (cs.path.length > 0xffff) {
		throw new Error(`Registry writer: ContentSpec path is ${cs.path.length} chars, max 65535`);
	}
	w.writeU32(cs.mpContentType);
	w.writeU16(cs.path.length);
	w.writeU8(cs.mu8LoadMethod);
	w.writeU8(cs.mu8LoadTime);
	writeInlineString(w, cs.path, cs._padTail, 'ContentSpec');
}

export function writeVoiceSchema(w: BinWriter, vs: RegistryVoiceSchema) {
	w.writeU32(vs.featureSchemaHashes.length);
	w.writeU32(vs.mu32SlotCount);
	w.writeU32(vs.mu32ParameterCount);
	w.writeU32(vs.mu32OutputParamCount);
	for (const h of vs.featureSchemaHashes) w.writeU32(h);
}

export function writeVoiceSpec(w: BinWriter, vs: RegistryVoiceSpec) {
	if (vs.sendHashes.length > 0xff) {
		throw new Error(`Registry writer: VoiceSpec has ${vs.sendHashes.length} sends, max 255`);
	}
	w.writeU32(vs.mpVoiceSchema);
	w.writeU8(vs.sendHashes.length);
	w.writeU8(vs.mu8ProcessingStage);
	w.writeU8(vs.mu8ChannelCount);
	w.writeU8(vs.mu8VoiceType);
	for (const h of vs.sendHashes) w.writeU32(h);
}

export function writeAemsVoiceCsis(w: BinWriter, a: RegistryAemsVoiceCsis) {
	if (a.label.length > 0xffff) {
		throw new Error(`Registry writer: AemsVoiceCsisClass label is ${a.label.length} chars, max 65535`);
	}
	w.writeU32(a.mUnknown08);
	w.writeU16(a.mUnknown0C);
	w.writeU16(a.label.length);
	w.writeU32(a.mUnknown10);
	w.writeU32(a.mUnknown14);
	writeInlineString(w, a.label, a._padTail, 'AemsVoiceCsisClass');
}
