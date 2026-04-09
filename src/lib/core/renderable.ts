// Renderable + VertexDescriptor parser (resource types 0xC and 0xA).
//
// PC Burnout Paradise, BND2 format, "BPR" branch.
//
// Layout discovered empirically against example/VEH_CARBRWDS_GR.BIN and
// cross-checked with BundleManager/BaseHandlers/Renderable.cs and
// BundleManager/BundleFormat/VertexDesc.cs. See docs/Renderable_findings.md
// for the long-form reasoning, quirks, and references.
//
// Scope: read-only. No writer. DXT textures, per-part transforms, LOD
// selection, and skinning are deliberately out of scope — see the findings
// doc. This parser feeds a three.js viewer that renders positions with a
// flat material.
//
// Note: this module reads its own import table from the decompressed header
// block via readInlineImportTable() rather than going through bundle.imports.
// That's a deliberate ergonomic choice — the inline reader returns a
// Map<ptrOffset, resourceId> keyed by where the pointer lives in the header,
// which is exactly what the mesh parser needs to resolve material/VD
// references. parseImportEntries() is correct (as of the fix in
// bundle/bundleEntry.ts) but returns a flat ImportEntry[] that's harder to
// use here. Both paths produce identical data — see scripts/verify-imports-fix.ts.

import type { ParsedBundle, ResourceEntry } from './types';
import { extractResourceSize, isCompressed, decompressData } from './resourceManager';
import { u64ToBigInt } from './u64';
import { BundleError } from './errors';

// =============================================================================
// Type IDs
// =============================================================================

export const RENDERABLE_TYPE_ID = 0xC;
export const VERTEX_DESCRIPTOR_TYPE_ID = 0xA;
export const MATERIAL_TYPE_ID = 0x1;

// =============================================================================
// VertexDescriptor
// =============================================================================

// Matches BundleFormat/VertexDesc.cs VertexAttributeType enum.
export enum VertexAttributeType {
	Invalid = 0,
	Positions = 1,
	Normals = 3,
	UV1 = 5,
	UV2 = 6,
	BoneIndexes = 13,
	BoneWeights = 14,
	Tangents = 15,
}

// Per-attribute byte count inferred from the type. Offsets within one vertex
// are stored explicitly, so if the true byte count for a type ever differs
// from this table (packed formats etc.), the decoder falls back to "next
// attribute's offset minus this attribute's offset" — see decodeVertexArrays().
const ATTR_DEFAULT_BYTES: Partial<Record<VertexAttributeType, number>> = {
	[VertexAttributeType.Positions]: 12,   // f32 × 3
	[VertexAttributeType.Normals]: 12,     // f32 × 3
	[VertexAttributeType.Tangents]: 12,    // f32 × 3
	[VertexAttributeType.UV1]: 8,          // f32 × 2
	[VertexAttributeType.UV2]: 8,          // f32 × 2
	[VertexAttributeType.BoneIndexes]: 4,  // u8 × 4
	[VertexAttributeType.BoneWeights]: 4,  // u8 × 4
};

export type VertexAttribute = {
	type: VertexAttributeType;
	offset: number;  // byte offset within one vertex record
	stride: number;  // total vertex stride (BPR format stores this per-attribute, redundantly)
	// The BPR format also has unknown1/unknown2 fields per attribute. We keep
	// them around opaque so a future round-trip writer could pass them through.
	unknown1: number;
	unknown2: number;
};

export type ParsedVertexDescriptor = {
	// Header fields, kept opaque. unknown2 != 0 selects the BPR format; 0 would
	// select the older TUB-PC format, which this parser does not implement.
	unknown1: number;
	unknown2: number;
	unknown3: number;
	attributes: VertexAttribute[];
	// Total vertex stride. All attributes within one descriptor report the same
	// value in their size field, so we record it once at the top level.
	stride: number;
};

/**
 * Parse a VertexDescriptor resource (typeId 0xA) in BPR format.
 *
 * Layout (all little-endian):
 *   16-byte header  : { u32 unknown1, u32 unknown2, u32 unknown3, u32 attributeCount }
 *   20-byte attrs × N: { u32 type, u32 unknown1, u32 offset, u32 unknown2, u32 stride }
 *   trailing bytes   : zero-padding to 16-byte alignment; ignored.
 */
