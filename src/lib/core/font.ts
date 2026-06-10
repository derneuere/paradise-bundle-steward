// Font parser and writer (resource type 0x21, CgsResource::Font).
//
// A Font links UTF-16 code units to glyph rectangles on one or more texture
// atlas pages so text consumers (Apt UI scripts, debug text) can lay out and
// render strings. Each retail .FONT bundle carries exactly one Font plus one
// Texture (the first atlas page); fonts with a second page import that page's
// Texture from ANOTHER bundle by resource id.
//
// Glyph → atlas mapping: mTopLeftUV / mDimensionsUV are normalized [0..1]
// texture coordinates on the page mu16TexturePageId — multiply by the bound
// texture's pixel dimensions to recover the glyph's atlas rect. Non-renderable
// chars (spaces) store the (-1,-1) UV sentinel and only contribute mfAdvance.
// mStart is the render offset of the glyph quad from the pen position and
// mfAdvance the pen advance, both in the same UV-scaled units (mScaleUV
// converts them to glyph space; for most fonts mScaleUV * muFontHeightInPixels
// equals the atlas pixel dimensions exactly, but not for the Thai pair).
//
// Char lookup is a 128-bucket hash: bucket = charId & 0x7F. The char array is
// stored grouped by ascending bucket and mauHashOffsets[129] holds the bucket
// boundaries (h[b]..h[b+1]) with h[128] == numChars. The table is fully
// derivable from the char order — the parser validates it and the writer
// recomputes it, throwing if the array is no longer bucket-grouped.
//
// On-disk element order (NOT documented on the wiki, grounded by sweeping all
// 26 retail FONT bundles):
//   header(0x24C) → pad4 → texture ptr slots @0x250 (u32 × numPages) →
//   charIds @align16 (u16 × numChars) → FontChars @align32 (0x20 each) →
//   inline BND2 import table @mSizeOfFont (16 bytes per page).
// The import table binds each texture ptr slot (keyed by the slot's byte
// offset) to a Texture resource id. Slot 0 is always 0 on disk, but the
// second slot of the two 2-page fonts carries build-time pointer garbage —
// preserved verbatim per page in _ptrSlot.
//
// Scope: 32-bit PC, little-endian, retail layout only (muVersionId 10). The
// dev-era variant (wiki Font/Development) used vpu vectors and a different
// FontChar shape; it is out of scope like every other dev-only layout.
//
// Round-trip strategy: every pointer, count, size, and the hash table are
// recomputed from the chars/texturePages arrays on write; all pad regions and
// the TextureState block are asserted zero on parse and regenerated. Only
// _ptrSlot is preserved verbatim. Byte-exact on all 26 retail fonts.

import { BinReader, BinWriter } from './binTools';

// =============================================================================
// Types
// =============================================================================

export type FontChar = {
	/** UTF-16 code unit (CgsUtf16) this glyph renders — from the parallel mpaFontCharIds array. */
	charId: number; // u16
	/** Normalized top-left atlas coordinate; (-1,-1) sentinel when not renderable. */
	mTopLeftUV: { x: number; y: number };
	/** Normalized glyph width/height on the atlas page. */
	mDimensionsUV: { x: number; y: number };
	/** Quad offset from the pen position, in UV-scaled glyph units. */
	mStart: { x: number; y: number };
	/** Pen advance after this glyph, in UV-scaled glyph units. */
	mfAdvance: number;
	/** Index into the texture page list. */
	mu16TexturePageId: number; // u16
	mbIsLowerCaseScale: boolean; // bool8
	mbIsRenderable: boolean; // bool8
};

export type FontTexturePage = {
	/** Texture resource id this page binds — the import-table entry for the page's pointer slot. */
	textureId: bigint; // u64
	// On-disk value of the page's pointer slot. 0 for slot 0 everywhere, but
	// the second slot of the 2-page fonts carries build-time pointer garbage
	// the import patcher overwrites at load — preserved verbatim.
	_ptrSlot: number; // u32
};

export type ParsedFont = {
	/** Layout version — 10 in every retail font; the parser rejects anything else. */
	muVersionId: number;
	/** Converts UV-space metrics to glyph space (mScaleUV * muFontHeightInPixels equals the atlas pixel dims for most fonts). */
	mScaleUV: { x: number; y: number };
	/** Extra scale applied to glyphs flagged mbIsLowerCaseScale (0 in every retail font — the flag is never set). */
	mfLowerCaseScale: number;
	/** Baseline height as a fraction of the line cell. */
	mfBaseLine: number;
	/** x-height as a fraction of the line cell. */
	mfXHeight: number;
	/** Source rasterization size in pixels (35–288 across retail). */
	muFontHeightInPixels: number;
	/** Typeface family, e.g. "B5HelveticaBold" (char[128], NUL-terminated). */
	macTypefaceFamilyName: string;
	/** Typeface style, e.g. "Bold" (char[128], NUL-terminated). */
	macTypefaceStyleName: string;
	/** Glyphs in disk order — grouped by ascending hash bucket (charId & 0x7F); the writer re-derives the lookup table from this order. */
	chars: FontChar[];
	/** Atlas pages, each bound to a Texture resource via the inline import table. */
	texturePages: FontTexturePage[];
};

