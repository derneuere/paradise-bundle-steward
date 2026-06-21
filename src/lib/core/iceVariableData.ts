// ICE take variable-data codec — the per-take keyframe channel stream inside an
// ICE Take Dictionary (resource 0x41). See docs/ICEData.md and
// docs/ICEElementDescriptions.md for the format.
//
// An ICETakeData is a fixed 100-byte header (32-bit layout) followed by a
// self-describing-only-with-the-element-table byte stream:
//
//   header(100) → indices(u16[]) → parameters(u16[]) → pad-to-4 → 48 value runs
//
// The 48 value runs are walked in element-description order. For each element,
// the value count is mElementCounts[channel].mu16Keys when the element is a key
// (index < 28) or .mu16Intervals when it is an interval (index >= 28). One run
// occupies `((dataBits*count+31)>>3)&~3` bytes — the bit-packed values rounded
// up to a whole number of 4-byte words. Values are bit-packed MSB-first
// (big-endian bit order) and pulled `dataBits` at a time, EXCEPT eICE_FLOAT
// which is a byte-aligned native IEEE-754 32-bit float.
//
// BYTE-EXACT round-trip strategy: FIXED decode is lossy float math, so we never
// re-derive the packed bits from the decoded scalar on write. Each decoded value
// keeps its `raw` packed integer (for FLOAT, the raw 32-bit IEEE bit pattern)
// alongside the human-facing `value`. The writer re-emits `raw` verbatim, so an
// unedited take round-trips bit-for-bit. `encodeValue()` recomputes `raw` from an
// edited scalar (per-type clamp + quantize) for the edit path. The indices and
// parameters arrays and the 0-or-2-byte alignment pad are preserved verbatim.

import {
	ICE_ELEMENT_DESCRIPTIONS,
	ICE_NUM_ELEMENTS,
	ICEDataType,
	isIceKeyElement,
	type ICEElementDescription,
} from './iceElementDescriptions';

export const ICE_NUM_CHANNELS = 12;
/** Fixed 32-bit ICETakeData header size in bytes. */
export const ICE_TAKE_HEADER_SIZE = 0x64; // 100
const ICE_PARAMETER_MAX = 65535;

export type IceElementCount = {
	/** mu16Intervals — value count for interval elements (index >= 28). */
	intervals: number;
	/** mu16Keys — value count for key elements (index < 28). */
	keys: number;
};

/**
 * One decoded value in a run. `raw` is the packed integer pulled from the bit
 * stream: sign-extended for INT, the unsigned code for FIXED/UINT/HASH, and the
 * 32-bit IEEE bit pattern for FLOAT. `value` is the human-facing scalar. The
 * writer only ever re-emits `raw` (masked to the field width), so an unedited
 * value round-trips bit-for-bit even though FIXED decode is lossy float math.
 */
export type IceValue = {
	raw: number;
	value: number;
};

/** All decoded values for one of the 48 elements within a take. */
export type IceElementRun = {
	/** Description index 0..47. */
	index: number;
	/** `true` if this is a key element (count from mu16Keys), else interval. */
	isKey: boolean;
	values: IceValue[];
};

export type IceTake = {
	/** bTNode/bNode next+prev — always 0 on disk; preserved for completeness. */
	nodeBase: [number, number];
	/** miGuid — GameDB id. */
	guid: number;
	/** macTakeName — decoded NUL-trimmed name. */
	name: string;
	/** Raw 32 bytes of macTakeName, preserved so non-canonical padding round-trips. */
	nameBytes: Uint8Array;
	/** mfLength — take length in seconds. */
	lengthSeconds: number;
	/** muAllocated. */
	allocated: number;
	/** mElementCounts[12]. */
	elementCounts: IceElementCount[];
	/** Indices region (u16[]), preserved verbatim. */
	indices: number[];
	/** Parameters region (ICEParameter u16[]), preserved verbatim as packed u16. */
	parameters: number[];
	/** 0 or 2 bytes of alignment pad after the parameters region. */
	alignPadBytes: number;
	/** Decoded value runs, one per element, in description-index order. */
	runs: IceElementRun[];
};

