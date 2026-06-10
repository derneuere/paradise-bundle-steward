// AptData parser and writer (resource type 0x1E).
//
// Apt is EA's Flash-derived UI format (Apt 2.03.00 in every Burnout Paradise
// release, per the wiki's Previous-versions page). Each of the 391 GUIAPT
// bundles carries exactly one AptData resource plus the Texture resources its
// geometry renders with. On disk the payload is five sections in fixed order:
//
//   0x00  CgsGui::AptDataHeader — 7 u32 fields + 4 pad bytes (0x20 total).
//   0x20  Base component name, then movie name — NUL-terminated ASCII, each
//         zero-padded to a 16-byte boundary. The header stores a pointer to
//         each; the BASE name (the component this movie was authored from,
//         e.g. B5BikeIcons' base is B5CarsIcon) physically comes FIRST even
//         though mpacMovieName is the header's first field.
//   ----  Apt movie data — starts with the tag "Apt Data:1:7:4\x1A\0". The
//         character tree, frames, and ActionScript bytecode live here. Every
//         pointer inside is relative to the section start, so the whole
//         section is position-independent and this module preserves it as a
//         verbatim opaque blob (_aptData). Full movie decoding is a separate,
//         much larger project (see the wiki's Apt_Data and Apt_Data/Actions).
//   ----  AptConstFile — 0x20-byte header ("Apt constant file\x1A\0\0" magic,
//         pMainCharacter, nConstants, aConstants). Retail GUIAPT stores ZERO
//         constants in every fixture; any constant entries/strings after the
//         header are preserved verbatim (_constTail).
//   ----  GuiGeometryObject — the render geometry the Apt characters draw:
//         files (one per shape character; AptCharacterShape.pRenderUnit holds
//         a muID from this list) → meshes → 0x14-byte 2D vertices (pos.xy,
//         RGBA8 colour, UV). All pointers here are FILE-relative; every
//         structure starts on a 16-byte boundary with zero padding between.
//         "GuiVertex**" is literal: each mesh stores an array of nVerts
//         pointers, then the packed vertex data they point into.
//   ----  Inline BND2 import table at align16(muSizeOfHeader) — one 16-byte
//         entry (u64 texture resource id, u32 fixup offset, u32 zero) per
//         TEXTURED mesh, in mesh walk order. The fixup offset targets that
//         mesh's mpTexture field, which the bundle loader patches with the
//         live texture pointer. muSizeOfHeader (despite the name) is the
//         total payload size EXCLUDING this table and its alignment pad.
//
// Wiki divergences found against retail bytes (burnout.wiki/wiki/Apt_Data):
//   - GuiGeometryMeshHeader.miTextureId is documented as "import index,
//     1-based" — FALSE. Import entries are in mesh walk order, and texture
//     ids do not index them (BIKEICONS walk order has texIds 4,3,2,1).
//     miTextureId matches the bitmap character id in the Apt character
//     library; untextured (vector) meshes use the sentinel 6969.
//   - mpTexture is "Imported resource (if present)" — on disk it holds a
//     small cookie (1-based texture-page-like value, 0 for vector meshes),
//     not a null pointer. Preserved verbatim in _mpTexture.
//
// Round-trip strategy: parse the structural layer rigidly (throw on any
// layout violation), keep the Apt movie + constant tail verbatim, and
// recompute every offset/pointer/size on write. Renaming the movie or
// editing geometry shifts later sections; the apt blob tolerates this
// because its internal pointers are section-relative.
//
// Scope: 32-bit PC little-endian (the only layout fixture-validated).

import { BinWriter } from './binTools';

// =============================================================================
// Enumerations (values observed + wiki tables)
// =============================================================================

export const APT_DATA_STATES = [
	{ value: 0, label: 'Loading' },
	{ value: 1, label: 'Loaded' },
	{ value: 2, label: 'Active' },
] as const;

export const APT_MESH_TYPES = [
	{ value: 0, label: 'Triangle list' },
	{ value: 1, label: 'Triangle strip' },
	{ value: 2, label: 'Line list' },
] as const;

export const APT_TEXTURE_MODES = [
	{ value: 0, label: 'Vector (untextured)' },
	{ value: 1, label: 'Textured, clamp' },
	{ value: 2, label: 'Textured, wrap' },
] as const;

export const APT_TEXTURE_MODE_VECTOR = 0;
/** miTextureId of every vector (untextured) mesh in retail — a joke sentinel. */
export const APT_UNTEXTURED_TEXTURE_ID = 6969;

