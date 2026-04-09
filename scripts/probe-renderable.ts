// Probe script — NOT checked in as a feature, just a scratch pad for
// verifying our assumptions about the Renderable / VertexDescriptor / Model
// binary layout against a real Burnout Paradise PC car graphics bundle.
//
// Answers the open questions from the plan before we commit to a parser:
//
//   1. What resource typeIds does the sample bundle actually contain?
//      (Specifically: is GraphicsSpec 0x10006 present? How many Renderables,
//      Models, VertexDescriptors, Materials?)
//
//   2. Does the Renderable header layout from BundleManager's Renderable.cs
//      line up with the real bytes? (boundingSphere / version / meshCount /
//      startOffset / vertexBufferPtr etc.)
//
//   3. Where does the mesh offset array actually sit, and what follows it?
//      (Old code reads numIndices + 3 u32s inline after the array — is that
//      actually the IndexBuffer struct, or coincidence?)
//
//   4. Does `VertexDescriptor.attributes[positions].size` hold the
//      per-attribute byte count (0xC for float3) or the full vertex stride
//      (0x20/0x28/...)? This determines whether we can copy the old code's
//      switch-on-stride shortcut or have to write a proper descriptor-driven
//      decoder.
//
//   5. Is the index buffer u16 or u32 in practice? Old code reads u16.
//      numIndices * 2 should match the referenced slice of the secondary block.
//
//   6. Do Renderables on PC always have a populated block 1 (secondary /
//      body) that holds the index+vertex bytes?
//
// Run with: npm run -s probe -- <path-to-bundle>
//   (or: npx tsx scripts/probe-renderable.ts <path-to-bundle>)

import * as fs from 'node:fs';
import * as path from 'node:path';

import { parseBundle } from '../src/lib/core/bundle';
import { extractResourceSize, isCompressed, decompressData } from '../src/lib/core/resourceManager';
import { u64ToBigInt } from '../src/lib/core/u64';
import type { ResourceEntry } from '../src/lib/core/types';

// -----------------------------------------------------------------------------
// Resource type ids we care about (from the wiki / docs/*.md)
// -----------------------------------------------------------------------------
const TYPE_ID = {
	Texture: 0x0,
	Material: 0x1,
	RenderableMesh: 0x2, // not a distinct bundle resource on PC AFAICT
	VertexDescriptor: 0xA,
	Renderable: 0xC,
	TextureState: 0xE,
	Shader: 0x12,
	Model: 0x2A, // also VehicleModel / PropModel / WheelModel
	GraphicsSpec: 0x10006, // VehicleGraphics
} as const;

const TYPE_NAME: Record<number, string> = Object.fromEntries(
	Object.entries(TYPE_ID).map(([k, v]) => [v, k]),
);

function hex(n: number | bigint, width = 8): string {
	return '0x' + n.toString(16).padStart(width, '0');
}

// -----------------------------------------------------------------------------
// Low-level: grab both block-0 (header) and block-1 (body) for one resource.
// resourceManager.extractResourceData() only returns the FIRST non-empty block,
// but a Renderable needs both.
// -----------------------------------------------------------------------------
type ResourceBlocks = {
	blocks: (Uint8Array | null)[]; // length 3
	baseOffsets: [number, number, number]; // absolute file offsets per block
};

function getResourceBlocks(
	buffer: ArrayBuffer,
	bundle: ReturnType<typeof parseBundle>,
	resource: ResourceEntry,
): ResourceBlocks {
	const blocks: (Uint8Array | null)[] = [null, null, null];
	const baseOffsets = [0, 0, 0] as [number, number, number];
	for (let i = 0; i < 3; i++) {
		const size = extractResourceSize(resource.sizeAndAlignmentOnDisk[i]);
		if (size <= 0) continue;
		const base = bundle.header.resourceDataOffsets[i] >>> 0;
		const rel = resource.diskOffsets[i] >>> 0;
		const start = (base + rel) >>> 0;
		baseOffsets[i] = start;
		if (start + size <= buffer.byteLength) {
			let bytes = new Uint8Array(buffer, start, size);
			if (isCompressed(bytes)) {
				bytes = decompressData(bytes);
			}
			blocks[i] = bytes;
		}
	}
	return { blocks, baseOffsets };
}

function rid(r: ResourceEntry): bigint {
	return u64ToBigInt(r.resourceId);
}