// --- bit stream (MSB-first / big-endian bit order) -----------------------------

class MsbBitReader {
	private bytes: Uint8Array;
	private bitPos: number; // absolute bit offset from `base`

	constructor(bytes: Uint8Array, byteOffset: number) {
		this.bytes = bytes;
		this.bitPos = byteOffset * 8;
	}

	/** Read `n` bits MSB-first as an unsigned integer (n <= 32). */
	read(n: number): number {
		let result = 0;
		for (let i = 0; i < n; i++) {
			const byteIdx = this.bitPos >> 3;
			const bitInByte = 7 - (this.bitPos & 7); // MSB first
			const bit = (this.bytes[byteIdx] >> bitInByte) & 1;
			result = (result << 1) | bit;
			this.bitPos++;
		}
		return result >>> 0;
	}
}

class MsbBitWriter {
	private bytes: Uint8Array;
	private bitPos: number;

	constructor(bytes: Uint8Array, byteOffset: number) {
		this.bytes = bytes;
		this.bitPos = byteOffset * 8;
	}

	/** Write the low `n` bits of `value` MSB-first. */
	write(value: number, n: number): void {
		for (let i = n - 1; i >= 0; i--) {
			const bit = (value >>> i) & 1;
			const byteIdx = this.bitPos >> 3;
			const bitInByte = 7 - (this.bitPos & 7);
			if (bit) this.bytes[byteIdx] |= 1 << bitInByte;
			this.bitPos++;
		}
	}
}

// --- sizing --------------------------------------------------------------------

/** Bytes occupied by one element's packed value run. */
export function runByteSize(dataBits: number, count: number): number {
	return ((dataBits * count + 31) >> 3) & ~3;
}

function elementValueCount(desc: ICEElementDescription, counts: IceElementCount[]): number {
	const c = counts[desc.channel];
	return isIceKeyElement(desc.index) ? c.keys : c.intervals;
}

function totalIndices(counts: IceElementCount[]): number {
	let n = 0;
	for (const c of counts) n += Math.max(c.intervals - 2, 0);
	return n;
}

function totalParameters(counts: IceElementCount[]): number {
	let n = 0;
	for (const c of counts) n += Math.max(c.intervals - 1, 0);
	return n;
}

/**
 * Total on-disk size of one ICETakeData (header + variable data), matching the
 * runtime ComputeActualSize. The index+parameter region is padded to a 4-byte
 * boundary, then every element's packed value run is added.
 */
export function computeTakeSize(counts: IceElementCount[]): number {
	const ti = totalIndices(counts);
	const tp = totalParameters(counts);
	let size = (((2 * ti + 101) & ~1) + 2 * tp + 3) & ~3;
	for (const desc of ICE_ELEMENT_DESCRIPTIONS) {
		size += runByteSize(desc.dataBits, elementValueCount(desc, counts));
	}
	return size;
}

// --- value decode / encode -----------------------------------------------------

/** Sign-extend a `bits`-wide unsigned integer to a signed 32-bit JS number. */
function signExtend(value: number, bits: number): number {
	if (bits >= 32) return value | 0;
	const signBit = 1 << (bits - 1);
	return (value & signBit) ? value - (1 << bits) : value;
}

/**
 * The eICE_FIXED quantization (decode). `raw` is the UNSIGNED `dataBits`-bit
 * code (0..maxValue) read from the stream; the quantization spreads it across
 * [min, max] with `default` at slot `quantSlotsLo`. Mirrors ICEElementDescription
 * Prepare + Decode. (The on-disk codes occupy the full unsigned width, so the
 * quant math is unsigned even though the field is nominally signed.)
 */
