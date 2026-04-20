// Survey ShaderProgramBuffer (0x12) resources in example/SHADERS.BNDL:
//   - confirm DXBC magic and parse the chunk table
//   - tabulate opcodes so we know what a DXBC→GLSL translator must cover
//
// DXBC layout:
//   0x00: 'DXBC' magic
//   0x04: 16-byte hash
//   0x14: u32 (1)
//   0x18: u32 totalSize
//   0x1C: u32 numChunks
//   0x20: u32[numChunks] chunkOffsets
//   each chunk: 4-byte FourCC + u32 chunkSize + chunkData
//
// SHDR/SHEX instructions are 32-bit DWORDs starting with a token:
//   [10:0]  = opcode
//   [23:11] = opcodeLength - 1 (or special encoding)
//   [30:24] = ...
//   [31]    = extended
// For a survey we just need opcode field [10:0] and length [30:24].

import { readFileSync } from 'node:fs';
import { parseBundle } from '../src/lib/core/bundle/index';
import {
	getHandlerByKey,
	resourceCtxFromBundle,
} from '../src/lib/core/registry';
import { getResourceBlocks } from '../src/lib/core/resourceManager';

// Partial SM5 opcode name table — enough for a readable survey. Missing
// ones print as OP_<n>.
const OP_NAMES: Record<number, string> = {
	0x00: 'add',
	0x01: 'and',
	0x02: 'break',
	0x03: 'breakc',
	0x04: 'call',
	0x05: 'callc',
	0x06: 'case',
	0x07: 'continue',
	0x08: 'continuec',
	0x09: 'cut',
	0x0A: 'default',
	0x0B: 'deriv_rtx',
	0x0C: 'deriv_rty',
	0x0D: 'discard',
	0x0E: 'div',
	0x0F: 'dp2',
	0x10: 'dp3',
	0x11: 'dp4',
	0x12: 'else',
	0x13: 'emit',
	0x14: 'emitThenCut',
	0x15: 'endif',
	0x16: 'endloop',
	0x17: 'endswitch',
	0x18: 'eq',
	0x19: 'exp',
	0x1A: 'frc',
	0x1B: 'ftoi',
	0x1C: 'ftou',
	0x1D: 'ge',
	0x1E: 'iadd',
	0x1F: 'if',
	0x20: 'ieq',
	0x21: 'ige',
	0x22: 'ilt',
	0x23: 'imad',
	0x24: 'imax',
	0x25: 'imin',
	0x26: 'imul',
	0x27: 'ine',
	0x28: 'ineg',
	0x29: 'ishl',
	0x2A: 'ishr',
	0x2B: 'itof',
	0x2C: 'label',
	0x2D: 'ld',
	0x2E: 'ld_ms',
	0x2F: 'log',
	0x30: 'loop',
	0x31: 'lt',
	0x32: 'mad',
	0x33: 'min',
	0x34: 'max',
	0x35: 'customdata',
	0x36: 'mov',
	0x37: 'movc',
	0x38: 'mul',
	0x39: 'ne',
	0x3A: 'nop',
	0x3B: 'not',
	0x3C: 'or',
	0x3D: 'resinfo',
	0x3E: 'ret',
	0x3F: 'retc',
	0x40: 'round_ne',
	0x41: 'round_ni',
	0x42: 'round_pi',
	0x43: 'round_z',
	0x44: 'rsq',
	0x45: 'sample',
	0x46: 'sample_c',
	0x47: 'sample_c_lz',
	0x48: 'sample_l',
	0x49: 'sample_d',
	0x4A: 'sample_b',
	0x4B: 'sqrt',
	0x4C: 'switch',
	0x4D: 'sincos',
	0x4E: 'udiv',
	0x4F: 'ult',
	0x50: 'uge',
	0x51: 'umul',
	0x52: 'umad',
	0x53: 'umax',
	0x54: 'umin',
	0x55: 'ushr',
	0x56: 'utof',
	0x57: 'xor',
	0x58: 'dcl_resource',
	0x59: 'dcl_constantbuffer',
	0x5A: 'dcl_sampler',
	0x5B: 'dcl_index_range',
	0x5C: 'dcl_gs_output_primitive_topology',
	0x5D: 'dcl_gs_input_primitive',
	0x5E: 'dcl_maxOutputVertexCount',
	0x5F: 'dcl_input',
	0x60: 'dcl_input_sgv',
	0x61: 'dcl_input_siv',
	0x62: 'dcl_input_ps',
	0x63: 'dcl_input_ps_sgv',
	0x64: 'dcl_input_ps_siv',
	0x65: 'dcl_output',
	0x66: 'dcl_output_sgv',
	0x67: 'dcl_output_siv',
	0x68: 'dcl_temps',
	0x69: 'dcl_indexableTemp',
	0x6A: 'dcl_globalFlags',
};