// Read imports from the decompressed header block at offset resource.importOffset.
// In BND2 format, importOffset is a header-block-RELATIVE offset, not file-absolute.
// Confirmed by cross-referencing:
//   - BundleManager/BundleFormat/BundleEntry.cs GetDependencies(), which seeks in
//     EntryBlocks[0].Data (decompressed header block) at DependenciesListOffset.
//   - BundleManager/BundleFormat/BundleArchive.cs ReadBND2() line 545, which stores
//     the field without a preamble, unlike the BND1 path at line 407 that expected
//     an 8-byte {count, zero} preamble.
//   - Volatility's ResourceImport.ReadExternalImport, which reads 16-byte entries
//     from a resource-internal import block.
//
// Entry layout (16 bytes): { u64 resourceId, u32 entryPointerOffset, u32 padding }.
// entryPointerOffset is the offset WITHIN THE HEADER BLOCK of the pointer to patch.
//
// Steward's parseImportEntries in bundle/bundleEntry.ts treats importOffset as
// file-absolute and so would read garbage for any resource that actually has
// imports. That's a latent bug we work around here — Renderable is the first
// steward-registered resource type that uses imports, and fixing steward's
// bundle-level parser is out of scope for this probe.
function readImportsFor(
	resource: ResourceEntry,
	littleEndian: boolean,
	headerBlock: Uint8Array,
): { resourceId: bigint; offset: number }[] {
	if (resource.importCount === 0) return [];
	const importOff = resource.importOffset >>> 0;
	const dv = new DataView(headerBlock.buffer, headerBlock.byteOffset, headerBlock.byteLength);
	const out: { resourceId: bigint; offset: number }[] = [];
	for (let i = 0; i < resource.importCount; i++) {
		const p = importOff + i * 16;
		if (p + 16 > headerBlock.byteLength) {
			console.log(`    [!] import entry ${i} out of bounds (p=${p}, header=${headerBlock.byteLength})`);
			break;
		}
		const lo = BigInt(dv.getUint32(p + 0, littleEndian));
		const hi = BigInt(dv.getUint32(p + 4, littleEndian));
		const id = (hi << 32n) | (lo & 0xFFFFFFFFn);
		const off = dv.getUint32(p + 8, littleEndian);
		out.push({ resourceId: id, offset: off });
	}
	return out;
}

function hexdump(bytes: Uint8Array, length = 128, startOffset = 0): string {
	const lines: string[] = [];
	const end = Math.min(bytes.byteLength, startOffset + length);
	for (let i = startOffset; i < end; i += 16) {
		const row = bytes.subarray(i, Math.min(i + 16, end));
		const h = Array.from(row, (b) => b.toString(16).padStart(2, '0')).join(' ');
		const a = Array.from(row, (b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.')).join('');
		lines.push(`  ${i.toString(16).padStart(4, '0')}  ${h.padEnd(48, ' ')}  ${a}`);
	}
	return lines.join('\n');
}

// -----------------------------------------------------------------------------
// Header reader with tiny seek support — DataView-based so we don't pull in
// binTools (which is wired for the in-browser bundle and doesn't care about
// our scratch use).
// -----------------------------------------------------------------------------
class Reader {
	private dv: DataView;
	pos = 0;
	readonly len: number;
	constructor(public bytes: Uint8Array, public little = true) {
		this.dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
		this.len = bytes.byteLength;
	}
	seek(p: number) { this.pos = p >>> 0; return this; }
	u8()  { const v = this.dv.getUint8(this.pos);           this.pos += 1; return v; }
	u16() { const v = this.dv.getUint16(this.pos, this.little); this.pos += 2; return v; }
	i16() { const v = this.dv.getInt16(this.pos, this.little);  this.pos += 2; return v; }
	u32() { const v = this.dv.getUint32(this.pos, this.little); this.pos += 4; return v >>> 0; }
	i32() { const v = this.dv.getInt32(this.pos, this.little);  this.pos += 4; return v | 0; }
	f32() { const v = this.dv.getFloat32(this.pos, this.little); this.pos += 4; return v; }
}

// -----------------------------------------------------------------------------
// Step 1: list everything in the bundle, tagged by RST name when available.
// -----------------------------------------------------------------------------
function parseResourceStringTable(debugData: string | undefined): Map<string, { type: string; name: string }> {
	const out = new Map<string, { type: string; name: string }>();
	if (!debugData) return out;
	const re = /<Resource\s+id="([0-9a-fA-F]+)"\s+type="([^"]+)"\s+name="([^"]*)"\s*\/>/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(debugData)) !== null) {
		out.set(m[1].toLowerCase(), { type: m[2], name: m[3] });
	}
	return out;
}

function sumarizeTypeHistogram(bundle: ReturnType<typeof parseBundle>) {
	const hist = new Map<number, number>();
	for (const r of bundle.resources) {
		hist.set(r.resourceTypeId, (hist.get(r.resourceTypeId) ?? 0) + 1);
	}
	const sorted = [...hist.entries()].sort((a, b) => b[1] - a[1]);
	return sorted;
}

// -----------------------------------------------------------------------------
// Step 2: parse ONE Renderable header following BundleManager's layout.
// We read every field we believe exists and print them, including the raw
// bytes beyond the documented end, so we can eyeball mismatches.
// -----------------------------------------------------------------------------
type ProbedRenderable = {
	boundingSphere: [number, number, number, number];
	version: number;
	meshCount: number;
	startOffset: number;       // pointer to mesh-offset array (mppMeshes)
	mpObjectScopeTextureInfo: number;
	flagsAndPadding: number;
	indexBufferPtr: number;    // wiki: IndexBuffer*
	vertexBufferPtr: number;   // wiki: VertexBuffer* (old code: UnknownOffset)
	tail: [number, number];    // old code's Unknown12/Unknown13
};

