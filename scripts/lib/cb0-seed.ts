// cb0 seeding — port of `inferCbLayout` + `seedDefaults` + `__updateCb0`
// from `src/pages/ShaderPage.tsx` and `src/lib/core/translatedShaderMaterial.ts`,
// distilled into a single function for the differential harness.
//
// Order of operations matters:
//   1. seedDefaults(vsParsed)  — material/heuristic constants by RDEF name.
//   2. seedDefaults(psParsed)  — same, in case PS has constants VS doesn't.
//   3. writeEngineSlots()      — identity world / vp / view-row-2 / depth
//                                encoder. Engine wins on slot collisions.
//
// Without (1) and (2) the harness diff is uninteresting because most
// shaders compute `albedo * 0 = 0` for their final color.

import type { ParsedDxbc } from '../../src/lib/core/dxbc/parser';
import type { ParsedShaderConstant } from '../../src/lib/core/shader';
import { ENGINE_CONSTANT_DEFAULTS, seedSkinningPalettes, type CbLayout } from '../../src/lib/core/shaderEngineConstants';

export type { CbLayout };

// Re-export the shared engine-constant defaults so existing harness callers
// keep importing HEURISTIC_DEFAULTS from here.
export const HEURISTIC_DEFAULTS = ENGINE_CONSTANT_DEFAULTS;

export function inferCbLayoutFromParsed(parsed: ParsedDxbc): CbLayout {
	const slot = (n: string): number | null => {
		for (const cb of parsed.reflection.constantBuffers)
			for (const v of cb.variables) if (v.name === n) return Math.floor(v.startOffset / 16);
		return null;
	};
	const vp = slot('ViewProjectionModified') ?? 5;
	return {
		worldRow0: slot('world') ?? 44,
		vpRow0: vp,
		viewRow2: vp + 2,
		depthEncode: vp + 3,
		cameraPos: slot('ViewPosition'),
		worldViewProjRow0: slot('worldViewProj'),
		viewProjectionRow0: slot('viewProjection'),
	};
}

function writeScalars(f32: Float32Array, slot: number, comp: number, src: ArrayLike<number>, n: number) {
	const base = slot * 4 + comp;
	for (let i = 0; i < n; i++) {
		if (comp + i < 4) f32[base + i] = src[i] ?? 0;
	}
}

function seedDefaults(
	f32: Float32Array,
	parsed: ParsedDxbc,
	shaderConstants: readonly ParsedShaderConstant[],
	maxSlots: number,
) {
	for (const cb of parsed.reflection.constantBuffers) {
		for (const v of cb.variables) {
			const slot = Math.floor(v.startOffset / 16);
			if (slot >= maxSlots) continue;
			const comp = (v.startOffset % 16) / 4;
			const nFloats = Math.max(1, Math.min(4 - comp, Math.floor(v.size / 4)));
			const baked = shaderConstants.find((c) => c.name === v.name && c.instanceData);
			if (baked?.instanceData) {
				writeScalars(f32, slot, comp, baked.instanceData, nFloats);
				continue;
			}
			const hd = HEURISTIC_DEFAULTS[v.name];
			if (hd) writeScalars(f32, slot, comp, hd, nFloats);
		}
	}
}

/**
 * Build a 4 KiB cb0 (256 vec4 slots) seeded with:
 *   - Per-shader baked constants joined by RDEF variable name.
 *   - HEURISTIC_DEFAULTS for runtime-bound vars (key light, fog, etc.).
 *   - Identity world / view·proj rows + depth encoder + zero camera, on
 *     top, so the engine slots win even if a material constant collides.
 */
export function seedCb0(
	vsParsed: ParsedDxbc,
	psParsed: ParsedDxbc,
	shaderConstants: readonly ParsedShaderConstant[],
	layout: CbLayout,
): Uint8Array {
	const SLOTS = 256;
	const f32 = new Float32Array(SLOTS * 4);

	// 1+2. Material + heuristic defaults from both stages.
	seedDefaults(f32, vsParsed, shaderConstants, SLOTS);
	seedDefaults(f32, psParsed, shaderConstants, SLOTS);

	// Identity-fill the bone-matrix palette (skinned vehicle meshes).
	const writeVec4 = (slot: number, x: number, y: number, z: number, w: number) => {
		if (slot < 0 || slot >= SLOTS) return;
		const o = slot * 4;
		f32[o] = x; f32[o + 1] = y; f32[o + 2] = z; f32[o + 3] = w;
	};
	seedSkinningPalettes(vsParsed, writeVec4);
	seedSkinningPalettes(psParsed, writeVec4);

	// 3. Engine slots overlaid last.
	const wr = (s: number, x: number, y: number, z: number, w: number) => {
		if (s < 0 || s >= SLOTS) return;
		const o = s * 4;
		f32[o + 0] = x; f32[o + 1] = y; f32[o + 2] = z; f32[o + 3] = w;
	};
	wr(layout.worldRow0 + 0, 1, 0, 0, 0);
	wr(layout.worldRow0 + 1, 0, 1, 0, 0);
	wr(layout.worldRow0 + 2, 0, 0, 1, 0);
	wr(layout.worldRow0 + 3, 0, 0, 0, 1);
	wr(layout.vpRow0 + 0, 1, 0, 0, 0);
	wr(layout.vpRow0 + 1, 0, 1, 0, 0);
	wr(layout.viewRow2, 0, 0, 1, 0);
	wr(layout.depthEncode, 0, 0.5, 0, 1);
	if (layout.cameraPos != null) wr(layout.cameraPos, 0, 0, 0, 1);
	// Full 4-row engine matrices (identity here, like world/vp above).
	for (const base of [layout.viewProjectionRow0, layout.worldViewProjRow0]) {
		if (base == null) continue;
		wr(base + 0, 1, 0, 0, 0);
		wr(base + 1, 0, 1, 0, 0);
		wr(base + 2, 0, 0, 1, 0);
		wr(base + 3, 0, 0, 0, 1);
	}

	return new Uint8Array(f32.buffer);
}