export function decodeFixed(desc: ICEElementDescription, raw: number): number {
	const maxValue = (1 << desc.dataBits) - 1;
	const quantRangeLo = desc.default - desc.min;
	const quantRangeHi = desc.max - desc.default;
	const quantSlotsHi = Math.round((quantRangeHi * maxValue) / (desc.max - desc.min));
	const quantSlotsLo = maxValue - quantSlotsHi;

	let result = desc.default;
	const v = raw - quantSlotsLo;
	if (v >= 0) {
		if (quantSlotsHi !== 0) result += (quantRangeHi * v) / quantSlotsHi;
	} else {
		if (quantSlotsLo !== 0) result += (quantRangeLo * v) / quantSlotsLo;
	}
	return Math.fround(result);
}

/**
 * Inverse of decodeFixed: pick the unsigned `dataBits`-bit code (0..maxValue)
 * whose decode is closest to `scalar`. Computed analytically then snapped to the
 * integer grid, with a ±1 neighbour search to absorb rounding. Edit path only.
 */
function encodeFixed(desc: ICEElementDescription, scalar: number): number {
	const maxValue = (1 << desc.dataBits) - 1;
	const quantRangeLo = desc.default - desc.min;
	const quantRangeHi = desc.max - desc.default;
	const quantSlotsHi = Math.round((quantRangeHi * maxValue) / (desc.max - desc.min));
	const quantSlotsLo = maxValue - quantSlotsHi;

	const clamped = Math.min(desc.max, Math.max(desc.min, scalar));
	let approx: number;
	if (clamped >= desc.default) {
		approx = quantSlotsHi !== 0 && quantRangeHi !== 0
			? quantSlotsLo + ((clamped - desc.default) * quantSlotsHi) / quantRangeHi
			: quantSlotsLo;
	} else {
		approx = quantSlotsLo !== 0 && quantRangeLo !== 0
			? quantSlotsLo + ((clamped - desc.default) * quantSlotsLo) / quantRangeLo
			: quantSlotsLo;
	}
	let best = Math.max(0, Math.min(maxValue, Math.round(approx)));
	let bestErr = Math.abs(decodeFixed(desc, best) - clamped);
	for (const cand of [best - 1, best + 1]) {
		if (cand < 0 || cand > maxValue) continue;
		const err = Math.abs(decodeFixed(desc, cand) - clamped);
		if (err < bestErr) { bestErr = err; best = cand; }
	}
	return best;
}

/** Decode a raw packed value into its human-facing scalar by data type. */
export function decodeValue(desc: ICEElementDescription, raw: number): number {
	switch (desc.dataType) {
		case ICEDataType.FLOAT: {
			// raw is the 32-bit IEEE bit pattern.
			const buf = new DataView(new ArrayBuffer(4));
			buf.setUint32(0, raw >>> 0, false);
			return buf.getFloat32(0, false);
		}
		case ICEDataType.INT:
			return signExtend(raw, desc.dataBits);
		case ICEDataType.UINT:
			return raw >>> 0; // index; UI maps to tokens[raw] when present
		case ICEDataType.HASH:
			return raw >>> 0;
		case ICEDataType.FIXED:
			return decodeFixed(desc, raw >>> 0);
		default:
			return raw >>> 0;
	}
}

const FIELD_MASK = (bits: number) => (bits >= 32 ? 0xffffffff : (1 << bits) - 1);

/**
 * Recompute the packed `raw` integer from an edited scalar, per data type. This
 * is the edit path; unedited values keep their stored `raw` for byte-exactness.
 *
 * - FLOAT: the IEEE bit pattern of the (Math.fround'd) scalar.
 * - INT: clamped to the signed range, stored as a two's-complement field.
 * - UINT/HASH: clamped to the unsigned field width.
 * - FIXED: inverse quantization (encodeFixed), stored two's-complement.
 */
