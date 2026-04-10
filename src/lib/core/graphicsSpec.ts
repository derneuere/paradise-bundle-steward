// GraphicsSpec parser (resource type 0x10006, "VehicleGraphics").
//
// Top-level entry point for a vehicle graphics bundle. Tells you which Model
// resources make up which body parts and where each part sits in the car's
// local space (mpPartLocators). Also enumerates the shattered-glass parts
// that hot-swap in on collision.
//
// Layout source: docs/GraphicsSpec.md (wiki dump) plus empirical fixes from
// scripts/probe-graphicsspec.ts run against example/VEH_CARBRWDS_GR.BIN. The
// wiki and probe disagree on a few points; the probe wins. See the comments
// inline.
//
// Scope: read-only, no writer. The viewer page consumes the parsed model and
// resolves the Model → Renderable chain via the bundle's resource list.

import type { ParsedBundle, ResourceEntry } from './types';
import { extractResourceSize, isCompressed, decompressData } from './resourceManager';
import { u64ToBigInt } from './u64';
import { BundleError } from './errors';
import { readInlineImportTable } from './renderable';

export const GRAPHICS_SPEC_TYPE_ID = 0x10006;
export const MODEL_TYPE_ID = 0x2A;

// =============================================================================
// Types
// =============================================================================

/**
 * A full 4×4 transform stored as 16 floats, **stride 64 bytes**.
 *
 * The wiki calls these "Matrix44Affine" which traditionally implies 12 floats
 * (the bottom row is implicit `[0,0,0,1]`). The probe says otherwise: the
 * actual stride is 64 bytes per locator (32 × 64 = 2048 bytes between
 * mpPartLocators and mpPartVolumeIDs in our sample). The wiki is wrong here.
 *
 * Layout (row-major, OpenTK / OpenGL convention):
 *
 *   row 0 = [r00, r01, r02, 0]   ← rotation X row
 *   row 1 = [r10, r11, r12, 0]   ← rotation Y row
 *   row 2 = [r20, r21, r22, 0]   ← rotation Z row
 *   row 3 = [tx,  ty,  tz,  1]   ← translation row + homogeneous 1
 *
 * Note translation is in the BOTTOM ROW, not the right column. To convert to
 * a three.js `Matrix4` (which is column-major with translation in the right
 * column), `Matrix4.fromArray(floats)` does the right thing — reading the
 * row-major data column-wise effectively transposes it into the desired
 * column-major form.
 */
export type RawLocator = Float32Array; // length 16

const LOCATOR_STRIDE = 64; // bytes
const LOCATOR_FLOATS = 16;

export type GraphicsSpecPart = {
	/** Index of the Model in the GraphicsSpec's import table (the resourceId
	 *  for that Model is `imports[modelImportIndex].id`). */
	modelImportIndex: number;
	/** The 12 raw floats of this part's locator. Decoded by the viewer. */
	locator: RawLocator;
};

export type ParsedGraphicsSpec = {
	version: number;          // muVersion, == 3 in known samples
	partsCount: number;       // muPartsCount
	parts: GraphicsSpecPart[];
	shatteredGlassPartsCount: number; // muShatteredGlassPartsCount
	// We don't decode the shattered-glass table yet — the viewer doesn't need
	// it for the first pass and the layout differs between 32/64-bit builds.
	// Stored only as the raw header offsets so a future expansion is mechanical.
	mpShatteredGlassParts: number;
	mpPartVolumeIDs: number;
	mpNumRigidBodiesForPart: number;
	mppRigidBodyToSkinMatrixTransforms: number;
	/** Resolved import table: importIndex → target resource id (bigint). */
	imports: bigint[];
};

// =============================================================================
// Helpers
// =============================================================================

/**
 * Mirror of getRenderableBlocks() in renderable.ts but for the single block
 * (block 0) we need from a GraphicsSpec. Decompresses if needed.
 */
