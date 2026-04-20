// Cross-bundle texture catalog.
//
// Indexes every Texture (type 0x0) resource across the primary bundle plus
// any secondary bundles loaded by the user. Used by the shader preview to
// pull real game textures into ShaderMaterial samplers — picking by name
// pattern when no MaterialAssembly is available to do the binding properly.
//
// Decoding is lazy: catalog entries hold a `decode()` thunk that runs the
// expensive DXT1/3/5 decompression only when the texture is actually
// needed. Callers should cache the resulting DecodedTexture themselves
// (per-shader / per-sampler) to avoid re-decoding on every frame.

import type { ParsedBundle, ResourceEntry } from './types';
import type { DebugResource } from './bundle/debugData';
import { findDebugResourceById } from './bundle/debugData';
import { formatResourceId } from './bundle';
import { u64ToBigInt } from './u64';
import { decodeTexture, TEXTURE_TYPE_ID, type DecodedTexture } from './texture';

export type TextureCatalogEntry = {
	/** u64 resource id formatted as 8-char lowercase hex (matches debug-data
	 *  table keys). Stable across bundles — different bundles can ship the
	 *  same texture id, in which case the first-loaded wins. */
	id: string;
	/** Best-effort human name from the debug-data resource string table.
	 *  Falls back to the bundle filename + id if no debug name is present. */
	name: string;
	/** Which bundle this entry was sourced from. 'primary' for the editing
	 *  target, otherwise the secondary bundle's filename. */
	source: string;
	/** True when the debug name suggests a cube map (path contains
	 *  Cube_Maps/ or the name ends in TextureConfigCube). The DXBC
	 *  translator emits everything as `sampler2D`, so binding a cube to
	 *  a 2D sampler smears the 6-face data badly — the matcher uses this
	 *  flag to skip cubes when looking for 2D-sampler matches. */
	isCube: boolean;
	/** Lazy decoder. Throws on malformed pixel data. Memoize at the call
	 *  site — every invocation re-runs DXT decompression. */
	decode: () => DecodedTexture;
};

type Source = {
	source: string;
	bundle: ParsedBundle;
	arrayBuffer: ArrayBuffer;
	debug: DebugResource[];
};

export function buildTextureCatalog(sources: Source[]): TextureCatalogEntry[] {
	const seen = new Set<string>();
	const out: TextureCatalogEntry[] = [];
	for (const s of sources) {
		for (const r of s.bundle.resources) {
			if (r.resourceTypeId !== TEXTURE_TYPE_ID) continue;
			const id = formatResourceId(u64ToBigInt(r.resourceId));
			if (seen.has(id)) continue;
			seen.add(id);
			const dbg = findDebugResourceById(s.debug, id);
			const name = dbg?.name ?? `tex_${id}`;
			out.push({
				id,
				name,
				source: s.source,
				isCube: /TextureConfigCube|Cube_Maps/i.test(name),
				decode: () => decodeTexture(s.arrayBuffer, s.bundle, r as ResourceEntry),
			});
		}
	}
	return out;
}

/**
 * Pick the texture from a catalog whose name best matches a sampler name.
 *
 * Both names tokenise (camelCase / snake_case / paths / trailing-digit
 * suffixes all collapse). Match is exact token equality — substring is
 * too loose ("detail" → every Detailing/ asset). Sampler names also pick
 * up domain aliases (wave ↔ ocean ↔ bump, reflection ↔ cube ↔ envmap)
 * because Burnout's water assets are named after the physical thing, not
 * the shader role.
 *
 * The optional `shaderName` adds context tokens with a smaller weight, so
 * a generic sampler like `Diffuse` on `MetalSheen_Opaque_Doublesided`
 * prefers a texture whose name contains "metal" / "sheen" over an
 * arbitrary first match. Sampler tokens still dominate — context only
 * tie-breaks among same-role candidates.
 *
 * Cube maps are filtered out: the DXBC translator emits every sampler as
 * `sampler2D`, so binding a 6-face cube to a 2D sampler produces obvious
 * smearing. Cubes appear in the catalog (the inputs tab still lists them)
 * but never win an auto-pick.
 *
 * Score = sum of matched-token character length, so longer/more specific
 * matches outrank generic ones. Returns null on no overlap so the caller
 * can fall back to a procedural placeholder.
 */
/** Samplers whose role is so engine-specific that any real game texture is
 *  the wrong choice — the procedural fallback always wins. Shadow maps
 *  encode depth (not colour), and Reflection probes are cube maps the
 *  translator can't sample correctly through `sampler2D`. */
