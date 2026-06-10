// HudMessageSequence (0x2E) + HudMessageSequenceDictionary (0x2F) parsers
// and writers. Both types live in a single retail bundle —
// HUDMESSAGESEQUENCES.HMSC — six sequences plus one dictionary listing them.
//
// A sequence is an ordered set of HUD message CgsIDs the game displays one
// after another (each with its own on-screen duration). The feature is a
// leftover from early development: the six retail sequences are all "DT*"
// (online Dirty Tricks) arming flows — message[0] is always DTARMING and
// message[1] the per-trick award/failure message. The type was removed from
// Remastered on PS4 but reintroduced in the PC and Switch releases.
//
// The dictionary references sequences BY NAME: its char[13] entries are
// exactly the macSequenceId strings of the 0x2E resources in the same
// bundle (verified — set equality holds in retail). A sequence's
// mSequenceIdHash is derived data: encodeCgsId(macSequenceId.toUpperCase())
// reproduces every retail hash, so CgsID hashing is uppercase-folded.
//
// On-disk layout (32-bit PC, little-endian; both resources pad with zeros
// to 16-byte alignment, and the stored miResourceSize EXCLUDES that pad):
//   0x2E — fixed 0x1C8 struct (raw 0x1D0): CgsID hash, char[13] name,
//   3 pad bytes, miPriority, miResourceSize (always 0x1C8), miParamCount,
//   HudMessageParamTypes[8], miMessageCount, then a FIXED array of 8
//   message slots (0x30 each). Slots beyond miMessageCount are not zeroed —
//   they carry the default-initialised pattern (id 0, length 5 s, all eight
//   param ids -1), which the parser asserts and the writer regenerates.
//   0x2F — miResourceSize, count, mppcResources (file-relative, always
//   0x10 — the wiki doesn't document the 4 pad bytes at 0xC that precede
//   the pointer array), count u32 name pointers, then the char[13] names
//   packed back-to-back (unaligned 13-byte stride).
//
// Round-trip strategy: counts, sizes, and name pointers are recomputed from
// the arrays on write; the parser asserts the stored values match the rigid
// layout (throwing instead of mis-parsing) so the writer's recomputation is
// provably byte-exact. Pads observed 0 are asserted 0 (tails) or preserved
// verbatim in _-prefixed fields (header pads), matching propPhysics.

import { BinReader, BinWriter } from './binTools';

// =============================================================================
// Enumerations
// =============================================================================

// CgsGui::HudMessageParamTypes — element type of maeParams. Retail sequences
// use no parameters (miParamCount 0, every slot UNUSED). The COUNT sentinel
// (7) is not a real value and is deliberately omitted.
export const HUD_MESSAGE_PARAM_TYPES = [
	{ value: 0, label: 'Unused' },
	{ value: 1, label: 'String' },
	{ value: 2, label: 'Int' },
	{ value: 3, label: 'Float' },
	{ value: 4, label: 'Money' },
	{ value: 5, label: 'Time' },
	{ value: 6, label: 'String ID' },
] as const;

// =============================================================================
// Types
// =============================================================================

export type HudMessageSequenceMessage = {
	/** CgsID of the HUD Message to display (uppercase-folded name hash). */
	mMessageId: bigint;
	/** Time to display the message in seconds. Retail always uses 5. */
	mfMessageLength: number; // f32
	/** Parameter IDs 1 — always -1 in retail (sequences pass no params). */
	maiParam1Ids: number[]; // i32[4]
	/** Parameter IDs 2 — always -1 in retail. */
	maiParam2Ids: number[]; // i32[4]
	/** Record pad at +0x2C — preserved verbatim (0 in retail). */
	_pad2C: number; // u32
};

export type ParsedHudMessageSequence = {
	/** CgsID — equals encodeCgsId(macSequenceId.toUpperCase()) in every retail resource. */
	mSequenceIdHash: bigint;
	/** Sequence name, max 12 chars (char[13] on disk, NUL-padded). */
	macSequenceId: string;
	/** Name-field alignment pad at 0x15 — preserved verbatim (0 in retail). */
	_pad15: [number, number, number];
	/** Always 1 in retail. */
	miPriority: number;
	/** Number of used maeParams slots. Always 0 in retail. */
	miParamCount: number;
	/** HudMessageParamTypes[8] — fixed array; all Unused (0) in retail. */
	maeParams: number[];
	/** The active messages (first miMessageCount of the 8 on-disk slots). */
	messages: HudMessageSequenceMessage[];
};

