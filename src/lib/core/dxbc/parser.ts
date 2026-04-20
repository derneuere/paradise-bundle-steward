// DXBC container + chunk parser for Burnout Paradise Remastered's
// ShaderProgramBuffer (type 0x12) bytecode.
//
// The Remastered engine stores standard Microsoft DXBC SM5 shader objects
// in block 1 of each ShaderProgramBuffer resource. The container format is
// public and well documented (Microsoft d3d11tokenizedprogramformat.h),
// and the SHEX instruction stream is the same one `fxc` emits.
//
// The survey across our 86-shader fixture (scripts/survey-dxbc.ts) tallied
// 42 distinct opcodes and ~22k instructions, 100% SM5 (SHEX). Chunk set is
// always { RDEF, ISGN, OSGN, SHEX, STAT } with no PCSG/SFI0/etc. — so we
// don't need to handle hull/domain/compute, and we can treat RDEF as the
// sole source of binding/name metadata.
//
// This file does ONLY the container + chunk-header parsing + RDEF/ISGN/
// OSGN reflection. The SHEX instruction decoder and GLSL emitter live in
// `ops.ts` and `glsl.ts` respectively so each stage stays readable.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DxbcProgramType = 'pixel' | 'vertex' | 'geometry' | 'hull' | 'domain' | 'compute';

export type DxbcChunkKind = 'RDEF' | 'ISGN' | 'OSGN' | 'SHEX' | 'SHDR' | 'STAT' | 'PCSG' | 'SFI0' | 'ICFE' | string;

/** A single chunk record as it lives in the DXBC file. */
export type DxbcChunk = {
	kind: DxbcChunkKind;
	/** Absolute offset of the chunk tag in the DXBC buffer. */
	offset: number;
	/** Size of the chunk payload (after the 8-byte tag+size header). */
	size: number;
};

/** A single input or output signature element (ISGN/OSGN). */
export type DxbcSignatureElement = {
	/** Semantic name, e.g. "POSITION", "TEXCOORD". */
	semanticName: string;
	/** Semantic index, e.g. 0 for TEXCOORD0. */
	semanticIndex: number;
	/** System-value id — non-zero for SV_* semantics (see d3dcommon.h). */
	systemValue: number;
	/** 0=uint, 1=int, 2=float. */
	componentType: number;
	/** Input/output register this element is bound to. */
	register: number;
	/** Bitmask of used components (0x1=x, 0x2=y, 0x4=z, 0x8=w, 0xF=xyzw). */
	mask: number;
	/** Bitmask of components actually read/written. */
	rwMask: number;
};

/** A constant-buffer variable (RDEF). */
export type DxbcCbVariable = {
	name: string;
	/** Offset into the containing cbuffer, in bytes. */
	startOffset: number;
	/** Size of the variable, in bytes. */
	size: number;
	/** Type metadata. */
	type: DxbcTypeDesc;
};

export type DxbcTypeDesc = {
	/** SHADER_VARIABLE_CLASS: 0=scalar, 1=vector, 2=matrix_rows, 3=matrix_columns,
	 *  4=object, 5=struct, 6=interface, 7=interface_pointer. */
	class: number;
	/** SHADER_VARIABLE_TYPE: 0x25=float, 0x27=int, 0x28=uint, ... */
	type: number;
	rows: number;
	columns: number;
	elements: number;
};

export type DxbcConstantBuffer = {
	name: string;
	/** Size in bytes. */
	size: number;
	/** Usage flags — see D3D_CBUFFER_TYPE. */
	flags: number;
	variables: DxbcCbVariable[];
};

export type DxbcResourceBinding = {
	name: string;
	/** D3D_SHADER_INPUT_TYPE: 0=cbuffer, 1=tbuffer, 2=texture, 3=sampler,
	 *  4=uav_rwtyped, 5=structured, 6=uav_rwstructured, ... */
	type: number;
	/** D3D_RESOURCE_RETURN_TYPE: 0=none, 5=float, etc. */
	returnType: number;
	/** D3D_SRV_DIMENSION: 0=unknown, 2=texture1d, 4=texture2d, 5=texture2darray,
	 *  9=texture3d, 10=texturecube, ... */
	dimension: number;
	numSamples: number;
	bindPoint: number;
	bindCount: number;
	flags: number;
};

