// Nicotine parser and writer (resource type 0xA024, "Nicotine Map").
//
// Nicotine is EA's sound-mixing middleware (names from ProStreet PS2
// symbols). A Nicotine map holds the mixer graph the game drives at runtime:
// a set of mix STATES (engine-selected by index 0x1F0000+n), each carrying up
// to six sections — mix controls, event controls, 3D mix controls, submix
// channels, master mix channels, and per-channel preset data. Retail ships
// exactly two maps: NicotineAssetMain (stereo) and NicotineAssetSurround
// (5.1). Both have identical structure (9 states, 141 channels); they differ
// in only 16 u32 words — attenuation values, consistent with i16 lanes in
// hundredths of a dB (0xD8F0 = -10000 = -100.00 dB floor; deltas -100..-1200
// = -1..-12 dB). The companion SnapshotData (0xA029) resource references this
// map's MASTER mix channels by their MIXCHID word (verified: all 72 snapshot
// channel ids appear verbatim among the 111 master MIXCHIDs; none among the
// submix ids).
//
// On-disk layout (32-bit PC LE; offsets are integers, never pointers, so the
// wiki notes there is no 64-bit variant):
//   CgsResource::BinaryFileResource wrapper: u32 dataSize, u32 dataOffset(=8).
//   All offsets below are relative to dataOffset (the "data base").
//   +0x00 stMixMapHeader: MixMapID(0), NumStates, StateTableOffset(=0x10),
//         DynamicMapOffset(=-1).
//   +0x10 state table: NumStates data-relative offsets, then trailing -1
//         sentinel slots (4 in retail — the wiki doesn't mention them).
//   States pack back-to-back. Each starts with an 8-u32 stMixMapStateHdr
//   (StateIndex + 6 section offsets + Reserved_07=-1) whose section offsets
//   are STATE-relative (the wiki doesn't say relative to what; validated by
//   walking both retail maps). Sections always appear in the order mixCtl,
//   event, 3D, submix, master, preset — absent ones store -1.
//
// Variable-length record rules (wiki phrasing decoded against real bytes —
// "second byte" means the second-highest byte, bits 16-23; "last byte" the
// least-significant byte):
//   stMixCtlParams / stMixEvtParams: extra u32 count = bits 16-23 of
//     nUScaleCntSwing.
//   stSubMixChParams / stMasterMixChParams: extra count = bits 16-23 of
//     MIXCHID.
//   st3DMixCtlParams: total st3DStateParams = low nibble of the top byte of
//     nINPUTID, minimum 1 (the inline one counts).
//   Preset entries: no own header — entry count = the master section's
//     NumMixChannels; per-entry extra count = bits 0-7 of the first word.
//   Walking both fixtures with these rules lands exactly on every section,
//   state, and resource boundary.
//
// Nearly every value word is an undocumented bit field — preserved verbatim.
// The writer recomputes the BinaryFile sizes, all section/state/table
// offsets, and the primary counts; embedded per-record counts live inside
// bit-field words we can't safely rewrite, so the writer validates array
// lengths against them and throws on mismatch. Event header Reserved_02/03
// carry garbage (0x08E50064 + stale heap pointers) — preserved verbatim.

import { BinReader, BinWriter } from './binTools';

// =============================================================================
// Types
// =============================================================================

export type NicotineMixControl = {
	nInputId: number; // u32 bit field
	/** Bit field; bits 16-23 are extraData.length — edit both together. */
	nUScaleCntSwing: number;
	extraData: number[]; // u32[]
};

export type Nicotine3DStateParams = {
	n3DStateInfoId: number;
	nCurveIdDoppler: number;
	nQ0MinMax: number;
	nQ1MinMax: number;
	nQ2MinMax: number;
	nQ3MinMax: number;
};

export type Nicotine3DMixControl = {
	/** Bit field; low nibble of the top byte is stateParams.length (min 1). */
	nInputId: number;
	stateParams: Nicotine3DStateParams[];
};

export type NicotineSubMixChannel = {
	/** Bit field (0xD0-prefixed in retail); bits 16-23 are procOffsets.length. */
	mixChId: number;
	upperLowerSwing: number;
	/** stSubMixStateParams nOffsetSubMixProc words — meaning undocumented. */
	procOffsets: number[];
};

