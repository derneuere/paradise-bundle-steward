// ICE Data parser and writer (resource type 0x1000D).
//
// ICE Data is the early-development standalone form of a SINGLE camera take: it
// is exactly one ICETakeData (the fixed header plus its bit-packed keyframe
// stream) starting at offset 0 — the same structure the ICE Take Dictionary
// (0x41) wraps many of. The standalone resource type was superseded by the
// dictionary, but the underlying take layout lived on, so this is a thin wrapper
// over the shared take codec in iceVariableData.ts.
//
// Byte-exactness: parseIceTakeData / writeIceTakeData already preserve each
// value's raw packed bits, so an unedited take round-trips bit-for-bit. The take
// occupies computeTakeSize(elementCounts) bytes; any bytes after that in the raw
// payload (e.g. resource-tail alignment padding) are captured verbatim into
// `trailing` and re-emitted, so the whole buffer round-trips regardless of size.

import {
	parseIceTakeData,
	writeIceTakeData,
	computeTakeSize,
	type IceTake,
} from './iceVariableData';

export type ParsedIceData = {
	/** The single camera take this resource holds (starts at offset 0). */
	take: IceTake;
	/** Bytes after the take payload (alignment / tail padding), preserved
	 *  verbatim so the round-trip is byte-exact. Absent when the take consumes
	 *  the whole buffer. */
	trailing?: Uint8Array;
};

export function parseIceData(raw: Uint8Array, littleEndian = true): ParsedIceData {
	const take = parseIceTakeData(raw, 0, littleEndian);
	// The take's on-disk span is computable from its element counts; anything
	// past it is tail padding the writer must reproduce.
	const consumed = computeTakeSize(take.elementCounts);
	const trailing = consumed < raw.byteLength ? raw.slice(consumed) : undefined;
	return trailing ? { take, trailing } : { take };
}

export function writeIceData(model: ParsedIceData, littleEndian = true): Uint8Array {
	const takeBytes = writeIceTakeData(model.take, littleEndian);
	if (!model.trailing || model.trailing.byteLength === 0) return takeBytes;
	const out = new Uint8Array(takeBytes.byteLength + model.trailing.byteLength);
	out.set(takeBytes, 0);
	out.set(model.trailing, takeBytes.byteLength);
	return out;
}

export function describeIceData(model: ParsedIceData): string {
	const { name, lengthSeconds } = model.take;
	const label = name && name.length > 0 ? name : `guid ${model.take.guid}`;
	return `take "${label}", ${lengthSeconds.toFixed(2)}s`;
}

export type { IceTake };