export function encodeValue(desc: ICEElementDescription, scalar: number): number {
	switch (desc.dataType) {
		case ICEDataType.FLOAT: {
			const buf = new DataView(new ArrayBuffer(4));
			buf.setFloat32(0, Math.fround(scalar), false);
			return buf.getUint32(0, false);
		}
		case ICEDataType.INT: {
			const lo = -(1 << (desc.dataBits - 1));
			const hi = (1 << (desc.dataBits - 1)) - 1;
			const clamped = Math.round(Math.min(hi, Math.max(lo, scalar)));
			return clamped & FIELD_MASK(desc.dataBits);
		}
		case ICEDataType.UINT:
		case ICEDataType.HASH: {
			const max = FIELD_MASK(desc.dataBits) >>> 0;
			const clamped = Math.round(Math.min(max, Math.max(0, scalar)));
			return clamped >>> 0;
		}
		case ICEDataType.FIXED:
			return encodeFixed(desc, scalar) & FIELD_MASK(desc.dataBits);
		default: {
			const max = FIELD_MASK(desc.dataBits) >>> 0;
			return (Math.round(Math.min(max, Math.max(0, scalar))) >>> 0);
		}
	}
}

/**
 * Pack a normalized [0,1] value as an ICEParameter u16 (muPacked), round-half-up,
 * matching SetValue. Exposed for the parameters-array edit path.
 */
export function packIceParameter(value: number): number {
	const clamped = Math.min(1, Math.max(0, value));
	return Math.floor(clamped * ICE_PARAMETER_MAX + 0.5);
}

/** GetValue: muPacked / 65535. */
export function unpackIceParameter(packed: number): number {
	return packed / ICE_PARAMETER_MAX;
}

// --- take parse / write --------------------------------------------------------

/**
 * Parse one ICETakeData (header + variable data) at `offset` within `payload`.
 * `littleEndian` selects the byte order of the scalar header fields and the
 * u16 index/parameter arrays; the value bit-runs are always MSB-first.
 */
export function parseIceTakeData(payload: Uint8Array, offset: number, littleEndian: boolean): IceTake {
	const dv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
	const u16 = (o: number) => dv.getUint16(o, littleEndian);
	const u32 = (o: number) => dv.getUint32(o, littleEndian);

	const nodeBase: [number, number] = [u32(offset), u32(offset + 4)];
	const guid = dv.getInt32(offset + 8, littleEndian);
	const nameBytes = payload.slice(offset + 0x0c, offset + 0x0c + 32);
	const nul = nameBytes.indexOf(0);
	const name = new TextDecoder().decode(nul >= 0 ? nameBytes.subarray(0, nul) : nameBytes);
	const lengthSeconds = dv.getFloat32(offset + 0x2c, littleEndian);
	const allocated = u32(offset + 0x30);

	const elementCounts: IceElementCount[] = [];
	for (let c = 0; c < ICE_NUM_CHANNELS; c++) {
		const base = offset + 0x34 + c * 4;
		elementCounts.push({ intervals: u16(base), keys: u16(base + 2) });
	}

	let p = offset + ICE_TAKE_HEADER_SIZE;
	const ti = totalIndices(elementCounts);
	const tp = totalParameters(elementCounts);

	const indices: number[] = [];
	for (let i = 0; i < ti; i++) { indices.push(u16(p)); p += 2; }
	const parameters: number[] = [];
	for (let i = 0; i < tp; i++) { parameters.push(u16(p)); p += 2; }

	// Align the read pointer to the next multiple of 4 relative to the take start.
	const relAfterArrays = p - offset;
	const aligned = (relAfterArrays + 3) & ~3;
	const alignPadBytes = aligned - relAfterArrays;
	p = offset + aligned;

	const runs: IceElementRun[] = [];
	for (const desc of ICE_ELEMENT_DESCRIPTIONS) {
		const count = elementValueCount(desc, elementCounts);
		const runBytes = runByteSize(desc.dataBits, count);
		const values: IceValue[] = [];
		if (desc.dataType === ICEDataType.FLOAT) {
			// Byte-aligned native-endian IEEE-754. `raw` is the true IEEE bit
			// pattern (read with the payload's endianness) so decodeValue can
			// reinterpret it directly and the writer re-emits the same bytes.
			for (let i = 0; i < count; i++) {
				const raw = dv.getUint32(p + i * 4, littleEndian);
				values.push({ raw, value: decodeValue(desc, raw) });
			}
		} else {
			const reader = new MsbBitReader(payload, p);
			for (let i = 0; i < count; i++) {
				const bits = reader.read(desc.dataBits);
				// INT carries a sign-extended raw so the model shows the true
				// field value. FIXED keeps the raw UNSIGNED code (the quant math
				// is unsigned). UINT/HASH stay unsigned. The writer masks anyway.
				const raw = desc.dataType === ICEDataType.INT ? signExtend(bits, desc.dataBits) : bits >>> 0;
				values.push({ raw, value: decodeValue(desc, raw) });
			}
		}
		runs.push({ index: desc.index, isKey: isIceKeyElement(desc.index), values });
		p += runBytes;
	}

	return {
		nodeBase,
		guid,
		name,
		nameBytes,
		lengthSeconds,
		allocated,
		elementCounts,
		indices,
		parameters,
		alignPadBytes,
		runs,
	};
}

