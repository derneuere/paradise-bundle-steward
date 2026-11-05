// MaterialState resource (type 0xF): the fixed-function render state a
// Material technique draws with. PC, 192 bytes, little-endian.
//
// The header holds three offsets (from the resource start) to the three state
// blocks serialised behind it, which follow the D3D11 state descriptions:
//   +0x00  u32 -> blend block          (0x0C on every retail state)
//   +0x04  u32 -> depth-stencil block  (0x48)
//   +0x08  u32 -> rasterizer block     (0x88)
//
// Blend block:
//   +0x00  u32[8]  one packed word per render target:
//                    bit 0 BlendEnable, bits 1-5 SrcBlend, 6-10 DestBlend,
//                    11-13 BlendOp, 14-18 SrcBlendAlpha, 19-23 DestBlendAlpha,
//                    24-26 BlendOpAlpha, 27-30 RenderTargetWriteMask
//                  (D3D11_BLEND / D3D11_BLEND_OP values)
//   +0x20  f32[4]  blend factor
//   +0x30  u8      AlphaToCoverageEnable
//   +0x31  u8      IndependentBlendEnable
// Depth-stencil block:
//   +0x00  u32     DepthFunc (D3D11_COMPARISON_FUNC)
//   +0x04  u32[4]  front-face stencil {fail, depth-fail, pass, func}
//   +0x14  u32[4]  back-face stencil
//   +0x30  u8      DepthEnable
//   +0x31  u8      DepthWriteMask (0 = zero, 1 = all)
//   +0x32  u8      StencilEnable
// Rasterizer block:
//   +0x00  u32     FillMode (2 wireframe, 3 solid)
//   +0x04  u32     CullMode (1 none, 2 front, 3 back)
//   +0x08  u32     FrontCounterClockwise
//   +0x0C  i32     DepthBias
//   +0x14  f32     SlopeScaledDepthBias
// Bytes the engine never initialises (the tail of the bool words) carry
// leftover memory and vary between otherwise identical states; they are not
// read.
//
// Alpha test: the game's PC renderer has no fixed-function alpha test. Cut-out
// materials (the `1Bit` shaders, liveries, decals) set AlphaToCoverage instead,
// and their pixel shaders discard what is left below the `sampleCoverage`
// threshold themselves.

export const MATERIAL_STATE_TYPE_ID = 0xF;

/** D3D11_BLEND */
export const D3DBlend = {
	ZERO: 1, ONE: 2, SRC_COLOR: 3, INV_SRC_COLOR: 4, SRC_ALPHA: 5, INV_SRC_ALPHA: 6,
	DEST_ALPHA: 7, INV_DEST_ALPHA: 8, DEST_COLOR: 9, INV_DEST_COLOR: 10, SRC_ALPHA_SAT: 11,
	BLEND_FACTOR: 14, INV_BLEND_FACTOR: 15,
} as const;

/** D3D11_BLEND_OP */
export const D3DBlendOp = { ADD: 1, SUBTRACT: 2, REV_SUBTRACT: 3, MIN: 4, MAX: 5 } as const;

/** D3D11_CULL_MODE */
export const D3DCull = { NONE: 1, FRONT: 2, BACK: 3 } as const;

/** D3D11_COMPARISON_FUNC */
export const D3DComparison = {
	NEVER: 1, LESS: 2, EQUAL: 3, LESS_EQUAL: 4, GREATER: 5, NOT_EQUAL: 6, GREATER_EQUAL: 7, ALWAYS: 8,
} as const;

export type RenderTargetBlend = {
	blendEnable: boolean;
	srcBlend: number;
	destBlend: number;
	blendOp: number;
	srcBlendAlpha: number;
	destBlendAlpha: number;
	blendOpAlpha: number;
	/** RGBA write bits (1 = R ... 8 = A). */
	writeMask: number;
};

export type MaterialState = {
	blend: {
		renderTargets: RenderTargetBlend[];
		blendFactor: [number, number, number, number];
		alphaToCoverage: boolean;
		independentBlend: boolean;
	};
	depthStencil: {
		depthEnable: boolean;
		depthWrite: boolean;
		depthFunc: number;
		stencilEnable: boolean;
	};
	rasterizer: {
		fillMode: number;
		cullMode: number;
		frontCounterClockwise: boolean;
		depthBias: number;
		slopeScaledDepthBias: number;
	};
};

export const MATERIAL_STATE_SIZE = 0xC0;
const BLEND_SIZE = 0x34, DEPTH_SIZE = 0x34, RASTER_SIZE = 0x18;

export function unpackRenderTargetBlend(word: number): RenderTargetBlend {
	const bits = (shift: number, n: number) => (word >>> shift) & ((1 << n) - 1);
	return {
		blendEnable: bits(0, 1) === 1,
		srcBlend: bits(1, 5),
		destBlend: bits(6, 5),
		blendOp: bits(11, 3),
		srcBlendAlpha: bits(14, 5),
		destBlendAlpha: bits(19, 5),
		blendOpAlpha: bits(24, 3),
		writeMask: bits(27, 4),
	};
}

export function parseMaterialState(raw: Uint8Array): MaterialState {
	const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
	if (raw.byteLength < 0x0C) throw new Error(`MaterialState too small (${raw.byteLength} bytes)`);
	const block = (at: number, size: number, what: string) => {
		const off = dv.getUint32(at, true);
		if (off < 0x0C || off + size > raw.byteLength) throw new Error(`MaterialState ${what} block at 0x${off.toString(16)} is outside the resource`);
		return off;
	};
	const b = block(0x00, BLEND_SIZE, 'blend');
	const d = block(0x04, DEPTH_SIZE, 'depth-stencil');
	const r = block(0x08, RASTER_SIZE, 'rasterizer');
	const u32 = (o: number) => dv.getUint32(o, true);
	const f32 = (o: number) => dv.getFloat32(o, true);
	return {
		blend: {
			renderTargets: Array.from({ length: 8 }, (_, i) => unpackRenderTargetBlend(u32(b + 4 * i))),
			blendFactor: [f32(b + 0x20), f32(b + 0x24), f32(b + 0x28), f32(b + 0x2C)],
			alphaToCoverage: raw[b + 0x30] !== 0,
			independentBlend: raw[b + 0x31] !== 0,
		},
		depthStencil: {
			depthFunc: u32(d),
			depthEnable: raw[d + 0x30] !== 0,
			depthWrite: raw[d + 0x31] !== 0,
			stencilEnable: raw[d + 0x32] !== 0,
		},
		rasterizer: {
			fillMode: u32(r),
			cullMode: u32(r + 0x04),
			frontCounterClockwise: u32(r + 0x08) !== 0,
			depthBias: dv.getInt32(r + 0x0C, true),
			slopeScaledDepthBias: f32(r + 0x14),
		},
	};
}

/** The engine routes a technique to the transparent mesh list, drawn after
 *  every opaque one, when its first render target blends. */
export const isBlended = (s: MaterialState) => s.blend.renderTargets[0].blendEnable;
