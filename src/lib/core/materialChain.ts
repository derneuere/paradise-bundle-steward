// Material → TextureState → Texture chain resolver.
//
// Walks the import chain of a Material resource (type 0x1) to find and decode
// the textures it references, following the same approach as BundleManager's
// MaterialEntry.cs: iterate all dependencies, filter to TextureState (0xE),
// and assign positionally — [0]=diffuse, [1]=normal, [2]=specular.
//
// Neither Volatility nor BundleManager parses the Material header struct; both
// rely purely on the import chain. We do the same.
//
// IMPORTANT: Vehicle GR bundles typically contain geometry and material
// references, but the actual texture pixel data lives in companion bundles
// (e.g. GLOBALBACKDROPS, WORLDTEX). When a TextureState references a Texture
// that isn't in the loaded bundle, that slot resolves to null and the mesh
// falls back to the flat placeholder material. Multi-bundle loading is needed
// to fully resolve textures for most assets.

import type { ParsedBundle, ResourceEntry } from './types';
import { findResourceById } from './renderable';
import { getImportsByPtrOffset } from './bundle';
import { getResourceBlocks } from './resourceManager';
import { u64ToBigInt } from './u64';
import { TEXTURE_STATE_TYPE_ID, decodeTextureState, type ParsedTextureState } from './textureState';
import { TEXTURE_TYPE_ID, decodeTexture, type DecodedTexture } from './texture';

const MATERIAL_STATE_TYPE_ID = 0xF;

// =============================================================================
// Types
// =============================================================================

/** Parsed blend/cull/alpha properties from the first MaterialState import. */
export type MaterialProperties = {
	/** Alpha blending enabled (glass, decals). */
	alphaBlendEnable: boolean;
	/** Alpha test enabled (cutout foliage etc.). */
	alphaTestEnable: boolean;
	/** Alpha test reference value 0–255 (compare threshold). */
	alphaRef: number;
	/** D3DCULL: 1=none, 2=CW, 3=CCW. */
	cullMode: number;
};

export type ResolvedMaterial = {
	materialId: bigint;
	/** Diffuse texture (TextureStates[0]). */
	diffuse: DecodedTexture | null;
	/** Normal map (TextureStates[1]). */
	normal: DecodedTexture | null;
	/** Specular map (TextureStates[2]). */
	specular: DecodedTexture | null;
	/** Sampler state from the first TextureState (for wrapping/filtering). */
	samplerState: Pick<ParsedTextureState, 'addressU' | 'addressV'> | null;
	/** Blend/cull/alpha properties from MaterialState. */
	properties: MaterialProperties | null;
	/** Whether the diffuse texture was resolved from a secondary bundle
	 *  (e.g. VEHICLETEX) rather than the primary bundle. Materials with
	 *  secondary-source diffuse are typically body/paint and should receive
	 *  the vehicle color tint. */
	diffuseFromSecondary: boolean;
	/** Number of texture slots that couldn't resolve because the Texture
	 *  resource lives in a different bundle. */
	crossBundleMisses: number;
};

// =============================================================================
// Resolver
// =============================================================================

/**
 * Resolve a Material resource's textures by walking its import chain.
 *
 * Steps:
 *   1. Find the Material ResourceEntry by ID.
 *   2. Read the Material's import table from the bundle's flat import array.
 *   3. For each import whose target is a TextureState (0xE), decode it to get
 *      the referenced Texture ID.
 *   4. Decode each Texture (checking cache first).
 *   5. Assign positionally: [0]=diffuse, [1]=normal, [2]=specular.
 *
 * Returns null if the Material resource can't be found.
 */
/** A loaded secondary bundle used purely as a texture source. */
export type TextureSourceBundle = {
	buffer: ArrayBuffer;
	bundle: ParsedBundle;
};

