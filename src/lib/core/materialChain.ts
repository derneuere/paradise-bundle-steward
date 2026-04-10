// Material → TextureState → Texture chain resolver.
//
// Walks the import chain of a Material resource (type 0x1) to find and decode
// the textures it references.
//
// The Material header struct contains a Sampler array where each Sampler has a
// channel number (shader register slot) and a pointer to its TextureState
// import. We parse this to correctly assign textures by semantic role rather
// than relying purely on positional ordering, which fails for materials where
// the normal map appears before the diffuse in the import chain.
//
// Classification strategy (in priority order):
//   1. Channel 0 is always the diffuse texture (consistent across all observed
//      shaders in Burnout Paradise PC).
//   2. For materials without a channel-0 sampler (body paint shaders etc.),
//      content-based analysis detects normal maps (DXT5 + avg RGB ~128 + size
//      >= 256) and assigns the first non-normal texture as diffuse.
//   3. Positional fallback if sampler parsing fails entirely.
//
// IMPORTANT: Vehicle GR bundles typically contain geometry and material
// references, but the actual texture pixel data lives in companion bundles
// (e.g. GLOBALBACKDROPS, WORLDTEX). When a TextureState references a Texture
// that isn't in the loaded bundle, that slot resolves to null and the mesh
// falls back to the flat placeholder material. Multi-bundle loading is needed
// to fully resolve textures for most assets.

import type { ParsedBundle, ResourceEntry } from './types';
import { findResourceById } from './renderable';
import { getImportsByPtrOffset } from './bundle/index';
import { getResourceBlocks } from './resourceManager';
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
	/** Diffuse texture. */
	diffuse: DecodedTexture | null;
	/** Normal map. */
	normal: DecodedTexture | null;
	/** Roughness / specular map. Applied as roughnessMap in Three.js. */
	specular: DecodedTexture | null;
	/** Emissive mask (e.g. vehicle light zones with colored RGB regions). */
	emissive: DecodedTexture | null;
	/** Ambient occlusion map. */
	ao: DecodedTexture | null;
	/** Sampler state from the diffuse TextureState (for wrapping/filtering). */
	samplerState: Pick<ParsedTextureState, 'addressU' | 'addressV'> | null;
	/** Blend/cull/alpha properties from MaterialState. */
	properties: MaterialProperties | null;
	/** Whether the diffuse texture was resolved from a secondary bundle
	 *  (e.g. VEHICLETEX) rather than the primary bundle. Materials with
	 *  secondary-source diffuse are typically body/paint and should receive
	 *  the vehicle color tint. */
	diffuseFromSecondary: boolean;
	/** Whether ANY texture (diffuse, normal, specular) was resolved from a
	 *  secondary bundle. Body paint shaders may have their normal map from
	 *  VEHICLETEX but no diffuse at all — this flag catches those cases. */
	anyFromSecondary: boolean;
	/** Number of texture slots that couldn't resolve because the Texture
	 *  resource lives in a different bundle. */
	crossBundleMisses: number;
	/** Resolved shader name from SHADERS.BNDL debug data, e.g.
	 *  "Vehicle_Opaque_CarbonFibre_Textured". Null if shader bundle not loaded. */
	shaderName: string | null;
	/** Textures that resolved but couldn't be classified as diffuse/normal/
	 *  specular without the Shader resource. Keyed by sampler channel. */
	unclassified: { channel: number; texture: DecodedTexture }[];
};

// =============================================================================
// Material Sampler parser
// =============================================================================

/**
 * Parsed info from a single CgsGraphics::Sampler in the Material header.
 */
type SamplerInfo = {
	/** Sampler channel (int16 at +0x08). Maps to shader register slot. */
	channel: number;
	/** Byte offset in block 0 where the TextureState* import pointer lives. */
	stateImportOffset: number;
};

/** Sampler struct size for 32-bit (PC / PC Remastered). */
const SAMPLER_SIZE_32 = 0x14;

/**
 * Parse the Material header's Sampler array from block 0.
 *
 * PC MaterialAssembly layout (32-bit):
 *   +0x09  int8   mi8NumSamplers
 *   +0x0C  ptr    mpaSamplers → Sampler[numSamplers] within block 0
 *
 * Each 32-bit Sampler (0x14 bytes):
 *   +0x00  ptr    purpose string (char*)
 *   +0x04  u32    id hash
 *   +0x08  i16    channel (shader register slot)
 *   +0x0A  i16    scope
 *   +0x0C  u32    TexturePurpose enum
 *   +0x10  ptr    TextureState* (imported resource)
 */
