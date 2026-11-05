// Instruction semantics the game's shaders depend on: integer ops under the
// float value model, integer immediates, vFace, conditional polarity, early
// returns, register-file indexing and the unsupported-op report.

import { describe, it, expect } from 'vitest';
import { cb, decl, dst, imm, input, ins, nullDst, operand, output, temp, translate } from './emitHarness';

const sig = (semanticName: string, register: number, systemValue = 0, mask = 0xF) => ({ semanticName, semanticIndex: 0, systemValue, register, mask });

describe('integer ops', () => {
	it('emits `and` as "nonzero a selects b"', () => {
		const { source, unsupported } = translate([ins('and', [dst(0, 0x1), temp(1, 2), temp(2, 2)])]);
		expect(source).toContain('r0.x = vec4(vec4(notEqual(vec4(r1.x), vec4(0.0))) * vec4(r2.x)).x;');
		expect(unsupported).toEqual([]);
	});

	it('emits the low half of imul and skips a null high half', () => {
		const { source } = translate([ins('imul', [nullDst(), dst(1, 0x1), input(0), imm(3)])], { stage: 'vertex', inputs: [sig('BLENDINDICES', 0)] });
		// The skinned vertex shaders scale the bone index by 3 rows per bone.
		expect(source).toContain('r1.x = vec4(vec4(a_BLENDINDICES0.xyzw) * vec4(vec4(3.0))).x;');
		expect(source).not.toMatch(/floor\(/);
	});

	it('writes sin and cos to their own destinations', () => {
		const { source } = translate([
			ins('sincos', [dst(0, 0x1), nullDst(), temp(2, 2)]),
			ins('sincos', [nullDst(), dst(1, 0x2), temp(2, 2)]),
		]);
		expect(source).toContain('r0.x = vec4(sin(vec4(r2.x))).x;');
		expect(source).toContain('r1.y = vec4(cos(vec4(r2.x))).y;');
		expect(source).not.toContain('unhandled');
	});
});

describe('immediates', () => {
	it('reads integer bit patterns as integers', () => {
		// Shadow-cascade select: `movc r2.x, r0.x, l(0), l(4)` feeds cb0[r2.x + 9].
		const { source } = translate([ins('movc', [dst(2, 0x1), temp(0, 2), imm(0), imm(4)])]);
		expect(source).toContain('mix(vec4(vec4(4.0)), vec4(vec4(0.0))');
		expect(translate([ins('mov', [dst(0), imm(0xFFFFFFFF)])]).source).toContain('r0 = vec4(vec4(-1.0));');
	});

	it('keeps float bit patterns as floats', () => {
		const { source } = translate([ins('mov', [dst(0), imm(0x3F800000, 0x3F000000, 0, 0xBF800000)])]);
		expect(source).toContain('vec4(1.0, 0.5, 0.0, -1.0)');
	});

	it('writes infinity and NaN through their bit patterns', () => {
		const { source } = translate([ins('mov', [dst(0), imm(0x7F800000, 0xFF800000, 0x7FC00000, 0)])]);
		expect(source).toContain('vec4(uintBitsToFloat(0x7f800000u), uintBitsToFloat(0xff800000u), uintBitsToFloat(0x7fc00000u), 0.0)');
	});
});

describe('SV_IsFrontFace', () => {
	it('reads 0 on a back face so `movc n, vFace, n, -n` flips the normal', () => {
		const { source } = translate([], { inputs: [sig('SV_IsFrontFace', 3, 9, 0x1)] });
		expect(source).toContain('#define v_SV_IsFrontFace0 vec4(gl_FrontFacing ? 1.0 : 0.0)');
	});
});

describe('conditional ops', () => {
	it('tests for nonzero in the _nz form and for zero in the _z form', () => {
		for (const name of ['if', 'breakc', 'discard', 'continuec']) {
			const nz = translate([ins(name, [temp(0, 2)], { testNonZero: true }), ...(name === 'if' ? [ins('endif', [])] : [])]).source;
			const z = translate([ins(name, [temp(0, 2)], { testNonZero: false }), ...(name === 'if' ? [ins('endif', [])] : [])]).source;
			expect(nz, name).toContain('vec4(r0.x).x != 0.0');
			expect(z, name).toContain('vec4(r0.x).x == 0.0');
		}
	});

	it('emits plain break and continue', () => {
		const { source } = translate([ins('loop', []), ins('continue', []), ins('break', []), ins('endloop', [])]);
		expect(source).toMatch(/for \(int _i = 0; _i < 1024; _i\+\+\) \{\s*continue;\s*break;\s*\}/);
	});
});

describe('returns', () => {
	const vs = { stage: 'vertex' as const, outputs: [sig('SV_POSITION', 0, 1), sig('TEXCOORD', 1)], decls: [
		decl({ kind: 'outputSv', register: 0, mask: 0xF, systemValue: 1 }),
		decl({ kind: 'output', register: 1, mask: 0xF }),
	] };

	it('copies the vertex outputs before an early return', () => {
		const { source } = translate([
			ins('mov', [output(0), temp(0)]),
			ins('retc', [temp(1, 2)], { testNonZero: true }),
			ins('mov', [output(1), temp(2)]),
			ins('ret', []),
		], vs);
		expect(source).toContain('if (vec4(r1.x).x != 0.0) { gl_Position = o0; v_TEXCOORD0 = o1; return; }');
		// The closing ret falls through to the copy at the end of main.
		expect(source).toMatch(/o1 = vec4\(r2\.xyzw\);\s*gl_Position = o0;\s*v_TEXCOORD0 = o1;\s*\}$/);
	});

	it('returns from a pixel shader without a copy', () => {
		const { source } = translate([ins('if', [temp(0, 2)]), ins('ret', []), ins('endif', []), ins('ret', [])]);
		expect(source).toMatch(/if \(vec4\(r0\.x\)\.x != 0\.0\) \{\s*return;\s*\}/);
	});
});