export type NicotineMasterMixChannel = {
	/**
	 * Bit field (0xC0/0xC1/0xC2-prefixed in retail); bits 16-23 are
	 * extraData.length. SnapshotData channels reference master channels by
	 * this exact word.
	 */
	mixChId: number;
	mixData: number;
	sfxObjId: number;
	extraData: number[];
};

export type NicotinePresetEntry = {
	/** Bit field (0xE0-prefixed in retail); bits 0-7 are extraData.length. */
	header: number;
	extraData: number[];
};

export type NicotineMixEvent = {
	nEvtCtlId: number;
	/** Bit field; bits 16-23 are extraData.length. */
	nUScaleCntSwing: number;
	nTriggerId: number;
	nParam00: number;
	nParam01: number;
	nParam02: number;
	extraData: number[];
};

export type NicotineMixCtlSection = {
	/** Equals controls.length in every retail section — preserved verbatim. */
	numNewMixDataProcs: number;
	numMainMixDataProcs: number;
	numMainMixCtlOut: number;
	controls: NicotineMixControl[];
};

export type Nicotine3DSection = {
	numMainMap3DMixCtls: number;
	_reserved02: number;
	_reserved03: number;
	controls: Nicotine3DMixControl[];
};

// stMixChHdr — shared by the submix and master sections.
export type NicotineChannelSection<C> = {
	numUniqueSfxObjs: number;
	numMainIn: number;
	numSecIn: number;
	channels: C[];
};

export type NicotineEventSection = {
	/** Mirrors events.length in every retail section — preserved verbatim. */
	_reserved01: number;
	/** 0x08E50064 in every retail section — looks like a stale pointer. */
	_reserved02: number;
	/** Varies per section — stale heap garbage, preserved verbatim. */
	_reserved03: number;
	events: NicotineMixEvent[];
};

export type NicotineState = {
	/** Engine lookup id — 0x1F0000 + state position in retail. */
	stateIndex: number;
	mixControls: NicotineMixCtlSection | null;
	threeDControls: Nicotine3DSection | null;
	subMix: NicotineChannelSection<NicotineSubMixChannel> | null;
	masterMix: NicotineChannelSection<NicotineMasterMixChannel> | null;
	/** Per-master-channel preset data; length must equal masterMix.channels.length. */
	presets: NicotinePresetEntry[] | null;
	events: NicotineEventSection | null;
};

export type ParsedNicotine = {
	/** Always 0 in retail. */
	mixMapId: number;
	states: NicotineState[];
	/** Trailing -1 slots after the state table's real entries (4 in retail). */
	_stateTableSentinelSlots: number;
};

// =============================================================================
// Constants / helpers
// =============================================================================

const WRAPPER_SIZE = 0x8;
const STATE_TABLE_OFFSET = 0x10;
const STATE_HEADER_SIZE = 0x20;

const align16 = (n: number) => (n + 15) & ~15;
/** Byte i of a u32 counting from the most-significant end (wiki's "first byte"). */
const byteFromTop = (v: number, i: number) => (v >>> (8 * (3 - i))) & 0xff;

/** Total st3DStateParams a 3D control owns, decoded from its nINPUTID. */
export const threeDStateParamCount = (nInputId: number) => Math.max((nInputId >>> 24) & 0xf, 1);
/** Extra-u32 count packed into bits 16-23 of swing/MIXCHID words. */
export const packedExtraCount = (word: number) => byteFromTop(word, 1);
/** Preset extra-u32 count packed into bits 0-7 of the entry's first word. */
export const presetExtraCount = (header: number) => header & 0xff;

function fail(msg: string): never {
	throw new Error(`Nicotine: ${msg}`);
}

// =============================================================================
// Reader
// =============================================================================

function readExtras(r: BinReader, count: number): number[] {
	const out: number[] = [];
	for (let i = 0; i < count; i++) out.push(r.readU32());
	return out;
}

