// Hand-written schema for ParsedPolygonSoupList (resource type 0x43).
//
// Mirrors the types in `src/lib/core/polygonSoupList.ts`. Covers every
// field in the parsed model so the schema editor can walk, edit, and
// round-trip without loss.
//
// Layout bookkeeping fields (offsets, dataSize, totalSize, boxListStart,
// chunkPointerStart) are hidden + readOnly — they're parser-internal and
// rewritten by the writer. The same goes for per-soup offsets and the
// AABB4 rowValidMasks table, which is parallel state the user doesn't
// edit directly.

import type {
	FieldSchema,
	RecordSchema,
	ResourceSchema,
	SchemaRegistry,
	SchemaContext,
} from '../types';

// ---------------------------------------------------------------------------
// Local field helpers
// ---------------------------------------------------------------------------

const u8 = (): FieldSchema => ({ kind: 'u8' });
const u16 = (): FieldSchema => ({ kind: 'u16' });
const u32 = (): FieldSchema => ({ kind: 'u32' });
const i32 = (): FieldSchema => ({ kind: 'i32' });
const f32 = (): FieldSchema => ({ kind: 'f32' });
const vec3 = (): FieldSchema => ({ kind: 'vec3' });
const record = (type: string): FieldSchema => ({ kind: 'record', type });

const fixedList = (item: FieldSchema, length: number): FieldSchema => ({
	kind: 'list',
	item,
	minLength: length,
	maxLength: length,
	addable: false,
	removable: false,
});

const recordList = (
	type: string,
	itemLabel?: (item: unknown, index: number, ctx: SchemaContext) => string,
): FieldSchema => ({
	kind: 'list',
	item: record(type),
	addable: true,
	removable: true,
	itemLabel,
});

const primList = (item: FieldSchema): FieldSchema => ({
	kind: 'list',
	item,
	addable: true,
	removable: true,
});

// ---------------------------------------------------------------------------
// Tree-label helpers
// ---------------------------------------------------------------------------

function soupLabel(soup: unknown, index: number): string {
	if (!soup || typeof soup !== 'object') return `#${index}`;
	const s = soup as { vertices?: unknown[]; polygons?: unknown[]; numQuads?: number };
	const verts = s.vertices?.length ?? 0;
	const polys = s.polygons?.length ?? 0;
	const quads = s.numQuads ?? 0;
	const tris = polys - quads;
	return `#${index} · ${verts}v · ${polys}p (${quads}q/${tris}t)`;
}

function polyLabel(poly: unknown, index: number): string {
	if (!poly || typeof poly !== 'object') return `#${index}`;
	const p = poly as { collisionTag?: number; vertexIndices?: number[] };
	const isTri = p.vertexIndices?.[3] === 0xFF;
	if (p.collisionTag == null) return `#${index} · ${isTri ? 'tri' : 'quad'}`;
	// Pull the AI section index out of the group half (LOW u16, bits 14-0).
	// Cheaper than importing from collisionTag.ts and keeps the schema
	// module's import surface unchanged.
	const aiSection = (p.collisionTag & 0x7FFF);
	return `#${index} · AI ${aiSection} · ${isTri ? 'tri' : 'quad'}`;
}

function vertexLabel(v: unknown, index: number): string {
	if (!v || typeof v !== 'object') return `#${index}`;
	const p = v as { x?: number; y?: number; z?: number };
	return `#${index} · (${p.x ?? 0}, ${p.y ?? 0}, ${p.z ?? 0})`;
}

// ---------------------------------------------------------------------------
// Record schemas
// ---------------------------------------------------------------------------

const PolygonSoupVertex: RecordSchema = {
	name: 'PolygonSoupVertex',
	description: 'Packed u16 coordinate in local soup space.',
	fields: {
		x: u16(),
		y: u16(),
		z: u16(),
	},
};

const PolygonSoupPoly: RecordSchema = {
	name: 'PolygonSoupPoly',
	description: 'One polygon — triangle when vertexIndices[3] = 0xFF, quad otherwise.',
	fields: {
		collisionTag: { kind: 'custom', component: 'collisionTag' },
		vertexIndices: fixedList(u8(), 4),
		edgeCosines: fixedList(u8(), 4),
	},
	fieldMetadata: {
		collisionTag: {
			label: 'Collision tag',
			description: 'Decoded view of BrnWorld::CollisionTag — AI section index, surface ID, flags, and traffic info. The raw u32 is preserved byte-for-byte; edits touch only the field being changed.',
		},
		vertexIndices: { label: 'Vertex indices', description: '[3] = 0xFF means triangle, otherwise quad.' },
		edgeCosines: { label: 'Edge cosines', description: 'u8-compressed per-edge cosines.' },
	},
	label: (value, index) => polyLabel(value, index ?? 0),
};

