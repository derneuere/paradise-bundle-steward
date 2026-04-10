// TextureState resource parser (type 0xE) — PC platform.
//
// TextureState wraps a SamplerState struct (0x3C bytes) plus a pointer to an
// imported Texture resource at offset +0x3C.
//
// See docs/TextureState.md for the full structure specification.
// Reference: repo/BaseHandlers/TextureState.cs

import type { ParsedBundle, ResourceEntry } from './types';
import { getResourceBlocks } from './resourceManager';
import { getImportsByPtrOffset } from './bundle/index';
import { BundleError } from './errors';

// =============================================================================
// Constants
// =============================================================================

export const TEXTURE_STATE_TYPE_ID = 0xE;

// =============================================================================
// Types
// =============================================================================

/** D3DTEXTUREADDRESS values. See docs/TextureState.md. */
export enum D3DTextureAddress {
	WRAP = 1,
	MIRROR = 2,
	CLAMP = 3,
	BORDER = 4,
	MIRRORONCE = 5,
}

/** D3DTEXTUREFILTERTYPE values. */
export enum D3DTextureFilter {
	NONE = 0,
	POINT = 1,
	LINEAR = 2,
	ANISOTROPIC = 3,
}

export type ParsedTextureState = {
	addressU: number;
	addressV: number;
	addressW: number;
	magFilter: number;
	minFilter: number;
	mipFilter: number;
	maxMipLevel: number;
	maxAnisotropy: number;
	mipLodBias: number;
	borderColor: number;
	/** Imported Texture resource ID, resolved from the import table. */
	textureId: bigint | null;
};

// =============================================================================
// Parsing
// =============================================================================

/**
 * Parse a TextureState from its decompressed header block.
 *
 * The import table is needed to resolve the Texture pointer at offset +0x3C.
 * Pass an empty map if imports aren't available (registry handler path).
 *
 * Layout (SamplerState base at +0x00..+0x3B):
 *   +0x00  u32  addressU (D3DTEXTUREADDRESS)
 *   +0x04  u32  addressV
 *   +0x08  u32  addressW
 *   +0x0C  u32  magFilter (D3DTEXTUREFILTERTYPE)
 *   +0x10  u32  minFilter
 *   +0x14  u32  mipFilter
 *   +0x18  u32  maxMipLevel
 *   +0x1C  u32  maxAnisotropy
 *   +0x20  f32  mipLodBias
 *   +0x24  u32  borderColor (D3DCOLOR)
 *   +0x28..0x3B  unused (game doesn't access)
 *
 * TextureState extension:
 *   +0x3C  ptr  Texture (imported resource)
 */
export function parseTextureState(
	block0: Uint8Array,
	imports: Map<number, bigint>,
): ParsedTextureState {
	if (block0.byteLength < 0x40) {
		throw new BundleError(
			`TextureState header too small: ${block0.byteLength} bytes (need >= 0x40)`,
			'PARSE_ERROR',
		);
	}
	const dv = new DataView(block0.buffer, block0.byteOffset, block0.byteLength);

	// The Texture import pointer offset varies between what the docs say
	// (0x3C) and what the bundle's import table actually contains (observed
	// as 0x38). Instead of hardcoding, find the first import entry that
	// points to a resource — TextureState typically has exactly one import
	// (the Texture resource).
	let textureId: bigint | null = null;
	for (const [, id] of imports) {
		textureId = id;
		break;
	}

	return {
		addressU: dv.getUint32(0x00, true),
		addressV: dv.getUint32(0x04, true),
		addressW: dv.getUint32(0x08, true),
		magFilter: dv.getUint32(0x0C, true),
		minFilter: dv.getUint32(0x10, true),
		mipFilter: dv.getUint32(0x14, true),
		maxMipLevel: dv.getUint32(0x18, true),
		maxAnisotropy: dv.getUint32(0x1C, true),
		mipLodBias: dv.getFloat32(0x20, true),
		borderColor: dv.getUint32(0x24, true),
		textureId,
	};
}

/**
 * Full decode: extract block, parse, resolve import.
 */
export function decodeTextureState(
	buffer: ArrayBuffer,
	bundle: ParsedBundle,
	resource: ResourceEntry,
): ParsedTextureState {
	const blocks = getResourceBlocks(buffer, bundle, resource);
	const headerBlock = blocks[0];
	if (!headerBlock) {
		throw new BundleError(
			`TextureState resource has no header block`,
			'RESOURCE_EMPTY',
		);
	}

	const resourceIndex = bundle.resources.indexOf(resource);
	const imports = getImportsByPtrOffset(bundle.imports, bundle.resources, resourceIndex);
	return parseTextureState(headerBlock, imports);
}
