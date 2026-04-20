// DXBC SM5 (SHEX) instruction decoder.
//
// One pass: turn the SHEX token stream into a flat array of typed
// instructions whose operands have been decoded into a register + swizzle
// + modifier model. The GLSL emitter (glsl.ts) walks this array and emits
// per-instruction snippets.
//
// Reference: Microsoft's d3d11TokenizedProgramFormat.hpp, which documents
// every token layout we rely on here. This decoder covers the 42 opcodes
// observed across our fixture (see scripts/survey-dxbc.ts output); anything
// else is preserved as an "unknown" instruction so the emitter can warn
// rather than silently miscompile.

// ---------------------------------------------------------------------------
// Opcode table (names + arity) — pulled from d3d11TokenizedProgramFormat.hpp
// ---------------------------------------------------------------------------

// Opcode → (name, arity). Arity is the number of operands; `dcl_*` opcodes
// are handled as a special case because they embed their operand count in
// the instruction-length field.
export const OP_TABLE: Record<number, { name: string; arity: number; kind?: 'alu' | 'cmp' | 'tex' | 'flow' | 'decl' | 'mov' }> = {
	0x00: { name: 'add',   arity: 3, kind: 'alu' },
	0x01: { name: 'and',   arity: 3, kind: 'alu' },
	0x02: { name: 'break', arity: 0, kind: 'flow' },
	0x03: { name: 'breakc',arity: 1, kind: 'flow' },
	0x07: { name: 'continue', arity: 0, kind: 'flow' },
	0x0D: { name: 'discard', arity: 1, kind: 'flow' },
	0x0E: { name: 'div',   arity: 3, kind: 'alu' },
	0x0F: { name: 'dp2',   arity: 3, kind: 'alu' },
	0x10: { name: 'dp3',   arity: 3, kind: 'alu' },
	0x11: { name: 'dp4',   arity: 3, kind: 'alu' },
	0x12: { name: 'else',  arity: 0, kind: 'flow' },
	0x15: { name: 'endif', arity: 0, kind: 'flow' },
	0x16: { name: 'endloop', arity: 0, kind: 'flow' },
	0x18: { name: 'eq',    arity: 3, kind: 'cmp' },
	0x19: { name: 'exp',   arity: 2, kind: 'alu' },
	0x1A: { name: 'frc',   arity: 2, kind: 'alu' },
	0x1B: { name: 'ftoi',  arity: 2, kind: 'alu' },
	0x1C: { name: 'ftou',  arity: 2, kind: 'alu' },
	0x1D: { name: 'ge',    arity: 3, kind: 'cmp' },
	0x1E: { name: 'iadd',  arity: 3, kind: 'alu' },
	0x1F: { name: 'if',    arity: 1, kind: 'flow' },
	0x20: { name: 'ieq',   arity: 3, kind: 'cmp' },
	0x21: { name: 'ige',   arity: 3, kind: 'cmp' },
	0x22: { name: 'ilt',   arity: 3, kind: 'cmp' },
	0x23: { name: 'imad',  arity: 4, kind: 'alu' },
	0x24: { name: 'imax',  arity: 3, kind: 'alu' },
	0x25: { name: 'imin',  arity: 3, kind: 'alu' },
	0x26: { name: 'imul',  arity: 4, kind: 'alu' }, // imul destHi, destLo, a, b
	0x27: { name: 'ine',   arity: 3, kind: 'cmp' },
	0x28: { name: 'ineg',  arity: 2, kind: 'alu' },
	0x29: { name: 'ishl',  arity: 3, kind: 'alu' },
	0x2A: { name: 'ishr',  arity: 3, kind: 'alu' },
	0x2B: { name: 'itof',  arity: 2, kind: 'alu' },
	0x2F: { name: 'log',   arity: 2, kind: 'alu' },
	0x30: { name: 'loop',  arity: 0, kind: 'flow' },
	0x31: { name: 'lt',    arity: 3, kind: 'cmp' },
	0x32: { name: 'mad',   arity: 4, kind: 'alu' },
	0x33: { name: 'min',   arity: 3, kind: 'alu' },
	0x34: { name: 'max',   arity: 3, kind: 'alu' },
	0x35: { name: 'customdata', arity: 0, kind: 'decl' },
	0x36: { name: 'mov',   arity: 2, kind: 'mov' },
	0x37: { name: 'movc',  arity: 4, kind: 'alu' },
	0x38: { name: 'mul',   arity: 3, kind: 'alu' },
	0x39: { name: 'ne',    arity: 3, kind: 'cmp' },
	0x3A: { name: 'nop',   arity: 0, kind: 'alu' },
	0x3B: { name: 'not',   arity: 2, kind: 'alu' },
	0x3C: { name: 'or',    arity: 3, kind: 'alu' },
	0x3D: { name: 'resinfo', arity: 3, kind: 'tex' },
	0x3E: { name: 'ret',   arity: 0, kind: 'flow' },
	0x3F: { name: 'retc',  arity: 1, kind: 'flow' },
	0x44: { name: 'rsq',   arity: 2, kind: 'alu' },
	0x45: { name: 'sample', arity: 4, kind: 'tex' },
	0x46: { name: 'sample_c', arity: 5, kind: 'tex' },
	0x47: { name: 'sample_c_lz', arity: 5, kind: 'tex' },
	0x48: { name: 'sample_l', arity: 5, kind: 'tex' },
	0x49: { name: 'sample_d', arity: 6, kind: 'tex' },
	0x4A: { name: 'sample_b', arity: 5, kind: 'tex' },
	0x4B: { name: 'sqrt',  arity: 2, kind: 'alu' },
	0x4D: { name: 'sincos', arity: 3, kind: 'alu' }, // sincos destSin, destCos, src
	0x4F: { name: 'ult',   arity: 3, kind: 'cmp' },
	0x50: { name: 'uge',   arity: 3, kind: 'cmp' },
	0x51: { name: 'umul',  arity: 4, kind: 'alu' },
	0x52: { name: 'umad',  arity: 4, kind: 'alu' },
	0x53: { name: 'umax',  arity: 3, kind: 'alu' },
	0x54: { name: 'umin',  arity: 3, kind: 'alu' },
	0x55: { name: 'ushr',  arity: 3, kind: 'alu' },
	0x56: { name: 'utof',  arity: 2, kind: 'alu' },
	0x57: { name: 'xor',   arity: 3, kind: 'alu' },
	// Declarations — operand count varies and is encoded in the length field.
	0x58: { name: 'dcl_resource',       arity: 1, kind: 'decl' },
	0x59: { name: 'dcl_constantbuffer', arity: 1, kind: 'decl' },
	0x5A: { name: 'dcl_sampler',        arity: 1, kind: 'decl' },
	0x5F: { name: 'dcl_input',          arity: 1, kind: 'decl' },
	0x60: { name: 'dcl_input_sgv',      arity: 2, kind: 'decl' },
	0x61: { name: 'dcl_input_siv',      arity: 2, kind: 'decl' },
	0x62: { name: 'dcl_input_ps',       arity: 1, kind: 'decl' },
	0x63: { name: 'dcl_input_ps_sgv',   arity: 2, kind: 'decl' },
	0x64: { name: 'dcl_input_ps_siv',   arity: 2, kind: 'decl' },
	0x65: { name: 'dcl_output',         arity: 1, kind: 'decl' },
	0x66: { name: 'dcl_output_sgv',     arity: 2, kind: 'decl' },
	0x67: { name: 'dcl_output_siv',     arity: 2, kind: 'decl' },
	0x68: { name: 'dcl_temps',          arity: 0, kind: 'decl' },
	0x69: { name: 'dcl_indexableTemp',  arity: 0, kind: 'decl' },
	0x6A: { name: 'dcl_globalFlags',    arity: 0, kind: 'decl' },
};

