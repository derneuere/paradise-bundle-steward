// MassiveLookupTable parser and writer (resource type 0x1001A).
//
// The lookup table the game used to choose where to display in-game ads
// served by the (now defunct) Massive Incorporated ad network. One retail
// resource exists (MASSIVETABLE.BIN, debug name MassiveTable): 20 items, one
// per ad placement. Each item is a local-space bounding box for the ad quad,
// the ID of the Scene resource the ad lives in, an "IE index" (ad-rotation /
// inventory slot; -1 for placements with no index), and the index of the
// Renderable whose texture the ad replaces. Massive was mostly removed from
// Remastered, though the assets survive in some versions.
//
// On-disk layout (32-bit PC, little-endian):
//   0x00 i32  miNumberItems
//   0x04 u32  mpItems — file-relative offset fixed up to a pointer at load;
//             always 0x10 (the 8-byte header is padded to 16-byte alignment)
//   0x08      8 pad bytes (0 in retail, preserved verbatim)
//   0x10      items, 0x40 each, tiling exactly to the end of the resource:
//     +0x00 Vector3 mBoundingBoxMin (4 f32 lanes; lane 3 unused, 0 in retail)
//     +0x10 Vector3 mBoundingBoxMax (same)
//     +0x20 u64 mSceneID (resource ID of the placement's Scene)
//     +0x28 u32 mpSubscriber (runtime pointer, 0 on disk)
//     +0x2C i32 miIEIndex
//     +0x30 u8  muRenderableIndex
//     +0x31      15 pad bytes (0 in retail, preserved verbatim)
//
// Round-trip strategy: count and mpItems are recomputed from the item array
// on write; the parser asserts the rigid layout (mpItems == 0x10, items tile
// the resource exactly) and throws on violations instead of mis-parsing.
// Unused vector lanes and pad bytes are preserved verbatim in _-prefixed
// fields so the round-trip is byte-exact even if some build stores junk.

import { BinReader, BinWriter } from './binTools';

// =============================================================================
// Types
// =============================================================================

export type MassiveLookupTableItem = {
	/** Local-space AABB min of the ad quad (metres, relative to the scene). */
	mBoundingBoxMin: { x: number; y: number; z: number };
	/** Local-space AABB max of the ad quad. */
	mBoundingBoxMax: { x: number; y: number; z: number };
	/** Resource ID of the Scene this placement belongs to. */
	mSceneId: bigint;
	/** Ad inventory slot index; -1 for placements without one. */
	miIEIndex: number;
	/** Index of the Renderable whose texture the served ad replaces. */
	muRenderableIndex: number;
	/** Unused 4th vpu lane of mBoundingBoxMin (0 in retail) — preserved verbatim. */
	_minW: number;
	/** Unused 4th vpu lane of mBoundingBoxMax (0 in retail) — preserved verbatim. */
	_maxW: number;
	/** Runtime BrnMassiveSubscriber pointer (0 on disk) — preserved verbatim. */
	_mpSubscriber: number;
	/** Item pad at +0x31, 15 bytes (0 in retail) — preserved verbatim. */
	_pad31: Uint8Array;
};

export type ParsedMassiveLookupTable = {
	items: MassiveLookupTableItem[];
	/** Header pad at 0x08, 8 bytes (0 in retail) — preserved verbatim. */
	_pad08: Uint8Array;
};

// =============================================================================
// Constants
// =============================================================================

const ITEMS_OFFSET = 0x10;
const ITEM_RECORD_SIZE = 0x40;
const HEADER_PAD_SIZE = ITEMS_OFFSET - 0x8;
const ITEM_PAD_SIZE = 0x40 - 0x31;

export function makeEmptyMassiveItem(): MassiveLookupTableItem {
	return {
		mBoundingBoxMin: { x: 0, y: 0, z: 0 },
		mBoundingBoxMax: { x: 0, y: 0, z: 0 },
		mSceneId: 0n,
		miIEIndex: -1,
		muRenderableIndex: 0,
		_minW: 0,
		_maxW: 0,
		_mpSubscriber: 0,
		_pad31: new Uint8Array(ITEM_PAD_SIZE),
	};
}

// =============================================================================
// Reader
// =============================================================================

