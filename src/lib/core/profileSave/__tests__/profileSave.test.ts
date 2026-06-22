import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import {
	parseProfileSave, writeProfileSave, decodeChunk, getChunk,
	editChunkField, editChunkBit, editHeaderString, editHeaderGuid,
	VARIANTS, variantById,
} from '../index';
import { validateStruct } from '../struct';
import { PROGRESSION_REGISTRY } from '../progression';
import { mc02Checksum } from '../crc32mc02';
import { parseHeader, writeFile } from '../header';

const FIXTURE = path.resolve(__dirname, '../../../../../example/SAVE/Profile.BurnoutParadiseSave');
const hasFixture = fs.existsSync(FIXTURE);

const bytesEqual = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);
const firstDiff = (a: Uint8Array, b: Uint8Array) => {
	for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return i;
	return a.length === b.length ? -1 : Math.min(a.length, b.length);
};

// ---------------------------------------------------------------------------
// Container variant tables — every variant must tile its body with no gaps or
// overlaps. A typo'd offset/size in variants.ts corrupts a save, so gate it.
// ---------------------------------------------------------------------------

describe('container variant tables', () => {
	for (const v of VARIANTS) {
		it(`${v.id} chunks tile [0, 0x${v.bodyLength.toString(16)}) exactly`, () => {
			let cursor = 0;
			for (const c of v.chunks) {
				expect(c.offset, `${v.id}/${c.key} starts at the running cursor`).toBe(cursor);
				cursor += c.size;
			}
			expect(cursor, `${v.id} chunks sum to bodyLength`).toBe(v.bodyLength);
		});
	}
});

// ---------------------------------------------------------------------------
// Struct layout sanity — modelled fields must fit inside their struct.
// ---------------------------------------------------------------------------

describe('progression struct layout', () => {
	it('every struct passes layout validation', () => {
		for (const name of Object.keys(PROGRESSION_REGISTRY)) {
			expect(validateStruct(PROGRESSION_REGISTRY[name], PROGRESSION_REGISTRY)).toEqual([]);
		}
	});
});

// ---------------------------------------------------------------------------
// MC02 checksum — deterministic, and a self-built MC02 file round-trips
// byte-exact (the write path recomputes the three checksums).
// ---------------------------------------------------------------------------

