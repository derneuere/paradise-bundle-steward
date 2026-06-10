// GuiPopup parser and writer (resource type 0x1F).
//
// Card-styled popup messages the game shows at specific moments — leaving an
// online room, confirming a friend delete, video-option warnings, the
// FreeBurn splash cards. One resource game-wide, in GUI/POPUPS.PUP.
//
// Text is NOT stored here: macTitleId / macMessageId / macButton*Id are
// char[32] ASCII KEYS into the Language resource's string table (e.g.
// 'ONLINE_FRIENDS_CONFIRM_DELETE'), unlike resources that reference language
// strings by numeric id. Some retail keys carry a '~' prefix (e.g.
// '~ONLINE_SYNCHING_KICKED'); its runtime meaning is unconfirmed. An empty
// key means "no title" / "no button". mNameId is the popup's CgsID — always
// encodeCgsId(macName.toUpperCase()) in retail (all 111 popups verified) —
// which is what game code uses to summon a popup by name.
//
// On-disk layout (32-bit PC, little-endian):
//   header 0x8 : mppPopupData u32 (always 0x40), miPopupCount i16,
//                miSizeOfPopupResource i16 — the TOTAL resource byte size
//                (21824 in retail), not the size of one popup as the wiki
//                field name suggests. Zero pad to 0x40.
//   0x40       : u32 file-relative record offsets ×count (fixed up to
//                GuiPopup* pointers at load), zero-padded to a 16-byte
//                boundary. The lone retail fixture (111 popups) pads 4 bytes;
//                8-byte alignment would produce identical bytes there, so 16
//                is a choice — it matches bundle resource alignment and the
//                parser/writer agree on it either way.
//   records    : GuiPopup ×count, 0xC0 each, contiguous in pointer order,
//                tiling exactly to the end of the resource.
//
// Round-trip strategy: the layout is rigid — every offset is recomputed from
// popups.length on write and the parser THROWS if stored pointers disagree.
// String buffers are asserted NUL-terminated with all-zero tails (true for
// every retail string), so the writer's zero-fill is byte-exact. The record
// pads at +0x15 (zero in retail), +0xB1 and +0xB9 (the SAME uninitialised
// garbage bytes f9 4f 00 / df 9c 00 e0 24 9d 00 in all 111 retail records —
// build-machine memory copied into every struct) are preserved verbatim in
// _-prefixed fields.

import { BinReader, BinWriter } from './binTools';

// =============================================================================
// Enumerations
// =============================================================================

// CgsGui::PopupStyle — selects the popup frame, placement, and button bar.
// CrashNav styles render in the front-end nav, InGame styles over gameplay;
// "wait" variants have no buttons (dismissed by code), splash styles (9) are
// the full-screen online mode cards. Values 14/15 are the v1.9+ Big Surf
// Island additions (the v1.0–1.8 enum ended at 13 = Custom).
export const POPUP_STYLES = [
	{ value: 0, label: 'CrashNav — wait', description: 'E_POPUPSTYLE_CRASHNAV_WAIT' },
	{ value: 1, label: 'CrashNav — OK', description: 'E_POPUPSTYLE_CRASHNAV_OK' },
	{ value: 2, label: 'CrashNav — OK/Cancel', description: 'E_POPUPSTYLE_CRASHNAV_OKCANCEL' },
	{ value: 3, label: 'CrashNav online — wait', description: 'E_POPUPSTYLE_CRASHNAV_ONLINE_WAIT' },
	{ value: 4, label: 'CrashNav online — OK', description: 'E_POPUPSTYLE_CRASHNAV_ONLINE_OK' },
	{ value: 5, label: 'CrashNav online — OK/Cancel', description: 'E_POPUPSTYLE_CRASHNAV_ONLINE_OKCANCEL' },
	{ value: 6, label: 'In-game — wait', description: 'E_POPUPSTYLE_INGAME_WAIT' },
	{ value: 7, label: 'In-game — OK', description: 'E_POPUPSTYLE_INGAME_OK' },
	{ value: 8, label: 'In-game — OK/Cancel', description: 'E_POPUPSTYLE_INGAME_OKCANCEL' },
	{ value: 9, label: 'In-game online — splash', description: 'E_POPUPSTYLE_INGAME_ONLINE_WAIT' },
	{ value: 10, label: 'In-game online — OK', description: 'E_POPUPSTYLE_INGAME_ONLINE_OK' },
	{ value: 11, label: 'In-game online — OK/Cancel', description: 'E_POPUPSTYLE_INGAME_ONLINE_OKCANCEL' },
	{ value: 12, label: 'Enter FreeBurn', description: 'E_POPUPSTYLE_INGAME_ONLINE_ENTER_FREEBURN' },
	{ value: 13, label: 'Custom', description: 'E_POPUPSTYLE_CUSTOM' },
	{ value: 14, label: 'Island — enter (in-game)', description: 'v1.9+ IslandPopUp; name unknown on the wiki' },
	{ value: 15, label: 'Island — buy (in-game)', description: 'v1.9+ IslandPopUp; name unknown on the wiki' },
] as const;