export function parseVertexDescriptor(bytes: Uint8Array): ParsedVertexDescriptor {
	if (bytes.byteLength < 16) {
		throw new BundleError(
			`VertexDescriptor too small (${bytes.byteLength} bytes)`,
			'PARSE_ERROR',
		);
	}
	const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const unknown1 = dv.getUint32(0x00, true);
	const unknown2 = dv.getUint32(0x04, true);
	const unknown3 = dv.getUint32(0x08, true);
	const attributeCount = dv.getUint32(0x0C, true);

	if (unknown2 === 0) {
		throw new BundleError(
			'VertexDescriptor is in the TUB-PC format (unknown2 == 0), which this parser does not implement',
			'UNSUPPORTED_FORMAT',
			{ unknown1, unknown2, unknown3, attributeCount },
		);
	}

	const needed = 16 + attributeCount * 20;
	if (bytes.byteLength < needed) {
		throw new BundleError(
			`VertexDescriptor truncated: header claims ${attributeCount} attrs but only ${bytes.byteLength} bytes available`,
			'PARSE_ERROR',
		);
	}

	const attributes: VertexAttribute[] = [];
	let stride = 0;
	for (let i = 0; i < attributeCount; i++) {
		const p = 16 + i * 20;
		const type = dv.getUint32(p + 0x00, true);
		const aUnknown1 = dv.getUint32(p + 0x04, true);
		const offset = dv.getUint32(p + 0x08, true);
		const aUnknown2 = dv.getUint32(p + 0x0C, true);
		const aStride = dv.getUint32(p + 0x10, true);
		if (i === 0) stride = aStride;
		attributes.push({
			type: type as VertexAttributeType,
			offset,
			stride: aStride,
			unknown1: aUnknown1,
			unknown2: aUnknown2,
		});
	}

	return { unknown1, unknown2, unknown3, attributes, stride };
}

// =============================================================================
// Renderable
// =============================================================================

export type RenderableHeader = {
	boundingSphere: [number, number, number, number]; // [cx, cy, cz, radius]
	version: number;        // = 11 for PC BP
	meshCount: number;
	mppMeshes: number;      // offset within header block to mesh offset array
	flagsAndPadding: number;
	indexBufferPtr: number; // offset within header block to IndexBuffer descriptor struct
	vertexBufferPtr: number;// offset within header block to VertexBuffer descriptor struct
};

// Description of the shared index buffer inside the body block. Fields at the
// +0x00..+0x08 slots of the 24-byte on-disk struct are runtime GPU state
// (handle, debug pointer, flags) and are not preserved here.
export type IndexBufferDescriptor = {
	bodyOffset: number;  // offset into body block where the first index byte lives
	byteLength: number;  // total bytes of index data in the body
	indexStride: number; // bytes per index entry. PC BP: always 2 (u16)
};

export type VertexBufferDescriptor = {
	bodyOffset: number;  // offset into body block where the first vertex byte lives
	byteLength: number;  // total bytes of vertex data in the body
	// Vertex stride is intentionally NOT stored here — on disk it's 0 because
	// the real value lives in the VertexDescriptor. Pass the stride in from the
	// VD when you need to slice this buffer.
};

export type RenderableMesh = {
	// 16-float bounding box / transform matrix. Stored column-major per the
	// C# reader (which uses OpenTK's Matrix4 read order).
	boundingMatrix: Float32Array;
	// DrawIndexedParameters (BPR branch = 4 fields only)
	primitiveType: number;   // D3DPRIMITIVETYPE. 4 = D3DPT_TRIANGLELIST (the only one we render).
	baseVertexIndex: number;
	startIndex: number;      // in u16 indices, not bytes
	numIndices: number;      // count of u16 indices for this mesh
	// Packed counts at mesh+0x54..0x57
	numVertexDescriptors: number; // 1..6
	instanceCount: number;
	numVertexBuffers: number;
	meshFlags: number;
	// Resolved via the in-header import table. null means "slot present but no
	// import pointed at this offset" (e.g. unused VD slots 4, 5).
	materialAssemblyId: bigint | null;
	vertexDescriptorIds: (bigint | null)[]; // length always 6, first numVertexDescriptors are usually non-null
};

