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
// and the real resource id lives in the resource's INLINE import table (stored
// at the tail of this resource's own payload). Each import entry is keyed by the
// byte offset of the pointer field it fills. We MODEL those ids (mpModelId per
// record) rather than carrying the table verbatim, so the catalogue is fully
// editable: a new prop instance whose type isn't catalogued yet needs a new
// PropGraphics entry mapping its type → a Model, which means adding both a record
// and its import. The writer rebuilds the whole table from the model.
//
// Scope: 32-bit PC, little-endian. The wiki documents a 64-bit (Paradise
// Remastered) layout too; like propInstanceData / instanceList / streetData we
// implement 32-bit PC LE only.
//
// Round-trip strategy (byte-exact, grounded by sweeping all 256 populated PGL
// resources in example/ — every invariant below holds with zero violations):
//  - Layout is rigid: header(0x20) → PropGraphics[nProps] (0x0C each, at 0x20) →
//    align16 pad → PropPartGraphics[nParts] (0x0C each) → align16 pad → inline
//    import table (importCount*16) to end of payload. Every offset/pointer/count
//    is recomputed from nProps/nParts, so add/remove of props or parts is safe.
//  - muSizeInBytes is the "structural end": part-array end when parts exist,
//    align16(prop-array end) when only props, 0x20 when empty. It is DERIVED
//    (not stored on the model) — the sweep proved the stored value always equals
//    this formula. importOffset = align16(muSizeInBytes).
//  - mpPropModel is 0 on disk; the real Model id is mpModelId, written into the
//    rebuilt import table (one entry per prop, one per part), keyed by field
//    offset. importCount == nProps + nParts.
//  - mpParts is an internal resource-relative pointer to a prop's first part. We
//    model it as firstPartIndex (the part-array INDEX it points at), so it stays
//    valid when the part array relocates after a prop add/remove — on write it
//    becomes mpaPropPartGraphics + firstPartIndex*0x0C (or 0 for a partless prop).

import { BinReader, BinWriter } from './binTools';

// =============================================================================
// Types
// =============================================================================

export type PropGraphics = {
	muTypeId: number;    // u32 — prop type index (into the prop-types table)
	// Model resource id (64-bit) the runtime spawns for this prop's body mesh.
	// Stored on disk as a 0 pointer + a BND2 import; editable here, rebuilt into
	// the import table on write. 0n means "no model / unresolved".
	mpModelId: bigint;
	// Index into `parts` of this prop's first PropPartGraphics, or null when the
	// prop has no parts. Replaces the raw resource-relative mpParts pointer so it
	// survives the part array relocating when props are added/removed.
	firstPartIndex: number | null;
};

export type PropPartGraphics = {
	muTypeId: number;    // u32 — owning prop's type id (always little endian per wiki)
	muPartId: number;    // u32 — part index within the prop
	// Model resource id for this part's mesh — same import mechanism as PropGraphics.
	mpModelId: bigint;
};

