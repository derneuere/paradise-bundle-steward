// SHEX token decoding on hand-assembled instructions (token layouts from
// d3d11TokenizedProgramFormat.hpp).

import { describe, it, expect } from 'vitest';
import { decodeShex } from '../ops';

const len = (n: number) => n << 24;
// Operand tokens: [1:0] components, [3:2] selection mode, [11:4] mask /
// swizzle / select, [19:12] type, [21:20] index dimension.
const R0_X = 0x2 | (2 << 2) | (1 << 20); // r0.x, select1
const R0_DST = 0x2 | (0xF << 4) | (1 << 20); // r0.xyzw, write mask
const R1_SRC = 0x2 | (1 << 2) | (0xE4 << 4) | (1 << 20); // r1.xyzw
const IMM4 = 0x2 | (4 << 12); // l(a, b, c, d)
const T0 = 0x2 | (1 << 2) | (0xE4 << 4) | (7 << 12) | (1 << 20);
const S0 = (6 << 12) | (1 << 20);

describe('decodeShex', () => {
	it('records the _z / _nz test of conditional ops (bit 18)', () => {
		const tokens = new Uint32Array([
			0x1F | len(3) | (1 << 18), R0_X, 0, // if_nz r0.x
			0x15 | len(1), // endif
			0x03 | len(3), R0_X, 0, // breakc_z r0.x
			0x0D | len(3) | (1 << 18), R0_X, 0, // discard_nz r0.x
		]);
		const body = decodeShex(tokens).body;
		expect(body.map((i) => [i.name, i.testNonZero])).toEqual([['if', true], ['endif', undefined], ['breakc', false], ['discard', true]]);
	});

	it('keeps the raw bits of immediates', () => {
		const tokens = new Uint32Array([0x36 | len(8), R0_DST, 0, IMM4, 4, 0x3F800000, 0xFFFFFFFF, 0]);
		const [mov] = decodeShex(tokens).body;
		expect(mov.operands[1].type).toBe('immediate32');
		expect(mov.operands[1].immediateBits).toEqual([4, 0x3F800000, 0xFFFFFFFF, 0]);
		expect(mov.operands[1].immediates[1]).toBe(1);
	});

	it('decodes the immediate constant buffer customdata block', () => {
		const tokens = new Uint32Array([0x35 | (3 << 11), 10, 1, 2, 3, 4, 5, 6, 7, 8, 0x3E | len(1)]);
		const { decls, body } = decodeShex(tokens);
		expect(decls[0].decl).toEqual({ kind: 'immediateConstantBuffer', bits: [1, 2, 3, 4, 5, 6, 7, 8] });
		expect(body.map((i) => i.name)).toEqual(['ret']);
	});

	it('names operand types 9 (icb) and 12 (oDepth)', () => {
		const tokens = new Uint32Array([
			0x36 | len(5), 0x1 | (0xC << 12), 0x2 | (1 << 2) | (9 << 12) | (1 << 20), 3, // mov oDepth, icb[3]
		]);
		const [mov] = decodeShex(tokens).body;
		expect(mov.operands.map((o) => o.type)).toEqual(['output_depth', 'immediate_constant_buffer']);
	});

	it('reads the immediate texel offset of a sample from its extended token', () => {
		const offsets = 1 | (1 << 9) | ((-2 & 0xF) << 13);
		const tokens = new Uint32Array([0x45 | len(10) | 0x80000000, offsets, R0_DST, 0, R1_SRC, 1, T0, 0, S0, 0]);
		const [sample] = decodeShex(tokens).body;
		expect(sample.name).toBe('sample');
		expect(sample.texelOffset).toEqual([1, -2, 0]);
		expect(sample.operands.map((o) => o.type)).toEqual(['temp', 'temp', 'resource', 'sampler']);
	});
});
