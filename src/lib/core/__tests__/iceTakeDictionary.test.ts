// Structured ICE Take Dictionary parser/writer tests.
//
// Pins the on-disk container layout (DictionaryBase -> entry table -> contiguous
// takes), the byte-exact round-trip and writer idempotence against the real
// CAMERAS.BUNDLE 0x41 resource, and the heuristic fallback for malformed input.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
	parseIceTakeDictionary,
	writeIceTakeDictionary,
	parseIceTakeDictionaryStructured,
	parseIceTakeDictionaryData,
	describeIceTakeDictionary,
	isStructuredDictionary,
	type IceTakeDictionary,
} from '../iceTakeDictionary';
import { encodeValue } from '../iceVariableData';
import { ICE_ELEMENT_DESCRIPTIONS } from '../iceElementDescriptions';
import { parseBundle } from '../bundle';
import { extractResourceRaw } from '../registry';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const ICE_TYPE_ID = 0x41;
const ABS = path.resolve(REPO_ROOT, 'example/CAMERAS.BUNDLE');
const PRESENT = fs.existsSync(ABS);
const maybe = PRESENT ? it : it.skip;

function loadIceRaw(): Uint8Array {
	const buf = fs.readFileSync(ABS);
	const buffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
	const bundle = parseBundle(buffer);
	const resource = bundle.resources.find((r) => r.resourceTypeId === ICE_TYPE_ID)!;
	return extractResourceRaw(buffer, bundle, resource);
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.byteLength !== b.byteLength) return false;
	for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
	return true;
}

describe('structured ICE dictionary parse', () => {
	maybe('parses every entry with a take and 0x80000000 flags', () => {
		const model = parseIceTakeDictionary(loadIceRaw(), true);
		expect(model.kind).toBe('structured');
		expect(isStructuredDictionary(model)).toBe(true);
		expect(model.entries.length).toBeGreaterThan(500);
		for (const e of model.entries) {
			expect(e.userFlags).toBe(0x80000000);
			expect(e.take.elementCounts).toHaveLength(12);
			expect((e.key >> 32n)).toBe(0n); // CRC32 widened — high word zero
		}
	});

	maybe('pins a few known take names and lengths', () => {
		const model = parseIceTakeDictionary(loadIceRaw(), true);
		const byName = new Map(model.entries.map((e) => [e.take.name, e.take]));
		expect(byName.has('Events_Start_1')).toBe(true);
		const t = byName.get('Events_Start_1')!;
		expect(t.lengthSeconds).toBeCloseTo(10.008, 2);
		expect(t.guid).toBe(413810);
	});
});

describe('byte-exact round-trip on CAMERAS.BUNDLE', () => {
	maybe('write(parse(raw)) === raw', () => {
		const raw = loadIceRaw();
		const model = parseIceTakeDictionary(raw, true);
		const out = writeIceTakeDictionary(model, true);
		expect(bytesEqual(out, raw)).toBe(true);
	});

	maybe('writer is idempotent', () => {
		const raw = loadIceRaw();
		const write1 = writeIceTakeDictionary(parseIceTakeDictionary(raw, true), true);
		const write2 = writeIceTakeDictionary(parseIceTakeDictionary(write1, true), true);
		expect(bytesEqual(write1, write2)).toBe(true);
	});

	maybe('edited take re-encodes and survives a round-trip', () => {
		const raw = loadIceRaw();
		const model = parseIceTakeDictionary(raw, true);
		// Edit EYE_X (FLOAT, channel-0 key) of the first take that has a key.
		const target = model.entries.find((e) => e.take.elementCounts[0].keys > 0)!;
		const eyeX = target.take.runs.find((r) => r.index === 0)!;
		const newRaw = encodeValue(ICE_ELEMENT_DESCRIPTIONS[0], 42.25);
		eyeX.values[0] = { raw: newRaw, value: 42.25 };

		const out = writeIceTakeDictionary(model, true);
		const reparsed = parseIceTakeDictionary(out, true);
		const reTarget = reparsed.entries.find((e) => e.take.name === target.take.name)!;
		const reEyeX = reTarget.take.runs.find((r) => r.index === 0)!;
		expect(reEyeX.values[0].value).toBeCloseTo(42.25, 4);
	});
});

describe('container layout', () => {
	maybe('mpaIndex is 16 and takes follow the entry table contiguously', () => {
		const raw = loadIceRaw();
		const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
		const numEntries = dv.getUint32(0, true);
		const indexOffset = dv.getUint32(8, true);
		expect(indexOffset).toBe(16);
		const firstTake = dv.getUint32(indexOffset + 8, true);
		expect(firstTake).toBe(indexOffset + numEntries * 16);
	});
});

describe('heuristic fallback', () => {
	it('parseIceTakeDictionaryStructured falls back when the container is malformed', () => {
		// numEntries claims 5 but the payload is far too small for the table.
		const bad = new Uint8Array(20);
		new DataView(bad.buffer).setUint32(0, 5, true);
		new DataView(bad.buffer).setUint32(8, 1000, true);
		const model = parseIceTakeDictionaryStructured(bad, true);
		expect(isStructuredDictionary(model)).toBe(false);
	});

	it('parseIceTakeDictionaryData always returns the heuristic shape (legacy consumers)', () => {
		const model = parseIceTakeDictionaryData(new Uint8Array(64));
		expect(model.totalTakes).toBe(0);
		expect('kind' in model).toBe(false);
	});
});

describe('describeIceTakeDictionary', () => {
	maybe('summarises a structured dictionary', () => {
		const model = parseIceTakeDictionary(loadIceRaw(), true) as IceTakeDictionary;
		expect(describeIceTakeDictionary(model)).toMatch(/takes \d+/);
	});
});