// ---------------------------------------------------------------------------
// Operand model
// ---------------------------------------------------------------------------

/** Operand file — which bank / namespace the operand lives in. SM5 has many;
 *  only the ones our fixture actually produces need full support. */
export type DxbcOperandType =
	| 'temp'           // r0..rN
	| 'input'          // v0..vN
	| 'output'         // o0..oN
	| 'indexable_temp' // x0..xN
	| 'immediate32'    // literal float/int constants inline
	| 'immediate64'
	| 'sampler'        // s0..sN
	| 'resource'       // t0..tN (SRV)
	| 'constant_buffer' // cbN[i]
	| 'special_v'      // v* with SV_ semantic (vPos, vFace, ...)
	| 'special_o'      // o* with SV_ semantic
	| 'primitive_id'
	| 'null'
	| 'unknown';

export type DxbcOperandIndex =
	/** Literal index, e.g. r4 → { kind:'immediate', value:4 } */
	| { kind: 'immediate'; value: number }
	/** Relative addressing (r[r0.x+3]) → { kind:'relative', base, offset } */
	| { kind: 'relative'; base: DxbcOperand; offset: number };

export type DxbcOperand = {
	type: DxbcOperandType;
	/** Raw DXBC numeric type id (D3D10_SB_OPERAND_TYPE) — retained for ops
	 *  that peek at rare types the emitter doesn't need to name. */
	typeRaw: number;
	/** Register dimension: 0=scalar, 1=1D (rN), 2=2D (cbN[i]), 3=3D. */
	dimension: number;
	/** Indices; length equals dimension. */
	indices: DxbcOperandIndex[];
	/** Component selection mode: 0=mask (dst), 1=swizzle (src), 2=select1, 3=no. */
	selectionMode: number;
	/** When selectionMode === 0: 4-bit write mask (x=1,y=2,z=4,w=8). */
	mask: number;
	/** When selectionMode === 1: 8-bit swizzle (two bits per component, x=0,y=1,z=2,w=3). */
	swizzle: number;
	/** When selectionMode === 2: scalar component select (0..3). */
	select1: number;
	/** Source modifier flags: bit 0 = negate, bit 1 = abs. */
	modifier: number;
	/** Immediate values for immediate32/immediate64 operands (0..4 floats). */
	immediates: number[];
};