// =============================================================================
// Types
// =============================================================================

export type AptGuiVertex = {
	/** 2D screen-space position (Apt movies use a 640x480-ish coordinate space). */
	mv2Pos: { x: number; y: number };
	/** renderengine::RGBA8 packed colour (u32, byte order R,G,B,A in memory). */
	mColour: number;
	/** Texture coordinates (0..1 into the texture page). */
	mv2Tex0UV: { x: number; y: number };
};

export type AptGuiMesh = {
	miMeshType: number; // i32 — APT_MESH_TYPES
	miTextureMode: number; // i32 — APT_TEXTURE_MODES
	/** Bitmap character id in the Apt character library; 6969 when vector. */
	miTextureId: number; // i32
	/**
	 * Sibling Texture (0x0) resource this mesh samples, from the inline
	 * import table entry whose fixup offset targets this mesh's mpTexture
	 * field. null exactly when miTextureMode is vector (0).
	 */
	textureResourceId: bigint | null;
	/** On-disk mpTexture cookie (1-based page-like value, 0 for vector). The
	 *  loader overwrites it via the import fixup; preserved verbatim. */
	_mpTexture: number; // u32
	vertices: AptGuiVertex[];
};

export type AptGuiGeometryFile = {
	/** Render-unit id — AptCharacterShape.pRenderUnit inside the opaque apt
	 *  blob references this value, so changing it orphans the shape. */
	muID: number;
	meshes: AptGuiMesh[];
};

export type ParsedAptData = {
	/** Component/movie name (mpacMovieName) — matches the resource debug name. */
	movieName: string;
	/** Base component this movie was authored from (often == movieName). */
	baseName: string;
	/** EAptDataState — 0 (Loading) on disk; the runtime advances it. */
	meCurrentState: number;
	_pad1C: number;
	/** Offset of the main AptCharacterAnimation, relative to the apt blob start. */
	pMainCharacter: number;
	/** Constant-table entry count — 0 in every retail GUIAPT resource. */
	nConstants: number;
	/** Bytes between the AptConstFile header and the geometry section —
	 *  constant entries + name strings when nConstants > 0; empty in retail. */
	_constTail: Uint8Array;
	/** GuiGeometryObject.muNumberOfTexturePages — count of sibling texture
	 *  pages the meshes draw from (not recomputable from this resource alone). */
	muNumberOfTexturePages: number;
	geometryFiles: AptGuiGeometryFile[];
	/** Verbatim Apt movie section (tag, characters, frames, ActionScript).
	 *  Position-independent: all internal pointers are section-relative. */
	_aptData: Uint8Array;
};

// =============================================================================
// Constants
// =============================================================================

const HEADER_SIZE = 0x20;
const NAMES_OFFSET = 0x20;
const APT_TAG_PREFIX = 'Apt Data:1:7:4';
// "Apt constant file" + 0x1A, zero-padded to 20 bytes.
const CONST_MAGIC = new Uint8Array([
	0x41, 0x70, 0x74, 0x20, 0x63, 0x6f, 0x6e, 0x73, 0x74, 0x61,
	0x6e, 0x74, 0x20, 0x66, 0x69, 0x6c, 0x65, 0x1a, 0x00, 0x00,
]);
const CONST_FILE_HEADER_SIZE = 0x20;
const FILE_STRUCT_SIZE = 0xc;
const MESH_STRUCT_SIZE = 0x18;
const VERTEX_SIZE = 0x14;
const IMPORT_ENTRY_SIZE = 16;

const align16 = (n: number) => (n + 15) & ~15;

function fail(msg: string): never {
	throw new Error(`AptData: ${msg}`);
}

// =============================================================================
// Reader
// =============================================================================