export const POPUP_ICONS = [
	{ value: 0, label: 'Invisible', description: 'E_POPUPICONS_INVISIBLE' },
	{ value: 1, label: 'Warning', description: 'E_POPUPICONS_WARNING' },
] as const;

export const POPUP_PARAM_TYPES = [
	{ value: 0, label: 'Unused', description: 'E_POPUPPARAMTYPES_UNUSED' },
	{ value: 1, label: 'String', description: 'E_POPUPPARAMTYPES_STRING — runtime substitutes a raw string' },
	{ value: 2, label: 'String ID', description: 'E_POPUPPARAMTYPES_STRING_ID — runtime substitutes another Language string' },
] as const;

export function popupStyleLabel(value: number): string {
	return POPUP_STYLES.find((s) => s.value === value)?.label ?? `style ${value}`;
}

/**
 * miMessageParamsUsed as retail derives it: the count of leading non-Unused
 * entries in maeMessageParams. Holds for all 111 retail popups — including
 * the (1,2) / (2,2) two-param messages and the (2,0) one-param ones.
 */
export function countMessageParamsUsed(params: readonly [number, number]): number {
	return params[0] === 0 ? 0 : params[1] === 0 ? 1 : 2;
}

// =============================================================================
// Types
// =============================================================================

export type GuiPopup = {
	/** CgsID — base-40 packed macName.toUpperCase(); how code summons the popup. */
	mNameId: bigint;
	/** Debug name, max 12 chars (char[13] with NUL). */
	macName: string;
	/** POPUP_STYLES — frame, placement, and button bar. */
	meStyle: number;
	/** POPUP_ICONS. */
	meIcon: number;
	/** Language string key for the title; '' = untitled popup. */
	macTitleId: string;
	/** Language string key for the body text. */
	macMessageId: string;
	/** POPUP_PARAM_TYPES ×2 — how runtime fills the message's %1/%2 slots. */
	maeMessageParams: [number, number];
	/** Count of leading non-Unused entries in maeMessageParams (see countMessageParamsUsed). */
	miMessageParamsUsed: number;
	/** Language string key for button 1's caption; '' = no button. */
	macButton1Id: string;
	/** POPUP_PARAM_TYPES — always Unused (0) in retail. */
	meButton1Param: number;
	/** Always false in retail. */
	mbButton1ParamUsed: boolean;
	/** Language string key for button 2's caption; '' = no second button. */
	macButton2Id: string;
	/** POPUP_PARAM_TYPES — always Unused (0) in retail. */
	meButton2Param: number;
	/** Always false in retail. */
	mbButton2ParamUsed: boolean;
	/** Record pad at +0x15 (zero in retail) — preserved verbatim. */
	_pad15: [number, number, number];
	/** Record pad at +0xB1 — uninitialised garbage (f9 4f 00 in every retail record); preserved verbatim. */
	_padB1: [number, number, number];
	/** Record pad at +0xB9 — uninitialised garbage (df 9c 00 e0 24 9d 00 in every retail record); preserved verbatim. */
	_padB9: number[];
};

export type ParsedGuiPopup = {
	popups: GuiPopup[];
};

// =============================================================================
// Constants
// =============================================================================

const HEADER_SIZE = 0x8;
// mppPopupData is 0x40 in retail — the 8-byte header is padded out, likely so
// the pointer array starts on a cache-line boundary.
const PTR_ARRAY_OFFSET = 0x40;
const RECORD_SIZE = 0xc0;
const NAME_BUF = 13;
const KEY_BUF = 32;
// miSizeOfPopupResource is int16_t on the wiki; keep the written size positive
// under that reading. Caps the resource at ~165 popups.
const MAX_RESOURCE_SIZE = 0x7fff;

function align16(n: number): number {
	return (n + 15) & ~15;
}

// =============================================================================
// Reader
// =============================================================================

