// PropGraphicsList parser and writer (resource type 0x10010,
// BrnPhysics::Props::PropGraphicsList).
//
// A PropGraphicsList is the per-track-unit catalogue that maps every prop TYPE
// placed in that unit (see PropInstanceData / 0x10011) to the Model resource(s)
// the runtime spawns for it. It carries two parallel arrays:
//  - PropGraphics:     one entry per whole prop  → its Model (the body mesh).
//  - PropPartGraphics: one entry per prop PART   → its Model (a destructible
//    sub-piece, e.g. a billboard panel that breaks off). Parts are grouped
//    contiguously by owning prop; a PropGraphics.mpParts points at the prop's
//    first part.
//
// The Model references are BND2 imports: on disk every mpPropModel pointer is 0,
// and the real resource id lives in the bundle's INLINE import table (stored at
// the tail of this resource's own payload). Imports are keyed by the byte offset
// of the pointer field, so the renderer resolves them with getImportsByPtrOffset
// — exactly like InstanceList's mpModel. The parser never needs the import table
// to read the structure; it preserves it verbatim for byte-exact round-trip.
//
// Scope: 32-bit PC, little-endian. The wiki documents a 64-bit (Paradise
// Remastered) layout too; like propInstanceData / instanceList / streetData we
// implement 32-bit PC LE only.
//
// Round-trip strategy (byte-exact, grounded by sweeping all 427 PGL resources in
// example/):
//  - Layout is rigid: header(0x20) → PropGraphics[nProps] (0x0C each, at 0x20) →
//    align16 pad → PropPartGraphics[nParts] (0x0C each) → align16 pad → inline
//    import table (importCount*16) to end of payload. mpaPropGraphics is always
//    0x20 and mpaPropPartGraphics is always align16(0x20 + nProps*0x0C), so both
//    are recomputed from the counts on write (null/0 when their array is empty).
//  - muSizeInBytes is a stored field that does NOT consistently equal a derivable
//    offset (it is the part-array end when there are parts, but align16(prop-array
//    end) when there are none), so it is preserved verbatim, mirroring
//    propInstanceData.
//  - mpPropModel (always 0) and mpParts (an internal resource-relative pointer)
//    are preserved verbatim per record.
//  - Everything from the end of the last array to the end of the payload (the
//    align pad + the inline import table) is captured as _tail and re-emitted
//    verbatim. This keeps every Model import valid as long as the prop/part
//    counts are unchanged — so field edits round-trip, but adding/removing props
//    or parts (which would shift the import-table field offsets) is out of scope.

import { BinReader, BinWriter } from './binTools';

// =============================================================================
// Types
// =============================================================================

export type PropGraphics = {
	muTypeId: number;    // u32 — prop type index (into the prop-types table)
	// Model* import — 0 on disk; real id resolved from the import table by this
	// field's byte offset. Preserved verbatim for round-trip.
	mpPropModel: number; // u32
	// Resource-relative pointer to this prop's first PropPartGraphics (0 when the
	// prop has no parts). An internal pointer, preserved verbatim.
	mpParts: number;     // u32
};

export type PropPartGraphics = {
	muTypeId: number;    // u32 — owning prop's type id (always little endian per wiki)
	muPartId: number;    // u32 — part index within the prop
	// Model* import — 0 on disk; resolved from the import table. Verbatim.
	mpPropModel: number; // u32
};

export type ParsedPropGraphicsList = {
	muZoneNumber: number; // PVS zone / track-unit id (editable)
	// Stored size field; does NOT consistently equal any derivable offset (it is
	// the part-array end with parts, align16(prop-array end) without). Preserved
	// verbatim so the writer reproduces the header byte-for-byte.
	muSizeInBytes: number;
	props: PropGraphics[];
	parts: PropPartGraphics[];
	// Bytes from the end of the last array to the end of the payload: an align16
	// pad followed by the inline BND2 import table (one entry per prop + per part).
	// Re-emitted verbatim — reproduces the exact length and keeps every Model
	// import valid (the table is keyed by field offset).
	_tail: Uint8Array;
};

