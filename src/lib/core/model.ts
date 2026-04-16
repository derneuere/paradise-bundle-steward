// Model resource (CgsGraphics::Model) parser and writer.
// Resource type ID: 0x2A
// Wiki: docs/Model.md
// Blender reference: import_bpr_models.py:1773 (read_model)
//
// A Model is the join point between LOD states and Renderable resources.
// Vehicles, props, and wheels all use it. Each Model declares numRenderables
// child Renderables and numStates LOD/state slots that map state index → which
// Renderable to draw at that distance.
//
// Binary layout (32-bit LE, header is 0x14 bytes):
//
//   [0x00] u32 mppRenderables                  → offset of zero-filled
//                                                u32[numRenderables] (the
//                                                game patches these in memory
//                                                via the import table)
//   [0x04] u32 mpu8StateRenderableIndices      → offset of u8[numStates]
//   [0x08] u32 mpfLodDistances                 → offset of f32[numRenderables]
//   [0x0C] i32 miGameExplorerIndex             usually 0
//   [0x10] u8  numRenderables
//   [0x11] u8  flags
//   [0x12] u8  numStates
//   [0x13] u8  versionNumber                   always 2
//
// After the header come three back-to-back data regions whose start offsets
// the header announces explicitly. All four observed Models in
// VEH_CARBRWDS_GR.BIN follow the same packing:
//
//   header(0x14) | u32[numR] zeros | u8[numS] | f32[numR] | pad → align 16 |
//   importTable[numR] (16 bytes per entry)
//
// The import table's location matches `resource.importOffset` from the bundle
// entry; we recompute it as `align16(mpfLodDistances + numRenderables*4)`.
//
// Round-trip strategy: layout-preserving. The parser captures the three
// pointer offsets verbatim and the writer replays them in place. The trailing
// import table is preserved as opaque bytes so the writer doesn't need to
// know the resource-id → ptrOffset mapping (those are stable across edits
// that only touch state indices / LOD distances). If a fixture surfaces with
// a non-canonical layout the parser will throw and we'll grow it from there.

import { BinReader, BinWriter } from './binTools';

export const MODEL_TYPE_ID = 0x2A;
export const MODEL_HEADER_SIZE = 0x14;
export const MODEL_IMPORT_ENTRY_SIZE = 0x10; // u64 id + u32 ptrOffset + u32 padding

// =============================================================================
// Types
// =============================================================================

export type ParsedModelResource = {
	// ---- Editable header fields ----
	flags: number;             // u8 at +0x11
	miGameExplorerIndex: number; // i32 at +0x0C, almost always 0

	// ---- Editable data ----
	/** Per-state mapping → which Renderable index (0..numRenderables-1) to
	 *  draw when this state is active. Length == numStates. State 0 is
	 *  E_STATE_LOD_0; values 16..31 are E_STATE_GAME_SPECIFIC_*. */
	stateRenderableIndices: number[];
	/** LOD distance threshold (in metres, world units) per renderable. Length
	 *  == numRenderables. Sorted ascending in every observed sample. */
	lodDistances: number[];

	// ---- Layout bookkeeping (set by parser, consumed by writer) ----
	versionNumber: number;     // u8 at +0x13, always 2; preserved verbatim
	mppRenderablesOffset: number;
	mpu8StateRenderableIndicesOffset: number;
	mpfLodDistancesOffset: number;
	importTableOffset: number;
	/** Trailing import table bytes (numRenderables * 16 bytes), one byte per
	 *  number so the model survives `JSON.parse(JSON.stringify(...))` clones
	 *  in stress / fuzz scenarios. Each 16-byte entry is
	 *  { u64 resourceId, u32 ptrOffset, u32 padding }. Preserved verbatim so
	 *  the writer doesn't need to know the imported resource ids. */
	importTable: number[];
	/** Total resource byte length. */
	totalSize: number;
};

// =============================================================================
// Parser
// =============================================================================