describe('MC02 header', () => {
	it('checksum is deterministic and returns 0 for <4 bytes', () => {
		const buf = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
		expect(mc02Checksum(buf)).toBe(mc02Checksum(buf));
		expect(mc02Checksum(new Uint8Array([1, 2, 3]))).toBe(0);
	});

	it('round-trips a synthetic X360 (MC02) profile byte-exact', () => {
		const x360 = variantById('xbox360');
		const body = new Uint8Array(x360.bodyLength);
		for (let i = 0; i < body.length; i++) body[i] = (i * 7) & 0xff;

		// Build a correct MC02 file (big-endian header) with valid checksums.
		const file = new Uint8Array(0x1c + body.length);
		const dv = new DataView(file.buffer);
		file.set([0x4d, 0x43, 0x30, 0x32], 0); // "MC02"
		dv.setUint32(0x4, file.length, false); // mFileSize
		dv.setUint32(0x8, 0, false); // mUserHeaderSize
		dv.setUint32(0xc, body.length, false); // mUserBodySize
		file.set(body, 0x1c);
		dv.setUint32(0x10, mc02Checksum(file.subarray(0x1c, 0x1c)), false);
		dv.setUint32(0x14, mc02Checksum(body), false);
		dv.setUint32(0x18, mc02Checksum(file.subarray(0, 0x18)), false);

		const save = parseProfileSave(file);
		expect(save.variant.id).toBe('xbox360');
		expect(bytesEqual(writeProfileSave(save), file)).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Headerless + RGMH header round-trips on synthetic bodies.
// ---------------------------------------------------------------------------

describe('headerless (PS3) container', () => {
	it('round-trips a synthetic PS3 body byte-exact', () => {
		const ps3 = variantById('ps3');
		const body = new Uint8Array(ps3.bodyLength);
		for (let i = 0; i < body.length; i++) body[i] = (i * 13) & 0xff;
		const save = parseProfileSave(body);
		expect(save.variant.id).toBe('ps3');
		expect(bytesEqual(writeProfileSave(save), body)).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Real fixture (PC Remastered). Skipped when the personal save isn't present.
// ---------------------------------------------------------------------------

describe.skipIf(!hasFixture)('real PC Remastered profile', () => {
	const load = () => parseProfileSave(fs.readFileSync(FIXTURE));

	it('detects the PC Remastered variant via RGMH + body length', () => {
		const save = load();
		expect(save.variant.id).toBe('pc-remastered');
		expect(save.header.kind).toBe('rgmh');
	});

	it('round-trips byte-exact with no edits', () => {
		const original = new Uint8Array(fs.readFileSync(FIXTURE));
		const out = writeProfileSave(parseProfileSave(original));
		expect(out.length).toBe(original.length);
		expect(firstDiff(out, original)).toBe(-1);
	});

	it('writer is idempotent', () => {
		const original = new Uint8Array(fs.readFileSync(FIXTURE));
		const once = writeProfileSave(parseProfileSave(original));
		const twice = writeProfileSave(parseProfileSave(once));
		expect(bytesEqual(once, twice)).toBe(true);
	});

	it('decodes plausible Progression values (validates the layout)', () => {
		const save = load();
		const prog = getChunk(save, 'progression')!;
		const d = decodeChunk(save, prog) as Record<string, unknown>;
		expect(d.miVersionNumber).toBe(31);
		expect(d.mi8CurrentProgressionRank).toBe(5); // Burnout License
		// Counts must be within their fixed array capacities.
		expect(d.miCarCount).toBeGreaterThan(0);
		expect(d.miCarCount as number).toBeLessThanOrEqual(512);
		expect(d.miEventCount as number).toBeLessThanOrEqual(175);
		expect(d.miRivalCount as number).toBeLessThanOrEqual(64);
		// The first car entry should have a non-zero vehicle ID.
		const cars = d.maCars as Array<Record<string, unknown>>;
		expect(typeof cars[0].mId).toBe('bigint');
		expect(cars[0].mId).not.toBe(0n);
	});

	it('field edit round-trips and touches only that field', () => {
		const save = load();
		const prog = getChunk(save, 'progression')!;
		const before = prog.raw.slice();
		editChunkField(save, prog, ['mi8CurrentProgressionRank'], 6); // -> Elite
		// exactly one byte changed (the rank int8 at 0x70)
		let changed = 0, at = -1;
		for (let i = 0; i < before.length; i++) if (before[i] !== prog.raw[i]) { changed++; at = i; }
		expect(changed).toBe(1);
		expect(at).toBe(0x70);
		const reparsed = parseProfileSave(writeProfileSave(save));
		const d = decodeChunk(reparsed, getChunk(reparsed, 'progression')!) as Record<string, unknown>;
		expect(d.mi8CurrentProgressionRank).toBe(6);
	});

	it('nested array field edit round-trips', () => {
		const save = load();
		const prog = getChunk(save, 'progression')!;
		editChunkField(save, prog, ['maCars', 0, 'mu8ColourIndex'], 7);
		editChunkField(save, prog, ['maRivals', 1, 'meState'], 3);
		const reparsed = parseProfileSave(writeProfileSave(save));
		const d = decodeChunk(reparsed, getChunk(reparsed, 'progression')!) as Record<string, unknown>;
		expect((d.maCars as Array<Record<string, unknown>>)[0].mu8ColourIndex).toBe(7);
		expect((d.maRivals as Array<Record<string, unknown>>)[1].meState).toBe(3);
	});

	it('bitset bit edit flips exactly one bit', () => {
		const save = load();
		const prog = getChunk(save, 'progression')!;
		const before = decodeChunk(save, prog) as Record<string, unknown>;
		const seen0 = (before.maHasPlayerSeenTraining as number[]).includes(0);
		editChunkBit(save, prog, ['maHasPlayerSeenTraining'], 0, !seen0);
		const reparsed = parseProfileSave(writeProfileSave(save));
		const after = decodeChunk(reparsed, getChunk(reparsed, 'progression')!) as Record<string, unknown>;
		expect((after.maHasPlayerSeenTraining as number[]).includes(0)).toBe(!seen0);
	});

	it('RGMH header string + GUID edits round-trip', () => {
		const save = load();
		editHeaderString(save, 'comments', 'edited by steward');
		editHeaderGuid(save, '{6D5AE2FB-F7AC-45EA-982C-8422649DB55E}');
		const reparsed = parseProfileSave(writeProfileSave(save));
		expect(reparsed.header.kind).toBe('rgmh');
		if (reparsed.header.kind === 'rgmh') {
			expect(reparsed.header.comments).toBe('edited by steward');
			expect(reparsed.header.guid).toBe('{6D5AE2FB-F7AC-45EA-982C-8422649DB55E}');
		}
	});

	it('header parse start matches the documented 0x1D246 profile offset', () => {
		const { bodyStart } = parseHeader(new Uint8Array(fs.readFileSync(FIXTURE)));
		expect(bodyStart).toBe(0x1d246);
	});
});

describe('writeFile passthrough', () => {
	it('headerless writeFile returns a copy of the body', () => {
		const body = new Uint8Array([9, 8, 7, 6]);
		const out = writeFile({ kind: 'none' }, body);
		expect(bytesEqual(out, body)).toBe(true);
		expect(out).not.toBe(body);
	});
});
