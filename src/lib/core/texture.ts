// Texture resource parser (type 0x0) — PC platform.
//
// The Texture resource uses two blocks:
//   block 0 (Main Memory): fixed-size header describing format / dimensions
//   block 1 (Disposable):  raw or DXT-compressed pixel data
//
// Header layout derived from Volatility's TexturePC.ParseFromStream() and
// cross-checked against BundleManager's GameImage.GetImageHeader().
//
// See docs/Texture_PC.md for the full structure specification.

import type { ParsedBundle, ResourceEntry } from './types';
import { getResourceBlocks } from './resourceManager';
import { decodeDXT1, decodeDXT5 } from './dxt';
import { BundleError } from './errors';

// =============================================================================
// Constants
// =============================================================================

export const TEXTURE_TYPE_ID = 0x0;

// FourCC values as they appear on disk (little-endian ASCII).
const FOURCC_DXT1 = 0x31545844; // "DXT1"
const FOURCC_DXT3 = 0x33545844; // "DXT3"
const FOURCC_DXT5 = 0x35545844; // "DXT5"

// Numeric D3DFORMAT values for uncompressed formats (PC original).
const D3DFMT_A8R8G8B8 = 21;  // 0x15
const D3DFMT_A8B8G8R8 = 32;  // 0x20

// DXGI_FORMAT values for Remastered (BPR) textures.
const DXGI_BC1_UNORM      = 71;  // DXT1
const DXGI_BC1_UNORM_SRGB = 72;
const DXGI_BC2_UNORM      = 74;  // DXT3
const DXGI_BC2_UNORM_SRGB = 75;
const DXGI_BC3_UNORM      = 77;  // DXT5
const DXGI_BC3_UNORM_SRGB = 78;
const DXGI_B8G8R8A8_UNORM = 87;
const DXGI_B8G8R8A8_SRGB  = 91;
const DXGI_R8G8B8A8_UNORM = 28;
const DXGI_R8G8B8A8_SRGB  = 29;

// =============================================================================
// Types
// =============================================================================

/**
 * Texture pixel format — either a FourCC-derived tag or a numeric D3DFORMAT.
 *
 * Following Volatility's approach: the 4-byte OutputFormat field is first
 * tested as an ASCII FourCC string. If it matches a known codec it maps to
 * a tag. Otherwise the raw 4-byte little-endian int is used as a D3DFORMAT.
 */
export type TextureFormat =
	| 'DXT1'
	| 'DXT3'
	| 'DXT5'
	| 'A8R8G8B8'
	| 'A8B8G8R8'
	| 'B8G8R8A8'
	| 'R8G8B8A8'
	| 'UNKNOWN';

export type ParsedTextureHeader = {
	format: TextureFormat;
	/** Raw 4-byte format value as u32 (for diagnostics). */
	formatRaw: number;
	width: number;
	height: number;
	depth: number;
	mipLevels: number;
	textureType: number;
	flags: number;
};

export type DecodedTexture = {
	header: ParsedTextureHeader;
	/** RGBA pixel data for mip level 0. Length = width × height × 4. */
	pixels: Uint8Array;
};

// =============================================================================
// Header parsing
// =============================================================================

/**
 * Identify the texture format from the 4-byte OutputFormat field.
 *
 * Volatility's PullInternalFormat() tries ASCII first, then falls back to
 * interpreting the bytes as a D3DFORMAT int.
 */
function identifyD3DFormat(raw: number): TextureFormat {
	switch (raw) {
		case FOURCC_DXT1: return 'DXT1';
		case FOURCC_DXT3: return 'DXT3';
		case FOURCC_DXT5: return 'DXT5';
		case D3DFMT_A8R8G8B8: return 'A8R8G8B8';
		case D3DFMT_A8B8G8R8: return 'A8B8G8R8';
		default: return 'UNKNOWN';
	}
}