// ---------------------------------------------------------------------------
// Declaration metadata (captured from dcl_* opcodes)
// ---------------------------------------------------------------------------

/** Result of decoding one `dcl_*` opcode into declaration metadata. Kept
 *  compact; the emitter only needs a subset of this. */
export type DxbcDecl =
	| { kind: 'resource'; register: number; dim: number; returnType: number }
	| { kind: 'sampler'; register: number; mode: number }
	| { kind: 'constantBuffer'; register: number; size: number; accessPattern: number }
	| { kind: 'input'; register: number; mask: number }
	| { kind: 'inputSv'; register: number; mask: number; systemValue: number }
	| { kind: 'inputPs'; register: number; mask: number; interpolation: number }
	| { kind: 'inputPsSv'; register: number; mask: number; interpolation: number; systemValue: number }
	| { kind: 'output'; register: number; mask: number }
	| { kind: 'outputSv'; register: number; mask: number; systemValue: number }
	| { kind: 'temps'; count: number }
	| { kind: 'indexableTemp'; register: number; size: number; components: number }
	| { kind: 'globalFlags'; flags: number };

// ---------------------------------------------------------------------------
// Instruction model
// ---------------------------------------------------------------------------

export type DxbcInstruction = {
	/** Opcode index from token[10:0]. */
	opcode: number;
	/** Mnemonic from OP_TABLE or `OP_<hex>` when unknown. */
	name: string;
	/** Kind label, mostly for emitter dispatch convenience. */
	kind: 'alu' | 'cmp' | 'tex' | 'flow' | 'decl' | 'mov' | 'unknown';
	/** Position in the token array where this instruction starts. */
	tokenIndex: number;
	/** Instruction length in tokens (from token[30:24] or dcl-specific forms). */
	length: number;
	/** Extended opcode tokens appended via token[31]=1. */
	extended: number[];
	/** Saturate flag from extended or base opcode. */
	saturate: boolean;
	/** Operands, in DXBC order (dst first, then sources). Empty for flow ops. */
	operands: DxbcOperand[];
	/** Populated only for `dcl_*` instructions. */
	decl?: DxbcDecl;
	/** sample_* resource-return-type sampler-compare etc. preserved here as
	 *  a catch-all for things the emitter rarely reaches for. */
	extra?: Record<string, number>;
};