// =============================================================================
// Constants
// =============================================================================

/** Resource type ID for CgsResource::Font. */
export const FONT_TYPE_ID = 0x21;

const HEADER_SIZE = 0x24c;
// Texture ptr slots start at align16(header end); constant because the header
// size is fixed.
const TEXTURE_PTRS_OFFSET = 0x250;
const FONT_CHAR_RECORD_SIZE = 0x20;
const IMPORT_ENTRY_SIZE = 0x10;
const HASH_TABLE_ENTRIES = 129; // 128 bucket starts + total-count sentinel
const NAME_FIELD_SIZE = 0x80;

const align16 = (x: number): number => (x + 15) & ~15;
const align32 = (x: number): number => (x + 31) & ~31;

// =============================================================================
// Hash table
// =============================================================================

/**
 * Recompute mauHashOffsets[129] from char order. The game looks chars up by
 * bucket = charId & 0x7F, scanning [h[b], h[b+1]) — so the char array MUST
 * stay grouped by ascending bucket. Throws when it isn't, because a silently
 * wrong table would make glyphs unfindable at runtime.
 */
export function computeHashOffsets(chars: FontChar[]): number[] {
	const counts = new Array<number>(128).fill(0);
	let prevBucket = 0;
	for (let i = 0; i < chars.length; i++) {
		const bucket = chars[i].charId & 0x7f;
		if (bucket < prevBucket) {
			throw new Error(`Font: chars[${i}] (charId 0x${chars[i].charId.toString(16)}) breaks hash-bucket grouping — bucket ${bucket} after ${prevBucket}`);
		}
		prevBucket = bucket;
		counts[bucket]++;
	}
	const offsets = new Array<number>(HASH_TABLE_ENTRIES);
	offsets[0] = 0;
	for (let b = 0; b < 128; b++) offsets[b + 1] = offsets[b] + counts[b];
	return offsets;
}

// =============================================================================
// Reader
// =============================================================================

function assertZero(raw: Uint8Array, start: number, end: number, what: string): void {
	for (let i = start; i < end; i++) {
		if (raw[i] !== 0) throw new Error(`Font: non-zero ${what} byte at 0x${i.toString(16)} — layout not as expected`);
	}
}

function readName(raw: Uint8Array, base: number, what: string): string {
	const seg = raw.slice(base, base + NAME_FIELD_SIZE);
	const nul = seg.indexOf(0);
	if (nul < 0) throw new Error(`Font: ${what} is not NUL-terminated`);
	assertZero(seg, nul, NAME_FIELD_SIZE, `${what} tail`);
	return new TextDecoder().decode(seg.slice(0, nul));
}

