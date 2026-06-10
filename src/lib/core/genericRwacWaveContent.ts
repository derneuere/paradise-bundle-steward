// GenericRwacWaveContent parser and writer (resource type 0xA020).
//
// The primary sound asset of Burnout Paradise: a container for one EA
// SndPlayer wave (RWAC = RenderWare Audio Core). Car horns, sirens, HUD
// counters, UI whooshes — SOUND/GLOBALWAVES.BUNDLE alone carries 37.
//
// On-disk layout, validated against all 37 retail GLOBALWAVES resources:
//   0x00  u32 mu32DataSize    — platform-endian BinaryFile wrapper; always
//   0x04  u32 mu32DataOffset    rawLen-0x10 and 0x10 respectively
//   0x08  8B  uninitialised    — undocumented gap between the documented
//                                8-byte BinaryFileResource and the data at
//                                0x10; carries stale heap garbage (PATH
//                                fragments etc.) in 4 of 37 retail resources
//   0x10  BIG-ENDIAN SndPlayer header, bit-packed (BE regardless of platform):
//         u32  version(4) | codec(4) | channels-1(6) | sampleRate(18)
//         u32  playType(2) | loopFlag(1) | numSamples(29)
//         [u32 loopStartSample]      iff loopFlag
//         [u32 gigaResidentSamples]  iff playType == gigasample
//   then  chunks until the decoded sample count reaches numSamples:
//         u32 BE byteCount, u32 BE samples, then byteCount-8 codec bytes —
//         the byte count INCLUDES the 8-byte chunk header (the wiki's
//         "number of bytes in the chunk" is ambiguous; the exclusive reading
//         overruns most retail resources)
//   then  0-15 pad bytes to 16-byte alignment — usually zero but
//         uninitialised garbage in 4 of 37 retail resources; preserved
//         verbatim, regenerated as zeros when an edit changes the length.
//
// Spec-vs-bytes findings beyond the chunk-byte-count one:
//  - Multi-chunk waves exist only when loopStartSample > 0, and the first
//    chunk boundary lands EXACTLY on the loop start sample — the decoder can
//    only restart a loop on a chunk boundary. Observed, not asserted: other
//    bundles may chunk differently.
//  - Every GLOBALWAVES asset is version 0, codec 5 (EALayer3 v1 int),
//    play type RAM. Stream/gigasample shapes are unvalidated; their
//    post-header bytes are preserved as an opaque verbatim blob because the
//    optional stream-loop-offset header field makes even the header length
//    undecidable from bytes alone (it exists only "if loop start is in the
//    stream portion", which is not recoverable without the stream file).
//  - Resource ids are NOT soundHash/CgsID of the gamedb debug name (tested
//    full URL, lowercased, basename, and stem variants — no matches).

import { BinReader, BinWriter } from './binTools';

// =============================================================================
// Enumerations
// =============================================================================

// EA::Audio::Core::SndPlayerCodec. Burnout uses EALayer3 v1 int (5) for
// nearly everything on PC, XAS (0) for some engine sounds.
export const SNDPLAYER_CODECS = [
	'XAS',
	'EALayer3',
	'Sign16 (big-endian PCM)',
	'EA-XMA',
	'XAS v1',
	'EALayer3 v1',
	'EALayer3 v2 PCM',
	'EALayer3 v2 Spike',
	'GameCube ADPCM',
	'EASpeex',
	'ATRAC9',
	'EAMP3',
	'EAOpus',
	'EA-ATRAC9',
	'MultiStream Opus',
	'MultiStream Opus (uncoupled)',
] as const;

// EA::Audio::Core::SndPlayerPlayType. RAM waves are self-contained; stream /
// gigasample waves keep (some of) their data outside this resource.
export const SNDPLAYER_PLAY_TYPES = ['RAM', 'Stream', 'Gigasample'] as const;

export const SNDPLAYER_PLAY_TYPE = {
	RAM: 0,
	STREAM: 1,
	GIGASAMPLE: 2,
} as const;

