// Hand-built DXBC programs for emitter tests: operands, instructions and a
// minimal ParsedDxbc, without a real bytecode blob.

import { emitGlslWithReport } from '../glsl';
import type { DecodedShader, DxbcInstruction, DxbcOperand } from '../ops';
import type { ParsedDxbc } from '../parser';

export const XYZW = 0b11100100;

/** Swizzle byte from a string like 'ywxz'. */
export function swz(s: string): number {
	return [...s].reduce((acc, c, i) => acc | ('xyzw'.indexOf(c) << (2 * i)), 0);
}

export function operand(type: DxbcOperand['type'], indices: DxbcOperand['indices'], selectionMode: number, mask = 0xF): DxbcOperand {
	return { type, typeRaw: 0, dimension: indices.length, indices, selectionMode, mask, swizzle: XYZW, select1: 0, modifier: 0, immediates: [] };
}

const at = (r: number) => [{ kind: 'immediate' as const, value: r }];

/** Source temp `rN.xyzw` (or swizzled), or destination `rN.<mask>` with sel 0. */
export const temp = (r: number, sel = 1, mask = 0xF, swizzle = XYZW): DxbcOperand => ({ ...operand('temp', at(r), sel, mask), swizzle });
export const dst = (r: number, mask = 0xF) => temp(r, 0, mask);
export const input = (r: number, swizzle = XYZW): DxbcOperand => ({ ...operand('input', at(r), 1), swizzle });
export const output = (r: number, mask = 0xF) => operand('output', at(r), 0, mask);
export const resource = (r: number, swizzle = XYZW): DxbcOperand => ({ ...operand('resource', at(r), 1), swizzle });
export const sampler = (r: number) => operand('sampler', at(r), 0, 0);
export const nullDst = () => operand('null', [], 0, 0);
export const cb = (slot: DxbcOperand['indices'][number]) => operand('constant_buffer', [{ kind: 'immediate', value: 0 }, slot], 1);

/** Immediate from raw u32 bits (`l(4)` is bits 4, `l(1.0)` is 0x3f800000). */
export function imm(...bits: number[]): DxbcOperand {
	const f = new Float32Array(new Uint32Array(bits).buffer);
	return { ...operand('immediate32', [], 0, 0), immediates: Array.from(f), immediateBits: bits.map((b) => b >>> 0) };
}

export function ins(name: string, operands: DxbcOperand[], extra: Partial<DxbcInstruction> = {}): DxbcInstruction {
	return { opcode: 0, name, kind: 'alu', tokenIndex: 0, length: 0, extended: [], saturate: false, operands, ...extra };
}

export function decl(d: NonNullable<DxbcInstruction['decl']>): DxbcInstruction {
	return { ...ins(`dcl_${d.kind}`, []), kind: 'decl', decl: d };
}

type Sig = { semanticName: string; semanticIndex: number; systemValue: number; register: number; mask: number };

export type ProgramSpec = {
	stage?: 'vertex' | 'pixel';
	decls?: DxbcInstruction[];
	inputs?: Sig[];
	outputs?: Sig[];
	variables?: { name: string; slot: number; slots: number }[];
	textures?: { name: string; reg: number; dimension: number }[];
};

export function translate(body: DxbcInstruction[], spec: ProgramSpec = {}): { source: string; unsupported: string[] } {
	const sig = (s: Sig) => ({ ...s, componentType: 3, rwMask: s.mask });
	const parsed = {
		programType: spec.stage ?? 'pixel',
		programMajor: 5, programMinor: 0,
		inputs: (spec.inputs ?? []).map(sig),
		outputs: (spec.outputs ?? []).map(sig),
		reflection: {
			constantBuffers: [{
				name: '_Globals', size: 0, flags: 0,
				variables: (spec.variables ?? []).map((v) => ({ name: v.name, startOffset: v.slot * 16, size: v.slots * 16, type: { class: 1, type: 0x25, rows: 1, columns: 4, elements: 0 } })),
			}],
			resourceBindings: [
				{ name: '_Globals', type: 0, returnType: 0, dimension: 0, numSamples: 0, bindPoint: 0, bindCount: 1, flags: 0 },
				...(spec.textures ?? []).map((t) => ({ name: t.name, type: 2, returnType: 5, dimension: t.dimension, numSamples: 0, bindPoint: t.reg, bindCount: 1, flags: 0 })),
			],
		},
	} as unknown as ParsedDxbc; // TODO(types): only the fields the emitter reads are filled in
	const decls = [decl({ kind: 'temps', count: 4 }), ...(spec.decls ?? [])];
	const decoded: DecodedShader = { decls, body, all: [...decls, ...body] };
	return emitGlslWithReport(parsed, decoded);
}
