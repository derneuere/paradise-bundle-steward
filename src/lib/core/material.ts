// Material resource (CgsGraphics::Material) parser and writer.
// Resource type ID: 0x00000001
// Blender reference: import_bpr_models.py:1975 (read_material)
//
// A Material binds a Shader to a set of MaterialStates + TextureStates plus
// vertex- and pixel-shader constant arrays. The body is a dense mesh of
// pointer-chained tables whose exact layout varies per material; we don't
// try to decode it all. The registry handler needs two things:
//
//   1. Enough structure to let the viewer name the shader and the texture
//      resources (via the trailing import table).
//   2. A byte-exact round-trip so editing ids doesn't corrupt the body.
//
// So the model here is a shallow projection: a count pair (numMaterialStates
// + numTextureStates) pulled from the header, the trailing import table
// split into shader / material-states / texture-states, and an opaque body
// blob preserving everything in between. The writer reassembles
// `[body] + [shader] + [materialStates...] + [textureStates...]`.
//
// Binary layout (32-bit LE) — only the two fields the handler needs:
//
//   [0x08] u8   numMaterialStates        count of MaterialState imports
//   [0x09] u8   numTextureStates         count of TextureState imports
//   ... pointer-chained body (not decoded) ...
//   [importTableOffset]  import entries, each 16 bytes:
//                          u64 id | u32 ptrOffset | u32 pad
//                        order: shader (1), materialStates (N), textureStates (M)
//                        count = 1 + numMaterialStates + numTextureStates
//
// importTableOffset = totalSize - (1 + numMaterialStates + numTextureStates) * 16
// (matches bundle_packer_unpacker.py:594).
//
// Round-trip strategy: layout-preserving. Everything from +0x00 up to the
// start of the import table is kept as an opaque byte blob so the pointer-
// chained body survives unchanged; the writer re-emits that blob then
// serializes the structured imports.

import { BinReader, BinWriter } from './binTools';

export const MATERIAL_TYPE_ID = 0x00000001;
export const MATERIAL_IMPORT_ENTRY_SIZE = 0x10;
/** Minimum offset of the import table — the 0x24-byte header is the shortest
 *  Material body we could plausibly see. Used as a sanity bound on parse. */
const MATERIAL_MIN_HEADER_SIZE = 0x24;

// =============================================================================
// Types
// =============================================================================

export type MaterialImport = {
	/** u64 resource id of the referenced resource (Shader / MaterialState /
	 *  TextureState). */
	id: bigint;
	/** Offset back into the Material of the pointer slot to patch at load
	 *  time. Captured verbatim so unusual layouts still round-trip. */
	ptrOffset: number;
	/** Trailing u32 pad word. Zero in observed fixtures. */
	trailingPad: number;
};

export type ParsedMaterial = {
	/** u8 at +0x08 — count of MaterialState entries in the trailing import
	 *  table. Mirrored by materialStateImports.length on write. */
	numMaterialStates: number;
	/** u8 at +0x09 — count of TextureState entries in the trailing import
	 *  table. Mirrored by textureStateImports.length on write. */
	numTextureStates: number;

	/** Everything from 0x00 through the start of the trailing import table,
	 *  preserved verbatim. Stored as a plain number[] so the model survives
	 *  `JSON.parse(JSON.stringify(...))` round-trips (used by the stress /
	 *  fuzz CLI commands). */
	body: number[];

	/** Shader import — always the first entry in the import table. */
	shaderImport: MaterialImport;
	/** MaterialState imports, in order. Length == numMaterialStates. */
	materialStateImports: MaterialImport[];
	/** TextureState imports, in order. Length == numTextureStates. */
	textureStateImports: MaterialImport[];
};

// =============================================================================
// Parser
// =============================================================================

