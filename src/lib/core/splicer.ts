// Splicer parser and writer (resource type 0xA025).
//
// A Splicer is a self-contained bank of triggered sounds: each *splice* is
// one playable event (a collision hit, a menu popup, a passby whoosh) built
// from one or more *sample refs* — playback instructions (volume, pitch,
// delay, fades) that point into a table of audio *samples* embedded at the
// tail of the same resource. The samples are EA SNR-style streams (byte 0
// codec nibble 7 = EA-XAS, 48 kHz in every retail splicer) kept opaque here.
// Nothing references wave assets outside the resource: every retail splicer
// bundle holds exactly one 0xA025 with importCount 0, and SampleIndex is an
// index into the internal table of contents. Which splice plays for which
// game event is hardcoded by splice order (see the wiki's "sweeteners" note),
// so reordering or removing splices changes game behaviour.
//
// On-disk layout (32-bit PC, little-endian), validated against all six
// retail SOUND/SPLICER bundles:
//   0x00 u32 mu32DataSize    — bytes after mu32DataOffset (= total - 0x10)
//   0x04 u32 mu32DataOffset  — 0x10 (CgsResource::BinaryFileResource header
//                              padded to 16; pointers below ignore it)
//   0x08 u8[8]               — wrapper pad (zero in retail), kept verbatim
//   0x10 u32 versionOfData   — KI_SPLICE_DATA_VERSION, must be 1
//   0x14 u32 sizedata        — SPLICE_Data + SPLICE_SampleRef bytes combined
//   0x18 u32 numsplices
//   0x1C     numsplices × SPLICE_Data (0x18 each), packed back to back
//   then     ΣNum_SampleRefs × SPLICE_SampleRef (0x2C each) — one shared
//            array, consumed in SpliceIndex order (identity in retail)
//   then     u32 numSamples (mNumSamples, at pdata + sizedata)
//   then     numSamples × u32 TOC — byte offsets into the sample data,
//            0-based, strictly increasing, NOT aligned
//   then     sample data to end of resource (last sample owns any pad)
//
// Wiki divergence (burnout.wiki/wiki/Splicer): the page describes both
// record types but not their arrangement — SPLICE_Data records are NOT
// interleaved with their SampleRefs; all splice records come first, then one
// flat SampleRef array. "SpliceIndex determines the order in which
// SampleRefs are read" is the only hint. In every retail resource
// SpliceIndex equals the record's position; the parser still consumes ref
// batches in SpliceIndex rank order so a permuted file would round-trip.
//
// Round-trip strategy: rigid-layout violations THROW; sizedata / counts /
// the TOC are recomputed from array lengths on write; sample payloads, pads
// and NameHash are preserved verbatim. parse(write(parse(x))) is byte-exact
// on all six retail fixtures.

import { BinReader, BinWriter } from './binTools';

// =============================================================================
// Types
// =============================================================================

export type SpliceSampleRef = {
	/** Index into the splicer's embedded sample table (samples[]). */
	SampleIndex: number; // u16
	/** eSpliceType — undocumented enum, 0 in every retail ref. */
	eSpliceType: number; // i8
	/** Pad byte at +0x3 (0 in retail) — preserved verbatim. */
	_pad03: number; // u8
	/** Linear amplitude multiplier (1 = as authored). */
	Volume: number; // f32
	/** Frequency ratio (1 = original pitch; 2^(n/12) = n semitones). */
	Pitch: number; // f32
	/** Playback delay in seconds from the splice trigger. */
	Offset: number; // f32
	/** Azimuth — wiki: "typically 0 or -127"; retail range -127..121. */
	Az: number; // f32
	/** Playback duration in seconds (always > 0 in retail). */
	Duration: number; // f32
	/** Fade-in duration in seconds. */
	FadeIn: number; // f32
	/** Fade-out duration in seconds. */
	FadeOut: number; // f32
	/** Random volume bound (1 = no randomisation; retail 0.5..1.2). */
	RND_Vol: number; // f32
	/** Random pitch offset (0 = none; retail -0.41..0.79). */
	RND_Pitch: number; // f32
	/** Priority — 0 in every retail ref. */
	Priority: number; // u8
	/** eRollOffType — undocumented enum, 0 in every retail ref. */
	eRollOffType: number; // u8
	/** Pad u16 at +0x2A (0 in retail) — preserved verbatim. */
	_pad2A: number; // u16
};

