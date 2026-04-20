// Shader (0x32) and ShaderProgramBuffer (0x12) parsers.
//
// Wiki: docs/Shader.md — covers the Shader header (32-bit and 64-bit
// variants, plus the original PC vs. Remastered layouts that differ by an
// extra "HLSL source code" pointer at +0x24 in original PC).
//
// Blender reference: import_bpr_models.py:2126 (read_shader). It decodes
// the shader name, samplers (raster types), and constant counts from the
// Shader resource. The ShaderProgramBuffer (the precompiled HLSL bytecode)
// is loaded but not interpreted by Blender either.
//
// Scope: byte-preserving round-trip for both types. Shader exposes the
// shader name + a handful of header counts for display/identification;
// ShaderProgramBuffer is fully opaque (compiled HLSL bytecode that we have
// no business poking at). Round-tripping the Shader resource verbatim is
// the right primitive for the asset manager — editing pixel shader
// constants belongs in a future, more focused tool.

export const SHADER_TYPE_ID = 0x32;
export const SHADER_PROGRAM_BUFFER_TYPE_ID = 0x12;

const SHADER_HEADER_REMASTERED = 0x30; // Remastered PC: through +0x2C
const SHADER_HEADER_ORIGINAL_PC = 0x34; // Original PC: extra HLSL ptr at +0x24

// =============================================================================
// Shader (0x32)
// =============================================================================

/** A single ShaderTechnique decoded for display. All field offsets are
 *  relative to the ShaderTechnique struct base (see docs/Shader.md). */
export type ParsedShaderTechnique = {
	/** Technique name (+0x38 char*). Empty when the pointer is null. */
	name: string;
	/** Inline vertex-shader name string (original PC only, +0x3C). */
	vertexName: string;
	/** Inline pixel-shader name string (original PC only, +0x40). */
	pixelName: string;
	/** Number of samplers (+0x30 int8). */
	numSamplers: number;
	/** Decoded sampler list (name + channel index). */
	samplers: ParsedShaderSampler[];
};

export type ParsedShaderSampler = {
	/** Sampler binding name (e.g. "DiffuseSampler"). */
	name: string;
	/** Texture channel index (miChannel, +0x04 int16). */
	channel: number;
};

/** A single constant slot. Sizes/indices/hashes are always present; instance
 *  data is only populated for the first `numConstantsWithInstanceData`
 *  entries per the wiki, so we pad with null float4s for the rest. */
export type ParsedShaderConstant = {
	/** Constant name — from the char** names table at +0x20. */
	name: string;
	/** uint32 FNV-style hash from the hashes table at +0x18. */
	hash: number;
	/** uint8 size from the sizes table at +0x10 (in float4s). */
	size: number;
	/** int8 index from the indices table at +0x0C. */
	index: number;
	/** Optional float4 instance data; null when this constant has none. */
	instanceData: [number, number, number, number] | null;
};

export type ParsedShader = {
	/** True when the resource has the original-PC HLSL source pointer at +0x24
	 *  (compiles at load time). False when at24 == 0 (Remastered, precompiled
	 *  bytecode imported via ShaderProgramBuffer). */
	hasInlineHLSL: boolean;
	/** "Flags?" byte at +0x05; per the wiki it's always 0x44 on PC and 3 on
	 *  Remastered. Preserved verbatim. */
	flags: number;
	/** Number of ShaderTechnique entries pointed at by mppTechniques. */
	numTechniques: number;
	/** Number of constant slots (counts at +0x1C). */
	numConstants: number;
	/** Number of constants that have populated instance data (at +0x1D). */
	numConstantsWithInstanceData: number;
	/** Decoded shader name (e.g. "Vehicle_Opaque_CarbonFibre_Textured"). */
	name: string;
	/** Decoded ShaderTechnique array. Pure display metadata: not re-serialized. */
	techniques: ParsedShaderTechnique[];
	/** Decoded constant table. Pure display metadata: not re-serialized. */
	constants: ParsedShaderConstant[];
	/** Inline HLSL source (original PC only). Empty string on Remastered. */
	hlslSource: string;

	// ---- Layout bookkeeping ----
	/** Full original resource bytes, one byte per number for clone safety. */
	raw: number[];
	totalSize: number;
};

// Read a null-terminated ASCII string from `bytes` starting at `ptr` (an
// absolute offset into the resource buffer). Returns '' on null / out-of-
// range pointers so we never throw mid-decode.
function readCStrAt(bytes: Uint8Array, ptr: number): string {
	if (ptr <= 0 || ptr >= bytes.byteLength) return '';
	let out = '';
	for (let i = ptr; i < bytes.byteLength && bytes[i] !== 0; i++) {
		out += String.fromCharCode(bytes[i]);
	}
	return out;
}