function identifyDxgiFormat(raw: number): TextureFormat {
	switch (raw) {
		case DXGI_BC1_UNORM:
		case DXGI_BC1_UNORM_SRGB: return 'DXT1';
		case DXGI_BC2_UNORM:
		case DXGI_BC2_UNORM_SRGB: return 'DXT3';
		case DXGI_BC3_UNORM:
		case DXGI_BC3_UNORM_SRGB: return 'DXT5';
		case DXGI_B8G8R8A8_UNORM:
		case DXGI_B8G8R8A8_SRGB: return 'B8G8R8A8';
		case DXGI_R8G8B8A8_UNORM:
		case DXGI_R8G8B8A8_SRGB: return 'R8G8B8A8';
		default: return 'UNKNOWN';
	}
}

/**
 * Detect whether a texture header is PC original (0x20 bytes) or
 * Remastered/BPR (0x40 for 32-bit, 0x58 for 64-bit).
 *
 * Heuristic: BPR headers have a Dimension field (6–9) at offset +0x08.
 * PC original headers have padding (0) at +0x08 and D3DPOOL at +0x0C.
 * Additionally, BPR headers are >= 0x40 bytes while PC is exactly 0x20.
 */
function isBprHeader(block0: Uint8Array): boolean {
	if (block0.byteLength < 0x20) return false;
	const dv = new DataView(block0.buffer, block0.byteOffset, block0.byteLength);
	// BPR Dimension field at +0x08 is 6–9.
	const dim = dv.getUint32(0x08, true);
	if (dim >= 6 && dim <= 9 && block0.byteLength >= 0x30) return true;
	return false;
}

/**
 * Parse a texture header from block 0.
 *
 * Auto-detects PC original vs Remastered (BPR) format.
 *
 * PC original layout (TexturePC.ParseFromStream):
 *   +0x10  4B    OutputFormat (FourCC or D3DFORMAT)
 *   +0x14  u16   Width
 *   +0x16  u16   Height
 *   +0x18  u8    Depth
 *   +0x19  u8    MipmapLevels
 *
 * BPR 32-bit layout (TextureBPR.ParseFromStream):
 *   +0x1C  u32   DXGI_FORMAT
 *   +0x24  u16   Width
 *   +0x26  u16   Height
 *   +0x28  u16   Depth
 *   +0x2D  u8    MipmapLevels
 */
export function parseTextureHeader(block0: Uint8Array): ParsedTextureHeader {
	if (block0.byteLength < 0x1C) {
		throw new BundleError(
			`Texture header too small: ${block0.byteLength} bytes (need >= 0x1C)`,
			'PARSE_ERROR',
		);
	}
	const dv = new DataView(block0.buffer, block0.byteOffset, block0.byteLength);

	if (isBprHeader(block0)) {
		// Remastered / BPR 32-bit format.
		if (block0.byteLength < 0x2E) {
			throw new BundleError(
				`BPR texture header too small: ${block0.byteLength} bytes (need >= 0x2E)`,
				'PARSE_ERROR',
			);
		}
		const formatRaw = dv.getUint32(0x1C, true);
		const format = identifyDxgiFormat(formatRaw);
		const width = dv.getUint16(0x24, true);
		const height = dv.getUint16(0x26, true);
		const depth = dv.getUint16(0x28, true);
		const mipLevels = block0[0x2D];
		const textureType = dv.getUint32(0x08, true); // Dimension
		const flags = dv.getUint32(0x20, true);        // BPR flags

		return { format, formatRaw, width, height, depth, mipLevels, textureType, flags };
	}

	// PC original format.
	const formatRaw = dv.getUint32(0x10, true);
	const format = identifyD3DFormat(formatRaw);
	const width = dv.getUint16(0x14, true);
	const height = dv.getUint16(0x16, true);
	const depth = block0[0x18];
	const mipLevels = block0[0x19];
	const textureType = block0[0x1A];
	const flags = block0[0x1B];

	return { format, formatRaw, width, height, depth, mipLevels, textureType, flags };
}

// =============================================================================
// Pixel decoding
// =============================================================================