export type ParsedHudMessageSequenceDictionary = {
	/** Sequence names (each ≤ 12 chars) — the macSequenceId of every 0x2E resource in the bundle. */
	sequenceNames: string[];
	/** Undocumented header pad at 0xC, before the pointer array — preserved verbatim (0 in retail). */
	_pad0C: number;
};

// =============================================================================
// Constants
// =============================================================================

// char[13]: 12 usable chars + NUL — same cap CgsID encoding has.
const NAME_FIELD_SIZE = 13;
export const MAX_NAME_CHARS = NAME_FIELD_SIZE - 1;
export const SEQUENCE_MESSAGE_SLOTS = 8;
export const SEQUENCE_PARAM_SLOTS = 8;
const MESSAGE_RECORD_SIZE = 0x30;
const MESSAGES_OFFSET = 0x48;
// miResourceSize stores the struct size, NOT the padded resource size.
const SEQ_STRUCT_SIZE = MESSAGES_OFFSET + SEQUENCE_MESSAGE_SLOTS * MESSAGE_RECORD_SIZE; // 0x1C8
const DICT_PTR_ARRAY_OFFSET = 0x10;
export const DEFAULT_MESSAGE_LENGTH_SECONDS = 5;

const align16 = (n: number) => (n + 15) & ~15;

// =============================================================================
// Shared helpers
// =============================================================================

function decodeFixedName(bytes: Uint8Array, what: string): string {
	const nul = bytes.indexOf(0);
	if (nul === -1) {
		throw new Error(`HudMessageSequences: ${what} is not NUL-terminated within ${bytes.length} bytes`);
	}
	for (let i = nul + 1; i < bytes.length; i++) {
		if (bytes[i] !== 0) {
			throw new Error(`HudMessageSequences: ${what} has non-zero bytes after the NUL terminator`);
		}
	}
	return String.fromCharCode(...bytes.subarray(0, nul));
}

function assertZeroTail(raw: Uint8Array, from: number, what: string) {
	for (let i = from; i < raw.byteLength; i++) {
		if (raw[i] !== 0) {
			throw new Error(`HudMessageSequences: ${what} has a non-zero alignment-pad byte at 0x${i.toString(16)}`);
		}
	}
}

// =============================================================================
// HudMessageSequence (0x2E)
// =============================================================================

