// CommsToolListDefinition parser and writer (resource type 0x45).
//
// Part of the Comms Database — Burnout Paradise's server-pushed gameplay
// tuning. The game downloads small bundles into the DOWNLOADED folder; a
// *definition* (this type, e.g. GAMEPLAY.BIN) declares the field schema —
// which named values exist and at which byte offset — and a sibling
// CommsToolList (0x46, e.g. GAMEPLAYDATA.BIN) carries the actual values as
// an opaque payload only interpretable through its definition. The link is
// by hash: a list's mNameHash equals the definition's mDefinitionNameHash
// and its mVersionHash equals the definition's mVersionHash (both verified
// on the retail DOWNLOADED pair; the wiki documents the version-hash match).
//
// On-disk layout (32-bit PC, little-endian), GAMEPLAY.BIN fixture:
//   0x00 u32 pointer → unknown-hash chunk        (always 0x40)
//   0x04 u32 pointer → category-name-hash chunk
//   0x08 u32 pointer → field-name-hash chunk
//   0x0C u32 pointer → field-offset chunk
//   0x10 u32 definition name hash   — languageHash('Gameplay') etc.
//   0x14 u32 number of fields       — one entry per field in EACH chunk
//   0x18 u32 list data length       — byte size of the 0x46 payload
//   0x1C u32 version hash           — purpose unknown; the 0x46 link key
//   0x20 u32 definition resource length (end of the last chunk, pre-pad)
//   0x24 zero pad to 0x40, then the four u32[numFields] chunks, each
//   zero-padded to 16-byte alignment, then zero pad to a 16-byte total.
//
// The four chunks are parallel arrays — fields[i] zips entry i of each.
// Category and field-name hashes are Language hashes (JAMCRC) of strings in
// the executable; all 205 Gameplay fields match the wiki's Definitions
// subpage exactly, including the chunk the wiki calls "unknown hashes",
// whose values match the wiki's per-field Unknown column but hash no string
// we know of (NOT the JAMCRC of the field name — that's the third chunk).
//
// Round-trip strategy: pointers, count, and resource length are recomputed
// from fields.length on write; the parser asserts the stored values match
// the rigid 16-byte-aligned layout and that every pad byte is zero, so the
// model carries no verbatim blobs at all.

import { BinReader, BinWriter } from './binTools';

// =============================================================================
// Types
// =============================================================================

export type CommsToolFieldDefinition = {
	/** Per-field hash of unknown derivation — matches the wiki's "Unknown" column. Preserved verbatim. */
	mUnknownHash: number; // u32
	/** languageHash of the category name (e.g. 'ServerControls', 'TakedownPhysics'). */
	mCategoryNameHash: number; // u32
	/** languageHash of the field name (e.g. 'TEMP_EXTRA_CAR_36'). */
	mFieldNameHash: number; // u32
	/** Byte offset of this field's value inside the CommsToolList data payload. */
	mOffset: number; // u32
};

export type ParsedCommsToolListDefinition = {
	/** languageHash of the definition name — 'Gameplay', 'Car', 'Motorbike', or 'PassThePadDef' in retail. */
	mDefinitionNameHash: number; // u32
	/** Purpose unknown (wiki: "version hash?"); a CommsToolList links to its definition by matching this. */
	mVersionHash: number; // u32
	/** Byte length of the data payload in CommsToolList resources using this definition.
	 *  Also determines the LAST field's length — field sizes are not stored, they are
	 *  the gaps between consecutive offsets. */
	mListDataLength: number; // u32
	/** Parallel-chunk field table, in chunk order (retail stores offsets ascending). */
	fields: CommsToolFieldDefinition[];
};

// =============================================================================
// Constants
// =============================================================================

const HEADER_SIZE = 0x24;
// The header struct is 0x24 bytes but the first chunk always starts at 0x40
// (header zero-padded to 16-byte alignment x2 in retail; asserted, regenerated).
const CHUNKS_OFFSET = 0x40;

// Wiki "Version names" table — provenance notes for known version hashes.
// The hashes are not derivable from any known string; treat as opaque ids.
export const COMMS_VERSION_HASH_NOTES: Record<number, string> = {
	0xd34014f7: 'Gameplay (v1.3)',
	0x1931a153: 'Gameplay (v1.4+, PC, PC Remastered)',
	0x1425be7a: 'Motorbike (v1.4-v1.6, PC v1.0)',
	0xd7a6f29e: 'Car (v1.6+, PC)',
	0x260ae5e0: 'PassThePadDef (v1.6+, PC)',
	0xe4e4ada7: 'Motorbike (v1.7+, PC v1.1, PC Remastered)',
	0x51ad1b08: 'Gameplay (PS4 Remastered)',
	0x1a6c99a7: 'PassThePadDef (PS4 Remastered)',
	0xb5911e4e: 'Car (PS4 Remastered)',
	0xd261313c: 'Motorbike (PS4 Remastered)',
};

const align16 = (n: number) => (n + 15) & ~15;

function assertZeroRange(raw: Uint8Array, from: number, to: number, what: string) {
	for (let i = from; i < to; i++) {
		if (raw[i] !== 0) {
			throw new Error(`CommsToolListDefinition: ${what} has a non-zero pad byte at 0x${i.toString(16)}`);
		}
	}
}

/** File-relative start offsets of the four chunks for a given field count. */
function chunkOffsets(numFields: number): [number, number, number, number] {
	const stride = align16(numFields * 4);
	return [CHUNKS_OFFSET, CHUNKS_OFFSET + stride, CHUNKS_OFFSET + stride * 2, CHUNKS_OFFSET + stride * 3];
}

// =============================================================================
// Reader
// =============================================================================

