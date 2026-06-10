// FlaptFile parser and writer (resource type 0x10020).
//
// Flapt ("Friends List Apt", per the wiki's best guess) is the in-game HUD —
// a Flash-derived GUI like AptData (0x1E) but compiled flat: one FlaptFile
// resource in FLAPTHUD.BUNDLE plus the 52 sibling Texture (0x0) pages its
// meshes sample. Unlike AptData's section-relative blob, EVERY pointer here is
// a payload-relative absolute offset, including pointers buried inside the
// 560 MovieClip structs (frame maps, render layers, keyframe anims, FScript
// streams). Shifting any byte therefore breaks pointers in regions this
// module does not decode — so the round-trip strategy is the inverse of
// AptData's: keep the WHOLE payload verbatim (_payload) and write by patching
// fixed-width fields in place. Layout never changes, byte-exactness is
// structural, and the un-decoded 1.2 MB of timeline data is untouched.
//
// Payload map (retail FLAPTHUD, fixture-grounded):
//   0x00     BrnFlapt::FlaptFile header (0x58): version 12, muSizeInBytes,
//            mfTimePerFrame, then 9 count+pointer pairs and FileDebugData.
//   0x58     MovieClip[560] — 0x44 each; this module decodes the scalar
//            counts and the component-name string, nothing deeper.
//   ....     GuiVertex[1650] (0x14 each), FontStyle[65] (0xC each),
//            HashedString[429] component names, IndexPath[429] (0x21 each),
//            debug-string pointer table, string pools, TriggerParameters[75],
//            CgsUtf8* string table, GuiTexture*[53], timeline sub-data.
//   tail     Inline BND2 import table at align16(muSizeInBytes) — one
//            16-byte entry (u64 texture id, u32 fixup, u32 zero) per imported
//            texture slot. Fixup k targets mpapTextures + k*4: the loader
//            patches the texture POINTER ARRAY itself, not mesh fields.
//
// Fixture facts the wiki does not state:
//   - Padding/garbage fill is 0xB0 (header pad, MovieClip pad, align gaps) —
//     not the usual 0xCD. Preserved verbatim by the patch-write strategy.
//   - mpapTextures slots hold their own 0-based index as a cookie; the one
//     slot WITHOUT an import entry (slot 52) holds 0 and is resolved at
//     runtime by name via mpapSpecialTextureNames ('CustomComponentTexture.tif').
//   - MovieClip pointers whose count is 0 can hold stale heap garbage
//     (0xFEF9E400) — only count>0 pointers are meaningful.
//   - mpFile is 0 on disk for all 560 clips (runtime back-pointer).
//   - muSizeInBytes excludes the import table, exactly like AptData's
//     muSizeOfHeader.
//
// Editable surface (fixed-width, patched in place): mfTimePerFrame, GuiVertex
// fields, FontStyle colour/height, and import-table texture ids. Everything
// pointer-bearing (strings, components, clip structure) is decoded read-only.
//
// Scope: 32-bit PC little-endian (the only layout fixture-validated).

export const FLAPT_VERSION = 12;

// =============================================================================
// Types
// =============================================================================

export type FlaptGuiVertex = {
	/** 2D screen-space position (HUD coordinate space, origin at element anchor). */
	mv2Pos: { x: number; y: number };
	/** renderengine::RGBA8 packed colour (u32). 0xFFFFFFFF = untinted. */
	mColour: number;
	/** Texture coordinates (0..1 into the mesh's texture page). */
	mv2Tex0UV: { x: number; y: number };
};

export type FlaptFontStyle = {
	/** Font face name (pooled string; pointer not relocatable, so read-only). */
	fontName: string;
	muColour: number; // u32 RGBA8
	mfFontHeight: number; // f32, pixels
};

export type FlaptTexture = {
	/**
	 * Sibling Texture (0x0) resource bound to this mpapTextures slot via the
	 * inline import table. null for slots with no import entry — those are
	 * "special" textures the game resolves by name at runtime (see
	 * specialTextureNames).
	 */
	resourceId: bigint | null;
};

