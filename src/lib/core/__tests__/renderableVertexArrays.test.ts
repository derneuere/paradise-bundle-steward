import { describe, expect, it } from 'vitest';
import { decodeVertexArrays, type ParsedVertexDescriptor } from '../renderable';

const POSITIONS = 1, BONE_INDEXES = 13, BONE_WEIGHTS = 14;
const attr = (type: number, offset: number, stride: number) => ({ type, offset, stride, unknown1: 0, unknown2: 0 });

// Two vertices, stride 20: position (3 × f32) + bone indices (4 × u8) + bone weights (4 × u8).
function body(): Uint8Array {
	const bytes = new Uint8Array(8 + 40);
	const dv = new DataView(bytes.buffer);
	const write = (v: number, pos: number[], idx: number[], w: number[]) => {
		const base = 8 + v * 20;
		pos.forEach((p, i) => dv.setFloat32(base + i * 4, p, true));
		idx.forEach((b, i) => { bytes[base + 12 + i] = b; });
		w.forEach((b, i) => { bytes[base + 16 + i] = b; });
	};
	write(0, [1, 2, 3], [5, 7, 0, 0], [255, 0, 0, 0]);
	write(1, [4, 5, 6], [126, 3, 0, 0], [51, 204, 0, 0]);
	return bytes;
}

describe('decodeVertexArrays bone data', () => {
	it('decodes skin indices and normalised weights alongside positions', () => {
		// TODO(types): VertexAttributeType is module-private; the tests use its numeric values
		const vd = { unknown1: 0, unknown2: 1, unknown3: 0, stride: 20, attributes: [attr(POSITIONS, 0, 20), attr(BONE_INDEXES, 12, 20), attr(BONE_WEIGHTS, 16, 20)] } as unknown as ParsedVertexDescriptor;
		const out = decodeVertexArrays(body(), { bodyOffset: 8, byteLength: 40 }, vd);
		expect(out.vertexCount).toBe(2);
		expect([...out.positions]).toEqual([1, 2, 3, 4, 5, 6]);
		expect([...out.boneIndices!]).toEqual([5, 7, 0, 0, 126, 3, 0, 0]);
		expect(out.boneWeights![0]).toBe(1);
		expect(out.boneWeights![4]).toBeCloseTo(0.2, 6);
		expect(out.boneWeights![5]).toBeCloseTo(0.8, 6);
	});

	it('leaves bone data null when the layout has none', () => {
		const vd = { unknown1: 0, unknown2: 1, unknown3: 0, stride: 20, attributes: [attr(POSITIONS, 0, 20)] } as unknown as ParsedVertexDescriptor;
		const out = decodeVertexArrays(body(), { bodyOffset: 8, byteLength: 40 }, vd);
		expect(out.boneIndices).toBeNull();
		expect(out.boneWeights).toBeNull();
	});
});