export type SpliceData = {
	/** Always 0 in retail (the wiki marks it "Always null") — preserved. */
	NameHash: number; // u32
	/**
	 * Rank in the shared SampleRef array: the splice with the lowest
	 * SpliceIndex owns the first batch of refs, and so on. Equals the
	 * splice's position in every retail resource. Game events bind to
	 * splices by this hardcoded order.
	 */
	SpliceIndex: number; // u16
	/** eSpliceType — undocumented enum, 0 in every retail splice. */
	eSpliceType: number; // i8
	/** Linear amplitude multiplier applied to the whole splice. */
	Volume: number; // f32
	/** Random pitch offset for the splice (0 in every retail splice). */
	RND_Pitch: number; // f32
	/** Random volume bound for the splice (1 in every retail splice). */
	RND_Vol: number; // f32
	/** This splice's playback instructions (Num_SampleRefs is derived). */
	sampleRefs: SpliceSampleRef[];
};

export type ParsedSplicer = {
	splices: SpliceData[];
	/**
	 * Embedded audio streams, addressed by SpliceSampleRef.SampleIndex.
	 * Opaque EA SNR/EA-XAS payloads — see splicerSampleInfo for the
	 * decodable header lanes. Boundaries come from the TOC; the last
	 * sample owns the file's trailing pad bytes.
	 */
	samples: Uint8Array[];
	/** BinaryFile wrapper bytes 0x8..0xF (zero in retail) — preserved verbatim. */
	_wrapperPad: Uint8Array;
};

// =============================================================================
// Constants
// =============================================================================

const DATA_OFFSET = 0x10;
const SPLICE_HEADER_SIZE = 0xc; // versionOfData + sizedata + numsplices
const SPLICE_DATA_SIZE = 0x18;
const SAMPLE_REF_SIZE = 0x2c;
const SPLICE_DATA_VERSION = 1;

// =============================================================================
// Sample-header peek (labels / describe only — never written back)
// =============================================================================

/**
 * Decode the first two big-endian words of an embedded sample: an EA SNR
 * "headerB"-style header (the rest of the audio toolchain is BE even on PC).
 * Every retail splicer sample decodes to codec 7 (EA-XAS) at 48000 Hz with
 * channelConfig 0 (mono) or 1 (stereo). Returns null when the blob is too
 * short or the rate lane is zero — callers fall back to a byte-count label.
 */
export function splicerSampleInfo(data: Uint8Array): {
	codec: number;
	channels: number;
	sampleRate: number;
	sampleCount: number;
	seconds: number;
} | null {
	if (data.byteLength < 8) return null;
	const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
	const w0 = view.getUint32(0, false);
	const w1 = view.getUint32(4, false);
	const sampleRate = w0 & 0x3ffff;
	if (sampleRate === 0) return null;
	const sampleCount = w1 & 0x3fffffff;
	return {
		codec: (w0 >>> 24) & 0xf,
		channels: ((w0 >>> 18) & 0x3f) + 1,
		sampleRate,
		sampleCount,
		seconds: sampleCount / sampleRate,
	};
}

// =============================================================================
// Reader
// =============================================================================

