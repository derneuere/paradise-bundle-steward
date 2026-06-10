// WheelList parser and writer (resource type 0x10009).
//
// The global wheel catalogue (WHEELLIST.BUNDLE): one resource ("B5WheelList")
// listing every wheel in Burnout Paradise — 172 entries in retail. Each entry
// pairs a CgsID with a human-readable wheel name (e.g. "0Spoke_02_18_650",
// spokes_variant_rimInches_widthMm). The CgsID is NOT a hash of that name:
// it encodes a separate ≤12-char wheel CODE — decodeCgsId(mId) for
// "0Spoke_02_18_650" yields "00218650", which is exactly the code in the
// wheel's graphics bundle filename (WHE_00218650_GR.BNDL) and in the
// WheelGraphicsSpec resource name inside it ("00218650_Graphics"). The codes
// are authored, not mechanically derivable from the name (bike wheels like
// "0Bike_01_17_600GP8" → "08011773" break every simple stripping rule), so
// mId is modeled as independent editable data with no derive hook.
//
// On-disk layout (32-bit PC, little-endian):
//   header 0x10: muNumWheels u32, mpEntries u32 (file-relative, always 0x10),
//   mu16BytePad u64 (0 in retail) — then muNumWheels entries of 0x48 each:
//   CgsID u64 + char[64] wheel name. Retail entries exactly fill the resource
//   (0x10 + 172*0x48 = 0x3070) with no trailing pad, and every name field is
//   zero-filled after its NUL (asserted on parse so the writer's zero-fill is
//   provably byte-exact).
//
// Round-trip strategy: muNumWheels/mpEntries are recomputed from the entries
// array on write; the header pad and any trailing bytes are preserved
// verbatim in _-prefixed fields.

import { BinReader, BinWriter } from './binTools';

// =============================================================================
// Types
// =============================================================================

export type WheelListEntry = {
	/** CgsID of the wheel code — decodeCgsId(mId) names the WHE_<code>_GR.BNDL graphics bundle. */
	mId: bigint;
	/** Wheel name, max 63 chars (char[64] on disk, NUL-padded). */
	macWheelName: string;
};

export type ParsedWheelList = {
	entries: WheelListEntry[];
	/** Header pad at 0x8 (wiki: mu16BytePad) — 0 in retail, preserved verbatim. */
	_pad08: Uint8Array;
	/** Bytes after the last entry — empty in retail, preserved verbatim. */
	_trailingPad: Uint8Array;
};

// =============================================================================
// Constants
// =============================================================================

const HEADER_SIZE = 0x10;
const ENTRY_SIZE = 0x48;
const NAME_FIELD_SIZE = 0x40;
export const MAX_WHEEL_NAME_CHARS = NAME_FIELD_SIZE - 1;

// =============================================================================
// Reader
// =============================================================================

export function parseWheelList(raw: Uint8Array, littleEndian = true): ParsedWheelList {
	// Copy up front: extractResourceRaw may hand back a Node Buffer view whose
	// .buffer is the whole bundle file — slicing by byteOffset keeps this safe.
	const bytes = new Uint8Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
	const r = new BinReader(bytes.buffer, littleEndian);

	const muNumWheels = r.readU32();
	const mpEntries = r.readU32();
	const _pad08 = bytes.slice(0x8, 0x10);

	// The layout is rigid; bail loudly on violations rather than silently
	// producing a model that won't round-trip.
	if (mpEntries !== HEADER_SIZE) {
		throw new Error(`WheelList: mpEntries is 0x${mpEntries.toString(16)}, expected 0x10 (rigid layout)`);
	}
	const entriesEnd = HEADER_SIZE + muNumWheels * ENTRY_SIZE;
	if (entriesEnd > bytes.byteLength) {
		throw new Error(`WheelList: ${muNumWheels} entries overrun the ${bytes.byteLength}-byte resource`);
	}

	const entries: WheelListEntry[] = [];
	r.position = HEADER_SIZE;
	for (let i = 0; i < muNumWheels; i++) {
		const mId = r.readU64();
		const nameStart = HEADER_SIZE + i * ENTRY_SIZE + 8;
		const nameBytes = bytes.subarray(nameStart, nameStart + NAME_FIELD_SIZE);
		const nul = nameBytes.indexOf(0);
		if (nul < 0) {
			throw new Error(`WheelList: entry ${i} name field has no NUL terminator`);
		}
		// The writer zero-fills after the NUL; assert retail does too so the
		// round-trip is provably byte-exact (it does — all 172 entries).
		for (let j = nul; j < NAME_FIELD_SIZE; j++) {
			if (nameBytes[j] !== 0) {
				throw new Error(`WheelList: entry ${i} has non-zero byte 0x${nameBytes[j].toString(16)} after the name NUL at +0x${j.toString(16)}`);
			}
		}
		entries.push({ mId, macWheelName: new TextDecoder().decode(nameBytes.subarray(0, nul)) });
		r.position = nameStart + NAME_FIELD_SIZE;
	}

	return {
		entries,
		_pad08,
		_trailingPad: bytes.slice(entriesEnd),
	};
}

// =============================================================================
// Writer
// =============================================================================

export function writeWheelList(model: ParsedWheelList, littleEndian = true): Uint8Array {
	if (model._pad08.byteLength !== 8) {
		throw new Error(`WheelList writer: _pad08 must be 8 bytes, got ${model._pad08.byteLength}`);
	}
	const entriesEnd = HEADER_SIZE + model.entries.length * ENTRY_SIZE;
	const w = new BinWriter(entriesEnd + model._trailingPad.byteLength, littleEndian);

	w.writeU32(model.entries.length);
	w.writeU32(HEADER_SIZE); // mpEntries — recomputed, never stored
	w.writeBytes(model._pad08);

	const encoder = new TextEncoder();
	for (const [i, entry] of model.entries.entries()) {
		const encoded = encoder.encode(entry.macWheelName);
		if (encoded.byteLength > MAX_WHEEL_NAME_CHARS) {
			throw new Error(`WheelList writer: entry ${i} name "${entry.macWheelName}" exceeds ${MAX_WHEEL_NAME_CHARS} bytes`);
		}
		w.writeU64(entry.mId);
		w.writeBytes(encoded);
		w.writeZeroes(NAME_FIELD_SIZE - encoded.byteLength);
	}
	if (w.offset !== entriesEnd) {
		throw new Error(`WheelList writer: entries end at 0x${w.offset.toString(16)}, expected 0x${entriesEnd.toString(16)}`);
	}

	if (model._trailingPad.byteLength > 0) w.writeBytes(model._trailingPad);

	return w.bytes;
}