function readFixedCString(r: BinReader, len: number, what: string): string {
	let s = '';
	let seenNul = false;
	for (let i = 0; i < len; i++) {
		const b = r.readU8();
		if (!seenNul) {
			if (b === 0) seenNul = true;
			else s += String.fromCharCode(b);
		} else if (b !== 0) {
			// A non-zero tail would be silently dropped by the zero-filling
			// writer — bail so round-trip stays provably byte-exact.
			throw new Error(`GuiPopup: ${what} has residue byte 0x${b.toString(16)} after its NUL terminator`);
		}
	}
	if (!seenNul) throw new Error(`GuiPopup: ${what} is not NUL-terminated within ${len} bytes`);
	return s;
}

function readBool8(r: BinReader, what: string): boolean {
	const b = r.readU8();
	if (b !== 0 && b !== 1) throw new Error(`GuiPopup: ${what} is 0x${b.toString(16)}, expected a 0/1 bool`);
	return b === 1;
}

export function parseGuiPopup(raw: Uint8Array, littleEndian = true): ParsedGuiPopup {
	const r = new BinReader(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength), littleEndian);

	// --- GuiPopupResource header ---
	const mppPopupData = r.readU32();
	const miPopupCount = r.readI16();
	const miSizeOfPopupResource = r.readU16();
	if (mppPopupData !== PTR_ARRAY_OFFSET) {
		throw new Error(`GuiPopup: mppPopupData is 0x${mppPopupData.toString(16)}, expected 0x40 (rigid layout)`);
	}
	if (miPopupCount < 0) throw new Error(`GuiPopup: negative popup count ${miPopupCount}`);
	if (miSizeOfPopupResource !== raw.byteLength) {
		throw new Error(`GuiPopup: miSizeOfPopupResource ${miSizeOfPopupResource} != resource size ${raw.byteLength}`);
	}
	for (let i = HEADER_SIZE; i < PTR_ARRAY_OFFSET; i++) {
		if (raw[i] !== 0) throw new Error(`GuiPopup: non-zero header pad byte at 0x${i.toString(16)}`);
	}

	// --- Pointer array (file-relative offsets) + alignment pad ---
	const recordsStart = align16(PTR_ARRAY_OFFSET + miPopupCount * 4);
	if (recordsStart + miPopupCount * RECORD_SIZE !== raw.byteLength) {
		throw new Error(`GuiPopup: ${miPopupCount} records should end at 0x${(recordsStart + miPopupCount * RECORD_SIZE).toString(16)}, resource is 0x${raw.byteLength.toString(16)}`);
	}
	r.position = PTR_ARRAY_OFFSET;
	for (let i = 0; i < miPopupCount; i++) {
		const ptr = r.readU32();
		const expected = recordsStart + i * RECORD_SIZE;
		if (ptr !== expected) {
			throw new Error(`GuiPopup: mppPopupData[${i}] = 0x${ptr.toString(16)}, expected 0x${expected.toString(16)} (canonical order violated)`);
		}
	}
	for (let i = PTR_ARRAY_OFFSET + miPopupCount * 4; i < recordsStart; i++) {
		if (raw[i] !== 0) throw new Error(`GuiPopup: non-zero pointer-array pad byte at 0x${i.toString(16)}`);
	}

	// --- GuiPopup records (0xC0 each, contiguous) ---
	const popups: GuiPopup[] = [];
	for (let i = 0; i < miPopupCount; i++) {
		const start = recordsStart + i * RECORD_SIZE;
		r.position = start;
		const mNameId = r.readU64();
		const macName = readFixedCString(r, NAME_BUF, `popup[${i}].macName`);
		const _pad15: [number, number, number] = [r.readU8(), r.readU8(), r.readU8()];
		const meStyle = r.readU32();
		const meIcon = r.readU32();
		const macTitleId = readFixedCString(r, KEY_BUF, `popup[${i}].macTitleId`);
		const macMessageId = readFixedCString(r, KEY_BUF, `popup[${i}].macMessageId`);
		const maeMessageParams: [number, number] = [r.readU32(), r.readU32()];
		const miMessageParamsUsed = r.readI32();
		const macButton1Id = readFixedCString(r, KEY_BUF, `popup[${i}].macButton1Id`);
		const meButton1Param = r.readU32();
		const mbButton1ParamUsed = readBool8(r, `popup[${i}].mbButton1ParamUsed`);
		const macButton2Id = readFixedCString(r, KEY_BUF, `popup[${i}].macButton2Id`);
		const _padB1: [number, number, number] = [r.readU8(), r.readU8(), r.readU8()];
		const meButton2Param = r.readU32();
		const mbButton2ParamUsed = readBool8(r, `popup[${i}].mbButton2ParamUsed`);
		const _padB9: number[] = [];
		for (let b = 0; b < 7; b++) _padB9.push(r.readU8());
		if (r.position !== start + RECORD_SIZE) {
			throw new Error(`GuiPopup: popup[${i}] decoded ${r.position - start} bytes, record is 0x${RECORD_SIZE.toString(16)}`);
		}
		popups.push({
			mNameId,
			macName,
			meStyle,
			meIcon,
			macTitleId,
			macMessageId,
			maeMessageParams,
			miMessageParamsUsed,
			macButton1Id,
			meButton1Param,
			mbButton1ParamUsed,
			macButton2Id,
			meButton2Param,
			mbButton2ParamUsed,
			_pad15,
			_padB1,
			_padB9,
		});
	}

	return { popups };
}

