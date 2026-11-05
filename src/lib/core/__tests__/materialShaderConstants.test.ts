import { describe, expect, it } from 'vitest';
import { constantNameHash, materialConstant, materialConstantsByName, parseMaterialShaderConstants } from '../materialShaderConstants';

// Builds a Material body with the layout retail vehicle materials use: an empty
// block behind +0x14 and the populated block behind +0x18.
function material(constants: { hash: number; values: number[] }[], firstBlock: typeof constants = []): Uint8Array {
	const buf = new ArrayBuffer(0x400);
	const dv = new DataView(buf);
	let cursor = 0x40;
	const alloc = (bytes: number) => { const at = cursor; cursor += bytes; return at; };
	const block = (list: typeof constants) => {
		const at = alloc(0x14);
		const sizes = alloc(4 * list.length);
		const data = alloc(4 * list.length);
		const hashes = alloc(4 * list.length);
		dv.setUint32(at, list.length, true);
		dv.setUint32(at + 4, sizes, true);
		dv.setUint32(at + 8, data, true);
		dv.setUint32(at + 12, hashes, true);
		list.forEach((c, i) => {
			const vals = alloc(4 * c.values.length);
			c.values.forEach((v, k) => dv.setFloat32(vals + 4 * k, v, true));
			dv.setUint32(sizes + 4 * i, c.values.length / 4, true);
			dv.setUint32(data + 4 * i, vals, true);
			dv.setUint32(hashes + 4 * i, c.hash, true);
		});
		return at;
	};
	dv.setUint32(0x14, block(firstBlock), true);
	dv.setUint32(0x18, block(constants), true);
	return new Uint8Array(buf, 0, cursor);
}

describe('parseMaterialShaderConstants', () => {
	it('reads hashed float4 constants from both blocks', () => {
		const raw = material(
			[{ hash: 0xdeadbeef, values: [0.8, 1.15, 0.2, 0.9] }, { hash: 7, values: [6, 2, 1, 1] }],
			[{ hash: 9, values: [1, 2, 3, 4, 5, 6, 7, 8] }],
		);
		const out = parseMaterialShaderConstants(raw);
		expect(out.map((c) => c.hash)).toEqual([9, 0xdeadbeef, 7]);
		expect(out[0].values).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
		expect(out[1].values.map((v) => +v.toFixed(4))).toEqual([0.8, 1.15, 0.2, 0.9]);
	});

	it('returns nothing for absent blocks', () => {
		const raw = new Uint8Array(0x40);
		expect(parseMaterialShaderConstants(raw)).toEqual([]);
	});

	it('stops at offsets outside the resource instead of throwing', () => {
		const raw = material([{ hash: 1, values: [1, 1, 1, 1] }]);
		const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
		const block = dv.getUint32(0x18, true);
		dv.setUint32(dv.getUint32(block + 8, true), 0xfffff0, true); // data pointer past the end
		expect(parseMaterialShaderConstants(raw)).toEqual([]);
		dv.setUint32(block, 1000, true); // absurd count
		expect(parseMaterialShaderConstants(raw)).toEqual([]);
	});
});

describe('materialConstantsByName', () => {
	it('names constants through the shader hash table and drops unknown hashes', () => {
		const named = materialConstantsByName(
			[{ hash: 0x80000001, values: [1, 2, 3, 4] }, { hash: 5, values: [0, 0, 0, 0] }],
			[{ name: 'g_fresnelRanges', hash: 0x80000001 }],
		);
		expect(named).toEqual({ g_fresnelRanges: [1, 2, 3, 4] });
	});
});

describe('constantNameHash', () => {
	it('is the CRC-32 register without the final inversion, as the Shader stores it', () => {
		expect(constantNameHash('materialDiffuse')).toBe(0xf6e27caa);
		expect(constantNameHash('g_fresnelRanges')).toBe(0x3859100b);
		expect(constantNameHash('sampleCoverage')).toBe(0x37dd4229);
		expect(constantNameHash('')).toBe(0xffffffff);
	});
});

describe('materialConstant', () => {
	it('finds a material value by constant name', () => {
		const constants = [{ hash: 0xf6e27caa, values: [0, 0.28, 0.24, 1] }, { hash: 7, values: [1, 1, 1, 1] }];
		expect(materialConstant(constants, 'materialDiffuse')).toEqual([0, 0.28, 0.24, 1]);
		expect(materialConstant(constants, 'g_fresnelRanges')).toBeNull();
	});
});
