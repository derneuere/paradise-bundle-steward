// WorldPainter2D parser and writer (resource type 0x30).
//
// A WorldPainter2D resource is a dense 2D byte grid painted over the world
// map: one byte per map cell naming which district (DISTRICTS.DAT) or
// ambience zone (SOUND/AMBIENCES.DAT — the ambient-audio palette) that cell
// belongs to. Both retail fixtures share the container byte-for-byte in
// shape: identical 98,336-byte decompressed size, wrapper, 384x256 grid, and
// 12-byte trailing pad — only the palette the cell bytes index differs, and
// which palette applies lives ONLY in the debug name (Districts / Ambiences),
// exactly like StaticSoundMap's emitter/passby roles. The runtime
// (CgsWorld::WorldMap2D) scales the grid over the world using HARDCODED
// origin/size values — no world bounds are stored in the resource. Row 0 is
// the map's north edge and x grows eastward: in retail DISTRICTS the White
// Mountain districts (11–13) hug the west columns and the Big Surf Island
// districts (18–22) the east columns.
//
// On-disk layout (32-bit PC, little-endian):
//   0x00 u32 mu32DataSize    — bytes after mu32DataOffset, INCLUDING the
//                              trailing alignment pad (0x18010 in retail)
//   0x04 u32 mu32DataOffset  — 0x10 in retail
//   0x08 u8[8]               — pad to the 16-byte data offset (zero in retail)
//   0x10 u16 muWidth         — 384 in retail v1.4+ (256 in v1.0)
//   0x12 u16 muHeight        — 256
//   0x14 u8[w*h]             — row-major cell grid
//   ...  u8[]                — zero pad to a 16-byte-aligned total
//
// Wiki divergence: the World_Painter_2D page tables muWidth/muHeight at
// offset 0x0. That ignores the CgsResource::BinaryFileResource wrapper its
// own note mentions ("begin with a Binary File resource") — the real file
// offsets are +0x10. The wiki's BinaryFile page documents only 8 header
// bytes; the observed mu32DataOffset of 0x10 shows the header is padded to
// 16 bytes, and mu32DataSize counts the trailing pad (4 + 384*256 + 12).
//
// Cell values in DISTRICTS.DAT are BrnWorld::EDistrict indices 0..22 — all
// 23 valid districts of the v1.9/Remastered enum, including the Big Surf
// Island five — plus 0xFF for "no district". The enum's own invalid marker
// is E_DISTRICT_VALID_COUNT (23), but on disk invalid is always 0xFF (the
// wiki documents this substitution). 42% of retail cells are 0xFF (ocean
// and out-of-bounds margins).
//
// Cell values in AMBIENCES.DAT are ambience-zone indices 0..20 (every value
// in that range is painted) plus the same 0xFF unpainted sentinel (46% of
// cells). No name table exists for them — neither the wiki nor the resource
// names ambiences; the ids presumably index ambient-audio zone definitions
// in the sound data. The retail map is NOT an independent painting: on the
// mainland (district cells 0..17) the ambience byte equals the district byte
// in 44,523 of 44,534 cells — ambience zones 0..17 simply mirror the
// mainland districts. Big Surf Island breaks the mirror: its five districts
// (18–22) are repainted with only three ambiences (18–20), with sparser
// coverage (3,418 island district cells are ambience-unpainted).
//
// Round-trip strategy: the layout is rigid — the parser THROWS when the
// stored wrapper fields disagree with the derived ones instead of silently
// mis-parsing. mu32DataSize/mu32DataOffset are recomputed on write; the
// wrapper pad and trailing pad are preserved verbatim for byte-exact output.

import { BinReader, BinWriter } from './binTools';

// =============================================================================
// Enumerations
// =============================================================================

// BrnWorld::EDistrict, v1.9/Remastered revision (the only one matching the
// 0..22 values observed in retail DISTRICTS.DAT). Earlier revisions stop at
// 17 (v1.0–1.3) or call 18–20 "Island 1/2/3" (v1.4–1.8). Only meaningful for
// the Districts resource — an Ambiences resource reuses the container with
// ambience indices instead.
export const DISTRICT_NAMES = [
	'Ocean View',
	'West Acres',
	'Twin Bridges',
	'Big Surf Beach',
	'Eastern Shore',
	'Hillside Pass',
	'Heartbreak Hills',
	'Rockridge Cliffs',
	'South Bay',
	'Park Vale',
	'Paradise Wharf',
	'Crystal Summit',
	'Lone Peaks',
	'Sunset Valley',
	'Downtown',
	'River City',
	'Motor City',
	'Waterfront',
	'Paradise Keys Bridge',
	'North Beach',
	'Midtown',
	'South Coast',
	"Perren's Point",
] as const;

/** On-disk "nothing painted here" — NOT the enum's E_DISTRICT_INVALID (23). */
export const INVALID_CELL = 0xff;

/** Ambience-zone ids painted in retail AMBIENCES.DAT run 0..20, every value
 *  used. No name table exists (wiki has none); ids 0..17 mirror the mainland
 *  districts cell-for-cell, 18..20 cover Big Surf Island. */
export const AMBIENCE_INDEX_COUNT = 21;

// =============================================================================
// Variant discrimination
// =============================================================================

/** Which palette the cell bytes index. Not stored in the resource — the two
 *  retail containers are byte-identical in shape. */
export type WorldPainter2DVariant = 'districts' | 'ambiences';

/** Resolve the variant from the resource's debug name, the ONLY discriminator
 *  (retail names the resources exactly "Districts" / "Ambiences"). Returns
 *  null for unknown names so callers fall back to palette-neutral labels. */
