// Codec tests for the ICE take variable-data reader/writer. Two layers:
//   1. Synthetic per-dataType round-trips (INT/UINT/HASH/FIXED/FLOAT, key +
//      interval elements) built from element descriptions, plus the edit
//      re-encode path (encodeValue / packIceParameter).
//   2. Real-payload checks: parse the 0x41 resource from CAMERAS.BUNDLE and
//      confirm a few decoded take fields and channel values.
//
// The dictionary-level byte-exact round-trip lives in the registry fixture
// suite (handler.fixtures byteRoundTrip) and iceTakeDictionary.test.ts; here we
// exercise the codec at the take level.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
	parseIceTakeData,
	writeIceTakeData,
	computeTakeSize,
	runByteSize,
	decodeFixed,
	decodeValue,
	encodeValue,
	packIceParameter,
	unpackIceParameter,
	ICE_TAKE_HEADER_SIZE,
	type IceTake,
	type IceElementCount,
} from '../iceVariableData';
import {
	ICE_ELEMENT_DESCRIPTIONS,
	ICEDataType,
	isIceKeyElement,
} from '../iceElementDescriptions';
import { parseBundle } from '../bundle';
import { extractResourceRaw } from '../registry';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const ICE_TYPE_ID = 0x41;

// --- helpers to build a synthetic take ---------------------------------------

function emptyCounts(): IceElementCount[] {
	return Array.from({ length: 12 }, () => ({ intervals: 0, keys: 0 }));
}

/** Build a take whose runs decode-then-re-encode from the given per-element raw codes. */
function buildTake(counts: IceElementCount[], rawFor: (index: number, i: number) => number): IceTake {
	const runs = ICE_ELEMENT_DESCRIPTIONS.map((desc) => {
		const c = counts[desc.channel];
		const count = isIceKeyElement(desc.index) ? c.keys : c.intervals;
		const values = Array.from({ length: count }, (_, i) => {
			const raw = rawFor(desc.index, i);
			return { raw, value: decodeValue(desc, raw) };
		});
		return { index: desc.index, isKey: isIceKeyElement(desc.index), values };
	});
	return {
		nodeBase: [0, 0],
		guid: 1234,
		name: 'SYNTH',
		nameBytes: makeName('SYNTH'),
		lengthSeconds: 3.5,
		allocated: 1,
		elementCounts: counts,
		indices: [],
		parameters: [],
		alignPadBytes: 0,
		runs,
	};
}

function makeName(s: string): Uint8Array {
	const b = new Uint8Array(32);
	b.set(new TextEncoder().encode(s));
	return b;
}

function roundTripTake(take: IceTake, le = true): IceTake {
	const bytes = writeIceTakeData(take, le);
	return parseIceTakeData(bytes, 0, le);
}

describe('ICE codec sizing', () => {
	it('runByteSize rounds bit-packed values up to a 4-byte word', () => {
		expect(runByteSize(10, 0)).toBe(0);
		expect(runByteSize(10, 1)).toBe(4); // 10 bits -> 4 bytes
		expect(runByteSize(10, 3)).toBe(4); // 30 bits -> 4 bytes
		expect(runByteSize(10, 4)).toBe(8); // 40 bits -> 8 bytes
		expect(runByteSize(32, 2)).toBe(8); // two 32-bit floats
	});

	it('computeTakeSize is header + 4-aligned index/param region + value runs', () => {
		const counts = emptyCounts();
		// no values, no indices, no params -> just the 100-byte header.
		expect(computeTakeSize(counts)).toBe(ICE_TAKE_HEADER_SIZE);
	});
});

