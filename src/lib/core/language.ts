// Language parser and writer (resource type 0x27).
//
// One Language resource per language bundle (LANGUAGE/0001–0014.BUNDLE) holds
// the game's localised strings: a u32 hash of the untranslated string ID maps
// to a NUL-terminated UTF-8 translation. The same hash appears in every
// language bundle, so a single string ID resolves in all 14 languages.
//
// On-disk layout (32-bit PC, little-endian), verified against all 14 retail
// bundles:
//   0x0  meLanguageID  u32   ELanguage value (see ELANGUAGE below)
//   0x4  muSize        u32   entry count
//   0x8  mpEntries     u32   file-relative offset of the entry table — 0xC in
//                            every retail resource (fixed up to a pointer at load)
//   0xC  entries[muSize]     { muHash u32, mpString u32 } — mpString is a
//                            file-relative offset into the string blob
//   then the string blob: NUL-terminated UTF-8, running to the exact end of
//   the resource (no trailing pad after the last NUL).
//
// Facts the wiki doesn't tell you (grounded by the 14-bundle sweep):
// - Entries are ordered by string offset (strictly increasing), NOT by hash.
// - Hashes are unique within a bundle; 0x7E1C1CC8 ("No motion blur") happens
//   to be entry 0 in all 14 retail bundles.
// - Some strings (0–42 per bundle) are followed by exactly 3 extra zero bytes
//   after their terminator — preserved per-entry in `_padAfter`.
// - The LAST entry of every bundle has hash 0x00000000 and a filler string of
//   repeated 'A' characters sized so the resource hits exactly 0xD4800
//   (870,400) bytes — presumably so any language fits one fixed allocation.
//   Two bundles (0001 US, 0006 DE — rebuilt later, newer file dates) overshoot
//   by 3/5 bytes. The filler parses as a normal entry; editors should leave it
//   alone or shrink it to compensate for grown strings.
// - Bundle 0008 stores meLanguageID 12 (E_LANGUAGE_GREEK on the wiki) but its
//   strings are Russian — the wiki's enum label and retail content disagree.
//
// Round-trip strategy: string offsets are never stored in the model — the
// parser asserts the stored table is contiguous (entry 0 starts right after
// the table; each next offset equals the previous string's end + 1 + pad,
// with pad bytes all zero) and the writer rebuilds every offset from the
// re-encoded strings. UTF-8 is decoded with a fatal TextDecoder, so malformed
// input throws instead of silently re-encoding different bytes.

import { BinReader, BinWriter } from './binTools';

// =============================================================================
// Enumerations
// =============================================================================

/** CgsLanguage::Sku::ELanguage — meLanguageID values. Retail PC ships the 14
 *  bundles noted below; the other ids exist in the enum but never on disk. */
export const ELANGUAGE = [
	{ value: 0, label: 'Arabic' },
	{ value: 1, label: 'Chinese' },
	{ value: 2, label: 'Chinese (Simplified)' }, // bundle 0012
	{ value: 3, label: 'Chinese (Traditional)' }, // bundle 0013
	{ value: 4, label: 'Czech' }, // bundle 0010
	{ value: 5, label: 'Danish' },
	{ value: 6, label: 'Dutch' },
	{ value: 7, label: 'English (US)' }, // bundle 0001
	{ value: 8, label: 'English (UK)' }, // bundle 0002
	{ value: 9, label: 'Finnish' },
	{ value: 10, label: 'French' }, // bundle 0003
	{ value: 11, label: 'German' }, // bundle 0006
	// The wiki names value 12 E_LANGUAGE_GREEK, but retail bundle 0008 (the
	// only resource storing 12) contains Russian strings.
	{ value: 12, label: 'Greek (retail: Russian)' }, // bundle 0008
	{ value: 13, label: 'Hebrew' },
	{ value: 14, label: 'Hungarian' }, // bundle 0011
	{ value: 15, label: 'Italian' }, // bundle 0005
	{ value: 16, label: 'Japanese' }, // bundle 0007
	{ value: 17, label: 'Korean' },
	{ value: 18, label: 'Norwegian' },
	{ value: 19, label: 'Polish' }, // bundle 0009
	{ value: 20, label: 'Portuguese (Brazil)' },
	{ value: 21, label: 'Portuguese (Portugal)' },
	{ value: 22, label: 'Spanish' }, // bundle 0004
	{ value: 23, label: 'Swedish' },
	{ value: 24, label: 'Thai' }, // bundle 0014
] as const;

export function languageName(id: number): string {
	return ELANGUAGE.find((l) => l.value === id)?.label ?? `language ${id}`;
}

// =============================================================================
// Types
// =============================================================================

export type LanguageEntry = {
	/** u32 hash of the untranslated string ID — the lookup key the game uses.
	 *  Same hash in every language bundle. 0x00000000 marks the filler entry. */
	muHash: number;
	/** The translated string (decoded UTF-8, no terminator). */
	text: string;
	/** Extra zero bytes after this string's NUL terminator (0 or 3 in retail) —
	 *  preserved verbatim so the round-trip stays byte-exact. */
	_padAfter: number;
};

export type ParsedLanguage = {
	/** ELanguage value — which language this bundle carries. */
	meLanguageID: number;
	/** All strings in disk (string-blob) order, filler entry included. */
	entries: LanguageEntry[];
};

// =============================================================================
// Constants
// =============================================================================

const HEADER_SIZE = 0xc;
const ENTRY_RECORD_SIZE = 0x8;
// mpEntries is 0xC in every retail resource — the table follows the header
// immediately, and the blob follows the table immediately.
const ENTRIES_OFFSET = HEADER_SIZE;