export function parseSplicer(raw: Uint8Array, littleEndian = true): ParsedSplicer {
	// Copy up front — extractResourceRaw may hand back a Buffer view, and the
	// verbatim sample/pad fields below must not alias the caller's bytes.
	const bytes = new Uint8Array(raw);
	const r = new BinReader(bytes.buffer, littleEndian);

	// --- BinaryFile wrapper ---
	const dataSize = r.readU32();
	const dataOffset = r.readU32();
	if (dataOffset !== DATA_OFFSET) {
		throw new Error(`Splicer: mu32DataOffset is 0x${dataOffset.toString(16)}, expected 0x10`);
	}
	if (dataSize !== bytes.byteLength - DATA_OFFSET) {
		throw new Error(`Splicer: mu32DataSize 0x${dataSize.toString(16)} != resource size 0x${bytes.byteLength.toString(16)} - 0x10`);
	}
	const _wrapperPad = bytes.slice(8, DATA_OFFSET);

	// --- Splice header ---
	r.position = DATA_OFFSET;
	const version = r.readU32();
	if (version !== SPLICE_DATA_VERSION) {
		throw new Error(`Splicer: versionOfData ${version}, expected ${SPLICE_DATA_VERSION}`);
	}
	const sizedata = r.readU32();
	const numsplices = r.readU32();
	const pdata = DATA_OFFSET + SPLICE_HEADER_SIZE;
	const refsStart = pdata + numsplices * SPLICE_DATA_SIZE;
	const refsBytes = pdata + sizedata - refsStart;
	if (refsBytes < 0 || refsBytes % SAMPLE_REF_SIZE !== 0) {
		throw new Error(`Splicer: sizedata 0x${sizedata.toString(16)} leaves 0x${refsBytes.toString(16)} SampleRef bytes for ${numsplices} splices (not a multiple of 0x2c)`);
	}
	const totalRefs = refsBytes / SAMPLE_REF_SIZE;

	// --- SPLICE_Data records (packed, refs assigned below) ---
	const splices: SpliceData[] = [];
	let sumRefs = 0;
	const numRefsPer: number[] = [];
	for (let i = 0; i < numsplices; i++) {
		const NameHash = r.readU32();
		const SpliceIndex = r.readU16();
		const eSpliceType = r.readI8();
		const numRefs = r.readU8();
		const Volume = r.readF32();
		const RND_Pitch = r.readF32();
		const RND_Vol = r.readF32();
		const pSampleRefList = r.readU32();
		if (pSampleRefList !== 0) {
			throw new Error(`Splicer: splice ${i} has pSampleRefList 0x${pSampleRefList.toString(16)}, expected nullptr in asset`);
		}
		numRefsPer.push(numRefs);
		sumRefs += numRefs;
		splices.push({ NameHash, SpliceIndex, eSpliceType, Volume, RND_Pitch, RND_Vol, sampleRefs: [] });
	}
	if (sumRefs !== totalRefs) {
		throw new Error(`Splicer: splices claim ${sumRefs} SampleRefs but sizedata holds ${totalRefs}`);
	}

	// --- SampleRefs: one flat array, consumed in SpliceIndex rank order ---
	const rankOrder = spliceRankOrder(splices);
	r.position = refsStart;
	for (const spliceIdx of rankOrder) {
		for (let j = 0; j < numRefsPer[spliceIdx]; j++) {
			splices[spliceIdx].sampleRefs.push({
				SampleIndex: r.readU16(),
				eSpliceType: r.readI8(),
				_pad03: r.readU8(),
				Volume: r.readF32(),
				Pitch: r.readF32(),
				Offset: r.readF32(),
				Az: r.readF32(),
				Duration: r.readF32(),
				FadeIn: r.readF32(),
				FadeOut: r.readF32(),
				RND_Vol: r.readF32(),
				RND_Pitch: r.readF32(),
				Priority: r.readU8(),
				eRollOffType: r.readU8(),
				_pad2A: r.readU16(),
			});
		}
	}

	// --- Sample table of contents + payloads ---
	const numSamplesAt = pdata + sizedata;
	r.position = numSamplesAt;
	const numSamples = r.readU32();
	const sampleDataAt = numSamplesAt + 4 + numSamples * 4;
	if (sampleDataAt > bytes.byteLength) {
		throw new Error(`Splicer: ${numSamples}-entry TOC overruns the 0x${bytes.byteLength.toString(16)}-byte resource`);
	}
	const toc: number[] = [];
	for (let i = 0; i < numSamples; i++) toc.push(r.readU32());
	const avail = bytes.byteLength - sampleDataAt;
	if (numSamples === 0 && avail !== 0) {
		throw new Error(`Splicer: 0 samples but 0x${avail.toString(16)} sample-data bytes remain`);
	}
	const samples: Uint8Array[] = [];
	for (let i = 0; i < numSamples; i++) {
		// Strict monotonicity matters: aliasing samples would duplicate bytes
		// when the writer concatenates them back.
		const start = toc[i];
		const end = i + 1 < numSamples ? toc[i + 1] : avail;
		if ((i === 0 && start !== 0) || end <= start || end > avail) {
			throw new Error(`Splicer: TOC entry ${i} spans [0x${start.toString(16)}, 0x${end.toString(16)}) of 0x${avail.toString(16)} sample bytes`);
		}
		samples.push(bytes.slice(sampleDataAt + start, sampleDataAt + end));
	}

	// Refs must address real samples — catches TOC/ref drift early.
	for (const s of splices) {
		for (const ref of s.sampleRefs) {
			if (ref.SampleIndex >= numSamples) {
				throw new Error(`Splicer: SampleIndex ${ref.SampleIndex} out of range (only ${numSamples} samples)`);
			}
		}
	}

	return { splices, samples, _wrapperPad };
}

