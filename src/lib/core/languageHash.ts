// Burnout Paradise "Language hash" — JAMCRC of a name string.
//
// The wiki's Common Data Types page defines a Language hash as the JAMCRC of
// an entry name (JAMCRC = reflected CRC-32, init 0xFFFFFFFF, poly 0xEDB88320,
// WITHOUT the final XOR — i.e. the bitwise NOT of a standard CRC-32). The
// Comms Database uses it everywhere: a CommsToolListDefinition's name hash is
// languageHash('Gameplay') and its per-field category / field-name hash chunks
// are languageHash of strings recovered from the executable (verified against
// example/DOWNLOADED/GAMEPLAY.BIN — all 205 fields match the wiki tables).
//
// Implemented locally (not node:zlib's crc32) because src/lib/core runs in
// the browser. Case-SENSITIVE, unlike CgsID encoding — languageHash('Gameplay')
// is 0x0E31492C but languageHash('GAMEPLAY') is not.

const CRC_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) {
			c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		}
		table[n] = c >>> 0;
	}
	return table;
})();

/** JAMCRC of the UTF-8 bytes of `name`. Returns an unsigned u32. */
export function languageHash(name: string): number {
	const bytes = new TextEncoder().encode(name);
	let crc = 0xffffffff;
	for (let i = 0; i < bytes.length; i++) {
		crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
	}
	// JAMCRC skips the standard final XOR with 0xFFFFFFFF.
	return crc >>> 0;
}