export function getGraphicsSpecHeader(
	buffer: ArrayBuffer,
	bundle: ParsedBundle,
	resource: ResourceEntry,
): Uint8Array {
	const size = extractResourceSize(resource.sizeAndAlignmentOnDisk[0]);
	if (size <= 0) {
		throw new BundleError('GraphicsSpec has no header block', 'RESOURCE_EMPTY');
	}
	const base = bundle.header.resourceDataOffsets[0] >>> 0;
	const rel = resource.diskOffsets[0] >>> 0;
	const start = (base + rel) >>> 0;
	if (start + size > buffer.byteLength) {
		throw new BundleError('GraphicsSpec block 0 runs past end of file', 'PARSE_ERROR');
	}
	let bytes: Uint8Array = new Uint8Array(buffer, start, size);
	if (isCompressed(bytes)) bytes = decompressData(bytes) as Uint8Array;
	return bytes;
}

// =============================================================================
// Parser
// =============================================================================

/**
 * Parse a GraphicsSpec resource. Reads the header struct, the per-part import
 * indices array, the per-part locator array, and the inline import table.
 *
 * The 32-bit layout (matches every PC BP sample we've checked):
 *   0x00 u32 muVersion              (= 3)
 *   0x04 u32 muPartsCount
 *   0x08 u32 mppPartsModels         (offset to u32[muPartsCount] import indices)
 *   0x0C u32 muShatteredGlassPartsCount
 *   0x10 u32 mpShatteredGlassParts  (offset to ShatteredGlassPart[count])
 *   0x14 u32 mpPartLocators         (offset to Matrix44Affine[muPartsCount], stride 48)
 *   0x18 u32 mpPartVolumeIDs
 *   0x1C u32 mpNumRigidBodiesForPart
 *   0x20 u32 mppRigidBodyToSkinMatrixTransforms
 *
 * Wiki discrepancies fixed here:
 *   - Wiki says mppPartsModels holds "8-bit integers aligned 4". Probe shows
 *     it's actually u32 indices, one per part (the wiki note is wrong).
 *   - Wiki calls mpPartLocators a Matrix44Affine array (which would be 48
 *     bytes per matrix). Probe shows the stride is 64 bytes — the full
 *     Matrix44, with the conventional bottom row [tx, ty, tz, 1]. The
 *     "Affine" naming is misleading.
 */