// =============================================================================
// Constants
// =============================================================================

/** Resource type ID for BrnPhysics::Props::PropGraphicsList. */
export const PROP_GRAPHICS_LIST_TYPE_ID = 0x10010;

const HEADER_SIZE = 0x20;            // header fields end at 0x18, padded to 0x20
const PROP_GRAPHICS_OFFSET = 0x20;   // mpaPropGraphics is always 0x20 when populated
const PROP_RECORD_SIZE = 0x0c;       // PropGraphics
const PART_RECORD_SIZE = 0x0c;       // PropPartGraphics

const align16 = (x: number): number => (x + 15) & ~15;

// =============================================================================
// Reader
// =============================================================================

export function parsePropGraphicsList(raw: Uint8Array, littleEndian = true): ParsedPropGraphicsList {
	const r = new BinReader(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength), littleEndian);

	// --- Header (32 bytes) ---
	const muSizeInBytes = r.readU32();
	const muZoneNumber = r.readU32();
	const muNumberOfPropModels = r.readU32();
	const muNumberOfPropPartModels = r.readU8();
	r.readU8(); r.readU8(); r.readU8();          // 3 pad (muNumberOfPropPartModels occupies a 4-byte slot)
	const mpaPropGraphics = r.readU32();
	const mpaPropPartGraphics = r.readU32();
	// 0x18..0x20 is zero pad up to where PropGraphics begins (mpaPropGraphics).

	// The layout is rigid; bail loudly if a populated fixture violates it rather
	// than silently producing a model that won't round-trip. Empty lists store
	// null (0) pointers, so only validate a pointer when its array is present.
	const propGraphicsEnd = PROP_GRAPHICS_OFFSET + muNumberOfPropModels * PROP_RECORD_SIZE;
	const partsStart = align16(propGraphicsEnd);
	if (muNumberOfPropModels > 0 && mpaPropGraphics !== PROP_GRAPHICS_OFFSET) {
		throw new Error(`PropGraphicsList: mpaPropGraphics is 0x${mpaPropGraphics.toString(16)}, expected 0x20 (rigid layout)`);
	}
	if (muNumberOfPropPartModels > 0 && mpaPropPartGraphics !== partsStart) {
		throw new Error(`PropGraphicsList: mpaPropPartGraphics is 0x${mpaPropPartGraphics.toString(16)}, expected 0x${partsStart.toString(16)} for ${muNumberOfPropModels} props`);
	}

	// The header pad [0x18,0x20) and the align16 inter-array gap are regenerated
	// as zero by the writer (not captured on the model), so a non-zero byte in
	// either region would silently break the byte-exact round-trip. Both are zero
	// in every fixture — assert it and fail loud, like the pointer checks above,
	// rather than drop data on some unexpected layout.
	for (let i = 0x18; i < HEADER_SIZE && i < raw.byteLength; i++) {
		if (raw[i] !== 0) throw new Error(`PropGraphicsList: non-zero header pad at 0x${i.toString(16)} — layout not as expected`);
	}
	if (muNumberOfPropPartModels > 0) {
		for (let i = propGraphicsEnd; i < partsStart; i++) {
			if (raw[i] !== 0) throw new Error(`PropGraphicsList: non-zero inter-array pad at 0x${i.toString(16)} — layout not as expected`);
		}
	}

	// --- PropGraphics (12 bytes each, at 0x20) ---
	const props: PropGraphics[] = [];
	r.position = PROP_GRAPHICS_OFFSET;
	for (let i = 0; i < muNumberOfPropModels; i++) {
		const muTypeId = r.readU32();
		const mpPropModel = r.readU32();
		const mpParts = r.readU32();
		props.push({ muTypeId, mpPropModel, mpParts });
	}

	// --- PropPartGraphics (12 bytes each, at align16(propGraphicsEnd)) ---
	const parts: PropPartGraphics[] = [];
	r.position = partsStart;
	for (let i = 0; i < muNumberOfPropPartModels; i++) {
		const muTypeId = r.readU32();
		const muPartId = r.readU32();
		const mpPropModel = r.readU32();
		parts.push({ muTypeId, muPartId, mpPropModel });
	}

	// --- Tail (align pad + inline import table) — captured verbatim. ---
	const structuralEnd =
		muNumberOfPropPartModels > 0
			? partsStart + muNumberOfPropPartModels * PART_RECORD_SIZE
			: muNumberOfPropModels > 0
				? propGraphicsEnd
				: HEADER_SIZE;
	const _tail = structuralEnd < raw.byteLength
		? raw.slice(structuralEnd, raw.byteLength)
		: new Uint8Array(0);

	return { muZoneNumber, muSizeInBytes, props, parts, _tail };
}