const Vec3Record: RecordSchema = {
	name: 'Vec3Record',
	description: 'Three-float vector (unused as a record today; vec3 kind is preferred).',
	fields: {
		x: f32(),
		y: f32(),
		z: f32(),
	},
};

const PolygonSoup: RecordSchema = {
	name: 'PolygonSoup',
	description: 'One collision mesh — packed vertices + polygons + bounding box.',
	fields: {
		vertexOffsets: fixedList(i32(), 3),
		comprGranularity: f32(),
		numQuads: u8(),
		padding: fixedList(u8(), 3),
		vertices: recordList('PolygonSoupVertex', vertexLabel),
		polygons: recordList('PolygonSoupPoly', polyLabel),
		min: vec3(),
		max: vec3(),
		// Layout bookkeeping (hidden).
		offset: u32(),
		verticesOffset: u32(),
		polygonsOffset: u32(),
		dataSize: u16(),
	},
	fieldMetadata: {
		vertexOffsets: { label: 'Vertex offsets', description: 'Opaque i32[3] — semantics TBD on the wiki.' },
		comprGranularity: { description: 'Opaque f32 — semantics TBD on the wiki.' },
		numQuads: { description: 'Number of polygons that are quads (remainder are triangles).' },
		padding: { hidden: true },
		min: { label: 'Bounds min', swapYZ: true },
		max: { label: 'Bounds max', swapYZ: true },
		offset: { hidden: true, readOnly: true, description: 'Absolute byte offset within the resource. Patched by the writer.' },
		verticesOffset: { hidden: true, readOnly: true, description: 'Absolute byte offset of the packed vertex block.' },
		polygonsOffset: { hidden: true, readOnly: true, description: 'Absolute byte offset of the polygon block.' },
		dataSize: { hidden: true, readOnly: true, description: 'Raw u16 mu16DataSize field. Patched by the writer.' },
	},
	label: (value, index) => soupLabel(value, index ?? 0),
};

const PolygonSoupList: RecordSchema = {
	name: 'PolygonSoupList',
	description: 'Root record for the collision-mesh resource (0x43).',
	fields: {
		overallMin: vec3(),
		overallMinPadding: u32(),
		overallMax: vec3(),
		overallMaxPadding: u32(),
		soups: recordList('PolygonSoup', soupLabel),
		rowValidMasks: primList(fixedList(u32(), 4)),
		// Layout bookkeeping (hidden).
		dataSize: u32(),
		totalSize: u32(),
		chunkPointerStart: u32(),
		boxListStart: u32(),
	},
	fieldMetadata: {
		overallMin: { label: 'Bounding box min', swapYZ: true },
		overallMax: { label: 'Bounding box max', swapYZ: true },
		overallMinPadding: { hidden: true },
		overallMaxPadding: { hidden: true },
		rowValidMasks: {
			hidden: true,
			description: 'Per-AABB4-row validity mask bits. Regenerated at write time, preserved verbatim for round-trip.',
		},
		dataSize: { hidden: true, readOnly: true, description: 'Header miDataSize. Patched by the writer.' },
		totalSize: { hidden: true, readOnly: true, description: 'Raw resource byte length.' },
		chunkPointerStart: { hidden: true, readOnly: true },
		boxListStart: { hidden: true, readOnly: true },
	},
	propertyGroups: [
		{ title: 'Bounds', properties: ['overallMin', 'overallMax'] },
		{ title: 'Soups', properties: ['soups'] },
	],
};

// ---------------------------------------------------------------------------
// Registry + resource
// ---------------------------------------------------------------------------

const registry: SchemaRegistry = {
	PolygonSoupList,
	PolygonSoup,
	PolygonSoupPoly,
	PolygonSoupVertex,
	Vec3Record,
};

export const polygonSoupListResourceSchema: ResourceSchema = {
	key: 'polygonSoupList',
	name: 'Polygon Soup List',
	rootType: 'PolygonSoupList',
	registry,
};
