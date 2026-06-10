// Gold coverage for parseWheelList / writeWheelList.
//
// Pins hand-verified decoded values from WHEELLIST.BUNDLE and the
// cross-bundle relationship to the wheel graphics bundles: decodeCgsId of an
// entry's mId is the wheel CODE that names WHE_<code>_GR.BNDL and the
// WheelGraphicsSpec resource inside it (<code>_Graphics).

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { parseWheelList, writeWheelList, MAX_WHEEL_NAME_CHARS } from '../wheelList';
import { decodeCgsId } from '../cgsid';
import { parseBundle } from '../bundle';
import { parseDebugDataFromXml, findDebugResourceById } from '../bundle/debugData';
import { extractResourceRaw } from '../registry';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const WHEEL_LIST_TYPE_ID = 0x10009;

function loadBundle(bundleFile: string) {
	const buf = fs.readFileSync(path.resolve(REPO_ROOT, bundleFile));
	const buffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
	const bundle = parseBundle(buffer);
	const debugResources = typeof bundle.debugData === 'string'
		? parseDebugDataFromXml(bundle.debugData)
		: [];
	return { buffer, bundle, debugResources };
}

function loadWheelListRaw(): { raw: Uint8Array; name: string } {
	const { buffer, bundle, debugResources } = loadBundle('example/WHEELLIST.BUNDLE');
	const res = bundle.resources.find((r) => r.resourceTypeId === WHEEL_LIST_TYPE_ID);
	expect(res).toBeDefined();
	return {
		raw: new Uint8Array(extractResourceRaw(buffer, bundle, res!)),
		name: findDebugResourceById(debugResources, res!.resourceId.low.toString(16))?.name ?? '?',
	};
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.byteLength !== b.byteLength) return false;
	for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
	return true;
}

describe('WheelList gold values (example/WHEELLIST.BUNDLE)', () => {
	const { raw, name } = loadWheelListRaw();
	const m = parseWheelList(raw);

	it('is the single B5WheelList resource, 172 wheels filling the payload exactly', () => {
		expect(name).toBe('B5WheelList');
		expect(m.entries.length).toBe(172);
		// 0x10 header + 172 * 0x48 entries — no trailing pad in retail.
		expect(raw.byteLength).toBe(0x10 + 172 * 0x48);
		expect(m._trailingPad.byteLength).toBe(0);
		// Header pad (wiki: mu16BytePad) is zero, unlike IdList's garbage pads.
		expect([...m._pad08]).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
	});

	it('decodes hand-verified entries', () => {
		expect(m.entries[0]).toEqual({ mId: 0x2f9a6e5c310f8000n, macWheelName: '5Spoke_04_20_650' });
		expect(m.entries[1]).toEqual({ mId: 0x17bed794c06d3000n, macWheelName: '10spoke_04_18_650' });
		expect(m.entries[171].macWheelName).toBe('8Spoke_02_20_650_test');
	});

	it('mId encodes the wheel CODE, not the wheel name', () => {
		// Names exceed CgsID's 12-char cap, so the id can't be a name hash.
		// The decoded code drops the "Spoke" text and per-group zero padding…
		expect(decodeCgsId(m.entries[0].mId)).toBe('5420650');
		// …but bike wheels prove the codes are authored, not derivable:
		// 0Bike_01_17_600GP8 → 08011773 breaks every simple stripping rule.
		const bike = m.entries.find((e) => e.macWheelName === '0Bike_01_17_600GP8');
		expect(bike).toBeDefined();
		expect(decodeCgsId(bike!.mId)).toBe('08011773');
	});

	it('ids and names are unique; names fit the char[64] field', () => {
		expect(new Set(m.entries.map((e) => e.mId)).size).toBe(172);
		expect(new Set(m.entries.map((e) => e.macWheelName)).size).toBe(172);
		const maxLen = Math.max(...m.entries.map((e) => e.macWheelName.length));
		expect(maxLen).toBe(21); // 8Spoke_02_20_650_test
		expect(maxLen).toBeLessThanOrEqual(MAX_WHEEL_NAME_CHARS);
	});

	it('decodeCgsId(mId) names the WHE_<code>_GR.BNDL graphics bundle and its WheelGraphicsSpec', () => {
		const entry = m.entries.find((e) => e.macWheelName === '0Spoke_02_18_650');
		expect(entry).toBeDefined();
		const code = decodeCgsId(entry!.mId);
		expect(code).toBe('00218650');
		const { bundle, debugResources } = loadBundle(`example/WHE_${code}_GR.BNDL`);
		const specNames = bundle.resources.map(
			(r) => findDebugResourceById(debugResources, r.resourceId.low.toString(16))?.name,
		);
		expect(specNames).toContain(`${code}_Graphics`);
	});
});

describe('WheelList round-trip', () => {
	const { raw } = loadWheelListRaw();

	it('round-trips byte-for-byte and the writer is idempotent', () => {
		const write1 = writeWheelList(parseWheelList(raw));
		expect(write1.byteLength).toBe(raw.byteLength);
		expect(bytesEqual(write1, raw)).toBe(true);
		const write2 = writeWheelList(parseWheelList(write1));
		expect(bytesEqual(write2, write1)).toBe(true);
	});

	it('count-changing edits survive a model round-trip', () => {
		const m = parseWheelList(raw);
		const grown = { ...m, entries: [...m.entries, { mId: 0x123n, macWheelName: 'New_Wheel' }] };
		const reparsed = parseWheelList(writeWheelList(grown));
		expect(reparsed.entries.length).toBe(173);
		expect(reparsed.entries[172]).toEqual({ mId: 0x123n, macWheelName: 'New_Wheel' });

		const shrunk = { ...m, entries: m.entries.slice(0, 5) };
		expect(parseWheelList(writeWheelList(shrunk)).entries.length).toBe(5);
	});

	it('writer rejects a name that overflows char[64]', () => {
		const m = parseWheelList(raw);
		const entries = m.entries.slice();
		entries[0] = { ...entries[0], macWheelName: 'x'.repeat(MAX_WHEEL_NAME_CHARS + 1) };
		expect(() => writeWheelList({ ...m, entries })).toThrow(/exceeds/);
	});

	it('parser rejects a corrupted entries pointer', () => {
		const corrupted = new Uint8Array(raw);
		corrupted[4] = 0x20; // mpEntries 0x10 → 0x20
		expect(() => parseWheelList(corrupted)).toThrow(/mpEntries/);
	});
});
