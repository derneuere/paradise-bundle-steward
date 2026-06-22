// Endian-aware scalar + structured reads/writes over a single backing buffer,
// addressed by absolute byte offset. The save-profile codec works "in place":
// edits patch the original bytes at known offsets rather than re-serialising a
// model, which keeps every untouched byte identical on save (the round-trip
// guarantee). These helpers are the leaf operations that engine.ts drives.

export type Endian = 'le' | 'be';

export const isLE = (e: Endian): boolean => e === 'le';

// --- scalar reads ----------------------------------------------------------

export function readU8(v: DataView, o: number): number { return v.getUint8(o); }
export function readI8(v: DataView, o: number): number { return v.getInt8(o); }
export function readU16(v: DataView, o: number, e: Endian): number { return v.getUint16(o, isLE(e)); }
export function readI16(v: DataView, o: number, e: Endian): number { return v.getInt16(o, isLE(e)); }
export function readU32(v: DataView, o: number, e: Endian): number { return v.getUint32(o, isLE(e)) >>> 0; }
export function readI32(v: DataView, o: number, e: Endian): number { return v.getInt32(o, isLE(e)) | 0; }
export function readF32(v: DataView, o: number, e: Endian): number { return v.getFloat32(o, isLE(e)); }

export function readU64(v: DataView, o: number, e: Endian): bigint {
	const lo = BigInt(v.getUint32(o + (isLE(e) ? 0 : 4), isLE(e)));
	const hi = BigInt(v.getUint32(o + (isLE(e) ? 4 : 0), isLE(e)));
	return (hi << 32n) | (lo & 0xffffffffn);
}

// --- scalar writes ---------------------------------------------------------

export function writeU8(v: DataView, o: number, x: number): void { v.setUint8(o, x & 0xff); }
export function writeI8(v: DataView, o: number, x: number): void { v.setInt8(o, x | 0); }
export function writeU16(v: DataView, o: number, x: number, e: Endian): void { v.setUint16(o, x & 0xffff, isLE(e)); }
export function writeI16(v: DataView, o: number, x: number, e: Endian): void { v.setInt16(o, x | 0, isLE(e)); }
export function writeU32(v: DataView, o: number, x: number, e: Endian): void { v.setUint32(o, x >>> 0, isLE(e)); }
export function writeI32(v: DataView, o: number, x: number, e: Endian): void { v.setInt32(o, x | 0, isLE(e)); }
export function writeF32(v: DataView, o: number, x: number, e: Endian): void { v.setFloat32(o, x, isLE(e)); }

export function writeU64(v: DataView, o: number, x: bigint, e: Endian): void {
	const lo = Number(x & 0xffffffffn) >>> 0;
	const hi = Number((x >> 32n) & 0xffffffffn) >>> 0;
	v.setUint32(o + (isLE(e) ? 0 : 4), lo, isLE(e));
	v.setUint32(o + (isLE(e) ? 4 : 0), hi, isLE(e));
}

// --- fixed-length strings --------------------------------------------------
// char[N]: single-byte, NUL-padded. Display value is trimmed at the first NUL;
// trailing bytes after the NUL are NOT preserved on rewrite (they are padding),
// but the codec only rewrites a string field when its display value changes.

export function readAscii(bytes: Uint8Array, o: number, len: number): string {
	let end = o;
	const limit = o + len;
	while (end < limit && bytes[end] !== 0) end++;
	return new TextDecoder('latin1').decode(bytes.subarray(o, end));
}

export function writeAscii(bytes: Uint8Array, o: number, len: number, str: string): void {
	bytes.fill(0, o, o + len);
	const enc = new TextEncoder().encode(str);
	const n = Math.min(enc.length, len - 1); // leave room for a NUL terminator
	bytes.set(enc.subarray(0, n), o);
}

// WCHAR[N] UTF-16LE wide string (RGMH header). `byteLen` is the field size in
// bytes (2 per char). Always little-endian — the Rich Game Media header is a
// Windows/PC structure regardless of game platform.
export function readWideString(bytes: Uint8Array, o: number, byteLen: number): string {
	let end = o;
	const limit = o + byteLen;
	while (end + 1 < limit && !(bytes[end] === 0 && bytes[end + 1] === 0)) end += 2;
	return new TextDecoder('utf-16le').decode(bytes.subarray(o, end));
}

export function writeWideString(bytes: Uint8Array, o: number, byteLen: number, str: string): void {
	bytes.fill(0, o, o + byteLen);
	const maxChars = byteLen / 2 - 1; // reserve a NUL terminator
	for (let i = 0; i < str.length && i < maxChars; i++) {
		const code = str.charCodeAt(i);
		bytes[o + i * 2] = code & 0xff;
		bytes[o + i * 2 + 1] = (code >> 8) & 0xff;
	}
}

// --- GUID ------------------------------------------------------------------
// Microsoft GUID on-disk layout: Data1 (u32 LE), Data2 (u16 LE), Data3 (u16
// LE), Data4 (8 bytes, big-endian / verbatim). Rendered canonically as
// {XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX}.

export function readGuid(bytes: Uint8Array, o: number): string {
	const hex = (i: number) => bytes[i].toString(16).padStart(2, '0');
	const d1 = `${hex(o + 3)}${hex(o + 2)}${hex(o + 1)}${hex(o + 0)}`;
	const d2 = `${hex(o + 5)}${hex(o + 4)}`;
	const d3 = `${hex(o + 7)}${hex(o + 6)}`;
	const d4 = `${hex(o + 8)}${hex(o + 9)}`;
	const d5 = `${hex(o + 10)}${hex(o + 11)}${hex(o + 12)}${hex(o + 13)}${hex(o + 14)}${hex(o + 15)}`;
	return `{${d1}-${d2}-${d3}-${d4}-${d5}}`.toUpperCase();
}

export function writeGuid(bytes: Uint8Array, o: number, guid: string): void {
	const h = guid.replace(/[{}-]/g, '');
	if (h.length !== 32) throw new Error(`invalid GUID: ${guid}`);
	const b = (i: number) => parseInt(h.slice(i * 2, i * 2 + 2), 16);
	// Data1 (LE)
	bytes[o + 0] = b(3); bytes[o + 1] = b(2); bytes[o + 2] = b(1); bytes[o + 3] = b(0);
	// Data2 (LE)
	bytes[o + 4] = b(5); bytes[o + 5] = b(4);
	// Data3 (LE)
	bytes[o + 6] = b(7); bytes[o + 7] = b(6);
	// Data4 (verbatim)
	for (let i = 8; i < 16; i++) bytes[o + i] = b(i);
}