// =============================================================================
// Writer
// =============================================================================

function writeFixedCString(w: BinWriter, str: string, len: number, what: string): void {
	if (str.length > len - 1) {
		throw new Error(`GuiPopup writer: ${what} "${str}" is ${str.length} chars, max ${len - 1} for a char[${len}]`);
	}
	for (let i = 0; i < len; i++) {
		const code = i < str.length ? str.charCodeAt(i) : 0;
		if (code > 0xff) throw new Error(`GuiPopup writer: ${what} has a non-byte character (code ${code})`);
		w.writeU8(code);
	}
}

export function writeGuiPopup(model: ParsedGuiPopup, littleEndian = true): Uint8Array {
	const { popups } = model;
	// File-relative offsets recomputed from the popup count, never stored.
	const recordsStart = align16(PTR_ARRAY_OFFSET + popups.length * 4);
	const totalSize = recordsStart + popups.length * RECORD_SIZE;
	if (totalSize > MAX_RESOURCE_SIZE) {
		throw new Error(`GuiPopup writer: ${popups.length} popups produce ${totalSize} bytes, overflowing the i16 miSizeOfPopupResource field (max ${MAX_RESOURCE_SIZE})`);
	}

	const w = new BinWriter(totalSize, littleEndian);

	// --- Header + pad to the pointer array ---
	w.writeU32(PTR_ARRAY_OFFSET);
	w.writeI16(popups.length);
	w.writeI16(totalSize); // miSizeOfPopupResource — the whole resource size
	w.writeZeroes(PTR_ARRAY_OFFSET - HEADER_SIZE);

	// --- Pointer array + alignment pad ---
	for (let i = 0; i < popups.length; i++) w.writeU32(recordsStart + i * RECORD_SIZE);
	w.writeZeroes(recordsStart - w.offset);
	if (w.offset !== recordsStart) throw new Error(`GuiPopup writer: records offset mismatch ${w.offset} vs ${recordsStart}`);

	// --- Records ---
	popups.forEach((p, i) => {
		const start = w.offset;
		w.writeU64(p.mNameId);
		writeFixedCString(w, p.macName, NAME_BUF, `popup[${i}].macName`);
		w.writeU8(p._pad15[0]);
		w.writeU8(p._pad15[1]);
		w.writeU8(p._pad15[2]);
		w.writeU32(p.meStyle);
		w.writeU32(p.meIcon);
		writeFixedCString(w, p.macTitleId, KEY_BUF, `popup[${i}].macTitleId`);
		writeFixedCString(w, p.macMessageId, KEY_BUF, `popup[${i}].macMessageId`);
		w.writeU32(p.maeMessageParams[0]);
		w.writeU32(p.maeMessageParams[1]);
		w.writeI32(p.miMessageParamsUsed);
		writeFixedCString(w, p.macButton1Id, KEY_BUF, `popup[${i}].macButton1Id`);
		w.writeU32(p.meButton1Param);
		w.writeU8(p.mbButton1ParamUsed ? 1 : 0);
		writeFixedCString(w, p.macButton2Id, KEY_BUF, `popup[${i}].macButton2Id`);
		w.writeU8(p._padB1[0]);
		w.writeU8(p._padB1[1]);
		w.writeU8(p._padB1[2]);
		w.writeU32(p.meButton2Param);
		w.writeU8(p.mbButton2ParamUsed ? 1 : 0);
		for (let b = 0; b < 7; b++) w.writeU8(p._padB9[b] ?? 0);
		if (w.offset !== start + RECORD_SIZE) {
			throw new Error(`GuiPopup writer: popup[${i}] wrote ${w.offset - start} bytes, record is 0x${RECORD_SIZE.toString(16)}`);
		}
	});

	if (w.offset !== totalSize) throw new Error(`GuiPopup writer: wrote ${w.offset} bytes, expected ${totalSize}`);
	return w.bytes;
}