export function parseCommsToolListDefinition(raw: Uint8Array, littleEndian = true): ParsedCommsToolListDefinition {
	if (raw.byteLength < CHUNKS_OFFSET) {
		throw new Error(`CommsToolListDefinition: resource is ${raw.byteLength} bytes, smaller than the 0x40-byte header block`);
	}
	const r = new BinReader(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength), littleEndian);

	const pUnknownHashes = r.readU32();
	const pCategoryNameHashes = r.readU32();
	const pFieldNameHashes = r.readU32();
	const pFieldOffsets = r.readU32();
	const mDefinitionNameHash = r.readU32();
	const numFields = r.readU32();
	const mListDataLength = r.readU32();
	const mVersionHash = r.readU32();
	const definitionResourceLength = r.readU32();

	// The layout is rigid; bail loudly on violations rather than silently
	// producing a model that won't round-trip.
	const [expUnk, expCat, expField, expOff] = chunkOffsets(numFields);
	const pairs: [string, number, number][] = [
		['unknown-hash chunk pointer', pUnknownHashes, expUnk],
		['category-hash chunk pointer', pCategoryNameHashes, expCat],
		['field-name-hash chunk pointer', pFieldNameHashes, expField],
		['field-offset chunk pointer', pFieldOffsets, expOff],
	];
	for (const [what, got, expected] of pairs) {
		if (got !== expected) {
			throw new Error(`CommsToolListDefinition: ${what} is 0x${got.toString(16)}, expected 0x${expected.toString(16)} for ${numFields} fields (rigid 16-byte-aligned chunks)`);
		}
	}
	const structEnd = expOff + numFields * 4;
	if (definitionResourceLength !== structEnd) {
		throw new Error(`CommsToolListDefinition: stored resource length 0x${definitionResourceLength.toString(16)} != derived 0x${structEnd.toString(16)}`);
	}
	if (raw.byteLength !== align16(structEnd)) {
		throw new Error(`CommsToolListDefinition: resource is 0x${raw.byteLength.toString(16)} bytes, expected 0x${align16(structEnd).toString(16)} (struct + 16-byte alignment pad)`);
	}

	assertZeroRange(raw, HEADER_SIZE, CHUNKS_OFFSET, 'header');
	assertZeroRange(raw, expUnk + numFields * 4, expCat, 'unknown-hash chunk');
	assertZeroRange(raw, expCat + numFields * 4, expField, 'category-hash chunk');
	assertZeroRange(raw, expField + numFields * 4, expOff, 'field-name-hash chunk');
	assertZeroRange(raw, structEnd, raw.byteLength, 'trailing');

	const fields: CommsToolFieldDefinition[] = [];
	for (let i = 0; i < numFields; i++) {
		r.position = pUnknownHashes + i * 4;
		const mUnknownHash = r.readU32();
		r.position = pCategoryNameHashes + i * 4;
		const mCategoryNameHash = r.readU32();
		r.position = pFieldNameHashes + i * 4;
		const mFieldNameHash = r.readU32();
		r.position = pFieldOffsets + i * 4;
		const mOffset = r.readU32();
		if (mOffset >= mListDataLength) {
			throw new Error(`CommsToolListDefinition: fields[${i}] offset 0x${mOffset.toString(16)} is outside the 0x${mListDataLength.toString(16)}-byte list payload`);
		}
		fields.push({ mUnknownHash, mCategoryNameHash, mFieldNameHash, mOffset });
	}

	return { mDefinitionNameHash, mVersionHash, mListDataLength, fields };
}

// =============================================================================
// Writer
// =============================================================================

export function writeCommsToolListDefinition(model: ParsedCommsToolListDefinition, littleEndian = true): Uint8Array {
	const n = model.fields.length;
	for (let i = 0; i < n; i++) {
		if (model.fields[i].mOffset >= model.mListDataLength) {
			throw new Error(`CommsToolListDefinition writer: fields[${i}] offset 0x${model.fields[i].mOffset.toString(16)} is outside the 0x${model.mListDataLength.toString(16)}-byte list payload`);
		}
	}

	const [pUnk, pCat, pField, pOff] = chunkOffsets(n);
	const structEnd = pOff + n * 4;
	const totalSize = align16(structEnd);
	const w = new BinWriter(totalSize, littleEndian);

	w.writeU32(pUnk);
	w.writeU32(pCat);
	w.writeU32(pField);
	w.writeU32(pOff);
	w.writeU32(model.mDefinitionNameHash);
	w.writeU32(n);
	w.writeU32(model.mListDataLength);
	w.writeU32(model.mVersionHash);
	w.writeU32(structEnd); // definition resource length — excludes the final pad
	if (w.offset !== HEADER_SIZE) {
		throw new Error(`CommsToolListDefinition writer: header ends at 0x${w.offset.toString(16)}, expected 0x${HEADER_SIZE.toString(16)}`);
	}
	w.writeZeroes(CHUNKS_OFFSET - HEADER_SIZE);

	// The four parallel chunks, each zero-padded to 16-byte alignment.
	const chunks: [(f: CommsToolFieldDefinition) => number, number][] = [
		[(f) => f.mUnknownHash, pCat],
		[(f) => f.mCategoryNameHash, pField],
		[(f) => f.mFieldNameHash, pOff],
		[(f) => f.mOffset, structEnd],
	];
	for (const [pick, end] of chunks) {
		for (const field of model.fields) w.writeU32(pick(field));
		w.writeZeroes(end - w.offset);
	}
	if (w.offset !== structEnd) {
		throw new Error(`CommsToolListDefinition writer: chunks end at 0x${w.offset.toString(16)}, expected 0x${structEnd.toString(16)}`);
	}
	w.writeZeroes(totalSize - structEnd);
	return w.bytes;
}
