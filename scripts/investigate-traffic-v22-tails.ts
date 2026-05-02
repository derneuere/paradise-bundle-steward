// V22 TrafficData — focused hex/struct dump of header, PVS, hull #0 vs hull
// with content, and the four tail regions. Designed to triangulate field
// layouts for the v22 → v45 migration (issue #45 follow-up).

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseBundle } from '../src/lib/core/bundle';
import { RESOURCE_TYPE_IDS } from '../src/lib/core/types';
import { extractResourceSize, isCompressed, decompressData } from '../src/lib/core/resourceManager';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function extractTraffic(filePath: string): Uint8Array {
	const raw = fs.readFileSync(filePath);
	const bytes = new Uint8Array(raw.byteLength);
	bytes.set(raw);
	const bundle = parseBundle(bytes.buffer);
	const resource = bundle.resources.find((r) => r.resourceTypeId === RESOURCE_TYPE_IDS.TRAFFIC_DATA);
	if (!resource) throw new Error('no TrafficData resource');
	for (let bi = 0; bi < 3; bi++) {
		const size = extractResourceSize(resource.sizeAndAlignmentOnDisk[bi]);
		if (size <= 0) continue;
		const base = bundle.header.resourceDataOffsets[bi] >>> 0;
		const rel = resource.diskOffsets[bi] >>> 0;
		const start = (base + rel) >>> 0;
		let slice = new Uint8Array(bytes.buffer.slice(start, start + size));
		if (isCompressed(slice)) slice = decompressData(slice) as Uint8Array;
		return slice;
	}
	throw new Error('no populated block');
}

const v22 = extractTraffic(path.join(REPO, 'example/older builds/B5Traffic.bndl'));

// Big-endian field readers (v22 is X360 BE)
function be32(buf: Uint8Array, off: number): number {
	return ((buf[off] << 24) | (buf[off + 1] << 16) | (buf[off + 2] << 8) | buf[off + 3]) >>> 0;
}
function be16(buf: Uint8Array, off: number): number {
	return (buf[off] << 8) | buf[off + 1];
}
function bef32(buf: Uint8Array, off: number): number {
	const u = be32(buf, off);
	const view = new DataView(new ArrayBuffer(4));
	view.setUint32(0, u, false);
	return view.getFloat32(0, false);
}
function hex(buf: Uint8Array, off: number, n: number): string {
	const slice = buf.slice(off, off + n);
	return Array.from(slice).map((b) => b.toString(16).padStart(2, '0')).join(' ');
}

console.log('='.repeat(78));
console.log('V22 HEADER (0x00..0x30)');
console.log('='.repeat(78));
for (let off = 0; off < 0x30; off += 4) {
	const u32 = be32(v22, off);
	const f32 = bef32(v22, off);
	const ascii = String.fromCharCode(...v22.slice(off, off + 4)).replace(/[^\x20-\x7e]/g, '.');
	console.log(`  0x${off.toString(16).padStart(2, '0')}: ${hex(v22, off, 4)}  u32=${u32}  f32=${f32.toFixed(4)}  "${ascii}"`);
}

const muDataVersion = v22[0];
const muNumHulls = be16(v22, 0x02);
const muSize = be32(v22, 0x04);
const ptrPvs = be32(v22, 0x08);
const ptrHulls = be32(v22, 0x0c);
const ptrTailA = be32(v22, 0x10);
const muNumFlow = be16(v22, 0x14);
const muNumVeh = be16(v22, 0x16);
const ptrTailB = be32(v22, 0x18);
const ptrTailC = be32(v22, 0x1c);
const ptrTailD = be32(v22, 0x20);
console.log();
console.log(`  Decoded: ver=${muDataVersion}, hulls=${muNumHulls}, size=${muSize}, ptrPvs=0x${ptrPvs.toString(16)}, ptrHulls=0x${ptrHulls.toString(16)}`);
console.log(`           tailA=0x${ptrTailA.toString(16)}, flow=${muNumFlow}, veh=${muNumVeh}, tailB=0x${ptrTailB.toString(16)}, tailC=0x${ptrTailC.toString(16)}, tailD=0x${ptrTailD.toString(16)}`);

console.log();
console.log('='.repeat(78));
console.log('V22 PVS HEADER (16 u32s = 64 bytes? or 12 = 48?)');
console.log('='.repeat(78));
for (let off = ptrPvs; off < ptrPvs + 0x40; off += 4) {
	const u32 = be32(v22, off);
	const f32 = bef32(v22, off);
	const rel = off - ptrPvs;
	console.log(`  +0x${rel.toString(16).padStart(2, '0')}: ${hex(v22, off, 4)}  u32=${u32}  f32=${f32.toFixed(4)}`);
}

