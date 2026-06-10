// HudMessage parser and writer (resource type 0x2C, CgsGui::GuiHudMessageResource).
//
// The in-game HUD message catalogue: every message the HUD can flash at the
// player ("TAKEDOWN!", road-rule beaten, challenge complete, …), triggered by
// gameplay events and styled positive/negative/neutral. Retail ships exactly
// ONE resource of this type, in HUDMESSAGES.HM (308 messages). The related
// HudMessageList (0x2D) was a dev-only name index dropped in early 2007 and
// never shipped.
//
// Each message has up to three text lines. The wiki documents them as three
// parallel arrays (maacStringId[3], maiParamCount[3], maaeParams[3][4]); this
// model regroups them into `lines[3]` records because the lanes are strictly
// parallel — verified: in all 308 retail messages, every lane with
// miParamCount > 0 has a non-empty string id on the same lane. A line's
// macStringId is a SYMBOLIC id into the Language (0x27) string table
// (e.g. 'HUDMESSAGE_GENERIC1'); the game hashes it at runtime to find the
// translated text. Params are printf-style substitution slots whose types
// (HUD_MESSAGE_PARAM_TYPES) the triggering code must satisfy.
//
// mMessageIdHash is NOT free data: it equals encodeCgsId(macMessageId
// .toUpperCase()) in every retail record (308/308 verified). The game looks
// messages up by this CgsID, so editors must keep it in sync — the schema
// layer derives it on macMessageId edits; the writer emits the model value
// verbatim so untouched files stay byte-exact.
//
// On-disk layout (32-bit PC, little-endian; the only platform with a
// retail fixture):
//   0x00 GuiHudMessageData** mppHudMessageData  — file-relative, always 0x80
//   0x04 i32 miSizeOfHudMessageResource         — == total resource size
//   0x08 i32 miHudMessageCount
//   0x0C..0x80   zero pad
//   0x80         pointer array, count × u32, each → one record
//   …zero pad to the next 128-byte boundary…
//   recordsStart contiguous GuiHudMessageData records, 0x170 bytes each,
//                tiling exactly to the end of the resource
// With a single retail fixture the section alignment can't be fully
// disambiguated (0x80/0x580 fit both align-128 and "fixed 0x80 + align-64");
// the writer uses align-128 for both, which reproduces the fixture, and the
// parser asserts the derived offsets so violations fail loudly.
//
// Round-trip strategy: pointers/sizes/counts are recomputed from the array on
// write. All char arrays are zero-filled after the terminator in retail (the
// parser asserts this rather than silently dropping bytes). The two pad slots
// inside each record are NOT zero — they hold constant build-tool heap
// garbage (f9 1c 00 at +0x10D, 74 f9 1c 00 at +0x16C in every retail record)
// — preserved verbatim per record in _-prefixed fields.

import { BinReader, BinWriter } from './binTools';

// =============================================================================
// Enumerations
// =============================================================================

/** CgsGui::HudMessageAvailableFields — muAvailabilityBitSet bits. */
export const HUD_MESSAGE_AVAILABILITY_FLAGS = [
	{ mask: 0x01, label: 'Race', description: 'Available in Race events' },
	{ mask: 0x02, label: 'Road Rage', description: 'Available in Road Rage events' },
	{ mask: 0x04, label: 'Showtime', description: 'Available in Showtime' },
	{ mask: 0x08, label: 'Offline', description: 'Available offline' },
	{ mask: 0x10, label: 'Online', description: 'Available online' },
	{ mask: 0x20, label: 'In crash', description: 'Available while crashed' },
] as const;

/** CgsGui::HudMessageGroup — retail uses 1/2/3; ALL (0) never appears. */
export const HUD_MESSAGE_GROUPS = [
	{ value: 0, label: 'All' },
	{ value: 1, label: 'Online live revenge' },
	{ value: 2, label: 'Online dirty tricks' },
	{ value: 3, label: 'In-game messages' },
] as const;

/** CgsGui::HudMessageParamTypes — retail uses Unused/String/Int/Float/StringId;
 *  Money and Time are defined by the game but appear in no retail message. */
