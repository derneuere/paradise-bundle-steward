// BC1 (DXT1) and BC3 (DXT5) block-compression decoders.
//
// Pure math — no dependencies. Outputs RGBA Uint8Array (4 bytes per pixel).
//
// Reference:
//   - Microsoft DXT specification
//   - Volatility: volatility/Volatility/Utilities/DDSTextureUtilities.cs
//   - BundleManager: repo/BurnoutImage/GameImage.cs (BCnEncoder path)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Unpack a 16-bit RGB565 color to [R, G, B] in 0–255 range. */
function unpackRgb565(c: number): [number, number, number] {
	const r = ((c >> 11) & 0x1f) * 255 / 31;
	const g = ((c >> 5) & 0x3f) * 255 / 63;
	const b = (c & 0x1f) * 255 / 31;
	return [r | 0, g | 0, b | 0];
}

// ---------------------------------------------------------------------------
// BC1 (DXT1)
// ---------------------------------------------------------------------------

/**
 * Decode a BC1 (DXT1) compressed buffer into RGBA pixels.
 *
 * BC1: 8 bytes per 4×4 block.
 *   - 2 × RGB565 color endpoints (4 bytes)
 *   - 4 × 8-bit rows of 2-bit per-pixel selectors (4 bytes)
 *
 * When c0 > c1 the palette has 4 opaque colors.
 * When c0 ≤ c1 the palette has 3 colors + 1 transparent black (1-bit alpha).
 */
export function decodeDXT1(
	src: Uint8Array,
	width: number,
	height: number,
): Uint8Array {
	const blocksX = Math.max(1, (width + 3) >> 2);
	const blocksY = Math.max(1, (height + 3) >> 2);
	const out = new Uint8Array(width * height * 4);
	const dv = new DataView(src.buffer, src.byteOffset, src.byteLength);

	let blockOff = 0;
	for (let by = 0; by < blocksY; by++) {
		for (let bx = 0; bx < blocksX; bx++) {
			const c0 = dv.getUint16(blockOff + 0, true);
			const c1 = dv.getUint16(blockOff + 2, true);
			const bits = dv.getUint32(blockOff + 4, true);

			const [r0, g0, b0] = unpackRgb565(c0);
			const [r1, g1, b1] = unpackRgb565(c1);

			// Build 4-color palette
			const palette = new Uint8Array(16); // 4 colors × 4 components
			palette[0] = r0; palette[1] = g0; palette[2] = b0; palette[3] = 255;
			palette[4] = r1; palette[5] = g1; palette[6] = b1; palette[7] = 255;

			if (c0 > c1) {
				// 4-color mode: c2 = 2/3*c0 + 1/3*c1, c3 = 1/3*c0 + 2/3*c1
				palette[8]  = (2 * r0 + r1 + 1) / 3 | 0;
				palette[9]  = (2 * g0 + g1 + 1) / 3 | 0;
				palette[10] = (2 * b0 + b1 + 1) / 3 | 0;
				palette[11] = 255;
				palette[12] = (r0 + 2 * r1 + 1) / 3 | 0;
				palette[13] = (g0 + 2 * g1 + 1) / 3 | 0;
				palette[14] = (b0 + 2 * b1 + 1) / 3 | 0;
				palette[15] = 255;
			} else {
				// 3-color + transparent mode: c2 = 1/2*c0 + 1/2*c1, c3 = transparent black
				palette[8]  = (r0 + r1 + 1) >> 1;
				palette[9]  = (g0 + g1 + 1) >> 1;
				palette[10] = (b0 + b1 + 1) >> 1;
				palette[11] = 255;
				palette[12] = 0; palette[13] = 0; palette[14] = 0; palette[15] = 0;
			}

			// Write 4×4 pixels
			for (let py = 0; py < 4; py++) {
				const y = by * 4 + py;
				if (y >= height) break;
				for (let px = 0; px < 4; px++) {
					const x = bx * 4 + px;
					if (x >= width) continue;
					const idx = (bits >> ((py * 4 + px) * 2)) & 0x3;
					const dst = (y * width + x) * 4;
					const src4 = idx * 4;
					out[dst]     = palette[src4];
					out[dst + 1] = palette[src4 + 1];
					out[dst + 2] = palette[src4 + 2];
					out[dst + 3] = palette[src4 + 3];
				}
			}

			blockOff += 8;
		}
	}

	return out;
}

// ---------------------------------------------------------------------------
// BC3 (DXT5)
// ---------------------------------------------------------------------------

/**
 * Decode a BC3 (DXT5) compressed buffer into RGBA pixels.
 *
 * BC3: 16 bytes per 4×4 block.
 *   - 8 bytes: alpha block (2 × u8 endpoints + 48-bit 3-bit-per-pixel table)
 *   - 8 bytes: BC1 color block (same as DXT1 but always 4-color mode)
 */
