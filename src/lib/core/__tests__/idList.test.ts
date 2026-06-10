// Gold coverage for parseIdList / writeIdList.
//
// WORLDCOL.BIN carries 428 IdList resources but the auto-generated registry
// fixture suite only exercises the first one — so this suite sweeps ALL 428
// for byte-exact round-trip, pins the TRK_CLIL<N> ↔ TRK_COL_<N> pairing with
// the sibling PolygonSoupList resources, and pins the uninitialised-pad
// shapes (every resource has heap garbage at 0x8; TRK_CLIL99 also has
// garbage at 0xC and in its trailing pad).

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { parseIdList, writeIdList } from '../idList';
import { parseBundle } from '../bundle';
import { parseDebugDataFromXml, findDebugResourceById } from '../bundle/debugData';
import { extractResourceRaw } from '../registry';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const ID_LIST_TYPE_ID = 0x25;
const POLYGON_SOUP_LIST_TYPE_ID = 0x43;

// Parse the 14 MB bundle once for the whole suite.
const buf = fs.readFileSync(path.resolve(REPO_ROOT, 'example/WORLDCOL.BIN'));
const buffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
const bundle = parseBundle(buffer);
const debugResources = typeof bundle.debugData === 'string'
	? parseDebugDataFromXml(bundle.debugData)
	: [];
const idLists = bundle.resources.filter((r) => r.resourceTypeId === ID_LIST_TYPE_ID);
const soups = bundle.resources.filter((r) => r.resourceTypeId === POLYGON_SOUP_LIST_TYPE_ID);

function nameOf(resourceIdLow: number): string {
	return findDebugResourceById(debugResources, resourceIdLow.toString(16))?.name ?? '?';
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.byteLength !== b.byteLength) return false;
	for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
	return true;
}

describe('IdList gold values (example/WORLDCOL.BIN)', () => {
	it('carries 428 IdLists alongside 428 PolygonSoupLists', () => {
		expect(idLists.length).toBe(428);
		expect(soups.length).toBe(428);
	});

	it('decodes the first IdList in bundle order (TRK_CLIL109)', () => {
		const raw = extractResourceRaw(buffer, bundle, idLists[0]);
		expect(nameOf(idLists[0].resourceId.low)).toBe('TRK_CLIL109');
		expect(raw.byteLength).toBe(0x20);
		const m = parseIdList(raw);
		expect(m.ids).toEqual([0xac4a6438n]);
		// Heap garbage at 0x8 (a 0x04XX9680-style bundler pointer), zeros at 0xC.
		expect([...m._pad08]).toEqual([0x80, 0x96, 0x77, 0x04, 0, 0, 0, 0]);
		expect([...m._trailingPad]).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
	});

	it('every IdList holds exactly one id and it is a sibling PolygonSoupList', () => {
		const soupIdLows = new Set(soups.map((s) => s.resourceId.low >>> 0));
		const referenced = new Set<number>();
		for (const r of idLists) {
			const m = parseIdList(extractResourceRaw(buffer, bundle, r));
			expect(m.ids.length).toBe(1);
			// Resource ids fit 32 bits in vanilla — the u64 high half is 0.
			expect(m.ids[0] >> 32n).toBe(0n);
			const low = Number(m.ids[0] & 0xffffffffn) >>> 0;
			expect(soupIdLows.has(low), `id 0x${low.toString(16)} of ${nameOf(r.resourceId.low)}`).toBe(true);
			referenced.add(low);
		}
		// Perfect bijection: every soup is referenced by exactly one IdList.
		expect(referenced.size).toBe(soups.length);
	});

	it('pairs TRK_CLIL<N> with TRK_COL_<N> for every track unit', () => {
		const soupByLow = new Map(soups.map((s) => [s.resourceId.low >>> 0, s]));
		for (const r of idLists) {
			const name = nameOf(r.resourceId.low);
			const match = name.match(/^TRK_CLIL(\d+)$/);
			expect(match, name).not.toBeNull();
			const m = parseIdList(extractResourceRaw(buffer, bundle, r));
			const soup = soupByLow.get(Number(m.ids[0] & 0xffffffffn) >>> 0);
			expect(soup, name).toBeDefined();
			expect(nameOf(soup!.resourceId.low)).toBe(`TRK_COL_${match![1]}`);
		}
	});

	it('preserves TRK_CLIL99\'s uninitialised pads verbatim', () => {
		// The lone resource whose pads aren't (mostly) zero — both the second
		// header pad word and the tail carry bundler heap garbage.
		const r = idLists[53];
		expect(nameOf(r.resourceId.low)).toBe('TRK_CLIL99');
		const m = parseIdList(extractResourceRaw(buffer, bundle, r));
		expect(m.ids).toEqual([0x48f23a98n]);
		expect([...m._pad08]).toEqual([0x08, 0xe3, 0xde, 0x00, 0xfc, 0x9a, 0xde, 0x00]);
		expect([...m._trailingPad]).toEqual([0x8f, 0x8c, 0x1e, 0xc5, 0x00, 0x12, 0xe8, 0x74]);
	});

	it('declares no envelope import entries despite the wiki\'s Imports row', () => {
		for (const r of idLists) expect(r.importCount).toBe(0);
	});
});

describe('IdList round-trip', () => {
	it('round-trips all 428 resources byte-for-byte with an idempotent writer', () => {
		for (const r of idLists) {
			const raw = extractResourceRaw(buffer, bundle, r);
			const write1 = writeIdList(parseIdList(raw));
			expect(bytesEqual(write1, raw), nameOf(r.resourceId.low)).toBe(true);
			const write2 = writeIdList(parseIdList(write1));
			expect(bytesEqual(write2, write1), nameOf(r.resourceId.low)).toBe(true);
		}
	});

	it('count-changing edits survive a model round-trip', () => {
		const m = parseIdList(extractResourceRaw(buffer, bundle, idLists[0]));
		const grown = { ...m, ids: [...m.ids, 0xdeadbeefn] };
		const reparsed = parseIdList(writeIdList(grown));
		expect(reparsed.ids).toEqual([0xac4a6438n, 0xdeadbeefn]);

		const emptied = parseIdList(writeIdList({ ...m, ids: [] }));
		expect(emptied.ids).toEqual([]);
		// The verbatim pads ride along regardless of the id count.
		expect([...emptied._pad08]).toEqual([...m._pad08]);
		expect([...emptied._trailingPad]).toEqual([...m._trailingPad]);
	});

	it('parser rejects a corrupted ids pointer', () => {
		const raw = new Uint8Array(extractResourceRaw(buffer, bundle, idLists[0]));
		raw[0] = 0x20; // mpaIds 0x10 → 0x20
		expect(() => parseIdList(raw)).toThrow(/mpaIds/);
	});

	it('parser rejects an id count that overruns the resource', () => {
		const raw = new Uint8Array(extractResourceRaw(buffer, bundle, idLists[0]));
		raw[4] = 0xff; // muNumIds 1 → 255
		expect(() => parseIdList(raw)).toThrow(/overrun/);
	});
});
