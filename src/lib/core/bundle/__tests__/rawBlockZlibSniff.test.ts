// A raw (stored-uncompressed) resource block may begin with a coincidental
// zlib magic — 0x78 0x01 is also the little-endian u32 0x178, a perfectly
// plausible struct offset. The envelope's disk-vs-uncompressed size pair is
// the authoritative compression signal: equal sizes mean stored raw, and the
// bytes must never be inflated no matter what they start with.
//
// Retail TRK_UNIT192_GR.BNDL is the live case: its PropGraphicsList (0x10010)
// payload starts 0x78 0x01 and used to abort the whole bundle parse with
// "invalid stored block lengths" from zlib.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as pako from 'pako';

import { parseBundle } from '..';
import {
	parseImportEntries,
	createEmptyResourceEntry,
	getResourceImportSlice,
} from '../bundleEntry';
import {
	isResourceBlockCompressed,
	packSizeAndAlignment,
} from '../../resourceManager';
import { extractResourceRaw } from '../../registry';

const REPO_ROOT = path.resolve(__dirname, '../../../../..');
const FIXTURE = path.resolve(REPO_ROOT, 'example/TRK_UNIT192_GR.BNDL');
const PROP_GRAPHICS_LIST_TYPE_ID = 0x10010;

describe('isResourceBlockCompressed', () => {
	const zlibLooking = new Uint8Array([0x78, 0x01, 0x00, 0x00, 0xc0, 0x00]);

	it('treats equal disk/uncompressed sizes as raw even when bytes sniff as zlib', () => {
		const entry = createEmptyResourceEntry();
		entry.sizeAndAlignmentOnDisk[0] = packSizeAndAlignment(zlibLooking.length, 1);
		entry.uncompressedSizeAndAlignment[0] = packSizeAndAlignment(zlibLooking.length, 1);
		expect(isResourceBlockCompressed(entry, 0, zlibLooking)).toBe(false);
	});

	it('treats differing sizes with a zlib magic as compressed', () => {
		const raw = new Uint8Array(64).fill(7);
		const compressed = pako.deflate(raw);
		const entry = createEmptyResourceEntry();
		entry.sizeAndAlignmentOnDisk[0] = packSizeAndAlignment(compressed.length, 1);
		entry.uncompressedSizeAndAlignment[0] = packSizeAndAlignment(raw.length, 16);
		expect(isResourceBlockCompressed(entry, 0, compressed)).toBe(true);
	});

	it('does not trust differing sizes alone when the bytes are not zlib', () => {
		const bytes = new Uint8Array([0x12, 0x34, 0x56, 0x78]);
		const entry = createEmptyResourceEntry();
		entry.sizeAndAlignmentOnDisk[0] = packSizeAndAlignment(bytes.length, 1);
		entry.uncompressedSizeAndAlignment[0] = packSizeAndAlignment(128, 16);
		expect(isResourceBlockCompressed(entry, 0, bytes)).toBe(false);
	});
});

describe('parseImportEntries on a raw block with a coincidental zlib magic', () => {
	// 0x30-byte raw payload: leading "0x78 0x01" struct data, import table at
	// 0x20 with one entry { id 0xAABBCCDD00112233, ptrOffset 0x10 }.
	function makePayload(): Uint8Array {
		const payload = new Uint8Array(0x30);
		const dv = new DataView(payload.buffer);
		dv.setUint32(0x00, 0x178, true);
		dv.setUint32(0x20, 0x00112233, true);
		dv.setUint32(0x24, 0xaabbccdd, true);
		dv.setUint32(0x28, 0x10, true);
		return payload;
	}

	function makeEntry(diskSize: number, uncompSize: number) {
		const entry = createEmptyResourceEntry();
		entry.sizeAndAlignmentOnDisk[0] = packSizeAndAlignment(diskSize, 1);
		entry.uncompressedSizeAndAlignment[0] = packSizeAndAlignment(uncompSize, 16);
		entry.importOffset = 0x20;
		entry.importCount = 1;
		return entry;
	}

	it('reads the import table from the raw bytes without inflating', () => {
		const payload = makePayload();
		const entry = makeEntry(payload.length, payload.length);
		const imports = parseImportEntries(
			payload.buffer,
			[entry],
			{ resourceDataOffsets: [0, 0, 0] },
		);
		expect(imports).toEqual([
			{ resourceId: { low: 0x00112233, high: 0xaabbccdd }, offset: 0x10, padding: 0 },
		]);
	});

	it('still inflates a genuinely compressed block before reading its table', () => {
		const payload = makePayload();
		const compressed = pako.deflate(payload);
		const entry = makeEntry(compressed.length, payload.length);
		const compressedBuffer = compressed.buffer.slice(
			compressed.byteOffset,
			compressed.byteOffset + compressed.byteLength,
		) as ArrayBuffer;
		const imports = parseImportEntries(
			compressedBuffer,
			[entry],
			{ resourceDataOffsets: [0, 0, 0] },
		);
		expect(imports).toEqual([
			{ resourceId: { low: 0x00112233, high: 0xaabbccdd }, offset: 0x10, padding: 0 },
		]);
	});
});

describe.skipIf(!fs.existsSync(FIXTURE))('TRK_UNIT192_GR.BNDL (raw PropGraphicsList starting 0x78 0x01)', () => {
	const buf = fs.existsSync(FIXTURE) ? fs.readFileSync(FIXTURE) : Buffer.alloc(0);
	const buffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;

	it('parses the whole bundle', () => {
		const bundle = parseBundle(buffer);
		expect(bundle.resources.length).toBe(346);
	});

	it('extracts the PropGraphicsList raw, un-inflated, with its import table intact', () => {
		const bundle = parseBundle(buffer);
		const index = bundle.resources.findIndex((r) => r.resourceTypeId === PROP_GRAPHICS_LIST_TYPE_ID);
		expect(index).toBeGreaterThanOrEqual(0);
		const resource = bundle.resources[index];

		const raw = extractResourceRaw(buffer, bundle, resource);
		expect(raw.byteLength).toBe(832);
		expect([raw[0], raw[1]]).toEqual([0x78, 0x01]);

		// 28 imports at payload-relative 0x180 — exactly the raw payload tail.
		const slice = getResourceImportSlice(bundle.imports, bundle.resources, index);
		expect(slice?.length).toBe(28);
		expect(resource.importOffset + resource.importCount * 16).toBe(raw.byteLength);
	});
});