export type DecodedShader = {
	decls: DxbcInstruction[];
	body: DxbcInstruction[];
	/** Flattened instructions in original order, for debug display. */
	all: DxbcInstruction[];
};

// ---------------------------------------------------------------------------
// Token-level helpers
// ---------------------------------------------------------------------------

function opcodeOf(tok: number): number { return tok & 0x7FF; }
function opcodeLengthOf(tok: number): number {
	// Bits 30:24 = length in dwords (includes the opcode token itself).
	const l = (tok >>> 24) & 0x7F;
	return l === 0 ? 1 : l;
}
function hasExtended(tok: number): boolean { return (tok & 0x80000000) !== 0; }
function saturateOf(tok: number): boolean { return ((tok >>> 13) & 1) !== 0; }

/**
 * Decode one operand starting at tokens[ti]. Returns the decoded operand and
 * the number of tokens consumed so the caller can advance its index.
 */
function decodeOperand(tokens: Uint32Array, ti: number): { op: DxbcOperand; consumed: number } {
	const head = tokens[ti];
	let consumed = 1;
	const selectionMode = (head >>> 2) & 0x3;
	const compSel = (head >>> 4) & 0xFF;
	// Component count: bits 1:0 = 0 (0 comps), 1 (1 comp), 2 (4 comps), 3 (N comps).
	const compCount = head & 0x3;

	let mask = 0, swizzle = 0, select1 = 0;
	if (compCount === 2) {
		if (selectionMode === 0) mask = compSel & 0xF;           // write mask
		else if (selectionMode === 1) swizzle = compSel & 0xFF;  // swizzle
		else if (selectionMode === 2) select1 = compSel & 0x3;   // scalar select
	}

	// Bit layout of an SM5 operand token (d3d11TokenizedProgramFormat.h):
	//   [ 1: 0] = num components (0=zero, 1=one, 2=four, 3=N)
	//   [ 3: 2] = selection mode (0=mask, 1=swizzle, 2=select1, 3=no-op)
	//   [11: 4] = component mask/swizzle/select1 encoding (use depends on mode)
	//   [19:12] = operand type (D3D10_SB_OPERAND_TYPE, 8 bits)
	//   [21:20] = index dimension (0..3)
	//   [24:22] = index 0 representation (3 bits)
	//   [27:25] = index 1 representation
	//   [30:28] = index 2 representation
	//   [   31] = extended token follows
	//
	// Earlier versions of this decoder read `dimension` from bits 13:12
	// (i.e. the same bits as operandType), which silently treated every
	// `cb0[i]` (operandType 8) as `temp` with dimension 0 — producing the
	// `r0 * pos.yyyy` garbage that made every vs collapse to a black screen.
	const operandType = (head >>> 12) & 0xFF;
	const dimension = (head >>> 20) & 0x3;
	const typeRaw = operandType;
	const hasExt = (head & 0x80000000) !== 0;

	const idxDim0Rep = (head >>> 22) & 0x7;
	const idxDim1Rep = (head >>> 25) & 0x7;
	const idxDim2Rep = (head >>> 28) & 0x7;
	const idxReps = [idxDim0Rep, idxDim1Rep, idxDim2Rep];

	let immediates: number[] = [];
	let modifier = 0;

	// Consume extended tokens. Bit 0:5 in the extended token describes the
	// extension kind; 1 = operand modifier (neg/abs); 2 = resource-return-type.
	if (hasExt) {
		const ext = tokens[ti + 1];
		consumed++;
		const extKind = ext & 0x3F;
		if (extKind === 1) {
			modifier = (ext >>> 6) & 0xFF;
		}
	}

	// Immediate operand payloads sit inline.
	if (operandType === 4 /* immediate32 */) {
		const n = compCount === 2 ? 4 : compCount; // 4 components when vec, else 1
		for (let i = 0; i < n; i++) {
			const u = tokens[ti + consumed];
			consumed++;
			const buf = new ArrayBuffer(4);
			new Uint32Array(buf)[0] = u;
			immediates.push(new Float32Array(buf)[0]);
		}
	} else if (operandType === 5 /* immediate64 */) {
		const n = compCount === 2 ? 4 : compCount;
		for (let i = 0; i < n; i++) {
			const lo = tokens[ti + consumed + 0];
			const hi = tokens[ti + consumed + 1];
			consumed += 2;
			// No ArrayBuffer for Float64 from two u32s without temp; skip for now.
			immediates.push(lo + hi * 4294967296);
		}
	}

	// Indices: for each dimension, read the index based on representation.
	// 0 = immediate32, 1 = immediate64 (rare), 2 = relative,
	// 3 = immediate32 + relative.
	const indices: DxbcOperandIndex[] = [];
	for (let d = 0; d < dimension; d++) {
		const rep = idxReps[d];
		if (rep === 0) {
			const v = tokens[ti + consumed];
			consumed++;
			indices.push({ kind: 'immediate', value: v });
		} else if (rep === 2) {
			// Sub-operand describes the relative base.
			const sub = decodeOperand(tokens, ti + consumed);
			consumed += sub.consumed;
			indices.push({ kind: 'relative', base: sub.op, offset: 0 });
		} else if (rep === 3) {
			// Immediate + relative: u32 imm then sub-operand.
			const imm = tokens[ti + consumed];
			consumed++;
			const sub = decodeOperand(tokens, ti + consumed);
			consumed += sub.consumed;
			indices.push({ kind: 'relative', base: sub.op, offset: imm });
		} else {
			// Unhandled — consume a dword so we don't loop forever.
			consumed++;
			indices.push({ kind: 'immediate', value: 0 });
		}
	}

	const typeMap: Record<number, DxbcOperandType> = {
		0x00: 'temp',
		0x01: 'input',
		0x02: 'output',
		0x03: 'indexable_temp',
		0x04: 'immediate32',
		0x05: 'immediate64',
		0x06: 'sampler',
		0x07: 'resource',
		0x08: 'constant_buffer',
		0x0B: 'primitive_id',
		0x0D: 'null',
		0x10: 'special_v',
		0x12: 'special_o',
	};

	return {
		op: {
			type: typeMap[operandType] ?? 'unknown',
			typeRaw: operandType,
			dimension,
			indices,
			selectionMode,
			mask,
			swizzle,
			select1,
			modifier,
			immediates,
		},
		consumed,
	};
}