export function parseFont(raw: Uint8Array, littleEndian = true): ParsedFont {
	const r = new BinReader(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength), littleEndian);

	// --- Header (0x24C bytes) ---
	const muVersionId = r.readU32();
	const mSizeOfFont = r.readU32();
	const mScaleUV = { x: r.readF32(), y: r.readF32() };
	const mfLowerCaseScale = r.readF32();
	const mfBaseLine = r.readF32();
	const mfXHeight = r.readF32();
	const muNumChars = r.readU32();
	const mpaFontChars = r.readU32();
	const mpaFontCharIds = r.readU32();
	const storedHash = new Array<number>(HASH_TABLE_ENTRIES);
	for (let i = 0; i < HASH_TABLE_ENTRIES; i++) storedHash[i] = r.readU16();
	const pad12A = r.readU16();
	const muNumTexturePages = r.readU32();
	const mpapTextures = r.readU32();
	// mpTextureState + mTextureStateResource (rw::Resource, 4 ptrs on PC) —
	// 0x134..0x148, zero in every retail font; asserted below.
	r.position = 0x148;
	const muFontHeightInPixels = r.readU32();

	if (muVersionId !== 10) {
		throw new Error(`Font: muVersionId is ${muVersionId}, only retail version 10 is supported`);
	}

	// The layout is rigid; bail loudly on violations rather than silently
	// mis-parsing.
	const idsOffset = align16(TEXTURE_PTRS_OFFSET + muNumTexturePages * 4);
	const charsOffset = align32(idsOffset + muNumChars * 2);
	const charsEnd = charsOffset + muNumChars * FONT_CHAR_RECORD_SIZE;
	if (mpapTextures !== TEXTURE_PTRS_OFFSET) {
		throw new Error(`Font: mpapTextures is 0x${mpapTextures.toString(16)}, expected 0x${TEXTURE_PTRS_OFFSET.toString(16)} (rigid layout)`);
	}
	if (mpaFontCharIds !== idsOffset) {
		throw new Error(`Font: mpaFontCharIds is 0x${mpaFontCharIds.toString(16)}, expected 0x${idsOffset.toString(16)} for ${muNumTexturePages} pages`);
	}
	if (mpaFontChars !== charsOffset) {
		throw new Error(`Font: mpaFontChars is 0x${mpaFontChars.toString(16)}, expected 0x${charsOffset.toString(16)} for ${muNumChars} chars`);
	}
	if (mSizeOfFont !== charsEnd) {
		throw new Error(`Font: mSizeOfFont 0x${mSizeOfFont.toString(16)} != char-array end 0x${charsEnd.toString(16)}`);
	}
	if (raw.byteLength !== charsEnd + muNumTexturePages * IMPORT_ENTRY_SIZE) {
		throw new Error(`Font: payload is ${raw.byteLength} bytes, expected 0x${charsEnd.toString(16)} + ${muNumTexturePages} import entries`);
	}
	if (pad12A !== 0) throw new Error(`Font: pad at 0x12A is ${pad12A}, expected 0`);
	// All pad regions and the TextureState block are regenerated as zero by the
	// writer — a non-zero byte would silently break the byte-exact round-trip,
	// so fail loud instead (zero in all 26 retail fonts).
	assertZero(raw, 0x134, 0x148, 'TextureState block');
	assertZero(raw, HEADER_SIZE, TEXTURE_PTRS_OFFSET, 'header pad');
	assertZero(raw, TEXTURE_PTRS_OFFSET + muNumTexturePages * 4, idsOffset, 'texture→ids pad');
	assertZero(raw, idsOffset + muNumChars * 2, charsOffset, 'ids→chars pad');

	const macTypefaceFamilyName = readName(raw, 0x14c, 'family name');
	const macTypefaceStyleName = readName(raw, 0x1cc, 'style name');

	// --- Char ids (u16 each) + FontChars (0x20 each), merged into one record ---
	const chars: FontChar[] = [];
	for (let i = 0; i < muNumChars; i++) {
		r.position = idsOffset + i * 2;
		const charId = r.readU16();
		r.position = charsOffset + i * FONT_CHAR_RECORD_SIZE;
		const mTopLeftUV = { x: r.readF32(), y: r.readF32() };
		const mDimensionsUV = { x: r.readF32(), y: r.readF32() };
		const mStart = { x: r.readF32(), y: r.readF32() };
		const mfAdvance = r.readF32();
		const mu16TexturePageId = r.readU16();
		const lcs = r.readU8();
		const renderable = r.readU8();
		if (lcs > 1 || renderable > 1) {
			throw new Error(`Font: chars[${i}] bool bytes ${lcs}/${renderable} are not 0/1 — layout not as expected`);
		}
		if (mu16TexturePageId >= muNumTexturePages) {
			throw new Error(`Font: chars[${i}] references texture page ${mu16TexturePageId} of ${muNumTexturePages}`);
		}
		chars.push({
			charId,
			mTopLeftUV,
			mDimensionsUV,
			mStart,
			mfAdvance,
			mu16TexturePageId,
			mbIsLowerCaseScale: lcs === 1,
			mbIsRenderable: renderable === 1,
		});
	}

	// The stored hash table must match what the writer will regenerate from
	// char order — this also proves the array is bucket-grouped.
	const recomputed = computeHashOffsets(chars);
	for (let i = 0; i < HASH_TABLE_ENTRIES; i++) {
		if (storedHash[i] !== recomputed[i]) {
			throw new Error(`Font: mauHashOffsets[${i}] is ${storedHash[i]}, recomputed ${recomputed[i]} — table not derivable from char order`);
		}
	}

	// --- Texture pages: ptr slot (verbatim) + inline import-table entry ---
	const texturePages: FontTexturePage[] = [];
	for (let i = 0; i < muNumTexturePages; i++) {
		r.position = TEXTURE_PTRS_OFFSET + i * 4;
		const _ptrSlot = r.readU32();
		r.position = charsEnd + i * IMPORT_ENTRY_SIZE;
		const textureId = r.readU64();
		const ptrOffset = r.readU32();
		const importPad = r.readU32();
		if (ptrOffset !== TEXTURE_PTRS_OFFSET + i * 4) {
			throw new Error(`Font: import[${i}] patches 0x${ptrOffset.toString(16)}, expected texture slot 0x${(TEXTURE_PTRS_OFFSET + i * 4).toString(16)}`);
		}
		if (importPad !== 0) throw new Error(`Font: import[${i}] pad is ${importPad}, expected 0`);
		texturePages.push({ textureId, _ptrSlot });
	}

	return {
		muVersionId,
		mScaleUV,
		mfLowerCaseScale,
		mfBaseLine,
		mfXHeight,
		muFontHeightInPixels,
		macTypefaceFamilyName,
		macTypefaceStyleName,
		chars,
		texturePages,
	};
}

