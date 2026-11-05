// Emitter behaviour on hand-built programs: saturate, the uniform size of a
// dynamically indexed constant buffer, and cube vs 2D texture sampling.

import { describe, it, expect } from 'vitest';
import { emitGlsl } from '../glsl';
import type { DecodedShader, DxbcInstruction, DxbcOperand } from '../ops';
import type { ParsedDxbc } from '../parser';

const XYZW = 0b11100100;

function operand(type: DxbcOperand['type'], indices: DxbcOperand['indices'], selectionMode: number, mask = 0xF): DxbcOperand {
	return { type, typeRaw: 0, dimension: indices.length, indices, selectionMode, mask, swizzle: XYZW, select1: 0, modifier: 0, immediates: [] };
}
const temp = (r: number, sel = 1, mask = 0xF) => operand('temp', [{ kind: 'immediate', value: r }], sel, mask);
const cb = (slot: DxbcOperand['indices'][number]) => operand('constant_buffer', [{ kind: 'immediate', value: 0 }, slot], 1);

function ins(name: string, operands: DxbcOperand[], saturate = false): DxbcInstruction {
	return { opcode: 0, name, kind: 'alu', tokenIndex: 0, length: 0, extended: [], saturate, operands };
}

type Binding = ParsedDxbc['reflection']['resourceBindings'][number];
const texture = (name: string, bindPoint: number, dimension: number): Binding =>
	({ name, type: 2, returnType: 5, dimension, numSamples: 0, bindPoint, bindCount: 1, flags: 0 });
const tex = (r: number) => operand('resource', [{ kind: 'immediate', value: r }], 1);
const samp = (r: number) => operand('sampler', [{ kind: 'immediate', value: r }], 0);

function program(body: DxbcInstruction[], variables: { name: string; slot: number; slots: number }[], bindings: Binding[] = []): string {
	const parsed = {
		programType: 'pixel',
		inputs: [], outputs: [],
		reflection: {
			constantBuffers: [{
				name: '_Globals', size: 0, flags: 0,
				variables: variables.map((v) => ({ name: v.name, startOffset: v.slot * 16, size: v.slots * 16, type: { class: 1, type: 0x25, rows: 1, columns: 4, elements: 0 } })),
			}],
			resourceBindings: [{ name: '_Globals', type: 0, returnType: 0, dimension: 0, numSamples: 0, bindPoint: 0, bindCount: 1, flags: 0 }, ...bindings],
		},
	} as unknown as ParsedDxbc;
	const decoded: DecodedShader = { decls: [ins('dcl_temps', [])].map((d) => ({ ...d, decl: { kind: 'temps', count: 2 } })), body, all: body };
	return emitGlsl(parsed, decoded);
}

describe('emitGlsl', () => {
	it('clamps the result of a saturated instruction and leaves others alone', () => {
		const glsl = program([
			ins('mul', [temp(0, 0, 0x8), temp(1), cb({ kind: 'immediate', value: 2 })], true),
			ins('mul', [temp(1, 0, 0x1), temp(1), cb({ kind: 'immediate', value: 2 })]),
		], [{ name: 'k', slot: 2, slots: 1 }]);
		expect(glsl).toContain('r0.w = clamp(vec4(r1.xyzw * cb0[2].xyzw).w, 0.0, 1.0);');
		expect(glsl).toContain('r1.x = vec4(r1.xyzw * cb0[2].xyzw).x;');
	});

	it('sizes a dynamically indexed buffer to the whole array variable it reads', () => {
		const glsl = program([
			ins('mov', [temp(0, 0), cb({ kind: 'relative', base: temp(1), offset: 48 })]),
		], [{ name: 'world', slot: 44, slots: 4 }, { name: 'g_verletOffsets', slot: 48, slots: 128 }, { name: 'after', slot: 176, slots: 1 }]);
		expect(glsl).toContain('uniform vec4 cb0[176];');
		expect(glsl).toContain('cb0[int(vec4(r1.xyzw).x) + 48]');
	});

	it('falls back to 16 slots past the base when no variable covers it', () => {
		const glsl = program([
			ins('mov', [temp(0, 0), cb({ kind: 'relative', base: temp(1), offset: 10 })]),
		], []);
		expect(glsl).toContain('uniform vec4 cb0[27];');
	});

	it('samples a TextureCube with the full direction and a 2D texture with uv.xy', () => {
		// The vehicle shaders' reflection map is a cube (SRV dimension 9).
		const glsl = program([
			ins('sample', [temp(0), temp(1), tex(0), samp(0)]),
			ins('sample', [temp(2), temp(3), tex(13), samp(13)]),
		], [], [texture('DiffuseTexture', 0, 4), texture('ReflectionTexture', 13, 9)]);
		expect(glsl).toContain('uniform sampler2D DiffuseTexture; // t0');
		expect(glsl).toContain('uniform samplerCube ReflectionTexture; // t13');
		expect(glsl).toMatch(/texture2D\(DiffuseTexture, r1[.\w]*\.xy\)/);
		expect(glsl).toMatch(/textureCube\(ReflectionTexture, r3[.\w]*\.xyz\)/);
	});
});