export function parseNicotine(raw: Uint8Array, littleEndian = true): ParsedNicotine {
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
	const D = dataOffset;

	// --- stMixMapHeader ---
	const mixMapId = r.readU32();
	const numStates = r.readU32();
	const stateTableOffset = r.readU32();
	if (stateTableOffset !== STATE_TABLE_OFFSET) fail(`StateTableOffset is 0x${stateTableOffset.toString(16)}, expected 0x10 (rigid layout)`);
	const dynamicMapOffset = r.readI32();
	if (dynamicMapOffset !== -1) fail(`DynamicMapOffset is ${dynamicMapOffset}, expected -1 (rigid layout)`);

	// --- State table (real entries + trailing -1 sentinels) ---
	if (numStates === 0) fail('zero states — sentinel-slot count would be ambiguous');
	const stateOffs: number[] = [];
	for (let i = 0; i < numStates; i++) {
		const off = r.readI32();
		if (off < 0 || D + off + STATE_HEADER_SIZE > D + dataSize) fail(`state table entry [${i}] = ${off} out of range`);
		stateOffs.push(off);
	}
	const sentinelSlots = (stateOffs[0] - STATE_TABLE_OFFSET) / 4 - numStates;
	if (!Number.isInteger(sentinelSlots) || sentinelSlots < 0) fail(`state table does not end on the first state (first offset 0x${stateOffs[0].toString(16)})`);
	for (let i = 0; i < sentinelSlots; i++) {
		const v = r.readI32();
		if (v !== -1) fail(`state table sentinel slot [${i}] is ${v}, expected -1`);
	}

	const states: NicotineState[] = [];
	for (let s = 0; s < numStates; s++) {
		const end = s + 1 < numStates ? stateOffs[s + 1] : dataSize;
		states.push(parseState(r, D, stateOffs[s], end, s));
	}

	return { mixMapId, states, _stateTableSentinelSlots: sentinelSlots };
}

function parseState(r: BinReader, D: number, stateOff: number, stateEnd: number, s: number): NicotineState {
	const S = D + stateOff;
	r.position = S;
	const stateIndex = r.readU32();
	const offMixCtl = r.readI32();
	const off3D = r.readI32();
	const offSubMix = r.readI32();
	const offMaster = r.readI32();
	const offPreset = r.readI32();
	const offEvent = r.readI32();
	const offReserved07 = r.readI32();
	if (offReserved07 !== -1) fail(`state[${s}] Offset_Reserved_07 is ${offReserved07}, expected -1`);

	const state: NicotineState = {
		stateIndex,
		mixControls: null,
		threeDControls: null,
		subMix: null,
		masterMix: null,
		presets: null,
		events: null,
	};

	// Sections live in a fixed canonical order; assert each present section
	// starts exactly where the previous one ended so the writer's offset
	// recomputation is provably byte-exact.
	let cursor = STATE_HEADER_SIZE;
	const expectAt = (name: string, off: number) => {
		if (off !== cursor) fail(`state[${s}] ${name} section at +0x${off.toString(16)}, expected +0x${cursor.toString(16)} (canonical order: mixCtl, event, 3D, submix, master, preset)`);
		r.position = S + off;
	};

	if (offMixCtl !== -1) {
		expectAt('mixCtl', offMixCtl);
		const num = r.readU32();
		const numNewMixDataProcs = r.readU32();
		const numMainMixDataProcs = r.readU32();
		const numMainMixCtlOut = r.readU32();
		const controls: NicotineMixControl[] = [];
		for (let i = 0; i < num; i++) {
			const nInputId = r.readU32();
			const nUScaleCntSwing = r.readU32();
			controls.push({ nInputId, nUScaleCntSwing, extraData: readExtras(r, packedExtraCount(nUScaleCntSwing)) });
		}
		state.mixControls = { numNewMixDataProcs, numMainMixDataProcs, numMainMixCtlOut, controls };
		cursor = r.position - S;
	}

	if (offEvent !== -1) {
		expectAt('event', offEvent);
		const num = r.readU32();
		const _reserved01 = r.readU32();
		const _reserved02 = r.readU32();
		const _reserved03 = r.readU32();
		const events: NicotineMixEvent[] = [];
		for (let i = 0; i < num; i++) {
			const nEvtCtlId = r.readU32();
			const nUScaleCntSwing = r.readU32();
			const nTriggerId = r.readU32();
			const nParam00 = r.readU32();
			const nParam01 = r.readU32();
			const nParam02 = r.readU32();
			events.push({ nEvtCtlId, nUScaleCntSwing, nTriggerId, nParam00, nParam01, nParam02, extraData: readExtras(r, packedExtraCount(nUScaleCntSwing)) });
		}
		state.events = { _reserved01, _reserved02, _reserved03, events };
		cursor = r.position - S;
	}

	if (off3D !== -1) {
		expectAt('3D', off3D);
		const num = r.readU32();
		const numMainMap3DMixCtls = r.readU32();
		const _reserved02 = r.readU32();
		const _reserved03 = r.readU32();
		const controls: Nicotine3DMixControl[] = [];
		for (let i = 0; i < num; i++) {
			const nInputId = r.readU32();
			const stateParams: Nicotine3DStateParams[] = [];
			for (let p = 0; p < threeDStateParamCount(nInputId); p++) {
				stateParams.push({
					n3DStateInfoId: r.readU32(),
					nCurveIdDoppler: r.readU32(),
					nQ0MinMax: r.readU32(),
					nQ1MinMax: r.readU32(),
					nQ2MinMax: r.readU32(),
					nQ3MinMax: r.readU32(),
				});
			}
			controls.push({ nInputId, stateParams });
		}
		state.threeDControls = { numMainMap3DMixCtls, _reserved02, _reserved03, controls };
		cursor = r.position - S;
	}

	if (offSubMix !== -1) {
		expectAt('submix', offSubMix);
		const num = r.readU32();
		const numUniqueSfxObjs = r.readU32();
		const numMainIn = r.readU32();
		const numSecIn = r.readU32();
		const channels: NicotineSubMixChannel[] = [];
		for (let i = 0; i < num; i++) {
			const mixChId = r.readU32();
			const upperLowerSwing = r.readU32();
			channels.push({ mixChId, upperLowerSwing, procOffsets: readExtras(r, packedExtraCount(mixChId)) });
		}
		state.subMix = { numUniqueSfxObjs, numMainIn, numSecIn, channels };
		cursor = r.position - S;
	}

	if (offMaster !== -1) {
		expectAt('master', offMaster);
		const num = r.readU32();
		const numUniqueSfxObjs = r.readU32();
		const numMainIn = r.readU32();
		const numSecIn = r.readU32();
		const channels: NicotineMasterMixChannel[] = [];
		for (let i = 0; i < num; i++) {
			const mixChId = r.readU32();
			const mixData = r.readU32();
			const sfxObjId = r.readU32();
			channels.push({ mixChId, mixData, sfxObjId, extraData: readExtras(r, packedExtraCount(mixChId)) });
		}
		state.masterMix = { numUniqueSfxObjs, numMainIn, numSecIn, channels };
		cursor = r.position - S;
	}

	if (offPreset !== -1) {
		expectAt('preset', offPreset);
		if (state.masterMix == null) fail(`state[${s}] has preset data but no master mix section to size it`);
		const presets: NicotinePresetEntry[] = [];
		for (let i = 0; i < state.masterMix.channels.length; i++) {
			const header = r.readU32();
			presets.push({ header, extraData: readExtras(r, presetExtraCount(header)) });
		}
		state.presets = presets;
		cursor = r.position - S;
	}

	if (cursor !== stateEnd - stateOff) {
		fail(`state[${s}] sections end at +0x${cursor.toString(16)}, expected +0x${(stateEnd - stateOff).toString(16)}`);
	}
	return state;
}

