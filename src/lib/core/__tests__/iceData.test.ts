// Coverage for parseIceData / writeIceData (resource type 0x1000D).
//
// ICE Data is one standalone ICETakeData. The dedicated 0x1000D type is an
// early-development form superseded by the ICE Take Dictionary (0x41), so there
// is almost certainly no example bundle that ships one. We build a real take
// payload by extracting entry[0] from the dictionary in CAMERAS.BUNDLE and
// serialising it with the shared take codec — that standalone take payload IS
// exactly an ICE Data resource body. The remaining cases use a synthetic
// minimal take (no animated channels) so the round-trip is pinned even without
// the fixture, plus a trailing-bytes case for tail padding.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { parseIceData, writeIceData, describeIceData, type ParsedIceData } from '../iceData';
import {
	parseIceTakeData,
	writeIceTakeData,
	computeTakeSize,
	encodeValue,
	ICE_NUM_CHANNELS,
	type IceTake,
} from '../iceVariableData';
import { ICE_ELEMENT_DESCRIPTIONS } from '../iceElementDescriptions';
import { parseIceTakeDictionary, isStructuredDictionary } from '../iceTakeDictionary';
import { parseBundle } from '../bundle';
import { extractResourceRaw } from '../registry';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const ICE_TAKE_DICTIONARY_TYPE_ID = 0x41;
const CAMERAS = path.resolve(REPO_ROOT, 'example/CAMERAS.BUNDLE');
const HAS_CAMERAS = fs.existsSync(CAMERAS);
const maybe = HAS_CAMERAS ? it : it.skip;

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.byteLength !== b.byteLength) return false;
	for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
	return true;
}

// A standalone take payload is the byte body of an ICE Data resource. We mint
// one from the first dictionary entry of CAMERAS.BUNDLE.
function camerasTakePayload(): { payload: Uint8Array; take: IceTake } {
	const fileBytes = fs.readFileSync(CAMERAS);
	const buffer = new Uint8Array(fileBytes.byteLength);
	buffer.set(fileBytes);
	const bundle = parseBundle(buffer.buffer);
	const resource = bundle.resources.find((r) => r.resourceTypeId === ICE_TAKE_DICTIONARY_TYPE_ID)!;
	const raw = extractResourceRaw(buffer.buffer, bundle, resource);
	const model = parseIceTakeDictionary(raw, true);
	if (!isStructuredDictionary(model)) throw new Error('fixture did not parse to the structured model');
	const take = model.entries[0].take;
	return { payload: writeIceTakeData(take, true), take };
}

// Minimal synthetic take: no animated channels (every element count zero), so
// the variable data is just the index/parameter region (empty) padded to 4. The
// codec still emits every element run (all zero-length), so the payload is
// header + pad only.
function syntheticMinimalTake(): IceTake {
	const elementCounts = Array.from({ length: ICE_NUM_CHANNELS }, () => ({ intervals: 0, keys: 0 }));
	const nameBytes = new Uint8Array(32);
	nameBytes.set(new TextEncoder().encode('Synthetic'), 0);
	return {
		nodeBase: [0, 0],
		guid: 1234,
		name: 'Synthetic',
		nameBytes,
		lengthSeconds: 3.5,
		allocated: 0,
		elementCounts,
		indices: [],
		parameters: [],
		alignPadBytes: 0,
		runs: ICE_ELEMENT_DESCRIPTIONS.map((d) => ({
			index: d.index,
			isKey: d.index < 28,
			values: [],
		})),
	};
}