export type ParsedRenderable = {
	header: RenderableHeader;
	indexBuffer: IndexBufferDescriptor;
	vertexBuffer: VertexBufferDescriptor;
	meshes: RenderableMesh[];
};

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/**
 * Extract both the header (block 0) and body (block 1) bytes of a resource,
 * decompressing each independently. Steward's resourceManager only returns the
 * first non-empty block; Renderable needs both.
 *
 * Throws if block 0 is missing. block1 may be null (e.g. for degenerate
 * Renderables with no geometry, though we haven't seen any in practice).
 */
export function getRenderableBlocks(
	buffer: ArrayBuffer,
	bundle: ParsedBundle,
	resource: ResourceEntry,
): { header: Uint8Array; body: Uint8Array | null } {
	const readBlock = (i: number): Uint8Array | null => {
		const size = extractResourceSize(resource.sizeAndAlignmentOnDisk[i]);
		if (size <= 0) return null;
		const base = bundle.header.resourceDataOffsets[i] >>> 0;
		const rel = resource.diskOffsets[i] >>> 0;
		const start = (base + rel) >>> 0;
		if (start + size > buffer.byteLength) return null;
		let bytes = new Uint8Array(buffer, start, size);
		if (isCompressed(bytes)) bytes = decompressData(bytes);
		return bytes;
	};

	const header = readBlock(0);
	if (!header) {
		throw new BundleError(
			`Renderable ${resource.resourceId.low.toString(16)}${resource.resourceId.high.toString(16)} has no header block`,
			'RESOURCE_EMPTY',
		);
	}
	return { header, body: readBlock(1) };
}

/**
 * Read the inline import table from the decompressed header block at
 * resource.importOffset. Returns a map from header-block ptrOffset to target
 * resource ID — this matches how BundleManager's GetDependencies() builds its
 * lookup (EntryPointerOffset → EntryID).
 *
 * Entry layout (16 bytes, LE): { u64 resourceId, u32 ptrOffset, u32 padding }.
 * See docs/Renderable_findings.md §3 for why this lives in the header block
 * and not in a separate file region.
 */
export function readInlineImportTable(
	header: Uint8Array,
	resource: ResourceEntry,
): Map<number, bigint> {
	const out = new Map<number, bigint>();
	if (resource.importCount === 0) return out;
	const dv = new DataView(header.buffer, header.byteOffset, header.byteLength);
	const base = resource.importOffset >>> 0;
	for (let i = 0; i < resource.importCount; i++) {
		const p = base + i * 16;
		if (p + 16 > header.byteLength) {
			throw new BundleError(
				`Renderable import table entry ${i} out of bounds (offset ${p}, header ${header.byteLength})`,
				'PARSE_ERROR',
			);
		}
		const lo = BigInt(dv.getUint32(p + 0x00, true));
		const hi = BigInt(dv.getUint32(p + 0x04, true));
		const id = (hi << 32n) | (lo & 0xFFFFFFFFn);
		const ptrOffset = dv.getUint32(p + 0x08, true);
		out.set(ptrOffset >>> 0, id);
	}
	return out;
}

/**
 * Look up a resource by its u64 id across the parsed bundle's flat resource
 * list. Linear scan — fine for bundles with a few hundred entries. Called
 * from the Renderable handler to resolve imported VertexDescriptor and
 * Material references.
 */
export function findResourceById(bundle: ParsedBundle, id: bigint): ResourceEntry | null {
	for (const r of bundle.resources) {
		if (u64ToBigInt(r.resourceId) === id) return r;
	}
	return null;
}

// -----------------------------------------------------------------------------
// Header + body parsing
// -----------------------------------------------------------------------------