export function parseShaderData(
	raw: Uint8Array,
	littleEndian: boolean = true,
): ParsedShader {
	if (!littleEndian) {
		// Blender's PS3/X360 paths exist but differ in pointer width and
		// layout (see the wiki's PS4/Switch table). We have no fixture, so
		// fail loudly rather than silently produce wrong output.
		throw new Error('Shader parser is little-endian only (no BE fixture)');
	}
	if (raw.byteLength < SHADER_HEADER_REMASTERED) {
		throw new Error(
			`Shader resource too small (${raw.byteLength} bytes, need at least ${SHADER_HEADER_REMASTERED})`,
		);
	}
	const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
	const u32 = (off: number) => dv.getUint32(off, true);

	const numTechniques = raw[0x04];
	const flags = raw[0x05];
	const namePtr = u32(0x08);
	const numConstants = raw[0x1C];
	const numConstantsWithInstanceData = raw[0x1D];
	// Original-PC layout has an HLSL source pointer at +0x24; Remastered
	// uses 0 there. Blender uses the same heuristic.
	const at24 = u32(0x24);
	const hasInlineHLSL = at24 !== 0;
	const headerSize = hasInlineHLSL ? SHADER_HEADER_ORIGINAL_PC : SHADER_HEADER_REMASTERED;
	if (raw.byteLength < headerSize) {
		throw new Error(
			`Shader resource too small for ${hasInlineHLSL ? 'original-PC' : 'Remastered'} layout (${raw.byteLength} bytes, need ${headerSize})`,
		);
	}

	const name = readCStrAt(raw, namePtr);

	// Inline HLSL source (original PC). Remastered stores 0 here and imports
	// a compiled ShaderProgramBuffer instead; the page's preview falls back
	// to a procedural GLSL stand-in for those.
	const hlslSource = hasInlineHLSL ? readCStrAt(raw, at24) : '';

	// ---- ShaderTechnique array (PC 32-bit layout, 0x44 bytes each). -------
	// See docs/Shader.md "ShaderTechnique / PC (Remastered)" for offsets.
	// Original PC adds two inline name strings at +0x3C / +0x40; Remastered
	// stops at +0x3C. We attempt to read both and let empty strings indicate
	// the Remastered case.
	const techPtr = u32(0x00);
	// Original PC keeps inline vertex+pixel shader name pointers at +0x3C /
	// +0x40 so its ShaderTechnique struct is 0x44 bytes; Remastered drops
	// both fields and the struct ends at +0x3C. Picking the wrong stride
	// shifts all techniques after the first, so anchor it to hasInlineHLSL
	// (which is already the original-PC tell: source pointer at +0x24).
	const TECH_STRIDE = hasInlineHLSL ? 0x44 : 0x3C;
	const techniques: ParsedShaderTechnique[] = [];
	if (techPtr > 0 && numTechniques > 0) {
		for (let t = 0; t < numTechniques; t++) {
			const base = techPtr + t * TECH_STRIDE;
			if (base + 0x3C > raw.byteLength) break;
			const numSamplers = dv.getInt8(base + 0x30);
			const samplersPtr = dv.getUint32(base + 0x2C, true);
			const namePtr2 = dv.getUint32(base + 0x38, true);
			// Only original PC has inline vertex/pixel name pointers; on
			// Remastered +0x3C / +0x40 land inside the *next* technique
			// struct, so skip them.
			const vertPtr =
				hasInlineHLSL && base + 0x40 <= raw.byteLength
					? dv.getUint32(base + 0x3C, true)
					: 0;
			const pixPtr =
				hasInlineHLSL && base + 0x44 <= raw.byteLength
					? dv.getUint32(base + 0x40, true)
					: 0;

			const samplers: ParsedShaderSampler[] = [];
			if (samplersPtr > 0 && numSamplers > 0) {
				const SAMPLER_STRIDE = 0x8; // 32-bit: char* + int16 + pad
				for (let s = 0; s < numSamplers; s++) {
					const sBase = samplersPtr + s * SAMPLER_STRIDE;
					if (sBase + 6 > raw.byteLength) break;
					const sNamePtr = dv.getUint32(sBase + 0x00, true);
					const channel = dv.getInt16(sBase + 0x04, true);
					samplers.push({ name: readCStrAt(raw, sNamePtr), channel });
				}
			}

			techniques.push({
				name: readCStrAt(raw, namePtr2),
				vertexName: readCStrAt(raw, vertPtr),
				pixelName: readCStrAt(raw, pixPtr),
				numSamplers,
				samplers,
			});
		}
	}

	// ---- Constant table: four parallel arrays + names. -------------------
	// Instance-data entries are *only* populated for the first
	// numConstantsWithInstanceData rows per the wiki; past that we emit
	// null so the UI can show "no data" distinctly from an all-zero float4.
	const idxPtr = u32(0x0C);
	const sizePtr = u32(0x10);
	const instPtr = u32(0x14);
	const hashPtr = u32(0x18);
	const namesPtr = u32(0x20);
	const constants: ParsedShaderConstant[] = [];
	for (let i = 0; i < numConstants; i++) {
		const idx =
			idxPtr > 0 && idxPtr + i < raw.byteLength ? dv.getInt8(idxPtr + i) : 0;
		const size =
			sizePtr > 0 && sizePtr + i < raw.byteLength ? raw[sizePtr + i] : 0;
		const hash =
			hashPtr > 0 && hashPtr + 4 * i + 4 <= raw.byteLength
				? dv.getUint32(hashPtr + 4 * i, true)
				: 0;
		const constNamePtr =
			namesPtr > 0 && namesPtr + 4 * i + 4 <= raw.byteLength
				? dv.getUint32(namesPtr + 4 * i, true)
				: 0;
		let instanceData: [number, number, number, number] | null = null;
		if (
			i < numConstantsWithInstanceData &&
			instPtr > 0 &&
			instPtr + 16 * i + 16 <= raw.byteLength
		) {
			const off = instPtr + 16 * i;
			instanceData = [
				dv.getFloat32(off + 0, true),
				dv.getFloat32(off + 4, true),
				dv.getFloat32(off + 8, true),
				dv.getFloat32(off + 12, true),
			];
		}
		constants.push({
			name: readCStrAt(raw, constNamePtr),
			hash,
			size,
			index: idx,
			instanceData,
		});
	}

	const rawArr: number[] = new Array(raw.byteLength);
	for (let i = 0; i < raw.byteLength; i++) rawArr[i] = raw[i];

	return {
		hasInlineHLSL,
		flags,
		numTechniques,
		numConstants,
		numConstantsWithInstanceData,
		name,
		techniques,
		constants,
		hlslSource,
		raw: rawArr,
		totalSize: raw.byteLength,
	};
}

