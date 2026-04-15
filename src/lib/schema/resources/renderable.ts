// Hand-written schema for the Renderable resource family (type 0xC).
//
// Unlike most schemas this one wraps MULTIPLE resources at once. A vehicle
// bundle holds ~100 Renderable records (one per LOD of each mesh group),
// and the schema editor shows all of them — filtered by the current decode
// mode + LOD toggle — in a single tree. Clicking a mesh in 3D or in the
// tree navigates to `renderables[wi].meshes[mi]`.
//
// Renderable is read-only (caps.write = false) so every field is marked
// readOnly. Users can still click fields to see their values; edits would
// not round-trip anyway.
//
// Layout / import notes:
//   - `boundingSphere` is a 4-float TUPLE literal, NOT a {x,y,z,w} object
//     — modeled as a fixed-length primList.
//   - `boundingMatrix` is a Float32Array — the matrix44 field renderer
//     handles typed arrays transparently.
//   - `materialAssemblyId` and `vertexDescriptorIds[i]` are bigint|null;
//     the decoder populates them from the resource entry's import table.
//     The tree inspector shows them as hex; the "Materials & Textures"
//     extension resolves them all the way to texture thumbnails.

import type {
	FieldSchema,
	FieldMetadata,
	RecordSchema,
	ResourceSchema,
	SchemaContext,
	SchemaRegistry,
} from '../types';

// ---------------------------------------------------------------------------
// Local field helpers
// ---------------------------------------------------------------------------

const u8 = (): FieldSchema => ({ kind: 'u8' });
const u16 = (): FieldSchema => ({ kind: 'u16' });
const u32 = (): FieldSchema => ({ kind: 'u32' });
const f32 = (): FieldSchema => ({ kind: 'f32' });
const matrix44 = (): FieldSchema => ({ kind: 'matrix44' });
const record = (type: string): FieldSchema => ({ kind: 'record', type });
const cgsId = (): FieldSchema => ({ kind: 'bigint', bytes: 8, hex: true });

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
	// Renderable is read-only — the schema doesn't offer add/remove on any
	// list. The mesh array is also fixed by the header's meshCount field;
	// editing it would desync vs. body offsets and break the viewer.
	addable: false,
	removable: false,
	itemLabel,
});

// Every primitive field on a Renderable is read-only. Collecting the
// common metadata in one place keeps the per-record field maps readable.
const ro = (description?: string): FieldMetadata => ({
	readOnly: true,
	...(description ? { description } : {}),
});

// ---------------------------------------------------------------------------
// D3D primitive-type enum (subset actually observed in BP renderables)
// ---------------------------------------------------------------------------

const PRIMITIVE_TYPE_VALUES = [
	{ value: 1, label: 'POINTLIST' },
	{ value: 2, label: 'LINELIST' },
	{ value: 3, label: 'LINESTRIP' },
	{ value: 4, label: 'TRIANGLELIST' },
	{ value: 5, label: 'TRIANGLESTRIP' },
	{ value: 6, label: 'TRIANGLEFAN' },
];

// ---------------------------------------------------------------------------
// Tree-label helpers
// ---------------------------------------------------------------------------

// Mesh row: `Mesh {i} · {matIdHex} · {tris} tris`. Fallback to index count
// for non-TRIANGLELIST primitives since "tris" is meaningless there.
function meshLabel(mesh: unknown, index: number): string {
	if (!mesh || typeof mesh !== 'object') return `Mesh ${index}`;
	const m = mesh as {
		numIndices?: number;
		primitiveType?: number;
		materialAssemblyId?: bigint | null;
	};
	const numIndices = m.numIndices ?? 0;
	const tris = m.primitiveType === 4 ? Math.floor(numIndices / 3) : 0;
	const trisLabel = tris > 0 ? `${tris.toLocaleString()} tris` : `${numIndices} idx`;
	const matId = m.materialAssemblyId;
	const matLabel = matId != null
		? `0x${matId.toString(16).toUpperCase().padStart(8, '0')}`
		: '—';
	return `Mesh ${index} · ${matLabel} · ${trisLabel}`;
}

// Renderable row: `{debugName or #i} · {tris} tris · {meshCount} meshes`.
// Debug names come from a parallel `_debugNames` array stored on the
// collection root — labels can't reach the BundleContext, so the page
// stashes debug info on the wrapper before handing it to the provider.
function renderableItemLabel(
	value: unknown,
	index: number,
	ctx: SchemaContext,
): string {
	const root = ctx.root as {
		_debugNames?: (string | null)[];
		_triCounts?: number[];
	} | null;
	const meshes = (value as { meshes?: { numIndices: number; primitiveType: number }[] } | null)?.meshes;
	let tris = root?._triCounts?.[index];
	if (tris == null && meshes) {
		tris = 0;
		for (const m of meshes) {
			if (m.primitiveType === 4) tris += Math.floor(m.numIndices / 3);
		}
	}
	const meshCount = meshes?.length ?? 0;
	const name = root?._debugNames?.[index];
	const prefix = name ?? `#${index}`;
	const trisStr = tris != null ? `${tris.toLocaleString()} tris` : `${meshCount * 3} idx`;
	return `${prefix} · ${meshCount} mesh${meshCount === 1 ? '' : 'es'} · ${trisStr}`;
}