function probeRenderableHeader(bytes: Uint8Array): ProbedRenderable {
	const r = new Reader(bytes);
	const boundingSphere: [number, number, number, number] = [r.f32(), r.f32(), r.f32(), r.f32()];
	const version = r.u16();
	const meshCount = r.u16();
	const startOffset = r.u32();
	const mpObjectScopeTextureInfo = r.u32();
	const flagsAndPadding = r.u32();
	const indexBufferPtr = r.u32();
	const vertexBufferPtr = r.u32();
	const tail: [number, number] = [r.u32(), r.u32()]; // Unknown12, Unknown13 — may be garbage
	return {
		boundingSphere,
		version,
		meshCount,
		startOffset,
		mpObjectScopeTextureInfo,
		flagsAndPadding,
		indexBufferPtr,
		vertexBufferPtr,
		tail,
	};
}

// -----------------------------------------------------------------------------
// Step 3: parse a single RenderableMesh, following BundleManager's layout.
//
// Layout from BaseHandlers/Renderable.cs lines 347-401:
//   0x00 Matrix4      boundingBox / rotation matrix (16 floats)
//   0x40 int32        primitiveType (D3DPT_*)
//   0x44 int32        baseVertexIndex
//   0x48 int32        startIndex (old: IndexOffsetCount)   -> IndexOffset = *2
//   0x4C int32        numVertices
//   0x50 int32        minimumIndex (old: VertexOffsetCount — then zeroed)
//   0x54 int32        numPrimitives (old: NumFaces)        -> IndexCount = *3
//   0x58 ptr          materialAssemblyPtr (resolved via imports)
//   0x60 i16          numVertexDescriptors+instanceCount packed
//   0x62 i16          numVertexBuffers+flags packed
//   0x64 i32          numIndicesOffset
//   0x68 i32          verticesOffsetPtr
//   0x6C i32 x 6      vertexDescriptor pointers (resolved via imports)
//
// We print the raw offsets of the ptr-like fields so we can cross-check against
// the imports table to see which slots are actually populated.
// -----------------------------------------------------------------------------
type ProbedMesh = {
	// absolute within the Renderable header block
	absoluteOffset: number;
	bbox: Float32Array;
	primitiveType: number;
	baseVertexIndex: number;
	startIndex: number;
	numIndices: number;
	materialPtrFileOffset: number; // offset WITHIN the header block
	materialPtrValue: number;
	numVertexDescriptors: number;
	instanceCount: number;
	numVertexBuffers: number;
	meshFlags: number;
	perMeshIndexBufferPtr: number;
	perMeshVertexBufferPtr: number;
	vertexDescPtrs: { fileOffset: number; value: number }[];
};

// Mesh layout verified against BundleManager/BaseHandlers/Renderable.cs lines
// 353-398, specifically the "NumIndices == 0 // BPR" branch which is the one
// taken for our PC sample (see main() — numIndices-after-array is 0).
//
//   0x00  Matrix44        bbox/transform           (64 bytes)
//   0x40  u32             primitiveType            (= 4, D3DPT_TRIANGLELIST)
//   0x44  u32             ?                        (old: Unknown20, observed 0)
//   0x48  u32             IndexOffsetCount         (start offset in index buf, u16 units)
//   0x4C  u32             NumIndices               (old: NumFaces, divided by 3)
//   0x50  u32             MaterialAssembly*        (import-patched → offset 0x50)
//   0x54  i16             Unknown21                (=4 here: numVertexDescriptors?)
//   0x56  i16             Unknown22                (=1 here: numVertexBuffers?)
//   0x58  u32             NumIndicesOffset         (shared: = Renderable.indexBufferPtr)
//   0x5C  u32             VerticesOffsetPtr        (shared: = Renderable.vertexBufferPtr)
//   0x60  u32[6]          VertexDescriptor*        (import-patched → 0x60..0x77)
//   0x78  8 bytes         padding                  (unused in BPR branch; non-BPR branch has 8 bytes of extra DrawIndexedParameters here)
function probeRenderableMesh(bytes: Uint8Array, meshOffset: number): ProbedMesh {
	const r = new Reader(bytes);
	r.seek(meshOffset);
	const bbox = new Float32Array(16);
	for (let i = 0; i < 16; i++) bbox[i] = r.f32();
	// DrawIndexedParameters in BPR branch (4 u32s)
	const primitiveType = r.i32();
	const baseVertexIndex = r.i32();
	const startIndex = r.i32();
	const numIndices = r.i32();
	// Material pointer
	const materialPtrFileOffset = r.pos;
	const materialPtrValue = r.u32();
	// Unknown21/Unknown22 — probably packed {numVertexDescriptors, numVertexBuffers}
	const unknown21 = r.i16();
	const unknown22 = r.i16();
	const numVertexDescriptors = unknown21 & 0xFF;
	const instanceCount = (unknown21 >>> 8) & 0xFF;
	const numVertexBuffers = unknown22 & 0xFF;
	const meshFlags = (unknown22 >>> 8) & 0xFF;
	// Shared IB/VB pointers (match Renderable header's indexBufferPtr/vertexBufferPtr)
	const perMeshIndexBufferPtr = r.u32();
	const perMeshVertexBufferPtr = r.u32();
	// 6 vertex descriptor pointer slots (hardcoded 6 in BundleManager Renderable.cs:383)
	const vertexDescPtrs: { fileOffset: number; value: number }[] = [];
	for (let i = 0; i < 6; i++) {
		const fo = r.pos;
		const v = r.u32();
		vertexDescPtrs.push({ fileOffset: fo, value: v });
	}
	return {
		absoluteOffset: meshOffset,
		bbox,
		primitiveType,
		baseVertexIndex,
		startIndex,
		numIndices,
		materialPtrFileOffset,
		materialPtrValue,
		numVertexDescriptors,
		instanceCount,
		numVertexBuffers,
		meshFlags,
		perMeshIndexBufferPtr,
		perMeshVertexBufferPtr,
		vertexDescPtrs,
	};
}

