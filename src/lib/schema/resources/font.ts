// Hand-written schema for ParsedFont (resource type 0x21).
//
// Mirrors the types in `src/lib/core/font.ts`. Keep these in lockstep with
// the parser/writer — any field added to the parser needs a matching entry
// here, or the schema walker reports it as drift.
//
// Domain: a Font maps UTF-16 code units to glyph rectangles on texture atlas
// pages. Glyph UVs are normalized [0..1] over the bound Texture; multiply by
// the texture's pixel dimensions to get the atlas rect (a future extension
// could render a glyph-atlas preview from exactly these fields). The three
// space characters (U+0020, U+00A0, U+3000) are non-renderable and store the
// (-1,-1) UV sentinel — they only contribute advance.
//
// Glyph count changes move the inline import table at the payload tail and
// page count changes resize it; the bundle envelope recomputes its
// importOffset/importCount on export via the handler's importTable() hook, so
// both lists are editable. Char ids must keep the array grouped by ascending
// hash bucket (charId & 0x7F) — the writer throws otherwise, which is why new
// glyphs default to a bucket-127 char id (append-safe after every bucket).

import type {
	FieldSchema,
	RecordSchema,
	ResourceSchema,
	SchemaRegistry,
} from '../types';

// ---------------------------------------------------------------------------
// Local helpers (mirroring staticSoundMap.ts)
// ---------------------------------------------------------------------------

const f32 = (): FieldSchema => ({ kind: 'f32' });
const u16 = (): FieldSchema => ({ kind: 'u16' });
const u32 = (): FieldSchema => ({ kind: 'u32' });
const vec2 = (): FieldSchema => ({ kind: 'vec2' });
const bool = (): FieldSchema => ({ kind: 'bool' });
const str = (): FieldSchema => ({ kind: 'string' });
const record = (type: string): FieldSchema => ({ kind: 'record', type });

const recordList = (
	type: string,
	makeEmpty: () => unknown,
	itemLabel?: (item: unknown, index: number) => string,
): FieldSchema => ({
	kind: 'list',
	item: record(type),
	addable: true,
	removable: true,
	makeEmpty,
	itemLabel: itemLabel ? (item, index) => itemLabel(item, index) : undefined,
});

// charId 0xFF hashes to bucket 127 (charId & 0x7F), which sorts after every
// existing bucket — so an appended glyph never breaks the writer's
// bucket-grouping invariant.
const makeEmptyFontChar = () => ({
	charId: 0xff,
	mTopLeftUV: { x: 0, y: 0 },
	mDimensionsUV: { x: 0, y: 0 },
	mStart: { x: 0, y: 0 },
	mfAdvance: 0,
	mu16TexturePageId: 0,
	mbIsLowerCaseScale: false,
	mbIsRenderable: true,
});

const makeEmptyTexturePage = () => ({ textureId: 0n, _ptrSlot: 0 });

// ---------------------------------------------------------------------------
// Tree-label helpers
// ---------------------------------------------------------------------------

/** Human reading of a UTF-16 code unit: the actual character where printable,
 *  always with the U+XXXX codepoint. Control chars, spaces, the Latin-1 gap,
 *  and surrogates fall back to codepoint-only. */
export function charIdLabel(charId: number): string {
	const hex = `U+${charId.toString(16).toUpperCase().padStart(4, '0')}`;
	const printable =
		charId > 0x20 &&
		charId !== 0x7f &&
		!(charId >= 0x80 && charId <= 0xa0) &&
		!(charId >= 0xd800 && charId <= 0xdfff) &&
		charId !== 0x3000;
	return printable ? `'${String.fromCharCode(charId)}' ${hex}` : hex;
}

function fontCharLabel(item: unknown, index: number): string {
	try {
		if (!item || typeof item !== 'object') return `#${index}`;
		const c = item as { charId?: number; mbIsRenderable?: boolean; mu16TexturePageId?: number };
		if (c.charId == null) return `#${index}`;
		const space = c.mbIsRenderable === false ? ' · space' : '';
		const page = (c.mu16TexturePageId ?? 0) > 0 ? ` · pg ${c.mu16TexturePageId}` : '';
		return `#${index} · ${charIdLabel(c.charId)}${space}${page}`;
	} catch {
		return `#${index}`;
	}
}

