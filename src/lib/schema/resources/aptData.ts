// Hand-written schema for ParsedAptData (resource type 0x1E).
//
// Mirrors the types in `src/lib/core/aptData.ts`. Keep these in lockstep
// with the parser/writer — any field added to the parser needs a matching
// entry here, or the schema walker reports it as drift.
//
// Domain: an Apt resource is EA's Flash-derived UI movie. The movie itself
// (character tree, frames, ActionScript bytecode) is an opaque verbatim blob
// — steward only edits the structural layer around it: component names, the
// 2D render geometry (files → meshes → vertices), and which sibling Texture
// resource each textured mesh imports. Geometry files are referenced FROM
// INSIDE the opaque blob by muID (AptCharacterShape.pRenderUnit), so the
// file list is fixed and muID is read-only; vertices are freely editable
// because the writer recomputes every pointer, count, and the import table.

import type {
	FieldSchema,
	RecordSchema,
	ResourceSchema,
	SchemaRegistry,
} from '../types';
import {
	APT_DATA_STATES,
	APT_MESH_TYPES,
	APT_TEXTURE_MODES,
	APT_TEXTURE_MODE_VECTOR,
	APT_UNTEXTURED_TEXTURE_ID,
} from '@/lib/core/aptData';

// ---------------------------------------------------------------------------
// Local helpers (mirroring staticSoundMap.ts)
// ---------------------------------------------------------------------------

const u32 = (): FieldSchema => ({ kind: 'u32' });
const i32 = (): FieldSchema => ({ kind: 'i32' });
const str = (): FieldSchema => ({ kind: 'string' });
const vec2 = (): FieldSchema => ({ kind: 'vec2' });
const record = (type: string): FieldSchema => ({ kind: 'record', type });
const rawBytes = (): FieldSchema => ({ kind: 'custom', component: 'rawBytes' });

const enumOf = (storage: 'u32' | 'i32', values: readonly { value: number; label: string }[]): FieldSchema => ({
	kind: 'enum',
	storage,
	values: values.map((v) => ({ value: v.value, label: v.label })),
});

// ---------------------------------------------------------------------------
// Tree-label helpers
// ---------------------------------------------------------------------------

function meshLabel(mesh: unknown, index: number): string {
	try {
		if (!mesh || typeof mesh !== 'object') return `#${index}`;
		const m = mesh as { miTextureMode?: number; vertices?: unknown[]; textureResourceId?: bigint | null };
		const mode = APT_TEXTURE_MODES.find((t) => t.value === m.miTextureMode)?.label ?? `mode ${m.miTextureMode}`;
		const tex = m.textureResourceId != null ? ` · tex 0x${m.textureResourceId.toString(16).toUpperCase()}` : '';
		return `#${index} · ${mode} · ${m.vertices?.length ?? '?'} verts${tex}`;
	} catch {
		return `#${index}`;
	}
}

function fileLabel(file: unknown, index: number): string {
	try {
		if (!file || typeof file !== 'object') return `#${index}`;
		const f = file as { muID?: number; meshes?: unknown[] };
		const n = f.meshes?.length ?? 0;
		return `#${index} · shape ${f.muID ?? '?'} · ${n} mesh${n === 1 ? '' : 'es'}`;
	} catch {
		return `#${index}`;
	}
}

function vertexLabel(vert: unknown, index: number): string {
	try {
		if (!vert || typeof vert !== 'object') return `#${index}`;
		const v = vert as { mv2Pos?: { x?: number; y?: number }; mColour?: number };
		const x = v.mv2Pos?.x != null ? v.mv2Pos.x.toFixed(1) : '?';
		const y = v.mv2Pos?.y != null ? v.mv2Pos.y.toFixed(1) : '?';
		const c = v.mColour != null ? v.mColour.toString(16).toUpperCase().padStart(8, '0') : '?';
		return `#${index} · (${x}, ${y}) · #${c}`;
	} catch {
		return `#${index}`;
	}
}

// ---------------------------------------------------------------------------
// Record schemas
// ---------------------------------------------------------------------------