describe('parseIceData / writeIceData — CAMERAS-derived take payload', () => {
	maybe('write(parse(payload)) === payload (byte-exact)', () => {
		const { payload } = camerasTakePayload();
		const out = writeIceData(parseIceData(payload, true), true);
		expect(out.byteLength).toBe(payload.byteLength);
		expect(bytesEqual(out, payload)).toBe(true);
	});

	maybe('parses the take at offset 0 with no trailing bytes', () => {
		const { payload, take } = camerasTakePayload();
		const model = parseIceData(payload, true);
		expect(model.take.name).toBe(take.name);
		expect(model.take.guid).toBe(take.guid);
		expect(model.take.lengthSeconds).toBeCloseTo(take.lengthSeconds, 5);
		// A clean take payload (computeTakeSize bytes) leaves no tail padding.
		expect(model.trailing).toBeUndefined();
	});

	maybe('writer is idempotent', () => {
		const { payload } = camerasTakePayload();
		const write1 = writeIceData(parseIceData(payload, true), true);
		const write2 = writeIceData(parseIceData(write1, true), true);
		expect(bytesEqual(write1, write2)).toBe(true);
	});

	maybe('an edited take value re-encodes and survives a round-trip', () => {
		const { payload } = camerasTakePayload();
		const model = parseIceData(payload, true);
		// EYE_X (element 0, a channel-0 FLOAT key) is present whenever the take
		// has any channel-0 keys; if this take has none, fall back to editing the
		// length, which is always present.
		const eyeX = model.take.runs.find((r) => r.index === 0);
		if (eyeX && eyeX.values.length > 0) {
			eyeX.values[0] = { raw: encodeValue(ICE_ELEMENT_DESCRIPTIONS[0], 17.5), value: 17.5 };
			const re = parseIceData(writeIceData(model, true), true);
			const reEyeX = re.take.runs.find((r) => r.index === 0)!;
			expect(reEyeX.values[0].value).toBeCloseTo(17.5, 4);
		} else {
			model.take.lengthSeconds = 9.25;
			const re = parseIceData(writeIceData(model, true), true);
			expect(re.take.lengthSeconds).toBeCloseTo(9.25, 5);
		}
	});
});

describe('parseIceData / writeIceData — synthetic minimal take', () => {
	it('round-trips a no-animation take byte-exact', () => {
		const take = syntheticMinimalTake();
		const payload = writeIceTakeData(take, true);
		// Sanity: the synthetic payload is exactly the computed take size.
		expect(payload.byteLength).toBe(computeTakeSize(take.elementCounts));
		const out = writeIceData(parseIceData(payload, true), true);
		expect(bytesEqual(out, payload)).toBe(true);
	});

	it('decodes the synthetic take metadata', () => {
		const payload = writeIceTakeData(syntheticMinimalTake(), true);
		const model = parseIceData(payload, true);
		expect(model.take.name).toBe('Synthetic');
		expect(model.take.guid).toBe(1234);
		expect(model.take.lengthSeconds).toBeCloseTo(3.5, 5);
		expect(model.trailing).toBeUndefined();
	});

	it('round-trips in big-endian too', () => {
		const payload = writeIceTakeData(syntheticMinimalTake(), false);
		const out = writeIceData(parseIceData(payload, false), false);
		expect(bytesEqual(out, payload)).toBe(true);
	});
});

describe('parseIceData / writeIceData — trailing bytes', () => {
	it('captures and re-emits tail padding after the take verbatim', () => {
		const take = syntheticMinimalTake();
		const takeBytes = writeIceTakeData(take, true);
		const tail = new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0x00, 0x11]);
		const payload = new Uint8Array(takeBytes.byteLength + tail.byteLength);
		payload.set(takeBytes, 0);
		payload.set(tail, takeBytes.byteLength);

		const model = parseIceData(payload, true);
		expect(model.trailing).toBeDefined();
		expect(bytesEqual(model.trailing!, tail)).toBe(true);
		expect(bytesEqual(writeIceData(model, true), payload)).toBe(true);
	});

	it('writeIceData omits a zero-length trailing buffer', () => {
		const take = syntheticMinimalTake();
		const takeBytes = writeIceTakeData(take, true);
		const model: ParsedIceData = { take, trailing: new Uint8Array(0) };
		expect(bytesEqual(writeIceData(model, true), takeBytes)).toBe(true);
	});
});

describe('describeIceData', () => {
	it('summarises the take name and length', () => {
		const take = syntheticMinimalTake();
		expect(describeIceData({ take })).toBe('take "Synthetic", 3.50s');
	});

	it('falls back to the guid when the take is unnamed', () => {
		const take = syntheticMinimalTake();
		take.name = '';
		take.guid = 99;
		expect(describeIceData({ take })).toBe('take "guid 99", 3.50s');
	});
});