// Check what's at +0x24 — is it `muNumCells_Z` or `muNumHulls` or junk?
console.log();
console.log(`  Heuristic: at +0x24 we read ${be32(v22, ptrPvs + 0x24)}, which equals muNumHulls=${muNumHulls}? ${be32(v22, ptrPvs + 0x24) === muNumHulls}`);

// Verify that the v22 PVS layout matches the v45-minus-mCellSize hypothesis.
// In retail the order is: mGridMin, mCellSize, mRecipCellSize, X, Z, n,
// ptrHullPvs. In v22 the hypothesis is: mGridMin, mRecipCellSize, X, Z, n,
// ptrHullPvs (no mCellSize). At +0x20 = X, +0x24 = Z, +0x28 = n.
// If +0x24 = muNumHulls = 342, that's a HUGE Z. Cells X=19 × Z=342 = 6498
// total grid cells, but only 96 populated. PC retail follows X*Z = total
// (unpopulated cells get an empty PvsHullSet entry); the v22 convention
// might be sparse-listing only populated cells.
//
// Let's also check whether the count following PVS header (96) makes sense
// as the populated-set count by counting hullPvsSets we can decode there.

console.log();
console.log('='.repeat(78));
console.log('V22 HULLS — pointer table sample (first 16 entries)');
console.log('='.repeat(78));
for (let i = 0; i < Math.min(16, muNumHulls); i++) {
	const ptr = be32(v22, ptrHulls + i * 4);
	console.log(`  hull[${i}] -> 0x${ptr.toString(16)}`);
}
// For a non-empty hull, dump the first 0x60 bytes
const hullPtrs: number[] = [];
for (let i = 0; i < muNumHulls; i++) hullPtrs.push(be32(v22, ptrHulls + i * 4));
const firstNonEmptyIdx = hullPtrs.findIndex((p, i) => i + 1 < hullPtrs.length && (hullPtrs[i + 1] - p) > 0x30);
console.log();
console.log(`First non-empty hull is index ${firstNonEmptyIdx} (next pointer is +0x${(hullPtrs[firstNonEmptyIdx + 1] - hullPtrs[firstNonEmptyIdx]).toString(16)} away)`);
const nonEmptyPtr = hullPtrs[firstNonEmptyIdx];
console.log(`Hex dump of hull[${firstNonEmptyIdx}] header (first 0x40 bytes):`);
for (let off = 0; off < 0x40; off += 16) {
	console.log(`  +0x${off.toString(16).padStart(2, '0')}: ${hex(v22, nonEmptyPtr + off, 16)}`);
}

console.log();
console.log('='.repeat(78));
console.log('V22 TAIL A (flow types? 1792 bytes / 27 records = 66.37 avg)');
console.log('='.repeat(78));
// Check if first 27 u32 (=108 bytes) look like an offset/pointer table.
console.log('First 32 u32be values from tailA (looking for pointer-table pattern):');
for (let i = 0; i < 32; i++) {
	const off = ptrTailA + i * 4;
	const u = be32(v22, off);
	console.log(`  +0x${(i * 4).toString(16).padStart(3, '0')} (file 0x${off.toString(16)}): 0x${u.toString(16).padStart(8, '0')} = ${u}`);
}

console.log();
console.log('='.repeat(78));
console.log('V22 TAIL B (vehicle types? 432 bytes / 27 = 16 B each)');
console.log('='.repeat(78));
console.log('First 5 records (16 B each, broken into 4 × u32):');
for (let i = 0; i < 5; i++) {
	const o = ptrTailB + i * 16;
	const a = be32(v22, o), b = be32(v22, o + 4), c = be32(v22, o + 8), d = be32(v22, o + 12);
	const af = bef32(v22, o), bf = bef32(v22, o + 4);
	console.log(`  rec[${i}] @0x${o.toString(16)}: ${hex(v22, o, 16)}`);
	console.log(`         u32: ${a.toString(16).padStart(8, '0')} ${b.toString(16).padStart(8, '0')} ${c.toString(16).padStart(8, '0')} ${d.toString(16).padStart(8, '0')}`);
	console.log(`         f32: ${af.toFixed(3)} ${bf.toFixed(3)}`);
}