export function decodeDXT5(
	src: Uint8Array,
	width: number,
	height: number,
): Uint8Array {
	const blocksX = Math.max(1, (width + 3) >> 2);
	const blocksY = Math.max(1, (height + 3) >> 2);
	const out = new Uint8Array(width * height * 4);
	const dv = new DataView(src.buffer, src.byteOffset, src.byteLength);

	let blockOff = 0;
	for (let by = 0; by < blocksY; by++) {
		for (let bx = 0; bx < blocksX; bx++) {
			// ---- Alpha block (8 bytes) ----
			const a0 = src[blockOff];
			const a1 = src[blockOff + 1];

			// 48-bit alpha index table (6 bytes, 3 bits per pixel)
			// Read as a 48-bit value in LE order.
			const alphaBits =
				src[blockOff + 2]
				| (src[blockOff + 3] << 8)
				| (src[blockOff + 4] << 16)
				| ((src[blockOff + 5] << 24) >>> 0); // low 32 bits
			const alphaBitsHi =
				src[blockOff + 6]
				| (src[blockOff + 7] << 8); // high 16 bits

			// Build 8-value alpha palette
			const alphaPalette = new Uint8Array(8);
			alphaPalette[0] = a0;
			alphaPalette[1] = a1;
			if (a0 > a1) {
				alphaPalette[2] = (6 * a0 + 1 * a1 + 3) / 7 | 0;
				alphaPalette[3] = (5 * a0 + 2 * a1 + 3) / 7 | 0;
				alphaPalette[4] = (4 * a0 + 3 * a1 + 3) / 7 | 0;
				alphaPalette[5] = (3 * a0 + 4 * a1 + 3) / 7 | 0;
				alphaPalette[6] = (2 * a0 + 5 * a1 + 3) / 7 | 0;
				alphaPalette[7] = (1 * a0 + 6 * a1 + 3) / 7 | 0;
			} else {
				alphaPalette[2] = (4 * a0 + 1 * a1 + 2) / 5 | 0;
				alphaPalette[3] = (3 * a0 + 2 * a1 + 2) / 5 | 0;
				alphaPalette[4] = (2 * a0 + 3 * a1 + 2) / 5 | 0;
				alphaPalette[5] = (1 * a0 + 4 * a1 + 2) / 5 | 0;
				alphaPalette[6] = 0;
				alphaPalette[7] = 255;
			}

			// ---- Color block (8 bytes, same as BC1 4-color mode) ----
			const colorOff = blockOff + 8;
			const c0 = dv.getUint16(colorOff + 0, true);
			const c1 = dv.getUint16(colorOff + 2, true);
			const bits = dv.getUint32(colorOff + 4, true);

			const [r0, g0, b0] = unpackRgb565(c0);
			const [r1, g1, b1] = unpackRgb565(c1);

			const palette = new Uint8Array(12); // 4 colors × 3 (RGB only, alpha separate)
			palette[0] = r0; palette[1] = g0; palette[2] = b0;
			palette[3] = r1; palette[4] = g1; palette[5] = b1;
			palette[6]  = (2 * r0 + r1 + 1) / 3 | 0;
			palette[7]  = (2 * g0 + g1 + 1) / 3 | 0;
			palette[8]  = (2 * b0 + b1 + 1) / 3 | 0;
			palette[9]  = (r0 + 2 * r1 + 1) / 3 | 0;
			palette[10] = (g0 + 2 * g1 + 1) / 3 | 0;
			palette[11] = (b0 + 2 * b1 + 1) / 3 | 0;

			// Write 4×4 pixels
			for (let py = 0; py < 4; py++) {
				const y = by * 4 + py;
				if (y >= height) break;
				for (let px = 0; px < 4; px++) {
					const x = bx * 4 + px;
					if (x >= width) continue;

					const pixelIndex = py * 4 + px;

					// Alpha: 3-bit index from the 48-bit table
					let alphaIdx: number;
					if (pixelIndex < 16) {
						// First 32 bits hold pixels 0–10 (bits 0..32), remaining from hi
						const bitPos = pixelIndex * 3;
						if (bitPos < 32) {
							alphaIdx = (alphaBits >> bitPos) & 0x7;
							// Handle straddling the 32-bit boundary
							if (bitPos > 29) {
								alphaIdx |= (alphaBitsHi << (32 - bitPos)) & 0x7;
							}
						} else {
							alphaIdx = (alphaBitsHi >> (bitPos - 32)) & 0x7;
						}
					} else {
						alphaIdx = 0;
					}

					// Color: 2-bit index
					const colorIdx = (bits >> (pixelIndex * 2)) & 0x3;

					const dst = (y * width + x) * 4;
					const csrc = colorIdx * 3;
					out[dst]     = palette[csrc];
					out[dst + 1] = palette[csrc + 1];
					out[dst + 2] = palette[csrc + 2];
					out[dst + 3] = alphaPalette[alphaIdx];
				}
			}

			blockOff += 16;
		}
	}

	return out;
}