// =============================================================================
// Types
// =============================================================================

export type WaveDataChunk = {
	/** Sample frames this chunk decodes to. */
	samples: number;
	/** Opaque codec payload (on-disk chunk byte count = data.byteLength + 8). */
	data: Uint8Array;
};

export type ParsedGenericRwacWaveContent = {
	/** SNDPLAYER_VERSION_BITS — 0 in every retail resource. */
	version: number;
	/** Index into SNDPLAYER_CODECS. */
	codec: number;
	/** Human channel count (stored -1 on disk); 1 = mono, 2 = stereo. */
	channels: number;
	/** Sample rate in Hz (18-bit field, max 262143). */
	sampleRate: number;
	/** Index into SNDPLAYER_PLAY_TYPES. */
	playType: number;
	/** Loop start sample; null = loop flag clear (one-shot asset). */
	loopStartSample: number | null;
	/** Gigasample only: samples of the RAM-resident portion. Null otherwise. */
	gigaResidentSamples: number | null;
	/** Total samples. Derived from the chunks on write for RAM waves. */
	numSamples: number;
	/** Codec data, in playback order. RAM waves only; empty otherwise. */
	chunks: WaveDataChunk[];
	/** Bytes 0x08-0x0F of the BinaryFile wrapper — uninitialised, preserved verbatim. */
	_binPad: Uint8Array;
	/** 0-15 pad bytes to 16-byte alignment — preserved verbatim while the
	 *  length still fits, regenerated as zeros after a size-changing edit. */
	_trailingPad: Uint8Array;
	/** Stream/gigasample waves: everything after the header, verbatim
	 *  (unvalidated shape — no fixture exercises it). Null for RAM. */
	_unchunkedData: Uint8Array | null;
};

// =============================================================================
// Constants
// =============================================================================

const DATA_OFFSET = 0x10;
const CHUNK_HEADER_SIZE = 8;
const align16 = (n: number) => (n + 15) & ~15;

/** Playback length in seconds, NaN-safe for picker sort keys. */
export function waveDurationSeconds(model: { numSamples: number; sampleRate: number }): number {
	return model.sampleRate > 0 ? model.numSamples / model.sampleRate : 0;
}

// =============================================================================
// Reader
// =============================================================================

