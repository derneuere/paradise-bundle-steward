// Gold coverage for parseLanguage / writeLanguage.
//
// The handler declares three fixtures; this suite sweeps ALL 14 retail
// language bundles, pins hand-verified decoded values, and pins the data
// findings the wiki doesn't document: per-string zero pads, the trailing
// all-'A' filler entry sizing every resource to 0xD4800, and the bundle 0008
// Greek-id/Russian-content divergence.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { parseLanguage, writeLanguage, languageName } from '../language';
import { parseBundle } from '../bundle';
import { extractResourceRaw } from '../registry';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const LANGUAGE_TYPE_ID = 0x27;

function loadLanguageRaws(bundleFile: string): Uint8Array[] {
	const buf = fs.readFileSync(path.resolve(REPO_ROOT, bundleFile));
	const buffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
	const bundle = parseBundle(buffer);
	return bundle.resources
		.filter((r) => r.resourceTypeId === LANGUAGE_TYPE_ID)
		.map((r) => extractResourceRaw(buffer, bundle, r));
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.byteLength !== b.byteLength) return false;
	for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
	return true;
}

// Hand-verified sweep pins: langId / entry count / count of entries carrying
// the undocumented 3-zero-byte pad / decompressed resource size. 0001 and
// 0006 were rebuilt later (newer file dates, zero pads, edited test strings)
// and overshoot the otherwise-universal 0xD4800 size by 3 and 5 bytes.
const SWEEP: Record<string, { langId: number; entries: number; padEntries: number; size: number }> = {
	'0001': { langId: 7, entries: 7587, padEntries: 0, size: 870403 },
	'0002': { langId: 8, entries: 7585, padEntries: 40, size: 870400 },
	'0003': { langId: 10, entries: 7585, padEntries: 40, size: 870400 },
	'0004': { langId: 22, entries: 7612, padEntries: 40, size: 870400 },
	'0005': { langId: 15, entries: 7584, padEntries: 40, size: 870400 },
	'0006': { langId: 11, entries: 7587, padEntries: 0, size: 870405 },
	'0007': { langId: 16, entries: 8291, padEntries: 40, size: 870400 },
	'0008': { langId: 12, entries: 7599, padEntries: 42, size: 870400 },
	'0009': { langId: 19, entries: 7609, padEntries: 42, size: 870400 },
	'0010': { langId: 4, entries: 7605, padEntries: 3, size: 870400 },
	'0011': { langId: 14, entries: 7597, padEntries: 4, size: 870400 },
	'0012': { langId: 2, entries: 7598, padEntries: 2, size: 870400 },
	'0013': { langId: 3, entries: 7593, padEntries: 2, size: 870400 },
	'0014': { langId: 24, entries: 7611, padEntries: 2, size: 870400 },
};

describe('Language gold values (example/LANGUAGE/0002.BUNDLE — retail English UK)', () => {
	const raw = loadLanguageRaws('example/LANGUAGE/0002.BUNDLE')[0];
	const m = parseLanguage(raw);

	it('decodes the header', () => {
		expect(m.meLanguageID).toBe(8);
		expect(languageName(m.meLanguageID)).toBe('English (UK)');
		expect(m.entries.length).toBe(7585);
	});

	it('pins hand-verified entries', () => {
		expect(m.entries[0]).toEqual({ muHash: 0x7e1c1cc8, text: 'No motion blur.', _padAfter: 0 });
		expect(m.entries[1]).toEqual({ muHash: 0x38442737, text: 'L', _padAfter: 0 });
		expect(m.entries[2]).toEqual({ muHash: 0x3dc635cf, text: 'CAMERA RIGHT', _padAfter: 0 });
		expect(m.entries[7583]).toEqual({ muHash: 0xf12fd364, text: 'Maguire (south by lighthouse)', _padAfter: 0 });
	});

	it('pins the first padded entry (3 zero bytes after the terminator)', () => {
		expect(m.entries[780]._padAfter).toBe(3);
		// Pads are exactly 0 or 3 in retail — never any other width.
		const widths = new Set(m.entries.map((e) => e._padAfter));
		expect([...widths].sort()).toEqual([0, 3]);
	});

	it('ends with the all-A filler entry sizing the resource to 0xD4800', () => {
		const filler = m.entries[m.entries.length - 1];
		expect(filler.muHash).toBe(0);
		expect(filler.text).toMatch(/^A+$/);
		expect(raw.byteLength).toBe(0xd4800);
	});
});