export const HUD_MESSAGE_PARAM_TYPES = [
	{ value: 0, label: 'Unused' },
	{ value: 1, label: 'String' },
	{ value: 2, label: 'Int' },
	{ value: 3, label: 'Float' },
	{ value: 4, label: 'Money' },
	{ value: 5, label: 'Time' },
	{ value: 6, label: 'StringId' },
] as const;

// =============================================================================
// Types
// =============================================================================

export type HudMessageLine = {
	/** Language (0x27) string id, e.g. 'HUDMESSAGE_GENERIC1'. '' = unused line. */
	macStringId: string;
	/** Number of leading maeParamTypes entries actually consumed (0–4). */
	miParamCount: number;
	/** Always 4 slots — HUD_MESSAGE_PARAM_TYPES values, Unused (0) past miParamCount. */
	maeParamTypes: number[];
};

export type HudMessage = {
	/** Always exactly 3 lines (fixed-size on disk); unused lines have '' ids. */
	lines: HudMessageLine[];
	/** GUI style key controlling colour/placement, e.g. 'PosMessageBott01'. */
	macMessageStyle: string;
	/** Icon key, 'invisible' for none, 'EventSpecific' to follow the event. */
	macDefaultIcon: string;
	/** Trigger id the game fires messages by, ≤12 chars, e.g. 'AggDrBstStrt'. */
	macMessageId: string;
	/** CgsID — equals encodeCgsId(macMessageId.toUpperCase()) in all retail
	 *  records. The game looks messages up by this, so keep it in sync. */
	mMessageIdHash: bigint;
	/** HUD_MESSAGE_AVAILABILITY_FLAGS bit set. */
	muAvailabilityBitSet: number;
	/** Time the message displays, in seconds. */
	mfDuration: number;
	/** Wait before displaying, in seconds. */
	mfTimeToWait: number;
	/** Percent priority (0–100) for the message queue. */
	miPriority: number;
	/** Priority threshold (0–100) below which a queued message is dropped. */
	miForceRemoveThreshold: number;
	/** HUD_MESSAGE_GROUPS value. */
	meMessageGroup: number;
	/** 3 garbage bytes after macMessageId's nul (constant f9 1c 00 in retail) — verbatim. */
	_padMessageId: [number, number, number];
	/** u32 record tail garbage (constant 0x001cf974 in retail) — verbatim. */
	_padTail: number;
};

export type ParsedHudMessage = {
	messages: HudMessage[];
};

// =============================================================================
// Constants
// =============================================================================

const HEADER_SIZE = 0xc;
const PTR_ARRAY_OFFSET = 0x80;
const SECTION_ALIGN = 128;
const RECORD_SIZE = 0x170;
export const HUD_MESSAGE_LINES = 3;
export const HUD_MESSAGE_PARAMS_PER_LINE = 4;
const STRING_ID_CAP = 64;
const STYLE_CAP = 32;
const ICON_CAP = 32;
const MESSAGE_ID_CAP = 13; // 12 chars + nul

function align(offset: number, to: number): number {
	const mod = offset % to;
	return mod === 0 ? offset : offset + (to - mod);
}

function recordsOffsetFor(count: number): number {
	return align(PTR_ARRAY_OFFSET + count * 4, SECTION_ALIGN);
}

// =============================================================================
// Reader
// =============================================================================

/** Reads a nul-terminated string from a fixed char array, asserting the bytes
 *  after the terminator are zero — true of every retail field, and required
 *  for the writer's zero-fill to round-trip byte-exact. */
function readZeroPaddedString(raw: Uint8Array, offset: number, cap: number, what: string): string {
	const bytes = raw.subarray(offset, offset + cap);
	let nul = bytes.indexOf(0);
	if (nul < 0) nul = cap;
	for (let i = nul + 1; i < cap; i++) {
		if (bytes[i] !== 0) {
			throw new Error(`HudMessage: non-zero byte after terminator in ${what} at +0x${(offset + i).toString(16)}`);
		}
	}
	return new TextDecoder().decode(bytes.subarray(0, nul));
}

function assertZeroRange(raw: Uint8Array, start: number, end: number, what: string) {
	for (let i = start; i < end; i++) {
		if (raw[i] !== 0) {
			throw new Error(`HudMessage: non-zero ${what} pad byte at 0x${i.toString(16)}`);
		}
	}
}