export function parseGenericRwacWaveContent(
	raw: Uint8Array,
	littleEndian = true,
): ParsedGenericRwacWaveContent {
	// Copy up front — extractResourceRaw may hand back a Buffer view, and the
	// verbatim chunk/pad fields below must not alias the caller's bytes.
	const bytes = new Uint8Array(raw);
	if (bytes.byteLength < DATA_OFFSET + 8) {
		throw new Error(`GenericRwacWaveContent: ${bytes.byteLength} bytes is too small for wrapper + header`);
	}
	const wrap = new BinReader(bytes.buffer, littleEndian);
	const dataSize = wrap.readU32();
	const dataOffset = wrap.readU32();

	// The layout is rigid; bail loudly on violations rather than silently
	// producing a model that won't round-trip.
	if (dataOffset !== DATA_OFFSET) {
		throw new Error(`GenericRwacWaveContent: mu32DataOffset is 0x${dataOffset.toString(16)}, expected 0x10`);
	}
	if (dataOffset + dataSize !== bytes.byteLength) {
		throw new Error(`GenericRwacWaveContent: mu32DataSize 0x${dataSize.toString(16)} + offset != resource size 0x${bytes.byteLength.toString(16)}`);
	}
	const _binPad = bytes.slice(8, DATA_OFFSET);

	// SndPlayer header — big-endian regardless of platform.
	const be = new BinReader(bytes.buffer, false);
	be.position = DATA_OFFSET;
	const h1 = be.readU32();
	const version = h1 >>> 28;
	const codec = (h1 >>> 24) & 0xf;
	const channels = ((h1 >>> 18) & 0x3f) + 1;
	const sampleRate = h1 & 0x3ffff;
	const h2 = be.readU32();
	const playType = h2 >>> 30;
	const loopFlag = (h2 >>> 29) & 1;
	const numSamples = h2 & 0x1fffffff;
	if (playType >= SNDPLAYER_PLAY_TYPES.length) {
		throw new Error(`GenericRwacWaveContent: play type ${playType} is out of range`);
	}
	const loopStartSample = loopFlag ? be.readU32() : null;
	const gigaResidentSamples = playType === SNDPLAYER_PLAY_TYPE.GIGASAMPLE ? be.readU32() : null;

	if (playType !== SNDPLAYER_PLAY_TYPE.RAM) {
		// Header length is undecidable past this point (see file header), so
		// everything else is one verbatim blob.
		return {
			version, codec, channels, sampleRate, playType,
			loopStartSample, gigaResidentSamples, numSamples,
			chunks: [],
			_binPad,
			_trailingPad: new Uint8Array(0),
			_unchunkedData: bytes.slice(be.position),
		};
	}

	// --- Chunks: walk until the decoded sample count reaches numSamples. ---
	const chunks: WaveDataChunk[] = [];
	let decoded = 0;
	while (decoded < numSamples) {
		if (be.position + CHUNK_HEADER_SIZE > bytes.byteLength) {
			throw new Error(`GenericRwacWaveContent: ran out of bytes at 0x${be.position.toString(16)} with ${decoded}/${numSamples} samples decoded`);
		}
		const byteCount = be.readU32();
		const samples = be.readU32();
		if (byteCount <= CHUNK_HEADER_SIZE) {
			throw new Error(`GenericRwacWaveContent: chunk at 0x${(be.position - CHUNK_HEADER_SIZE).toString(16)} claims ${byteCount} bytes (must exceed its 8-byte header)`);
		}
		const end = be.position + (byteCount - CHUNK_HEADER_SIZE);
		if (end > bytes.byteLength) {
			throw new Error(`GenericRwacWaveContent: chunk data overruns the resource (ends 0x${end.toString(16)} of 0x${bytes.byteLength.toString(16)})`);
		}
		decoded += samples;
		if (decoded > numSamples) {
			throw new Error(`GenericRwacWaveContent: chunk samples sum to ${decoded}, exceeding the header's ${numSamples}`);
		}
		chunks.push({ samples, data: bytes.slice(be.position, end) });
		be.position = end;
	}

	// --- Trailing pad: 0-15 bytes to 16-byte alignment, captured verbatim. ---
	const padLen = bytes.byteLength - be.position;
	if (padLen >= 16 || align16(be.position) !== bytes.byteLength) {
		throw new Error(`GenericRwacWaveContent: ${padLen} trailing bytes after the last chunk — expected 0-15 zero/garbage pad bytes to 16-byte alignment`);
	}
	const _trailingPad = bytes.slice(be.position);

	return {
		version, codec, channels, sampleRate, playType,
		loopStartSample, gigaResidentSamples, numSamples,
		chunks,
		_binPad,
		_trailingPad,
		_unchunkedData: null,
	};
}

// =============================================================================
// Writer
// =============================================================================

function writeU32BE(w: BinWriter, v: number) {
	w.writeU8((v >>> 24) & 0xff);
	w.writeU8((v >>> 16) & 0xff);
	w.writeU8((v >>> 8) & 0xff);
	w.writeU8(v & 0xff);
}

