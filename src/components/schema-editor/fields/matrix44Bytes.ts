// Float32 ↔ hex-byte helpers for Matrix44Field's "raw bytes" line.
//
// The game stores Matrix44Affine as 16 little-endian float32s (64 bytes) in
// row-major order, with slots 0..11 holding the rotation+scale rows and
// slots 12..15 holding translation. When users lift rotation data from
// game memory they typically copy just the 48-byte rotation portion —
// these helpers accept both widths so paste-from-memory and paste the full
// matrix both work.

// Scratch buffer reused across calls — avoids allocation in tight loops.
const _scratch = new ArrayBuffer(4);
const _scratchView = new DataView(_scratch);

function floatToBytes(f: number): [number, number, number, number] {
	_scratchView.setFloat32(0, f, /* littleEndian */ true);
	return [
		_scratchView.getUint8(0),
		_scratchView.getUint8(1),
		_scratchView.getUint8(2),
		_scratchView.getUint8(3),
	];
}

function bytesToFloat(b0: number, b1: number, b2: number, b3: number): number {
	_scratchView.setUint8(0, b0);
	_scratchView.setUint8(1, b1);
	_scratchView.setUint8(2, b2);
	_scratchView.setUint8(3, b3);
	return _scratchView.getFloat32(0, /* littleEndian */ true);
}

function pad2(n: number): string {
	return n.toString(16).padStart(2, '0').toUpperCase();
}

/**
 * Serialize `floats` to a hex string with space-separated uppercase byte
 * pairs. Each float takes 4 bytes little-endian, so 12 floats → 48 bytes
 * (48 byte pairs → 143 chars including separators) and 16 floats → 64.
 */
export function floatsToHex(floats: readonly number[]): string {
	const parts: string[] = [];
	for (let i = 0; i < floats.length; i++) {
		const [b0, b1, b2, b3] = floatToBytes(floats[i] ?? 0);
		parts.push(pad2(b0), pad2(b1), pad2(b2), pad2(b3));
	}
	return parts.join(' ');
}

/**
 * Parse a user-entered hex string. Accepts any amount of whitespace
 * between pairs, case-insensitive. Pairs may optionally carry a `0x`
 * prefix. Returns either the parsed bytes (only when the total is
 * exactly 48 or 64) or an error message suitable for inline display.
 */
export function parseHex(input: string): { bytes: Uint8Array } | { error: string } {
	// Strip whitespace, commas, `0x` prefixes. Keep only hex digits.
	const cleaned = input
		.replace(/0x/gi, '')
		.replace(/[^0-9a-fA-F]/g, '');
	if (cleaned.length === 0) return { error: 'No hex digits found.' };
	if (cleaned.length % 2 !== 0) return { error: `Odd number of hex digits (${cleaned.length}).` };
	const byteCount = cleaned.length / 2;
	if (byteCount !== 48 && byteCount !== 64) {
		return { error: `Expected 48 or 64 bytes, got ${byteCount}.` };
	}
	const bytes = new Uint8Array(byteCount);
	for (let i = 0; i < byteCount; i++) {
		bytes[i] = parseInt(cleaned.slice(i * 2, i * 2 + 2), 16);
	}
	return { bytes };
}

/**
 * Convert a 48- or 64-byte little-endian float32 buffer into a plain
 * number[] (12 or 16 entries).
 */
export function bytesToFloats(bytes: Uint8Array): number[] {
	if (bytes.length % 4 !== 0) {
		throw new Error(`bytesToFloats: length ${bytes.length} is not a multiple of 4`);
	}
	const out: number[] = [];
	for (let i = 0; i < bytes.length; i += 4) {
		out.push(bytesToFloat(bytes[i], bytes[i + 1], bytes[i + 2], bytes[i + 3]));
	}
	return out;
}