export function parseHudMessage(raw: Uint8Array, littleEndian = true): ParsedHudMessage {
	const r = new BinReader(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength), littleEndian);

	// --- Header ---
	const mppHudMessageData = r.readU32();
	const miSizeOfHudMessageResource = r.readI32();
	const miHudMessageCount = r.readI32();
	if (mppHudMessageData !== PTR_ARRAY_OFFSET) {
		throw new Error(`HudMessage: mppHudMessageData is 0x${mppHudMessageData.toString(16)}, expected 0x${PTR_ARRAY_OFFSET.toString(16)} (rigid layout)`);
	}
	if (miSizeOfHudMessageResource !== raw.byteLength) {
		throw new Error(`HudMessage: miSizeOfHudMessageResource ${miSizeOfHudMessageResource} != resource size ${raw.byteLength}`);
	}
	const recordsStart = recordsOffsetFor(miHudMessageCount);
	if (miHudMessageCount < 0 || recordsStart + miHudMessageCount * RECORD_SIZE !== raw.byteLength) {
		throw new Error(`HudMessage: ${miHudMessageCount} records don't tile [0x${recordsStart.toString(16)}, 0x${raw.byteLength.toString(16)})`);
	}
	assertZeroRange(raw, HEADER_SIZE, PTR_ARRAY_OFFSET, 'header');
	assertZeroRange(raw, PTR_ARRAY_OFFSET + miHudMessageCount * 4, recordsStart, 'pointer-array');

	// --- Pointer array (each entry must point at the canonical record slot) ---
	r.position = PTR_ARRAY_OFFSET;
	for (let i = 0; i < miHudMessageCount; i++) {
		const p = r.readU32();
		const expected = recordsStart + i * RECORD_SIZE;
		if (p !== expected) {
			throw new Error(`HudMessage: record pointer [${i}] = 0x${p.toString(16)}, expected 0x${expected.toString(16)} (canonical order violated)`);
		}
	}

	// --- Records (0x170 each) ---
	const messages: HudMessage[] = [];
	for (let i = 0; i < miHudMessageCount; i++) {
		const base = recordsStart + i * RECORD_SIZE;
		const lines: HudMessageLine[] = [];
		for (let s = 0; s < HUD_MESSAGE_LINES; s++) {
			lines.push({
				macStringId: readZeroPaddedString(raw, base + s * STRING_ID_CAP, STRING_ID_CAP, `message[${i}].lines[${s}].macStringId`),
				miParamCount: 0, // filled from the parallel lane below
				maeParamTypes: [],
			});
		}
		const macMessageStyle = readZeroPaddedString(raw, base + 0xc0, STYLE_CAP, `message[${i}].macMessageStyle`);
		const macDefaultIcon = readZeroPaddedString(raw, base + 0xe0, ICON_CAP, `message[${i}].macDefaultIcon`);
		const macMessageId = readZeroPaddedString(raw, base + 0x100, MESSAGE_ID_CAP, `message[${i}].macMessageId`);
		const _padMessageId: [number, number, number] = [raw[base + 0x10d], raw[base + 0x10e], raw[base + 0x10f]];

		r.position = base + 0x110;
		const mMessageIdHash = r.readU64();
		const muAvailabilityBitSet = r.readU32();
		const mfDuration = r.readF32();
		const mfTimeToWait = r.readF32();
		const miPriority = r.readI32();
		const miForceRemoveThreshold = r.readI32();
		const meMessageGroup = r.readI32();
		for (let s = 0; s < HUD_MESSAGE_LINES; s++) lines[s].miParamCount = r.readI32();
		for (let s = 0; s < HUD_MESSAGE_LINES; s++) {
			for (let p = 0; p < HUD_MESSAGE_PARAMS_PER_LINE; p++) lines[s].maeParamTypes.push(r.readU32());
		}
		const _padTail = r.readU32();
		if (r.position !== base + RECORD_SIZE) {
			throw new Error(`HudMessage: record[${i}] decoded ${r.position - base} bytes, expected 0x${RECORD_SIZE.toString(16)}`);
		}

		messages.push({
			lines,
			macMessageStyle,
			macDefaultIcon,
			macMessageId,
			mMessageIdHash,
			muAvailabilityBitSet,
			mfDuration,
			mfTimeToWait,
			miPriority,
			miForceRemoveThreshold,
			meMessageGroup,
			_padMessageId,
			_padTail,
		});
	}

	return { messages };
}