// =============================================================================
// Writer
// =============================================================================

export function writePropGraphicsList(model: ParsedPropGraphicsList, littleEndian = true): Uint8Array {
	const { props, parts } = model;
	const nProps = props.length;
	const nParts = parts.length;

	// muNumberOfPropPartModels is a u8 on disk; refuse to silently truncate a
	// model carrying >255 parts into a desynced count. Real fixtures top out at
	// 82 parts — this only guards out-of-scope bulk edits that add parts.
	if (nParts > 0xff) {
		throw new Error(`PropGraphicsList: ${nParts} parts exceeds the u8 muNumberOfPropPartModels field (max 255)`);
	}

	// Layout offsets recomputed from the counts — never trust stored values.
	const propGraphicsEnd = PROP_GRAPHICS_OFFSET + nProps * PROP_RECORD_SIZE;
	const partsStart = align16(propGraphicsEnd);
	const structuralEnd =
		nParts > 0 ? partsStart + nParts * PART_RECORD_SIZE
			: nProps > 0 ? propGraphicsEnd
				: HEADER_SIZE;
	const totalSize = structuralEnd + model._tail.byteLength;

	// Stored pointers are null (0) when their array is empty — reproduces the
	// all-zero header an empty list ships, keeping the round-trip byte-exact.
	const mpaPropGraphics = nProps > 0 ? PROP_GRAPHICS_OFFSET : 0;
	const mpaPropPartGraphics = nParts > 0 ? partsStart : 0;

	const w = new BinWriter(totalSize, littleEndian);

	// --- Header (32 bytes) ---
	w.writeU32(model.muSizeInBytes);             // verbatim — not a derivable offset
	w.writeU32(model.muZoneNumber);
	w.writeU32(nProps);
	w.writeU8(nParts & 0xff);
	w.writeU8(0); w.writeU8(0); w.writeU8(0);    // 3 pad
	w.writeU32(mpaPropGraphics);
	w.writeU32(mpaPropPartGraphics);
	while (w.offset < HEADER_SIZE) w.writeU8(0); // pad header up to 0x20
	if (w.offset !== HEADER_SIZE) throw new Error(`PropGraphicsList writer: header offset mismatch ${w.offset} vs ${HEADER_SIZE}`);

	// --- PropGraphics (12 bytes each) ---
	for (const p of props) {
		w.writeU32(p.muTypeId);
		w.writeU32(p.mpPropModel);                // verbatim, 0 on disk
		w.writeU32(p.mpParts);                     // verbatim internal pointer
	}

	// --- align16 pad → PropPartGraphics (12 bytes each) ---
	if (nParts > 0) {
		while (w.offset < partsStart) w.writeU8(0);
		for (const q of parts) {
			w.writeU32(q.muTypeId);
			w.writeU32(q.muPartId);
			w.writeU32(q.mpPropModel);             // verbatim, 0 on disk
		}
	}
	if (w.offset !== structuralEnd) throw new Error(`PropGraphicsList writer: tail offset mismatch ${w.offset} vs ${structuralEnd}`);

	// --- Tail (align pad + inline import table) — verbatim. ---
	if (model._tail.byteLength > 0) w.writeBytes(model._tail);

	return w.bytes;
}