export function resolveMaterialTextures(
	buffer: ArrayBuffer,
	bundle: ParsedBundle,
	materialId: bigint,
	textureCache: Map<bigint, DecodedTexture | null>,
	secondarySources: TextureSourceBundle[] = [],
): ResolvedMaterial | null {
	const materialEntry = findResourceById(bundle, materialId);
	if (!materialEntry) return null;

	const resourceIndex = bundle.resources.indexOf(materialEntry);
	if (resourceIndex < 0) return null;
	const imports = getImportsByPtrOffset(bundle.imports, bundle.resources, resourceIndex);

	// Collect TextureState imports in ascending ptrOffset order to match the
	// positional convention used by BundleManager's MaterialEntry.cs.
	const importEntries = Array.from(imports.entries())
		.sort(([a], [b]) => a - b);

	const textureStates: { state: ParsedTextureState; textureId: bigint | null }[] = [];
	let properties: MaterialProperties | null = null;

	for (const [, targetId] of importEntries) {
		const targetResource = findResourceById(bundle, targetId);
		if (!targetResource) continue;

		// Parse first MaterialState (type 0xF) for blend/cull properties.
		if (targetResource.resourceTypeId === MATERIAL_STATE_TYPE_ID && !properties) {
			try {
				properties = parseMaterialStateProperties(buffer, bundle, targetResource);
			} catch { /* skip */ }
			continue;
		}

		if (targetResource.resourceTypeId !== TEXTURE_STATE_TYPE_ID) continue;

		try {
			const tsState = decodeTextureState(buffer, bundle, targetResource);
			textureStates.push({ state: tsState, textureId: tsState.textureId });
		} catch {
			textureStates.push({ state: null as unknown as ParsedTextureState, textureId: null });
		}
	}

	let crossBundleMisses = 0;
	const secondaryTexIds = new Set<bigint>();

	const decodeSlot = (index: number): DecodedTexture | null => {
		if (index >= textureStates.length) return null;
		const { textureId } = textureStates[index];
		if (!textureId) return null;

		if (textureCache.has(textureId)) {
			return textureCache.get(textureId) ?? null;
		}

		// Search primary bundle first, then secondary texture sources.
		const texResource = findResourceById(bundle, textureId);
		if (texResource && texResource.resourceTypeId === TEXTURE_TYPE_ID) {
			try {
				const decoded = decodeTexture(buffer, bundle, texResource);
				textureCache.set(textureId, decoded);
				return decoded;
			} catch (err) {
				console.warn(`Failed to decode texture ${textureId.toString(16)}:`, err);
				textureCache.set(textureId, null);
				return null;
			}
		}

		// Search secondary bundles (e.g. VEHICLETEX.BIN).
		for (const src of secondarySources) {
			const secResource = findResourceById(src.bundle, textureId);
			if (secResource && secResource.resourceTypeId === TEXTURE_TYPE_ID) {
				try {
					const decoded = decodeTexture(src.buffer, src.bundle, secResource);
					textureCache.set(textureId, decoded);
					secondaryTexIds.add(textureId);
					return decoded;
				} catch (err) {
					console.warn(`Failed to decode texture ${textureId.toString(16)} from secondary:`, err);
				}
			}
		}

		crossBundleMisses++;
		textureCache.set(textureId, null);
		return null;
	};

	// Assign textures positionally: [0]=diffuse, [1]=normal, [2]=specular.
	// This matches the C# BundleManager's MaterialEntry.cs approach.
	const diffuse = decodeSlot(0);
	const normal = decodeSlot(1);
	const specular = decodeSlot(2);

	return {
		materialId,
		diffuse,
		normal,
		specular,
		samplerState: textureStates.length > 0 && textureStates[0].state
			? { addressU: textureStates[0].state.addressU, addressV: textureStates[0].state.addressV }
			: null,
		properties,
		// Determine if the chosen diffuse came from a secondary bundle by checking
		// if any of the TextureState's texture IDs that resolved to secondaries
		// match the diffuse texture's pixel data pointer.
		diffuseFromSecondary: diffuse !== null && [...secondaryTexIds].some(id => {
			const cached = textureCache.get(id);
			return cached === diffuse;
		}),
		crossBundleMisses,
	};
}

/**
 * Heuristic: detect if a decoded texture is likely a normal map by sampling
 * pixel values. Normal maps in tangent space have average RGB near (128,128,128)
 * because flat normals encode as (0.5, 0.5, 1.0) in RGB.
 */
function isNormalMap(tex: DecodedTexture): boolean {
	const { pixels } = tex;
	const { width, height } = tex.header;
	const count = width * height;
	if (count === 0) return false;

	// Sample every 16th pixel for speed
	let rSum = 0, gSum = 0, bSum = 0;
	let samples = 0;
	for (let i = 0; i < count; i += 16) {
		rSum += pixels[i * 4];
		gSum += pixels[i * 4 + 1];
		bSum += pixels[i * 4 + 2];
		samples++;
	}
	const avgR = rSum / samples;
	const avgG = gSum / samples;
	const avgB = bSum / samples;

	// Normal maps average near (128, 128, 128) ± 30
	return Math.abs(avgR - 128) < 30 && Math.abs(avgG - 128) < 30 && Math.abs(avgB - 128) < 30;
}

// =============================================================================
// MaterialState parser
// =============================================================================

/**
 * Parse a MaterialState resource (type 0xF) for rendering-relevant properties.
 *
 * MaterialState is a flat struct containing pointers to BlendState,
 * DepthStencilState, and RasterizerState. In the bundle the data they point
 * to follows inline in the same block, but the pointer values are null on
 * disk and get fixed up at runtime. We read the sub-structs at known offsets
 * relative to the MaterialState base.
 *
 * MaterialState layout (docs/MaterialState.md):
 *   +0x00  ptr  BlendState
 *   +0x04  ptr  DepthStencilState
 *   +0x08  ptr  RasterizerState
 *
 * The sub-structs follow the 3 pointers (offset 0x0C onward):
 *   BlendState  (0x48 bytes) at offset 0x0C
 *   DepthStencilState (0x48 bytes) at offset 0x54
 *   RasterizerState (0x54 bytes) at offset 0x9C
 */
function parseMaterialStateProperties(
	_buffer: ArrayBuffer,
	_bundle: ParsedBundle,
	_resource: ResourceEntry,
): MaterialProperties {
	// MaterialState (type 0xF) contains pointers to BlendState,
	// DepthStencilState, and RasterizerState. The sub-struct layout in the
	// resource block varies and the pointer fixup makes offsets unreliable
	// without more reverse-engineering. Return safe defaults for now.
	return { alphaBlendEnable: false, alphaTestEnable: false, alphaRef: 0, cullMode: 1 };
}