export function parseGraphicsSpec(
	header: Uint8Array,
	resource: ResourceEntry,
): ParsedGraphicsSpec {
	if (header.byteLength < 0x24) {
		throw new BundleError(
			`GraphicsSpec header too small (${header.byteLength} bytes)`,
			'PARSE_ERROR',
		);
	}
	const dv = new DataView(header.buffer, header.byteOffset, header.byteLength);

	const version = dv.getUint32(0x00, true);
	if (version !== 3) {
		// Not fatal, but worth a warning — we've only seen v3 in the wild.
		console.warn(`GraphicsSpec version ${version}, expected 3`);
	}
	const partsCount = dv.getUint32(0x04, true);
	const mppPartsModels = dv.getUint32(0x08, true);
	const shatteredGlassPartsCount = dv.getUint32(0x0C, true);
	const mpShatteredGlassParts = dv.getUint32(0x10, true);
	const mpPartLocators = dv.getUint32(0x14, true);
	const mpPartVolumeIDs = dv.getUint32(0x18, true);
	const mpNumRigidBodiesForPart = dv.getUint32(0x1C, true);
	const mppRigidBodyToSkinMatrixTransforms = dv.getUint32(0x20, true);

	// Read mppPartsModels[partsCount] — u32 indices into the GraphicsSpec's
	// imports table. Wiki says u8, observed u32.
	if (mppPartsModels + partsCount * 4 > header.byteLength) {
		throw new BundleError(
			`mppPartsModels at 0x${mppPartsModels.toString(16)} + ${partsCount}×4 runs past header (${header.byteLength})`,
			'PARSE_ERROR',
		);
	}
	const modelIndices: number[] = [];
	for (let i = 0; i < partsCount; i++) {
		modelIndices.push(dv.getUint32(mppPartsModels + i * 4, true));
	}

	// Read mpPartLocators[partsCount] — 64-byte full Matrix44 each.
	if (mpPartLocators + partsCount * LOCATOR_STRIDE > header.byteLength) {
		throw new BundleError(
			`mpPartLocators at 0x${mpPartLocators.toString(16)} + ${partsCount}×${LOCATOR_STRIDE} runs past header (${header.byteLength})`,
			'PARSE_ERROR',
		);
	}
	const parts: GraphicsSpecPart[] = [];
	for (let i = 0; i < partsCount; i++) {
		const locator = new Float32Array(LOCATOR_FLOATS);
		for (let f = 0; f < LOCATOR_FLOATS; f++) {
			locator[f] = dv.getFloat32(mpPartLocators + i * LOCATOR_STRIDE + f * 4, true);
		}
		parts.push({
			modelImportIndex: modelIndices[i],
			locator,
		});
	}

	// Resolve the inline import table (header-block-relative). Re-uses the
	// renderable module's reader since the format is identical.
	const importMap = readInlineImportTable(header, resource);
	// We need the imports as an INDEXED list (not by ptrOffset). The order in
	// the map iterator matches insertion order which matches the on-disk import
	// order, so just collect values.
	const imports = Array.from(importMap.values());

	if (imports.length < resource.importCount) {
		console.warn(
			`GraphicsSpec import count mismatch: read ${imports.length} from inline table, ResourceEntry says ${resource.importCount}`,
		);
	}

	return {
		version,
		partsCount,
		parts,
		shatteredGlassPartsCount,
		mpShatteredGlassParts,
		mpPartVolumeIDs,
		mpNumRigidBodiesForPart,
		mppRigidBodyToSkinMatrixTransforms,
		imports,
	};
}

// =============================================================================
// Model resource (typeId 0x2A)
// =============================================================================

/**
 * Minimal Model parser. We don't decode every field — just enough to find the
 * single Renderable we want to render for a given LOD state (state 0 by
 * default, which is LOD0).
 *
 * Model layout (32-bit):
 *   0x00 Renderable** mppRenderables
 *   0x04 uint8_t*     mpu8StateRenderableIndices
 *   0x08 float32_t*   mpfLodDistances
 *   0x0C int32_t      miGameExplorerIndex
 *   0x10 u8           mu8NumRenderables
 *   0x11 u8           mu8Flags
 *   0x12 u8           mu8NumStates
 *   0x13 u8           mu8VersionNumber  (= 2)
 *
 * The Renderable pointers at mppRenderables get patched via the import table,
 * so we just iterate the inline imports for type 0xC entries and use them in
 * order. mpu8StateRenderableIndices then maps state→renderable index.
 */
export type ParsedModel = {
	numRenderables: number;
	numStates: number;
	flags: number;
	/** Imports table for this Model, in declaration order. The first
	 *  numRenderables entries are the Renderable resources to render. */
	renderableIds: bigint[];
	/** state index → renderable index (0..numRenderables-1). state 0 = LOD0. */
	stateToRenderable: number[];
};

export function getModelHeader(
	buffer: ArrayBuffer,
	bundle: ParsedBundle,
	resource: ResourceEntry,
): Uint8Array {
	const size = extractResourceSize(resource.sizeAndAlignmentOnDisk[0]);
	if (size <= 0) {
		throw new BundleError('Model has no header block', 'RESOURCE_EMPTY');
	}
	const base = bundle.header.resourceDataOffsets[0] >>> 0;
	const rel = resource.diskOffsets[0] >>> 0;
	const start = (base + rel) >>> 0;
	let bytes: Uint8Array = new Uint8Array(buffer, start, size);
	if (isCompressed(bytes)) bytes = decompressData(bytes) as Uint8Array;
	return bytes;
}

