// PropGraphicsList parser and writer (resource type 0x10010,
// BrnPhysics::Props::PropGraphicsList).
//
// A PropGraphicsList is the per-track-unit catalogue that maps every prop TYPE
// placed in that unit (see PropInstanceData / 0x10011) to the Model resource(s)
// the runtime spawns for it. It carries two parallel on-disk arrays:
//  - PropGraphics:     one entry per whole prop  → its Model (the body mesh).
//  - PropPartGraphics: one entry per prop PART   → its Model (a destructible
//    sub-piece, e.g. a billboard panel that breaks off).
//
// PART OWNERSHIP (load-bearing, grounded by sweeping all 234 PGLs-with-parts):
// parts are grouped CONTIGUOUSLY by muTypeId, and the prop whose muTypeId matches
// owns that whole run. No two parts-owning props ever share a typeId, every part
// run matches a prop, and the runs appear in prop-array order. So the relationship
// is unambiguous BY TYPE. We therefore MODEL parts NESTED under their owning prop
// (PropGraphics.parts) rather than as a flat array + a pointer — adding/removing a
// part is then an edit to one prop's list, and ownership can never desync. The
// flat on-disk array is purely a writer detail (flatten props' parts in prop order).
//
// The old PropGraphics.mpParts pointer is DERIVED on write (a prop with parts →
// the byte offset of its run's first part). On disk, partless props carry a
// LEFTOVER/garbage mpParts the runtime never dereferences (2951 of them in the
// corpus, 610 null); we preserve it verbatim as _mpPartsRaw so the round-trip
// stays byte-exact.
//
// The Model references are BND2 imports: on disk every mpPropModel pointer is 0,
// and the real resource id lives in the resource's INLINE import table (at the
// tail of the payload), keyed by the field's byte offset. We MODEL those ids
// (mpModelId per record) and the writer rebuilds the whole table — so a prop's
// (or part's) Model, and the set of props/parts itself, are all freely editable.
//
// Scope: 32-bit PC, little-endian. The wiki documents a 64-bit (Paradise
// Remastered) layout too; like propInstanceData / instanceList / streetData we
// implement 32-bit PC LE only.
//
// Round-trip strategy (byte-exact, grounded by sweeping all 256 populated PGLs):
//  - Layout is rigid: header(0x20) → PropGraphics[nProps] (0x0C each, at 0x20) →
//    align16 pad → PropPartGraphics[nParts] (0x0C each) → align16 pad → inline
//    import table (importCount*16) to end of payload. Every offset/pointer/count
//    is recomputed from nProps/nParts, so add/remove of props or parts is safe.
//  - muSizeInBytes is the "structural end": part-array end when parts exist,
//    align16(prop-array end) when only props, 0x20 when empty. DERIVED.
//  - mpPropModel is 0 on disk; the real Model id is mpModelId. importCount ==
//    nProps + nParts (one per prop + one per part).

import { BinReader, BinWriter } from './binTools';

// =============================================================================
// Types
// =============================================================================

export type PropPartGraphics = {
	muPartId: number;    // u32 — part index within the owning prop
	// Model resource id for this part's mesh (BND2 import; 0 on disk). Editable.
	mpModelId: bigint;
	// NOTE: the on-disk part also stores muTypeId == the owning prop's muTypeId.
	// It isn't modelled here — the part is nested under its prop, so the writer
	// re-emits the prop's muTypeId. That makes a new part trivially well-formed.
};

export type PropGraphics = {
	muTypeId: number;    // u32 — prop type index (into the prop-types table)
	// Model resource id (64-bit) the runtime spawns for this prop's body mesh.
	// BND2 import (0 on disk); editable, rebuilt into the import table on write.
	mpModelId: bigint;
	// This prop's destructible parts (owned by muTypeId). Empty for a partless
	// prop. Add/remove freely — the writer regroups + rederives all pointers.
	parts: PropPartGraphics[];
	// Raw on-disk mpParts pointer, preserved for byte-exact round-trip. Only used
	// on write when the prop is PARTLESS (the runtime ignores it then, but retail
	// ships non-zero garbage here we must reproduce). For a prop that owns parts
	// the writer derives mpParts from the part run and ignores this.
	_mpPartsRaw: number;
};

