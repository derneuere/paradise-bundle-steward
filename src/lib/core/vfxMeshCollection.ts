// VFXMeshCollection parser and writer (resource type 0x10019,
// BrnParticle::VFXMeshCollection).
//
// A VFXMeshCollection is a bag of small particle meshes (debris chunks, glass
// shards) the VFX system spawns during crashes. PARTICLES.BUNDLE ships three:
// highres_debris_02.rf3, lowres_debris.rf3 and Glass_debris.rf3. NOTE: the
// burnout.wiki page (and steward's coverage doc) list the type id as 0x100019 —
// the retail PC id is 0x10019.
//
// The resource is split across two memory blocks: this parser handles block 0
// (the main-memory header, what extractResourceRaw returns); block 1 (secondary
// memory) holds the raw index/vertex data that the buffer descriptors below
// point into via bodyOffset/byteLength — exactly the Renderable split (see
// renderable.ts). There is NO inline BND2 import table (importCount is 0 on
// all three retail resources): the material reference is a plain texture NAME
// string, not a resource import.
//
// mafRadius is a fixed 32-slot table of per-mesh bounding radii. The slots
// cycle with period = the number of meshes in the collection (13 / 8 / 3 in
// retail): the build tool filled slot i with radius(mesh i % numMeshes), so
// the runtime can index it with any 5-bit value.
//
// On-disk layout (32-bit PC LE; all pointers are file-relative offsets fixed
// up at load):
//   0x00 muVersion (2) · 0x04 mafRadius f32[32] · 0x84 mpMeshHelper ·
//   0x88 muNumIndices · 0x8C muNumVertices · 0x90 mMaterial.mpTextureName
//   0x94 texture name (NUL-terminated, zero-padded to 4-byte alignment)
//   then renderengine::MeshHelper { numIndexBuffers, numVertexBuffers,
//   ptr[numIB+numVB] } followed by the 0x18-byte buffer descriptor structs in
//   pointer order (index buffers first, then vertex buffers), then zero pad to
//   the stored resource size.
//
// Buffer descriptor (24 bytes — same struct Renderable uses, see
// parseIndexBufferDescriptor in renderable.ts): +0x00 observed 0, +0x04
// uninitialised build-tool heap garbage (preserved verbatim), +0x08 buffer
// kind (3 = index, 2 = vertex in every retail descriptor), +0x0C bodyOffset
// into block 1, +0x10 byteLength, +0x14 stride (2 for u16 indices; 0 for
// vertex buffers — the real vertex stride is 36, derivable from
// byteLength / muNumVertices, but not stored).
//
// Round-trip strategy: mpMeshHelper, mpTextureName and the buffer pointer
// array are recomputed from the texture-name length and buffer counts on
// write (the parser asserts the stored values match, throwing rather than
// mis-parsing); the trailing zero pad is captured verbatim to reproduce the
// exact resource length (it is NOT a simple align16 — retail pads 20–28
// bytes).

import { BinReader, BinWriter } from './binTools';

// =============================================================================
// Types
// =============================================================================

export const VFX_MESH_COLLECTION_TYPE_ID = 0x10019;

/** Number of slots in the fixed radius table. */
export const VFX_RADIUS_SLOTS = 32;

export type VFXBufferDescriptor = {
	/** 3 = index buffer, 2 = vertex buffer in every retail descriptor. */
	muBufferKind: number; // u32
	/** Byte offset into the resource's secondary-memory body block. */
	muBodyOffset: number; // u32
	/** Total bytes of buffer data in the body block. */
	muByteLength: number; // u32
	/** Bytes per element — 2 (u16) for index buffers, 0 for vertex buffers. */
	muStride: number; // u32
	/** +0x00 — runtime GPU handle slot, observed 0. Preserved verbatim. */
	_pad0: number; // u32
	/** +0x04 — uninitialised build-tool heap garbage. Preserved verbatim. */
	_unk4: number; // u32
};