export function parseAptData(raw: Uint8Array, littleEndian = true): ParsedAptData {
	// Copy up front: raw may be a Buffer view into a larger zlib output, and
	// the verbatim _aptData/_constTail slices below must be true copies.
	const bytes = new Uint8Array(raw);
	const view = new DataView(bytes.buffer);
	const u32 = (o: number) => view.getUint32(o, littleEndian);
	const i32 = (o: number) => view.getInt32(o, littleEndian);
	const f32 = (o: number) => view.getFloat32(o, littleEndian);
	const u64 = (o: number) =>
		(BigInt(u32(o + 4)) << 32n) | BigInt(u32(o));
	const assertZero = (from: number, to: number, what: string) => {
		for (let i = from; i < to; i++) {
			if (bytes[i] !== 0) fail(`${what}: nonzero pad byte 0x${bytes[i].toString(16)} at 0x${i.toString(16)}`);
		}
	};
	const cstr = (off: number) => {
		let end = off;
		while (end < bytes.length && bytes[end] !== 0) end++;
		if (end >= bytes.length) fail(`unterminated string at 0x${off.toString(16)}`);
		return new TextDecoder().decode(bytes.subarray(off, end));
	};

	if (bytes.length < HEADER_SIZE) fail(`payload too small (${bytes.length} bytes) for the 0x20 header`);

	// --- CgsGui::AptDataHeader (0x20 bytes) ---
	const movieNameOff = u32(0x00);
	const baseNameOff = u32(0x04);
	const aptDataOff = u32(0x08);
	const constDataOff = u32(0x0c);
	const geomOff = u32(0x10);
	const muSizeOfHeader = u32(0x14);
	const meCurrentState = u32(0x18);
	const _pad1C = u32(0x1c);

	// --- Name strings (base first, each padded to 16) ---
	if (baseNameOff !== NAMES_OFFSET) fail(`baseName at 0x${baseNameOff.toString(16)}, expected 0x20 (rigid layout)`);
	const baseName = cstr(baseNameOff);
	const expectedMovieOff = baseNameOff + align16(baseName.length + 1);
	if (movieNameOff !== expectedMovieOff) fail(`movieName at 0x${movieNameOff.toString(16)}, expected 0x${expectedMovieOff.toString(16)}`);
	assertZero(baseNameOff + baseName.length + 1, movieNameOff, 'baseName pad');
	const movieName = cstr(movieNameOff);
	const expectedAptOff = movieNameOff + align16(movieName.length + 1);
	if (aptDataOff !== expectedAptOff) fail(`apt data at 0x${aptDataOff.toString(16)}, expected 0x${expectedAptOff.toString(16)}`);
	assertZero(movieNameOff + movieName.length + 1, aptDataOff, 'movieName pad');

	// --- Section ordering sanity ---
	if (!(aptDataOff < constDataOff && constDataOff + CONST_FILE_HEADER_SIZE <= geomOff
		&& geomOff + 12 <= muSizeOfHeader && muSizeOfHeader <= bytes.length)) {
		fail(`section offsets out of order: apt=0x${aptDataOff.toString(16)} const=0x${constDataOff.toString(16)} geom=0x${geomOff.toString(16)} size=0x${muSizeOfHeader.toString(16)} payload=0x${bytes.length.toString(16)}`);
	}

	// --- Apt movie blob (verbatim) ---
	const _aptData = bytes.slice(aptDataOff, constDataOff);
	const tag = new TextDecoder().decode(_aptData.subarray(0, APT_TAG_PREFIX.length));
	if (tag !== APT_TAG_PREFIX) fail(`apt section tag '${tag}' != '${APT_TAG_PREFIX}'`);

	// --- AptConstFile ---
	for (let i = 0; i < CONST_MAGIC.length; i++) {
		if (bytes[constDataOff + i] !== CONST_MAGIC[i]) fail(`bad AptConstFile magic at +${i}`);
	}
	const pMainCharacter = u32(constDataOff + 0x14);
	const nConstants = i32(constDataOff + 0x18);
	const aConstants = u32(constDataOff + 0x1c);
	if (aConstants !== CONST_FILE_HEADER_SIZE) fail(`aConstants 0x${aConstants.toString(16)}, expected 0x20`);
	const _constTail = bytes.slice(constDataOff + CONST_FILE_HEADER_SIZE, geomOff);

	// --- CgsResource::GuiGeometryObject ---
	const numFiles = u32(geomOff);
	const muNumberOfTexturePages = u32(geomOff + 4);
	const ppFiles = u32(geomOff + 8);
	if (ppFiles !== align16(geomOff + 12)) fail(`ppFiles 0x${ppFiles.toString(16)}, expected 0x${align16(geomOff + 12).toString(16)}`);
	assertZero(geomOff + 12, ppFiles, 'geom object pad');

	const fileStructsStart = align16(ppFiles + numFiles * 4);
	assertZero(ppFiles + numFiles * 4, fileStructsStart, 'file ptr array pad');

	// Walk-order list of mpTexture field offsets for textured meshes — the
	// import table entries must hit exactly these, in this order.
	const texturedSlots: number[] = [];
	const texturedMeshes: AptGuiMesh[] = [];
	const geometryFiles: AptGuiGeometryFile[] = [];
	let cursor = align16(fileStructsStart + numFiles * FILE_STRUCT_SIZE);
	if (numFiles > 0) assertZero(fileStructsStart + numFiles * FILE_STRUCT_SIZE, cursor, 'file structs pad');
	let rawEnd = ppFiles; // geometry end before alignment; == ppFiles when no files

	for (let f = 0; f < numFiles; f++) {
		const structOff = fileStructsStart + f * FILE_STRUCT_SIZE;
		if (u32(ppFiles + f * 4) !== structOff) fail(`file[${f}] pointer 0x${u32(ppFiles + f * 4).toString(16)}, expected 0x${structOff.toString(16)}`);
		const muID = u32(structOff);
		const numMeshes = u32(structOff + 4);
		const ppMeshes = u32(structOff + 8);
		if (ppMeshes !== cursor) fail(`file[${f}] ppMeshes 0x${ppMeshes.toString(16)}, expected 0x${cursor.toString(16)}`);

		let c = align16(ppMeshes + numMeshes * 4);
		assertZero(ppMeshes + numMeshes * 4, c, `file[${f}] mesh ptr array pad`);
		const meshes: AptGuiMesh[] = [];
		for (let m = 0; m < numMeshes; m++) {
			if (u32(ppMeshes + m * 4) !== c) fail(`file[${f}].mesh[${m}] pointer 0x${u32(ppMeshes + m * 4).toString(16)}, expected 0x${c.toString(16)}`);
			const miMeshType = i32(c);
			const miTextureMode = i32(c + 4);
			const miTextureId = i32(c + 8);
			const _mpTexture = u32(c + 12);
			const numVerts = u32(c + 16);
			const ppVerts = u32(c + 20);
			const mpTextureSlot = c + 12;
			const expectedPpVerts = align16(c + MESH_STRUCT_SIZE);
			if (ppVerts !== expectedPpVerts) fail(`file[${f}].mesh[${m}] ppVerts 0x${ppVerts.toString(16)}, expected 0x${expectedPpVerts.toString(16)}`);
			assertZero(c + MESH_STRUCT_SIZE, ppVerts, `file[${f}].mesh[${m}] header pad`);

			const vertsStart = align16(ppVerts + numVerts * 4);
			assertZero(ppVerts + numVerts * 4, vertsStart, `file[${f}].mesh[${m}] vert ptr array pad`);
			const vertices: AptGuiVertex[] = [];
			for (let v = 0; v < numVerts; v++) {
				const vOff = vertsStart + v * VERTEX_SIZE;
				if (u32(ppVerts + v * 4) !== vOff) fail(`file[${f}].mesh[${m}] vertex ptr[${v}] 0x${u32(ppVerts + v * 4).toString(16)}, expected 0x${vOff.toString(16)}`);
				vertices.push({
					mv2Pos: { x: f32(vOff), y: f32(vOff + 4) },
					mColour: u32(vOff + 8),
					mv2Tex0UV: { x: f32(vOff + 12), y: f32(vOff + 16) },
				});
			}
			rawEnd = vertsStart + numVerts * VERTEX_SIZE;
			const mesh: AptGuiMesh = { miMeshType, miTextureMode, miTextureId, textureResourceId: null, _mpTexture, vertices };
			if (miTextureMode !== APT_TEXTURE_MODE_VECTOR) {
				texturedSlots.push(mpTextureSlot);
				texturedMeshes.push(mesh);
			}
			meshes.push(mesh);
			c = align16(rawEnd);
			assertZero(rawEnd, Math.min(c, bytes.length), `file[${f}].mesh[${m}] vertex data pad`);
		}
		cursor = c;
		geometryFiles.push({ muID, meshes });
	}
	if (rawEnd !== muSizeOfHeader) fail(`geometry walk ended at 0x${rawEnd.toString(16)}, muSizeOfHeader says 0x${muSizeOfHeader.toString(16)}`);

	// --- Inline BND2 import table (one entry per textured mesh) ---
	const importStart = Math.min(align16(muSizeOfHeader), bytes.length);
	assertZero(muSizeOfHeader, importStart, 'pre-import pad');
	const tailLen = bytes.length - importStart;
	if (tailLen % IMPORT_ENTRY_SIZE !== 0) fail(`import tail ${tailLen} bytes is not a multiple of 16`);
	const importCount = tailLen / IMPORT_ENTRY_SIZE;
	if (importCount !== texturedSlots.length) fail(`${importCount} import entries but ${texturedSlots.length} textured meshes`);
	for (let k = 0; k < importCount; k++) {
		const e = importStart + k * IMPORT_ENTRY_SIZE;
		const off = u32(e + 8);
		if (off !== texturedSlots[k]) fail(`import[${k}] fixup 0x${off.toString(16)}, expected mpTexture slot 0x${texturedSlots[k].toString(16)}`);
		if (u32(e + 12) !== 0) fail(`import[${k}] pad word nonzero`);
		texturedMeshes[k].textureResourceId = u64(e);
	}

	return {
		movieName,
		baseName,
		meCurrentState,
		_pad1C,
		pMainCharacter,
		nConstants,
		_constTail,
		muNumberOfTexturePages,
		geometryFiles,
		_aptData,
	};
}