/** Re-emit one ICETakeData byte-exact. */
export function writeIceTakeData(take: IceTake, littleEndian: boolean): Uint8Array {
	const size = computeTakeSize(take.elementCounts);
	const out = new Uint8Array(size);
	const dv = new DataView(out.buffer);
	const setU16 = (o: number, v: number) => dv.setUint16(o, v & 0xffff, littleEndian);
	const setU32 = (o: number, v: number) => dv.setUint32(o, v >>> 0, littleEndian);

	// node base is zeroed on disk (FixDown clears the in-memory links).
	setU32(0, take.nodeBase[0] >>> 0);
	setU32(4, take.nodeBase[1] >>> 0);
	dv.setInt32(8, take.guid | 0, littleEndian);
	out.set(take.nameBytes.subarray(0, 32), 0x0c);
	dv.setFloat32(0x2c, take.lengthSeconds, littleEndian);
	setU32(0x30, take.allocated >>> 0);
	for (let c = 0; c < ICE_NUM_CHANNELS; c++) {
		const base = 0x34 + c * 4;
		setU16(base, take.elementCounts[c].intervals);
		setU16(base + 2, take.elementCounts[c].keys);
	}

	let p = ICE_TAKE_HEADER_SIZE;
	for (const idx of take.indices) { setU16(p, idx); p += 2; }
	for (const par of take.parameters) { setU16(p, par); p += 2; }
	// alignment pad bytes are already zero in `out`.
	p += take.alignPadBytes;

	const runByIndex = new Map(take.runs.map((r) => [r.index, r]));
	for (const desc of ICE_ELEMENT_DESCRIPTIONS) {
		const count = elementValueCount(desc, take.elementCounts);
		const runBytes = runByteSize(desc.dataBits, count);
		const run = runByIndex.get(desc.index);
		if (desc.dataType === ICEDataType.FLOAT) {
			for (let i = 0; i < count; i++) {
				const raw = run?.values[i]?.raw ?? 0;
				dv.setUint32(p + i * 4, raw >>> 0, littleEndian);
			}
		} else if (count > 0) {
			const writer = new MsbBitWriter(out, p);
			for (let i = 0; i < count; i++) {
				const raw = run?.values[i]?.raw ?? 0;
				writer.write(raw & FIELD_MASK(desc.dataBits), desc.dataBits);
			}
		}
		p += runBytes;
	}

	return out;
}

export { ICE_NUM_ELEMENTS };