const AptGuiVertex: RecordSchema = {
	name: 'AptGuiVertex',
	description: 'One Basic2dColouredTexturedVertex — 2D screen-space position, packed RGBA8 colour, and UV into the mesh\'s texture page.',
	fields: {
		mv2Pos: vec2(),
		mColour: u32(),
		mv2Tex0UV: vec2(),
	},
	fieldMetadata: {
		mv2Pos: {
			label: 'Position',
			description: '2D position in the movie\'s screen space (pixels; origin at the component anchor).',
		},
		mColour: {
			label: 'Colour',
			description: 'Packed RGBA8 vertex colour (renderengine::RGBA8). 0xFFFFFFFF = untinted.',
		},
		mv2Tex0UV: {
			label: 'UV',
			description: 'Texture coordinates (0..1) into the imported texture page. Unused (0,0) on vector meshes.',
		},
	},
	label: (value, index) => vertexLabel(value, index ?? 0),
};

const AptGuiMesh: RecordSchema = {
	name: 'AptGuiMesh',
	description: 'One GuiGeometryMesh — a primitive batch with a texture binding. Textured meshes own one inline import-table entry pointing at a sibling Texture resource; the writer rebuilds that table from these fields.',
	fields: {
		miMeshType: enumOf('i32', APT_MESH_TYPES),
		miTextureMode: enumOf('i32', APT_TEXTURE_MODES),
		miTextureId: i32(),
		textureResourceId: { kind: 'bigint', bytes: 8, hex: true },
		vertices: {
			kind: 'list',
			item: record('AptGuiVertex'),
			itemLabel: (item, index) => vertexLabel(item, index),
			makeEmpty: () => ({ mv2Pos: { x: 0, y: 0 }, mColour: 0xffffffff, mv2Tex0UV: { x: 0, y: 0 } }),
		},
		_mpTexture: u32(),
	},
	fieldMetadata: {
		miMeshType: {
			label: 'Primitive type',
			description: 'How vertices assemble into primitives. Retail GUIAPT uses triangle lists exclusively.',
		},
		miTextureMode: {
			label: 'Texture mode',
			description: 'Vector (untextured, vertex-colour only) or textured with clamp/wrap addressing. Read-only: toggling it changes whether this mesh owns an import-table entry, which must stay paired with the texture id.',
			readOnly: true,
		},
		miTextureId: {
			label: 'Bitmap character id',
			description: `Bitmap character id in the Apt character library (inside the opaque movie blob) — NOT an import index despite the wiki. ${APT_UNTEXTURED_TEXTURE_ID} on vector meshes.`,
			readOnly: true,
		},
		textureResourceId: {
			label: 'Texture resource',
			description: 'Resource id of the sibling Texture (0x0) this mesh samples, written into the inline BND2 import table. null on vector meshes. Retargeting to another texture id in the same bundle is safe.',
		},
		vertices: {
			label: 'Vertices',
			description: 'Vertex array (0x14 bytes each on disk). Adding/removing is safe — the writer recomputes every pointer, count, and the import table.',
		},
		_mpTexture: {
			label: 'mpTexture cookie',
			description: 'On-disk value of the mpTexture pointer slot the loader patches via the import fixup — a small 1-based page-like cookie, 0 on vector meshes. Preserved verbatim.',
			hidden: true,
		},
	},
	propertyGroups: [
		{ title: 'Mesh', properties: ['miMeshType', 'miTextureMode', 'miTextureId', 'textureResourceId'] },
		{ title: 'Vertices', properties: ['vertices'] },
	],
	label: (value, index) => meshLabel(value, index ?? 0),
};