export function writeGenericRwacWaveContent(
	model: ParsedGenericRwacWaveContent,
	littleEndian = true,
): Uint8Array {
	const { version, codec, channels, sampleRate, playType } = model;
	if (version < 0 || version > 0xf) throw new Error(`GenericRwacWaveContent writer: version ${version} exceeds 4 bits`);
	if (codec < 0 || codec > 0xf) throw new Error(`GenericRwacWaveContent writer: codec ${codec} exceeds 4 bits`);
	if (channels < 1 || channels > 64) throw new Error(`GenericRwacWaveContent writer: ${channels} channels outside 1-64`);
	if (sampleRate < 0 || sampleRate > 0x3ffff) throw new Error(`GenericRwacWaveContent writer: sample rate ${sampleRate} exceeds 18 bits`);
	if (playType < 0 || playType >= SNDPLAYER_PLAY_TYPES.length) throw new Error(`GenericRwacWaveContent writer: play type ${playType} out of range`);
	if (model._binPad.byteLength !== 8) throw new Error(`GenericRwacWaveContent writer: _binPad must be exactly 8 bytes, got ${model._binPad.byteLength}`);

	const isRam = playType === SNDPLAYER_PLAY_TYPE.RAM;
	if (isRam && model._unchunkedData != null) {
		throw new Error('GenericRwacWaveContent writer: RAM waves store data in chunks, not _unchunkedData');
	}
	if ((model.gigaResidentSamples != null) !== (playType === SNDPLAYER_PLAY_TYPE.GIGASAMPLE)) {
		throw new Error('GenericRwacWaveContent writer: gigaResidentSamples must be set exactly when play type is gigasample');
	}
	if (!isRam && model.chunks.length > 0) {
		throw new Error('GenericRwacWaveContent writer: stream/gigasample waves carry no chunks in this resource');
	}

	// Total samples is the source of truth in the chunks for RAM waves; the
	// header field is re-derived so chunk edits can't desync it.
	const numSamples = isRam
		? model.chunks.reduce((sum, c) => sum + c.samples, 0)
		: model.numSamples;
	if (numSamples > 0x1fffffff) throw new Error(`GenericRwacWaveContent writer: ${numSamples} samples exceeds 29 bits`);
	if (model.loopStartSample != null && (model.loopStartSample < 0 || model.loopStartSample > 0xffffffff)) {
		throw new Error(`GenericRwacWaveContent writer: loop start ${model.loopStartSample} is not a u32`);
	}

	const headerLen = 8
		+ (model.loopStartSample != null ? 4 : 0)
		+ (model.gigaResidentSamples != null ? 4 : 0);
	const chunksLen = isRam
		? model.chunks.reduce((sum, c) => sum + CHUNK_HEADER_SIZE + c.data.byteLength, 0)
		: (model._unchunkedData?.byteLength ?? 0);
	const contentEnd = DATA_OFFSET + headerLen + chunksLen;
	// Reuse the captured garbage pad while the length still fits so untouched
	// models round-trip byte-exact; regenerate as zeros after an edit moved
	// the end.
	const padLen = isRam ? align16(contentEnd) - contentEnd : 0;
	const pad = model._trailingPad.byteLength === padLen
		? model._trailingPad
		: new Uint8Array(padLen);
	const totalSize = contentEnd + padLen;

	const w = new BinWriter(totalSize, littleEndian);
	w.writeU32(totalSize - DATA_OFFSET); // mu32DataSize
	w.writeU32(DATA_OFFSET); // mu32DataOffset
	w.writeBytes(model._binPad);

	writeU32BE(w, ((version & 0xf) << 28) | ((codec & 0xf) << 24) | (((channels - 1) & 0x3f) << 18) | sampleRate);
	writeU32BE(w, ((playType & 3) << 30) | (model.loopStartSample != null ? 1 << 29 : 0) | numSamples);
	if (model.loopStartSample != null) writeU32BE(w, model.loopStartSample);
	if (model.gigaResidentSamples != null) writeU32BE(w, model.gigaResidentSamples);

	if (isRam) {
		for (const chunk of model.chunks) {
			writeU32BE(w, CHUNK_HEADER_SIZE + chunk.data.byteLength);
			writeU32BE(w, chunk.samples);
			w.writeBytes(chunk.data);
		}
		if (pad.byteLength > 0) w.writeBytes(pad);
	} else if (model._unchunkedData != null) {
		w.writeBytes(model._unchunkedData);
	}

	if (w.offset !== totalSize) {
		throw new Error(`GenericRwacWaveContent writer: wrote 0x${w.offset.toString(16)} bytes, expected 0x${totalSize.toString(16)}`);
	}
	return w.bytes;
}
