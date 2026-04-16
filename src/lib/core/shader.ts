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

	// ---- Layout bookkeeping ----
	/** Full original resource bytes, one byte per number for clone safety. */
	raw: number[];
	totalSize: number;
};

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

	let name = '';
	if (namePtr > 0 && namePtr < raw.byteLength) {
		for (let i = namePtr; i < raw.byteLength && raw[i] !== 0; i++) {
			name += String.fromCharCode(raw[i]);
		}
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