export type DxbcReflection = {
	constantBuffers: DxbcConstantBuffer[];
	resourceBindings: DxbcResourceBinding[];
};

export type ParsedDxbc = {
	/** Whole buffer, kept for the op decoder to re-read the SHEX chunk. */
	bytes: Uint8Array;
	/** Absolute byte size as reported by the DXBC header at +0x18. */
	totalSize: number;
	/** Number of chunks in the container. */
	numChunks: number;
	/** All chunks, in file order. */
	chunks: DxbcChunk[];
	/** sm5 program version at SHEX+8 — low nibble minor, next nibble major,
	 *  high u16 program type (0=pixel, 1=vertex, 2=geometry, 3=hull, ...). */
	programVersion: number;
	programType: DxbcProgramType;
	programMajor: number;
	programMinor: number;
	/** Length of the SHEX token stream in dwords, as declared at SHEX+12. */
	shexDwordLength: number;
	/** SHEX token stream as dwords (little-endian), not including the header. */
	shexTokens: Uint32Array;
	/** Input signature (ISGN). */
	inputs: DxbcSignatureElement[];
	/** Output signature (OSGN). */
	outputs: DxbcSignatureElement[];
	/** RDEF — constant buffers + resource bindings. */
	reflection: DxbcReflection;
};

// ---------------------------------------------------------------------------
// Low-level readers
// ---------------------------------------------------------------------------

function readFourCC(b: Uint8Array, off: number): string {
	return String.fromCharCode(b[off], b[off + 1], b[off + 2], b[off + 3]);
}

function readCStr(b: Uint8Array, off: number): string {
	if (off < 0 || off >= b.byteLength) return '';
	let out = '';
	for (let i = off; i < b.byteLength && b[i] !== 0; i++) {
		out += String.fromCharCode(b[i]);
	}
	return out;
}

// ---------------------------------------------------------------------------
// Container
// ---------------------------------------------------------------------------

export function isDxbc(bytes: Uint8Array): boolean {
	return bytes.byteLength >= 0x20 && readFourCC(bytes, 0) === 'DXBC';
}

/**
 * Locate and parse a DXBC container. The DXBC stream is usually embedded at
 * the start of block 1 of a ShaderProgramBuffer resource; callers pass the
 * already-extracted block and we look for the 'DXBC' magic at offset 0.
 */
export function parseDxbc(bytes: Uint8Array): ParsedDxbc {
	if (!isDxbc(bytes)) {
		throw new Error(`DXBC magic not found (got "${readFourCC(bytes, 0)}")`);
	}
	const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const totalSize = dv.getUint32(0x18, true);
	const numChunks = dv.getUint32(0x1C, true);
	const chunks: DxbcChunk[] = [];
	for (let i = 0; i < numChunks; i++) {
		const co = dv.getUint32(0x20 + 4 * i, true);
		const kind = readFourCC(bytes, co);
		const size = dv.getUint32(co + 4, true);
		chunks.push({ kind, offset: co, size });
	}

	// SHEX / SHDR — take whichever we find.
	const shex = chunks.find((c) => c.kind === 'SHEX' || c.kind === 'SHDR');
	if (!shex) throw new Error('DXBC is missing SHEX/SHDR chunk');
	const programVersion = dv.getUint32(shex.offset + 8, true);
	const shexDwordLength = dv.getUint32(shex.offset + 12, true);
	const programMajor = (programVersion >> 4) & 0xF;
	const programMinor = programVersion & 0xF;
	const programTypeCode = (programVersion >> 16) & 0xFFFF;
	const programType: DxbcProgramType = programTypeCode === 0 ? 'pixel'
		: programTypeCode === 1 ? 'vertex'
		: programTypeCode === 2 ? 'geometry'
		: programTypeCode === 3 ? 'hull'
		: programTypeCode === 4 ? 'domain'
		: 'compute';

	// Token stream. The declared progLen *includes* the 2-dword header
	// (version + length), so the actual token count is progLen-2 starting at
	// shex.offset + 16.
	const tokStart = shex.offset + 16;
	const tokCount = Math.max(0, shexDwordLength - 2);
	const shexTokens = new Uint32Array(tokCount);
	for (let i = 0; i < tokCount; i++) {
		shexTokens[i] = dv.getUint32(tokStart + 4 * i, true);
	}

	// ISGN / OSGN.
	const inputs = parseSignature(bytes, chunks.find((c) => c.kind === 'ISGN'));
	const outputs = parseSignature(bytes, chunks.find((c) => c.kind === 'OSGN'));

	// RDEF.
	const rdef = chunks.find((c) => c.kind === 'RDEF');
	const reflection = rdef ? parseRdef(bytes, rdef) : { constantBuffers: [], resourceBindings: [] };

	return {
		bytes,
		totalSize,
		numChunks,
		chunks,
		programVersion,
		programType,
		programMajor,
		programMinor,
		shexDwordLength,
		shexTokens,
		inputs,
		outputs,
		reflection,
	};
}

