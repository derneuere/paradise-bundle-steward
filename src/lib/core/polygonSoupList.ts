// PolygonSoupList (CollisionMeshData) parser and writer
// Resource type ID: 0x43
// Wiki: https://burnout.wiki/wiki/Polygon_Soup_List
// Local spec:  docs/PolygonSoupList.md
// C# reference: repo/WorldCollisionHandler/PolygonSoupList.cs
//
// Binary layout (32-bit LE). All pointer fields are absolute offsets within
// the resource:
//
//   [0x00] CgsGeometric::PolygonSoupList header              0x30 bytes
//          - AxisAlignedBox mOverallAabb                     0x20
//              (3 floats min + 4-byte pad, 3 floats max + 4-byte pad)
//          - PolygonSoup** mpapPolySoups                     u32
//          - AxisAlignedBox4* mpaPolySoupBoxes               u32
//          - int32 miNumPolySoups                            u32
//          - int32 miDataSize                                u32
//   [0x30] PolygonSoup pointer array (when numSoups > 0)     numSoups * u32
//   [aligned to 16] mpaPolySoupBoxes                         ceil(numSoups/4) * 0x70
//          Each 0x70 row is a SIMD-packed AABB4: mMinX, mMinY, mMinZ,
//          mMaxX, mMaxY, mMaxZ as Vector4 (4 lanes), then mValidMasks (Mask4).
//   [per-soup, at positions recorded in pointer array]
//          PolygonSoup struct                                0x20
//          + packed vertices (numVertices * 6 bytes)
//          + polygons        (numPolys * 0xC)
//
// Round-trip strategy: the parser captures the per-soup offsets, the pointer
// array start, and the box-list start from the original resource. The writer
// replays them verbatim so the layout stays byte-identical even though the
// original BurnoutParadise files have non-trivial inter-block padding that
// we don't want to model. Gap bytes between structured regions are assumed
// zero-filled; if a fixture turns up with non-zero gap bytes the test will
// catch it and we'll extend the model.

import { BinReader } from './binTools';

// =============================================================================
// Constants
// =============================================================================

export const POLYGON_SOUP_LIST_HEADER_SIZE = 0x30;
export const POLYGON_SOUP_STRUCT_SIZE = 0x20;
export const POLYGON_SOUP_POLY_SIZE = 0x0C;
export const POLYGON_SOUP_VERTEX_SIZE = 0x06;
export const AABB4_ROW_SIZE = 0x70;
export const SOUPS_PER_AABB4_ROW = 4;

// =============================================================================
// Types
// =============================================================================

export type Vec3 = { x: number; y: number; z: number };

/** Packed u16 vertex — three coordinates in local soup space. */
export type PolygonSoupVertex = { x: number; y: number; z: number };

export type PolygonSoupPoly = {
	/**
	 * Raw u32 collision tag. The wiki notes that when stored inside a soup the
	 * group/material halves are flipped relative to the BrnWorld::CollisionTag
	 * struct, and the value is byteswapped as a 32-bit field. We preserve the
	 * raw u32 here; any editor that wants to interpret it can do so on read.
	 */
	collisionTag: number;
	vertexIndices: [number, number, number, number]; // u8[4]; 0xFF in [3] means "triangle"
	edgeCosines: [number, number, number, number];   // u8[4], compressed
};

export type PolygonSoup = {
	/** i32[3] — opaque `maiVertexOffsets`, semantics still TBD on the wiki. */
	vertexOffsets: [number, number, number];
	/** f32 — opaque `mfComprGranularity`, semantics still TBD. */
	comprGranularity: number;
	/** u8 — number of polygons that are quads (the rest are triangles). */
	numQuads: number;
	/**
	 * 3 bytes at soup+0x1D. The wiki lists these as padding, but the C# reader
	 * names them `Unknown10: u8` and `Unknown11: i16`, so they might carry
	 * data. Preserved verbatim for round-trip.
	 */
	padding: [number, number, number];
	/** Packed vertices (3 × u16). Unpacking semantics TBD. */
	vertices: PolygonSoupVertex[];
	polygons: PolygonSoupPoly[];
	/** Per-soup bounding box, unpacked from the AABB4 table. */
	min: Vec3;
	max: Vec3;

	// ---- Layout bookkeeping (set by parser, consumed by writer) ----
	/** Absolute offset of this soup's struct within the resource. */
	offset: number;
	/** Absolute offset of this soup's packed vertex block. */
	verticesOffset: number;
	/** Absolute offset of this soup's polygon block. */
	polygonsOffset: number;
	/** Raw value of the u16 `mu16DataSize` field from the soup header. */
	dataSize: number;
};