export function parseHudMessageSequence(raw: Uint8Array, littleEndian = true): ParsedHudMessageSequence {
	if (raw.byteLength !== align16(SEQ_STRUCT_SIZE)) {
		throw new Error(`HudMessageSequence: resource is 0x${raw.byteLength.toString(16)} bytes, expected 0x${align16(SEQ_STRUCT_SIZE).toString(16)} (fixed-size struct + 16-byte alignment pad)`);
	}
	const r = new BinReader(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength), littleEndian);

	const mSequenceIdHash = r.readU64();
	const macSequenceId = decodeFixedName(raw.subarray(0x8, 0x8 + NAME_FIELD_SIZE), 'macSequenceId');
	r.position = 0x15;
	const _pad15: [number, number, number] = [r.readU8(), r.readU8(), r.readU8()];
	const miPriority = r.readI32();
	const miResourceSize = r.readI32();
	if (miResourceSize !== SEQ_STRUCT_SIZE) {
		throw new Error(`HudMessageSequence: miResourceSize is 0x${miResourceSize.toString(16)}, expected 0x${SEQ_STRUCT_SIZE.toString(16)} (rigid fixed-size layout)`);
	}
	const miParamCount = r.readI32();
	const maeParams: number[] = [];
	for (let i = 0; i < SEQUENCE_PARAM_SLOTS; i++) maeParams.push(r.readI32());
	const miMessageCount = r.readI32();
	if (miMessageCount < 0 || miMessageCount > SEQUENCE_MESSAGE_SLOTS) {
		throw new Error(`HudMessageSequence: miMessageCount ${miMessageCount} outside 0..${SEQUENCE_MESSAGE_SLOTS}`);
	}

	const messages: HudMessageSequenceMessage[] = [];
	for (let slot = 0; slot < SEQUENCE_MESSAGE_SLOTS; slot++) {
		r.position = MESSAGES_OFFSET + slot * MESSAGE_RECORD_SIZE;
		const mMessageId = r.readU64();
		const mfMessageLength = r.readF32();
		const maiParam1Ids = [r.readI32(), r.readI32(), r.readI32(), r.readI32()];
		const maiParam2Ids = [r.readI32(), r.readI32(), r.readI32(), r.readI32()];
		const _pad2C = r.readU32();
		if (slot < miMessageCount) {
			messages.push({ mMessageId, mfMessageLength, maiParam1Ids, maiParam2Ids, _pad2C });
		} else {
			// Unused slots are default-initialised, not zeroed: length 5 s and
			// param ids -1 with only the id cleared. The writer regenerates this
			// pattern, so any deviation must fail the parse instead of being
			// silently dropped.
			const isDefault = mMessageId === 0n
				&& mfMessageLength === DEFAULT_MESSAGE_LENGTH_SECONDS
				&& maiParam1Ids.every((v) => v === -1)
				&& maiParam2Ids.every((v) => v === -1)
				&& _pad2C === 0;
			if (!isDefault) {
				throw new Error(`HudMessageSequence: unused message slot ${slot} deviates from the default-initialised pattern`);
			}
		}
	}

	assertZeroTail(raw, SEQ_STRUCT_SIZE, 'HudMessageSequence');

	return { mSequenceIdHash, macSequenceId, _pad15, miPriority, miParamCount, maeParams, messages };
}

export function writeHudMessageSequence(model: ParsedHudMessageSequence, littleEndian = true): Uint8Array {
	if (model.macSequenceId.length > MAX_NAME_CHARS) {
		throw new Error(`HudMessageSequence writer: macSequenceId "${model.macSequenceId}" exceeds ${MAX_NAME_CHARS} chars`);
	}
	if (model.maeParams.length !== SEQUENCE_PARAM_SLOTS) {
		throw new Error(`HudMessageSequence writer: maeParams has ${model.maeParams.length} entries, the on-disk array is fixed at ${SEQUENCE_PARAM_SLOTS}`);
	}
	if (model.messages.length > SEQUENCE_MESSAGE_SLOTS) {
		throw new Error(`HudMessageSequence writer: ${model.messages.length} messages exceed the fixed ${SEQUENCE_MESSAGE_SLOTS} on-disk slots`);
	}

	const totalSize = align16(SEQ_STRUCT_SIZE);
	const w = new BinWriter(totalSize, littleEndian);
	w.writeU64(model.mSequenceIdHash);
	w.writeFixedString(model.macSequenceId, NAME_FIELD_SIZE);
	for (const b of model._pad15) w.writeU8(b);
	w.writeI32(model.miPriority);
	w.writeI32(SEQ_STRUCT_SIZE); // miResourceSize — excludes the alignment pad
	w.writeI32(model.miParamCount);
	for (const p of model.maeParams) w.writeI32(p);
	w.writeI32(model.messages.length); // miMessageCount

	for (let slot = 0; slot < SEQUENCE_MESSAGE_SLOTS; slot++) {
		const msg = model.messages[slot];
		if (msg) {
			if (msg.maiParam1Ids.length !== 4 || msg.maiParam2Ids.length !== 4) {
				throw new Error(`HudMessageSequence writer: messages[${slot}] param-id arrays must each have exactly 4 entries`);
			}
			w.writeU64(msg.mMessageId);
			w.writeF32(msg.mfMessageLength);
			for (const v of msg.maiParam1Ids) w.writeI32(v);
			for (const v of msg.maiParam2Ids) w.writeI32(v);
			w.writeU32(msg._pad2C);
		} else {
			w.writeU64(0n);
			w.writeF32(DEFAULT_MESSAGE_LENGTH_SECONDS);
			for (let i = 0; i < 8; i++) w.writeI32(-1);
			w.writeU32(0);
		}
	}

	if (w.offset !== SEQ_STRUCT_SIZE) {
		throw new Error(`HudMessageSequence writer: struct ends at 0x${w.offset.toString(16)}, expected 0x${SEQ_STRUCT_SIZE.toString(16)}`);
	}
	w.writeZeroes(totalSize - SEQ_STRUCT_SIZE);
	return w.bytes;
}