// ---------------------------------------------------------------------------
// ISGN / OSGN — input / output signature chunks
// ---------------------------------------------------------------------------
//
// Layout (after the 4-byte tag + 4-byte size):
//   u32 numElements
//   u32 unknown (usually 8 = record stride or flags)
//   repeated numElements times, each 24 bytes on disk:
//     u32 nameOffset      (offset from end of tag+size, i.e. chunk.offset+8)
//     u32 semanticIndex
//     u32 systemValue
//     u32 componentType   (0=uint, 1=int, 2=float)
//     u32 register
//     u8  mask
//     u8  rwMask
//     u16 pad
//
// String pool follows the element table. Name offsets are relative to the
// start of the chunk body (chunk.offset + 8).

function parseSignature(bytes: Uint8Array, chunk: DxbcChunk | undefined): DxbcSignatureElement[] {
	if (!chunk) return [];
	const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const body = chunk.offset + 8;
	const numElements = dv.getUint32(body, true);
	// +4 holds a 8 that we ignore — same as fxc output.
	const elementBase = body + 8;
	const out: DxbcSignatureElement[] = [];
	for (let i = 0; i < numElements; i++) {
		const r = elementBase + i * 24;
		const nameOffset = dv.getUint32(r + 0, true);
		const semanticIndex = dv.getUint32(r + 4, true);
		const systemValue = dv.getUint32(r + 8, true);
		const componentType = dv.getUint32(r + 12, true);
		const register = dv.getUint32(r + 16, true);
		const mask = bytes[r + 20];
		const rwMask = bytes[r + 21];
		out.push({
			semanticName: readCStr(bytes, body + nameOffset),
			semanticIndex,
			systemValue,
			componentType,
			register,
			mask,
			rwMask,
		});
	}
	return out;
}

// ---------------------------------------------------------------------------
// RDEF — resource definition chunk
// ---------------------------------------------------------------------------
//
// RDEF body layout (after 4-byte tag + 4-byte size). All offsets — cbuffer
// table, binding table, variable names, type descriptors, the "creator"
// string — are **chunk-relative**, measured from the start of the chunk
// body (`body = chunk.offset + 8`). Earlier versions of this parser treated
// them as absolute file offsets, which happened to land inside the DXBC
// magic block and produced garbage binding names like "XBCC" and cbuffer
// sizes of 6.6 MB.
//
//   u32 numCbuffers
//   u32 cbuffersOffset          (absolute file offset)
//   u32 numResourceBindings
//   u32 resourceBindingsOffset  (absolute file offset)
//   u8  majorVer
//   u8  minorVer
//   u16 flags
//   u32 programType             (0=pixel, 1=vertex, 2=geometry, ...)
//   u32 compilerFlags
//   u32 creatorStringOffset     (absolute)
//   ... (RD11-specific fields when minor >= 1; ignored here)
//
// Resource-binding record is 32 bytes:
//   u32 nameOffset  u32 type  u32 returnType  u32 dimension
//   u32 numSamples  u32 bindPoint  u32 bindCount  u32 flags
//
// Cbuffer record is 24 bytes:
//   u32 nameOffset  u32 numVariables  u32 variablesOffset
//   u32 size        u32 flags         u32 cbType
//
// Variable record is 40 bytes (minor >= 1) or 24 bytes (minor == 0). Our
// survey shows every shader has RDEF minor == 1, so we read the 40-byte
// form.  Layout:
//   u32 nameOffset  u32 startOffset  u32 size        u32 flags
//   u32 typeOffset  u32 defaultValueOffset  u32 startTexture
//   u32 textureSize u32 startSampler  u32 samplerSize
//
// Type record is 16 bytes (minor 0):
//   u16 class  u16 type  u16 rows  u16 columns  u16 elements  u16 memberCount
//   u32 memberOffset
//
// We only need class/type/rows/columns/elements here.