describe('per-dataType raw round-trip through writeIceTakeData/parseIceTakeData', () => {
	// channel 0 carries the FLOAT/FIXED key elements (EYE_*, DUTCH, etc.);
	// giving it keys exercises both FLOAT (byte-aligned) and FIXED (bit-packed).
	it('FLOAT key values survive byte-exact', () => {
		const counts = emptyCounts();
		counts[0].keys = 2; // EYE_X..LOOK_Z + DUTCH.. all channel-0 keys
		const eyeXRaw = encodeValue(ICE_ELEMENT_DESCRIPTIONS[0], 12.5);
		const take = buildTake(counts, (index, i) =>
			index === 0 ? (i === 0 ? eyeXRaw : encodeValue(ICE_ELEMENT_DESCRIPTIONS[0], -3.25)) : 0,
		);
		const back = roundTripTake(take);
		const eyeX = back.runs.find((r) => r.index === 0)!;
		expect(eyeX.values[0].value).toBeCloseTo(12.5, 5);
		expect(eyeX.values[1].value).toBeCloseTo(-3.25, 5);
	});

	it('FIXED key values (DUTCH, 10-bit) decode within [min,max] and round-trip raw', () => {
		const dutch = ICE_ELEMENT_DESCRIPTIONS[6];
		const counts = emptyCounts();
		counts[0].keys = 1;
		const raw = encodeValue(dutch, 0.1);
		const take = buildTake(counts, (index) => (index === 6 ? raw : 0));
		const back = roundTripTake(take);
		const run = back.runs.find((r) => r.index === 6)!;
		expect(run.values[0].raw).toBe(raw);
		expect(run.values[0].value).toBeCloseTo(0.1, 3);
		expect(run.values[0].value).toBeGreaterThanOrEqual(dutch.min);
		expect(run.values[0].value).toBeLessThanOrEqual(dutch.max);
	});

	it('UINT interval element with tokens (SPACE_EYE) keeps the stored index', () => {
		const space = ICE_ELEMENT_DESCRIPTIONS[30]; // interval (index >= 28)
		const counts = emptyCounts();
		counts[space.channel].intervals = 1; // channel 0
		const take = buildTake(counts, (index) => (index === 30 ? 3 : 0));
		const back = roundTripTake(take);
		const run = back.runs.find((r) => r.index === 30)!;
		expect(run.values[0].raw).toBe(3);
		expect(space.tokens[3]).toBe('Scene');
	});

	it('HASH interval element (EVENT_TAG, 32-bit) carries a full u32', () => {
		const counts = emptyCounts();
		counts[5].intervals = 1; // EVENT_TAG channel
		const take = buildTake(counts, (index) => (index === 41 ? 0xdeadbeef : 0));
		const back = roundTripTake(take);
		const run = back.runs.find((r) => r.index === 41)!;
		expect(run.values[0].raw >>> 0).toBe(0xdeadbeef);
		expect(run.values[0].value).toBe(0xdeadbeef);
	});

	it('INT round-trips a sign-extended field (none ship in retail, exercised synthetically)', () => {
		// No element ships as eICE_INT, so build a synthetic decode/encode pair
		// against a fabricated INT description to cover the sign path.
		const intDesc = { ...ICE_ELEMENT_DESCRIPTIONS[6], dataType: ICEDataType.INT, dataBits: 8 } as typeof ICE_ELEMENT_DESCRIPTIONS[6];
		const raw = encodeValue(intDesc, -5);
		expect(decodeValue(intDesc, raw)).toBe(-5);
		const rawPos = encodeValue(intDesc, 100);
		expect(decodeValue(intDesc, rawPos)).toBe(100);
	});
});

describe('FIXED quantization edit path', () => {
	it('decode→encode→decode is value-stable for every code of every FIXED element', () => {
		for (const desc of ICE_ELEMENT_DESCRIPTIONS) {
			if (desc.dataType !== ICEDataType.FIXED) continue;
			const maxValue = (1 << desc.dataBits) - 1;
			// sample to keep the test fast on the 16-bit elements
			const step = Math.max(1, Math.floor((maxValue + 1) / 512));
			for (let code = 0; code <= maxValue; code += step) {
				const v = decodeFixed(desc, code);
				const code2 = encodeValue(desc, v);
				const v2 = decodeValue(desc, code2);
				expect(Math.abs(v - v2)).toBeLessThan(1e-3);
			}
		}
	});

	it('encodeValue clamps out-of-range scalars to the field extremes', () => {
		const lens = ICE_ELEMENT_DESCRIPTIONS[9]; // [5, 500]
		expect(decodeValue(lens, encodeValue(lens, -999))).toBeCloseTo(5, 3);
		expect(decodeValue(lens, encodeValue(lens, 99999))).toBeCloseTo(500, 3);
	});
});

describe('ICEParameter pack/unpack', () => {
	it('packs round-half-up and clamps to [0,1]', () => {
		expect(packIceParameter(0)).toBe(0);
		expect(packIceParameter(1)).toBe(65535);
		expect(packIceParameter(2)).toBe(65535); // clamp high
		expect(packIceParameter(-1)).toBe(0); // clamp low
		expect(packIceParameter(0.5)).toBe(Math.floor(0.5 * 65535 + 0.5));
	});
	it('unpack is the inverse scale', () => {
		expect(unpackIceParameter(65535)).toBeCloseTo(1, 6);
		expect(unpackIceParameter(0)).toBe(0);
	});
});

describe('CAMERAS.BUNDLE real take decode', () => {
	const abs = path.resolve(REPO_ROOT, 'example/CAMERAS.BUNDLE');
	const present = fs.existsSync(abs);
	const maybe = present ? it : it.skip;

	maybe('parses the first take with sane header + channel-0 EYE values', () => {
		const buf = fs.readFileSync(abs);
		const buffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
		const bundle = parseBundle(buffer);
		const resource = bundle.resources.find((r) => r.resourceTypeId === ICE_TYPE_ID)!;
		const raw = extractResourceRaw(buffer, bundle, resource);

		// DictEntry[0].mpData is the first take offset; read it from the container.
		const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
		const indexOffset = dv.getUint32(8, true);
		const firstTakeOffset = dv.getUint32(indexOffset + 8, true);
		const take = parseIceTakeData(raw, firstTakeOffset, true);

		expect(take.name).toBe('Events_Start_1');
		expect(take.lengthSeconds).toBeGreaterThan(0);
		expect(take.elementCounts).toHaveLength(12);
		expect(take.nodeBase).toEqual([0, 0]); // zeroed on disk

		// channel 0 carries EYE_X..EYE_Z; with keys>0 those decode to camera coords.
		const eyeX = take.runs.find((r) => r.index === 0)!;
		expect(eyeX.values.length).toBe(take.elementCounts[0].keys);
		for (const v of eyeX.values) expect(Number.isFinite(v.value)).toBe(true);

		// re-emit and confirm the take re-serializes to its computed size.
		const bytes = writeIceTakeData(take, true);
		expect(bytes.byteLength).toBe(computeTakeSize(take.elementCounts));
	});
});