// =============================================================================
// Reader
// =============================================================================

export function parseLanguage(raw: Uint8Array, littleEndian = true): ParsedLanguage {
	if (raw.byteLength < HEADER_SIZE) {
		throw new Error(`Language: resource is ${raw.byteLength} bytes, smaller than the 0xC header`);
	}
	const r = new BinReader(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength), littleEndian);

	const meLanguageID = r.readU32();
	const muSize = r.readU32();
	const mpEntries = r.readU32();
	if (mpEntries !== ENTRIES_OFFSET) {
		throw new Error(`Language: mpEntries is 0x${mpEntries.toString(16)}, expected 0xC (rigid layout)`);
	}
	const blobStart = ENTRIES_OFFSET + muSize * ENTRY_RECORD_SIZE;
	if (blobStart > raw.byteLength) {
		throw new Error(`Language: ${muSize} entries overrun the ${raw.byteLength}-byte resource`);
	}

	// Decode with fatal=true: malformed UTF-8 would silently re-encode to
	// different bytes and break the round-trip, so it must throw here instead.
	const decoder = new TextDecoder('utf-8', { fatal: true });

	const table: { muHash: number; mpString: number }[] = [];
	for (let i = 0; i < muSize; i++) {
		table.push({ muHash: r.readU32(), mpString: r.readU32() });
	}

	// Walk the table asserting the derived layout matches the stored one: the
	// blob must tile [blobStart, end) exactly with string+NUL+pad runs in table
	// order, because the writer rebuilds every offset from that assumption.
	const entries: LanguageEntry[] = [];
	let cursor = blobStart;
	for (let i = 0; i < muSize; i++) {
		const { muHash, mpString } = table[i];
		if (mpString !== cursor) {
			throw new Error(`Language: entry ${i} string offset 0x${mpString.toString(16)} != derived 0x${cursor.toString(16)} (blob must be contiguous in table order)`);
		}
		let end = mpString;
		while (end < raw.byteLength && raw[end] !== 0) end++;
		if (end >= raw.byteLength) {
			throw new Error(`Language: entry ${i} string at 0x${mpString.toString(16)} is missing its NUL terminator`);
		}
		let text: string;
		try {
			text = decoder.decode(raw.subarray(mpString, end));
		} catch {
			throw new Error(`Language: entry ${i} string at 0x${mpString.toString(16)} is not valid UTF-8`);
		}

		// Pad runs to the next entry's stored offset (or the resource end for
		// the last entry). Anything non-zero there would be an unreferenced
		// string the model can't represent — fail loudly.
		const next = i + 1 < muSize ? table[i + 1].mpString : raw.byteLength;
		const _padAfter = next - (end + 1);
		if (_padAfter < 0) {
			throw new Error(`Language: entry ${i} string overlaps entry ${i + 1} (ends 0x${(end + 1).toString(16)}, next starts 0x${next.toString(16)})`);
		}
		for (let b = end + 1; b < next; b++) {
			if (raw[b] !== 0) {
				throw new Error(`Language: non-zero byte 0x${raw[b].toString(16)} in the pad after entry ${i}`);
			}
		}
		entries.push({ muHash, text, _padAfter });
		cursor = next;
	}
	if (cursor !== raw.byteLength) {
		throw new Error(`Language: blob ends at 0x${cursor.toString(16)}, expected 0x${raw.byteLength.toString(16)} (must tile exactly)`);
	}

	return { meLanguageID, entries };
}

// =============================================================================
// Writer
// =============================================================================

export function writeLanguage(model: ParsedLanguage, littleEndian = true): Uint8Array {
	const { entries } = model;
	const encoder = new TextEncoder();

	const encoded: Uint8Array[] = entries.map((e, i) => {
		if (e.text.includes('\0')) {
			throw new Error(`Language writer: entry ${i} text contains an embedded NUL — the blob is NUL-terminated, so the string would truncate in game`);
		}
		if (!Number.isInteger(e._padAfter) || e._padAfter < 0) {
			throw new Error(`Language writer: entry ${i} _padAfter ${e._padAfter} must be a non-negative integer`);
		}
		return encoder.encode(e.text);
	});

	const blobStart = ENTRIES_OFFSET + entries.length * ENTRY_RECORD_SIZE;
	const blobSize = encoded.reduce((n, bytes, i) => n + bytes.length + 1 + entries[i]._padAfter, 0);
	const w = new BinWriter(blobStart + blobSize, littleEndian);

	w.writeU32(model.meLanguageID);
	w.writeU32(entries.length);
	w.writeU32(ENTRIES_OFFSET);

	// Table — offsets rebuilt from the encoded lengths, never trusted from the
	// model (variable-length strings shift everything after an edit).
	let cursor = blobStart;
	for (let i = 0; i < entries.length; i++) {
		w.writeU32(entries[i].muHash);
		w.writeU32(cursor);
		cursor += encoded[i].length + 1 + entries[i]._padAfter;
	}
	if (w.offset !== blobStart) throw new Error(`Language writer: blob offset mismatch ${w.offset} vs ${blobStart}`);

	for (let i = 0; i < entries.length; i++) {
		w.writeBytes(encoded[i]);
		w.writeZeroes(1 + entries[i]._padAfter);
	}
	if (w.offset !== cursor) throw new Error(`Language writer: wrote ${w.offset} bytes, expected ${cursor}`);

	return w.bytes;
}
