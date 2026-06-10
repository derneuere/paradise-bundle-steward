// SnapshotData parser and writer (resource type 0xA029).
//
// SnapshotData stores mixer-channel snapshots for the companion Nicotine map
// (0xA024) in the same bundle (NicotineAssetMain.mss / .Surround.mss). A
// snapshot is one mixer preset — "engine view", "crash slow-mo", … — captured
// as one (control, value) datum per channel; the game crossfades between
// snapshots at runtime. Each channel record names the Nicotine MASTER mix
// channel it drives: its mixChId word matches a stMasterMixChParams MIXCHID
// verbatim (verified: all 72 channel ids of both retail resources appear
// among the companion map's 111 master MIXCHIDs, and none among the submix
// ids). The channelId hash does NOT appear anywhere in the Nicotine map.
//
// Both retail resources (stereo and surround) are byte-identical: 17
// snapshots × 72 channels — the output-format differences live entirely in
// the Nicotine maps.
//
// On-disk layout (32-bit PC LE):
//   CgsResource::BinaryFileResource wrapper: u32 dataSize, u32 dataOffset(=8).
//   +0x00 Nicotine::SnapshotHeader: miNumSnapshots, miNumChannels,
//         maiPad[2] = [1, 0x12345678] in retail (preserved verbatim).
//   +0x10 channel records, miNumChannels × 12 bytes:
//         u32 mixChId   — bit field, top two bits always set (0xC0-prefixed
//                         in retail); references the Nicotine master channel
//         u32 channelId — 32-bit hash-like id (not a CgsID; source unknown)
//         i32 -1        — always -1; asserted on read, regenerated on write
//   then snapshot data, miNumSnapshots × miNumChannels × 8 bytes, snapshot-
//   major (snapshot s's datum for channel c is at index s*numChannels + c):
//         u32 control   — packed word; low i16 looks like a level in
//                         hundredths of a dB (0xD8F0 = -10000 = -100.00 dB
//                         floor, retail range 0..130658), high u16 ∈ {0,1}
//         f32 value     — wiki suggests volume; retail range 0..5.6
//   then zero pad to a 16-byte-aligned total (dataSize excludes the pad).
//
// Round-trip strategy: counts and the BinaryFile sizes are recomputed from
// the arrays on write; the layout is rigid, so the parser THROWS on any
// stored value that disagrees with the derived one.

import { BinReader, BinWriter } from './binTools';

// =============================================================================
// Types
// =============================================================================

export type SnapshotChannel = {
	/** Master-mix MIXCHID in the companion Nicotine map (exact u32 match). */
	mixChId: number;
	/** Hash-like channel id — appears nowhere in the Nicotine map. */
	channelId: number;
};

export type SnapshotEntry = {
	/** Packed word — low i16 plausibly a level in hundredths of a dB. */
	control: number; // u32
	/** Unknown float — wiki suggests volume; retail range 0..5.6. */
	value: number; // f32
};

export type Snapshot = {
	/** One datum per channel, in channel-array order. */
	entries: SnapshotEntry[];
};

export type ParsedSnapshotData = {
	channels: SnapshotChannel[];
	snapshots: Snapshot[];
	/** maiPad[0] — 1 in retail (wiki: "mixer state?"); preserved verbatim. */
	_pad08: number;
	/** maiPad[1] — 0x12345678 in retail; preserved verbatim. */
	_pad0C: number;
};

// =============================================================================
// Constants
// =============================================================================

const WRAPPER_SIZE = 0x8;
const HEADER_SIZE = 0x10;
const CHANNEL_RECORD_SIZE = 0xc;
const SNAPSHOT_ENTRY_SIZE = 0x8;

const align16 = (n: number) => (n + 15) & ~15;

function fail(msg: string): never {
	throw new Error(`SnapshotData: ${msg}`);
}

// =============================================================================
// Reader
// =============================================================================