export function parseModel(header: Uint8Array, resource: ResourceEntry): ParsedModel {
	if (header.byteLength < 0x14) {
		throw new BundleError(
			`Model header too small (${header.byteLength} bytes)`,
			'PARSE_ERROR',
		);
	}
	const dv = new DataView(header.buffer, header.byteOffset, header.byteLength);
	const numRenderables = dv.getUint8(0x10);
	const flags = dv.getUint8(0x11);
	const numStates = dv.getUint8(0x12);
	// 0x13 = version, always 2; we don't check.

	// Read mpu8StateRenderableIndices: u8[numStates] starting at the value of
	// the pointer at +0x04. Wiki says these are u8 indices, the probe doesn't
	// fight that since states are only 0..31 anyway.
	const mpu8StateRenderableIndices = dv.getUint32(0x04, true);
	const stateToRenderable: number[] = [];
	if (mpu8StateRenderableIndices > 0 && mpu8StateRenderableIndices + numStates <= header.byteLength) {
		for (let i = 0; i < numStates; i++) {
			stateToRenderable.push(dv.getUint8(mpu8StateRenderableIndices + i));
		}
	} else {
		// Fallback: if we can't read the state map, assume identity (state i → renderable i).
		for (let i = 0; i < numStates; i++) stateToRenderable.push(i);
	}

	// Resolve renderable references via the inline import table.
	const importMap = readInlineImportTable(header, resource);
	const renderableIds = Array.from(importMap.values());

	return { numRenderables, numStates, flags, renderableIds, stateToRenderable };
}

/**
 * Pick the LOD0 Renderable id from a Model. Falls back to renderableIds[0] if
 * the state map didn't load or is malformed.
 */
export function lod0RenderableId(model: ParsedModel): bigint | null {
	if (model.renderableIds.length === 0) return null;
	const idx = model.stateToRenderable[0] ?? 0;
	return model.renderableIds[idx] ?? model.renderableIds[0] ?? null;
}

/**
 * Convenience: walk a parsed GraphicsSpec, look up each part's Model, and
 * return one entry per part with the resolved Renderable id and the raw 12
 * locator floats. The viewer is responsible for turning the floats into a
 * THREE.Matrix4 (since multiple interpretations are still on the table).
 */
export type ResolvedPart = {
	modelId: bigint;
	renderableId: bigint | null;
	locator: RawLocator;
	debugName?: string;
};

export function resolveGraphicsSpecParts(
	buffer: ArrayBuffer,
	bundle: ParsedBundle,
	gs: ParsedGraphicsSpec,
): ResolvedPart[] {
	const out: ResolvedPart[] = [];
	for (const part of gs.parts) {
		const modelId = gs.imports[part.modelImportIndex];
		if (modelId === undefined) {
			console.warn(`GraphicsSpec part references missing import index ${part.modelImportIndex}`);
			continue;
		}
		// Find the Model resource entry in the bundle.
		let modelEntry: ResourceEntry | null = null;
		for (const r of bundle.resources) {
			if (u64ToBigInt(r.resourceId) === modelId) { modelEntry = r; break; }
		}
		if (!modelEntry || modelEntry.resourceTypeId !== MODEL_TYPE_ID) {
			out.push({ modelId, renderableId: null, locator: part.locator });
			continue;
		}
		try {
			const modelHeader = getModelHeader(buffer, bundle, modelEntry);
			const model = parseModel(modelHeader, modelEntry);
			out.push({ modelId, renderableId: lod0RenderableId(model), locator: part.locator });
		} catch (err) {
			console.warn(`Failed to parse Model ${modelId.toString(16)}:`, err);
			out.push({ modelId, renderableId: null, locator: part.locator });
		}
	}
	return out;
}
