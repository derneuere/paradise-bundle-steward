// Cross-bundle Material → per-channel texture binding.
//
// When a vehicle (or any) bundle is loaded that ships Materials referencing
// the currently-previewed Shader, we can drive the ShaderMaterial sampler
// binding from the Material's authored TextureState chain instead of
// name-matching. Result: pixel-correct sampler bindings, exactly what the
// game would put there at draw time.
//
// Resolution chain (handled here):
//
//   Material (type 0x01)
//     ├─ shaderImport.id  → which shader this material draws with
//     ├─ Sampler[]        → channel (= shader register slot) + TextureState ptr
//     └─ textureStateImports[] → resolves Sampler ptrs to TextureState ids
//
//   TextureState (type 0x0E)
//     └─ textureId        → the Texture resource we want
//
//   Texture (type 0x00)   → already in `TextureCatalogEntry`
//
// The Material's Sampler array (in block 0) gives us channel→ptrOffset; we
// match ptrOffset to the textureStateImports list to find the actual
// TextureState resource id, decode that to find the Texture id, then look
// up the Texture in the catalogue. The pickTextureForSampler matcher is
// only consulted as a fallback when no material binds a given register.

import type { ParsedBundle, ResourceEntry } from './types';
import { MATERIAL_TYPE_ID, parseMaterialData, type ParsedMaterial } from './material';
import { TEXTURE_STATE_TYPE_ID, decodeTextureState } from './textureState';
import { getResourceBlocks } from './resourceManager';
import { formatResourceId } from './bundle';
import { u64ToBigInt } from './u64';
import type { DebugResource } from './bundle/debugData';
import { findDebugResourceById } from './bundle/debugData';
import type { TextureCatalogEntry } from './textureCatalog';

type Source = {
	source: string;
	bundle: ParsedBundle;
	arrayBuffer: ArrayBuffer;
	debug: DebugResource[];
};

export type MaterialBinding = {
	/** Source bundle the Material came from. */
	source: string;
	/** u64 resource id formatted as 8-char lowercase hex. */
	materialId: string;
	/** Best-effort debug name. */
	materialName: string;
	/** u64 of the Shader resource this material targets. */
	shaderId: string;
	/** Per shader-register-slot binding. Key = `tN` register number, value =
	 *  the catalogue entry the engine would bind at that slot. */
	samplerBindings: Map<number, TextureCatalogEntry>;
};

/**
 * Walk every loaded bundle for Material resources, parse each, resolve its
 * sampler→TextureState→Texture chain through cross-bundle lookups, and
 * group the results by target Shader id.
 *
 * Returns `Map<shaderId(hex), MaterialBinding[]>` so a shader preview can
 * grab any binding that targets the currently-selected shader.
 *
 * Best-effort: TextureStates whose target Texture isn't in the catalogue
 * (lives in an unloaded bundle, or uses an unsupported resource layout)
 * are silently dropped from the binding. The samplerBindings map only
 * contains channels we successfully resolved end-to-end.
 */
export function buildMaterialIndex(
	sources: Source[],
	textureCatalog: TextureCatalogEntry[],
): Map<string, MaterialBinding[]> {
	const catalogById = new Map(textureCatalog.map((e) => [e.id, e]));
	const index = new Map<string, MaterialBinding[]>();

	for (const s of sources) {
		for (const r of s.bundle.resources) {
			if (r.resourceTypeId !== MATERIAL_TYPE_ID) continue;
			const matId = formatResourceId(u64ToBigInt(r.resourceId));
			const blocks = getResourceBlocks(s.arrayBuffer, s.bundle, r as ResourceEntry);
			const block0 = blocks[0];
			if (!block0) continue;
			let parsed: ParsedMaterial;
			try {
				parsed = parseMaterialData(block0);
			} catch { continue; }
			const shaderId = formatResourceId(parsed.shaderImport.id);
			const samplers = parseSamplerArray(block0);
			const samplerBindings = new Map<number, TextureCatalogEntry>();

			if (samplers && samplers.length > 0) {
				// Sampler array gives explicit channel → TextureState ptr.
				// Match ptrOffset to a textureStateImport, then resolve.
				for (const samp of samplers) {
					const tsImport = parsed.textureStateImports.find((ti) => ti.ptrOffset === samp.stateImportOffset);
					if (!tsImport) continue;
					const tex = resolveTextureViaState(tsImport.id, sources, catalogById);
					if (tex) samplerBindings.set(samp.channel, tex);
				}
			} else {
				// Fallback: no Sampler array (or unparseable). Bind in import
				// order as channels 0, 1, 2, … This is what materialChain.ts
				// does for materials without a parseable sampler header.
				for (let i = 0; i < parsed.textureStateImports.length; i++) {
					const ti = parsed.textureStateImports[i];
					const tex = resolveTextureViaState(ti.id, sources, catalogById);
					if (tex) samplerBindings.set(i, tex);
				}
			}

			if (samplerBindings.size === 0) continue;

			const dbg = findDebugResourceById(s.debug, matId);
			const materialName = dbg?.name ?? `material_${matId}`;
			const arr = index.get(shaderId) ?? [];
			arr.push({
				source: s.source,
				materialId: matId,
				materialName,
				shaderId,
				samplerBindings,
			});
			index.set(shaderId, arr);
		}
	}
	return index;
}