describe('Language gold values (example/LANGUAGE/0008.BUNDLE — wiki divergence)', () => {
	const m = parseLanguage(loadLanguageRaws('example/LANGUAGE/0008.BUNDLE')[0]);

	it('stores meLanguageID 12 (E_LANGUAGE_GREEK on the wiki) but contains Russian', () => {
		expect(m.meLanguageID).toBe(12);
		expect(m.entries[0].text).toBe('Откл. эффект размытия.');
	});
});

describe('Language gold values (example/LANGUAGE/0007.BUNDLE — Japanese multibyte)', () => {
	const m = parseLanguage(loadLanguageRaws('example/LANGUAGE/0007.BUNDLE')[0]);

	it('decodes multibyte UTF-8 and re-encodes it byte-exact', () => {
		expect(m.meLanguageID).toBe(16);
		expect(m.entries[0].text).toBe('モーションブラーがかかりません。');
	});
});

describe('Language 14-bundle sweep', () => {
	for (const [num, exp] of Object.entries(SWEEP)) {
		const bundleFile = `example/LANGUAGE/${num}.BUNDLE`;

		it(`${bundleFile}: pins, invariants, byte-exact round-trip, idempotence`, () => {
			const raws = loadLanguageRaws(bundleFile);
			// One Language resource per bundle — pinned so a multi-resource
			// bundle would force this suite to widen its coverage.
			expect(raws.length).toBe(1);
			const raw = raws[0];
			expect(raw.byteLength).toBe(exp.size);

			const m = parseLanguage(raw);
			expect(m.meLanguageID).toBe(exp.langId);
			expect(m.entries.length).toBe(exp.entries);
			expect(m.entries.filter((e) => e._padAfter > 0).length).toBe(exp.padEntries);

			// "No motion blur" is entry 0 in every retail bundle — the hash is
			// the cross-language key, so it matches across all 14.
			expect(m.entries[0].muHash).toBe(0x7e1c1cc8);

			// Hashes are unique; 0 appears exactly once, on the trailing filler.
			const hashes = new Set(m.entries.map((e) => e.muHash));
			expect(hashes.size).toBe(m.entries.length);
			const filler = m.entries[m.entries.length - 1];
			expect(filler.muHash).toBe(0);
			expect(filler.text).toMatch(/^A+$/);

			const written = writeLanguage(m);
			expect(written.byteLength).toBe(raw.byteLength);
			expect(bytesEqual(written, raw)).toBe(true);

			const rewritten = writeLanguage(parseLanguage(written));
			expect(bytesEqual(rewritten, written)).toBe(true);
		});
	}
});

describe('Language parser/writer guards', () => {
	const raw = loadLanguageRaws('example/LANGUAGE/0002.BUNDLE')[0];
	// extractResourceRaw can hand back a Node Buffer, whose .slice() is a VIEW —
	// copy explicitly so mutations can't leak into the shared fixture bytes.
	const copyOf = (bytes: Uint8Array) => new Uint8Array(bytes);

	it('parser rejects a non-0xC mpEntries', () => {
		const broken = copyOf(raw);
		new DataView(broken.buffer).setUint32(8, 0x10, true);
		expect(() => parseLanguage(broken)).toThrow(/mpEntries/);
	});

	it('parser rejects a truncated resource', () => {
		expect(() => parseLanguage(copyOf(raw).subarray(0, 8))).toThrow(/smaller than/);
	});

	it('parser rejects an entry count overrunning the resource', () => {
		const broken = copyOf(raw).subarray(0, 0x100);
		expect(() => parseLanguage(broken)).toThrow(/overrun|contiguous|terminator/);
	});

	it('parser rejects non-zero bytes hiding in a pad', () => {
		const broken = copyOf(raw);
		const m = parseLanguage(raw);
		// entries[780] carries a 3-byte pad; find its blob position and poison it.
		const blobStart = 0xc + m.entries.length * 8;
		let off = blobStart;
		const encoder = new TextEncoder();
		for (let i = 0; i <= 780; i++) off += encoder.encode(m.entries[i].text).length + 1 + m.entries[i]._padAfter;
		broken[off - 1] = 0x41; // last pad byte of entries[780]
		expect(() => parseLanguage(broken)).toThrow(/pad after entry 780/);
	});

	it('writer rejects text with an embedded NUL', () => {
		const m = parseLanguage(raw);
		const entries = m.entries.slice();
		entries[0] = { ...entries[0], text: 'bad\0string' };
		expect(() => writeLanguage({ ...m, entries })).toThrow(/embedded NUL/);
	});

	it('writer rejects a negative _padAfter', () => {
		const m = parseLanguage(raw);
		const entries = m.entries.slice();
		entries[0] = { ...entries[0], _padAfter: -1 };
		expect(() => writeLanguage({ ...m, entries })).toThrow(/_padAfter/);
	});
});
