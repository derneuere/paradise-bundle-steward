// TextureNameMap parser and writer (resource type 0x1000B).
//
// The particles bundle's texture string table: it maps the FNV-1a hash of a
// Lion texture name to the full gamedb TextureConfig2d URI the engine loads
// for it. Particle materials (cParticleMaterial inside ParticleDescription
// resources) reference textures only by that hash — this map is how the hash
// becomes a real asset path at runtime.
//
// The hashed string is NOT the stored URI: it is the texture's bare name —
// the URI's basename with path, extension, and ?ID= query stripped (e.g.
// "gamedb://burnout5/Burnout/Effects/Textures/SparkBlast.TextureConfig2d
// ?ID=245985" hashes as "sparkblast"). lionFnv1a below is the standard 32-bit
// FNV-1a (basis 0x811C9DC5, prime 0x01000193) with ASCII A–Z folded to
// lowercase, verified against all 50 retail entries. The wiki only says
// "lowercased FNV-1a" without naming the hashed substring.
//
// On-disk layout (32-bit PC LE), fully derived — no preserved fields needed:
//   0x00 u32 mpEntries   — always 0x10 (entries start right after the
//                          16-byte-aligned header)
//   0x04 u32 muEntryCount
//   0x08 8 zero bytes    — header pad to 0x10
//   0x10 entries[n]      — { u32 hash, u32 string offset } each
//   then strings, in ENTRY ORDER: each null-terminated, zero-padded so every
//   string starts on a 16-byte boundary; the payload ends at the last slot's
//   end. (Entry count 50 makes the entries end 16-aligned in retail; the
//   align-up before the first string is this writer's choice for odd counts.)

import { BinReader, BinWriter } from './binTools';

export type TextureNameMapEntry = {
	/** FNV-1a (lowercased) of the bare texture name — derived from mGDBTextureName. */
	muHashedLionTextureName: number;
	/** Full gamedb TextureConfig2d URI, e.g. gamedb://burnout5/.../SparkBlast.TextureConfig2d?ID=245985 */
	mGDBTextureName: string;
};

export type ParsedTextureNameMap = {
	entries: TextureNameMapEntry[];
};

const ENTRIES_OFFSET = 0x10;
const ENTRY_SIZE = 0x8;

const align16 = (n: number) => (n + 15) & ~15;

/** Standard 32-bit FNV-1a with ASCII A–Z folded to lowercase — the Lion hash
 *  used by TextureNameMap entries and ParticleDescription resource ids. */
export function lionFnv1a(str: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < str.length; i++) {
		let c = str.charCodeAt(i);
		if (c >= 0x41 && c <= 0x5a) c += 0x20;
		h ^= c;
		h = Math.imul(h, 0x01000193) >>> 0;
	}
	return h >>> 0;
}

/** Bare Lion texture name from a gamedb URI: basename, minus extension and ?ID= query. */
export function lionTextureName(gdbUri: string): string {
	const noQuery = gdbUri.split('?')[0];
	const base = noQuery.split('/').pop() ?? noQuery;
	return base.split('.')[0];
}

/** The hash a TextureNameMap entry must carry for a given GDB URI. */
export function hashLionTextureName(gdbUri: string): number {
	return lionFnv1a(lionTextureName(gdbUri));
}

export function parseTextureNameMap(raw: Uint8Array, littleEndian = true): ParsedTextureNameMap {
	const T = 'TextureNameMap';
	const buf = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
	const bytes = new Uint8Array(buf);
	const r = new BinReader(buf, littleEndian);

	const mpEntries = r.readU32();
	const muEntryCount = r.readU32();
	if (mpEntries !== ENTRIES_OFFSET) {
		throw new Error(`${T}: mpEntries is 0x${mpEntries.toString(16)}, expected 0x${ENTRIES_OFFSET.toString(16)} (rigid layout)`);
	}
	const pad8 = r.readU32();
	const padC = r.readU32();
	if (pad8 !== 0 || padC !== 0) {
		throw new Error(`${T}: header pad at 0x8 is (0x${pad8.toString(16)}, 0x${padC.toString(16)}), expected zeros`);
	}

	const entriesEnd = ENTRIES_OFFSET + muEntryCount * ENTRY_SIZE;
	if (entriesEnd > bytes.byteLength) {
		throw new Error(`${T}: ${muEntryCount} entries overrun the 0x${bytes.byteLength.toString(16)}-byte resource`);
	}

	// Strings are packed in entry order into 16-byte-aligned slots; the parser
	// recomputes each expected offset so the writer is provably its inverse.
	const td = new TextDecoder();
	const entries: TextureNameMapEntry[] = [];
	let cursor = align16(entriesEnd);
	for (let i = 0; i < muEntryCount; i++) {
		const muHashedLionTextureName = r.readU32();
		const strOffset = r.readU32();
		if (strOffset !== cursor) {
			throw new Error(`${T}: entry ${i} string at 0x${strOffset.toString(16)}, expected packed offset 0x${cursor.toString(16)}`);
		}
		let end = strOffset;
		while (end < bytes.byteLength && bytes[end] !== 0) end++;
		if (end >= bytes.byteLength) {
			throw new Error(`${T}: entry ${i} string at 0x${strOffset.toString(16)} is not null-terminated`);
		}
		const mGDBTextureName = td.decode(bytes.subarray(strOffset, end));
		const slotEnd = strOffset + align16(end - strOffset + 1);
		for (let b = end; b < Math.min(slotEnd, bytes.byteLength); b++) {
			if (bytes[b] !== 0) {
				throw new Error(`${T}: nonzero pad byte 0x${bytes[b].toString(16)} at 0x${b.toString(16)} after entry ${i}'s string`);
			}
		}
		cursor = slotEnd;
		entries.push({ muHashedLionTextureName, mGDBTextureName });
	}
	if (cursor !== bytes.byteLength) {
		throw new Error(`${T}: strings end at 0x${cursor.toString(16)} but the resource is 0x${bytes.byteLength.toString(16)} bytes`);
	}

	return { entries };
}

export function writeTextureNameMap(model: ParsedTextureNameMap, littleEndian = true): Uint8Array {
	const te = new TextEncoder();
	const encoded = model.entries.map((e) => te.encode(e.mGDBTextureName));

	const entriesEnd = ENTRIES_OFFSET + model.entries.length * ENTRY_SIZE;
	let cursor = align16(entriesEnd);
	const offsets: number[] = [];
	for (const s of encoded) {
		offsets.push(cursor);
		cursor += align16(s.byteLength + 1);
	}

	const w = new BinWriter(cursor, littleEndian);
	w.writeU32(ENTRIES_OFFSET);
	w.writeU32(model.entries.length);
	w.writeU32(0);
	w.writeU32(0);
	for (let i = 0; i < model.entries.length; i++) {
		w.writeU32(model.entries[i].muHashedLionTextureName);
		w.writeU32(offsets[i]);
	}
	for (let i = 0; i < encoded.length; i++) {
		w.writeZeroes(offsets[i] - w.offset);
		w.writeBytes(encoded[i]);
		w.writeU8(0);
	}
	w.writeZeroes(cursor - w.offset);
	return w.bytes;
}