function parseMaterialSamplers(block0: Uint8Array): SamplerInfo[] | null {
	if (block0.byteLength < 0x10) return null;

	const dv = new DataView(block0.buffer, block0.byteOffset, block0.byteLength);

	const numSamplers = dv.getInt8(0x09);
	if (numSamplers <= 0 || numSamplers > 16) return null;

	const samplersPtr = dv.getUint32(0x0C, true);
	if (samplersPtr === 0 || samplersPtr >= block0.byteLength) return null;
	if (samplersPtr + numSamplers * SAMPLER_SIZE_32 > block0.byteLength) return null;

	const samplers: SamplerInfo[] = [];

	for (let i = 0; i < numSamplers; i++) {
		const base = samplersPtr + i * SAMPLER_SIZE_32;
		const channel = dv.getInt16(base + 0x08, true);
		const stateImportOffset = base + 0x10;

		samplers.push({ channel, stateImportOffset });
	}

	return samplers;
}

// =============================================================================
// Normal map content detection
// =============================================================================

/**
 * Detect if a decoded texture is likely a normal map by sampling pixel values.
 * Normal maps in tangent space have average RGB near (128,128,128) because flat
 * normals encode as (0.5, 0.5, 1.0) in RGB.
 *
 * Requires size >= 256 to avoid misclassifying small glass tint textures.
 */
/**
 * Heuristic: detect if a DXT5 texture with avg ~128 is likely a specular
 * intensity map rather than a normal map. Without the shader we can't be
 * certain, but visual evidence shows these 512x512 DXT5 textures from
 * VEHICLETEX are specular intensity maps, not tangent-space normals.
 */
function isLikelySpecularIntensity(tex: DecodedTexture): boolean {
	const { width, height, format } = tex.header;
	if (format !== 'DXT5') return false;
	if (width < 256 || height < 256) return false;

	const { pixels } = tex;
	const count = width * height;
	if (count === 0) return false;

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

	return Math.abs(avgR - 128) < 30 && Math.abs(avgG - 128) < 30 && Math.abs(avgB - 128) < 30;
}

/**
 * Sample pixel statistics from a texture for content-based classification.
 * Samples ~500 pixels for speed.
 */
function sampleTextureStats(tex: DecodedTexture): {
	avgLum: number; maxChannel: number; range: number; grayscale: boolean;
} {
	const { pixels } = tex;
	const count = tex.header.width * tex.header.height;
	if (count === 0) return { avgLum: 0, maxChannel: 0, range: 0, grayscale: true };

	// Use denser sampling (~2000 pixels) to catch sparse bright features
	const step = Math.max(1, Math.floor(count / 2000));
	let rSum = 0, gSum = 0, bSum = 0;
	let minLum = 255, maxLum = 0, maxChannel = 0;
	let samples = 0;
	for (let i = 0; i < count; i += step) {
		const r = pixels[i * 4], g = pixels[i * 4 + 1], b = pixels[i * 4 + 2];
		const lum = (r + g + b) / 3;
		rSum += r; gSum += g; bSum += b;
		if (lum < minLum) minLum = lum;
		if (lum > maxLum) maxLum = lum;
		// Track max individual channel (catches saturated R/G/B in emissive masks)
		if (r > maxChannel) maxChannel = r;
		if (g > maxChannel) maxChannel = g;
		if (b > maxChannel) maxChannel = b;
		samples++;
	}
	const avgR = rSum / samples, avgG = gSum / samples, avgB = bSum / samples;
	const avgLum = (avgR + avgG + avgB) / 3;
	const grayscale = Math.abs(avgR - avgG) < 15 && Math.abs(avgR - avgB) < 15;
	return { avgLum, maxChannel, range: maxLum - minLum, grayscale };
}

// =============================================================================
// Resolver
// =============================================================================

/**
 * Resolve a Material resource's textures by walking its import chain and
 * parsing the Material header's Sampler array.
 *
 * Returns null if the Material resource can't be found.
 */
/** A loaded secondary bundle used purely as a texture source. */
export type TextureSourceBundle = {
	buffer: ArrayBuffer;
	bundle: ParsedBundle;
};

/** Map of resource ID (hex string) → shader name, parsed from SHADERS.BNDL debug XML. */
export type ShaderNameMap = Map<string, string>;

/**
 * Parse the debug XML from a SHADERS.BNDL buffer to build a shader ID → name map.
 * The XML ResourceStringTable contains entries like:
 *   <Resource id="11783066" type="Shader" name="gamedb://...CarbonFibre_Textured.fx..."/>
 */