function collectionSummary(value: unknown): string {
	const v = value as { renderables?: unknown[]; _triCounts?: number[] } | null;
	const count = v?.renderables?.length ?? 0;
	const totalTris = v?._triCounts?.reduce((a, b) => a + b, 0) ?? 0;
	return `${count} renderable${count === 1 ? '' : 's'} · ${totalTris.toLocaleString()} tris`;
}

// ---------------------------------------------------------------------------
// Record schemas
// ---------------------------------------------------------------------------

const RenderableHeader: RecordSchema = {
	name: 'RenderableHeader',
	description: 'Top-of-resource header (0x30 bytes). Carries the bounding sphere, mesh count, and offsets to the index/vertex buffer descriptors.',
	fields: {
		boundingSphere: fixedList(f32(), 4),
		version: u16(),
		meshCount: u16(),
		mppMeshes: u32(),
		flagsAndPadding: u32(),
		indexBufferPtr: u32(),
		vertexBufferPtr: u32(),
	},
	fieldMetadata: {
		boundingSphere: { ...ro('Four floats: center X, Y, Z and radius. Computed at build time from the mesh AABBs.'), label: 'Bounding sphere' },
		version: ro('Format version. = 11 for PC Burnout Paradise.'),
		meshCount: ro('Mirrors meshes.length.'),
		mppMeshes: ro('Offset within the header block where the mesh-offset array lives. Parser-internal.'),
		flagsAndPadding: ro('Opaque u32 at header+0x1C. Always zero in samples but preserved verbatim.'),
		indexBufferPtr: ro('Offset to the IndexBufferDescriptor struct within the header block. Parser-internal.'),
		vertexBufferPtr: ro('Offset to the VertexBufferDescriptor struct within the header block. Parser-internal.'),
	},
};

const IndexBufferDescriptor: RecordSchema = {
	name: 'IndexBufferDescriptor',
	description: 'Points into the body block where the shared u16 index buffer lives.',
	fields: {
		bodyOffset: u32(),
		byteLength: u32(),
		indexStride: u32(),
	},
	fieldMetadata: {
		bodyOffset: ro('Byte offset into the body block where the first index starts.'),
		byteLength: ro('Total bytes of index data in the body block.'),
		indexStride: ro('Bytes per index entry. = 2 (u16) on PC Burnout Paradise.'),
	},
};

const VertexBufferDescriptor: RecordSchema = {
	name: 'VertexBufferDescriptor',
	description: 'Points into the body block where the shared vertex buffer lives. Stride is NOT stored here — it comes from the VertexDescriptor resource.',
	fields: {
		bodyOffset: u32(),
		byteLength: u32(),
	},
	fieldMetadata: {
		bodyOffset: ro('Byte offset into the body block where the first vertex starts.'),
		byteLength: ro('Total bytes of vertex data in the body block.'),
	},
};