export type ParsedVFXMeshCollection = {
	/** Always 2 in retail. */
	muVersion: number;
	/** Fixed 32-slot per-mesh bounding radius table (cycles with mesh count). */
	mafRadius: number[]; // f32[32]
	/** Total u16 indices across the collection's meshes (block-1 geometry). */
	muNumIndices: number;
	/** Total vertices across the collection's meshes (block-1 geometry). */
	muNumVertices: number;
	/** mMaterial.mpTextureName target — the texture the debris is drawn with. */
	textureName: string;
	/** Index-buffer descriptors (retail: exactly one). */
	indexBuffers: VFXBufferDescriptor[];
	/** Vertex-buffer descriptors (retail: exactly one). */
	vertexBuffers: VFXBufferDescriptor[];
	/** Zero bytes from the last descriptor to the stored resource size. */
	_trailingPad: Uint8Array;
};

// =============================================================================
// Constants
// =============================================================================

const HEADER_SIZE = 0x94;
const TEXTURE_NAME_OFFSET = HEADER_SIZE;
const DESCRIPTOR_SIZE = 0x18;

const align4 = (x: number): number => (x + 3) & ~3;

// =============================================================================
// Reader
// =============================================================================

export function parseVFXMeshCollection(raw: Uint8Array, littleEndian = true): ParsedVFXMeshCollection {
	// Copy up front — raw can be a Node Buffer view over a shared pool, and the
	// trailing pad below must stay stable after extraction.
	const bytes = new Uint8Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
	const r = new BinReader(bytes.buffer, littleEndian);

	const muVersion = r.readU32();
	if (muVersion !== 2) {
		throw new Error(`VFXMeshCollection: muVersion is ${muVersion}, expected 2`);
	}
	const mafRadius: number[] = [];
	for (let i = 0; i < VFX_RADIUS_SLOTS; i++) mafRadius.push(r.readF32());
	const mpMeshHelper = r.readU32();
	const muNumIndices = r.readU32();
	const muNumVertices = r.readU32();
	const mpTextureName = r.readU32();

	// The layout is rigid; bail loudly on violations rather than silently
	// producing a model that won't round-trip.
	if (mpTextureName !== TEXTURE_NAME_OFFSET) {
		throw new Error(`VFXMeshCollection: mpTextureName is 0x${mpTextureName.toString(16)}, expected 0x${TEXTURE_NAME_OFFSET.toString(16)} (rigid layout)`);
	}
	const nameEnd = bytes.indexOf(0, TEXTURE_NAME_OFFSET);
	if (nameEnd < 0 || nameEnd >= mpMeshHelper) {
		throw new Error('VFXMeshCollection: texture name is not NUL-terminated before mpMeshHelper');
	}
	const textureName = new TextDecoder().decode(bytes.subarray(TEXTURE_NAME_OFFSET, nameEnd));
	if (mpMeshHelper !== align4(nameEnd + 1)) {
		throw new Error(`VFXMeshCollection: mpMeshHelper is 0x${mpMeshHelper.toString(16)}, expected 0x${align4(nameEnd + 1).toString(16)} for a ${textureName.length}-char texture name`);
	}
	for (let i = nameEnd; i < mpMeshHelper; i++) {
		if (bytes[i] !== 0) throw new Error(`VFXMeshCollection: non-zero texture-name pad byte at 0x${i.toString(16)}`);
	}

	// --- MeshHelper: counts, pointer array, then descriptors in pointer order ---
	r.position = mpMeshHelper;
	const numIndexBuffers = r.readU32();
	const numVertexBuffers = r.readU32();
	const numBuffers = numIndexBuffers + numVertexBuffers;
	const descBase = mpMeshHelper + 8 + numBuffers * 4;
	for (let i = 0; i < numBuffers; i++) {
		const ptr = r.readU32();
		const expected = descBase + i * DESCRIPTOR_SIZE;
		if (ptr !== expected) {
			throw new Error(`VFXMeshCollection: buffer pointer ${i} is 0x${ptr.toString(16)}, expected 0x${expected.toString(16)} (rigid layout)`);
		}
	}
	const readDescriptor = (): VFXBufferDescriptor => {
		const _pad0 = r.readU32();
		const _unk4 = r.readU32();
		const muBufferKind = r.readU32();
		const muBodyOffset = r.readU32();
		const muByteLength = r.readU32();
		const muStride = r.readU32();
		return { muBufferKind, muBodyOffset, muByteLength, muStride, _pad0, _unk4 };
	};
	const indexBuffers: VFXBufferDescriptor[] = [];
	for (let i = 0; i < numIndexBuffers; i++) indexBuffers.push(readDescriptor());
	const vertexBuffers: VFXBufferDescriptor[] = [];
	for (let i = 0; i < numVertexBuffers; i++) vertexBuffers.push(readDescriptor());

	const descEnd = descBase + numBuffers * DESCRIPTOR_SIZE;
	if (descEnd > bytes.byteLength) {
		throw new Error(`VFXMeshCollection: ${numBuffers} buffer descriptors overrun the ${bytes.byteLength}-byte resource`);
	}
	const _trailingPad = new Uint8Array(bytes.subarray(descEnd));

	return {
		muVersion,
		mafRadius,
		muNumIndices,
		muNumVertices,
		textureName,
		indexBuffers,
		vertexBuffers,
		_trailingPad,
	};
}

