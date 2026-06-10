// ColourCube parser and writer (resource type 0x2B, rw::graphics::postfx::ColourCube).
//
// A ColourCube is a 3D CLUT (colour look-up table) used by EnvironmentSettings
// and PostFX to grade and tone-map the whole frame: the renderer feeds each
// output pixel's RGB through the cube, with input Red indexing the X axis,
// Green the Y axis, and Blue the Z axis (verified on retail bytes — the
// (max,0,0) corner texel is pure red, (0,max,0) pure green, (0,0,max) pure
// blue, so a neutral cube maps every colour to itself).
//
// On-disk layout (32-bit PC, little-endian):
//   0x00  u32  m_size    — texels per axis (retail: 32)
//   0x04  u32  m_pixels  — file-relative offset of the texel data, fixed up
//                          to a pointer at load. Always 0x10.
//   0x08  u32×2          — header pad to 16 bytes (0 in retail)
//   0x10  u8[m_size³ × 3] — dense RGB24 body, X-major:
//                          texel(x,y,z) at (m_size²·z + m_size·y + x) × 3
//
// The wiki's 32-bit struct only documents the first 8 bytes, but its own
// file-size formula (m_size³ × 3 + 16) implies the 16-byte header — confirmed
// against every fixture (m_size 32 → 98 320 bytes exactly).
//
// All four retail DLC24HR fixtures carry the SAME payload: a "default RGB
// CLUT" (the 1.6 update reverted the art-style cubes to one, per the wiki).
// That default is perfectly separable — texel(x,y,z) = (ramp[x], ramp[y],
// ramp[z]) for a single shared 32-entry S-curve ramp — i.e. just a per-channel
// tone curve, no cross-channel grading.
//
// Round-trip strategy: the body is opaque bytes preserved verbatim; m_pixels
// is recomputed (always 0x10) and asserted on read; the header pad words are
// preserved verbatim in _-prefixed fields. Byte-exact by construction.

import { BinReader, BinWriter } from './binTools';

// =============================================================================
// Types
// =============================================================================

export type ParsedColourCube = {
	/** Texels per axis — the cube holds mSize³ RGB24 texels. Retail: 32. */
	mSize: number;
	/** Dense RGB24 body, mSize³ × 3 bytes, X-major (see file header). */
	pixels: Uint8Array;
	/** Header pad words at 0x8 / 0xC (0 in retail) — preserved verbatim. */
	_pad08: number;
	_pad0C: number;
};

// =============================================================================
// Constants
// =============================================================================

export const COLOURCUBE_HEADER_SIZE = 0x10;
const BYTES_PER_TEXEL = 3;

// =============================================================================
// Texel access — shared by the preview path, stress scenarios, and tests.
// =============================================================================

function texelByteOffset(model: ParsedColourCube, x: number, y: number, z: number): number {
	const s = model.mSize;
	if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(z)
		|| x < 0 || y < 0 || z < 0 || x >= s || y >= s || z >= s) {
		throw new Error(`ColourCube: texel (${x},${y},${z}) outside the ${s}^3 cube`);
	}
	return (s * s * z + s * y + x) * BYTES_PER_TEXEL;
}

/** Output colour for LUT coordinate (x,y,z) — input R selects x, G y, B z. */
export function colourCubeTexel(
	model: ParsedColourCube, x: number, y: number, z: number,
): { r: number; g: number; b: number } {
	const off = texelByteOffset(model, x, y, z);
	return { r: model.pixels[off], g: model.pixels[off + 1], b: model.pixels[off + 2] };
}

/** Overwrite one texel in place (callers own cloning; stress runners pass clones). */
export function setColourCubeTexel(
	model: ParsedColourCube, x: number, y: number, z: number,
	rgb: { r: number; g: number; b: number },
): void {
	const off = texelByteOffset(model, x, y, z);
	model.pixels[off] = rgb.r & 0xff;
	model.pixels[off + 1] = rgb.g & 0xff;
	model.pixels[off + 2] = rgb.b & 0xff;
}

// =============================================================================
// Reader
// =============================================================================

export function parseColourCube(raw: Uint8Array, littleEndian = true): ParsedColourCube {
	if (raw.byteLength < COLOURCUBE_HEADER_SIZE) {
		throw new Error(`ColourCube: ${raw.byteLength} bytes is smaller than the 0x10 header`);
	}
	const r = new BinReader(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength), littleEndian);
	const mSize = r.readU32();
	const mPixels = r.readU32();
	const _pad08 = r.readU32();
	const _pad0C = r.readU32();

	// The layout is rigid; bail loudly on violations rather than silently
	// producing a model that won't round-trip.
	if (mPixels !== COLOURCUBE_HEADER_SIZE) {
		throw new Error(`ColourCube: m_pixels is 0x${mPixels.toString(16)}, expected 0x10 (rigid layout)`);
	}
	const expectedSize = COLOURCUBE_HEADER_SIZE + mSize * mSize * mSize * BYTES_PER_TEXEL;
	if (raw.byteLength !== expectedSize) {
		throw new Error(`ColourCube: resource is ${raw.byteLength} bytes, expected ${expectedSize} for m_size ${mSize} (m_size^3*3+16)`);
	}

	// Copy, never view: extractResourceRaw can hand back a Node Buffer whose
	// .slice/.subarray alias the bundle bytes — a view would let texel edits
	// corrupt the source buffer.
	const pixels = new Uint8Array(raw.subarray(COLOURCUBE_HEADER_SIZE, expectedSize));

	return { mSize, pixels, _pad08, _pad0C };
}

// =============================================================================
// Writer
// =============================================================================

export function writeColourCube(model: ParsedColourCube, littleEndian = true): Uint8Array {
	const expectedPixelBytes = model.mSize * model.mSize * model.mSize * BYTES_PER_TEXEL;
	if (model.pixels.byteLength !== expectedPixelBytes) {
		throw new Error(`ColourCube writer: ${model.pixels.byteLength} pixel bytes != m_size ${model.mSize} cube (${expectedPixelBytes})`);
	}

	const w = new BinWriter(COLOURCUBE_HEADER_SIZE + expectedPixelBytes, littleEndian);
	w.writeU32(model.mSize);
	w.writeU32(COLOURCUBE_HEADER_SIZE); // m_pixels — recomputed, never stored
	w.writeU32(model._pad08);
	w.writeU32(model._pad0C);
	if (w.offset !== COLOURCUBE_HEADER_SIZE) {
		throw new Error(`ColourCube writer: header offset mismatch ${w.offset} vs ${COLOURCUBE_HEADER_SIZE}`);
	}
	w.writeBytes(model.pixels);
	return w.bytes;
}