export type ParsedPropGraphicsList = {
	muZoneNumber: number; // PVS zone / track-unit id (editable)
	props: PropGraphics[];
	parts: PropPartGraphics[];
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
const PROP_MODEL_FIELD = 0x04;       // mpPropModel within a PropGraphics record
const PART_MODEL_FIELD = 0x08;       // mpPropModel within a PropPartGraphics record
const IMPORT_ENTRY_SIZE = 0x10;      // { u64 resourceId, u32 fieldOffset, u32 pad }

const align16 = (x: number): number => (x + 15) & ~15;

// Layout offsets derived purely from the two record counts. Single source of
// truth for parser, writer, and the import-table hook.
function layout(nProps: number, nParts: number) {
	const propGraphicsEnd = PROP_GRAPHICS_OFFSET + nProps * PROP_RECORD_SIZE;
	const partsStart = align16(propGraphicsEnd);
	// "structural end" — what muSizeInBytes stores (proven by corpus sweep).
	const structuralEnd =
		nParts > 0 ? partsStart + nParts * PART_RECORD_SIZE
			: nProps > 0 ? align16(propGraphicsEnd)
				: HEADER_SIZE;
	const importOffset = align16(structuralEnd);
	const total = importOffset + (nProps + nParts) * IMPORT_ENTRY_SIZE;
	return { propGraphicsEnd, partsStart, structuralEnd, importOffset, total };
}

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

	const { propGraphicsEnd, partsStart, structuralEnd, importOffset, total } =
		layout(muNumberOfPropModels, muNumberOfPropPartModels);

	// The layout is rigid; bail loudly if a populated fixture violates it rather
	// than silently producing a model that won't round-trip. Empty lists store
	// null (0) pointers, so only validate a pointer when its array is present.
	if (muNumberOfPropModels > 0 && mpaPropGraphics !== PROP_GRAPHICS_OFFSET) {
		throw new Error(`PropGraphicsList: mpaPropGraphics is 0x${mpaPropGraphics.toString(16)}, expected 0x20 (rigid layout)`);
	}
	if (muNumberOfPropPartModels > 0 && mpaPropPartGraphics !== partsStart) {
		throw new Error(`PropGraphicsList: mpaPropPartGraphics is 0x${mpaPropPartGraphics.toString(16)}, expected 0x${partsStart.toString(16)} for ${muNumberOfPropModels} props`);
	}
	// muSizeInBytes always equals the structural end across the whole corpus; a
	// mismatch means an unexpected layout we don't know how to rebuild — fail loud.
	if (muSizeInBytes !== structuralEnd) {
		throw new Error(`PropGraphicsList: muSizeInBytes 0x${muSizeInBytes.toString(16)} != derived structural end 0x${structuralEnd.toString(16)} (nProps=${muNumberOfPropModels} nParts=${muNumberOfPropPartModels})`);
	}
	// The payload must be exactly the derived length: header + arrays + pads +
	// (nProps+nParts) import entries. The writer rebuilds to this length, so any
	// extra/missing trailing bytes would break the byte-exact round-trip.
	if (raw.byteLength !== total) {
		throw new Error(`PropGraphicsList: payload is 0x${raw.byteLength.toString(16)} bytes, expected 0x${total.toString(16)} for ${muNumberOfPropModels} props + ${muNumberOfPropPartModels} parts`);
	}

	// The header pad [0x18,0x20), the align16 inter-array gap, and the align16 gap
	// before the import table are all regenerated as zero by the writer (not
	// captured on the model), so a non-zero byte in any of them would silently
	// break the byte-exact round-trip. All are zero in every fixture — assert it.
	const assertZeroRange = (from: number, to: number, what: string) => {
		for (let i = from; i < to && i < raw.byteLength; i++) {
			if (raw[i] !== 0) throw new Error(`PropGraphicsList: non-zero ${what} at 0x${i.toString(16)} — layout not as expected`);
		}
	};
	assertZeroRange(0x18, HEADER_SIZE, 'header pad');
	if (muNumberOfPropPartModels > 0) assertZeroRange(propGraphicsEnd, partsStart, 'inter-array pad');
	assertZeroRange(structuralEnd, importOffset, 'import-table align pad');

	// --- Inline import table (field offset → Model resource id) ---
	const importById = new Map<number, bigint>();
	r.position = importOffset;
	for (let i = 0; i < muNumberOfPropModels + muNumberOfPropPartModels; i++) {
		const resourceId = r.readU64();
		const fieldOffset = r.readU32();
		const pad = r.readU32();
		if (pad !== 0) throw new Error(`PropGraphicsList: non-zero import-entry padding ${pad} — layout not as expected`);
		importById.set(fieldOffset, resourceId);
	}

	// --- PropGraphics (12 bytes each, at 0x20) ---
	const props: PropGraphics[] = [];
	r.position = PROP_GRAPHICS_OFFSET;
	for (let i = 0; i < muNumberOfPropModels; i++) {
		const muTypeId = r.readU32();
		r.readU32();                     // mpPropModel — 0 on disk, ignored (id is in the import table)
		const mpParts = r.readU32();
		const fieldOffset = PROP_GRAPHICS_OFFSET + i * PROP_RECORD_SIZE + PROP_MODEL_FIELD;
		const mpModelId = importById.get(fieldOffset) ?? 0n;
		// mpParts is an aligned offset into the part array (proven by the sweep) —
		// store it as a part index so it survives the array relocating on edit.
		let firstPartIndex: number | null = null;
		if (mpParts !== 0) {
			const rel = mpParts - partsStart;
			if (rel < 0 || rel % PART_RECORD_SIZE !== 0 || rel / PART_RECORD_SIZE >= muNumberOfPropPartModels) {
				throw new Error(`PropGraphicsList: prop[${i}] mpParts 0x${mpParts.toString(16)} is not an aligned index into the ${muNumberOfPropPartModels}-part array`);
			}
			firstPartIndex = rel / PART_RECORD_SIZE;
		}
		props.push({ muTypeId, mpModelId, firstPartIndex });
	}

	// --- PropPartGraphics (12 bytes each, at align16(propGraphicsEnd)) ---
	const parts: PropPartGraphics[] = [];
	r.position = partsStart;
	for (let j = 0; j < muNumberOfPropPartModels; j++) {
		const muTypeId = r.readU32();
		const muPartId = r.readU32();
		r.readU32();                     // mpPropModel — 0 on disk, ignored
		const fieldOffset = partsStart + j * PART_RECORD_SIZE + PART_MODEL_FIELD;
		const mpModelId = importById.get(fieldOffset) ?? 0n;
		parts.push({ muTypeId, muPartId, mpModelId });
	}

	return { muZoneNumber, props, parts };
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
	// 82 parts.
	if (nParts > 0xff) {
		throw new Error(`PropGraphicsList: ${nParts} parts exceeds the u8 muNumberOfPropPartModels field (max 255)`);
	}

	const { partsStart, structuralEnd, importOffset, total } = layout(nProps, nParts);

	// Stored pointers are null (0) when their array is empty — reproduces the
	// all-zero header an empty list ships, keeping the round-trip byte-exact.
	const mpaPropGraphics = nProps > 0 ? PROP_GRAPHICS_OFFSET : 0;
	const mpaPropPartGraphics = nParts > 0 ? partsStart : 0;

	const w = new BinWriter(total, littleEndian);

	// --- Header (32 bytes) ---
	w.writeU32(structuralEnd);                   // muSizeInBytes — derived structural end
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
		const idx = p.firstPartIndex;
		if (idx != null && (idx < 0 || idx >= nParts)) {
			throw new Error(`PropGraphicsList writer: firstPartIndex ${idx} out of range for ${nParts} parts`);
		}
		const mpParts = idx == null ? 0 : partsStart + idx * PART_RECORD_SIZE;
		w.writeU32(p.muTypeId);
		w.writeU32(0);                            // mpPropModel — 0 on disk, id lives in the import table
		w.writeU32(mpParts);                      // recomputed internal pointer
	}

	// --- align16 pad → PropPartGraphics (12 bytes each) ---
	if (nParts > 0) {
		while (w.offset < partsStart) w.writeU8(0);
		for (const q of parts) {
			w.writeU32(q.muTypeId);
			w.writeU32(q.muPartId);
			w.writeU32(0);                        // mpPropModel — 0 on disk
		}
	}
	// Pad up to the structural end. With parts this is already the part-array end
	// (no-op); with only props the structural end is align16(prop-array end), so
	// there's an align pad after the last prop record to fill here.
	while (w.offset < structuralEnd) w.writeU8(0);
	if (w.offset !== structuralEnd) throw new Error(`PropGraphicsList writer: structural-end offset mismatch ${w.offset} vs ${structuralEnd}`);

	// --- align16 pad → inline import table (one entry per prop, then per part) ---
	while (w.offset < importOffset) w.writeU8(0);
	props.forEach((p, i) => {
		w.writeU64(p.mpModelId);
		w.writeU32(PROP_GRAPHICS_OFFSET + i * PROP_RECORD_SIZE + PROP_MODEL_FIELD);
		w.writeU32(0);
	});
	parts.forEach((q, j) => {
		w.writeU64(q.mpModelId);
		w.writeU32(partsStart + j * PART_RECORD_SIZE + PART_MODEL_FIELD);
		w.writeU32(0);
	});
	if (w.offset !== total) throw new Error(`PropGraphicsList writer: end offset mismatch ${w.offset} vs ${total}`);

	return w.bytes;
}

// =============================================================================
// Import-table hook (for the bundle envelope on export)
// =============================================================================

// Where the rewritten payload's inline import table sits and how many entries it
// has. The bundle writer calls this so ResourceEntry.importOffset/importCount
// follow a count-changing edit (add/remove of props or parts). muSizeInBytes in
// the payload header is the structural end the writer emitted, so the table
// starts at align16 of it; count is nProps + nParts.
export function propGraphicsListImportTable(payload: Uint8Array, littleEndian = true): { offset: number; count: number } {
	const dv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
	const muSizeInBytes = dv.getUint32(0x00, littleEndian);
	const nProps = dv.getUint32(0x08, littleEndian);
	const nParts = dv.getUint8(0x0c);
	return { offset: align16(muSizeInBytes), count: nProps + nParts };
}