// =============================================================================
// Writer
// =============================================================================

export function writeAptData(model: ParsedAptData, littleEndian = true): Uint8Array {
	if (model._aptData.length < 16 || model._aptData.length % 16 !== 0) {
		fail(`_aptData blob length ${model._aptData.length} must be a non-zero multiple of 16`);
	}
	const tag = new TextDecoder().decode(model._aptData.subarray(0, APT_TAG_PREFIX.length));
	if (tag !== APT_TAG_PREFIX) fail(`_aptData blob does not start with '${APT_TAG_PREFIX}'`);
	if (model._constTail.length % 16 !== 0) fail(`_constTail length ${model._constTail.length} must be a multiple of 16`);
	for (const file of model.geometryFiles) {
		for (const mesh of file.meshes) {
			const textured = mesh.miTextureMode !== APT_TEXTURE_MODE_VECTOR;
			if (textured && mesh.textureResourceId == null) fail(`textured mesh in file ${file.muID} has no textureResourceId`);
			if (!textured && mesh.textureResourceId != null) fail(`vector mesh in file ${file.muID} carries a textureResourceId`);
		}
	}

	// --- Layout pass: every offset is derived, nothing stored is trusted. ---
	const baseRegion = align16(model.baseName.length + 1);
	const movieRegion = align16(model.movieName.length + 1);
	const aptDataOff = NAMES_OFFSET + baseRegion + movieRegion;
	const constDataOff = aptDataOff + model._aptData.length;
	const geomOff = constDataOff + CONST_FILE_HEADER_SIZE + model._constTail.length;
	const numFiles = model.geometryFiles.length;
	const ppFiles = align16(geomOff + 12);
	const fileStructsStart = align16(ppFiles + numFiles * 4);

	type MeshLayout = { meshOff: number; ppVerts: number; vertsStart: number };
	const fileLayouts: { ppMeshes: number; meshLayouts: MeshLayout[] }[] = [];
	let cursor = align16(fileStructsStart + numFiles * FILE_STRUCT_SIZE);
	let rawEnd = ppFiles;
	const texturedSlots: number[] = [];
	const texturedIds: bigint[] = [];
	for (const file of model.geometryFiles) {
		const ppMeshes = cursor;
		let c = align16(ppMeshes + file.meshes.length * 4);
		const meshLayouts: MeshLayout[] = [];
		for (const mesh of file.meshes) {
			const meshOff = c;
			const ppVerts = align16(meshOff + MESH_STRUCT_SIZE);
			const vertsStart = align16(ppVerts + mesh.vertices.length * 4);
			meshLayouts.push({ meshOff, ppVerts, vertsStart });
			if (mesh.miTextureMode !== APT_TEXTURE_MODE_VECTOR) {
				texturedSlots.push(meshOff + 12);
				texturedIds.push(mesh.textureResourceId as bigint);
			}
			rawEnd = vertsStart + mesh.vertices.length * VERTEX_SIZE;
			c = align16(rawEnd);
		}
		cursor = c;
		fileLayouts.push({ ppMeshes, meshLayouts });
	}
	const muSizeOfHeader = rawEnd;
	const importStart = align16(muSizeOfHeader);
	const totalSize = texturedSlots.length > 0
		? importStart + texturedSlots.length * IMPORT_ENTRY_SIZE
		: muSizeOfHeader;

	// --- Emit pass ---
	const w = new BinWriter(totalSize, littleEndian);
	const padTo = (target: number, what: string) => {
		if (w.offset > target) fail(`writer overran ${what}: at 0x${w.offset.toString(16)}, expected 0x${target.toString(16)}`);
		w.writeZeroes(target - w.offset);
	};

	w.writeU32(NAMES_OFFSET + baseRegion); // mpacMovieName
	w.writeU32(NAMES_OFFSET); // base component name
	w.writeU32(aptDataOff);
	w.writeU32(constDataOff);
	w.writeU32(geomOff);
	w.writeU32(muSizeOfHeader);
	w.writeU32(model.meCurrentState);
	w.writeU32(model._pad1C);

	w.writeFixedString(model.baseName, baseRegion);
	w.writeFixedString(model.movieName, movieRegion);
	w.writeBytes(model._aptData);

	w.writeBytes(CONST_MAGIC);
	w.writeU32(model.pMainCharacter);
	w.writeI32(model.nConstants);
	w.writeU32(CONST_FILE_HEADER_SIZE); // aConstants
	if (model._constTail.length > 0) w.writeBytes(model._constTail);

	if (w.offset !== geomOff) fail(`writer geometry offset mismatch 0x${w.offset.toString(16)} vs 0x${geomOff.toString(16)}`);
	w.writeU32(numFiles);
	w.writeU32(model.muNumberOfTexturePages);
	w.writeU32(ppFiles);
	padTo(ppFiles, 'file ptr array');
	for (let f = 0; f < numFiles; f++) w.writeU32(fileStructsStart + f * FILE_STRUCT_SIZE);
	padTo(fileStructsStart, 'file structs');
	for (let f = 0; f < numFiles; f++) {
		w.writeU32(model.geometryFiles[f].muID);
		w.writeU32(model.geometryFiles[f].meshes.length);
		w.writeU32(fileLayouts[f].ppMeshes);
	}
	for (let f = 0; f < numFiles; f++) {
		const file = model.geometryFiles[f];
		const layout = fileLayouts[f];
		padTo(layout.ppMeshes, `file[${f}] mesh ptrs`);
		for (const ml of layout.meshLayouts) w.writeU32(ml.meshOff);
		for (let m = 0; m < file.meshes.length; m++) {
			const mesh = file.meshes[m];
			const ml = layout.meshLayouts[m];
			padTo(ml.meshOff, `file[${f}].mesh[${m}]`);
			w.writeI32(mesh.miMeshType);
			w.writeI32(mesh.miTextureMode);
			w.writeI32(mesh.miTextureId);
			w.writeU32(mesh._mpTexture);
			w.writeU32(mesh.vertices.length);
			w.writeU32(ml.ppVerts);
			padTo(ml.ppVerts, `file[${f}].mesh[${m}] vert ptrs`);
			for (let v = 0; v < mesh.vertices.length; v++) w.writeU32(ml.vertsStart + v * VERTEX_SIZE);
			padTo(ml.vertsStart, `file[${f}].mesh[${m}] vertex data`);
			for (const vert of mesh.vertices) {
				w.writeF32(vert.mv2Pos.x);
				w.writeF32(vert.mv2Pos.y);
				w.writeU32(vert.mColour);
				w.writeF32(vert.mv2Tex0UV.x);
				w.writeF32(vert.mv2Tex0UV.y);
			}
		}
	}
	if (w.offset !== muSizeOfHeader) fail(`writer ended geometry at 0x${w.offset.toString(16)}, expected 0x${muSizeOfHeader.toString(16)}`);

	if (texturedSlots.length > 0) {
		padTo(importStart, 'import table');
		for (let k = 0; k < texturedSlots.length; k++) {
			w.writeU64(texturedIds[k]);
			w.writeU32(texturedSlots[k]);
			w.writeU32(0);
		}
	}
	if (w.offset !== totalSize) fail(`writer produced 0x${w.offset.toString(16)} bytes, expected 0x${totalSize.toString(16)}`);
	return w.bytes;
}

// =============================================================================
// Helpers shared with the registry handler
// =============================================================================

/** Number of textured meshes == number of inline import entries. */
export function countAptTextureImports(model: ParsedAptData): number {
	let n = 0;
	for (const file of model.geometryFiles) {
		for (const mesh of file.meshes) {
			if (mesh.miTextureMode !== APT_TEXTURE_MODE_VECTOR) n++;
		}
	}
	return n;
}

/** Payload-relative import-table location for the envelope writer. */
export function aptDataImportTable(payload: Uint8Array, littleEndian = true): { offset: number; count: number } {
	const model = parseAptData(payload, littleEndian); // loud failure beats wrong envelope metadata
	const count = countAptTextureImports(model);
	if (count === 0) return { offset: 0, count: 0 };
	const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
	return { offset: align16(view.getUint32(0x14, littleEndian)), count };
}