const PROCEDURAL_ONLY_SAMPLERS = /shadow|reflect|envmap|cube|depth/i;

export function pickTextureForSampler(
	samplerName: string,
	catalog: TextureCatalogEntry[],
	shaderName?: string,
): TextureCatalogEntry | null {
	if (PROCEDURAL_ONLY_SAMPLERS.test(samplerName)) return null;
	const baseTokens = tokenize(samplerName).filter((t) => !MATCH_STOPWORDS.has(t));
	if (baseTokens.length === 0 || catalog.length === 0) return null;
	const tokens = expandAliases(baseTokens);
	const contextTokens = shaderName
		? tokenize(shaderName).filter((t) => !MATCH_STOPWORDS.has(t) && !SHADER_NAME_STOPWORDS.has(t))
		: [];
	let best: { entry: TextureCatalogEntry; score: number } | null = null;
	for (const entry of catalog) {
		if (entry.isCube) continue;
		const nameTokens = new Set(tokenize(entry.name));
		let samplerScore = 0;
		for (const t of tokens) {
			if (nameTokens.has(t)) samplerScore += t.length;
		}
		// Context (shader-name) tokens carry full token-length weight. They
		// also qualify entries that scored zero on sampler tokens — that
		// way a `metal_panel` texture can land on the Specular sampler for
		// MetalSheen even when nothing in its name matches "spec/gloss".
		// Weight is intentionally NOT boosted above sampler weight: the
		// generic colour-suffix on "lighting02_colour" must still beat a
		// random metal_* texture on the Diffuse sampler, since "_colour"
		// is a pretty strong role hint regardless of subject matter.
		let contextScore = 0;
		for (const t of contextTokens) {
			if (nameTokens.has(t)) contextScore += t.length;
		}
		const score = samplerScore + contextScore;
		if (score === 0) continue;
		if (!best || score > best.score) best = { entry, score };
	}
	return best?.entry ?? null;
}

/** Variant words on shader names that aren't useful matching context.
 *  Most Burnout shaders end in one of these — they don't say anything
 *  about what the texture should look like. */
const SHADER_NAME_STOPWORDS = new Set([
	'opaque', 'transparent', 'singlesided', 'doublesided', 'singleside', 'doubleside',
	'specular', 'diffuse', 'reflective', 'illuminated', 'illuminance',
	'1bit', 'greyscale', 'lightmap', 'lightmapped', 'detailmap', 'instanced',
	'shader', 'fade', 'faded',
]);

/** Tokens that appear so often in Burnout texture / sampler names that
 *  matching on them produces nonsense (e.g. "detail" → every Detailing/
 *  texture). Filtered out before scoring. */
const MATCH_STOPWORDS = new Set([
	'sampler', 'texture', 'map', 'tex', 'sampl',
	'high', 'low', 'detail', 'lod', 'mip',
	'image', 'gamedb', 'burnouts', 'burnout', 'content', 'world', 'images',
]);

/** Domain aliases: sampler names use shader-role words (Wave, Reflection,
 *  Diffuse) but texture asset names use physical-thing words (ocean,
 *  bump, cube, dif). Add the alias on either side of any sampler token. */
const ALIASES: Record<string, string[]> = {
	wave:       ['ocean', 'bump', 'ripple', 'water'],
	normal:     ['bump', 'nrm', 'norm'],
	reflection: ['envmap', 'cube', 'sky', 'reflect'],
	reflect:    ['envmap', 'cube', 'sky', 'reflection'],
	diffuse:    ['dif', 'albedo', 'colour', 'color', 'col'],
	specular:   ['spec', 'gloss', 'roughness'],
	floor:      ['ground', 'terrain'],
	river:      ['water', 'lake', 'stream', 'creek'],
	shadow:     ['shdw', 'shad'],
};

function expandAliases(tokens: string[]): string[] {
	const out = new Set(tokens);
	for (const t of tokens) {
		const aliases = ALIASES[t];
		if (aliases) for (const a of aliases) out.add(a);
	}
	return [...out];
}

/** Split a sampler / texture name into lower-case keyword tokens. Strips
 *  trailing digits so `floor01` and `floor02` collide with `floor`. */
function tokenize(name: string): string[] {
	return name
		.replace(/([a-z])([A-Z])/g, '$1 $2')   // camelCase → "camel Case"
		.replace(/[_\-/.:?]+/g, ' ')           // snake / kebab / paths → spaces
		.toLowerCase()
		.split(/\s+/)
		.map((t) => t.replace(/\d+$/, ''))     // strip trailing digits: floor01 → floor
		.filter((t) => t.length >= 3);
}
