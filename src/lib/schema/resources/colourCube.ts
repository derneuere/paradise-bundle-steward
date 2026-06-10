// Hand-written schema for ParsedColourCube (resource type 0x2B).
//
// Mirrors the types in `src/lib/core/colourCube.ts`. Keep these in lockstep
// with the parser/writer — any field added to the parser needs a matching
// entry here, or the schema walker reports it as drift.
//
// Domain: a ColourCube is the 3D CLUT EnvironmentSettings / PostFX feed every
// rendered pixel through to grade and tone-map the frame. The body is mSize³
// RGB24 texels (98 304 bytes for the retail 32-cube) — individually
// meaningless in a tree UI, so it stays a hidden raw blob; meaningful editing
// belongs to a future swatch/preview extension that samples texels via
// colourCubeTexel (X-major layout: input R indexes X, G indexes Y, B
// indexes Z).

import type { FieldSchema, RecordSchema, ResourceSchema, SchemaRegistry } from '../types';

const u32 = (): FieldSchema => ({ kind: 'u32' });
const rawBytes = (): FieldSchema => ({ kind: 'custom', component: 'rawBytes' });

const ParsedColourCube: RecordSchema = {
	name: 'ParsedColourCube',
	description: 'Root record for the ColourCube resource (0x2B): a 3D colour look-up table that grades the whole frame. All four retail DLC24HR cubes carry the same byte-identical "default RGB CLUT" — a per-channel tone curve with no cross-channel grading.',
	fields: {
		mSize: u32(),
		pixels: rawBytes(),
		_pad08: u32(),
		_pad0C: u32(),
	},
	fieldMetadata: {
		mSize: {
			label: 'Cube size',
			description: 'Texels per axis — the body holds mSize³ RGB24 texels (retail: 32, i.e. 32 768 texels / 96 KiB). Read-only: resizing requires regenerating the entire texel payload, which the writer enforces (it rejects a pixel buffer that is not exactly mSize³ × 3 bytes).',
			readOnly: true,
		},
		pixels: {
			label: 'Texel data',
			description: 'Dense RGB24 LUT body, X-major: texel (x,y,z) lives at (mSize²·z + mSize·y + x) × 3. Input Red indexes X, Green Y, Blue Z; each texel is the output colour. Preserved verbatim — edit via a preview extension, not byte-by-byte.',
			hidden: true,
		},
		_pad08: {
			label: 'pad +0x8',
			description: 'Header pad word (0 in retail); preserved verbatim for byte-exact round-trip.',
			hidden: true,
		},
		_pad0C: {
			label: 'pad +0xC',
			description: 'Header pad word (0 in retail); preserved verbatim for byte-exact round-trip.',
			hidden: true,
		},
	},
	propertyGroups: [
		{ title: 'Cube', properties: ['mSize'] },
	],
};

const registry: SchemaRegistry = {
	ParsedColourCube,
};

export const colourCubeResourceSchema: ResourceSchema = {
	key: 'colourCube',
	name: 'Colour Cube',
	rootType: 'ParsedColourCube',
	registry,
};
