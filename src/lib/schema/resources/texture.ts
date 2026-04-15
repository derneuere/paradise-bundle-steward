// Hand-written schema for ParsedTextureHeader (resource type 0x0).
//
// Mirrors the `ParsedTextureHeader` type in `src/lib/core/texture.ts`. The
// texture handler is read-only (`caps.write: false`) and its `parseRaw` only
// decodes block 0 — the fixed-size header. The pixel-data block lives outside
// the schema entirely (the handler never surfaces it on the model), so
// there's nothing for the walker to "hide"; the bulk binary simply isn't
// reachable from the root. The 2D preview extension in
// `components/schema-editor/viewports/TextureViewport.tsx` re-decodes pixels
// from the raw bundle on demand.
//
// Field widths are picked to be the WIDEST observed across the two header
// layouts (PC original at 0x20 bytes vs Remastered/BPR at 0x40+ bytes) so
// the renderer never clamps a legal value. Concretely, PC stores `depth`,
// `textureType`, and `flags` as u8 at offsets 0x18/0x1A/0x1B, while BPR
// stores them as u16 (depth) / u32 (textureType, flags). See
// `parseTextureHeader` in src/lib/core/texture.ts for the per-layout pulls.
// Everything is marked `readOnly` because the handler has no writer — edits
// in the UI would be silently dropped on export and that's confusing.

import type {
	FieldSchema,
	RecordSchema,
	ResourceSchema,
	SchemaRegistry,
} from '../types';

// ---------------------------------------------------------------------------
// Local field helpers
// ---------------------------------------------------------------------------

const u8 = (): FieldSchema => ({ kind: 'u8' });
const u16 = (): FieldSchema => ({ kind: 'u16' });
const u32 = (): FieldSchema => ({ kind: 'u32' });
const string = (): FieldSchema => ({ kind: 'string' });

// ---------------------------------------------------------------------------
// Texture format label vocabulary
// ---------------------------------------------------------------------------

// Every possible value of `ParsedTextureHeader.format`. The parser's
// `identifyD3DFormat` and `identifyDxgiFormat` map raw u32 codec codes to one
// of these string literals; anything unrecognised becomes 'UNKNOWN'. Listed
// here to power the inline description on the `format` field.
const TEXTURE_FORMAT_NAMES = [
	'DXT1',
	'DXT3',
	'DXT5',
	'A8R8G8B8',
	'A8B8G8R8',
	'B8G8R8A8',
	'R8G8B8A8',
	'UNKNOWN',
] as const;

// ---------------------------------------------------------------------------
// Record schema
// ---------------------------------------------------------------------------

const Texture: RecordSchema = {
	name: 'Texture',
	description:
		'Texture header metadata. The pixel data lives in a separate opaque block ' +
		'(Disposable memory) that is decoded on demand by the 2D preview extension ' +
		'and is not part of the schema.',
	fields: {
		format: string(),
		formatRaw: u32(),
		width: u16(),
		height: u16(),
		depth: u16(),
		mipLevels: u8(),
		textureType: u32(),
		flags: u32(),
	},
	fieldMetadata: {
		format: {
			label: 'Format',
			readOnly: true,
			description:
				`Codec label derived from formatRaw. Known values: ${TEXTURE_FORMAT_NAMES.join(', ')}.`,
		},
		formatRaw: {
			label: 'Format (raw)',
			readOnly: true,
			description:
				'Raw 4-byte OutputFormat (PC) or DXGI_FORMAT (Remastered) field. ' +
				'Interpreted as an ASCII FourCC first, then as a numeric codec index.',
		},
		width: {
			label: 'Width (px)',
			readOnly: true,
			description: 'Width of mip level 0.',
		},
		height: {
			label: 'Height (px)',
			readOnly: true,
			description: 'Height of mip level 0.',
		},
		depth: {
			label: 'Depth',
			readOnly: true,
			description:
				'Usually 1 for 2D textures. PC stores depth as u8 at offset 0x18; ' +
				'Remastered stores u16 at 0x28.',
		},
		mipLevels: {
			label: 'Mip levels',
			readOnly: true,
			description:
				'Number of mipmap levels in the pixel block. 1 = no mipmaps.',
		},
		textureType: {
			label: 'Texture type',
			readOnly: true,
			description:
				'PC: u8 at 0x1A (legacy type code). BPR/Remastered: u32 Dimension ' +
				'at 0x08 (6=1D, 7=2D, 8=3D, 9=Cube).',
		},
		flags: {
			label: 'Flags',
			readOnly: true,
			description:
				'Raw flag bits. PC: u8 at 0x1B. BPR/Remastered: u32 at 0x20. ' +
				'Semantics vary by platform.',
		},
	},
	propertyGroups: [
		{
			title: 'Metadata',
			properties: [
				'format',
				'formatRaw',
				'width',
				'height',
				'depth',
				'mipLevels',
				'textureType',
				'flags',
			],
		},
	],
};

// ---------------------------------------------------------------------------
// Registry + resource
// ---------------------------------------------------------------------------

const registry: SchemaRegistry = {
	Texture,
};

export const textureResourceSchema: ResourceSchema = {
	key: 'texture',
	name: 'Texture',
	rootType: 'Texture',
	registry,
};