// =============================================================================
// Writer
// =============================================================================

/** Splice array indices sorted by SpliceIndex — the shared SampleRef array
 *  is stored (and consumed) in this order. Throws on duplicates because the
 *  batches would be ambiguous. */
function spliceRankOrder(splices: { SpliceIndex: number }[]): number[] {
	const seen = new Set<number>();
	for (const s of splices) {
		if (seen.has(s.SpliceIndex)) {
			throw new Error(`Splicer: duplicate SpliceIndex ${s.SpliceIndex} — SampleRef batches would be ambiguous`);
		}
		seen.add(s.SpliceIndex);
	}
	return splices.map((_, i) => i).sort((a, b) => splices[a].SpliceIndex - splices[b].SpliceIndex);
}

export function writeSplicer(model: ParsedSplicer, littleEndian = true): Uint8Array {
	const { splices, samples } = model;
	if (model._wrapperPad.byteLength !== 8) {
		throw new Error(`Splicer writer: _wrapperPad is ${model._wrapperPad.byteLength} bytes, expected 8`);
	}
	let totalRefs = 0;
	for (let i = 0; i < splices.length; i++) {
		const n = splices[i].sampleRefs.length;
		if (n > 0xff) {
			throw new Error(`Splicer writer: splice ${i} has ${n} SampleRefs, Num_SampleRefs is a u8 (max 255)`);
		}
		for (const ref of splices[i].sampleRefs) {
			if (ref.SampleIndex >= samples.length) {
				throw new Error(`Splicer writer: splice ${i} references sample ${ref.SampleIndex} but only ${samples.length} samples exist`);
			}
		}
		totalRefs += n;
	}
	const rankOrder = spliceRankOrder(splices);

	// sizedata / TOC / mu32DataSize recomputed from array lengths, never stored.
	const sizedata = splices.length * SPLICE_DATA_SIZE + totalRefs * SAMPLE_REF_SIZE;
	const sampleBytes = samples.reduce((a, s) => a + s.byteLength, 0);
	const totalSize = DATA_OFFSET + SPLICE_HEADER_SIZE + sizedata + 4 + samples.length * 4 + sampleBytes;

	const w = new BinWriter(totalSize, littleEndian);
	w.writeU32(totalSize - DATA_OFFSET);
	w.writeU32(DATA_OFFSET);
	w.writeBytes(model._wrapperPad);
	w.writeU32(SPLICE_DATA_VERSION);
	w.writeU32(sizedata);
	w.writeU32(splices.length);

	for (const s of splices) {
		w.writeU32(s.NameHash);
		w.writeU16(s.SpliceIndex);
		w.writeI8(s.eSpliceType);
		w.writeU8(s.sampleRefs.length);
		w.writeF32(s.Volume);
		w.writeF32(s.RND_Pitch);
		w.writeF32(s.RND_Vol);
		w.writeU32(0); // pSampleRefList — nullptr in asset, fixed up at runtime
	}
	for (const spliceIdx of rankOrder) {
		for (const ref of splices[spliceIdx].sampleRefs) {
			w.writeU16(ref.SampleIndex);
			w.writeI8(ref.eSpliceType);
			w.writeU8(ref._pad03);
			w.writeF32(ref.Volume);
			w.writeF32(ref.Pitch);
			w.writeF32(ref.Offset);
			w.writeF32(ref.Az);
			w.writeF32(ref.Duration);
			w.writeF32(ref.FadeIn);
			w.writeF32(ref.FadeOut);
			w.writeF32(ref.RND_Vol);
			w.writeF32(ref.RND_Pitch);
			w.writeU8(ref.Priority);
			w.writeU8(ref.eRollOffType);
			w.writeU16(ref._pad2A);
		}
	}
	if (w.offset !== DATA_OFFSET + SPLICE_HEADER_SIZE + sizedata) {
		throw new Error(`Splicer writer: splice data ends at 0x${w.offset.toString(16)}, expected 0x${(DATA_OFFSET + SPLICE_HEADER_SIZE + sizedata).toString(16)}`);
	}

	w.writeU32(samples.length);
	let cursor = 0;
	for (const s of samples) {
		w.writeU32(cursor);
		cursor += s.byteLength;
	}
	for (const s of samples) w.writeBytes(s);
	if (w.offset !== totalSize) {
		throw new Error(`Splicer writer: ended at 0x${w.offset.toString(16)}, expected 0x${totalSize.toString(16)}`);
	}
	return w.bytes;
}
