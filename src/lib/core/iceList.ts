// ICE List parser and writer (resource type 0x1000C).
//
// An ICE List holds a flat list of camera-movie IDs. It is an early-development
// type that was superseded by the ICE Take Dictionary (0x41); the wiki documents
// it as the predecessor list-of-movie-IDs resource. The on-disk shape is a
// 16-byte header followed by an array of 8-byte IDs:
//
//   muNumMovies (u32 @0x0)  — number of movie IDs / entries.
//   mpEntries   (u32 @0x4)  — a FILE OFFSET to the entry array (0 when empty).
//                             This is a serialized pointer fixed up at load, so
//                             it is recomputed on write, never trusted: the
//                             array always immediately follows the 16-byte
//                             header, so the offset is 16 when there are entries
//                             and 0 (null) when there are none. This mirrors the
//                             "null when empty, else computed layout offset"
//                             pattern PropInstanceData uses (see
//                             propInstanceData.ts).
//   muPadding   (u64 @0x8)  — trailing header padding. Preserved verbatim so an
//                             untouched resource round-trips byte-exact (the
//                             value is not necessarily zero).
//   ICEListEntry[muNumMovies] — each entry is one CgsID (an 8-byte id) at
//                             offset 0, 8-byte stride. Modelled as bigint.
//
// Scope: 32-bit, little-endian, matching the rest of the core parsers.

import { BinReader, BinWriter } from './binTools';

// =============================================================================
// Constants
// =============================================================================

const HEADER_SIZE = 0x10;     // muNumMovies(4) + mpEntries(4) + muPadding(8)
const ENTRY_STRIDE = 0x8;     // one CgsID per entry
const ENTRIES_OFFSET = HEADER_SIZE; // entry array immediately follows the header

// =============================================================================
// Types
// =============================================================================

export type ParsedIceList = {
	// Trailing header padding (u64 @0x8). Re-emitted verbatim — not asserted to
	// be zero — so the round-trip is byte-exact for any input.
	muPadding: bigint;
	// The movie IDs (CgsIDs, u64 each). muNumMovies is derived from
	// entries.length on write.
	entries: bigint[];
};

// =============================================================================
// Reader
// =============================================================================

export function parseIceList(raw: Uint8Array, littleEndian = true): ParsedIceList {
	const r = new BinReader(
		raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength),
		littleEndian,
	);

	const muNumMovies = r.readU32();
	const mpEntries = r.readU32();
	const muPadding = r.readU64();

	// mpEntries is a load-time-fixed-up file offset, not a count, so it is read
	// for completeness but the array is always located by the rigid layout (it
	// immediately follows the 16-byte header). For a well-formed populated list
	// the two agree (mpEntries == 16); an empty list stores 0 (null).
	void mpEntries;

	const entries: bigint[] = [];
	r.position = ENTRIES_OFFSET;
	for (let i = 0; i < muNumMovies; i++) {
		entries.push(r.readU64());
	}

	return { muPadding, entries };
}

// =============================================================================
// Writer
// =============================================================================

export function writeIceList(model: ParsedIceList, littleEndian = true): Uint8Array {
	const { entries, muPadding } = model;
	const muNumMovies = entries.length;

	const totalSize = HEADER_SIZE + muNumMovies * ENTRY_STRIDE;
	const w = new BinWriter(totalSize, littleEndian);

	// mpEntries is the computed layout offset (16) when entries exist, else null
	// (0) — recomputed, never sourced from the model, so add/remove edits stay
	// consistent and an empty list re-emits the null pointer it shipped with.
	const mpEntries = muNumMovies > 0 ? ENTRIES_OFFSET : 0;

	w.writeU32(muNumMovies);
	w.writeU32(mpEntries);
	w.writeU64(muPadding);
	if (w.offset !== HEADER_SIZE) {
		throw new Error(`IceList writer: header offset mismatch ${w.offset} vs ${HEADER_SIZE}`);
	}

	for (const id of entries) {
		w.writeU64(id);
	}
	if (w.offset !== totalSize) {
		throw new Error(`IceList writer: total offset mismatch ${w.offset} vs ${totalSize}`);
	}

	return w.bytes;
}

// =============================================================================
// Describe
// =============================================================================

export function describeIceList(model: ParsedIceList): string {
	const n = model.entries.length;
	return `${n} movie id${n === 1 ? '' : 's'}`;
}