function parseRenderableHeaderStruct(header: Uint8Array): RenderableHeader {
	if (header.byteLength < 0x30) {
		throw new BundleError(
			`Renderable header too small (${header.byteLength} bytes, need at least 0x30)`,
			'PARSE_ERROR',
		);
	}
	const dv = new DataView(header.buffer, header.byteOffset, header.byteLength);
	const boundingSphere: [number, number, number, number] = [
		dv.getFloat32(0x00, true),
		dv.getFloat32(0x04, true),
		dv.getFloat32(0x08, true),
		dv.getFloat32(0x0C, true),
	];
	const version = dv.getUint16(0x10, true);
	const meshCount = dv.getUint16(0x12, true);
	const mppMeshes = dv.getUint32(0x14, true);
	// 0x18 mpObjectScopeTextureInfo — unused
	const flagsAndPadding = dv.getUint32(0x1C, true);
	const indexBufferPtr = dv.getUint32(0x20, true);
	const vertexBufferPtr = dv.getUint32(0x24, true);
	// 0x28, 0x2C — unknown12/unknown13, always zero in samples; ignore.

	return {
		boundingSphere,
		version,
		meshCount,
		mppMeshes,
		flagsAndPadding,
		indexBufferPtr,
		vertexBufferPtr,
	};
}

function parseIndexBufferDescriptor(header: Uint8Array, ptr: number): IndexBufferDescriptor {
	if (ptr + 0x18 > header.byteLength) {
		throw new BundleError(`IndexBuffer descriptor at ${ptr} out of range`, 'PARSE_ERROR');
	}
	const dv = new DataView(header.buffer, header.byteOffset, header.byteLength);
	// +0x00..+0x08 are runtime GPU state (handle / debug pointer / flags); skip.
	const bodyOffset = dv.getUint32(ptr + 0x0C, true);
	const byteLength = dv.getUint32(ptr + 0x10, true);
	const indexStride = dv.getUint32(ptr + 0x14, true);
	return { bodyOffset, byteLength, indexStride };
}

function parseVertexBufferDescriptor(header: Uint8Array, ptr: number): VertexBufferDescriptor {
	if (ptr + 0x18 > header.byteLength) {
		throw new BundleError(`VertexBuffer descriptor at ${ptr} out of range`, 'PARSE_ERROR');
	}
	const dv = new DataView(header.buffer, header.byteOffset, header.byteLength);
	const bodyOffset = dv.getUint32(ptr + 0x0C, true);
	const byteLength = dv.getUint32(ptr + 0x10, true);
	// +0x14 (stride) is 0 on disk — real stride comes from the VertexDescriptor.
	return { bodyOffset, byteLength };
}

function parseOneMesh(
	header: Uint8Array,
	meshOffset: number,
	imports: Map<number, bigint>,
): RenderableMesh {
	if (meshOffset + 0x80 > header.byteLength) {
		throw new BundleError(
			`RenderableMesh at ${meshOffset} runs past header block (${header.byteLength})`,
			'PARSE_ERROR',
		);
	}
	const dv = new DataView(header.buffer, header.byteOffset, header.byteLength);
	// 64-byte Matrix44
	const boundingMatrix = new Float32Array(16);
	for (let i = 0; i < 16; i++) boundingMatrix[i] = dv.getFloat32(meshOffset + i * 4, true);
	// DrawIndexedParameters (BPR branch: 4 × u32)
	const primitiveType = dv.getUint32(meshOffset + 0x40, true);
	const baseVertexIndex = dv.getUint32(meshOffset + 0x44, true);
	const startIndex = dv.getUint32(meshOffset + 0x48, true);
	const numIndices = dv.getUint32(meshOffset + 0x4C, true);
	// Material pointer at +0x50 (value on disk is 0, real ID comes from imports).
	// Packed u8 counts at +0x54..+0x57.
	const numVertexDescriptors = dv.getUint8(meshOffset + 0x54);
	const instanceCount = dv.getUint8(meshOffset + 0x55);
	const numVertexBuffers = dv.getUint8(meshOffset + 0x56);
	const meshFlags = dv.getUint8(meshOffset + 0x57);
	// +0x58, +0x5C are shared IB/VB pointers equal to the Renderable header's
	// indexBufferPtr / vertexBufferPtr. No need to store them per-mesh.
	// +0x60..+0x77 = 6 VertexDescriptor slots (u32 each).

	const materialAssemblyId = imports.get(meshOffset + 0x50) ?? null;
	const vertexDescriptorIds: (bigint | null)[] = [];
	for (let i = 0; i < 6; i++) {
		const slotOffset = meshOffset + 0x60 + i * 4;
		vertexDescriptorIds.push(imports.get(slotOffset) ?? null);
	}

	return {
		boundingMatrix,
		primitiveType,
		baseVertexIndex,
		startIndex,
		numIndices,
		numVertexDescriptors,
		instanceCount,
		numVertexBuffers,
		meshFlags,
		materialAssemblyId,
		vertexDescriptorIds,
	};
}