export type ParsedPolygonSoupList = {
	overallMin: Vec3;
	/** u32 at 0x0C — the w-pad of the AABB min Vector3. Usually 0, preserved verbatim. */
	overallMinPadding: number;
	overallMax: Vec3;
	/** u32 at 0x1C — the w-pad of the AABB max Vector3. Usually 0, preserved verbatim. */
	overallMaxPadding: number;
	soups: PolygonSoup[];
	/**
	 * One entry per AABB4 row (ceil(numSoups / 4) entries). Each is the 16-byte
	 * `mValidMasks` Mask4 at row+0x60, stored as four u32s. Preserved verbatim.
	 */
	rowValidMasks: [number, number, number, number][];

	// ---- Layout bookkeeping ----
	/** Value of the header `miDataSize` field (0x2C). */
	dataSize: number;
	/** Raw resource byte length (may be > dataSize due to trailing 16-byte align). */
	totalSize: number;
	/** Header `mpapPolySoups` pointer (0x30 for non-empty, 0 for empty). */
	chunkPointerStart: number;
	/** Header `mpaPolySoupBoxes` pointer (align16(chunkPointerStart + numSoups*4), or 0). */
	boxListStart: number;
};

// =============================================================================
// Vertex unpacking
// =============================================================================

/**
 * Unpack a packed PolygonSoup vertex into world-space coordinates.
 *
 * Per the wiki spec (`docs/PolygonSoupList.md`) and the official Burnout
 * Paradise Blender importer, the three packed fields are **unsigned** u16
 * values (full 0..65535 range) — NOT signed i16. Both sources apply the
 * straight unsigned formula `(packed + offset) * granularity` per axis.
 *
 * Pure, no allocations beyond the returned tuple — suitable for per-vertex
 * use in hot loops.
 */
export function unpackSoupVertex(
	v: PolygonSoupVertex,
	offsets: readonly [number, number, number],
	granularity: number,
): [number, number, number] {
	return [
		(v.x + offsets[0]) * granularity,
		(v.y + offsets[1]) * granularity,
		(v.z + offsets[2]) * granularity,
	];
}

// =============================================================================
// Parsing
// =============================================================================