const RenderableMesh: RecordSchema = {
	name: 'RenderableMesh',
	description: 'One draw call. Carries the OBB transform, D3D draw parameters, and imported material + vertex descriptor references.',
	fields: {
		boundingMatrix: matrix44(),
		primitiveType: { kind: 'enum', storage: 'u32', values: PRIMITIVE_TYPE_VALUES },
		baseVertexIndex: u32(),
		startIndex: u32(),
		numIndices: u32(),
		numVertexDescriptors: u8(),
		instanceCount: u8(),
		numVertexBuffers: u8(),
		meshFlags: u8(),
		materialAssemblyId: cgsId(),
		vertexDescriptorIds: fixedList(cgsId(), 6),
	},
	fieldMetadata: {
		boundingMatrix: {
			...ro('Confirmed to be an oriented bounding box descriptor, not a per-mesh transform. Stored column-major per OpenTK Matrix4 order. See docs/Renderable_findings.md §5.1.'),
			label: 'Bounding matrix (OBB)',
		},
		primitiveType: ro('D3DPRIMITIVETYPE. Only TRIANGLELIST (4) is rendered by the steward viewer.'),
		baseVertexIndex: ro('Added to every index before fetching the vertex. Usually 0 for BP renderables.'),
		startIndex: ro('First index in the shared u16 index buffer that belongs to this mesh (in u16 units, not bytes).'),
		numIndices: ro('Number of u16 indices in this mesh. TRIANGLELIST uses 3 per triangle.'),
		numVertexDescriptors: ro('1..6. The viewer picks the descriptor with the most attributes.'),
		instanceCount: ro('D3D instance count. Always 1 in vanilla BP assets.'),
		numVertexBuffers: ro('Number of bound vertex buffers. Always 1 in vanilla BP assets.'),
		meshFlags: ro('Opaque per-mesh flag byte. Bit semantics not yet reversed.'),
		materialAssemblyId: {
			...ro('CgsID of the material assembly this mesh draws with. Resolved from the header block\'s import table.'),
			label: 'Material assembly',
		},
		vertexDescriptorIds: {
			...ro('Six CgsID slots for vertex descriptors. The first numVertexDescriptors entries are usually populated; the rest are padding.'),
			label: 'Vertex descriptor slots',
		},
	},
	propertyGroups: [
		{ title: 'Draw', properties: ['primitiveType', 'baseVertexIndex', 'startIndex', 'numIndices', 'instanceCount'] },
		{ title: 'Imports', properties: ['materialAssemblyId', 'vertexDescriptorIds', 'numVertexDescriptors', 'numVertexBuffers'] },
		{ title: 'Bounds', properties: ['boundingMatrix'] },
		{ title: 'Flags', properties: ['meshFlags'] },
		// Rich per-mesh material + texture card extracted from the old
		// RenderablePage's PartInfoPanel. Renders thumbs + shader + VD
		// layout + OBB dump.
		{ title: 'Material', component: 'RenderableMeshCard' },
	],
	label: (value, index) => meshLabel(value, index ?? 0),
};

const ParsedRenderable: RecordSchema = {
	name: 'ParsedRenderable',
	description: 'One Renderable resource (0xC). Holds a shared index/vertex buffer pair plus N draw-call meshes that slice it.',
	fields: {
		header: record('RenderableHeader'),
		indexBuffer: record('IndexBufferDescriptor'),
		vertexBuffer: record('VertexBufferDescriptor'),
		meshes: recordList('RenderableMesh', meshLabel),
	},
	fieldMetadata: {
		header: { ...ro('Format header read from the first 0x30 bytes of the resource.'), label: 'Header' },
		indexBuffer: { ...ro(), label: 'Index buffer' },
		vertexBuffer: { ...ro(), label: 'Vertex buffer' },
		meshes: { ...ro(), label: 'Meshes' },
	},
	propertyGroups: [
		{ title: 'Overview', properties: ['header', 'indexBuffer', 'vertexBuffer'] },
		{ title: 'Meshes', properties: ['meshes'] },
		// All textures + shader info resolved for every mesh in this
		// renderable at once. Cheaper than drilling into each mesh when
		// the user just wants to see "which textures does this part use".
		{ title: 'Materials & Textures', component: 'RenderableCard' },
	],
	label: (value, index) => renderableItemLabel(value, index ?? 0, { root: value, resource: { key: '', name: '', rootType: '', registry: {} } }),
};

// Hidden RenderableItemMeta record — kept declared so the walker doesn't
// flag `_debugNames` / `_triCounts` as unknown fields. Uses primitive list
// items so the walker iterates them as leaves (no nested records).

const RenderableCollection: RecordSchema = {
	name: 'RenderableCollection',
	description: 'All decoded Renderable resources in the current bundle, filtered by the 3D viewport\'s decode mode + LOD toggle. Tree order matches 3D render order so clicks line up.',
	fields: {
		renderables: recordList('ParsedRenderable', renderableItemLabel),
		_debugNames: { kind: 'list', item: { kind: 'string' }, addable: false, removable: false },
		_triCounts: { kind: 'list', item: u32(), addable: false, removable: false },
	},
	fieldMetadata: {
		renderables: { label: 'Renderables' },
		_debugNames: {
			hidden: true,
			readOnly: true,
			description: 'Parallel to `renderables`. Debug-resolved names used by tree labels. Not rendered.',
		},
		_triCounts: {
			hidden: true,
			readOnly: true,
			description: 'Parallel to `renderables`. Pre-computed triangle counts used by tree labels.',
		},
	},
	propertyGroups: [
		{ title: 'Renderables', properties: ['renderables'] },
	],
	label: (value) => collectionSummary(value),
};

// ---------------------------------------------------------------------------
// Registry + resource
// ---------------------------------------------------------------------------

const registry: SchemaRegistry = {
	RenderableCollection,
	ParsedRenderable,
	RenderableHeader,
	IndexBufferDescriptor,
	VertexBufferDescriptor,
	RenderableMesh,
};

export const renderableResourceSchema: ResourceSchema = {
	key: 'renderable',
	name: 'Renderable',
	rootType: 'RenderableCollection',
	registry,
};