// =============================================================================
// HudMessageSequenceDictionary (0x2F)
// =============================================================================

export function parseHudMessageSequenceDictionary(raw: Uint8Array, littleEndian = true): ParsedHudMessageSequenceDictionary {
	const r = new BinReader(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength), littleEndian);
	const miResourceSize = r.readI32();
	const numSequences = r.readI32();
	const mppcResources = r.readU32();
	const _pad0C = r.readU32();
	if (mppcResources !== DICT_PTR_ARRAY_OFFSET) {
		throw new Error(`HudMessageSequenceDictionary: mppcResources is 0x${mppcResources.toString(16)}, expected 0x${DICT_PTR_ARRAY_OFFSET.toString(16)} (rigid layout)`);
	}
	const namesStart = DICT_PTR_ARRAY_OFFSET + numSequences * 4;
	const structSize = namesStart + numSequences * NAME_FIELD_SIZE;
	if (numSequences < 0 || miResourceSize !== structSize) {
		throw new Error(`HudMessageSequenceDictionary: miResourceSize 0x${miResourceSize.toString(16)} != derived 0x${structSize.toString(16)} for ${numSequences} names`);
	}
	if (raw.byteLength !== align16(structSize)) {
		throw new Error(`HudMessageSequenceDictionary: resource is 0x${raw.byteLength.toString(16)} bytes, expected 0x${align16(structSize).toString(16)} (struct + 16-byte alignment pad)`);
	}

	const sequenceNames: string[] = [];
	for (let i = 0; i < numSequences; i++) {
		const ptr = r.readU32();
		const expected = namesStart + i * NAME_FIELD_SIZE;
		if (ptr !== expected) {
			throw new Error(`HudMessageSequenceDictionary: name pointer [${i}] is 0x${ptr.toString(16)}, expected 0x${expected.toString(16)} (names pack at a 13-byte stride)`);
		}
	}
	for (let i = 0; i < numSequences; i++) {
		const at = namesStart + i * NAME_FIELD_SIZE;
		sequenceNames.push(decodeFixedName(raw.subarray(at, at + NAME_FIELD_SIZE), `sequenceNames[${i}]`));
	}

	assertZeroTail(raw, structSize, 'HudMessageSequenceDictionary');

	return { sequenceNames, _pad0C };
}

export function writeHudMessageSequenceDictionary(model: ParsedHudMessageSequenceDictionary, littleEndian = true): Uint8Array {
	for (const name of model.sequenceNames) {
		if (name.length > MAX_NAME_CHARS) {
			throw new Error(`HudMessageSequenceDictionary writer: name "${name}" exceeds ${MAX_NAME_CHARS} chars`);
		}
	}
	const count = model.sequenceNames.length;
	const namesStart = DICT_PTR_ARRAY_OFFSET + count * 4;
	const structSize = namesStart + count * NAME_FIELD_SIZE;
	const totalSize = align16(structSize);

	const w = new BinWriter(totalSize, littleEndian);
	w.writeI32(structSize); // miResourceSize — excludes the alignment pad
	w.writeI32(count);
	w.writeU32(DICT_PTR_ARRAY_OFFSET); // mppcResources
	w.writeU32(model._pad0C);
	for (let i = 0; i < count; i++) w.writeU32(namesStart + i * NAME_FIELD_SIZE);
	for (const name of model.sequenceNames) w.writeFixedString(name, NAME_FIELD_SIZE);

	if (w.offset !== structSize) {
		throw new Error(`HudMessageSequenceDictionary writer: struct ends at 0x${w.offset.toString(16)}, expected 0x${structSize.toString(16)}`);
	}
	w.writeZeroes(totalSize - structSize);
	return w.bytes;
}