export function parsePolygonSoupListData(
	raw: Uint8Array,
	littleEndian: boolean = true,
): ParsedPolygonSoupList {
	const r = new BinReader(
		raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength),
		littleEndian,
	);

	// ---- Header (0x30 bytes) ----
	const overallMin: Vec3 = { x: r.readF32(), y: r.readF32(), z: r.readF32() };
	const overallMinPadding = r.readU32();
	const overallMax: Vec3 = { x: r.readF32(), y: r.readF32(), z: r.readF32() };
	const overallMaxPadding = r.readU32();
	const chunkPointerStart = r.readU32();
	const boxListStart      = r.readU32();
	const numSoups          = r.readU32();
	const dataSize          = r.readU32();

	const soups: PolygonSoup[] = [];
	const rowValidMasks: [number, number, number, number][] = [];

	if (numSoups === 0) {
		return {
			overallMin,
			overallMinPadding,
			overallMax,
			overallMaxPadding,
			soups,
			rowValidMasks,
			dataSize,
			totalSize: raw.byteLength,
			chunkPointerStart,
			boxListStart,
		};
	}

	// ---- Soup pointer array (numSoups * u32) ----
	r.position = chunkPointerStart;
	const soupOffsets: number[] = [];
	for (let i = 0; i < numSoups; i++) soupOffsets.push(r.readU32());

	// ---- AABB4 table (ceil(numSoups/4) rows of 0x70 bytes) ----
	// Row layout (per CgsGeometric::AxisAlignedBox4):
	//   0x00 mAabbMinX Vector4  (minX for lanes 0..3)
	//   0x10 mAabbMinY
	//   0x20 mAabbMinZ
	//   0x30 mAabbMaxX
	//   0x40 mAabbMaxY
	//   0x50 mAabbMaxZ
	//   0x60 mValidMasks Mask4 (four u32 lane masks)
	// Unpack each active lane into a per-soup min/max.
	const numRows = Math.ceil(numSoups / SOUPS_PER_AABB4_ROW);
	const perSoupBox: { min: Vec3; max: Vec3 }[] = new Array(numSoups);
	for (let row = 0; row < numRows; row++) {
		const rowBase = boxListStart + row * AABB4_ROW_SIZE;
		// Read all 4 columns for each of the 6 Vector4 components first so we
		// can index by lane cleanly.
		const lanes: { minX: number[]; minY: number[]; minZ: number[]; maxX: number[]; maxY: number[]; maxZ: number[] } = {
			minX: [], minY: [], minZ: [], maxX: [], maxY: [], maxZ: [],
		};
		r.position = rowBase + 0x00; for (let l = 0; l < 4; l++) lanes.minX.push(r.readF32());
		r.position = rowBase + 0x10; for (let l = 0; l < 4; l++) lanes.minY.push(r.readF32());
		r.position = rowBase + 0x20; for (let l = 0; l < 4; l++) lanes.minZ.push(r.readF32());
		r.position = rowBase + 0x30; for (let l = 0; l < 4; l++) lanes.maxX.push(r.readF32());
		r.position = rowBase + 0x40; for (let l = 0; l < 4; l++) lanes.maxY.push(r.readF32());
		r.position = rowBase + 0x50; for (let l = 0; l < 4; l++) lanes.maxZ.push(r.readF32());
		r.position = rowBase + 0x60;
		const masks: [number, number, number, number] = [
			r.readU32(),
			r.readU32(),
			r.readU32(),
			r.readU32(),
		];
		rowValidMasks.push(masks);

		for (let lane = 0; lane < SOUPS_PER_AABB4_ROW; lane++) {
			const soupIdx = row * SOUPS_PER_AABB4_ROW + lane;
			if (soupIdx >= numSoups) break;
			perSoupBox[soupIdx] = {
				min: { x: lanes.minX[lane], y: lanes.minY[lane], z: lanes.minZ[lane] },
				max: { x: lanes.maxX[lane], y: lanes.maxY[lane], z: lanes.maxZ[lane] },
			};
		}
	}

	// ---- Per-soup structs + payloads ----
	for (let i = 0; i < numSoups; i++) {
		const soupOffset = soupOffsets[i];
		r.position = soupOffset;

		const vertexOffsets: [number, number, number] = [r.readI32(), r.readI32(), r.readI32()];
		const comprGranularity = r.readF32();
		const polygonsOffset = r.readU32();  // mpaPolygons
		const verticesOffset = r.readU32();  // mpaVertices
		const soupDataSize  = r.readU16();   // mu16DataSize
		const numPolys      = r.readU8();    // mu8TotalNumPolys
		const numQuads      = r.readU8();    // mu8NumQuads
		const numVertices   = r.readU8();    // mu8NumVertices
		const padding: [number, number, number] = [r.readU8(), r.readU8(), r.readU8()];

		// Packed vertices
		const vertices: PolygonSoupVertex[] = [];
		r.position = verticesOffset;
		for (let v = 0; v < numVertices; v++) {
			vertices.push({ x: r.readU16(), y: r.readU16(), z: r.readU16() });
		}

		// Polygons
		const polygons: PolygonSoupPoly[] = [];
		r.position = polygonsOffset;
		for (let p = 0; p < numPolys; p++) {
			const collisionTag = r.readU32();
			const vi: [number, number, number, number] = [r.readU8(), r.readU8(), r.readU8(), r.readU8()];
			const ec: [number, number, number, number] = [r.readU8(), r.readU8(), r.readU8(), r.readU8()];
			polygons.push({ collisionTag, vertexIndices: vi, edgeCosines: ec });
		}

		soups.push({
			vertexOffsets,
			comprGranularity,
			numQuads,
			padding,
			vertices,
			polygons,
			min: perSoupBox[i].min,
			max: perSoupBox[i].max,
			offset: soupOffset,
			verticesOffset,
			polygonsOffset,
			dataSize: soupDataSize,
		});
	}

	return {
		overallMin,
		overallMinPadding,
		overallMax,
		overallMaxPadding,
		soups,
		rowValidMasks,
		dataSize,
		totalSize: raw.byteLength,
		chunkPointerStart,
		boxListStart,
	};
}