function texturePageLabel(item: unknown, index: number): string {
	try {
		if (!item || typeof item !== 'object') return `#${index}`;
		const p = item as { textureId?: bigint };
		if (p.textureId == null) return `#${index}`;
		return `#${index} · 0x${p.textureId.toString(16).toUpperCase().padStart(8, '0')}`;
	} catch {
		return `#${index}`;
	}
}

// ---------------------------------------------------------------------------
// Record schemas
// ---------------------------------------------------------------------------

const FontChar: RecordSchema = {
	name: 'FontChar',
	description: 'One glyph — a UTF-16 code unit mapped to a normalized UV rectangle on an atlas page, plus layout metrics. Multiply the UVs by the bound texture\'s pixel dimensions to get the atlas rect.',
	fields: {
		charId: u16(),
		mTopLeftUV: vec2(),
		mDimensionsUV: vec2(),
		mStart: vec2(),
		mfAdvance: f32(),
		mu16TexturePageId: {
			kind: 'ref',
			storage: 'u16',
			target: { listPath: ['texturePages'], itemType: 'FontTexturePage', displayName: 'Texture page' },
		},
		mbIsLowerCaseScale: bool(),
		mbIsRenderable: bool(),
	},
	fieldMetadata: {
		charId: {
			label: 'Character',
			description: 'UTF-16 code unit (CgsUtf16) this glyph renders. Editable, but the char list must stay grouped by ascending hash bucket (charId & 0x7F) — the writer rejects the edit otherwise. Retail fonts never duplicate an id.',
		},
		mTopLeftUV: {
			label: 'Top-left UV',
			description: 'Normalized [0..1] top-left corner of the glyph on its atlas page. (-1,-1) sentinel on the three non-renderable space chars.',
		},
		mDimensionsUV: {
			label: 'Size UV',
			description: 'Normalized glyph width/height on the atlas page.',
		},
		mStart: {
			label: 'Start offset',
			description: 'Offset of the glyph quad from the pen position, in UV-scaled glyph units (multiply by Scale UV for glyph space).',
		},
		mfAdvance: {
			label: 'Advance',
			description: 'Pen advance after this glyph, in UV-scaled glyph units.',
		},
		mu16TexturePageId: {
			label: 'Texture page',
			description: 'Atlas page this glyph lives on. Only the two LIMITED Chinese fonts use more than one page.',
		},
		mbIsLowerCaseScale: {
			label: 'Lower-case scale',
			description: 'Scales the glyph by the font\'s lower-case scale factor when set. Never set in any retail font (the factor is 0 everywhere too).',
		},
		mbIsRenderable: {
			label: 'Renderable',
			description: 'Off for the three space chars (U+0020, U+00A0, U+3000), which carry the (-1,-1) UV sentinel and only contribute advance.',
		},
	},
	propertyGroups: [
		{ title: 'Character', properties: ['charId', 'mbIsRenderable'] },
		{ title: 'Atlas rect', properties: ['mTopLeftUV', 'mDimensionsUV', 'mu16TexturePageId'] },
		{ title: 'Metrics', properties: ['mStart', 'mfAdvance', 'mbIsLowerCaseScale'] },
	],
	label: (value, index) => fontCharLabel(value, index ?? 0),
};