/**
 * Decode mip level 0 from raw pixel data. Returns RGBA Uint8Array.
 *
 * For DXT: delegates to decodeDXT1 / decodeDXT5 which output RGBA directly.
 *
 * For A8R8G8B8: on-disk order is [A, R, G, B] per Volatility's
 * DDSTextureUtilities.A8R8G8B8toR8G8B8A8 — swizzle to [R, G, B, A].
 *
 * For A8B8G8R8: on-disk order is [A, B, G, R] — swizzle to [R, G, B, A].
 */
export function decodeTexturePixels(
	header: ParsedTextureHeader,
	pixelData: Uint8Array,
): Uint8Array {
	const { width, height, format } = header;

	switch (format) {
		case 'DXT1':
			return decodeDXT1(pixelData, width, height);

		case 'DXT5':
			return decodeDXT5(pixelData, width, height);

		case 'A8R8G8B8': {
			// On-disk: [A, R, G, B] → output [R, G, B, A]
			const pixelCount = width * height;
			const out = new Uint8Array(pixelCount * 4);
			for (let i = 0; i < pixelCount; i++) {
				const si = i * 4;
				const di = i * 4;
				out[di]     = pixelData[si + 1]; // R
				out[di + 1] = pixelData[si + 2]; // G
				out[di + 2] = pixelData[si + 3]; // B
				out[di + 3] = pixelData[si];     // A
			}
			return out;
		}

		case 'A8B8G8R8': {
			// On-disk: [A, B, G, R] → output [R, G, B, A]
			const pixelCount = width * height;
			const out = new Uint8Array(pixelCount * 4);
			for (let i = 0; i < pixelCount; i++) {
				const si = i * 4;
				const di = i * 4;
				out[di]     = pixelData[si + 3]; // R
				out[di + 1] = pixelData[si + 2]; // G
				out[di + 2] = pixelData[si + 1]; // B
				out[di + 3] = pixelData[si];     // A
			}
			return out;
		}

		case 'B8G8R8A8': {
			// On-disk: [B, G, R, A] → output [R, G, B, A]
			const pixelCount = width * height;
			const out = new Uint8Array(pixelCount * 4);
			for (let i = 0; i < pixelCount; i++) {
				const si = i * 4;
				const di = i * 4;
				out[di]     = pixelData[si + 2]; // R
				out[di + 1] = pixelData[si + 1]; // G
				out[di + 2] = pixelData[si];     // B
				out[di + 3] = pixelData[si + 3]; // A
			}
			return out;
		}

		case 'R8G8B8A8':
			// Already RGBA — return as-is.
			return pixelData.slice(0, width * height * 4);

		case 'DXT3':
			// DXT3 is rare in Burnout; fall through to unsupported for now.
		default:
			throw new BundleError(
				`Unsupported texture format: ${format} (raw 0x${header.formatRaw.toString(16)})`,
				'PARSE_ERROR',
			);
	}
}

// =============================================================================
// Full decode
// =============================================================================

/**
 * Extract, parse, and decode a Texture resource from a bundle.
 *
 * Block 0 = header (Main Memory), block 1 = pixel data (Disposable).
 */
export function decodeTexture(
	buffer: ArrayBuffer,
	bundle: ParsedBundle,
	resource: ResourceEntry,
): DecodedTexture {
	const blocks = getResourceBlocks(buffer, bundle, resource);
	const headerBlock = blocks[0];
	const pixelBlock = blocks[1];

	if (!headerBlock) {
		throw new BundleError(
			`Texture resource has no header block`,
			'RESOURCE_EMPTY',
		);
	}
	if (!pixelBlock || pixelBlock.byteLength === 0) {
		throw new BundleError(
			`Texture resource has no pixel data block`,
			'RESOURCE_EMPTY',
		);
	}

	const header = parseTextureHeader(headerBlock);
	const pixels = decodeTexturePixels(header, pixelBlock);
	return { header, pixels };
}
