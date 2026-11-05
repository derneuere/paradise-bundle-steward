// Texture sampling for the DXBC -> GLSL emitter: the sample_* family, the
// sampler uniform declarations and the depth-compare helper.
//
// - The resource operand's swizzle applies to the fetched texel before the
//   destination mask (`sample r0.xy, v0, t0.ywxz, s0` writes r0.x = t.y,
//   r0.y = t.w). The game's DXT5 normal maps keep the normal in G and A, so
//   dropping it reads the wrong channels.
// - Cube maps (dcl_resource texturecube: the vehicle reflection probe) become
//   `samplerCube` sampled with a 3D direction. D3D and GL use the same cube
//   face orientation, so the direction passes through unchanged.
// - sample_c / sample_c_lz compare a reference against the texel (shadow
//   maps). GLSL's shadow samplers need a depth texture bound, which the
//   preview never has, so the compare runs on the plain texel's red channel
//   with the sampler's D3D11 comparison function (see DX_COMPARE).

import type { DxbcInstruction } from './ops';
import { idxVal, readExpr, swizzleToStr, writeDest, type EmitCtx, type ResourceKind } from './glslOperands';

/** dcl_resource dimension (D3D10_SB_RESOURCE_DIMENSION) of a cube texture. */
export const DCL_RESOURCE_DIM_CUBE = 6;
/** RDEF binding dimension (D3D_SRV_DIMENSION) of a cube texture. */
export const RDEF_SRV_DIM_CUBE = 9;

export const SAMPLE_OPS = new Set(['sample', 'sample_l', 'sample_b', 'sample_d', 'sample_c', 'sample_c_lz']);
const COMPARE_OPS = new Set(['sample_c', 'sample_c_lz']);

export function samplerType(kind: ResourceKind | undefined): string {
	return kind === 'Cube' ? 'samplerCube' : 'sampler2D';
}

/** Uniform holding a comparison sampler's D3D11_COMPARISON_FUNC. */
export function compareFuncUniform(samplerReg: number): string {
	return `_cmpFunc_s${samplerReg}`;
}

// D3D11_COMPARISON_FUNC: NEVER=1 LESS=2 EQUAL=3 LESS_EQUAL=4 GREATER=5
// NOT_EQUAL=6 GREATER_EQUAL=7 ALWAYS=8, "ref OP texel". An unset uniform
// reads 0 and falls to LESS_EQUAL, the usual shadow-map test. The reference
// is clamped to [0, 1] as D3D does for UNORM depth formats, so a white
// stand-in shadow map (texel 1.0) always passes: fully lit.
const DX_COMPARE = `float _dxCompare(float ref, float texel, int func) {
	ref = clamp(ref, 0.0, 1.0);
	if (func == 1) return 0.0;
	if (func == 2) return ref < texel ? 1.0 : 0.0;
	if (func == 3) return ref == texel ? 1.0 : 0.0;
	if (func == 5) return ref > texel ? 1.0 : 0.0;
	if (func == 6) return ref != texel ? 1.0 : 0.0;
	if (func == 7) return ref >= texel ? 1.0 : 0.0;
	if (func == 8) return 1.0;
	return ref <= texel ? 1.0 : 0.0;
}`;

/** Header lines for the sampled textures and, when the body compares, the
 *  compare helper plus one comparison-function uniform per sampler used. */
export function samplerDeclarations(ctx: EmitCtx, body: readonly DxbcInstruction[]): string[] {
	const lines: string[] = [];
	for (const regStr of Object.keys(ctx.resources)) {
		const reg = Number(regStr);
		lines.push(`uniform ${samplerType(ctx.resourceKinds[reg])} ${ctx.resources[reg]}; // t${reg}`);
	}
	const compareSamplers = new Set<number>();
	for (const ins of body) {
		if (COMPARE_OPS.has(ins.name) && ins.operands[3]) compareSamplers.add(idxVal(ins.operands[3], 0));
	}
	for (const s of compareSamplers) lines.push(`uniform int ${compareFuncUniform(s)}; // s${s} D3D11_COMPARISON_FUNC, 0 = LESS_EQUAL`);
	if (compareSamplers.size > 0) lines.push(DX_COMPARE);
	return lines;
}

// sample      dst, coord, t, s
// sample_b    dst, coord, t, s, bias
// sample_l    dst, coord, t, s, lod
// sample_d    dst, coord, t, s, ddx, ddy
// sample_c    dst, coord, t, s, ref
// sample_c_lz dst, coord, t, s, ref        (mip 0)
export function emitSample(ins: DxbcInstruction, ctx: EmitCtx): string {
	const ops = ins.operands;
	const tOp = ops[2];
	const reg = idxVal(tOp, 0);
	const tex = ctx.resources[reg] ?? `_t${reg}`;
	const cube = ctx.resourceKinds[reg] === 'Cube';
	const coordSel = cube ? 'xyz' : 'xy';
	const vec = (i: number, sel: string) => `vec4(${readExpr(ops[i], ctx)}).${sel}`;
	const coord = vec(1, coordSel);
	// Texel offsets exist for non-cube textures only (as in D3D).
	const off = ins.texelOffset && !cube ? `ivec2(${ins.texelOffset[0]}, ${ins.texelOffset[1]})` : null;

	let fetch: string;
	switch (ins.name) {
		case 'sample_b': {
			const bias = vec(4, 'x');
			fetch = off ? `textureOffset(${tex}, ${coord}, ${off}, ${bias})` : `texture(${tex}, ${coord}, ${bias})`;
			break;
		}
		case 'sample_l': {
			const lod = vec(4, 'x');
			fetch = off ? `textureLodOffset(${tex}, ${coord}, ${lod}, ${off})` : `textureLod(${tex}, ${coord}, ${lod})`;
			break;
		}
		case 'sample_d': {
			const dx = vec(4, coordSel), dy = vec(5, coordSel);
			fetch = off ? `textureGradOffset(${tex}, ${coord}, ${dx}, ${dy}, ${off})` : `textureGrad(${tex}, ${coord}, ${dx}, ${dy})`;
			break;
		}
		case 'sample_c_lz':
			fetch = off ? `textureLodOffset(${tex}, ${coord}, 0.0, ${off})` : `textureLod(${tex}, ${coord}, 0.0)`;
			break;
		default:
			fetch = off ? `textureOffset(${tex}, ${coord}, ${off})` : `texture(${tex}, ${coord})`;
	}

	if (COMPARE_OPS.has(ins.name)) {
		const s = idxVal(ops[3], 0);
		fetch = `vec4(_dxCompare(${vec(4, 'x')}, ${fetch}.x, ${compareFuncUniform(s)}))`;
	}
	const swizzle = tOp.selectionMode === 1 ? swizzleToStr(tOp.swizzle) : 'xyzw';
	return writeDest(ops[0], `${fetch}.${swizzle}`, ctx);
}
