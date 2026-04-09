// Probe the GraphicsSpec resource in a vehicle bundle so we can write the
// real parser. Same approach as probe-renderable.ts: dump the header bytes,
// dump the import table, eyeball the layout against the wiki spec.
//
// Wiki layout (32-bit):
//   0x00 u32 muVersion (= 3)
//   0x04 u32 muPartsCount
//   0x08 Model**         mppPartsModels        (note: "8-bit integers aligned 4")
//   0x0C u32 muShatteredGlassPartsCount
//   0x10 ShatteredGlassPart* mpShatteredGlassParts
//   0x14 Matrix44Affine* mpPartLocators
//   0x18 uint8_t*        mpPartVolumeIDs
//   0x1C uint8_t*        mpNumRigidBodiesForPart
//   0x20 Matrix44Affine** mppRigidBodyToSkinMatrixTransforms
//
// Header = 0x24 bytes. Pointer fields are u32, patched via the in-header
// import table at resource.importOffset (header-block-relative — see
// docs/Renderable_findings.md §3).

import * as fs from 'node:fs';
import * as path from 'node:path';

import { parseBundle } from '../src/lib/core/bundle';
import { extractResourceSize, isCompressed, decompressData } from '../src/lib/core/resourceManager';
import { u64ToBigInt } from '../src/lib/core/u64';
import type { ResourceEntry } from '../src/lib/core/types';

const GRAPHICS_SPEC_TYPE_ID = 0x10006;
const MODEL_TYPE_ID = 0x2A;

function hex(n: number | bigint, width = 8): string {
	return '0x' + n.toString(16).padStart(width, '0');
}

