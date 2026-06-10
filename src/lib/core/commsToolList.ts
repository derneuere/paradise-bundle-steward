// CommsToolList parser and writer (resource type 0x46), plus the
// cross-resource decoder that interprets its payload through a
// CommsToolListDefinition (0x45).
//
// Part of the Comms Database (server-pushed gameplay tuning in the
// DOWNLOADED folder). A CommsToolList is a header plus an opaque data
// payload; the payload's field names, offsets, and sizes live ONLY in the
// sibling definition resource — a different bundle (GAMEPLAYDATA.BIN's data
// is keyed by GAMEPLAY.BIN's definition). The parser therefore keeps the
// payload verbatim, and decodeCommsToolListData() below is the documented
// mechanism for a future cross-resource editor: pair the two models, match
// their hashes, and zip the definition's offset table over the payload.
//
// How a list references its definition (pinned on the retail pair):
//   - mNameHash   == definition.mDefinitionNameHash == languageHash('Gameplay').
//     The wiki calls this "name hash of the resource name (e.g. PUSMBGP1)",
//     but in the retail DOWNLOADED pair it is NOT the resource's own debug
//     name ('GameplayData') — it is the DEFINITION's name.
//   - mVersionHash == definition.mVersionHash (the wiki-documented link).
//   - data length  == definition.mListDataLength.
//
// On-disk layout (32-bit PC, little-endian), GAMEPLAYDATA.BIN fixture:
//   0x00 u32 name hash
//   0x04 u32 data length
//   0x08 u32 version hash
//   0x0C u32 resource size (0x20 + data length, pre-pad)
//   0x10 u32 data pointer — always 0x20 (the 0x14-byte struct is padded;
//        the wiki documents neither the pad nor the fixed pointer)
//   0x14 zero pad to 0x20, data[length], zero pad to 16-byte alignment.
//
// Round-trip strategy: data length, resource size, and the data pointer are
// recomputed from data.byteLength on write; the parser asserts the stored
// values and that every pad byte is zero, so byte-exactness is structural.

import { BinReader, BinWriter } from './binTools';
import { resolveCommsToolName } from './commsToolNames';
import type { ParsedCommsToolListDefinition } from './commsToolListDefinition';

// =============================================================================
// Types
// =============================================================================

export type ParsedCommsToolList = {
	/** languageHash naming the list — equals the definition's name hash in the retail DOWNLOADED pair. */
	mNameHash: number; // u32
	/** Must match the definition's mVersionHash — the documented definition link. */
	mVersionHash: number; // u32
	/** The opaque value payload. Only interpretable through the definition's field table. */
	data: Uint8Array;
};

/** One payload field decoded through a definition. The on-disk format stores
 *  no type information, so all plausible little-endian readings of the bytes
 *  are offered; which one is meaningful is game-code knowledge (the wiki
 *  types most 4-byte Gameplay fields as float, GRAD_IDs as ints). */
export type DecodedCommsToolField = {
	/** Resolved field name, or null when the hash isn't in the known-name catalogue. */
	fieldName: string | null;
	/** Resolved category name, or null when unknown. */
	categoryName: string | null;
	mFieldNameHash: number;
	mCategoryNameHash: number;
	mUnknownHash: number;
	/** Byte offset into the payload. */
	offset: number;
	/** Derived size: gap to the next-higher field offset (or payload end). */
	length: number;
	/** Copy of the field's payload bytes. */
	bytes: Uint8Array;
	/** Little-endian readings by length; null when the length doesn't fit. */
	asU8: number | null;
	asU32: number | null;
	asF32: number | null;
	asU64: bigint | null;
};

// =============================================================================
// Constants
// =============================================================================

const HEADER_SIZE = 0x14;
const DATA_OFFSET = 0x20;

const align16 = (n: number) => (n + 15) & ~15;

// =============================================================================
// Reader
// =============================================================================