export function parseMassiveLookupTable(raw: Uint8Array, littleEndian = true): ParsedMassiveLookupTable {
	// Copy up front — extractResourceRaw may hand back a Buffer view, and the
	// verbatim pad fields below must not alias the caller's bytes.
	const bytes = new Uint8Array(raw);
	const r = new BinReader(bytes.buffer, littleEndian);

	const miNumberItems = r.readI32();
	const mpItems = r.readU32();
	if (mpItems !== ITEMS_OFFSET) {
		throw new Error(`MassiveLookupTable: mpItems is 0x${mpItems.toString(16)}, expected 0x10 (rigid layout)`);
	}
	if (miNumberItems < 0) {
		throw new Error(`MassiveLookupTable: negative item count ${miNumberItems}`);
	}
	const itemsEnd = ITEMS_OFFSET + miNumberItems * ITEM_RECORD_SIZE;
	if (itemsEnd !== bytes.byteLength) {
		throw new Error(`MassiveLookupTable: ${miNumberItems} items end at 0x${itemsEnd.toString(16)} but the resource is 0x${bytes.byteLength.toString(16)} bytes`);
	}
	const _pad08 = bytes.slice(0x8, ITEMS_OFFSET);

	const items: MassiveLookupTableItem[] = [];
	r.position = ITEMS_OFFSET;
	for (let i = 0; i < miNumberItems; i++) {
		const base = ITEMS_OFFSET + i * ITEM_RECORD_SIZE;
		const mBoundingBoxMin = { x: r.readF32(), y: r.readF32(), z: r.readF32() };
		const _minW = r.readF32();
		const mBoundingBoxMax = { x: r.readF32(), y: r.readF32(), z: r.readF32() };
		const _maxW = r.readF32();
		const mSceneId = r.readU64();
		const _mpSubscriber = r.readU32();
		const miIEIndex = r.readI32();
		const muRenderableIndex = r.readU8();
		const _pad31 = bytes.slice(base + 0x31, base + ITEM_RECORD_SIZE);
		r.position = base + ITEM_RECORD_SIZE;
		items.push({
			mBoundingBoxMin,
			mBoundingBoxMax,
			mSceneId,
			miIEIndex,
			muRenderableIndex,
			_minW,
			_maxW,
			_mpSubscriber,
			_pad31,
		});
	}

	return { items, _pad08 };
}

// =============================================================================
// Writer
// =============================================================================

export function writeMassiveLookupTable(model: ParsedMassiveLookupTable, littleEndian = true): Uint8Array {
	if (model._pad08.byteLength !== HEADER_PAD_SIZE) {
		throw new Error(`MassiveLookupTable writer: _pad08 is ${model._pad08.byteLength} bytes, expected ${HEADER_PAD_SIZE}`);
	}
	const totalSize = ITEMS_OFFSET + model.items.length * ITEM_RECORD_SIZE;
	const w = new BinWriter(totalSize, littleEndian);

	w.writeI32(model.items.length);
	w.writeU32(ITEMS_OFFSET); // mpItems — recomputed, never stored
	w.writeBytes(model._pad08);

	for (const item of model.items) {
		if (item._pad31.byteLength !== ITEM_PAD_SIZE) {
			throw new Error(`MassiveLookupTable writer: item _pad31 is ${item._pad31.byteLength} bytes, expected ${ITEM_PAD_SIZE}`);
		}
		w.writeF32(item.mBoundingBoxMin.x);
		w.writeF32(item.mBoundingBoxMin.y);
		w.writeF32(item.mBoundingBoxMin.z);
		w.writeF32(item._minW);
		w.writeF32(item.mBoundingBoxMax.x);
		w.writeF32(item.mBoundingBoxMax.y);
		w.writeF32(item.mBoundingBoxMax.z);
		w.writeF32(item._maxW);
		w.writeU64(item.mSceneId);
		w.writeU32(item._mpSubscriber);
		w.writeI32(item.miIEIndex);
		w.writeU8(item.muRenderableIndex);
		w.writeBytes(item._pad31);
	}

	if (w.offset !== totalSize) {
		throw new Error(`MassiveLookupTable writer: wrote ${w.offset} bytes, expected ${totalSize}`);
	}
	return w.bytes;
}
