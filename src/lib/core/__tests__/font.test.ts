// Gold coverage for parseFont / writeFont (resource type 0x21).
//
// The handler declares three fixtures; this suite sweeps ALL 26 retail .FONT
// bundles in example/FONTS/ for byte-exact round-trip + writer idempotence,
// pins hand-verified decoded values, and pins the data findings the wiki does
// not document: the on-disk element order, the derivable hash table, the
// universal 3-space non-renderable set, and the 2-page fonts whose second
// atlas page imports a Texture from ANOTHER bundle while its pointer slot
// carries build-time garbage.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { parseFont, writeFont, computeHashOffsets, FONT_TYPE_ID } from '../font';
import { parseBundle } from '../bundle';
import { extractResourceRaw } from '../registry';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const FONTS_DIR = path.resolve(REPO_ROOT, 'example/FONTS');
const TEXTURE_TYPE_ID = 0x0;

type ExtractedFont = {
	raw: Uint8Array;
	/** The bundled atlas Texture's resource id (every .FONT carries exactly one). */
	textureId: bigint;
	importCount: number;
};

function loadFont(fontFile: string): ExtractedFont {
	const buf = fs.readFileSync(path.resolve(FONTS_DIR, fontFile));
	const buffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
	const bundle = parseBundle(buffer);
	const fontRes = bundle.resources.filter((r) => r.resourceTypeId === FONT_TYPE_ID);
	const texRes = bundle.resources.filter((r) => r.resourceTypeId === TEXTURE_TYPE_ID);
	expect(fontRes.length, fontFile).toBe(1);
	expect(texRes.length, fontFile).toBe(1);
	return {
		raw: extractResourceRaw(buffer, bundle, fontRes[0]),
		textureId: (BigInt(texRes[0].resourceId.high) << 32n) | BigInt(texRes[0].resourceId.low),
		importCount: fontRes[0].importCount,
	};
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.byteLength !== b.byteLength) return false;
	for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
	return true;
}

const ALL_FONTS = fs.readdirSync(FONTS_DIR).filter((f) => f.endsWith('.FONT')).sort();

describe('Font gold values (example/FONTS/CHINESE_SIMPLIFIED.FONT)', () => {
	const { raw, textureId } = loadFont('CHINESE_SIMPLIFIED.FONT');
	const m = parseFont(raw);

	it('decodes the hand-verified header', () => {
		expect(m.muVersionId).toBe(10);
		expect(m.mScaleUV.x).toBeCloseTo(25.6, 4);
		expect(m.mScaleUV.y).toBeCloseTo(51.2, 4);
		// scaleUV * fontHeight = 2048 x 4096 — the atlas pixel dimensions.
		expect(m.muFontHeightInPixels).toBe(80);
		expect(m.mfLowerCaseScale).toBe(0);
		expect(m.mfBaseLine).toBeCloseTo(0.76992, 4);
		expect(m.mfXHeight).toBeCloseTo(0.75742, 4);
		expect(m.macTypefaceFamilyName).toBe('B5HelveticaBold');
		expect(m.macTypefaceStyleName).toBe('B5EAConDisS');
		expect(m.chars.length).toBe(1633);
	});

	it('decodes hand-verified glyphs', () => {
		// chars[0] is U+3000 ideographic space — non-renderable, UV sentinel.
		expect(m.chars[0].charId).toBe(0x3000);
		expect(m.chars[0].mbIsRenderable).toBe(false);
		expect(m.chars[0].mTopLeftUV).toEqual({ x: -1, y: -1 });
		// chars[1] is U+4E00 一 — a real glyph on page 0.
		expect(m.chars[1].charId).toBe(0x4e00);
		expect(String.fromCharCode(m.chars[1].charId)).toBe('一');
		expect(m.chars[1].mbIsRenderable).toBe(true);
		expect(m.chars[1].mTopLeftUV.x).toBeCloseTo(0.0332, 3);
		expect(m.chars[1].mTopLeftUV.y).toBeCloseTo(0.8577, 3);
		expect(m.chars[1].mfAdvance).toBeCloseTo(0.0352, 3);
		expect(m.chars[1].mu16TexturePageId).toBe(0);
	});

	it('binds its single atlas page to the bundled Texture resource', () => {
		expect(m.texturePages.length).toBe(1);
		expect(m.texturePages[0].textureId).toBe(textureId);
		expect(m.texturePages[0].textureId).toBe(0xba9aacb7n);
		expect(m.texturePages[0]._ptrSlot).toBe(0);
	});
});

