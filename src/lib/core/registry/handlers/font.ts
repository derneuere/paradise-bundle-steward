// Font registry handler — thin wrapper around parseFont / writeFont in
// src/lib/core/font.ts.
//
// Every retail .FONT bundle carries exactly one Font resource (plus the
// Texture it imports), so no picker is needed. The three declared fixtures
// cover the largest CJK font, the second CJK glyph set, and the Thai layout
// whose mScaleUV breaks the scale*height == atlas-dims pattern; the remaining
// 23 retail fonts are swept in __tests__/font.test.ts.

import { parseFont, writeFont, type ParsedFont } from '../../font';
import type { ResourceHandler } from '../handler';

// 0x3080 keeps chars[0]'s hash bucket (charId & 0x7F) so the writer's
// bucket-grouping invariant holds, while provably changing the stored id
// (chars[0] is U+3000 ideographic space in every retail font).
const STRESS_CHAR_ID = 0x3080;
const STRESS_TEXTURE_ID = 0x00000000deadbeefn;

export const fontHandler: ResourceHandler<ParsedFont> = {
	typeId: 0x21,
	key: 'font',
	name: 'Font',
	description: 'Links UTF-16 characters to glyph rectangles on texture atlas pages for text rendering (Apt UI, debug text) — per-glyph UV rects, advances, and a 128-bucket char-lookup hash',
	category: 'Graphics',
	caps: { read: true, write: true },
	wikiUrl: 'https://burnout.wiki/wiki/Font',

	parseRaw(raw, ctx) {
		return parseFont(raw, ctx.littleEndian);
	},
	writeRaw(model, ctx) {
		return writeFont(model, ctx.littleEndian);
	},
	importTable(payload, ctx) {
		// One import per texture page, at the payload tail (the parser throws
		// unless the table sits exactly at mSizeOfFont).
		const model = parseFont(payload, ctx.littleEndian);
		const count = model.texturePages.length;
		return { offset: payload.byteLength - count * 16, count };
	},
	describe(model) {
		return `${model.macTypefaceFamilyName} ${model.macTypefaceStyleName}, ${model.chars.length} chars, ${model.texturePages.length} page${model.texturePages.length === 1 ? '' : 's'}, ${model.muFontHeightInPixels}px`;
	},

	fixtures: [
		{ bundle: 'example/FONTS/CHINESE_SIMPLIFIED.FONT', expect: { parseOk: true, byteRoundTrip: true } },
		{ bundle: 'example/FONTS/CHINESE_TRADITIONAL.FONT', expect: { parseOk: true, byteRoundTrip: true } },
		{ bundle: 'example/FONTS/B5BODY_THAI_35.FONT', expect: { parseOk: true, byteRoundTrip: true } },
	],

	stressScenarios: [
		{
			name: 'baseline',
			description: 'no mutation — exercises the writer on the read model unchanged',
			mutate: (m) => m,
			verify: (before, after) => {
				const problems: string[] = [];
				if (after.chars.length !== before.chars.length) {
					problems.push(`char count ${after.chars.length} != ${before.chars.length}`);
				}
				if (after.texturePages.length !== before.texturePages.length) {
					problems.push(`page count ${after.texturePages.length} != ${before.texturePages.length}`);
				}
				return problems;
			},
		},
		{
			name: 'edit-glyph-metrics',
			description: 'nudge chars[0]\'s advance and start offset and verify the new metrics survive round-trip',
			mutate: (m) => {
				const chars = m.chars.slice();
				chars[0] = {
					...chars[0],
					mfAdvance: chars[0].mfAdvance + 0.015625, // exactly representable in f32
					mStart: { x: chars[0].mStart.x + 0.25, y: chars[0].mStart.y + 0.5 },
				};
				return { ...m, chars };
			},
			verify: (afterMutate, afterReparse) => {
				const problems: string[] = [];
				const a = afterMutate.chars[0];
				const b = afterReparse.chars[0];
				if (Math.abs(a.mfAdvance - b.mfAdvance) > 1e-6) problems.push(`mfAdvance = ${b.mfAdvance}, expected ${a.mfAdvance}`);
				if (Math.abs(a.mStart.x - b.mStart.x) > 1e-6) problems.push(`mStart.x = ${b.mStart.x}, expected ${a.mStart.x}`);
				if (Math.abs(a.mStart.y - b.mStart.y) > 1e-6) problems.push(`mStart.y = ${b.mStart.y}, expected ${a.mStart.y}`);
				return problems;
			},
		},
		{
			name: 'remap-char-id',
			description: 'change chars[0].charId within its hash bucket and verify it survives alongside a recomputed lookup table',
			mutate: (m) => {
				const chars = m.chars.slice();
				chars[0] = { ...chars[0], charId: STRESS_CHAR_ID };
				return { ...m, chars };
			},
			verify: (afterMutate, afterReparse) => {
				const problems: string[] = [];
				if (afterReparse.chars[0].charId !== STRESS_CHAR_ID) {
					problems.push(`charId = 0x${afterReparse.chars[0].charId.toString(16)}, expected 0x${STRESS_CHAR_ID.toString(16)}`);
				}
				// charId shares its 0x20-byte record with the UV rect — editing the
				// id must not perturb the glyph metrics.
				if (afterReparse.chars[0].mfAdvance !== afterMutate.chars[0].mfAdvance) {
					problems.push(`mfAdvance changed to ${afterReparse.chars[0].mfAdvance}`);
				}
				return problems;
			},
		},
		{
			name: 'toggle-renderable',
			description: 'flip chars[0].mbIsRenderable (a space in every retail font) and verify the bool byte round-trips',
			mutate: (m) => {
				const chars = m.chars.slice();
				chars[0] = { ...chars[0], mbIsRenderable: !chars[0].mbIsRenderable };
				return { ...m, chars };
			},
			verify: (afterMutate, afterReparse) => {
				const problems: string[] = [];
				if (afterReparse.chars[0].mbIsRenderable !== afterMutate.chars[0].mbIsRenderable) {
					problems.push(`mbIsRenderable = ${afterReparse.chars[0].mbIsRenderable}`);
				}
				return problems;
			},
		},
		{
			name: 'retarget-texture-page',
			description: 'point texturePages[0] at a different Texture resource id and verify the regenerated import table carries it',
			mutate: (m) => {
				const texturePages = m.texturePages.slice();
				texturePages[0] = { ...texturePages[0], textureId: STRESS_TEXTURE_ID };
				return { ...m, texturePages };
			},
			verify: (_afterMutate, afterReparse) => {
				const problems: string[] = [];
				if (afterReparse.texturePages[0].textureId !== STRESS_TEXTURE_ID) {
					problems.push(`textureId = 0x${afterReparse.texturePages[0].textureId.toString(16)}, expected 0x${STRESS_TEXTURE_ID.toString(16)}`);
				}
				return problems;
			},
		},
	],
};