// =============================================================================
// Writer
// =============================================================================

export function writeVFXMeshCollection(model: ParsedVFXMeshCollection, littleEndian = true): Uint8Array {
	if (model.mafRadius.length !== VFX_RADIUS_SLOTS) {
		throw new Error(`VFXMeshCollection writer: mafRadius has ${model.mafRadius.length} slots, must be exactly ${VFX_RADIUS_SLOTS}`);
	}
	const nameBytes = new TextEncoder().encode(model.textureName);
	if (nameBytes.includes(0)) {
		throw new Error('VFXMeshCollection writer: texture name must not contain NUL bytes');
	}

	// Pointers recomputed from the name length and buffer counts, never stored.
	const mpMeshHelper = align4(TEXTURE_NAME_OFFSET + nameBytes.length + 1);
	const numBuffers = model.indexBuffers.length + model.vertexBuffers.length;
	const descBase = mpMeshHelper + 8 + numBuffers * 4;
	const descEnd = descBase + numBuffers * DESCRIPTOR_SIZE;

	const w = new BinWriter(descEnd + model._trailingPad.byteLength, littleEndian);
	w.writeU32(model.muVersion);
	for (const radius of model.mafRadius) w.writeF32(radius);
	w.writeU32(mpMeshHelper);
	w.writeU32(model.muNumIndices);
	w.writeU32(model.muNumVertices);
	w.writeU32(TEXTURE_NAME_OFFSET);
	if (w.offset !== HEADER_SIZE) throw new Error(`VFXMeshCollection writer: header offset mismatch ${w.offset} vs ${HEADER_SIZE}`);

	w.writeBytes(nameBytes);
	w.writeZeroes(mpMeshHelper - (TEXTURE_NAME_OFFSET + nameBytes.length));

	w.writeU32(model.indexBuffers.length);
	w.writeU32(model.vertexBuffers.length);
	for (let i = 0; i < numBuffers; i++) w.writeU32(descBase + i * DESCRIPTOR_SIZE);
	for (const d of [...model.indexBuffers, ...model.vertexBuffers]) {
		w.writeU32(d._pad0);
		w.writeU32(d._unk4);
		w.writeU32(d.muBufferKind);
		w.writeU32(d.muBodyOffset);
		w.writeU32(d.muByteLength);
		w.writeU32(d.muStride);
	}
	if (w.offset !== descEnd) throw new Error(`VFXMeshCollection writer: descriptor offset mismatch ${w.offset} vs ${descEnd}`);

	if (model._trailingPad.byteLength > 0) w.writeBytes(model._trailingPad);
	return w.bytes;
}