function fourcc(bytes: Uint8Array, off: number): string {
	return String.fromCharCode(bytes[off], bytes[off+1], bytes[off+2], bytes[off+3]);
}

const buf = readFileSync('example/SHADERS.BNDL');
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const bundle = parseBundle(ab);
const handler = getHandlerByKey('shaderProgramBuffer')!;
const ctx = resourceCtxFromBundle(bundle);
const matches = bundle.resources.filter((r) => r.resourceTypeId === handler.typeId);

const opCounts = new Map<string, number>();
const chunkKinds = new Map<string, number>();
let notDxbc = 0;
let firstDump: string[] = [];
let totalShaders = 0;
let totalInstrs = 0;

for (const r of matches) {
	// DXBC lives in block 1 (graphics memory); block 0 is the binding/globals
	// metadata that the ShaderProgramBufferBPR header describes.
	const blocks = getResourceBlocks(ab, bundle, r);
	const raw = blocks[1];
	if (!raw || raw.byteLength < 0x20 || fourcc(raw, 0) !== 'DXBC') { notDxbc++; continue; }
	totalShaders++;
	const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
	const totalSize = dv.getUint32(0x18, true);
	const numChunks = dv.getUint32(0x1C, true);
	const chunkOffs: number[] = [];
	for (let i = 0; i < numChunks; i++) chunkOffs.push(dv.getUint32(0x20 + 4 * i, true));

	for (const co of chunkOffs) {
		const kind = fourcc(raw, co);
		chunkKinds.set(kind, (chunkKinds.get(kind) ?? 0) + 1);
		if (kind === 'SHDR' || kind === 'SHEX') {
			const chunkSize = dv.getUint32(co + 4, true);
			// +0 fourcc, +4 size, +8 u32 program version, +12 u32 dword length of tokens
			const progVer = dv.getUint32(co + 8, true);
			const progLen = dv.getUint32(co + 12, true);
			const tokensStart = co + 16;
			const tokensEnd = Math.min(co + 8 + chunkSize, raw.byteLength);
			let p = tokensStart;
			let instrsInThis = 0;
			const end = Math.min(tokensEnd, tokensStart + 4 * progLen);
			while (p + 4 <= end) {
				const tok = dv.getUint32(p, true);
				const opcode = tok & 0x7FF;
				let len = (tok >> 24) & 0x7F;
				// dcl_customdata encodes total length in next dword
				if (opcode === 0x35) {
					const total = p + 4 < end ? dv.getUint32(p + 4, true) : 2;
					len = total;
				}
				if (len === 0) len = 1;
				const name = OP_NAMES[opcode] ?? `OP_0x${opcode.toString(16)}`;
				opCounts.set(name, (opCounts.get(name) ?? 0) + 1);
				p += 4 * len;
				instrsInThis++;
				if (instrsInThis > 8192) break;
			}
			totalInstrs += instrsInThis;
			if (firstDump.length < 40 && (kind === 'SHDR' || kind === 'SHEX')) {
				firstDump.push(`shader size=${raw.byteLength} progVer=0x${progVer.toString(16)} progLen=${progLen} instrs=${instrsInThis}`);
			}
		}
	}
}

console.log(`scanned: ${matches.length} program buffers, DXBC: ${totalShaders}, non-DXBC: ${notDxbc}`);
console.log('');
console.log('chunk kinds:');
for (const [k, v] of [...chunkKinds.entries()].sort((a, b) => b[1] - a[1])) {
	console.log(`  ${k.padEnd(6)}  ${v}`);
}
console.log('');
console.log(`total instructions across all shaders: ${totalInstrs}`);
console.log('opcode frequency (top 60):');
for (const [op, n] of [...opCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 60)) {
	console.log(`  ${op.padEnd(22)}  ${n}`);
}
console.log('');
console.log(`distinct opcodes: ${opCounts.size}`);
console.log('first few shader headers:');
for (const l of firstDump.slice(0, 8)) console.log('  ', l);