// =============================================================================
// Writer
// =============================================================================

export function writeFont(model: ParsedFont, littleEndian = true): Uint8Array {
	const { chars, texturePages } = model;
	if (model.muVersionId !== 10) {
		throw new Error(`Font writer: muVersionId ${model.muVersionId} — only retail version 10 is supported`);
	}
	if (texturePages.length === 0) {
		throw new Error('Font writer: a font needs at least one texture page');
	}
	for (const name of [model.macTypefaceFamilyName, model.macTypefaceStyleName]) {
		if (new TextEncoder().encode(name).byteLength >= NAME_FIELD_SIZE) {
			throw new Error(`Font writer: typeface name "${name}" exceeds the ${NAME_FIELD_SIZE - 1}-byte char[128] field`);
		}
	}
	for (let i = 0; i < chars.length; i++) {
		if (chars[i].mu16TexturePageId >= texturePages.length) {
			throw new Error(`Font writer: chars[${i}] references texture page ${chars[i].mu16TexturePageId} of ${texturePages.length}`);
		}
	}
	// Throws when chars are no longer grouped by ascending bucket.
	const hashOffsets = computeHashOffsets(chars);

	// Layout offsets recomputed from the array lengths, never stored.
	const idsOffset = align16(TEXTURE_PTRS_OFFSET + texturePages.length * 4);
	const charsOffset = align32(idsOffset + chars.length * 2);
	const sizeOfFont = charsOffset + chars.length * FONT_CHAR_RECORD_SIZE;
	const totalSize = sizeOfFont + texturePages.length * IMPORT_ENTRY_SIZE;

	const w = new BinWriter(totalSize, littleEndian);

	// --- Header (0x24C bytes) ---
	w.writeU32(model.muVersionId);
	w.writeU32(sizeOfFont);
	w.writeF32(model.mScaleUV.x);
	w.writeF32(model.mScaleUV.y);
	w.writeF32(model.mfLowerCaseScale);
	w.writeF32(model.mfBaseLine);
	w.writeF32(model.mfXHeight);
	w.writeU32(chars.length);
	w.writeU32(charsOffset); // mpaFontChars
	w.writeU32(idsOffset);   // mpaFontCharIds
	for (const h of hashOffsets) w.writeU16(h);
	w.writeU16(0); // pad 0x12A
	w.writeU32(texturePages.length);
	w.writeU32(TEXTURE_PTRS_OFFSET); // mpapTextures
	w.writeU32(0); // mpTextureState
	w.writeZeroes(0x10); // mTextureStateResource (rw::Resource, 4 null ptrs)
	w.writeU32(model.muFontHeightInPixels);
	w.writeFixedString(model.macTypefaceFamilyName, NAME_FIELD_SIZE);
	w.writeFixedString(model.macTypefaceStyleName, NAME_FIELD_SIZE);
	if (w.offset !== HEADER_SIZE) throw new Error(`Font writer: header offset mismatch ${w.offset} vs ${HEADER_SIZE}`);

	// --- Texture ptr slots (verbatim) ---
	w.writeZeroes(TEXTURE_PTRS_OFFSET - HEADER_SIZE);
	for (const page of texturePages) w.writeU32(page._ptrSlot);

	// --- Char ids ---
	w.writeZeroes(idsOffset - w.offset);
	for (const c of chars) w.writeU16(c.charId);

	// --- FontChars ---
	w.writeZeroes(charsOffset - w.offset);
	for (const c of chars) {
		w.writeF32(c.mTopLeftUV.x);
		w.writeF32(c.mTopLeftUV.y);
		w.writeF32(c.mDimensionsUV.x);
		w.writeF32(c.mDimensionsUV.y);
		w.writeF32(c.mStart.x);
		w.writeF32(c.mStart.y);
		w.writeF32(c.mfAdvance);
		w.writeU16(c.mu16TexturePageId);
		w.writeU8(c.mbIsLowerCaseScale ? 1 : 0);
		w.writeU8(c.mbIsRenderable ? 1 : 0);
	}
	if (w.offset !== sizeOfFont) throw new Error(`Font writer: import-table offset mismatch ${w.offset} vs ${sizeOfFont}`);

	// --- Inline import table (one entry per texture page) ---
	for (let i = 0; i < texturePages.length; i++) {
		w.writeU64(texturePages[i].textureId);
		w.writeU32(TEXTURE_PTRS_OFFSET + i * 4);
		w.writeU32(0);
	}

	return w.bytes;
}