export function parseSnapshotData(raw: Uint8Array, littleEndian = true): ParsedSnapshotData {
	const buf = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
	const bytes = new Uint8Array(buf);
	const r = new BinReader(buf, littleEndian);

	// --- BinaryFile wrapper ---
	const dataSize = r.readU32();
	const dataOffset = r.readU32();
	if (dataOffset !== WRAPPER_SIZE) fail(`dataOffset is 0x${dataOffset.toString(16)}, expected 0x8 (rigid layout)`);
	if (raw.byteLength !== align16(dataOffset + dataSize)) {
		fail(`resource is 0x${raw.byteLength.toString(16)} bytes, expected 0x${align16(dataOffset + dataSize).toString(16)} (dataSize + 16-byte alignment pad)`);
	}
	for (let i = dataOffset + dataSize; i < raw.byteLength; i++) {
		if (bytes[i] !== 0) fail(`non-zero alignment-pad byte at 0x${i.toString(16)}`);
	}

	// --- Nicotine::SnapshotHeader ---
	const numSnapshots = r.readU32();
	const numChannels = r.readU32();
	const _pad08 = r.readU32();
	const _pad0C = r.readU32();
	const derivedSize = HEADER_SIZE + numChannels * CHANNEL_RECORD_SIZE + numSnapshots * numChannels * SNAPSHOT_ENTRY_SIZE;
	if (dataSize !== derivedSize) {
		fail(`dataSize 0x${dataSize.toString(16)} != derived 0x${derivedSize.toString(16)} for ${numSnapshots} snapshots × ${numChannels} channels`);
	}

	// --- Channel records ---
	const channels: SnapshotChannel[] = [];
	for (let c = 0; c < numChannels; c++) {
		const mixChId = r.readU32();
		const channelId = r.readU32();
		const minusOne = r.readI32();
		if (minusOne !== -1) fail(`channel[${c}] third word is ${minusOne}, expected -1`);
		channels.push({ mixChId, channelId });
	}

	// --- Snapshot data (snapshot-major) ---
	const snapshots: Snapshot[] = [];
	for (let s = 0; s < numSnapshots; s++) {
		const entries: SnapshotEntry[] = [];
		for (let c = 0; c < numChannels; c++) {
			entries.push({ control: r.readU32(), value: r.readF32() });
		}
		snapshots.push({ entries });
	}

	return { channels, snapshots, _pad08, _pad0C };
}

// =============================================================================
// Writer
// =============================================================================

export function writeSnapshotData(model: ParsedSnapshotData, littleEndian = true): Uint8Array {
	const numChannels = model.channels.length;
	model.snapshots.forEach((snap, s) => {
		if (snap.entries.length !== numChannels) {
			throw new Error(`SnapshotData writer: snapshots[${s}] has ${snap.entries.length} entries but there are ${numChannels} channels — every snapshot carries one datum per channel`);
		}
	});

	const dataSize = HEADER_SIZE + numChannels * CHANNEL_RECORD_SIZE + model.snapshots.length * numChannels * SNAPSHOT_ENTRY_SIZE;
	const totalSize = align16(WRAPPER_SIZE + dataSize);
	const w = new BinWriter(totalSize, littleEndian);

	w.writeU32(dataSize); // excludes the alignment pad
	w.writeU32(WRAPPER_SIZE);
	w.writeU32(model.snapshots.length);
	w.writeU32(numChannels);
	w.writeU32(model._pad08);
	w.writeU32(model._pad0C);

	for (const ch of model.channels) {
		w.writeU32(ch.mixChId);
		w.writeU32(ch.channelId);
		w.writeI32(-1);
	}
	for (const snap of model.snapshots) {
		for (const e of snap.entries) {
			w.writeU32(e.control);
			w.writeF32(e.value);
		}
	}

	if (w.offset !== WRAPPER_SIZE + dataSize) {
		throw new Error(`SnapshotData writer: wrote 0x${w.offset.toString(16)} bytes, expected 0x${(WRAPPER_SIZE + dataSize).toString(16)}`);
	}
	w.writeZeroes(totalSize - w.offset);
	return w.bytes;
}
