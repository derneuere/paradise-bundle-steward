import { describe, it, expect } from 'vitest';
import { decodeDXT1, decodeDXT3, decodeDXT5 } from '../dxt';

// Build one 4×4 block: 8-byte explicit-alpha + 8-byte BC1 color (4-color mode,
// white c0 / black c1, all selectors = 0 → every texel is white).
function bc2Block(alphaBytes: number[]): Uint8Array {
	const b = new Uint8Array(16);
	b.set(alphaBytes, 0);                 // explicit 4-bit alpha (16 texels)
	b[8] = 0xff; b[9] = 0xff;             // c0 = RGB565 white (0xFFFF)
	b[10] = 0x00; b[11] = 0x00;           // c1 = black (0x0000) -> c0>c1, 4-color
	b[12] = b[13] = b[14] = b[15] = 0x00; // all selectors -> color 0 (white)
	return b;
}

describe('decodeDXT3 (BC2)', () => {
	it('decodes explicit 4-bit alpha + BC1 color (all opaque white)', () => {
		const out = decodeDXT3(bc2Block(new Array(8).fill(0xff)), 4, 4);
		expect(out.length).toBe(4 * 4 * 4);
		for (let i = 0; i < 16; i++) {
			expect([out[i * 4], out[i * 4 + 1], out[i * 4 + 2], out[i * 4 + 3]]).toEqual([255, 255, 255, 255]);
		}
	});

	it('reads alpha low-nibble-first (even texel = low nibble)', () => {
		// alpha byte 0 = 0x0F: texel 0 nibble = 0xF (->255), texel 1 nibble = 0x0 (->0)
		const out = decodeDXT3(bc2Block([0x0f, 0, 0, 0, 0, 0, 0, 0]), 4, 4);
		expect(out[3]).toBe(255);  // texel 0 alpha
		expect(out[7]).toBe(0);    // texel 1 alpha
		// Color is white regardless of alpha.
		expect([out[0], out[1], out[2]]).toEqual([255, 255, 255]);
	});

	it('scales 4-bit alpha to 8-bit via ×17 (0xF→255, 0x8→136)', () => {
		// byte 0 = 0x80: texel0 low nibble 0x0 -> 0; texel1 high nibble 0x8 -> 136
		const out = decodeDXT3(bc2Block([0x80, 0, 0, 0, 0, 0, 0, 0]), 4, 4);
		expect(out[3]).toBe(0);
		expect(out[7]).toBe(136);
	});

	it('handles non-multiple-of-4 dimensions without overrun', () => {
		const out = decodeDXT3(bc2Block(new Array(8).fill(0xff)), 3, 1);
		expect(out.length).toBe(3 * 1 * 4);
		expect([out[0], out[1], out[2], out[3]]).toEqual([255, 255, 255, 255]);
	});
});

// Smoke tests so the BC1/BC3 decoders stay characterised alongside BC2.
describe('decodeDXT1 / decodeDXT5 smoke', () => {
	it('DXT1 all-white opaque block', () => {
		const b = new Uint8Array([0xff, 0xff, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
		const out = decodeDXT1(b, 4, 4);
		expect([out[0], out[1], out[2], out[3]]).toEqual([255, 255, 255, 255]);
	});
	it('DXT5 white color + opaque interpolated alpha', () => {
		const b = new Uint8Array(16);
		b[0] = 0xff; b[1] = 0xff;             // alpha endpoints both 255 -> all 255
		b[8] = 0xff; b[9] = 0xff;             // color c0 white
		const out = decodeDXT5(b, 4, 4);
		expect([out[0], out[1], out[2], out[3]]).toEqual([255, 255, 255, 255]);
	});
});