export function writeShaderData(
	model: ParsedShader,
	littleEndian: boolean = true,
): Uint8Array {
	if (!littleEndian) {
		throw new Error('Shader writer is little-endian only');
	}
	if (model.raw.length !== model.totalSize) {
		throw new Error(
			`Shader raw length ${model.raw.length} != totalSize ${model.totalSize}`,
		);
	}
	const out = new Uint8Array(model.totalSize);
	for (let i = 0; i < model.totalSize; i++) out[i] = model.raw[i] & 0xFF;
	// Patch the small set of typed fields back into the bytes. Editing the
	// shader name would require resizing + rewriting the whole layout, so we
	// only round-trip the fixed-position bytes.
	out[0x04] = model.numTechniques & 0xFF;
	out[0x05] = model.flags & 0xFF;
	out[0x1C] = model.numConstants & 0xFF;
	out[0x1D] = model.numConstantsWithInstanceData & 0xFF;
	return out;
}

// =============================================================================
// ShaderProgramBuffer (0x12)
// =============================================================================

/**
 * ShaderProgramBuffer is the precompiled HLSL bytecode that the Remastered
 * Shader (0x32) resource imports. The contents are opaque to us — we just
 * need to store and replay them byte-for-byte for round-trip purposes.
 */
export type ParsedShaderProgramBuffer = {
	raw: number[];
	totalSize: number;
};

export function parseShaderProgramBufferData(
	raw: Uint8Array,
	_littleEndian: boolean = true,
): ParsedShaderProgramBuffer {
	const arr: number[] = new Array(raw.byteLength);
	for (let i = 0; i < raw.byteLength; i++) arr[i] = raw[i];
	return { raw: arr, totalSize: raw.byteLength };
}

export function writeShaderProgramBufferData(
	model: ParsedShaderProgramBuffer,
	_littleEndian: boolean = true,
): Uint8Array {
	if (model.raw.length !== model.totalSize) {
		throw new Error(
			`ShaderProgramBuffer raw length ${model.raw.length} != totalSize ${model.totalSize}`,
		);
	}
	const out = new Uint8Array(model.totalSize);
	for (let i = 0; i < model.totalSize; i++) out[i] = model.raw[i] & 0xFF;
	return out;
}