// =============================================================================
// Writer
// =============================================================================

function writeExtras(w: BinWriter, extras: number[], expected: number, what: string) {
	if (extras.length !== expected) {
		throw new Error(`Nicotine writer: ${what} has ${extras.length} extra words but its packed count byte says ${expected} — edit both together`);
	}
	for (const v of extras) w.writeU32(v);
}

export function writeNicotine(model: ParsedNicotine, littleEndian = true): Uint8Array {
	if (model.states.length === 0) throw new Error('Nicotine writer: at least one state is required');
	const w = new BinWriter(8192, littleEndian);
	w.writeU32(0); // dataSize — fixed up below
	w.writeU32(WRAPPER_SIZE);
	const D = WRAPPER_SIZE;

	w.writeU32(model.mixMapId);
	w.writeU32(model.states.length);
	w.writeU32(STATE_TABLE_OFFSET);
	w.writeI32(-1); // DynamicMapOffset

	const tableAt = w.offset;
	for (let i = 0; i < model.states.length + model._stateTableSentinelSlots; i++) w.writeI32(-1);

	model.states.forEach((state, s) => {
		w.setU32(tableAt + s * 4, w.offset - D);
		writeState(w, state, s);
	});

	w.setU32(0, w.offset - D); // dataSize excludes the alignment pad
	const pad = (16 - (w.offset % 16)) % 16;
	w.writeZeroes(pad);
	return w.bytes;
}