export function parseShaderNameMap(buffer: ArrayBuffer): ShaderNameMap {
	const bytes = new Uint8Array(buffer);
	const dv = new DataView(buffer);
	const debugOff = dv.getUint32(12, true);
	// Read XML as string (it's null-terminated ASCII in the debug section)
	const xml = new TextDecoder().decode(bytes.subarray(debugOff, Math.min(debugOff + 100000, bytes.length)));
	const map: ShaderNameMap = new Map();
	const regex = /<Resource id="([^"]+)" type="Shader" name="([^"]+)"/g;
	let m;
	while ((m = regex.exec(xml)) !== null) {
		const id = m[1]; // hex string like "11783066"
		const fullName = m[2];
		// Extract short name: "gamedb://burnout5/Shaders/Foo_Bar.fx.Shader?ID=..." → "Foo_Bar"
		const short = fullName.match(/(?:Shaders|Test_Shaders|SkinTest)\/([^.]+)\.fx/)?.[1] ?? fullName;
		map.set(id, short);
	}
	return map;
}

export function resolveMaterialTextures(
	buffer: ArrayBuffer,
	bundle: ParsedBundle,
	materialId: bigint,
	textureCache: Map<bigint, DecodedTexture | null>,
	secondarySources: TextureSourceBundle[] = [],
	shaderNames: ShaderNameMap | null = null,
): ResolvedMaterial | null {
	const materialEntry = findResourceById(bundle, materialId);
	if (!materialEntry) return null;

	const resourceIndex = bundle.resources.indexOf(materialEntry);
	if (resourceIndex < 0) return null;
	const imports = getImportsByPtrOffset(bundle.imports, bundle.resources, resourceIndex);

	// Parse MaterialState for blend/cull properties.
	let properties: MaterialProperties | null = null;
	for (const [, targetId] of imports) {
		const targetResource = findResourceById(bundle, targetId);
		if (targetResource?.resourceTypeId === MATERIAL_STATE_TYPE_ID && !properties) {
			try {
				properties = parseMaterialStateProperties(buffer, bundle, targetResource);
			} catch { /* skip */ }
		}
	}

	// Resolve shader name via the Material's Shader import (at offset 0x10
	// in the MaterialAssembly struct for PC). The import's resource ID is
	// looked up in the SHADERS.BNDL name map.
	let shaderName: string | null = null;
	if (shaderNames) {
		const shaderResourceId = imports.get(0x10);
		if (shaderResourceId) {
			// Convert bigint to hex string (no leading zeros, lowercase) to match XML ids
			const hexId = shaderResourceId.toString(16);
			shaderName = shaderNames.get(hexId) ?? null;
		}
	}

	let crossBundleMisses = 0;
	const secondaryTexIds = new Set<bigint>();

	const decodeTextureById = (textureId: bigint | null): DecodedTexture | null => {
		if (!textureId) return null;
		if (textureCache.has(textureId)) return textureCache.get(textureId) ?? null;

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

	let diffuse: DecodedTexture | null = null;
	let normal: DecodedTexture | null = null;
	let specular: DecodedTexture | null = null;
	let emissive: DecodedTexture | null = null;
	let ao: DecodedTexture | null = null;
	let samplerState: Pick<ParsedTextureState, 'addressU' | 'addressV'> | null = null;
	let usedSamplerClassification = false;
	const unclassified: { channel: number; texture: DecodedTexture }[] = [];

	// --- Sampler-based resolution -------------------------------------------
	const blocks = getResourceBlocks(buffer, bundle, materialEntry);
	const block0 = blocks[0];
	if (block0) {
		const samplers = parseMaterialSamplers(block0);
		if (samplers && samplers.length > 0) {
			// Resolve all sampler TextureStates and their textures.
			type ResolvedSampler = {
				channel: number;
				tsState: ParsedTextureState;
				texture: DecodedTexture | null;
			};
			const resolved: ResolvedSampler[] = [];

			for (const sampler of samplers) {
				const tsResourceId = imports.get(sampler.stateImportOffset);
				if (!tsResourceId) continue;

				const tsResource = findResourceById(bundle, tsResourceId);
				if (!tsResource || tsResource.resourceTypeId !== TEXTURE_STATE_TYPE_ID) continue;

				let tsState: ParsedTextureState;
				try {
					tsState = decodeTextureState(buffer, bundle, tsResource);
				} catch { continue; }

				const tex = decodeTextureById(tsState.textureId);
				resolved.push({ channel: sampler.channel, tsState, texture: tex });
			}

			if (resolved.length > 0) {
				usedSamplerClassification = true;

				// Step 1: Channel 0 is always diffuse (reliable across all
				// observed BP PC shaders).
				const ch0 = resolved.find(s => s.channel === 0);
				if (ch0) {
					diffuse = ch0.texture;
					samplerState = { addressU: ch0.tsState.addressU, addressV: ch0.tsState.addressV };
				}

				// Step 2: Channel 1 is normal when ch=0 is present (standard
				// shader convention).
				const ch1 = resolved.find(s => s.channel === 1);
				if (ch0 && ch1) {
					normal = ch1.texture;
				}

				// Step 3: For remaining unassigned textures, detect specular
				// intensity maps (DXT5, avg ~128). These were previously
				// misclassified as normal maps but visual testing confirms
				// they're specular/reflection intensity.
				const assigned = new Set<ResolvedSampler>();
				if (ch0) assigned.add(ch0);
				if (ch0 && ch1) assigned.add(ch1);

				const unassigned = resolved.filter(s => !assigned.has(s));

				for (const s of unassigned) {
					if (!specular && s.texture && isLikelySpecularIntensity(s.texture)) {
						specular = s.texture;
						assigned.add(s);
					}
				}

				// Step 4: Classify remaining unassigned textures by content
				// analysis. Without the Shader resource, we use size/format/
				// pixel statistics to infer roles.
				const remaining = resolved.filter(s => !assigned.has(s) && s.texture);

				for (const s of remaining) {
					const tex = s.texture!;
					const w = tex.header.width;
					const fmt = tex.header.format;
					const stats = sampleTextureStats(tex);

					if (!specular && w >= 2048 && fmt === 'DXT1') {
						// Large DXT1 → roughness map (shared body roughness atlas)
						specular = tex;
						assigned.add(s);
					} else if (!emissive && stats.avgLum < 30 && stats.maxChannel > 200) {
						// Mostly black with some bright pixels → emissive light mask
						// Uses maxChannel (not luminance) because emissive masks use
						// saturated single-channel colors (pure R/G/B for light zones)
						emissive = tex;
						assigned.add(s);
					} else if (!ao && w >= 512 && w <= 1024 && fmt === 'DXT1' && stats.grayscale && stats.avgLum > 150 && stats.range > 80) {
						// Medium grayscale with high avg + wide range → AO map
						ao = tex;
						assigned.add(s);
					} else if (!specular && w <= 128 && fmt === 'DXT5' && stats.grayscale) {
						// Small DXT5 grayscale → specular highlight
						specular = tex;
						assigned.add(s);
					}
				}

				// Step 5: Collect still-unclassified textures for debug.
				for (const s of resolved) {
					if (!assigned.has(s) && s.texture) {
						unclassified.push({ channel: s.channel, texture: s.texture });
					}
				}
			}
		}
	}

	// --- Positional fallback -------------------------------------------------
	if (!usedSamplerClassification) {
		const importEntries = Array.from(imports.entries()).sort(([a], [b]) => a - b);
		const textureStates: { state: ParsedTextureState; textureId: bigint | null }[] = [];

		for (const [, targetId] of importEntries) {
			const targetResource = findResourceById(bundle, targetId);
			if (!targetResource || targetResource.resourceTypeId !== TEXTURE_STATE_TYPE_ID) continue;
			try {
				const tsState = decodeTextureState(buffer, bundle, targetResource);
				textureStates.push({ state: tsState, textureId: tsState.textureId });
			} catch {
				textureStates.push({ state: null as unknown as ParsedTextureState, textureId: null });
			}
		}

		diffuse = textureStates.length > 0 ? decodeTextureById(textureStates[0].textureId) : null;
		normal = textureStates.length > 1 ? decodeTextureById(textureStates[1].textureId) : null;
		specular = textureStates.length > 2 ? decodeTextureById(textureStates[2].textureId) : null;

		if (textureStates.length > 0 && textureStates[0].state) {
			samplerState = { addressU: textureStates[0].state.addressU, addressV: textureStates[0].state.addressV };
		}
	}

	return {
		materialId,
		diffuse,
		normal,
		specular,
		emissive,
		ao,
		samplerState,
		properties,
		diffuseFromSecondary: diffuse !== null && [...secondaryTexIds].some(id => {
			const cached = textureCache.get(id);
			return cached === diffuse;
		}),
		anyFromSecondary: secondaryTexIds.size > 0,
		crossBundleMisses,
		shaderName,
		unclassified,
	};
}

// =============================================================================
// MaterialState parser
// =============================================================================

/**
 * Parse a MaterialState resource (type 0xF) for rendering-relevant properties.
 */
function parseMaterialStateProperties(
	_buffer: ArrayBuffer,
	_bundle: ParsedBundle,
	_resource: ResourceEntry,
): MaterialProperties {
	return { alphaBlendEnable: false, alphaTestEnable: false, alphaRef: 0, cullMode: 1 };
}