function decodeInstruction(tokens: Uint32Array, ti: number): { ins: DxbcInstruction; next: number } {
	const head = tokens[ti];
	const op = opcodeOf(head);
	const entry = OP_TABLE[op];
	const name = entry?.name ?? `OP_0x${op.toString(16)}`;
	let length = opcodeLengthOf(head);

	// `customdata` is special — total length is in the *next* dword.
	if (op === 0x35) {
		length = tokens[ti + 1];
		return {
			ins: {
				opcode: op,
				name,
				kind: 'decl',
				tokenIndex: ti,
				length,
				extended: [],
				saturate: false,
				operands: [],
			},
			next: ti + length,
		};
	}

	const extended: number[] = [];
	let readCursor = 1;
	if (hasExtended(head)) {
		// Walk the chain. Each extended token has its own high-bit for more.
		let extTok = tokens[ti + readCursor];
		extended.push(extTok);
		readCursor++;
		while ((extTok & 0x80000000) !== 0) {
			extTok = tokens[ti + readCursor];
			extended.push(extTok);
			readCursor++;
		}
	}

	const saturate = saturateOf(head);

	const operands: DxbcOperand[] = [];
	// Decode exactly `arity` operands (from OP_TABLE), not "until we hit
	// length". The instruction-length field can include trailing metadata
	// that isn't a regular operand (resource-return-type byte on sample
	// instructions, sincos's second dest, etc.); treating those as extra
	// operands produces garbage like `sqrt(a, b, c)`.
	const arity = entry?.arity ?? 0;
	for (let n = 0; n < arity && readCursor < length; n++) {
		const { op: o, consumed } = decodeOperand(tokens, ti + readCursor);
		operands.push(o);
		readCursor += consumed;
		if (consumed === 0) { readCursor = length; break; }
	}
	// Skip whatever trailing metadata the instruction includes.
	readCursor = length;

	// Capture dcl-specific fields (interpolation mode lives in the opcode
	// token, globalFlags lives there too).
	let decl: DxbcDecl | undefined;
	if (entry?.kind === 'decl') {
		const interp = (head >>> 11) & 0xF;
		const resDim = (head >>> 11) & 0x1F;
		const sysVal = (tokens[ti + length - 1]) & 0xFFFF;
		const globalFlags = (head >>> 11) & 0x7FF;
		switch (op) {
			case 0x58: // dcl_resource
				decl = {
					kind: 'resource',
					register: operands[0]?.indices[0]?.kind === 'immediate' ? operands[0].indices[0].value : 0,
					dim: resDim,
					returnType: tokens[ti + readCursor - 1] >>> 0,
				};
				break;
			case 0x59: // dcl_constantbuffer
				decl = {
					kind: 'constantBuffer',
					register: operands[0]?.indices[0]?.kind === 'immediate' ? operands[0].indices[0].value : 0,
					size: operands[0]?.indices[1]?.kind === 'immediate' ? operands[0].indices[1].value : 0,
					accessPattern: (head >>> 11) & 0x3,
				};
				break;
			case 0x5A: // dcl_sampler
				decl = {
					kind: 'sampler',
					register: operands[0]?.indices[0]?.kind === 'immediate' ? operands[0].indices[0].value : 0,
					mode: (head >>> 11) & 0x7,
				};
				break;
			case 0x5F: // dcl_input
				decl = { kind: 'input', register: regOf(operands[0]), mask: operands[0]?.mask ?? 0 };
				break;
			case 0x60: case 0x61: // dcl_input_sgv / dcl_input_siv
				decl = { kind: 'inputSv', register: regOf(operands[0]), mask: operands[0]?.mask ?? 0, systemValue: sysVal };
				break;
			case 0x62: // dcl_input_ps
				decl = { kind: 'inputPs', register: regOf(operands[0]), mask: operands[0]?.mask ?? 0, interpolation: interp };
				break;
			case 0x63: case 0x64: // dcl_input_ps_sgv / siv
				decl = { kind: 'inputPsSv', register: regOf(operands[0]), mask: operands[0]?.mask ?? 0, interpolation: interp, systemValue: sysVal };
				break;
			case 0x65: // dcl_output
				decl = { kind: 'output', register: regOf(operands[0]), mask: operands[0]?.mask ?? 0 };
				break;
			case 0x66: case 0x67: // dcl_output_sgv / siv
				decl = { kind: 'outputSv', register: regOf(operands[0]), mask: operands[0]?.mask ?? 0, systemValue: sysVal };
				break;
			case 0x68: // dcl_temps
				decl = { kind: 'temps', count: tokens[ti + 1] };
				break;
			case 0x69: // dcl_indexableTemp
				decl = { kind: 'indexableTemp', register: tokens[ti + 1], size: tokens[ti + 2], components: tokens[ti + 3] };
				break;
			case 0x6A: // dcl_globalFlags
				decl = { kind: 'globalFlags', flags: globalFlags };
				break;
		}
	}

	return {
		ins: {
			opcode: op,
			name,
			kind: (entry?.kind ?? 'unknown') as DxbcInstruction['kind'],
			tokenIndex: ti,
			length,
			extended,
			saturate,
			operands,
			decl,
		},
		next: ti + length,
	};
}

function regOf(o: DxbcOperand | undefined): number {
	if (!o || o.indices.length === 0) return 0;
	const i = o.indices[0];
	return i.kind === 'immediate' ? i.value : 0;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export function decodeShex(tokens: Uint32Array): DecodedShader {
	const all: DxbcInstruction[] = [];
	const decls: DxbcInstruction[] = [];
	const body: DxbcInstruction[] = [];
	let i = 0;
	while (i < tokens.length) {
		const { ins, next } = decodeInstruction(tokens, i);
		all.push(ins);
		if (ins.kind === 'decl') decls.push(ins);
		else body.push(ins);
		if (next <= i) break; // safety
		i = next;
	}
	return { decls, body, all };
}