export type FlaptComponent = {
	/** Language hash of the component name (burnout.wiki/wiki/Language_hash). */
	muHash: number;
	/** Debug string the hash was computed from. */
	debugName: string;
	/** IndexPath — child indices walked from the root clip to reach this component. */
	pathIndices: number[];
};

export type FlaptTriggerParameters = {
	parameter0: string | null;
	parameter1: string | null;
	parameter2: string | null;
	parameter3: string | null;
};

export type FlaptMovieClip = {
	mxFlags: number; // u8
	muNumChildren: number;
	muNumMeshes: number;
	muNumTextFields: number;
	muNumRenderLayers: number;
	muNumLabelledFrames: number;
	muNumFScriptCommands: number;
	muNumFramesInTimeline: number; // u16
	muNumKeyFrames: number; // u16
	/** Component name when this clip is an addressable component, else null. */
	componentName: string | null;
};

export type ParsedFlaptFile = {
	/** Format version — 12 in retail; the parser rejects anything else. */
	muVersion: number;
	/** Seconds per timeline frame (0.0333… = 30 fps in retail). */
	mfTimePerFrame: number;
	movieClips: FlaptMovieClip[];
	/** One entry per mpapTextures slot, in slot order. */
	textures: FlaptTexture[];
	vertices: FlaptGuiVertex[];
	fontStyles: FlaptFontStyle[];
	components: FlaptComponent[];
	triggerParameters: FlaptTriggerParameters[];
	/** CgsUtf8 string table — the HUD's display text ('$100', countdowns, …). */
	strings: string[];
	/** Names of textures resolved at runtime instead of imported. */
	specialTextureNames: string[];
	/** FileDebugData.muNumStrings — the debug string pool is not decoded. */
	debugStringCount: number;
	/** Verbatim payload INCLUDING the import-table tail. The writer patches
	 *  fixed-width fields into a copy of this; layout never changes. */
	_payload: Uint8Array;
};

// =============================================================================
// Constants
// =============================================================================

const HEADER_SIZE = 0x58;
const CLIP_SIZE = 0x44;
const VERTEX_SIZE = 0x14;
const FONT_SIZE = 0xc;
const HASHED_STRING_SIZE = 8;
const INDEX_PATH_SIZE = 0x21;
const INDEX_PATH_MAX_DEPTH = 32;
const TRIGGER_PARAMS_SIZE = 0x10;
const IMPORT_ENTRY_SIZE = 16;

const align16 = (n: number) => (n + 15) & ~15;

function fail(msg: string): never {
	throw new Error(`FlaptFile: ${msg}`);
}

type Header = {
	muSizeInBytes: number;
	numClips: number; pClips: number;
	numTextures: number; ppTextures: number;
	numVerts: number; pVerts: number;
	numFonts: number; pFonts: number;
	numComponents: number; pCompNames: number; pCompPaths: number;
	numTriggers: number; pTriggers: number;
	numStrings: number; ppStrings: number;
	numSpecialTextures: number; ppSpecialTextureNames: number;
	debugStringCount: number;
};

function readHeader(view: DataView, length: number, littleEndian: boolean): Header {
	if (length < HEADER_SIZE) fail(`payload too small (${length} bytes) for the 0x58 header`);
	const u32 = (o: number) => view.getUint32(o, littleEndian);
	if (view.getUint8(0) !== FLAPT_VERSION) fail(`muVersion ${view.getUint8(0)}, only version ${FLAPT_VERSION} is supported`);
	const h: Header = {
		muSizeInBytes: u32(0x04),
		numClips: u32(0x0c), pClips: u32(0x10),
		numTextures: u32(0x14), ppTextures: u32(0x18),
		numVerts: u32(0x1c), pVerts: u32(0x20),
		numFonts: u32(0x24), pFonts: u32(0x28),
		numComponents: u32(0x2c), pCompNames: u32(0x30), pCompPaths: u32(0x34),
		numTriggers: u32(0x38), pTriggers: u32(0x3c),
		numStrings: u32(0x40), ppStrings: u32(0x44),
		numSpecialTextures: u32(0x48), ppSpecialTextureNames: u32(0x4c),
		debugStringCount: u32(0x50),
	};
	if (h.muSizeInBytes < HEADER_SIZE || h.muSizeInBytes > length) {
		fail(`muSizeInBytes 0x${h.muSizeInBytes.toString(16)} out of range for ${length}-byte payload`);
	}
	const tail = length - align16(h.muSizeInBytes);
	if (tail < 0 || tail % IMPORT_ENTRY_SIZE !== 0) fail(`import tail ${tail} bytes is not a multiple of ${IMPORT_ENTRY_SIZE}`);
	return h;
}