console.log();
console.log('='.repeat(78));
console.log('V22 TAIL C (vehicle update? 544 = 27×20 + 4 padding; v45 layout = 5×f32)');
console.log('='.repeat(78));
console.log('First 3 records as 5 × f32be:');
for (let i = 0; i < 3; i++) {
	const o = ptrTailC + i * 20;
	const f = [bef32(v22, o), bef32(v22, o + 4), bef32(v22, o + 8), bef32(v22, o + 12), bef32(v22, o + 16)];
	console.log(`  rec[${i}] @0x${o.toString(16)}: wheelR=${f[0].toFixed(3)} suspRoll=${f[1].toFixed(3)} suspPitch=${f[2].toFixed(3)} suspTravel=${f[3].toFixed(3)} mass=${f[4].toFixed(3)}`);
}

console.log();
console.log('='.repeat(78));
console.log('V22 TAIL D (vehicle assets? 324 = 27×12, ASCII at start)');
console.log('='.repeat(78));
console.log('First 5 records (12 B each):');
for (let i = 0; i < 5; i++) {
	const o = ptrTailD + i * 12;
	const namebytes = v22.slice(o, o + 8);
	const name = String.fromCharCode(...namebytes).replace(/\0+$/, '');
	const trail = be32(v22, o + 8);
	console.log(`  rec[${i}] @0x${o.toString(16)}: name="${name}" trail=0x${trail.toString(16).padStart(8, '0')} bytes=[${hex(v22, o, 12)}]`);
}

console.log();
console.log('='.repeat(78));
console.log('V45 RETAIL VEHICLE ASSETS for cross-reference');
console.log('='.repeat(78));
const v45Bytes = extractTraffic(path.join(REPO, 'example/B5TRAFFIC.BNDL'));
// v45 ptrVehicleAssets = header offset 0x34
function le32(buf: Uint8Array, off: number): number {
	return (buf[off] | (buf[off + 1] << 8) | (buf[off + 2] << 16) | (buf[off + 3] << 24)) >>> 0;
}
const v45PtrVA = le32(v45Bytes, 0x34);
const v45NumVA = v45Bytes[0x18];
console.log(`v45 ptrVehicleAssets=0x${v45PtrVA.toString(16)}, numVehicleAssets=${v45NumVA}`);
console.log('First 5 v45 vehicleAssets (8 B each = u64 CgsID):');
for (let i = 0; i < 5; i++) {
	const o = v45PtrVA + i * 8;
	const lo = le32(v45Bytes, o);
	const hi = le32(v45Bytes, o + 4);
	const big = (BigInt(hi) << 32n) | BigInt(lo);
	console.log(`  asset[${i}] = 0x${big.toString(16).padStart(16, '0')}`);
}

// Compare: v22 first 5 names with v45 first 5 hashes.
// CgsID hashes Burnout's compile-time strings to u64 (CRC32-based fold). If
// v22 stores the raw name and v45 stores the hash of the same name, we can
// confirm the mapping by hashing v22's names and checking against v45.

console.log();
console.log('='.repeat(78));
console.log('V22 TAIL A — block-pattern analysis');
console.log('='.repeat(78));
// Try: first 4 bytes of tailA = pointer to start of inline data; per-flow
// records are variable size.
const tailA0 = be32(v22, ptrTailA);
console.log(`tailA[0] as u32be = 0x${tailA0.toString(16)} (vs ptrTailA=0x${ptrTailA.toString(16)}); delta = ${tailA0 - ptrTailA}`);
// If we see `ptr_table[27 entries], then per-flow data` the first pointer should
// be at ptrTailA + 27*N where N is the table-entry size.
// 27 × 4 = 108; 27 × 8 = 216; 27 × 12 = 324; 27 × 16 = 432.
// Check whether the "pointers" are absolute file offsets pointing back into tailA.
let monotonic = true;
let prev = 0;
const candidates = [];
for (let i = 0; i < 60; i++) {
	const v = be32(v22, ptrTailA + i * 4);
	if (v < ptrTailA || v > ptrTailA + 1792) { monotonic = false; break; }
	if (v < prev) { monotonic = false; break; }
	candidates.push(v);
	prev = v;
}
if (monotonic && candidates.length > 0) {
	console.log(`Monotonic in-range pointer table found, first ${candidates.length} entries:`);
	for (let i = 0; i < Math.min(candidates.length, 15); i++) {
		console.log(`  +0x${(i * 4).toString(16)}: -> rel ${candidates[i] - ptrTailA}`);
	}
} else {
	console.log('Not a clean pointer table (values escape the tailA region).');
}