const AptGuiGeometryFile: RecordSchema = {
	name: 'AptGuiGeometryFile',
	description: 'One GuiGeometryFile — the render geometry for one Apt shape character. AptCharacterShape.pRenderUnit inside the opaque movie blob references this file\'s muID.',
	fields: {
		muID: u32(),
		meshes: {
			kind: 'list',
			item: record('AptGuiMesh'),
			addable: false,
			removable: false,
			itemLabel: (item, index) => meshLabel(item, index),
		},
	},
	fieldMetadata: {
		muID: {
			label: 'Shape id',
			description: 'Render-unit id matched by a shape character inside the opaque Apt movie. Read-only: changing it orphans that shape.',
			readOnly: true,
		},
		meshes: {
			label: 'Meshes',
			description: 'Meshes drawn for this shape. Fixed list — adding one would also require new import-table pairing the movie blob does not know about.',
		},
	},
	label: (value, index) => fileLabel(value, index ?? 0),
};

const ParsedAptData: RecordSchema = {
	name: 'ParsedAptData',
	description: 'Root record for the AptData resource (0x1E): an EA Apt (Flash-derived) UI movie. The movie itself is an opaque verbatim blob; this schema edits the structural layer — names, render geometry, and texture imports.',
	fields: {
		movieName: str(),
		baseName: str(),
		meCurrentState: enumOf('u32', APT_DATA_STATES),
		pMainCharacter: u32(),
		nConstants: i32(),
		muNumberOfTexturePages: u32(),
		geometryFiles: {
			kind: 'list',
			item: record('AptGuiGeometryFile'),
			addable: false,
			removable: false,
			itemLabel: (item, index) => fileLabel(item, index),
		},
		_pad1C: u32(),
		_constTail: rawBytes(),
		_aptData: rawBytes(),
	},
	fieldMetadata: {
		movieName: {
			label: 'Movie name',
			description: 'Component/movie name (mpacMovieName) — matches the resource debug name. Renaming is safe; every section offset is recomputed on write.',
		},
		baseName: {
			label: 'Base component',
			description: 'Component this movie was authored from (e.g. B5BikeIcons\' base is B5CarsIcon). Usually equal to the movie name.',
		},
		meCurrentState: {
			label: 'State',
			description: 'EAptDataState runtime field — always Loading (0) on disk; the game advances it after load.',
			readOnly: true,
		},
		pMainCharacter: {
			label: 'Main character offset',
			description: 'Offset of the main AptCharacterAnimation, relative to the opaque movie blob\'s start. Read-only: it points into bytes steward does not decode.',
			readOnly: true,
		},
		nConstants: {
			label: 'Constant count',
			description: 'AptConstFile entry count — 0 in every retail GUIAPT resource.',
			readOnly: true,
		},
		muNumberOfTexturePages: {
			label: 'Texture pages',
			description: 'Count of sibling texture pages the meshes draw from. Matches the number of distinct imported texture ids in retail.',
			readOnly: true,
		},
		geometryFiles: {
			label: 'Geometry files',
			description: 'Render geometry, one file per Apt shape character. Fixed list — shapes inside the opaque movie blob reference these by id.',
		},
		_pad1C: {
			label: 'pad +0x1C',
			description: 'Header pad (always 0 in retail); preserved verbatim.',
			hidden: true,
		},
		_constTail: {
			label: 'Constant table bytes',
			description: 'Constant entries + name strings after the AptConstFile header — empty in every retail GUIAPT resource. Preserved verbatim.',
			hidden: true,
		},
		_aptData: {
			label: 'Apt movie blob',
			description: 'The verbatim Apt movie: character tree, frames, ActionScript bytecode. Position-independent (internal pointers are section-relative); preserved byte-for-byte.',
			hidden: true,
		},
	},
	propertyGroups: [
		{ title: 'Component', properties: ['movieName', 'baseName', 'meCurrentState'] },
		{ title: 'Movie', properties: ['pMainCharacter', 'nConstants'] },
		{ title: 'Geometry', properties: ['muNumberOfTexturePages', 'geometryFiles'] },
	],
};

// ---------------------------------------------------------------------------
// Registry export
// ---------------------------------------------------------------------------

const registry: SchemaRegistry = {
	ParsedAptData,
	AptGuiGeometryFile,
	AptGuiMesh,
	AptGuiVertex,
};

export const aptDataResourceSchema: ResourceSchema = {
	key: 'aptData',
	name: 'Apt Data',
	rootType: 'ParsedAptData',
	registry,
};
