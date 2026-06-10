// Gold coverage for parseTextureNameMap / writeTextureNameMap against
// example/PARTICLES.BUNDLE.
//
// Pins the hand-verified layout (entries at 0x10, strings packed in entry
// order into 16-byte-aligned slots) and the data finding the wiki leaves
// vague: each entry's hash is FNV-1a (lowercased) of the URI's BARE basename
// — "SparkBlast.TextureConfig2d?ID=245985" hashes as "sparkblast" — verified
// across all 50 retail entries.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
	parseTextureNameMap,
	writeTextureNameMap,
	lionFnv1a,
	lionTextureName,
	hashLionTextureName,
} from '../textureNameMap';
import { parseBundle } from '../bundle';
import { extractResourceRaw } from '../registry';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const FIXTURE = path.resolve(REPO_ROOT, 'example/PARTICLES.BUNDLE');
const TEXTURE_NAME_MAP_TYPE_ID = 0x1000b;

const fileBytes = fs.readFileSync(FIXTURE);
const buffer = fileBytes.buffer.slice(fileBytes.byteOffset, fileBytes.byteOffset + fileBytes.byteLength) as ArrayBuffer;
const bundle = parseBundle(buffer);
const mapEntries = bundle.resources.filter((r) => r.resourceTypeId === TEXTURE_NAME_MAP_TYPE_ID);
const raw = extractResourceRaw(buffer, bundle, mapEntries[0]);

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.byteLength !== b.byteLength) return false;
	for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
	return true;
}

describe('TextureNameMap gold values (example/PARTICLES.BUNDLE)', () => {
	it('the bundle carries exactly one map, with no imports', () => {
		expect(mapEntries.length).toBe(1);
		expect(mapEntries[0].importCount).toBe(0);
		expect(raw.byteLength).toBe(0x12e0);
	});

	it('decodes 50 entries with the hand-verified first/last values', () => {
		const m = parseTextureNameMap(raw);
		expect(m.entries.length).toBe(50);
		expect(m.entries[0]).toEqual({
			muHashedLionTextureName: 0x8e6892f8,
			mGDBTextureName: 'gamedb://burnout5/Burnout/Effects/Textures/SparkBlast.TextureConfig2d?ID=245985',
		});
		expect(m.entries[49]).toEqual({
			muHashedLionTextureName: 0x3c9c222a,
			mGDBTextureName: 'gamedb://burnout5/Burnout/Effects/Textures/bodobipbleu.TextureConfig2d?ID=216234',
		});
	});

	it('all 50 hashes are FNV-1a (lowercased) of the bare texture name, and unique', () => {
		const m = parseTextureNameMap(raw);
		const hashes = new Set<number>();
		for (const e of m.entries) {
			expect(e.muHashedLionTextureName, e.mGDBTextureName).toBe(hashLionTextureName(e.mGDBTextureName));
			hashes.add(e.muHashedLionTextureName);
		}
		expect(hashes.size).toBe(50);
	});

	it('lionTextureName strips path, extension, and query', () => {
		expect(lionTextureName('gamedb://burnout5/Burnout/Effects/Textures/SparkBlast.TextureConfig2d?ID=245985')).toBe('SparkBlast');
		// Hashing folds case; the extracted name keeps it.
		expect(lionFnv1a('SparkBlast')).toBe(lionFnv1a('sparkblast'));
		expect(lionFnv1a('SparkBlast')).toBe(0x8e6892f8);
	});

	it('every retail URI is a gamedb TextureConfig2d reference', () => {
		const m = parseTextureNameMap(raw);
		for (const e of m.entries) {
			expect(e.mGDBTextureName).toMatch(/^gamedb:\/\/burnout5\/.+\.TextureConfig2d\?ID=\d+$/);
		}
	});
});

describe('TextureNameMap round-trip', () => {
	it('round-trips byte-for-byte and the writer is idempotent', () => {
		const once = writeTextureNameMap(parseTextureNameMap(raw));
		expect(once.byteLength).toBe(raw.byteLength);
		expect(bytesEqual(once, raw)).toBe(true);
		const twice = writeTextureNameMap(parseTextureNameMap(once));
		expect(bytesEqual(twice, once)).toBe(true);
	});

	it('renaming entry 0 to a longer URI shifts every later slot and still reparses', () => {
		const m = parseTextureNameMap(raw);
		const uri = 'gamedb://burnout5/Burnout/Effects/Textures/a_much_longer_texture_name_than_the_original_sparkblast_entry.TextureConfig2d?ID=1';
		const entries = m.entries.slice();
		entries[0] = { mGDBTextureName: uri, muHashedLionTextureName: hashLionTextureName(uri) };
		const reparsed = parseTextureNameMap(writeTextureNameMap({ ...m, entries }));
		expect(reparsed.entries[0].mGDBTextureName).toBe(uri);
		expect(reparsed.entries.slice(1)).toEqual(m.entries.slice(1));
	});

	it('append + remove keep the slot packing consistent (odd counts exercise the align-up)', () => {
		const m = parseTextureNameMap(raw);
		const added = { mGDBTextureName: 'gamedb://burnout5/x.TextureConfig2d?ID=1', muHashedLionTextureName: hashLionTextureName('x') };
		// 51 entries → the entry table ends 8 bytes off a 16-byte boundary, so
		// the writer's align-up before the first string takes effect.
		const reparsedAdd = parseTextureNameMap(writeTextureNameMap({ ...m, entries: [...m.entries, added] }));
		expect(reparsedAdd.entries.length).toBe(51);
		expect(reparsedAdd.entries[50]).toEqual(added);

		const reparsedRemove = parseTextureNameMap(writeTextureNameMap({ ...m, entries: m.entries.slice(0, -1) }));
		expect(reparsedRemove.entries.length).toBe(49);
		expect(reparsedRemove.entries).toEqual(m.entries.slice(0, -1));
	});

	it('an empty map writes the bare 0x10-byte header and reparses', () => {
		const empty = writeTextureNameMap({ entries: [] });
		expect(empty.byteLength).toBe(0x10);
		expect(parseTextureNameMap(empty).entries).toEqual([]);
	});

	it('parser rejects a corrupted mpEntries pointer', () => {
		const bad = new Uint8Array(raw);
		bad[0] = 0x20;
		expect(() => parseTextureNameMap(bad)).toThrow(/mpEntries/);
	});

	it('parser rejects a string offset that breaks the packed layout', () => {
		const bad = new Uint8Array(raw);
		bad[0x14] = 0xb0; // entry 0 string offset 0x1a0 → 0x1b0
		expect(() => parseTextureNameMap(bad)).toThrow(/packed offset/);
	});
});