function hexdump(bytes: Uint8Array, length = 256, startOffset = 0): string {
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

function getBlock0(buffer: ArrayBuffer, bundle: ReturnType<typeof parseBundle>, resource: ResourceEntry): Uint8Array | null {
	const size = extractResourceSize(resource.sizeAndAlignmentOnDisk[0]);
	if (size <= 0) return null;
	const base = bundle.header.resourceDataOffsets[0] >>> 0;
	const rel = resource.diskOffsets[0] >>> 0;
	const start = (base + rel) >>> 0;
	if (start + size > buffer.byteLength) return null;
	let bytes = new Uint8Array(buffer, start, size);
	if (isCompressed(bytes)) bytes = decompressData(bytes);
	return bytes;
}

function readImportTable(header: Uint8Array, resource: ResourceEntry): { id: bigint; offset: number }[] {
	const out: { id: bigint; offset: number }[] = [];
	if (resource.importCount === 0) return out;
	const dv = new DataView(header.buffer, header.byteOffset, header.byteLength);
	const base = resource.importOffset >>> 0;
	for (let i = 0; i < resource.importCount; i++) {
		const p = base + i * 16;
		if (p + 16 > header.byteLength) break;
		const lo = BigInt(dv.getUint32(p + 0, true));
		const hi = BigInt(dv.getUint32(p + 4, true));
		const id = (hi << 32n) | (lo & 0xFFFFFFFFn);
		const off = dv.getUint32(p + 8, true);
		out.push({ id, offset: off });
	}
	return out;
}

function main() {
	const bundlePath = process.argv[2] ?? 'example/VEH_CARBRWDS_GR.BIN';
	const abs = path.resolve(bundlePath);
	console.log(`bundle: ${abs}`);
	const fileBuf = fs.readFileSync(abs);
	const buffer = fileBuf.buffer.slice(fileBuf.byteOffset, fileBuf.byteOffset + fileBuf.byteLength);
	const bundle = parseBundle(buffer);

	// 1. Find the (single) GraphicsSpec.
	const gs = bundle.resources.find((r) => r.resourceTypeId === GRAPHICS_SPEC_TYPE_ID);
	if (!gs) {
		console.log('  [!] no GraphicsSpec in this bundle');
		return;
	}
	console.log(`  GraphicsSpec id ${hex(u64ToBigInt(gs.resourceId), 16)}  importCount ${gs.importCount}  importOffset ${hex(gs.importOffset)}`);

	const header = getBlock0(buffer, bundle, gs);
	if (!header) { console.log('  [!] no header'); return; }
	console.log(`  header size: ${header.byteLength} bytes\n`);

	console.log('  full header dump:');
	console.log(hexdump(header, header.byteLength));

	// 2. Parse the documented header fields.
	const dv = new DataView(header.buffer, header.byteOffset, header.byteLength);
	const muVersion = dv.getUint32(0x00, true);
	const muPartsCount = dv.getUint32(0x04, true);
	const mppPartsModels = dv.getUint32(0x08, true);
	const muShatteredGlassPartsCount = dv.getUint32(0x0C, true);
	const mpShatteredGlassParts = dv.getUint32(0x10, true);
	const mpPartLocators = dv.getUint32(0x14, true);
	const mpPartVolumeIDs = dv.getUint32(0x18, true);
	const mpNumRigidBodiesForPart = dv.getUint32(0x1C, true);
	const mppRigidBodyToSkinMatrixTransforms = dv.getUint32(0x20, true);

	console.log('\n  parsed header (32-bit wiki layout):');
	console.log(`    muVersion                       = ${muVersion}`);
	console.log(`    muPartsCount                    = ${muPartsCount}`);
	console.log(`    mppPartsModels                  = ${hex(mppPartsModels)}`);
	console.log(`    muShatteredGlassPartsCount      = ${muShatteredGlassPartsCount}`);
	console.log(`    mpShatteredGlassParts           = ${hex(mpShatteredGlassParts)}`);
	console.log(`    mpPartLocators                  = ${hex(mpPartLocators)}`);
	console.log(`    mpPartVolumeIDs                 = ${hex(mpPartVolumeIDs)}`);
	console.log(`    mpNumRigidBodiesForPart         = ${hex(mpNumRigidBodiesForPart)}`);
	console.log(`    mppRigidBodyToSkinMatrixTransforms = ${hex(mppRigidBodyToSkinMatrixTransforms)}`);

	// 3. Read the import table — these are header-block-relative ptr offsets.
	const imports = readImportTable(header, gs);
	console.log(`\n  imports (${imports.length}):`);
	for (let i = 0; i < imports.length; i++) {
		console.log(`    [${i}] id=${hex(imports[i].id, 16)}  ptrOffset=${hex(imports[i].offset)}`);
	}

	// 4. Cross-check: which imports are Models vs other types? Look up each id.
	const findById = (id: bigint): ResourceEntry | null => {
		for (const r of bundle.resources) {
			if (u64ToBigInt(r.resourceId) === id) return r;
		}
		return null;
	};
	console.log(`\n  import resolution:`);
	let modelCount = 0;
	for (let i = 0; i < imports.length; i++) {
		const r = findById(imports[i].id);
		const t = r ? `typeId=${hex(r.resourceTypeId, 5)}` : 'NOT FOUND';
		if (r && r.resourceTypeId === MODEL_TYPE_ID) modelCount++;
		console.log(`    [${i}] ${hex(imports[i].id, 16)} → ${t}`);
	}
	console.log(`  ${modelCount} Models in import table (expect ≈ muPartsCount=${muPartsCount})`);

	// 5. Read the mppPartsModels array. Per wiki: "8-bit integers aligned 4".
	//    Means an array of u8 indices (not pointers), aligned to 4 bytes.
	if (mppPartsModels > 0 && mppPartsModels + muPartsCount <= header.byteLength) {
		console.log(`\n  mppPartsModels[${muPartsCount}] @ ${hex(mppPartsModels)}:`);
		const indices: number[] = [];
		for (let i = 0; i < muPartsCount; i++) {
			indices.push(header[mppPartsModels + i]);
		}
		console.log(`    [${indices.join(', ')}]`);
	}

	// 6. Read mpPartLocators. Try BOTH stride 48 (4x3 affine) and 64 (full 4x4
	// matrix). BundleManager's ReadMatrix4 reads 16 floats; the wiki says
	// "Matrix44Affine" which usually implies 48 bytes — but the wiki has been
	// wrong about other layout details in this same struct. Stride is the
	// fundamental thing to verify before trusting the read.
	console.log(`  header.byteLength = ${header.byteLength}`);
	for (const stride of [48, 64]) {
		if (mpPartLocators + muPartsCount * stride > header.byteLength) {
			console.log(`\n  mpPartLocators stride ${stride}: would run past header (${mpPartLocators + muPartsCount * stride} > ${header.byteLength}) — skip`);
			continue;
		}
		const floatsPerMatrix = stride / 4;
		console.log(`\n  mpPartLocators @ ${hex(mpPartLocators)} stride ${stride} (${floatsPerMatrix} floats):`);
		const ndv = new DataView(header.buffer, header.byteOffset + mpPartLocators, muPartsCount * stride);
		for (let p = 0; p < Math.min(muPartsCount, 6); p++) {
			const floats: number[] = [];
			for (let i = 0; i < floatsPerMatrix; i++) floats.push(ndv.getFloat32(p * stride + i * 4, true));
			console.log(`    [${p}] floats (${floats.length}):`);
			// Format as N rows of 4 floats (works for both 12-float 3x4 and 16-float 4x4).
			const cols = stride === 64 ? 4 : 4;
			const rows = floatsPerMatrix / cols;
			for (let r = 0; r < rows; r++) {
				const row = floats.slice(r * cols, (r + 1) * cols).map((f) => f.toFixed(3).padStart(7, ' ')).join(' ');
				console.log(`         | ${row} |`);
			}
		}
	}

	// 7. Sanity: where exactly does the locators block end? If stride is 48 it
	// should end at mpPartLocators + 32*48 = mpPartLocators + 1536. If stride
	// is 64 it should end at +2048. Compare against the next defined offset
	// (mpPartVolumeIDs).
	console.log(`\n  next offset after locators (mpPartVolumeIDs) = ${hex(mpPartVolumeIDs)}`);
	console.log(`    diff from mpPartLocators = ${mpPartVolumeIDs - mpPartLocators}`);
	console.log(`    /partsCount = ${(mpPartVolumeIDs - mpPartLocators) / muPartsCount}  (= bytes per locator)`);
}

main();