function parseRdef(bytes: Uint8Array, chunk: DxbcChunk): DxbcReflection {
	const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const body = chunk.offset + 8;

	const numCbuffers = dv.getUint32(body + 0, true);
	const cbuffersOffset = body + dv.getUint32(body + 4, true);
	const numBindings = dv.getUint32(body + 8, true);
	const bindingsOffset = body + dv.getUint32(body + 12, true);
	// majorVer / minorVer at body+16 (u8 each). RD11 (SM5) uses 40-byte
	// variable records; RD10 (SM4) uses 24-byte records. Fallback to 40
	// whenever the shader is SM5 per the outer program version.
	const rdefMajor = bytes[body + 16];
	const rdefMinor = bytes[body + 17];
	const varStride = rdefMinor >= 1 || rdefMajor >= 5 ? 40 : 24;

	const resourceBindings: DxbcResourceBinding[] = [];
	for (let i = 0; i < numBindings; i++) {
		const r = bindingsOffset + i * 32;
		resourceBindings.push({
			name: readCStr(bytes, body + dv.getUint32(r + 0, true)),
			type: dv.getUint32(r + 4, true),
			returnType: dv.getUint32(r + 8, true),
			dimension: dv.getUint32(r + 12, true),
			numSamples: dv.getUint32(r + 16, true),
			bindPoint: dv.getUint32(r + 20, true),
			bindCount: dv.getUint32(r + 24, true),
			flags: dv.getUint32(r + 28, true),
		});
	}

	const constantBuffers: DxbcConstantBuffer[] = [];
	for (let i = 0; i < numCbuffers; i++) {
		const r = cbuffersOffset + i * 24;
		const name = readCStr(bytes, body + dv.getUint32(r + 0, true));
		const numVars = dv.getUint32(r + 4, true);
		const varsOffset = body + dv.getUint32(r + 8, true);
		const size = dv.getUint32(r + 12, true);
		const flags = dv.getUint32(r + 16, true);

		const variables: DxbcCbVariable[] = [];
		for (let v = 0; v < numVars; v++) {
			const vr = varsOffset + v * varStride;
			if (vr + varStride > bytes.byteLength) break;
			const vNameOff = body + dv.getUint32(vr + 0, true);
			const startOffset = dv.getUint32(vr + 4, true);
			const vSize = dv.getUint32(vr + 8, true);
			// +12 flags, +16 typeOffset — also chunk-relative
			const typeOff = body + dv.getUint32(vr + 16, true);
			let type: DxbcTypeDesc = { class: 0, type: 0, rows: 0, columns: 0, elements: 0 };
			if (typeOff > body && typeOff + 10 <= bytes.byteLength) {
				type = {
					class: dv.getUint16(typeOff + 0, true),
					type: dv.getUint16(typeOff + 2, true),
					rows: dv.getUint16(typeOff + 4, true),
					columns: dv.getUint16(typeOff + 6, true),
					elements: dv.getUint16(typeOff + 8, true),
				};
			}
			variables.push({
				name: readCStr(bytes, vNameOff),
				startOffset,
				size: vSize,
				type,
			});
		}

		constantBuffers.push({ name, size, flags, variables });
	}

	return { constantBuffers, resourceBindings };
}

// ---------------------------------------------------------------------------
// Small helpers used by the instruction decoder
// ---------------------------------------------------------------------------

export function programVersionLabel(p: ParsedDxbc): string {
	const stage = p.programType === 'vertex' ? 'vs'
		: p.programType === 'pixel' ? 'ps'
		: p.programType === 'geometry' ? 'gs'
		: p.programType === 'hull' ? 'hs'
		: p.programType === 'domain' ? 'ds'
		: 'cs';
	return `${stage}_${p.programMajor}_${p.programMinor}`;
}