describe('register files', () => {
	it('indexes indexable temps for reads and writes', () => {
		const x = (index: Parameters<typeof operand>[1][number], sel: number) => operand('indexable_temp', [{ kind: 'immediate', value: 0 }, index], sel);
		const { source } = translate([
			ins('mov', [x({ kind: 'relative', base: temp(1, 2), offset: 1 }, 0), temp(2)]),
			ins('mov', [dst(0), x({ kind: 'immediate', value: 3 }, 1)]),
		], { decls: [decl({ kind: 'indexableTemp', register: 0, size: 4, components: 4 })] });
		expect(source).toContain('vec4 x0[4];');
		expect(source).toContain('x0[int(vec4(r1.x).x) + 1] = vec4(r2.xyzw);');
		expect(source).toContain('r0 = vec4(x0[3].xyzw);');
	});

	it('declares the immediate constant buffer and reads it by index', () => {
		const icbRead = operand('immediate_constant_buffer', [{ kind: 'relative', base: temp(1, 2), offset: 0 }], 1);
		const { source } = translate([ins('mov', [dst(0), icbRead])], {
			decls: [decl({ kind: 'immediateConstantBuffer', bits: [0x3F800000, 0, 0, 0, 2, 0, 0, 0x3F800000] })],
		});
		expect(source).toContain('vec4 icb[2] = vec4[2](vec4(1.0, 0.0, 0.0, 0.0), vec4(2.0, 0.0, 0.0, 1.0));');
		expect(source).toContain('r0 = vec4(icb[int(vec4(r1.x).x) + 0].xyzw);');
	});

	it('writes oDepth to gl_FragDepth', () => {
		const { source } = translate([ins('mov', [operand('output_depth', [], 0, 0), temp(0, 2)])]);
		expect(source).toContain('gl_FragDepth = vec4(r0.x).x;');
	});
});

describe('unsupported report', () => {
	it('lists every op and operand kind the emitter cannot translate', () => {
		const { source, unsupported } = translate([
			ins('iadd', [dst(0), temp(1), temp(2)]),
			ins('OP_0x7f', []),
			ins('mov', [operand('stream', [{ kind: 'immediate', value: 0 }], 0), temp(0)]),
			ins('mov', [dst(0), operand('primitive_id', [], 1)]),
			ins('mov', [dst(1), cb({ kind: 'immediate', value: 2 })]),
		]);
		expect(unsupported.sort()).toEqual(['OP_0x7f', 'dst:stream', 'iadd', 'src:primitive_id']);
		expect(source).toContain('// unsupported op: iadd');
	});
});