// -----------------------------------------------------------------------------
// Step 4: parse a VertexDescriptor header following BaseHandlers/VertexDesc.cs.
// The TUB-PC branch (Unknown2 == 0) reads a weird per-attribute record:
//
//   [pad1][size:byte][offset:byte][pad8][type:byte][pad4]   (16 bytes)
//
// ...so 1 + 1 + 1 + 8 + 1 + 4 = 16. We mirror that here.
// -----------------------------------------------------------------------------
type ProbedVertexDesc = {
	unknown1: number;
	unknown2: number;
	unknown3: number;
	attributeCount: number;
	attributes: {
		rawBytes: Uint8Array;
		size: number;
		offset: number;
		type: number; // raw type byte
		typeName: string;
	}[];
};

// Matches BundleManager/BundleFormat/VertexDesc.cs VertexAttributeType enum.
const VERTEX_TYPE_NAMES: Record<number, string> = {
	0: 'Invalid',
	1: 'Positions',
	3: 'Normals',
	5: 'UV1',
	6: 'UV2',
	13: 'BoneIndexes',
	14: 'BoneWeights',
	15: 'Tangents',
};

function probeVertexDescriptor(bytes: Uint8Array): ProbedVertexDesc {
	const r = new Reader(bytes);
	const unknown1 = r.i32();
	const unknown2 = r.i32();
	const unknown3 = r.i32();
	const attributeCount = r.i32();
	const attributes: ProbedVertexDesc['attributes'] = [];

	// BundleManager/BundleFormat/VertexDesc.cs branches on Unknown2:
	//   Unknown2 != 0  -> "BPR" format: 20 bytes per attribute (5 i32s)
	//   Unknown2 == 0  -> "TUB-PC" format: 16 bytes per attribute (1-byte fields with pads)
	// Our PC sample has Unknown2 != 0, so take the BPR branch.
	const bprMode = unknown2 !== 0;
	const attrSize = bprMode ? 20 : 16;
	for (let i = 0; i < attributeCount; i++) {
		const start = r.pos;
		const rawBytes = bytes.subarray(start, start + attrSize);
		if (bprMode) {
			const type = r.u32();
			const _unk1 = r.u32();
			const offset = r.u32();
			const _unk2 = r.u32();
			const size = r.u32();
			attributes.push({
				rawBytes,
				size,
				offset,
				type,
				typeName: VERTEX_TYPE_NAMES[type] ?? `?(${type})`,
			});
		} else {
			r.pos += 1; // pad
			const size = r.u8();
			const offset = r.u8();
			r.pos += 8; // pad
			const type = r.u8();
			r.pos += 4; // pad
			attributes.push({
				rawBytes,
				size,
				offset,
				type,
				typeName: VERTEX_TYPE_NAMES[type] ?? `?(${type})`,
			});
		}
	}
	return { unknown1, unknown2, unknown3, attributeCount, attributes };
}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------
function main() {
	const bundlePath = process.argv[2] ?? 'example/VEH_CARBRWDS_GR.BIN';
	const abs = path.resolve(bundlePath);
	console.log(`bundle: ${abs}`);
	const fileBuf = fs.readFileSync(abs);
	const buffer = fileBuf.buffer.slice(fileBuf.byteOffset, fileBuf.byteOffset + fileBuf.byteLength);
	const bundle = parseBundle(buffer);
	console.log(`  size: ${fileBuf.byteLength}, platform: ${bundle.header.platform}, flags: 0x${bundle.header.flags.toString(16)}`);
	console.log(`  resources: ${bundle.resources.length}, resourceDataOffsets: [${bundle.header.resourceDataOffsets.map((o) => hex(o, 8)).join(', ')}]`);

	// --- Step 1: type histogram ---
	console.log('\n=== Step 1: resource type histogram ===');
	const hist = sumarizeTypeHistogram(bundle);
	for (const [typeId, count] of hist) {
		const name = TYPE_NAME[typeId] ?? '?';
		console.log(`  ${hex(typeId, 5)}  ${name.padEnd(18, ' ')}  ${count}`);
	}

	// RST presence / first few entries
	const rst = parseResourceStringTable(bundle.debugData);
	console.log(`\n  RST entries: ${rst.size} (parsed from debug XML)`);
	if (rst.size > 0) {
		// Spot check: print first 3 Renderables and first GraphicsSpec/Model
		let shown = 0;
		for (const [idHex, info] of rst) {
			if (info.type === 'Renderable' && shown++ < 3) {
				console.log(`    Renderable ${idHex}: ${info.name}`);
			}
		}
		for (const [idHex, info] of rst) {
			if (info.type === 'VehicleGraphics' || info.type === 'Graphics' || info.type === 'GraphicsSpec') {
				console.log(`    ${info.type} ${idHex}: ${info.name}`);
			}
			if (info.type === 'VehicleModel' || info.type === 'Model') {
				console.log(`    ${info.type} ${idHex}: ${info.name}`);
				break;
			}
		}
	}

	const hasGraphicsSpec = bundle.resources.some((r) => r.resourceTypeId === TYPE_ID.GraphicsSpec);
	console.log(`\n  GraphicsSpec (0x10006) present in resource table: ${hasGraphicsSpec}`);

	// --- Step 2: pick the first Renderable with BOTH blocks populated ---
	console.log('\n=== Step 2: probe one Renderable ===');
	const renderables = bundle.resources
		.map((r, i) => ({ r, i }))
		.filter(({ r }) => r.resourceTypeId === TYPE_ID.Renderable);
	console.log(`  found ${renderables.length} Renderables in resource table`);
	if (renderables.length === 0) {
		console.log('  [!] no Renderables — nothing else to probe');
		return;
	}

	// Prefer the first renderable with a non-empty block 1 (body).
	const littleEndian = bundle.header.platform !== 3;
	let chosen: { r: ResourceEntry; i: number; blocks: ResourceBlocks } | null = null;
	for (const { r, i } of renderables) {
		const blocks = getResourceBlocks(buffer, bundle, r);
		if (blocks.blocks[0] && blocks.blocks[1]) {
			chosen = { r, i, blocks };
			break;
		}
	}
	if (!chosen) {
		console.log('  [!] no Renderable has BOTH block-0 and block-1 populated — printing first Renderable anyway');
		const { r, i } = renderables[0];
		chosen = { r, i, blocks: getResourceBlocks(buffer, bundle, r) };
	}

	const header = chosen.blocks.blocks[0]!;
	const body = chosen.blocks.blocks[1];
	console.log(`  picked resource index ${chosen.i}, id ${hex(rid(chosen.r), 16)}`);
	console.log(`  block 0 (header) size: ${header.byteLength} @ ${hex(chosen.blocks.baseOffsets[0], 8)}`);
	console.log(`  block 1 (body)   size: ${body?.byteLength ?? 0} @ ${hex(chosen.blocks.baseOffsets[1], 8)}`);
	const block2Size = chosen.blocks.blocks[2]?.byteLength ?? 0;
	console.log(`  block 2          size: ${block2Size}${block2Size > 0 ? ' (!)' : ''}`);

	console.log(`\n  block-0 FULL dump (${header.byteLength} bytes):`);
	console.log(hexdump(header, header.byteLength));

	const head = probeRenderableHeader(header);
	console.log('\n  parsed Renderable header:');
	console.log(`    boundingSphere: [${head.boundingSphere.map((v) => v.toFixed(3)).join(', ')}]`);
	console.log(`    version: ${head.version}  meshCount: ${head.meshCount}`);
	console.log(`    startOffset (mppMeshes):  ${hex(head.startOffset)}`);
	console.log(`    mpObjectScopeTextureInfo: ${hex(head.mpObjectScopeTextureInfo)}`);
	console.log(`    flagsAndPadding:          ${hex(head.flagsAndPadding)}`);
	console.log(`    indexBufferPtr  (0x20):   ${hex(head.indexBufferPtr)}`);
	console.log(`    vertexBufferPtr (0x24):   ${hex(head.vertexBufferPtr)}`);
	console.log(`    tail (Unknown12/13):      ${hex(head.tail[0])}  ${hex(head.tail[1])}`);

	// --- Step 3: walk the mesh-offset array and the implicit indexBuffer struct ---
	console.log('\n=== Step 3: mesh offset array + inline IndexBuffer ===');
	const r2 = new Reader(header);
	r2.seek(head.startOffset);
	const meshOffsets: number[] = [];
	for (let i = 0; i < head.meshCount; i++) meshOffsets.push(r2.u32());
	console.log(`  mesh offsets: [${meshOffsets.map((o) => hex(o)).join(', ')}]`);
	const afterArray = r2.pos;
	console.log(`  position right after array: ${hex(afterArray)}`);
	// Old code reads 4 x int32 here (numIndices + 3 unknowns). Dump them:
	const implicit = [r2.u32(), r2.u32(), r2.u32(), r2.u32()];
	console.log(`  four u32s immediately after array: [${implicit.map((v) => hex(v)).join(', ')}]`);
	console.log(`    -> if layout matches wiki IndexBuffer{numIndices, indicesPtr, ?, flags}:`);
	console.log(`       numIndices=${implicit[0]}, indicesPtr=${hex(implicit[1])}, ?=${hex(implicit[2])}, flags=${hex(implicit[3])}`);

	// Step 3b: follow indexBufferPtr and vertexBufferPtr to read the descriptor structs
	console.log(`\n  follow indexBufferPtr  ${hex(head.indexBufferPtr)}:`);
	if (head.indexBufferPtr + 16 <= header.byteLength) {
		const rIB = new Reader(header); rIB.seek(head.indexBufferPtr);
		const ib = [rIB.u32(), rIB.u32(), rIB.u32(), rIB.u32()];
		console.log(`    [${ib.map((v) => hex(v)).join(', ')}]`);
		console.log(`    IndexBuffer{numIndices=${ib[0]}, ?=${hex(ib[1])}, ?=${hex(ib[2])}, flags=${hex(ib[3])}}`);
	} else {
		console.log(`    [!] pointer out of range (header is ${header.byteLength} bytes)`);
	}

	console.log(`\n  follow vertexBufferPtr ${hex(head.vertexBufferPtr)}:`);
	let vbStruct: number[] | null = null;
	if (head.vertexBufferPtr + 16 <= header.byteLength) {
		const rVB = new Reader(header); rVB.seek(head.vertexBufferPtr);
		vbStruct = [rVB.u32(), rVB.u32(), rVB.u32(), rVB.u32()];
		console.log(`    [${vbStruct.map((v) => hex(v)).join(', ')}]`);
		console.log(`    VertexBuffer{verticesOffsetInBody=${hex(vbStruct[0])}, ?=${hex(vbStruct[1])}, bufferLength=${vbStruct[2]}, pad=${hex(vbStruct[3])}}`);
	} else {
		console.log(`    [!] pointer out of range (header is ${header.byteLength} bytes)`);
	}

	// --- Step 4: parse the first mesh and follow its ptrs through the imports ---
	console.log('\n=== Step 4: parse mesh[0] and resolve imports by pointer offset ===');
	console.log(`  resource.importOffset (raw): ${hex(chosen.r.importOffset)}  count: ${chosen.r.importCount}`);
	// Steward's parseBundle() has already run — if its file-absolute seek landed
	// inside our header block by coincidence, it would have populated bundle.imports
	// with garbage. We read our own (header-block-relative) here.
	const imports = readImportsFor(chosen.r, littleEndian, header);
	console.log(`  importCount parsed: ${imports.length}`);
	for (let i = 0; i < Math.min(imports.length, 8); i++) {
		console.log(`    [${i}] id=${hex(imports[i].resourceId, 16)}  ptrOffset=${hex(imports[i].offset)}`);
	}
	if (imports.length > 8) console.log(`    ...+${imports.length - 8} more`);

	// Build quick lookup: ptrOffset-within-header-block -> resourceId
	const importByPtr = new Map<number, bigint>();
	for (const imp of imports) importByPtr.set(imp.offset >>> 0, imp.resourceId);

	const mesh0Offset = meshOffsets[0];
	const meshStride = meshOffsets.length > 1 ? meshOffsets[1] - meshOffsets[0] : 128;
	console.log(`\n  mesh[0] @ ${hex(mesh0Offset)}  stride (mesh[1]-mesh[0]) = ${meshStride} (${hex(meshStride)})`);
	console.log('  mesh[0] raw bytes:');
	console.log(hexdump(header, Math.min(meshStride, 256), mesh0Offset));
	console.log('\n  walking mesh[0] @ ' + hex(mesh0Offset));
	const mesh0 = probeRenderableMesh(header, mesh0Offset);
	console.log(`    primitiveType: ${mesh0.primitiveType}  (4 = TRIANGLELIST)`);
	console.log(`    baseVertexIndex: ${mesh0.baseVertexIndex}  startIndex: ${mesh0.startIndex}  numIndices: ${mesh0.numIndices}`);
	console.log(`    numVertexDescriptors: ${mesh0.numVertexDescriptors}  instanceCount: ${mesh0.instanceCount}`);
	console.log(`    numVertexBuffers: ${mesh0.numVertexBuffers}  meshFlags: ${mesh0.meshFlags}`);
	console.log(`    perMeshIndexBufferPtr:  ${hex(mesh0.perMeshIndexBufferPtr)}  (expect ${hex(head.indexBufferPtr)})`);
	console.log(`    perMeshVertexBufferPtr: ${hex(mesh0.perMeshVertexBufferPtr)} (expect ${hex(head.vertexBufferPtr)})`);

	// Imports store header-block-relative ptr offsets (confirmed by eyeballing
	// the hex dump: mesh[0] material at 0xd0 = mesh0+0x50, vd ptrs at 0xe0..0xec).
	console.log(`\n    material ptr: rel(blk0)=${hex(mesh0.materialPtrFileOffset)}  value=${hex(mesh0.materialPtrValue)}`);
	const matResolved = importByPtr.get(mesh0.materialPtrFileOffset);
	console.log(`    material resolved: ${matResolved !== undefined ? hex(matResolved, 16) : '<not found>'}`);

	console.log(`\n    vertex descriptor slots:`);
	const resolvedVdIds: { slot: number; id: bigint }[] = [];
	for (let i = 0; i < mesh0.vertexDescPtrs.length; i++) {
		const slot = mesh0.vertexDescPtrs[i];
		const id = importByPtr.get(slot.fileOffset);
		console.log(`      [${i}] fileOffset=${hex(slot.fileOffset)} value=${hex(slot.value)} id=${id !== undefined ? hex(id, 16) : '-'}`);
		if (id !== undefined) resolvedVdIds.push({ slot: i, id });
	}

	// Also summarize ALL meshes' startIndex/numIndices to see if they sum.
	console.log(`\n  all meshes summary:`);
	let totalIdx = 0;
	for (let i = 0; i < meshOffsets.length; i++) {
		const m = probeRenderableMesh(header, meshOffsets[i]);
		console.log(`    [${i}] primType=${m.primitiveType} baseVtx=${m.baseVertexIndex} startIdx=${m.startIndex} numIdx=${m.numIndices} numVD=${m.numVertexDescriptors}`);
		totalIdx = Math.max(totalIdx, m.startIndex + m.numIndices);
	}
	console.log(`  highest (startIndex + numIndices) = ${totalIdx}  bytes@u16 = ${totalIdx * 2}`);

	// --- Step 5: parse at least one VertexDescriptor the mesh references ---
	console.log('\n=== Step 5: parse referenced VertexDescriptor(s) ===');
	if (resolvedVdIds.length === 0) {
		console.log('  [!] mesh[0] has no resolvable vertex descriptor imports; bailing');
		return;
	}
	// Look up the VertexDescriptor resource by resourceId.
	function findResourceById(id: bigint): { entry: ResourceEntry; index: number } | null {
		for (let i = 0; i < bundle.resources.length; i++) {
			if (rid(bundle.resources[i]) === id) return { entry: bundle.resources[i], index: i };
		}
		return null;
	}
	for (const { slot, id } of resolvedVdIds) {
		const found = findResourceById(id);
		if (!found) {
			console.log(`  slot ${slot} id ${hex(id, 16)}: resource not in this bundle`);
			continue;
		}
		const vdBlocks = getResourceBlocks(buffer, bundle, found.entry);
		const vdBytes = vdBlocks.blocks[0];
		if (!vdBytes) {
			console.log(`  slot ${slot} id ${hex(id, 16)}: resource has no block-0 data`);
			continue;
		}
		console.log(`  slot ${slot} id ${hex(id, 16)} typeId=${hex(found.entry.resourceTypeId, 5)} size=${vdBytes.byteLength}`);
		if (found.entry.resourceTypeId !== TYPE_ID.VertexDescriptor) {
			console.log(`    [!] expected VertexDescriptor (0xA) but got ${hex(found.entry.resourceTypeId, 5)} — skipping parse`);
			continue;
		}
		const vd = probeVertexDescriptor(vdBytes);
		const mode = vd.unknown2 !== 0 ? 'BPR (20-byte attrs)' : 'TUB-PC (16-byte attrs)';
		console.log(`    unknown1=${hex(vd.unknown1)}  unknown2=${hex(vd.unknown2)}  unknown3=${hex(vd.unknown3)}  attributeCount=${vd.attributeCount}  mode=${mode}`);
		for (let i = 0; i < vd.attributes.length; i++) {
			const a = vd.attributes[i];
			console.log(`      attr[${i}] type=${a.type} (${a.typeName}) offset=${a.offset} size=${a.size}`);
		}
		const expectedHeaderAndAttrs = 16 + vd.attributeCount * (vd.unknown2 !== 0 ? 20 : 16);
		const trailing = vdBytes.byteLength - expectedHeaderAndAttrs;
		console.log(`    bytes: header(16) + attrs(${vd.attributeCount}*${vd.unknown2 !== 0 ? 20 : 16}) = ${expectedHeaderAndAttrs}   raw=${vdBytes.byteLength}   trailing=${trailing}`);
		if (trailing > 0 && slot === 0) {
			console.log('    trailing bytes:');
			console.log(hexdump(vdBytes, trailing, expectedHeaderAndAttrs));
		}

		// Per-attribute vs stride reporting — Step 6 will cross-check against
		// the actual body block to decide which interpretation is correct.
		if (vd.attributes.length > 0) {
			const sumOfSizes = vd.attributes.reduce((acc, a) => acc + a.size, 0);
			const maxOffset = vd.attributes.reduce((acc, a) => Math.max(acc, a.offset + a.size), 0);
			console.log(`    sum of attr.size = ${sumOfSizes}`);
			console.log(`    max (offset+size) = ${maxOffset}`);
			console.log(`    first attr size = ${vd.attributes[0].size}`);
		}
	}

	// --- Step 6: body block layout — where do indices and vertices live? ---
	console.log('\n=== Step 6: body block layout ===');
	if (!body) {
		console.log('  [!] no body block');
	} else {
		// Sum numIndices across all meshes (BPR interpretation: 0x4C field is
		// total u16 indices for the mesh).
		let totalIndices = 0;
		for (let i = 0; i < meshOffsets.length; i++) {
			const m = probeRenderableMesh(header, meshOffsets[i]);
			totalIndices += m.numIndices;
		}
		console.log(`  sum of all mesh.numIndices = ${totalIndices}  (bytes@u16 = ${totalIndices * 2})`);
		console.log(`  body size = ${body.byteLength}`);
		const vertexBytes = body.byteLength - totalIndices * 2;
		console.log(`  implied vertex-data bytes = body - indices = ${vertexBytes}`);
		// Total vertex count: highest (startIndex + numIndices) is NOT the vertex
		// count; indices are arbitrary values in [0, numVerts). So we can't back-
		// compute numVerts without peeking the first VertexDescriptor's stride.

		console.log('\n  first 32 bytes of body:');
		console.log(hexdump(body, 32, 0));
		const indicesEnd = totalIndices * 2;
		console.log(`\n  bytes around putative indices/vertices boundary at ${hex(indicesEnd)}:`);
		const dumpFrom = Math.max(0, indicesEnd - 16);
		console.log(hexdump(body, 64, dumpFrom));

		// Peek first 12 u16 indices
		const dv = new DataView(body.buffer, body.byteOffset, Math.min(body.byteLength, 24));
		const peek: number[] = [];
		for (let i = 0; i + 2 <= dv.byteLength; i += 2) peek.push(dv.getUint16(i, true));
		console.log(`\n  first 12 u16 at body+0: [${peek.join(', ')}]`);

		// Scan ALL used indices to find the max — confirms total vertex count.
		// Assume indices for all meshes live in [0, totalIndices*2), following
		// each mesh's (startIndex*2, numIndices*2) slice.
		let maxIndex = -1;
		let perMeshMax: number[] = [];
		for (let mi = 0; mi < meshOffsets.length; mi++) {
			const m = probeRenderableMesh(header, meshOffsets[mi]);
			let mmax = -1;
			const fullDv = new DataView(body.buffer, body.byteOffset, body.byteLength);
			for (let k = 0; k < m.numIndices; k++) {
				const pos = (m.startIndex + k) * 2;
				if (pos + 2 > body.byteLength) break;
				const v = fullDv.getUint16(pos, true);
				if (v > mmax) mmax = v;
				if (v > maxIndex) maxIndex = v;
			}
			perMeshMax.push(mmax);
		}
		console.log(`  per-mesh max index: [${perMeshMax.join(', ')}]`);
		console.log(`  global max index:   ${maxIndex}  → implied vertex count = ${maxIndex + 1}`);
		console.log(`  vertex bytes / stride52 = ${74688 / 52}  vs  maxIndex+1 = ${maxIndex + 1}`);

		// Peek first 12 floats at indicesEnd
		if (indicesEnd + 48 <= body.byteLength) {
			const fdv = new DataView(body.buffer, body.byteOffset + indicesEnd, 48);
			const floats: string[] = [];
			for (let i = 0; i < 12; i++) floats.push(fdv.getFloat32(i * 4, true).toFixed(3));
			console.log(`  first 12 f32 at body+${hex(indicesEnd)}: [${floats.join(', ')}]`);
		}

		// Match against the "VB struct" values at header 0x48 and 0x60 so we can
		// see whether they describe body offsets/lengths for index and vertex data.
		console.log(`\n  header u32s around IB/VB structs (for cross-reference):`);
		console.log(`    IB-struct @ 0x48: [${[0x48, 0x4C, 0x50, 0x54].map((o) => hex(new DataView(header.buffer, header.byteOffset + o, 4).getUint32(0, true))).join(', ')}]`);
		console.log(`    VB-struct @ 0x60: [${[0x60, 0x64, 0x68, 0x6C].map((o) => hex(new DataView(header.buffer, header.byteOffset + o, 4).getUint32(0, true))).join(', ')}]`);
		console.log(`    tail            : [${[0x70, 0x74, 0x78, 0x7C].map((o) => hex(new DataView(header.buffer, header.byteOffset + o, 4).getUint32(0, true))).join(', ')}]`);
	}
}

main();