export function parseCommsToolList(raw: Uint8Array, littleEndian = true): ParsedCommsToolList {
	if (raw.byteLength < DATA_OFFSET) {
		throw new Error(`CommsToolList: resource is ${raw.byteLength} bytes, smaller than the 0x20-byte header block`);
	}
	// Copy the buffer up front — extractResourceRaw may hand us a Node Buffer
	// whose .slice would alias the bundle bytes.
	const bytes = new Uint8Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
	const r = new BinReader(bytes.buffer, littleEndian);

	const mNameHash = r.readU32();
	const dataLength = r.readU32();
	const mVersionHash = r.readU32();
	const resourceSize = r.readU32();
	const dataPointer = r.readU32();

	if (dataPointer !== DATA_OFFSET) {
		throw new Error(`CommsToolList: data pointer is 0x${dataPointer.toString(16)}, expected 0x${DATA_OFFSET.toString(16)} (rigid layout)`);
	}
	const structEnd = DATA_OFFSET + dataLength;
	if (resourceSize !== structEnd) {
		throw new Error(`CommsToolList: stored resource size 0x${resourceSize.toString(16)} != derived 0x${structEnd.toString(16)} for a 0x${dataLength.toString(16)}-byte payload`);
	}
	if (bytes.byteLength !== align16(structEnd)) {
		throw new Error(`CommsToolList: resource is 0x${bytes.byteLength.toString(16)} bytes, expected 0x${align16(structEnd).toString(16)} (struct + 16-byte alignment pad)`);
	}
	for (let i = HEADER_SIZE; i < DATA_OFFSET; i++) {
		if (bytes[i] !== 0) throw new Error(`CommsToolList: header has a non-zero pad byte at 0x${i.toString(16)}`);
	}
	for (let i = structEnd; i < bytes.byteLength; i++) {
		if (bytes[i] !== 0) throw new Error(`CommsToolList: non-zero alignment-pad byte at 0x${i.toString(16)}`);
	}

	return {
		mNameHash,
		mVersionHash,
		data: new Uint8Array(bytes.subarray(DATA_OFFSET, structEnd)),
	};
}

// =============================================================================
// Writer
// =============================================================================

export function writeCommsToolList(model: ParsedCommsToolList, littleEndian = true): Uint8Array {
	const structEnd = DATA_OFFSET + model.data.byteLength;
	const totalSize = align16(structEnd);
	const w = new BinWriter(totalSize, littleEndian);

	w.writeU32(model.mNameHash);
	w.writeU32(model.data.byteLength);
	w.writeU32(model.mVersionHash);
	w.writeU32(structEnd); // resource size — excludes the alignment pad
	w.writeU32(DATA_OFFSET);
	w.writeZeroes(DATA_OFFSET - HEADER_SIZE);
	w.writeBytes(model.data);
	if (w.offset !== structEnd) {
		throw new Error(`CommsToolList writer: payload ends at 0x${w.offset.toString(16)}, expected 0x${structEnd.toString(16)}`);
	}
	w.writeZeroes(totalSize - structEnd);
	return w.bytes;
}

// =============================================================================
// Cross-resource decode (list payload × definition field table)
// =============================================================================

/**
 * Interpret a CommsToolList payload through its CommsToolListDefinition.
 * Throws when the pair doesn't actually match (version hash or payload
 * length disagree) — a mismatched decode would silently read garbage.
 *
 * Field lengths are derived, not stored: each field runs from its offset to
 * the next-higher offset in the definition (the last one to the payload
 * end). Results are returned in the definition's field order.
 */
export function decodeCommsToolListData(
	list: ParsedCommsToolList,
	definition: ParsedCommsToolListDefinition,
	littleEndian = true,
): DecodedCommsToolField[] {
	if (list.mVersionHash !== definition.mVersionHash) {
		throw new Error(`decodeCommsToolListData: list version hash 0x${list.mVersionHash.toString(16)} != definition version hash 0x${definition.mVersionHash.toString(16)} — wrong definition for this list`);
	}
	if (list.data.byteLength !== definition.mListDataLength) {
		throw new Error(`decodeCommsToolListData: payload is 0x${list.data.byteLength.toString(16)} bytes but the definition expects 0x${definition.mListDataLength.toString(16)}`);
	}

	const sortedOffsets = definition.fields.map((f) => f.mOffset).sort((a, b) => a - b);
	const nextOffset = new Map<number, number>();
	for (let i = 0; i < sortedOffsets.length; i++) {
		nextOffset.set(sortedOffsets[i], i + 1 < sortedOffsets.length ? sortedOffsets[i + 1] : definition.mListDataLength);
	}

	const view = new DataView(list.data.buffer, list.data.byteOffset, list.data.byteLength);
	return definition.fields.map((f) => {
		const length = (nextOffset.get(f.mOffset) ?? definition.mListDataLength) - f.mOffset;
		return {
			fieldName: resolveCommsToolName(f.mFieldNameHash),
			categoryName: resolveCommsToolName(f.mCategoryNameHash),
			mFieldNameHash: f.mFieldNameHash,
			mCategoryNameHash: f.mCategoryNameHash,
			mUnknownHash: f.mUnknownHash,
			offset: f.mOffset,
			length,
			bytes: new Uint8Array(list.data.subarray(f.mOffset, f.mOffset + length)),
			asU8: length === 1 ? view.getUint8(f.mOffset) : null,
			asU32: length === 4 ? view.getUint32(f.mOffset, littleEndian) : null,
			asF32: length === 4 ? view.getFloat32(f.mOffset, littleEndian) : null,
			asU64: length === 8 ? view.getBigUint64(f.mOffset, littleEndian) : null,
		};
	});
}