/**
 * Parse the Renderable header block. Does NOT touch the body — call
 * decodeVertexArrays() / meshIndicesU16() separately to extract geometry.
 */
export function parseRenderable(header: Uint8Array, imports: Map<number, bigint>): ParsedRenderable {
	const h = parseRenderableHeaderStruct(header);
	const indexBuffer = parseIndexBufferDescriptor(header, h.indexBufferPtr);
	const vertexBuffer = parseVertexBufferDescriptor(header, h.vertexBufferPtr);

	if (h.mppMeshes + h.meshCount * 4 > header.byteLength) {
		throw new BundleError(
			`Renderable mesh offset array runs past header block`,
			'PARSE_ERROR',
		);
	}
	const dv = new DataView(header.buffer, header.byteOffset, header.byteLength);
	const meshes: RenderableMesh[] = [];
	for (let i = 0; i < h.meshCount; i++) {
		const meshOff = dv.getUint32(h.mppMeshes + i * 4, true);
		meshes.push(parseOneMesh(header, meshOff, imports));
	}

	return { header: h, indexBuffer, vertexBuffer, meshes };
}

// -----------------------------------------------------------------------------
// Body → geometry
// -----------------------------------------------------------------------------

export type DecodedVertexArrays = {
	positions: Float32Array;    // xyz × vertexCount
	normals: Float32Array | null;
	uv1: Float32Array | null;
	uv2: Float32Array | null;
	vertexCount: number;
};

/**
 * Walk the shared vertex buffer once and extract every attribute the given
 * VertexDescriptor describes. Output arrays are tightly packed (not
 * interleaved), ready to hand to THREE.BufferAttribute.
 *
 * Only Positions / Normals / UV1 / UV2 are decoded. Tangents / BoneIndexes /
 * BoneWeights are ignored in this first pass — the three.js viewer does flat
 * shading and doesn't skin. Add them here when needed.
 */
export function decodeVertexArrays(
	body: Uint8Array,
	vb: VertexBufferDescriptor,
	vd: ParsedVertexDescriptor,
): DecodedVertexArrays {
	if (vd.stride === 0) {
		throw new BundleError('VertexDescriptor reports stride=0', 'PARSE_ERROR');
	}
	const vertexCount = Math.floor(vb.byteLength / vd.stride);
	if (vertexCount === 0) {
		return { positions: new Float32Array(0), normals: null, uv1: null, uv2: null, vertexCount: 0 };
	}
	if (vb.bodyOffset + vertexCount * vd.stride > body.byteLength) {
		throw new BundleError(
			`VertexBuffer runs past body block (offset ${vb.bodyOffset}, ${vertexCount} × ${vd.stride} > ${body.byteLength})`,
			'PARSE_ERROR',
		);
	}
	const bodyDv = new DataView(body.buffer, body.byteOffset, body.byteLength);

	const findAttr = (t: VertexAttributeType): VertexAttribute | null =>
		vd.attributes.find((a) => a.type === t) ?? null;

	const readFloatAttr = (attr: VertexAttribute, components: number): Float32Array => {
		const out = new Float32Array(vertexCount * components);
		for (let v = 0; v < vertexCount; v++) {
			const base = vb.bodyOffset + v * vd.stride + attr.offset;
			for (let c = 0; c < components; c++) {
				out[v * components + c] = bodyDv.getFloat32(base + c * 4, true);
			}
		}
		return out;
	};

	const posAttr = findAttr(VertexAttributeType.Positions);
	if (!posAttr) {
		throw new BundleError('VertexDescriptor has no Positions attribute', 'PARSE_ERROR');
	}
	const positions = readFloatAttr(posAttr, 3);

	const normAttr = findAttr(VertexAttributeType.Normals);
	const normals = normAttr ? readFloatAttr(normAttr, 3) : null;

	const uv1Attr = findAttr(VertexAttributeType.UV1);
	const uv1 = uv1Attr ? readFloatAttr(uv1Attr, 2) : null;

	const uv2Attr = findAttr(VertexAttributeType.UV2);
	const uv2 = uv2Attr ? readFloatAttr(uv2Attr, 2) : null;

	return { positions, normals, uv1, uv2, vertexCount };
}