// =============================================================================
// Writer
// =============================================================================

function checkedString(value: string, cap: number, what: string): string {
	// cap - 1 leaves room for the terminator BinWriter.writeFixedString adds.
	if (new TextEncoder().encode(value).length > cap - 1) {
		throw new Error(`HudMessage writer: ${what} "${value}" exceeds ${cap - 1} bytes`);
	}
	return value;
}

export function writeHudMessage(model: ParsedHudMessage, littleEndian = true): Uint8Array {
	const { messages } = model;
	const recordsStart = recordsOffsetFor(messages.length);
	const totalSize = recordsStart + messages.length * RECORD_SIZE;
	const w = new BinWriter(totalSize, littleEndian);

	// --- Header + zero pad to the pointer array ---
	w.writeU32(PTR_ARRAY_OFFSET);
	w.writeI32(totalSize);
	w.writeI32(messages.length);
	w.writeZeroes(PTR_ARRAY_OFFSET - HEADER_SIZE);

	// --- Pointer array (recomputed), zero pad to the record region ---
	for (let i = 0; i < messages.length; i++) w.writeU32(recordsStart + i * RECORD_SIZE);
	w.writeZeroes(recordsStart - w.offset);
	if (w.offset !== recordsStart) throw new Error(`HudMessage writer: records offset mismatch ${w.offset} vs ${recordsStart}`);

	// --- Records ---
	messages.forEach((m, i) => {
		if (m.lines.length !== HUD_MESSAGE_LINES) {
			throw new Error(`HudMessage writer: message[${i}] has ${m.lines.length} lines, the on-disk record holds exactly ${HUD_MESSAGE_LINES}`);
		}
		const base = w.offset;
		for (const line of m.lines) {
			w.writeFixedString(checkedString(line.macStringId, STRING_ID_CAP, `message[${i}] string id`), STRING_ID_CAP);
		}
		w.writeFixedString(checkedString(m.macMessageStyle, STYLE_CAP, `message[${i}] style`), STYLE_CAP);
		w.writeFixedString(checkedString(m.macDefaultIcon, ICON_CAP, `message[${i}] icon`), ICON_CAP);
		w.writeFixedString(checkedString(m.macMessageId, MESSAGE_ID_CAP, `message[${i}] message id`), MESSAGE_ID_CAP);
		w.writeU8(m._padMessageId[0]);
		w.writeU8(m._padMessageId[1]);
		w.writeU8(m._padMessageId[2]);
		w.writeU64(m.mMessageIdHash);
		w.writeU32(m.muAvailabilityBitSet);
		w.writeF32(m.mfDuration);
		w.writeF32(m.mfTimeToWait);
		w.writeI32(m.miPriority);
		w.writeI32(m.miForceRemoveThreshold);
		w.writeI32(m.meMessageGroup);
		for (const line of m.lines) w.writeI32(line.miParamCount);
		for (const line of m.lines) {
			if (line.maeParamTypes.length !== HUD_MESSAGE_PARAMS_PER_LINE) {
				throw new Error(`HudMessage writer: message[${i}] line has ${line.maeParamTypes.length} param slots, the on-disk record holds exactly ${HUD_MESSAGE_PARAMS_PER_LINE}`);
			}
			for (const p of line.maeParamTypes) w.writeU32(p);
		}
		w.writeU32(m._padTail);
		if (w.offset !== base + RECORD_SIZE) {
			throw new Error(`HudMessage writer: record[${i}] wrote ${w.offset - base} bytes, expected 0x${RECORD_SIZE.toString(16)}`);
		}
	});

	if (w.offset !== totalSize) throw new Error(`HudMessage writer: wrote ${w.offset} bytes, expected ${totalSize}`);
	return w.bytes;
}