function checkRegion(h: Header, ptr: number, count: number, stride: number, what: string) {
	if (count === 0) return; // count-0 pointers can hold stale heap garbage
	if (ptr < HEADER_SIZE || ptr + count * stride > h.muSizeInBytes) {
		fail(`${what} region 0x${ptr.toString(16)}+${count}*0x${stride.toString(16)} escapes the payload body`);
	}
}

// =============================================================================
// Reader
// =============================================================================

export function parseFlaptFile(raw: Uint8Array, littleEndian = true): ParsedFlaptFile {
	// Copy up front: raw may be a Buffer view into a larger zlib output, and
	// _payload must be an independent verbatim copy.
	const bytes = new Uint8Array(raw);
	const view = new DataView(bytes.buffer);
	const u8 = (o: number) => view.getUint8(o);
	const u16 = (o: number) => view.getUint16(o, littleEndian);
	const u32 = (o: number) => view.getUint32(o, littleEndian);
	const f32 = (o: number) => view.getFloat32(o, littleEndian);
	const u64 = (o: number) => (BigInt(u32(o + 4)) << 32n) | BigInt(u32(o));
	const h = readHeader(view, bytes.length, littleEndian);
	const cstr = (off: number, what: string) => {
		if (off < HEADER_SIZE || off >= h.muSizeInBytes) fail(`${what}: string pointer 0x${off.toString(16)} out of bounds`);
		let end = off;
		while (end < h.muSizeInBytes && bytes[end] !== 0) end++;
		if (end >= h.muSizeInBytes) fail(`${what}: unterminated string at 0x${off.toString(16)}`);
		return new TextDecoder().decode(bytes.subarray(off, end));
	};

	checkRegion(h, h.pClips, h.numClips, CLIP_SIZE, 'movie clips');
	checkRegion(h, h.ppTextures, h.numTextures, 4, 'texture pointer array');
	checkRegion(h, h.pVerts, h.numVerts, VERTEX_SIZE, 'vertices');
	checkRegion(h, h.pFonts, h.numFonts, FONT_SIZE, 'font styles');
	checkRegion(h, h.pCompNames, h.numComponents, HASHED_STRING_SIZE, 'component names');
	checkRegion(h, h.pCompPaths, h.numComponents, INDEX_PATH_SIZE, 'component paths');
	checkRegion(h, h.pTriggers, h.numTriggers, TRIGGER_PARAMS_SIZE, 'trigger parameters');
	checkRegion(h, h.ppStrings, h.numStrings, 4, 'string pointer array');
	checkRegion(h, h.ppSpecialTextureNames, h.numSpecialTextures, 4, 'special texture name pointers');

	const movieClips: FlaptMovieClip[] = [];
	for (let i = 0; i < h.numClips; i++) {
		const o = h.pClips + i * CLIP_SIZE;
		const namePtr = u32(o + 0x40);
		movieClips.push({
			mxFlags: u8(o),
			muNumChildren: u8(o + 1),
			muNumMeshes: u8(o + 2),
			muNumTextFields: u8(o + 3),
			muNumRenderLayers: u8(o + 4),
			muNumLabelledFrames: u8(o + 5),
			muNumFScriptCommands: u8(o + 6),
			muNumFramesInTimeline: u16(o + 8),
			muNumKeyFrames: u16(o + 0xa),
			componentName: namePtr === 0 ? null : cstr(namePtr, `clip[${i}] componentName`),
		});
	}

	const vertices: FlaptGuiVertex[] = [];
	for (let i = 0; i < h.numVerts; i++) {
		const o = h.pVerts + i * VERTEX_SIZE;
		vertices.push({
			mv2Pos: { x: f32(o), y: f32(o + 4) },
			mColour: u32(o + 8),
			mv2Tex0UV: { x: f32(o + 12), y: f32(o + 16) },
		});
	}

	const fontStyles: FlaptFontStyle[] = [];
	for (let i = 0; i < h.numFonts; i++) {
		const o = h.pFonts + i * FONT_SIZE;
		fontStyles.push({
			fontName: cstr(u32(o), `fontStyle[${i}] name`),
			muColour: u32(o + 4),
			mfFontHeight: f32(o + 8),
		});
	}

	const components: FlaptComponent[] = [];
	for (let i = 0; i < h.numComponents; i++) {
		const no = h.pCompNames + i * HASHED_STRING_SIZE;
		const po = h.pCompPaths + i * INDEX_PATH_SIZE;
		const depth = u8(po);
		if (depth > INDEX_PATH_MAX_DEPTH) fail(`component[${i}] path depth ${depth} exceeds ${INDEX_PATH_MAX_DEPTH}`);
		const pathIndices: number[] = [];
		for (let d = 0; d < depth; d++) pathIndices.push(u8(po + 1 + d));
		components.push({
			muHash: u32(no),
			debugName: cstr(u32(no + 4), `component[${i}] debugName`),
			pathIndices,
		});
	}

	const triggerParameters: FlaptTriggerParameters[] = [];
	for (let i = 0; i < h.numTriggers; i++) {
		const o = h.pTriggers + i * TRIGGER_PARAMS_SIZE;
		const p = (j: number) => {
			const ptr = u32(o + j * 4);
			return ptr === 0 ? null : cstr(ptr, `trigger[${i}].parameter${j}`);
		};
		triggerParameters.push({ parameter0: p(0), parameter1: p(1), parameter2: p(2), parameter3: p(3) });
	}

	const strings: string[] = [];
	for (let i = 0; i < h.numStrings; i++) strings.push(cstr(u32(h.ppStrings + i * 4), `string[${i}]`));

	const specialTextureNames: string[] = [];
	for (let i = 0; i < h.numSpecialTextures; i++) {
		specialTextureNames.push(cstr(u32(h.ppSpecialTextureNames + i * 4), `specialTexture[${i}] name`));
	}

	// --- Inline BND2 import table: entry k binds texture slot (fixup-ppTextures)/4 ---
	const textures: FlaptTexture[] = Array.from({ length: h.numTextures }, () => ({ resourceId: null }));
	const importStart = align16(h.muSizeInBytes);
	const importCount = (bytes.length - importStart) / IMPORT_ENTRY_SIZE;
	for (let k = 0; k < importCount; k++) {
		const e = importStart + k * IMPORT_ENTRY_SIZE;
		const fixup = u32(e + 8);
		if (u32(e + 12) !== 0) fail(`import[${k}] pad word nonzero`);
		const rel = fixup - h.ppTextures;
		if (rel < 0 || rel % 4 !== 0 || rel / 4 >= h.numTextures) {
			fail(`import[${k}] fixup 0x${fixup.toString(16)} does not target a texture slot`);
		}
		const slot = rel / 4;
		if (textures[slot].resourceId !== null) fail(`import[${k}] targets slot ${slot} twice`);
		textures[slot].resourceId = u64(e);
	}

	return {
		muVersion: u8(0),
		mfTimePerFrame: f32(8),
		movieClips,
		textures,
		vertices,
		fontStyles,
		components,
		triggerParameters,
		strings,
		specialTextureNames,
		debugStringCount: h.debugStringCount,
		_payload: bytes,
	};
}

