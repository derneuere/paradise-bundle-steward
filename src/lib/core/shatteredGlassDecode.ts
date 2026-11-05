// Decode a vehicle's shattered-glass models: one Renderable per entry of the
// GraphicsSpec's shattered-glass table, placed at the locator of the body
// part the entry names. They are never part of the car as it is drawn
// whole; a crash view draws one in place of its pane's window meshes while
// that pane is cracked (see deformationSim/crackedGlass). Their meshes carry
// the pane's bit in their mesh flags like the window meshes they replace, and
// the same window shader, read through the fracture constants.

import {
	GRAPHICS_SPEC_TYPE_ID,
	getGraphicsSpecHeader,
	parseGraphicsSpec,
	resolveShatteredGlassParts,
	type ResolvedShatteredGlassPart,
} from './graphicsSpec';
import { getImportIds } from './bundle';
import { RENDERABLE_TYPE_ID, type ParsedVertexDescriptor } from './renderable';
import { decodeOneRenderable, type DecodedRenderable } from './renderableDecode';
import type { ResolvedMaterial, ShaderNameMap, TextureSourceBundle } from './materialChain';
import type { DecodedTexture } from './texture';
import { u64ToBigInt } from './u64';
import type { ParsedBundle } from './types';

export type ShatteredGlassRenderable = DecodedRenderable & {
	// partIndex / partLocator are the entry's body part.
	partIndex: number;
	glass: ResolvedShatteredGlassPart;
};

export function decodeShatteredGlass(
	buffer: ArrayBuffer,
	bundle: ParsedBundle,
	secondarySources: TextureSourceBundle[] = [],
	shaderNames: ShaderNameMap | null = null,
): ShatteredGlassRenderable[] {
	const gsResource = bundle.resources.find((r) => r.resourceTypeId === GRAPHICS_SPEC_TYPE_ID);
	if (!gsResource) return [];
	let parts: ResolvedShatteredGlassPart[];
	try {
		const header = getGraphicsSpecHeader(buffer, bundle, gsResource);
		const importIds = getImportIds(bundle.imports, bundle.resources, bundle.resources.indexOf(gsResource));
		parts = resolveShatteredGlassParts(buffer, bundle, parseGraphicsSpec(header, importIds));
	} catch (err) {
		console.warn('[shatteredGlassDecode] GraphicsSpec parse failed:', err);
		return [];
	}
	const vdCache = new Map<bigint, ParsedVertexDescriptor | null>();
	const textureCache = new Map<bigint, DecodedTexture | null>();
	const materialCache = new Map<bigint, ResolvedMaterial | null>();
	const out: ShatteredGlassRenderable[] = [];
	for (const glass of parts) {
		const entry = glass.renderableId === null ? undefined
			: bundle.resources.find((r) => r.resourceTypeId === RENDERABLE_TYPE_ID && u64ToBigInt(r.resourceId) === glass.renderableId);
		if (!entry) continue;
		const decoded = decodeOneRenderable(buffer, bundle, entry, null, vdCache, textureCache, materialCache, secondarySources, shaderNames);
		if (decoded.error || decoded.meshes.length === 0) continue;
		out.push({ ...decoded, partIndex: glass.bodyPartIndex, partLocator: glass.locator, glass });
	}
	return out;
}