export function parseModelData(
	raw: Uint8Array,
	littleEndian: boolean = true,
): ParsedModelResource {
	if (raw.byteLength < MODEL_HEADER_SIZE) {
		throw new Error(
			`Model resource too small (${raw.byteLength} bytes, need at least ${MODEL_HEADER_SIZE})`,
		);
	}
	const r = new BinReader(
		raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength),
		littleEndian,
	);

	const mppRenderablesOffset           = r.readU32();
	const mpu8StateRenderableIndicesOffset = r.readU32();
	const mpfLodDistancesOffset          = r.readU32();
	const miGameExplorerIndex            = r.readI32();
	const numRenderables                 = r.readU8();
	const flags                          = r.readU8();
	const numStates                      = r.readU8();
	const versionNumber                  = r.readU8();

	if (versionNumber !== 2) {
		// Wiki says always 2. Don't fail — preserve and warn.
		// (We've never seen anything else; if you see this, the file may
		// belong to a different game branch we haven't catalogued.)
		console.warn(`Model version ${versionNumber}, expected 2`);
	}

	// Verify mppRenderables block is zero-filled. The game patches these
	// pointers from the import table at load time; they should be zero on
	// disk. A non-zero value here would mean the file has been hand-edited
	// or comes from a branch we don't understand.
	if (mppRenderablesOffset + numRenderables * 4 > raw.byteLength) {
		throw new Error(
			`Model mppRenderables (${mppRenderablesOffset}+${numRenderables}*4) runs past end (${raw.byteLength})`,
		);
	}
	for (let i = 0; i < numRenderables; i++) {
		const v = raw[mppRenderablesOffset + i * 4]
		        | (raw[mppRenderablesOffset + i * 4 + 1] << 8)
		        | (raw[mppRenderablesOffset + i * 4 + 2] << 16)
		        | (raw[mppRenderablesOffset + i * 4 + 3] << 24);
		if (v !== 0) {
			throw new Error(
				`Model mppRenderables[${i}] = 0x${(v >>> 0).toString(16)} — expected zero (game patches at runtime)`,
			);
		}
	}

	// State renderable indices (u8 × numStates).
	if (mpu8StateRenderableIndicesOffset + numStates > raw.byteLength) {
		throw new Error(
			`Model state-indices region runs past end of resource`,
		);
	}
	r.position = mpu8StateRenderableIndicesOffset;
	const stateRenderableIndices: number[] = [];
	for (let i = 0; i < numStates; i++) stateRenderableIndices.push(r.readU8());

	// LOD distances (f32 × numRenderables).
	if (mpfLodDistancesOffset + numRenderables * 4 > raw.byteLength) {
		throw new Error(
			`Model LOD-distances region runs past end of resource`,
		);
	}
	r.position = mpfLodDistancesOffset;
	const lodDistances: number[] = [];
	for (let i = 0; i < numRenderables; i++) lodDistances.push(r.readF32());

	// Import table at align16(end-of-LOD-distances).
	const importTableOffset = align16(mpfLodDistancesOffset + numRenderables * 4);
	const importTableSize = numRenderables * MODEL_IMPORT_ENTRY_SIZE;
	if (importTableOffset + importTableSize > raw.byteLength) {
		throw new Error(
			`Model import table (${importTableOffset}+${importTableSize}) runs past end (${raw.byteLength})`,
		);
	}
	const importTable: number[] = new Array(importTableSize);
	for (let i = 0; i < importTableSize; i++) {
		importTable[i] = raw[importTableOffset + i];
	}

	return {
		flags,
		miGameExplorerIndex,
		stateRenderableIndices,
		lodDistances,
		versionNumber,
		mppRenderablesOffset,
		mpu8StateRenderableIndicesOffset,
		mpfLodDistancesOffset,
		importTableOffset,
		importTable,
		totalSize: raw.byteLength,
	};
}

// =============================================================================
// Writer
// =============================================================================

export function writeModelData(
	model: ParsedModelResource,
	littleEndian: boolean = true,
): Uint8Array {
	const numRenderables = model.lodDistances.length;
	const numStates      = model.stateRenderableIndices.length;

	if (numRenderables > 0xFF) {
		throw new Error(`Model numRenderables ${numRenderables} > 255`);
	}
	if (numStates > 0xFF) {
		throw new Error(`Model numStates ${numStates} > 255`);
	}
	if (model.importTable.length !== numRenderables * MODEL_IMPORT_ENTRY_SIZE) {
		throw new Error(
			`Model importTable size ${model.importTable.length} doesn't match numRenderables*${MODEL_IMPORT_ENTRY_SIZE} = ${numRenderables * MODEL_IMPORT_ENTRY_SIZE}`,
		);
	}

	const out = new Uint8Array(model.totalSize);
	const w = new BinWriter(model.totalSize, littleEndian);
	// Use a parallel DataView for direct setUintXX writes at known offsets,
	// since BinWriter is sequential.
	const dv = new DataView(out.buffer, out.byteOffset, out.byteLength);
	const le = littleEndian;

	// Header.
	dv.setUint32(0x00, model.mppRenderablesOffset >>> 0, le);
	dv.setUint32(0x04, model.mpu8StateRenderableIndicesOffset >>> 0, le);
	dv.setUint32(0x08, model.mpfLodDistancesOffset >>> 0, le);
	dv.setInt32 (0x0C, model.miGameExplorerIndex | 0, le);
	dv.setUint8 (0x10, numRenderables);
	dv.setUint8 (0x11, model.flags & 0xFF);
	dv.setUint8 (0x12, numStates);
	dv.setUint8 (0x13, model.versionNumber & 0xFF);

	// mppRenderables[numRenderables]: numRenderables * 4 zero bytes (already
	// zero-filled by Uint8Array allocation). Bounds check though.
	if (model.mppRenderablesOffset + numRenderables * 4 > model.totalSize) {
		throw new Error('mppRenderables region exceeds totalSize');
	}

	// State indices (u8 × numStates).
	for (let i = 0; i < numStates; i++) {
		const off = model.mpu8StateRenderableIndicesOffset + i;
		if (off >= model.totalSize) {
			throw new Error('state indices region exceeds totalSize');
		}
		out[off] = model.stateRenderableIndices[i] & 0xFF;
	}

	// LOD distances (f32 × numRenderables).
	for (let i = 0; i < numRenderables; i++) {
		const off = model.mpfLodDistancesOffset + i * 4;
		if (off + 4 > model.totalSize) {
			throw new Error('LOD distances region exceeds totalSize');
		}
		dv.setFloat32(off, model.lodDistances[i], le);
	}

	// Import table.
	if (model.importTableOffset + model.importTable.length > model.totalSize) {
		throw new Error('import table region exceeds totalSize');
	}
	for (let i = 0; i < model.importTable.length; i++) {
		out[model.importTableOffset + i] = model.importTable[i] & 0xFF;
	}

	// Suppress "w used before defined" - BinWriter isn't actually used here;
	// keeping the import for symmetry with other parsers in case the layout
	// gets normalized later.
	void w;

	return out;
}

// =============================================================================
// Helpers
// =============================================================================

function align16(pos: number): number {
	return (pos + 15) & ~15;
}