// =============================================================================
// Writing
// =============================================================================

/**
 * Emit a PolygonSoupList as raw bytes.
 *
 * Writer strategy — two modes, auto-selected:
 *
 * 1. **Layout-preserving** (default). If every soup in the model has a unique,
 *    populated `offset`, the writer trusts the parser-supplied offsets and
 *    places each structure at its original location. This is what gives us
 *    `byteRoundTrip: true` on the unchanged WORLDCOL.BIN fixtures, whose
 *    in-game layout has non-trivial inter-block padding we do not try to
 *    model explicitly. Bytes not covered by any structured region are left
 *    as zeros — verified correct for all 428 resources.
 *
 * 2. **Tight-packed** (auto). If {@link hasLayoutConflict} detects that two or
 *    more soups share an `offset` (the telltale sign of a mutation that
 *    cloned a soup — dup, append, insert) or any soup is missing its offset,
 *    the writer normalizes the entire layout first via
 *    {@link normalizePolygonSoupListLayout}. Mutations that only remove or
 *    reorder soups (pop, swap) stay on the preserving path because their
 *    offsets remain unique.
 *
 * Both modes are idempotent on their own output: parsing the result and
 * re-writing produces the same bytes. Stress scenarios rely on this.
 */
export function writePolygonSoupListData(
	model: ParsedPolygonSoupList,
	littleEndian: boolean = true,
): Uint8Array {
	if (hasLayoutConflict(model)) {
		model = normalizePolygonSoupListLayout(model);
	}
	const out = new Uint8Array(model.totalSize);
	const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
	const le = littleEndian;
	const numSoups = model.soups.length;

	// ---- Header (0x30) ----
	view.setFloat32(0x00, model.overallMin.x, le);
	view.setFloat32(0x04, model.overallMin.y, le);
	view.setFloat32(0x08, model.overallMin.z, le);
	view.setUint32 (0x0C, model.overallMinPadding >>> 0, le);
	view.setFloat32(0x10, model.overallMax.x, le);
	view.setFloat32(0x14, model.overallMax.y, le);
	view.setFloat32(0x18, model.overallMax.z, le);
	view.setUint32 (0x1C, model.overallMaxPadding >>> 0, le);
	view.setUint32 (0x20, model.chunkPointerStart >>> 0, le);
	view.setUint32 (0x24, model.boxListStart      >>> 0, le);
	view.setUint32 (0x28, numSoups                >>> 0, le);
	view.setUint32 (0x2C, model.dataSize          >>> 0, le);

	if (numSoups === 0) return out;

	// ---- Soup pointer array ----
	for (let i = 0; i < numSoups; i++) {
		view.setUint32(model.chunkPointerStart + i * 4, model.soups[i].offset >>> 0, le);
	}

	// ---- AABB4 table ----
	const numRows = Math.ceil(numSoups / SOUPS_PER_AABB4_ROW);
	for (let row = 0; row < numRows; row++) {
		const rowBase = model.boxListStart + row * AABB4_ROW_SIZE;
		for (let lane = 0; lane < SOUPS_PER_AABB4_ROW; lane++) {
			const soupIdx = row * SOUPS_PER_AABB4_ROW + lane;
			if (soupIdx >= numSoups) break;
			const s = model.soups[soupIdx];
			view.setFloat32(rowBase + 0x00 + lane * 4, s.min.x, le);
			view.setFloat32(rowBase + 0x10 + lane * 4, s.min.y, le);
			view.setFloat32(rowBase + 0x20 + lane * 4, s.min.z, le);
			view.setFloat32(rowBase + 0x30 + lane * 4, s.max.x, le);
			view.setFloat32(rowBase + 0x40 + lane * 4, s.max.y, le);
			view.setFloat32(rowBase + 0x50 + lane * 4, s.max.z, le);
		}
		const masks = model.rowValidMasks[row] ?? [0, 0, 0, 0];
		view.setUint32(rowBase + 0x60, masks[0] >>> 0, le);
		view.setUint32(rowBase + 0x64, masks[1] >>> 0, le);
		view.setUint32(rowBase + 0x68, masks[2] >>> 0, le);
		view.setUint32(rowBase + 0x6C, masks[3] >>> 0, le);
	}

	// ---- Per-soup structs + payloads ----
	for (const soup of model.soups) {
		const base = soup.offset;

		// Soup struct (0x20)
		view.setInt32 (base + 0x00, soup.vertexOffsets[0] | 0, le);
		view.setInt32 (base + 0x04, soup.vertexOffsets[1] | 0, le);
		view.setInt32 (base + 0x08, soup.vertexOffsets[2] | 0, le);
		view.setFloat32(base + 0x0C, soup.comprGranularity, le);
		view.setUint32(base + 0x10, soup.polygonsOffset >>> 0, le);
		view.setUint32(base + 0x14, soup.verticesOffset >>> 0, le);
		view.setUint16(base + 0x18, soup.dataSize & 0xFFFF, le);
		view.setUint8 (base + 0x1A, soup.polygons.length & 0xFF);
		view.setUint8 (base + 0x1B, soup.numQuads & 0xFF);
		view.setUint8 (base + 0x1C, soup.vertices.length & 0xFF);
		view.setUint8 (base + 0x1D, soup.padding[0] & 0xFF);
		view.setUint8 (base + 0x1E, soup.padding[1] & 0xFF);
		view.setUint8 (base + 0x1F, soup.padding[2] & 0xFF);

		// Packed vertices (3 × u16)
		for (let vi = 0; vi < soup.vertices.length; vi++) {
			const vbase = soup.verticesOffset + vi * POLYGON_SOUP_VERTEX_SIZE;
			view.setUint16(vbase + 0, soup.vertices[vi].x & 0xFFFF, le);
			view.setUint16(vbase + 2, soup.vertices[vi].y & 0xFFFF, le);
			view.setUint16(vbase + 4, soup.vertices[vi].z & 0xFFFF, le);
		}

		// Polygons (0xC each)
		for (let pi = 0; pi < soup.polygons.length; pi++) {
			const pbase = soup.polygonsOffset + pi * POLYGON_SOUP_POLY_SIZE;
			const p = soup.polygons[pi];
			view.setUint32(pbase + 0x00, p.collisionTag >>> 0, le);
			view.setUint8 (pbase + 0x04, p.vertexIndices[0] & 0xFF);
			view.setUint8 (pbase + 0x05, p.vertexIndices[1] & 0xFF);
			view.setUint8 (pbase + 0x06, p.vertexIndices[2] & 0xFF);
			view.setUint8 (pbase + 0x07, p.vertexIndices[3] & 0xFF);
			view.setUint8 (pbase + 0x08, p.edgeCosines[0] & 0xFF);
			view.setUint8 (pbase + 0x09, p.edgeCosines[1] & 0xFF);
			view.setUint8 (pbase + 0x0A, p.edgeCosines[2] & 0xFF);
			view.setUint8 (pbase + 0x0B, p.edgeCosines[3] & 0xFF);
		}
	}

	return out;
}