describe('Font gold values (example/FONTS/B5BODY_THAI_35.FONT)', () => {
	const { raw, textureId } = loadFont('B5BODY_THAI_35.FONT');
	const m = parseFont(raw);

	it('decodes the hand-verified header', () => {
		expect(m.chars.length).toBe(263);
		expect(m.muFontHeightInPixels).toBe(140);
		// Unlike the CJK/Western fonts, 13.157 * 140 is no power of two — the
		// scaleUV-equals-atlas-dims pattern is NOT universal.
		expect(m.mScaleUV.x).toBeCloseTo(13.1572, 3);
		expect(m.mScaleUV.y).toBeCloseTo(13.1572, 3);
		expect(m.macTypefaceFamilyName).toBe('B5HelveticaBold');
		expect(m.macTypefaceStyleName).toBe('Bold');
	});

	it('decodes a Thai glyph', () => {
		expect(m.chars[2].charId).toBe(0x0e01);
		expect(String.fromCharCode(m.chars[2].charId)).toBe('ก');
		expect(m.chars[2].mbIsRenderable).toBe(true);
		expect(m.chars[2].mu16TexturePageId).toBe(0);
	});

	it('binds its single atlas page to the bundled Texture resource', () => {
		expect(m.texturePages.length).toBe(1);
		expect(m.texturePages[0].textureId).toBe(textureId);
	});
});

describe('Font 2-page shape (the LIMITED Chinese fonts)', () => {
	// The only retail fonts with >1 texture page. Page 0 binds the bundled
	// Texture; page 1 imports a Texture that lives in a DIFFERENT bundle, and
	// its on-disk pointer slot carries build-time garbage instead of 0.
	const cases = [
		{ file: 'CHINESE_SIMPLIFIED_LIMITED.FONT', page1Id: 0xfe06d33bn, page1Slot: 0xc75dfdd1 },
		{ file: 'CHINESE_TRADITIONAL_LIMITED.FONT', page1Id: 0x4576d81en, page1Slot: 0xc7124dd1 },
	];

	for (const { file, page1Id, page1Slot } of cases) {
		it(`${file}: page 0 in-bundle, page 1 external with garbage ptr slot`, () => {
			const { raw, textureId, importCount } = loadFont(file);
			const m = parseFont(raw);
			expect(m.texturePages.length).toBe(2);
			expect(importCount).toBe(2);
			expect(m.texturePages[0].textureId).toBe(textureId);
			expect(m.texturePages[0]._ptrSlot).toBe(0);
			expect(m.texturePages[1].textureId).toBe(page1Id);
			expect(m.texturePages[1]._ptrSlot).toBe(page1Slot);
			// Both pages are actually used by glyphs.
			const pagesUsed = new Set(m.chars.map((c) => c.mu16TexturePageId));
			expect([...pagesUsed].sort()).toEqual([0, 1]);
		});
	}
});

describe('Font data findings (all 26 retail fonts)', () => {
	for (const file of ALL_FONTS) {
		it(`${file}: invariants the editor relies on`, () => {
			const { raw, textureId, importCount } = loadFont(file);
			const m = parseFont(raw);

			expect(m.muVersionId).toBe(10);
			expect(m.mfLowerCaseScale).toBe(0);
			expect(m.chars.some((c) => c.mbIsLowerCaseScale)).toBe(false);

			// Exactly three non-renderable chars in every font — the three space
			// variants — and the (-1,-1) UV sentinel is equivalent to the flag.
			const nonRenderable = m.chars.filter((c) => !c.mbIsRenderable);
			expect(nonRenderable.map((c) => c.charId).sort((a, b) => a - b)).toEqual([0x20, 0xa0, 0x3000]);
			for (const c of m.chars) {
				if (c.mbIsRenderable) {
					expect(c.mTopLeftUV.x).toBeGreaterThanOrEqual(0);
					expect(c.mTopLeftUV.y).toBeGreaterThanOrEqual(0);
				} else {
					expect(c.mTopLeftUV).toEqual({ x: -1, y: -1 });
				}
			}

			// No duplicate char ids.
			expect(new Set(m.chars.map((c) => c.charId)).size).toBe(m.chars.length);

			// One import entry per texture page; single-page fonts always bind
			// the Texture that ships in the same bundle.
			expect(importCount).toBe(m.texturePages.length);
			if (m.texturePages.length === 1) {
				expect(m.texturePages[0].textureId).toBe(textureId);
			}
		});
	}
});

