// MC02 checksum — EA's "Memory Card v2" save protection used by Xbox 360
// Burnout Paradise profiles. Ported verbatim from the public reversal of the
// Dead Space MC02 fixer (https://gist.github.com/Experiment5X/5025310), which
// is the reference implementation the wiki points at.
//
// WHY this is its own function and not a standard CRC-32: the algorithm is an
// MSB-first CRC with polynomial 0x04C11DB7, BUT it seeds from the first four
// bytes of the buffer (seed = ~(big-endian u32 of bytes[0..4])) and then folds
// the remaining bytes with `table[idx] ^ ((crc << 8) | byte)` — note the byte is
// OR'd into the low bits rather than XOR'd into the table index. Using an
// off-the-shelf CRC-32 produces the wrong value and the 360 rejects the save.
//
// NOTE: only the X360 variant uses MC02. We have no X360 fixture to validate
// against, so the recompute path is implemented per the public algorithm but is
// untested on a real console save. The RGMH (PC) path needs no checksum.

// Standard MSB-first CRC-32 table for polynomial 0x04C11DB7. table[1] === the
// polynomial, matching the constants in the reference gist.
const TABLE: Uint32Array = (() => {
	const t = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = (n << 24) >>> 0;
		for (let k = 0; k < 8; k++) {
			c = (c & 0x80000000) !== 0 ? ((c << 1) ^ 0x04c11db7) >>> 0 : (c << 1) >>> 0;
		}
		t[n] = c >>> 0;
	}
	return t;
})();

/**
 * Compute the MC02 checksum over `data` (a contiguous byte range). Returns an
 * unsigned 32-bit value. Mirrors `MC02(const BYTE* pb, DWORD cb)` from the gist.
 */
export function mc02Checksum(data: Uint8Array): number {
	const cb = data.length;
	if (cb < 4) return 0;

	// seed = ~(big-endian u32 of the first four bytes)
	let seed =
		~(((data[0] << 24) | (data[1] << 16) | (data[2] << 8) | data[3]) >>> 0) >>> 0;

	for (let i = 4; i < cb; i++) {
		const idx = (seed >>> 24) & 0xff; // == ((seed >> 22) & 0x3FC) >> 2
		const looked = TABLE[idx];
		const inserted = (((seed << 8) >>> 0) | data[i]) >>> 0;
		seed = (looked ^ inserted) >>> 0;
	}

	return ~seed >>> 0;
}