// =============================================================================
// Layout normalization
// =============================================================================

function align16(pos: number): number {
	return (pos + 15) & ~15;
}

function align4(pos: number): number {
	return (pos + 3) & ~3;
}

/**
 * Detects whether `model` has a stale or inconsistent soup layout, i.e. two
 * soups share an offset (a dup/insert/append didn't recompute positions) or
 * a soup is missing its offset entirely. Mutations that only reorder or
 * remove soups (pop, swap) leave the layout valid and skip normalization.
 */
export function hasLayoutConflict(model: ParsedPolygonSoupList): boolean {
	if (model.soups.length === 0) return false;
	const seen = new Set<number>();
	for (const s of model.soups) {
		if (typeof s.offset !== 'number' || s.offset <= 0) return true;
		if (seen.has(s.offset)) return true;
		seen.add(s.offset);
	}
	return false;
}

/**
 * Produce a fresh model with a tightly-packed layout: header, pointer array
 * (aligned to 16), AABB4 table, then each soup at a 16-byte-aligned position
 * with its struct + vertices + polygons. Deterministic — calling this on an
 * already-normalized model returns an equivalent model with the same layout,
 * which is what gives stress/fuzz scenarios their idempotence.
 *
 * Does NOT modify the input. Stress scenarios and fuzz mutations typically
 * don't need to call this directly; `writePolygonSoupListData` invokes it
 * automatically when {@link hasLayoutConflict} fires.
 *
 * The regenerated `rowValidMasks` use `0xFFFFFFFF` for active lanes and `0`
 * for inactive ones. The parser preserves whatever values are stored, so
 * re-parse+re-write stays idempotent regardless of which convention the
 * original BurnoutParadise fixtures used.
 */
