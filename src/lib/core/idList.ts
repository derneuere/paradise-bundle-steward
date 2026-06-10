// IdList parser and writer (resource type 0x25, CgsResource::ResourceIdList).
//
// The collision bundle (WORLDCOL.BIN) carries one IdList per track unit —
// 428 in retail, named TRK_CLIL<N> — each listing the resource ids of that
// unit's collision resources. In practice every retail IdList holds exactly
// ONE id, and it is always the sibling PolygonSoupList (0x43) named
// TRK_COL_<N> in the same bundle (verified: a perfect 428↔428 bijection).
// The wiki calls the type redundant for that reason.
//
// Despite the wiki's "Imports: Clustered Mesh / Polygon Soup List" row, the
// retail PC WORLDCOL.BIN registers ZERO envelope import entries on its 0x25
// resources — the ids are plain payload data, so no importTable() hook.
//
// On-disk layout (32-bit PC, little-endian, always 0x20 bytes in retail):
//   header 0x10: mpaIds u32 (file-relative, always 0x10), muNumIds u32,
//   8 pad bytes — then muNumIds resource ids (u64 each), then pad to the end.
//   The pads are UNINITIALISED memory dumped by the bundler, not zeros:
//   every resource has 4 bytes of heap garbage at 0x8 (0x0477_9680-style
//   pointers), and one resource (TRK_CLIL99) has garbage through 0xC AND in
//   the 8 bytes after its id. Both pads are preserved verbatim. Whether the
//   tail is alignment pad or an in-entry u64 (16-byte id stride) is
//   undecidable with muNumIds == 1 everywhere; u64 ids + verbatim tail is
//   the natural reading of the runtime ID* type and round-trips byte-exact.
//
// Round-trip strategy: mpaIds/muNumIds are recomputed from the ids array on
// write; both pads are preserved verbatim in _-prefixed fields.

import { BinReader, BinWriter } from './binTools';

// =============================================================================
// Types
// =============================================================================

export type ParsedIdList = {
	/** Resource ids (u64) of the track unit's collision resources — in retail, always one PolygonSoupList id. */
	ids: bigint[];
	/** Header pad at 0x8 — uninitialised bundler memory, preserved verbatim. */
	_pad08: Uint8Array;
	/** Bytes after the last id (pad to 0x20 in retail) — uninitialised in TRK_CLIL99, preserved verbatim. */
	_trailingPad: Uint8Array;
};

// =============================================================================
// Constants
// =============================================================================

const HEADER_SIZE = 0x10;
const ID_SIZE = 8;

// =============================================================================
// Reader
// =============================================================================

export function parseIdList(raw: Uint8Array, littleEndian = true): ParsedIdList {
	// Copy up front: extractResourceRaw may hand back a Node Buffer view whose
	// .buffer is the whole bundle file — slicing by byteOffset keeps this safe.
	const bytes = new Uint8Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
	const r = new BinReader(bytes.buffer, littleEndian);

	const mpaIds = r.readU32();
	const muNumIds = r.readU32();
	const _pad08 = bytes.slice(0x8, 0x10);

	// The layout is rigid; bail loudly on violations rather than silently
	// producing a model that won't round-trip.
	if (mpaIds !== HEADER_SIZE) {
		throw new Error(`IdList: mpaIds is 0x${mpaIds.toString(16)}, expected 0x10 (rigid layout)`);
	}
	const idsEnd = HEADER_SIZE + muNumIds * ID_SIZE;
	if (idsEnd > bytes.byteLength) {
		throw new Error(`IdList: ${muNumIds} ids overrun the ${bytes.byteLength}-byte resource`);
	}

	const ids: bigint[] = [];
	r.position = HEADER_SIZE;
	for (let i = 0; i < muNumIds; i++) ids.push(r.readU64());

	return {
		ids,
		_pad08,
		_trailingPad: bytes.slice(idsEnd),
	};
}

// =============================================================================
// Writer
// =============================================================================

export function writeIdList(model: ParsedIdList, littleEndian = true): Uint8Array {
	if (model._pad08.byteLength !== 8) {
		throw new Error(`IdList writer: _pad08 must be 8 bytes, got ${model._pad08.byteLength}`);
	}
	const idsEnd = HEADER_SIZE + model.ids.length * ID_SIZE;
	const w = new BinWriter(idsEnd + model._trailingPad.byteLength, littleEndian);

	w.writeU32(HEADER_SIZE); // mpaIds — recomputed, never stored
	w.writeU32(model.ids.length);
	w.writeBytes(model._pad08);
	for (const id of model.ids) w.writeU64(id);
	if (model._trailingPad.byteLength > 0) w.writeBytes(model._trailingPad);

	return w.bytes;
}
