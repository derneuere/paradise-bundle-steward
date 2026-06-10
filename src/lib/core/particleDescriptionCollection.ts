// ParticleDescriptionCollection parser and writer (resource type 0x10008).
//
// The particles bundle's master list: one collection holds the set of
// ParticleDescription (0x1001D) resources the Lion particle system can spawn.
// On disk the resource is just a pointer table — mpTable points at muTableSize
// u32 slots, and the inline BND2 import table at the payload tail patches a
// ParticleDescription pointer into each slot at load (import i patches slot i,
// patch offset 0x8 + 4i). The import ids are FNV-1a hashes (lowercased) of the
// description's full gamedb URI — ParticleDescription is the one type whose
// resource ids are FNV-1a rather than crc32 (see docs/ParticleDescription.md).
//
// Wiki divergence: burnout.wiki calls the slot contents "ParticleDescription
// bundle import indices", but the retail bytes hold ONE-BASED ordinals 1..N
// (import index + 1), not zero-based indices. The values are dead weight —
// the loader overwrites every slot from the import table's patch offsets — so
// the parser asserts the 1..N pattern and the writer regenerates it.
//
// Between the table end and the import table sits a 16-byte zero pad whose
// rule is unknowable from the single retail fixture (the table end is already
// 16-aligned; the import table lands 64-aligned). It is preserved verbatim in
// _padAfterTable so the round-trip stays byte-exact either way.
//
// Scope: 32-bit PC, little-endian. Import entries are 16 bytes: u64 resource
// id, u32 payload-relative patch offset, u32 zero.

import { BinReader, BinWriter } from './binTools';

export type ParticleDescriptionRef = {
	/** ParticleDescription (0x1001D) resource id — FNV-1a (lowercased) of the description's full gamedb URI. */
	mDescriptionId: bigint;
};

export type ParsedParticleDescriptionCollection = {
	/** One entry per table slot, in slot order (= authoring order, not bundle order). */
	descriptions: ParticleDescriptionRef[];
	/** Zero bytes between the slot table and the inline import table (16 in retail). */
	_padAfterTable: Uint8Array;
};

const HEADER_SIZE = 0x8;
const TABLE_OFFSET = HEADER_SIZE;
const IMPORT_ENTRY_SIZE = 0x10;

export function parseParticleDescriptionCollection(
	raw: Uint8Array,
	littleEndian = true,
): ParsedParticleDescriptionCollection {
	const T = 'ParticleDescriptionCollection';
	// Copy up front — extractResourceRaw may hand back a Node Buffer whose
	// .buffer is the shared pool; slicing the copy keeps _padAfterTable safe.
	const buf = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
	const bytes = new Uint8Array(buf);
	const r = new BinReader(buf, littleEndian);

	const mpTable = r.readU32();
	const muTableSize = r.readU32();
	if (mpTable !== TABLE_OFFSET) {
		throw new Error(`${T}: mpTable is 0x${mpTable.toString(16)}, expected 0x${TABLE_OFFSET.toString(16)} (rigid layout)`);
	}
	const tableEnd = TABLE_OFFSET + muTableSize * 4;
	const importOffset = bytes.byteLength - muTableSize * IMPORT_ENTRY_SIZE;
	if (importOffset < tableEnd) {
		throw new Error(`${T}: ${muTableSize} entries don't fit a 0x${bytes.byteLength.toString(16)}-byte resource (table + one import each)`);
	}

	// --- Slot table: one-based ordinals the loader overwrites with pointers ---
	for (let i = 0; i < muTableSize; i++) {
		const slot = r.readU32();
		if (slot !== i + 1) {
			throw new Error(`${T}: table slot ${i} holds ${slot}, expected the one-based ordinal ${i + 1}`);
		}
	}

	const _padAfterTable = bytes.slice(tableEnd, importOffset);

	// --- Inline import table: import i patches slot i ---
	const descriptions: ParticleDescriptionRef[] = [];
	r.position = importOffset;
	for (let i = 0; i < muTableSize; i++) {
		const mDescriptionId = r.readU64();
		const patchOffset = r.readU32();
		if (patchOffset !== TABLE_OFFSET + 4 * i) {
			throw new Error(`${T}: import ${i} patches 0x${patchOffset.toString(16)}, expected slot offset 0x${(TABLE_OFFSET + 4 * i).toString(16)}`);
		}
		const pad = r.readU32();
		if (pad !== 0) {
			throw new Error(`${T}: import ${i} pad word is 0x${pad.toString(16)}, expected 0`);
		}
		descriptions.push({ mDescriptionId });
	}

	return { descriptions, _padAfterTable };
}

export function writeParticleDescriptionCollection(
	model: ParsedParticleDescriptionCollection,
	littleEndian = true,
): Uint8Array {
	const n = model.descriptions.length;
	const tableEnd = TABLE_OFFSET + n * 4;
	const importOffset = tableEnd + model._padAfterTable.byteLength;
	const totalSize = importOffset + n * IMPORT_ENTRY_SIZE;

	const w = new BinWriter(totalSize, littleEndian);
	w.writeU32(TABLE_OFFSET); // mpTable
	w.writeU32(n); // muTableSize
	for (let i = 0; i < n; i++) w.writeU32(i + 1);
	if (model._padAfterTable.byteLength > 0) w.writeBytes(model._padAfterTable);
	for (let i = 0; i < n; i++) {
		w.writeU64(model.descriptions[i].mDescriptionId);
		w.writeU32(TABLE_OFFSET + 4 * i);
		w.writeU32(0);
	}
	if (w.offset !== totalSize) {
		throw new Error(`ParticleDescriptionCollection writer: wrote 0x${w.offset.toString(16)} bytes, expected 0x${totalSize.toString(16)}`);
	}
	return w.bytes;
}
