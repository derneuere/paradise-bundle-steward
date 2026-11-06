// A Material technique's MaterialState (blend, depth, cull) applied to a
// three.js material, for both the textured stand-ins and the translated game
// shaders.
//
// Winding: the engine draws with FrontCounterClockwise set, and the retail
// meshes are wound counter-clockwise around their authored normals, so the
// engine's "cull back" keeps exactly the faces three.js calls front faces:
// D3D11 CULL_BACK -> THREE.FrontSide (not BackSide), CULL_NONE -> DoubleSide.
//
// Order: the engine sends a blended technique to the car's transparent mesh
// list, drawn after every opaque mesh; three.js gives `transparent` materials
// the same treatment (after opaque, back to front).

import * as THREE from 'three';
import {
	D3DBlend, D3DBlendOp, D3DComparison, D3DCull, isBlended,
	type MaterialState, type RenderTargetBlend,
} from './materialState';

export function sideForRasterizer(r: MaterialState['rasterizer']): THREE.Side {
	if (r.cullMode === D3DCull.NONE) return THREE.DoubleSide;
	const cullsClockwise = (r.cullMode === D3DCull.BACK) === r.frontCounterClockwise;
	return cullsClockwise ? THREE.FrontSide : THREE.BackSide;
}

const BLEND_FACTOR: Record<number, THREE.BlendingDstFactor> = {
	[D3DBlend.ZERO]: THREE.ZeroFactor,
	[D3DBlend.ONE]: THREE.OneFactor,
	[D3DBlend.SRC_COLOR]: THREE.SrcColorFactor,
	[D3DBlend.INV_SRC_COLOR]: THREE.OneMinusSrcColorFactor,
	[D3DBlend.SRC_ALPHA]: THREE.SrcAlphaFactor,
	[D3DBlend.INV_SRC_ALPHA]: THREE.OneMinusSrcAlphaFactor,
	[D3DBlend.DEST_ALPHA]: THREE.DstAlphaFactor,
	[D3DBlend.INV_DEST_ALPHA]: THREE.OneMinusDstAlphaFactor,
	[D3DBlend.DEST_COLOR]: THREE.DstColorFactor,
	[D3DBlend.INV_DEST_COLOR]: THREE.OneMinusDstColorFactor,
	[D3DBlend.BLEND_FACTOR]: THREE.ConstantColorFactor,
	[D3DBlend.INV_BLEND_FACTOR]: THREE.OneMinusConstantColorFactor,
};

// Only valid as a source factor.
const SRC_ONLY_FACTOR: Record<number, THREE.BlendingSrcFactor> = { [D3DBlend.SRC_ALPHA_SAT]: THREE.SrcAlphaSaturateFactor };

const BLEND_OP: Record<number, THREE.BlendingEquation> = {
	[D3DBlendOp.ADD]: THREE.AddEquation,
	[D3DBlendOp.SUBTRACT]: THREE.SubtractEquation,
	[D3DBlendOp.REV_SUBTRACT]: THREE.ReverseSubtractEquation,
	[D3DBlendOp.MIN]: THREE.MinEquation,
	[D3DBlendOp.MAX]: THREE.MaxEquation,
};

const DEPTH_FUNC: Record<number, THREE.DepthModes> = {
	[D3DComparison.NEVER]: THREE.NeverDepth,
	[D3DComparison.LESS]: THREE.LessDepth,
	[D3DComparison.EQUAL]: THREE.EqualDepth,
	[D3DComparison.LESS_EQUAL]: THREE.LessEqualDepth,
	[D3DComparison.GREATER]: THREE.GreaterDepth,
	[D3DComparison.NOT_EQUAL]: THREE.NotEqualDepth,
	[D3DComparison.GREATER_EQUAL]: THREE.GreaterEqualDepth,
	[D3DComparison.ALWAYS]: THREE.AlwaysDepth,
};

/** Does the draw need the shader's real alpha (blending or alpha-to-coverage)? */
export const usesAlpha = (s: MaterialState | null | undefined) =>
	!!s && (isBlended(s) || s.blend.alphaToCoverage);

function applyBlend(mat: THREE.Material, rt: RenderTargetBlend) {
	mat.blending = THREE.CustomBlending;
	mat.blendSrc = SRC_ONLY_FACTOR[rt.srcBlend] ?? BLEND_FACTOR[rt.srcBlend] ?? THREE.SrcAlphaFactor;
	mat.blendDst = BLEND_FACTOR[rt.destBlend] ?? THREE.OneMinusSrcAlphaFactor;
	mat.blendEquation = BLEND_OP[rt.blendOp] ?? THREE.AddEquation;
	// The canvas alpha is the page's compositing alpha, not the game's back
	// buffer alpha (which nothing reads): accumulate it the way three's normal
	// blending does so a pane over an opaque background keeps the canvas opaque.
	mat.blendSrcAlpha = THREE.OneFactor;
	mat.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
	mat.blendEquationAlpha = THREE.AddEquation;
}

/** Apply the technique's state; a missing state leaves the material as built. */
export function applyMaterialState(mat: THREE.Material, state: MaterialState | null | undefined): void {
	if (!state) return;
	const rt0 = state.blend.renderTargets[0];
	mat.transparent = isBlended(state);
	// three skips blending only for NormalBlending + opaque.
	if (mat.transparent) applyBlend(mat, rt0);
	else mat.blending = THREE.NormalBlending;
	mat.alphaToCoverage = state.blend.alphaToCoverage;
	// The write mask is left alone: the Z-only techniques' states have it at 0,
	// and some 1Bit materials share that same state with their colour technique,
	// which the game evidently still draws.
	mat.depthTest = state.depthStencil.depthEnable;
	mat.depthWrite = state.depthStencil.depthWrite;
	mat.depthFunc = DEPTH_FUNC[state.depthStencil.depthFunc] ?? THREE.LessEqualDepth;
	mat.side = sideForRasterizer(state.rasterizer);
}
