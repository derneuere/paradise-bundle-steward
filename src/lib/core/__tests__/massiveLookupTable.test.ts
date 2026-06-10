// Gold coverage for parseMassiveLookupTable / writeMassiveLookupTable.
//
// One retail resource exists (example/MASSIVETABLE.BIN → MassiveTable): the
// 20 ad placements of the Massive Incorporated in-game ad service. Values
// pinned here were hand-decoded from the raw bytes before the parser existed.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
	parseMassiveLookupTable,
	writeMassiveLookupTable,
	makeEmptyMassiveItem,
} from '../massiveLookupTable';
import { parseBundle } from '../bundle';
import { extractResourceRaw } from '../registry';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const MASSIVE_LOOKUP_TABLE_TYPE_ID = 0x1001a;

function loadRaw(): Uint8Array {
	const buf = fs.readFileSync(path.resolve(REPO_ROOT, 'example/MASSIVETABLE.BIN'));
	const buffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
	const bundle = parseBundle(buffer);
	const resources = bundle.resources.filter((r) => r.resourceTypeId === MASSIVE_LOOKUP_TABLE_TYPE_ID);
	expect(resources.length).toBe(1);
	return extractResourceRaw(buffer, bundle, resources[0]);
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.byteLength !== b.byteLength) return false;
	for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
	return true;
}

const raw = loadRaw();

describe('MassiveLookupTable gold values (example/MASSIVETABLE.BIN)', () => {
	const m = parseMassiveLookupTable(raw);

	it('decompresses to 0x510 bytes and decodes 20 ad placements', () => {
		expect(raw.byteLength).toBe(0x510);
		expect(m.items.length).toBe(20);
	});

	it('decodes item 0 — flat billboard quad in scene 0x891F7C15', () => {
		const item = m.items[0];
		expect(item.mBoundingBoxMin.x).toBeCloseTo(-8.006, 3);
		expect(item.mBoundingBoxMin.y).toBe(0);
		expect(item.mBoundingBoxMin.z).toBe(0);
		expect(item.mBoundingBoxMax.x).toBeCloseTo(8.003, 3);
		expect(item.mBoundingBoxMax.y).toBeCloseTo(7.9944, 3);
		expect(item.mBoundingBoxMax.z).toBe(0);
		expect(item.mSceneId).toBe(0x891f7c15n);
		expect(item.miIEIndex).toBe(2);
		expect(item.muRenderableIndex).toBe(0);
	});

	it('decodes item 19 — the one non-flat box, scene 0x670B0927', () => {
		const item = m.items[19];
		expect(item.mBoundingBoxMin.x).toBeCloseTo(-15.566, 3);
		expect(item.mBoundingBoxMin.y).toBeCloseTo(-3.2386, 3);
		expect(item.mBoundingBoxMin.z).toBeCloseTo(-0.0145, 3);
		expect(item.mBoundingBoxMax.x).toBeCloseTo(15.863, 3);
		expect(item.mSceneId).toBe(0x670b0927n);
		expect(item.miIEIndex).toBe(-1);
		expect(item.muRenderableIndex).toBe(19);
	});

	it('renderable indexes run 0..19 in disk order', () => {
		expect(m.items.map((i) => i.muRenderableIndex)).toEqual(
			Array.from({ length: 20 }, (_, i) => i),
		);
	});

	it('IE indexes: items 0-9 carry slots 0..8 (item 4 skipped), 10-19 are -1', () => {
		expect(m.items.map((i) => i.miIEIndex)).toEqual([
			2, 0, 1, 3, -1, 4, 5, 6, 7, 8,
			-1, -1, -1, -1, -1, -1, -1, -1, -1, -1,
		]);
	});

	it('runtime/unused lanes are zero in retail', () => {
		expect(Array.from(m._pad08)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
		for (const item of m.items) {
			expect(item._minW).toBe(0);
			expect(item._maxW).toBe(0);
			expect(item._mpSubscriber).toBe(0);
			expect(item._pad31.every((b) => b === 0)).toBe(true);
		}
	});
});

describe('MassiveLookupTable round-trip', () => {
	it('round-trips byte-for-byte and the writer is idempotent', () => {
		const first = writeMassiveLookupTable(parseMassiveLookupTable(raw));
		expect(bytesEqual(first, raw)).toBe(true);
		const second = writeMassiveLookupTable(parseMassiveLookupTable(first));
		expect(bytesEqual(second, first)).toBe(true);
	});

	it('appending an item survives a model round-trip with counts re-derived', () => {
		const m = parseMassiveLookupTable(raw);
		const added = { ...makeEmptyMassiveItem(), mSceneId: 0xdeadbeefn, miIEIndex: 9 };
		const reparsed = parseMassiveLookupTable(
			writeMassiveLookupTable({ ...m, items: [...m.items, added] }),
		);
		expect(reparsed.items.length).toBe(21);
		expect(reparsed.items[20].mSceneId).toBe(0xdeadbeefn);
		expect(reparsed.items[20].miIEIndex).toBe(9);
	});

	it('parser rejects a truncated resource (items must tile exactly)', () => {
		expect(() => parseMassiveLookupTable(raw.slice(0, raw.byteLength - 0x10))).toThrow(/resource is/);
	});

	it('parser rejects a relocated item array', () => {
		const broken = new Uint8Array(raw);
		broken[4] = 0x20; // mpItems 0x10 → 0x20
		expect(() => parseMassiveLookupTable(broken)).toThrow(/mpItems/);
	});

	it('writer rejects malformed verbatim pads', () => {
		const m = parseMassiveLookupTable(raw);
		expect(() => writeMassiveLookupTable({ ...m, _pad08: new Uint8Array(4) })).toThrow(/_pad08/);
		const badItem = { ...m.items[0], _pad31: new Uint8Array(3) };
		expect(() => writeMassiveLookupTable({ ...m, items: [badItem, ...m.items.slice(1)] })).toThrow(/_pad31/);
	});
});