describe('Font round-trip (all 26 retail fonts)', () => {
	for (const file of ALL_FONTS) {
		it(`${file}: byte-exact and idempotent`, () => {
			const { raw } = loadFont(file);
			const rewritten = writeFont(parseFont(raw));
			expect(rewritten.byteLength).toBe(raw.byteLength);
			expect(bytesEqual(rewritten, raw)).toBe(true);
			const second = writeFont(parseFont(rewritten));
			expect(bytesEqual(second, rewritten)).toBe(true);
		});
	}
});

describe('Font rigid-layout guards', () => {
	const { raw } = loadFont('DEFAULT.FONT');

	it('parser rejects a corrupted hash table', () => {
		const corrupted = new Uint8Array(raw); // copy — never mutate the extracted view
		corrupted[0x2a] ^= 0xff; // mauHashOffsets[1]
		expect(() => parseFont(corrupted)).toThrow(/mauHashOffsets/);
	});

	it('parser rejects a non-retail version id', () => {
		const corrupted = new Uint8Array(raw);
		corrupted[0] = 1; // dev-era muVersionId
		expect(() => parseFont(corrupted)).toThrow(/muVersionId/);
	});

	it('writer rejects chars that break hash-bucket grouping', () => {
		const m = parseFont(raw);
		const chars = m.chars.slice().reverse();
		expect(() => writeFont({ ...m, chars })).toThrow(/bucket/);
	});

	it('writer rejects a glyph referencing a missing texture page', () => {
		const m = parseFont(raw);
		const chars = m.chars.slice();
		chars[0] = { ...chars[0], mu16TexturePageId: 5 };
		expect(() => writeFont({ ...m, chars })).toThrow(/texture page/);
	});

	it('writer rejects an over-long typeface name instead of truncating it', () => {
		const m = parseFont(raw);
		expect(() => writeFont({ ...m, macTypefaceFamilyName: 'x'.repeat(128) })).toThrow(/char\[128\]/);
	});

	it('writer rejects a font with no texture pages', () => {
		const m = parseFont(raw);
		expect(() => writeFont({ ...m, texturePages: [] })).toThrow(/texture page/);
	});

	it('hash offsets recompute matches the game layout for a hand-built case', () => {
		const glyph = (charId: number) => ({
			charId,
			mTopLeftUV: { x: 0, y: 0 },
			mDimensionsUV: { x: 0, y: 0 },
			mStart: { x: 0, y: 0 },
			mfAdvance: 0,
			mu16TexturePageId: 0,
			mbIsLowerCaseScale: false,
			mbIsRenderable: true,
		});
		// Buckets: 0x3000→0, 0x20→32, 0xA0→32, 0x41→65.
		const h = computeHashOffsets([glyph(0x3000), glyph(0x20), glyph(0xa0), glyph(0x41)]);
		expect(h[0]).toBe(0);
		expect(h[1]).toBe(1); // bucket 0 holds one char
		expect(h[32]).toBe(1);
		expect(h[33]).toBe(3); // bucket 32 holds two chars
		expect(h[65]).toBe(3);
		expect(h[66]).toBe(4);
		expect(h[128]).toBe(4);
	});
});

describe('Font char add/remove (parser/writer level)', () => {
	it('round-trips a model with an appended glyph through write→parse', () => {
		const { raw } = loadFont('DEFAULT.FONT');
		const m = parseFont(raw);
		// Bucket of the last char must be >= the previous last to keep grouping;
		// append into bucket 127 (0x7F), which is >= every existing bucket.
		const chars = m.chars.concat([{
			charId: 0xff,
			mTopLeftUV: { x: 0.5, y: 0.5 },
			mDimensionsUV: { x: 0.05, y: 0.05 },
			mStart: { x: 0, y: 0 },
			mfAdvance: 0.05,
			mu16TexturePageId: 0,
			mbIsLowerCaseScale: false,
			mbIsRenderable: true,
		}]);
		const reparsed = parseFont(writeFont({ ...m, chars }));
		expect(reparsed.chars.length).toBe(m.chars.length + 1);
		expect(reparsed.chars[reparsed.chars.length - 1].charId).toBe(0xff);
		// Growing the char array moves the inline import table; the bundle-level
		// importOffset that points at it is recomputed by writeBundleFresh via
		// the handler's importTable() hook (pinned in
		// bundle/__tests__/writeBundleFreshImports.test.ts).
	});
});