export function parseMaterialData(
	raw: Uint8Array,
	littleEndian: boolean = true,
): ParsedMaterial {
	if (raw.byteLength < MATERIAL_MIN_HEADER_SIZE + MATERIAL_IMPORT_ENTRY_SIZE) {
		throw new Error(
			`Material too small (${raw.byteLength} bytes, need at least ${MATERIAL_MIN_HEADER_SIZE + MATERIAL_IMPORT_ENTRY_SIZE})`,
		);
	}
	const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
	const numMaterialStates = dv.getUint8(0x08);
	const numTextureStates  = dv.getUint8(0x09);

	const importCount = 1 + numMaterialStates + numTextureStates;
	const importTableOffset = raw.byteLength - importCount * MATERIAL_IMPORT_ENTRY_SIZE;
	if (importTableOffset < MATERIAL_MIN_HEADER_SIZE) {
		throw new Error(
			`Material import table (${importCount} × ${MATERIAL_IMPORT_ENTRY_SIZE} B) does not fit (size ${raw.byteLength}, header ${MATERIAL_MIN_HEADER_SIZE})`,
		);
	}

	const body: number[] = new Array(importTableOffset);
	for (let i = 0; i < importTableOffset; i++) body[i] = raw[i];

	const r = new BinReader(
		raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength),
		littleEndian,
	);
	r.position = importTableOffset;

	const shaderImport = readImportEntry(r);
	const materialStateImports: MaterialImport[] = [];
	for (let i = 0; i < numMaterialStates; i++) materialStateImports.push(readImportEntry(r));
	const textureStateImports: MaterialImport[] = [];
	for (let i = 0; i < numTextureStates; i++) textureStateImports.push(readImportEntry(r));

	return {
		numMaterialStates,
		numTextureStates,
		body,
		shaderImport,
		materialStateImports,
		textureStateImports,
	};
}

function readImportEntry(r: BinReader): MaterialImport {
	const id = r.readU64();
	const ptrOffset = r.readU32();
	const trailingPad = r.readU32();
	return { id, ptrOffset, trailingPad };
}

// =============================================================================
// Writer
// =============================================================================

export function writeMaterialData(
	mat: ParsedMaterial,
	littleEndian: boolean = true,
): Uint8Array {
	if (mat.materialStateImports.length !== mat.numMaterialStates) {
		throw new Error(
			`Material materialStateImports length ${mat.materialStateImports.length} != numMaterialStates ${mat.numMaterialStates}`,
		);
	}
	if (mat.textureStateImports.length !== mat.numTextureStates) {
		throw new Error(
			`Material textureStateImports length ${mat.textureStateImports.length} != numTextureStates ${mat.numTextureStates}`,
		);
	}
	if (mat.numMaterialStates > 0xFF || mat.numTextureStates > 0xFF) {
		throw new Error(
			`Material counts overflow u8 (numMaterialStates=${mat.numMaterialStates}, numTextureStates=${mat.numTextureStates})`,
		);
	}

	const importCount = 1 + mat.numMaterialStates + mat.numTextureStates;
	const totalSize = mat.body.length + importCount * MATERIAL_IMPORT_ENTRY_SIZE;

	const out = new Uint8Array(totalSize);
	for (let i = 0; i < mat.body.length; i++) out[i] = mat.body[i] & 0xFF;

	// The u8 count fields live inside `body` at +0x08 / +0x09 and are
	// preserved verbatim through the opaque copy above. If they ever drift
	// away from the import array lengths we'd have caught it in the length
	// checks, so there's nothing to patch here.

	const w = new BinWriter(importCount * MATERIAL_IMPORT_ENTRY_SIZE, littleEndian);
	writeImportEntry(w, mat.shaderImport);
	for (const e of mat.materialStateImports) writeImportEntry(w, e);
	for (const e of mat.textureStateImports) writeImportEntry(w, e);
	out.set(w.bytes, mat.body.length);

	return out;
}

function writeImportEntry(w: BinWriter, entry: MaterialImport): void {
	w.writeU64(entry.id);
	w.writeU32(entry.ptrOffset >>> 0);
	w.writeU32(entry.trailingPad >>> 0);
}