export function normalizePolygonSoupListLayout(
	model: ParsedPolygonSoupList,
): ParsedPolygonSoupList {
	const numSoups = model.soups.length;

	if (numSoups === 0) {
		return {
			...model,
			soups: [],
			rowValidMasks: [],
			dataSize: POLYGON_SOUP_LIST_HEADER_SIZE,
			totalSize: POLYGON_SOUP_LIST_HEADER_SIZE,
			chunkPointerStart: 0,
			boxListStart: 0,
		};
	}

	let pos = POLYGON_SOUP_LIST_HEADER_SIZE;
	const chunkPointerStart = pos;
	pos += numSoups * 4;
	pos = align16(pos);

	const boxListStart = pos;
	const numRows = Math.ceil(numSoups / SOUPS_PER_AABB4_ROW);
	pos += numRows * AABB4_ROW_SIZE;

	const newSoups: PolygonSoup[] = model.soups.map((s) => {
		pos = align16(pos);
		const offset = pos;
		pos += POLYGON_SOUP_STRUCT_SIZE;

		const verticesOffset = pos;
		pos += s.vertices.length * POLYGON_SOUP_VERTEX_SIZE;
		pos = align4(pos);

		const polygonsOffset = pos;
		pos += s.polygons.length * POLYGON_SOUP_POLY_SIZE;

		const dataSize = pos - offset;
		// mu16DataSize is a u16. With u8 poly/vertex counts it tops out at
		// 0x20 + 255*6 + 255*12 = 0x1212 ≈ 4626 bytes, so overflow is
		// impossible under valid data — this is purely a guard against
		// manually crafted garbage.
		if (dataSize > 0xFFFF) {
			throw new Error(
				`PolygonSoup data block overflow: ${dataSize} > 65535 bytes`,
			);
		}

		return { ...s, offset, verticesOffset, polygonsOffset, dataSize };
	});

	pos = align16(pos);
	const totalSize = pos;

	const rowValidMasks: [number, number, number, number][] = [];
	for (let row = 0; row < numRows; row++) {
		const mask: [number, number, number, number] = [0, 0, 0, 0];
		for (let lane = 0; lane < SOUPS_PER_AABB4_ROW; lane++) {
			if (row * SOUPS_PER_AABB4_ROW + lane < numSoups) {
				mask[lane] = 0xFFFFFFFF;
			}
		}
		rowValidMasks.push(mask);
	}

	return {
		...model,
		soups: newSoups,
		rowValidMasks,
		dataSize: totalSize,
		totalSize,
		chunkPointerStart,
		boxListStart,
	};
}