export function worldPainter2DVariantFromName(debugName: string): WorldPainter2DVariant | null {
	const n = debugName.toLowerCase();
	if (n === 'districts') return 'districts';
	if (n === 'ambiences') return 'ambiences';
	return null;
}

// =============================================================================
// Types
// =============================================================================

export type ParsedWorldPainter2D = {
	/** Grid width in cells (cells per row). Retail v1.4+: 384. */
	muWidth: number; // u16
	/** Grid height in cells (number of rows). Retail: 256. */
	muHeight: number; // u16
	/**
	 * Row-major muWidth*muHeight cell bytes, row 0 = north edge, x eastward.
	 * Each byte is a DISTRICT_NAMES index (Districts) or an ambience index
	 * (Ambiences); 0xFF = cell belongs to nothing.
	 */
	cells: Uint8Array;
	/** BinaryFile wrapper bytes 0x8..0xF (zero in retail) — preserved verbatim. */
	_wrapperPad: Uint8Array;
	/** Zero pad from end-of-grid to the 16-byte-aligned end — preserved verbatim. */
	_trailingPad: Uint8Array;
};

// =============================================================================
// Constants
// =============================================================================

// CgsResource::BinaryFileResource header: 8 documented bytes padded out to
// the 16-byte mu32DataOffset every retail resource stores.
const WRAPPER_FIELDS_SIZE = 0x8;
const DATA_OFFSET = 0x10;
const GRID_HEADER_SIZE = 0x4; // muWidth + muHeight

// =============================================================================
// Reader
// =============================================================================

export function parseWorldPainter2D(raw: Uint8Array, littleEndian = true): ParsedWorldPainter2D {
	if (raw.byteLength < DATA_OFFSET + GRID_HEADER_SIZE) {
		throw new Error(`WorldPainter2D: ${raw.byteLength}-byte resource is smaller than the wrapper + grid header`);
	}
	// One ArrayBuffer copy up front; the model's byte fields slice from it.
	// Slicing `raw` directly would alias when raw is a Node Buffer (zlib
	// decompression output) — Buffer.prototype.slice returns a view.
	const copy = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
	const bytes = new Uint8Array(copy);
	const r = new BinReader(copy, littleEndian);

	// --- BinaryFile wrapper ---
	const mu32DataSize = r.readU32();
	const mu32DataOffset = r.readU32();
	// The layout is rigid; bail loudly on violations rather than silently
	// producing a model that won't round-trip.
	if (mu32DataOffset !== DATA_OFFSET) {
		throw new Error(`WorldPainter2D: mu32DataOffset is 0x${mu32DataOffset.toString(16)}, expected 0x10 (rigid layout)`);
	}
	if (mu32DataSize !== raw.byteLength - DATA_OFFSET) {
		throw new Error(`WorldPainter2D: mu32DataSize ${mu32DataSize} != ${raw.byteLength - DATA_OFFSET} (resource size minus data offset)`);
	}
	const _wrapperPad = bytes.slice(WRAPPER_FIELDS_SIZE, DATA_OFFSET);

	// --- Grid ---
	r.position = DATA_OFFSET;
	const muWidth = r.readU16();
	const muHeight = r.readU16();
	const gridEnd = DATA_OFFSET + GRID_HEADER_SIZE + muWidth * muHeight;
	if (gridEnd > raw.byteLength) {
		throw new Error(`WorldPainter2D: ${muWidth}x${muHeight} grid overruns the ${raw.byteLength}-byte resource`);
	}
	const cells = bytes.slice(DATA_OFFSET + GRID_HEADER_SIZE, gridEnd);

	// --- Trailing pad (zeros to 16-byte alignment) — captured verbatim. ---
	const _trailingPad = gridEnd < raw.byteLength ? bytes.slice(gridEnd, raw.byteLength) : new Uint8Array(0);

	return { muWidth, muHeight, cells, _wrapperPad, _trailingPad };
}

// =============================================================================
// Writer
// =============================================================================

export function writeWorldPainter2D(model: ParsedWorldPainter2D, littleEndian = true): Uint8Array {
	if (model.cells.byteLength !== model.muWidth * model.muHeight) {
		throw new Error(`WorldPainter2D writer: ${model.cells.byteLength} cells != ${model.muWidth}x${model.muHeight} grid`);
	}
	if (model._wrapperPad.byteLength !== DATA_OFFSET - WRAPPER_FIELDS_SIZE) {
		throw new Error(`WorldPainter2D writer: wrapper pad is ${model._wrapperPad.byteLength} bytes, expected ${DATA_OFFSET - WRAPPER_FIELDS_SIZE}`);
	}

	const totalSize = DATA_OFFSET + GRID_HEADER_SIZE + model.cells.byteLength + model._trailingPad.byteLength;
	const w = new BinWriter(totalSize, littleEndian);

	// --- BinaryFile wrapper (sizes recomputed, never stored) ---
	w.writeU32(totalSize - DATA_OFFSET); // mu32DataSize — includes the trailing pad
	w.writeU32(DATA_OFFSET);
	w.writeBytes(model._wrapperPad);
	if (w.offset !== DATA_OFFSET) throw new Error(`WorldPainter2D writer: data offset mismatch ${w.offset} vs ${DATA_OFFSET}`);

	// --- Grid ---
	w.writeU16(model.muWidth);
	w.writeU16(model.muHeight);
	w.writeBytes(model.cells);

	// --- Trailing pad (verbatim) — reproduces the exact original length. ---
	if (model._trailingPad.byteLength > 0) w.writeBytes(model._trailingPad);

	if (w.offset !== totalSize) throw new Error(`WorldPainter2D writer: wrote ${w.offset} bytes, expected ${totalSize}`);
	return w.bytes;
}