const FontTexturePage: RecordSchema = {
	name: 'FontTexturePage',
	description: 'One atlas page — a BND2 import binding the page to a Texture resource by id. Single-page fonts always bind the Texture shipped in the same .FONT bundle; the LIMITED Chinese fonts import their second page from another bundle.',
	fields: {
		textureId: { kind: 'bigint', bytes: 8, hex: true },
		_ptrSlot: u32(),
	},
	fieldMetadata: {
		textureId: {
			label: 'Texture resource',
			description: 'Resource id of the Texture (type 0x0) this page binds. Must reference a loadable texture — the glyph UVs are meaningless without it.',
		},
		_ptrSlot: {
			label: 'Pointer slot',
			description: 'On-disk value of the page\'s runtime pointer slot, overwritten by the import patcher at load. 0 except the second page of the LIMITED fonts, which carries build-time garbage. Preserved for byte-exact round-trip.',
			hidden: true,
		},
	},
	label: (value, index) => texturePageLabel(value, index ?? 0),
};

// ---------------------------------------------------------------------------
// Root + registry export
// ---------------------------------------------------------------------------

const ParsedFont: RecordSchema = {
	name: 'ParsedFont',
	description: 'Root record for the Font resource (0x21): typeface metadata, the glyph table, and the texture atlas pages the glyphs index into. Consumed by Apt UI scripts and debug text.',
	fields: {
		muVersionId: u32(),
		mScaleUV: vec2(),
		mfLowerCaseScale: f32(),
		mfBaseLine: f32(),
		mfXHeight: f32(),
		muFontHeightInPixels: u32(),
		macTypefaceFamilyName: str(),
		macTypefaceStyleName: str(),
		chars: recordList('FontChar', makeEmptyFontChar, fontCharLabel),
		texturePages: recordList('FontTexturePage', makeEmptyTexturePage, texturePageLabel),
	},
	fieldMetadata: {
		muVersionId: {
			label: 'Version',
			description: 'Font layout version — 10 in every retail font; the parser rejects anything else.',
			readOnly: true,
		},
		mScaleUV: {
			label: 'Scale UV',
			description: 'Converts UV-space metrics (start offset, advance) to glyph space. For most fonts Scale UV × font height equals the atlas pixel dimensions exactly; the Thai pair breaks that pattern.',
		},
		mfLowerCaseScale: {
			label: 'Lower-case scale',
			description: 'Scale factor applied to glyphs flagged lower-case-scale. 0 in every retail font — the flag is never set either.',
		},
		mfBaseLine: {
			label: 'Baseline',
			description: 'Baseline height as a fraction of the line cell (~0.77 across retail).',
		},
		mfXHeight: {
			label: 'x-height',
			description: 'x-height as a fraction of the line cell.',
		},
		muFontHeightInPixels: {
			label: 'Font height (px)',
			description: 'Source rasterization size in pixels (35–288 across retail).',
		},
		macTypefaceFamilyName: {
			label: 'Typeface family',
			description: 'char[128] on disk — at most 127 bytes; the writer rejects longer names.',
		},
		macTypefaceStyleName: {
			label: 'Typeface style',
			description: 'char[128] on disk — at most 127 bytes.',
		},
		chars: {
			label: 'Glyphs',
			description: 'Every glyph in disk order, grouped by ascending hash bucket (charId & 0x7F) — the char-lookup table is re-derived from this order on write, and the writer rejects an order that breaks the grouping. New glyphs default to a bucket-127 char id so appending is always valid.',
		},
		texturePages: {
			label: 'Atlas pages',
			description: 'The Texture resources glyphs index into, bound via the inline import table (recomputed on export). A new page needs a real Texture resource id; removing a page that glyphs still reference is rejected by the writer.',
		},
	},
	propertyGroups: [
		{ title: 'Typeface', properties: ['macTypefaceFamilyName', 'macTypefaceStyleName', 'muFontHeightInPixels', 'muVersionId'] },
		{ title: 'Metrics', properties: ['mScaleUV', 'mfLowerCaseScale', 'mfBaseLine', 'mfXHeight'] },
		{ title: 'Glyphs', properties: ['chars'] },
		{ title: 'Atlas', properties: ['texturePages'] },
	],
};

const registry: SchemaRegistry = {
	ParsedFont,
	FontChar,
	FontTexturePage,
};

export const fontResourceSchema: ResourceSchema = {
	key: 'font',
	name: 'Font',
	rootType: 'ParsedFont',
	registry,
};