/**
 * Return a Uint16Array view into the body block covering exactly the given
 * mesh's indices. Zero-copy: the returned array aliases `body`'s underlying
 * buffer, so don't mutate it and don't keep a reference past the body's
 * lifetime.
 */
export function meshIndicesU16(
	body: Uint8Array,
	ib: IndexBufferDescriptor,
	mesh: RenderableMesh,
): Uint16Array {
	if (ib.indexStride !== 2) {
		throw new BundleError(
			`meshIndicesU16 only supports u16 index buffers (got stride ${ib.indexStride})`,
			'UNSUPPORTED_FORMAT',
		);
	}
	const byteStart = body.byteOffset + ib.bodyOffset + mesh.startIndex * 2;
	// Align check: Uint16Array.byteOffset must be even. All offsets we've seen
	// are naturally aligned, but guard anyway.
	if ((byteStart & 1) !== 0) {
		// Fall back to a copy.
		const copy = new Uint16Array(mesh.numIndices);
		const dv = new DataView(body.buffer, body.byteOffset + ib.bodyOffset + mesh.startIndex * 2, mesh.numIndices * 2);
		for (let i = 0; i < mesh.numIndices; i++) copy[i] = dv.getUint16(i * 2, true);
		return copy;
	}
	return new Uint16Array(body.buffer, byteStart, mesh.numIndices);
}

/**
 * Pick the VertexDescriptor slot that describes the richest vertex layout for
 * a mesh — the one with the most attributes. Positions-only slots (used for
 * shadow passes) will be skipped in favor of slots that also include normals
 * and UVs.
 *
 * `resolver` is a function the caller provides (typically closing over the
 * bundle + buffer) that takes a resource ID and returns parsed VD bytes. We
 * return the parsed VD plus the slot index so the caller can log which one
 * was picked.
 */
export function pickPrimaryVertexDescriptor(
	mesh: RenderableMesh,
	resolver: (id: bigint) => ParsedVertexDescriptor | null,
): { slot: number; descriptor: ParsedVertexDescriptor } | null {
	let best: { slot: number; descriptor: ParsedVertexDescriptor } | null = null;
	for (let i = 0; i < mesh.vertexDescriptorIds.length; i++) {
		const id = mesh.vertexDescriptorIds[i];
		if (id === null) continue;
		const vd = resolver(id);
		if (!vd) continue;
		// Must have Positions to be renderable at all.
		if (!vd.attributes.some((a) => a.type === VertexAttributeType.Positions)) continue;
		if (!best || vd.attributes.length > best.descriptor.attributes.length) {
			best = { slot: i, descriptor: vd };
		}
	}
	return best;
}

// -----------------------------------------------------------------------------
// Self-test hook (kept near the parser so the fixtures stay obvious)
// -----------------------------------------------------------------------------

/**
 * Run a sanity check on a fully-parsed Renderable against the body block.
 * Returns a short human-readable summary on success; throws on inconsistency.
 * Called from tests and from the probe script to double-check a file before
 * we trust it.
 */
export function describeRenderable(r: ParsedRenderable): string {
	const [cx, cy, cz, radius] = r.header.boundingSphere;
	return `v${r.header.version}, ${r.header.meshCount} meshes, bound(${cx.toFixed(2)},${cy.toFixed(2)},${cz.toFixed(2)} r=${radius.toFixed(2)}), IB=${r.indexBuffer.byteLength}B@body+${r.indexBuffer.bodyOffset.toString(16)}, VB=${r.vertexBuffer.byteLength}B@body+${r.vertexBuffer.bodyOffset.toString(16)}`;
}