/**
 * Pick the Material whose bindings cover the most of the given sampler
 * registers. When multiple Materials target the same shader (e.g. several
 * vehicle bodies all using PaintGloss) the one with the richest binding
 * wins; that's usually the one closest to a reference asset.
 *
 * Returns null when no Material targets the shader.
 */
export function pickBestMaterial(
	shaderId: string,
	wantedRegisters: number[],
	index: Map<string, MaterialBinding[]>,
): MaterialBinding | null {
	const candidates = index.get(shaderId);
	if (!candidates || candidates.length === 0) return null;
	let best = candidates[0];
	let bestScore = countCoverage(best, wantedRegisters);
	for (let i = 1; i < candidates.length; i++) {
		const c = candidates[i];
		const s = countCoverage(c, wantedRegisters);
		if (s > bestScore) { best = c; bestScore = s; }
	}
	return best;
}

function countCoverage(b: MaterialBinding, regs: number[]): number {
	let n = 0;
	for (const r of regs) if (b.samplerBindings.has(r)) n++;
	return n;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/** Decoded info from one CgsGraphics::Sampler entry (PC 32-bit layout).
 *  Lifted from materialChain.ts:120 — same struct, different consumer. */
type SamplerInfo = { channel: number; stateImportOffset: number };

const SAMPLER_SIZE_32 = 0x14;

function parseSamplerArray(block0: Uint8Array): SamplerInfo[] | null {
	if (block0.byteLength < 0x10) return null;
	const dv = new DataView(block0.buffer, block0.byteOffset, block0.byteLength);
	const numSamplers = dv.getInt8(0x09);
	if (numSamplers <= 0 || numSamplers > 16) return null;
	const samplersPtr = dv.getUint32(0x0C, true);
	if (samplersPtr === 0 || samplersPtr >= block0.byteLength) return null;
	if (samplersPtr + numSamplers * SAMPLER_SIZE_32 > block0.byteLength) return null;

	const out: SamplerInfo[] = [];
	for (let i = 0; i < numSamplers; i++) {
		const base = samplersPtr + i * SAMPLER_SIZE_32;
		out.push({
			channel: dv.getInt16(base + 0x08, true),
			stateImportOffset: base + 0x10,
		});
	}
	return out;
}

/**
 * Find a TextureState resource by id across all loaded sources, decode it
 * to get the underlying Texture id, then look that up in the catalogue.
 * Returns null when any link in the chain isn't present.
 */
function resolveTextureViaState(
	textureStateId: bigint,
	sources: Source[],
	catalogById: Map<string, TextureCatalogEntry>,
): TextureCatalogEntry | null {
	for (const s of sources) {
		for (const r of s.bundle.resources) {
			if (r.resourceTypeId !== TEXTURE_STATE_TYPE_ID) continue;
			if (u64ToBigInt(r.resourceId) !== textureStateId) continue;
			let texId: bigint | null;
			try {
				const ts = decodeTextureState(s.arrayBuffer, s.bundle, r as ResourceEntry);
				texId = ts.textureId;
			} catch { return null; }
			if (texId == null) return null;
			return catalogById.get(formatResourceId(texId)) ?? null;
		}
	}
	return null;
}