// =============================================================================
// Writer — verbatim payload + in-place patches (layout never moves)
// =============================================================================

export function writeFlaptFile(model: ParsedFlaptFile, littleEndian = true): Uint8Array {
	const src = model._payload;
	if (!(src instanceof Uint8Array)) fail('_payload missing — the model must come from parseFlaptFile');
	const out = new Uint8Array(src);
	const view = new DataView(out.buffer);
	const u32 = (o: number) => view.getUint32(o, littleEndian);
	const h = readHeader(view, out.length, littleEndian);

	const expect = (got: number, want: number, what: string) => {
		if (got !== want) fail(`${what} length ${got} != payload's ${want} — counts are fixed, the writer only patches in place`);
	};
	expect(model.movieClips.length, h.numClips, 'movieClips');
	expect(model.textures.length, h.numTextures, 'textures');
	expect(model.vertices.length, h.numVerts, 'vertices');
	expect(model.fontStyles.length, h.numFonts, 'fontStyles');
	expect(model.components.length, h.numComponents, 'components');
	expect(model.triggerParameters.length, h.numTriggers, 'triggerParameters');
	expect(model.strings.length, h.numStrings, 'strings');
	expect(model.specialTextureNames.length, h.numSpecialTextures, 'specialTextureNames');

	view.setFloat32(8, model.mfTimePerFrame, littleEndian);

	for (let i = 0; i < model.vertices.length; i++) {
		const o = h.pVerts + i * VERTEX_SIZE;
		const v = model.vertices[i];
		view.setFloat32(o, v.mv2Pos.x, littleEndian);
		view.setFloat32(o + 4, v.mv2Pos.y, littleEndian);
		view.setUint32(o + 8, v.mColour >>> 0, littleEndian);
		view.setFloat32(o + 12, v.mv2Tex0UV.x, littleEndian);
		view.setFloat32(o + 16, v.mv2Tex0UV.y, littleEndian);
	}

	for (let i = 0; i < model.fontStyles.length; i++) {
		const o = h.pFonts + i * FONT_SIZE;
		view.setUint32(o + 4, model.fontStyles[i].muColour >>> 0, littleEndian);
		view.setFloat32(o + 8, model.fontStyles[i].mfFontHeight, littleEndian);
	}

	// Re-emit import-table texture ids through the payload's own slot mapping.
	const importStart = align16(h.muSizeInBytes);
	const importCount = (out.length - importStart) / IMPORT_ENTRY_SIZE;
	const importedSlots = new Set<number>();
	for (let k = 0; k < importCount; k++) {
		const e = importStart + k * IMPORT_ENTRY_SIZE;
		const slot = (u32(e + 8) - h.ppTextures) / 4;
		if (!Number.isInteger(slot) || slot < 0 || slot >= h.numTextures) {
			fail(`import[${k}] fixup does not target a texture slot`);
		}
		importedSlots.add(slot);
		const rid = model.textures[slot].resourceId;
		if (rid == null) fail(`texture slot ${slot} has an import entry but resourceId is null`);
		view.setUint32(e, Number(rid & 0xffffffffn), littleEndian);
		view.setUint32(e + 4, Number((rid >> 32n) & 0xffffffffn), littleEndian);
	}
	for (let s = 0; s < h.numTextures; s++) {
		if (!importedSlots.has(s) && model.textures[s].resourceId != null) {
			fail(`texture slot ${s} is special (resolved by name at runtime) and cannot carry a resourceId`);
		}
	}

	return out;
}

// =============================================================================
// Helpers shared with the registry handler
// =============================================================================

export function countFlaptTextureImports(model: ParsedFlaptFile): number {
	return model.textures.reduce((n, t) => n + (t.resourceId != null ? 1 : 0), 0);
}

/** Payload-relative import-table location for the envelope writer. */
export function flaptFileImportTable(payload: Uint8Array, littleEndian = true): { offset: number; count: number } {
	const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
	const h = readHeader(view, payload.byteLength, littleEndian);
	const offset = align16(h.muSizeInBytes);
	const count = (payload.byteLength - offset) / IMPORT_ENTRY_SIZE;
	return count === 0 ? { offset: 0, count: 0 } : { offset, count };
}