function writeState(w: BinWriter, state: NicotineState, s: number) {
	const S = w.offset;
	w.writeU32(state.stateIndex);
	for (let i = 0; i < 6; i++) w.writeI32(-1); // section offsets — fixed up below
	w.writeI32(-1); // Offset_Reserved_07
	const fixup = (slot: number) => w.setU32(S + 4 + slot * 4, w.offset - S);

	if (state.mixControls) {
		fixup(0);
		const sec = state.mixControls;
		w.writeU32(sec.controls.length);
		w.writeU32(sec.numNewMixDataProcs);
		w.writeU32(sec.numMainMixDataProcs);
		w.writeU32(sec.numMainMixCtlOut);
		sec.controls.forEach((c, i) => {
			w.writeU32(c.nInputId);
			w.writeU32(c.nUScaleCntSwing);
			writeExtras(w, c.extraData, packedExtraCount(c.nUScaleCntSwing), `state[${s}] mixControls[${i}]`);
		});
	}

	if (state.events) {
		fixup(5);
		const sec = state.events;
		w.writeU32(sec.events.length);
		w.writeU32(sec._reserved01);
		w.writeU32(sec._reserved02);
		w.writeU32(sec._reserved03);
		sec.events.forEach((e, i) => {
			w.writeU32(e.nEvtCtlId);
			w.writeU32(e.nUScaleCntSwing);
			w.writeU32(e.nTriggerId);
			w.writeU32(e.nParam00);
			w.writeU32(e.nParam01);
			w.writeU32(e.nParam02);
			writeExtras(w, e.extraData, packedExtraCount(e.nUScaleCntSwing), `state[${s}] events[${i}]`);
		});
	}

	if (state.threeDControls) {
		fixup(1);
		const sec = state.threeDControls;
		w.writeU32(sec.controls.length);
		w.writeU32(sec.numMainMap3DMixCtls);
		w.writeU32(sec._reserved02);
		w.writeU32(sec._reserved03);
		sec.controls.forEach((c, i) => {
			if (c.stateParams.length !== threeDStateParamCount(c.nInputId)) {
				throw new Error(`Nicotine writer: state[${s}] threeDControls[${i}] has ${c.stateParams.length} state params but nInputId's packed nibble says ${threeDStateParamCount(c.nInputId)}`);
			}
			w.writeU32(c.nInputId);
			for (const p of c.stateParams) {
				w.writeU32(p.n3DStateInfoId);
				w.writeU32(p.nCurveIdDoppler);
				w.writeU32(p.nQ0MinMax);
				w.writeU32(p.nQ1MinMax);
				w.writeU32(p.nQ2MinMax);
				w.writeU32(p.nQ3MinMax);
			}
		});
	}

	if (state.subMix) {
		fixup(2);
		const sec = state.subMix;
		w.writeU32(sec.channels.length);
		w.writeU32(sec.numUniqueSfxObjs);
		w.writeU32(sec.numMainIn);
		w.writeU32(sec.numSecIn);
		sec.channels.forEach((c, i) => {
			w.writeU32(c.mixChId);
			w.writeU32(c.upperLowerSwing);
			writeExtras(w, c.procOffsets, packedExtraCount(c.mixChId), `state[${s}] subMix[${i}]`);
		});
	}

	if (state.masterMix) {
		fixup(3);
		const sec = state.masterMix;
		w.writeU32(sec.channels.length);
		w.writeU32(sec.numUniqueSfxObjs);
		w.writeU32(sec.numMainIn);
		w.writeU32(sec.numSecIn);
		sec.channels.forEach((c, i) => {
			w.writeU32(c.mixChId);
			w.writeU32(c.mixData);
			w.writeU32(c.sfxObjId);
			writeExtras(w, c.extraData, packedExtraCount(c.mixChId), `state[${s}] masterMix[${i}]`);
		});
	}

	if (state.presets) {
		fixup(4);
		// The preset array has no header — the runtime sizes it from the master
		// section's NumMixChannels, so the two must agree.
		if (state.masterMix == null || state.presets.length !== state.masterMix.channels.length) {
			throw new Error(`Nicotine writer: state[${s}] has ${state.presets.length} presets but ${state.masterMix?.channels.length ?? 'no'} master mix channels — counts must match`);
		}
		state.presets.forEach((p, i) => {
			w.writeU32(p.header);
			writeExtras(w, p.extraData, presetExtraCount(p.header), `state[${s}] presets[${i}]`);
		});
	}
}