export type ParsedPropGraphicsList = {
	muZoneNumber: number; // PVS zone / track-unit id (editable)
	props: PropGraphics[];
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

/** Total parts across all props — the flat on-disk PropPartGraphics count. */
function countParts(props: PropGraphics[]): number {
	let n = 0;
	for (const p of props) n += p.parts.length;
	return n;
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
	if (muSizeInBytes !== structuralEnd) {
		throw new Error(`PropGraphicsList: muSizeInBytes 0x${muSizeInBytes.toString(16)} != derived structural end 0x${structuralEnd.toString(16)} (nProps=${muNumberOfPropModels} nParts=${muNumberOfPropPartModels})`);
	}
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

	// --- PropGraphics (12 bytes each, at 0x20) — raw, before nesting parts ---
	type RawProp = { muTypeId: number; mpModelId: bigint; mpPartsRaw: number };
	const rawProps: RawProp[] = [];
	r.position = PROP_GRAPHICS_OFFSET;
	for (let i = 0; i < muNumberOfPropModels; i++) {
		const muTypeId = r.readU32();
		r.readU32();                     // mpPropModel — 0 on disk, ignored (id is in the import table)
		const mpParts = r.readU32();
		const mpModelId = importById.get(PROP_GRAPHICS_OFFSET + i * PROP_RECORD_SIZE + PROP_MODEL_FIELD) ?? 0n;
		rawProps.push({ muTypeId, mpModelId, mpPartsRaw: mpParts });
	}

	// --- PropPartGraphics (12 bytes each) — grouped CONTIGUOUSLY by muTypeId.
	// Group runs as we read, asserting contiguity (a typeId must not reappear
	// after a different one), since the nested model + writer rely on it.
	r.position = partsStart;
	const partsByType = new Map<number, PropPartGraphics[]>();
	const closedTypes = new Set<number>();
	let prevType: number | null = null;
	for (let j = 0; j < muNumberOfPropPartModels; j++) {
		const muTypeId = r.readU32();
		const muPartId = r.readU32();
		r.readU32();                     // mpPropModel — 0 on disk, ignored
		const mpModelId = importById.get(partsStart + j * PART_RECORD_SIZE + PART_MODEL_FIELD) ?? 0n;
		if (muTypeId !== prevType) {
			if (closedTypes.has(muTypeId)) {
				throw new Error(`PropGraphicsList: parts for type 0x${muTypeId.toString(16)} are not contiguous (reappear at part ${j}) — unexpected layout`);
			}
			if (prevType !== null) closedTypes.add(prevType);
			prevType = muTypeId;
			partsByType.set(muTypeId, []);
		}
		partsByType.get(muTypeId)!.push({ muPartId, mpModelId });
	}

	// --- Attach each part run to the prop whose muTypeId owns it. ---
	const claimed = new Set<number>();
	const props: PropGraphics[] = rawProps.map((rp) => {
		const owned = partsByType.get(rp.muTypeId);
		if (owned && owned.length > 0) {
			if (claimed.has(rp.muTypeId)) {
				throw new Error(`PropGraphicsList: two props share type 0x${rp.muTypeId.toString(16)} which owns parts — ambiguous ownership`);
			}
			claimed.add(rp.muTypeId);
			return { muTypeId: rp.muTypeId, mpModelId: rp.mpModelId, parts: owned, _mpPartsRaw: rp.mpPartsRaw };
		}
		return { muTypeId: rp.muTypeId, mpModelId: rp.mpModelId, parts: [], _mpPartsRaw: rp.mpPartsRaw };
	});

	// Every part run must have found an owning prop (no orphans). Verified across
	// the corpus; assert so an unexpected layout fails loud instead of dropping parts.
	if (claimed.size !== partsByType.size) {
		const orphan = [...partsByType.keys()].find((t) => !claimed.has(t));
		throw new Error(`PropGraphicsList: part run for type 0x${(orphan ?? 0).toString(16)} has no owning prop — unexpected layout`);
	}

	return { muZoneNumber, props };
}

// =============================================================================
// Writer
// =============================================================================

export function writePropGraphicsList(model: ParsedPropGraphicsList, littleEndian = true): Uint8Array {
	const { props } = model;
	const nProps = props.length;
	const nParts = countParts(props);

	// muNumberOfPropPartModels is a u8 on disk; refuse to silently truncate a
	// model carrying >255 parts into a desynced count. Real fixtures top out at 82.
	if (nParts > 0xff) {
		throw new Error(`PropGraphicsList: ${nParts} parts exceeds the u8 muNumberOfPropPartModels field (max 255)`);
	}

	// Parts are owned BY TYPE (the on-disk flat array is grouped by muTypeId), so
	// two props sharing a type where one owns parts can't round-trip — on reload
	// the whole run would attach to the first prop of that type. Fail loud at write
	// time rather than emit a file that can't be reopened. (Distinct-type props are
	// the norm; this only guards a user creating a duplicate-type prop + parts.)
	const typesWithParts = new Set<number>();
	for (const p of props) if (p.parts.length > 0) typesWithParts.add(p.muTypeId);
	const seenTypes = new Set<number>();
	for (const p of props) {
		if (seenTypes.has(p.muTypeId) && typesWithParts.has(p.muTypeId)) {
			throw new Error(`PropGraphicsList: prop type 0x${p.muTypeId.toString(16)} appears on more than one prop and owns parts — parts are owned by type and can't be split across props`);
		}
		seenTypes.add(p.muTypeId);
	}

	const { partsStart, structuralEnd, importOffset, total } = layout(nProps, nParts);

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

	// --- PropGraphics (12 bytes each). mpParts is DERIVED for a prop that owns
	// parts (byte offset of its run's first part) and the preserved raw value for
	// a partless prop (leftover the runtime ignores). Part runs are emitted in
	// prop order below, so a prop's run begins at the running part offset. ---
	let runStart = 0;
	for (const p of props) {
		const mpParts = p.parts.length > 0 ? partsStart + runStart * PART_RECORD_SIZE : p._mpPartsRaw;
		w.writeU32(p.muTypeId);
		w.writeU32(0);                            // mpPropModel — 0 on disk, id lives in the import table
		w.writeU32(mpParts);
		runStart += p.parts.length;
	}

	// --- align16 pad → PropPartGraphics (12 bytes each), flattened in prop order
	// so the contiguous-by-type grouping is reproduced. Each part re-emits its
	// owning prop's muTypeId. ---
	if (nParts > 0) {
		while (w.offset < partsStart) w.writeU8(0);
		for (const p of props) {
			for (const part of p.parts) {
				w.writeU32(p.muTypeId);
				w.writeU32(part.muPartId);
				w.writeU32(0);                    // mpPropModel — 0 on disk
			}
		}
	}
	// Pad up to the structural end. For a parts-bearing list the parts loop
	// already lands exactly here; for a props-only list whose prop array isn't
	// 16-aligned this writes the align pad between propGraphicsEnd and the
	// align16(propGraphicsEnd) structural end (nProps not a multiple of 4).
	while (w.offset < structuralEnd) w.writeU8(0);
	if (w.offset !== structuralEnd) throw new Error(`PropGraphicsList writer: structural-end offset mismatch ${w.offset} vs ${structuralEnd}`);

	// --- align16 pad → inline import table (one entry per prop, then per part in
	// the same flat prop order). ---
	while (w.offset < importOffset) w.writeU8(0);
	props.forEach((p, i) => {
		w.writeU64(p.mpModelId);
		w.writeU32(PROP_GRAPHICS_OFFSET + i * PROP_RECORD_SIZE + PROP_MODEL_FIELD);
		w.writeU32(0);
	});
	let partIdx = 0;
	for (const p of props) {
		for (const part of p.parts) {
			w.writeU64(part.mpModelId);
			w.writeU32(partsStart + partIdx * PART_RECORD_SIZE + PART_MODEL_FIELD);
			w.writeU32(0);
			partIdx++;
		}
	}
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
