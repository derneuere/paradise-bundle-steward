// Hand-written schema for ParsedVFXMeshCollection (resource type 0x10019).
//
// Mirrors the types in `src/lib/core/vfxMeshCollection.ts`. Keep these in
// lockstep with the parser/writer — any field added to the parser needs a
// matching entry here, or the schema walker reports it as drift.
//
// Domain: a bag of crash-debris particle meshes. The editable surface is the
// 32-slot radius table (slots cycle with the collection's mesh count — 13/8/3
// in retail — so edit a whole cycle, not one slot) and the texture name the
// debris is drawn with. The buffer descriptors point into the resource's
// secondary-memory geometry block, which steward does not rewrite — they are
// read-only because a wrong offset/length makes the runtime read garbage
// vertices.

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
const u32 = (): FieldSchema => ({ kind: 'u32' });
const str = (): FieldSchema => ({ kind: 'string' });
const record = (type: string): FieldSchema => ({ kind: 'record', type });
const rawBytes = (): FieldSchema => ({ kind: 'custom', component: 'rawBytes' });

const fixedRecordList = (
	type: string,
	itemLabel: (item: unknown, index: number) => string,
): FieldSchema => ({
	kind: 'list',
	item: record(type),
	addable: false,
	removable: false,
	itemLabel,
});

function bufferLabel(item: unknown, index: number): string {
	try {
		if (!item || typeof item !== 'object') return `#${index}`;
		const b = item as { muBufferKind?: number; muByteLength?: number; muBodyOffset?: number };
		const kind = b.muBufferKind === 3 ? 'index' : b.muBufferKind === 2 ? 'vertex' : `kind ${b.muBufferKind}`;
		return `#${index} · ${kind} · ${b.muByteLength ?? '?'} B @ ${b.muBodyOffset ?? '?'}`;
	} catch {
		return `#${index}`;
	}
}

// ---------------------------------------------------------------------------
// Record schemas
// ---------------------------------------------------------------------------

const VFXBufferDescriptor: RecordSchema = {
	name: 'VFXBufferDescriptor',
	description: 'Slice of the resource\'s secondary-memory geometry block — the same 24-byte descriptor struct Renderable uses. Steward never rewrites the geometry block, so these stay read-only.',
	fields: {
		muBufferKind: u32(),
		muBodyOffset: u32(),
		muByteLength: u32(),
		muStride: u32(),
		_pad0: u32(),
		_unk4: u32(),
	},
	fieldMetadata: {
		muBufferKind: {
			label: 'Buffer kind',
			description: '3 = index buffer, 2 = vertex buffer in every retail descriptor.',
			readOnly: true,
		},
		muBodyOffset: {
			label: 'Body offset',
			description: 'Byte offset into the secondary-memory block where this buffer\'s data starts.',
			readOnly: true,
		},
		muByteLength: {
			label: 'Byte length',
			description: 'Total bytes of buffer data (16-byte aligned for index buffers).',
			readOnly: true,
		},
		muStride: {
			label: 'Stride',
			description: 'Bytes per element — 2 (u16) for index buffers; 0 for vertex buffers (the real vertex stride is 36, byteLength / vertex count).',
			readOnly: true,
		},
		_pad0: {
			label: 'pad +0x00',
			description: 'Runtime GPU handle slot (0 on disk); preserved verbatim.',
			hidden: true,
		},
		_unk4: {
			label: 'unknown +0x04',
			description: 'Uninitialised build-tool heap garbage; preserved verbatim for byte-exact round-trip.',
			hidden: true,
		},
	},
	label: (value, index) => bufferLabel(value, index ?? 0),
};

const ParsedVFXMeshCollection: RecordSchema = {
	name: 'ParsedVFXMeshCollection',
	description: 'Root record for the VFXMeshCollection resource (0x10019): crash-debris particle meshes plus the texture they are drawn with. Geometry lives in the resource\'s secondary-memory block and is not editable here.',
	fields: {
		muVersion: u32(),
		mafRadius: {
			kind: 'list',
			item: f32(),
			addable: false,
			removable: false,
			minLength: 32,
			maxLength: 32,
			displayAs: 'grid',
			gridCols: 4,
		},
		muNumIndices: u32(),
		muNumVertices: u32(),
		textureName: str(),
		indexBuffers: fixedRecordList('VFXBufferDescriptor', bufferLabel),
		vertexBuffers: fixedRecordList('VFXBufferDescriptor', bufferLabel),
		_trailingPad: rawBytes(),
	},
	fieldMetadata: {
		muVersion: {
			label: 'Version',
			description: 'Format version — always 2 in retail; the parser rejects anything else.',
			readOnly: true,
		},
		mafRadius: {
			label: 'Mesh radii',
			description: 'Fixed 32-slot table of per-mesh bounding radii in metres. Slots repeat with period = the collection\'s mesh count (13 highres / 8 lowres / 3 glass in retail) so any 5-bit index lands on a valid radius — keep the cycle consistent when editing.',
		},
		muNumIndices: {
			label: 'Index count',
			description: 'Total u16 indices in the secondary-memory geometry block. Describes data steward does not rewrite.',
			readOnly: true,
		},
		muNumVertices: {
			label: 'Vertex count',
			description: 'Total vertices in the secondary-memory geometry block (stride 36 bytes).',
			readOnly: true,
		},
		textureName: {
			label: 'Texture name',
			description: 'Material texture the debris is drawn with, referenced by NAME (no BND2 import). Renaming is safe — the writer recomputes the variable-length layout.',
		},
		indexBuffers: {
			label: 'Index buffers',
			description: 'Descriptors into the geometry block (retail: exactly one). Index data sits at the start of the block.',
		},
		vertexBuffers: {
			label: 'Vertex buffers',
			description: 'Descriptors into the geometry block (retail: exactly one, immediately after the index data).',
		},
		_trailingPad: {
			label: 'Trailing pad',
			description: 'Zero bytes padding the resource to its stored size (not a simple align16 — retail pads 20–28 bytes). Re-emitted verbatim.',
			hidden: true,
		},
	},
	propertyGroups: [
		{ title: 'Material', properties: ['textureName', 'mafRadius'] },
		{ title: 'Geometry', properties: ['muNumIndices', 'muNumVertices', 'indexBuffers', 'vertexBuffers'] },
		{ title: 'Format', properties: ['muVersion'] },
	],
};

// ---------------------------------------------------------------------------
// Registry export
// ---------------------------------------------------------------------------

const registry: SchemaRegistry = {
	ParsedVFXMeshCollection,
	VFXBufferDescriptor,
};

export const vfxMeshCollectionResourceSchema: ResourceSchema = {
	key: 'vfxMeshCollection',
	name: 'VFX Mesh Collection',
	rootType: 'ParsedVFXMeshCollection',
	registry,
};
