// V22 → V45 TrafficData mapping verification.
//
// Step 3 of the migration triangulation: confirm the field-by-field maps
// hypothesised in `investigate-traffic-v22-tails.ts`:
//
// 1. Verify v22 vehicleType CgsID embedding (tailB rec[i] first 8 B)
//    matches v45 vehicleAssets[k] for some k. CgsID is a base-40 packing of
//    the asset name; tailD stores the same name as plaintext, so encoding
//    a v22 tailD name should land on the corresponding tailB CgsID.
// 2. Confirm tailC layout = 27 × 5×f32 (vehicleTypeUpdate, identical to v45).
// 3. Confirm tailA pointer-table + inline FlowType layout decodes cleanly.
// 4. Decode v22 hull[22] sub-array sizes via pointer deltas.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseBundle } from '../src/lib/core/bundle';
import { RESOURCE_TYPE_IDS } from '../src/lib/core/types';
import { extractResourceSize, isCompressed, decompressData } from '../src/lib/core/resourceManager';
import { encodeCgsId } from '../src/lib/core/cgsid';

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

function be32(buf: Uint8Array, off: number): number {
	return ((buf[off] << 24) | (buf[off + 1] << 16) | (buf[off + 2] << 8) | buf[off + 3]) >>> 0;
}
function be16(buf: Uint8Array, off: number): number {
	return (buf[off] << 8) | buf[off + 1];
}
function be64(buf: Uint8Array, off: number): bigint {
	return (BigInt(be32(buf, off)) << 32n) | BigInt(be32(buf, off + 4));
}
function le32(buf: Uint8Array, off: number): number {
	return (buf[off] | (buf[off + 1] << 8) | (buf[off + 2] << 16) | (buf[off + 3] << 24)) >>> 0;
}
function le64(buf: Uint8Array, off: number): bigint {
	return (BigInt(le32(buf, off + 4)) << 32n) | BigInt(le32(buf, off));
}

const v22 = extractTraffic(path.join(REPO, 'example/older builds/B5Traffic.bndl'));
const v45 = extractTraffic(path.join(REPO, 'example/B5TRAFFIC.BNDL'));

const ptrTailA = be32(v22, 0x10);
const ptrTailB = be32(v22, 0x18);
const ptrTailC = be32(v22, 0x1c);
const ptrTailD = be32(v22, 0x20);
const muNumFlow = be16(v22, 0x14);
const muNumVeh = be16(v22, 0x16);

// =============================================================================
// 1. Verify CgsID name → hash mapping
// =============================================================================
console.log('='.repeat(78));
console.log('CgsID NAME → HASH VERIFICATION (tailD names → tailB CgsIDs)');
console.log('='.repeat(78));
let matches = 0;
for (let i = 0; i < muNumVeh; i++) {
	const nameOff = ptrTailD + i * 12;
	const nameBytes = v22.slice(nameOff, nameOff + 8);
	const name = String.fromCharCode(...nameBytes).replace(/\0+$/, '');
	const tailBCgsID = be64(v22, ptrTailB + i * 16);
	const computedCgsID = encodeCgsId(name);
	const ok = tailBCgsID === computedCgsID;
	if (ok) matches++;
	if (i < 8 || !ok) {
		console.log(`  [${i.toString().padStart(2)}] name="${name.padEnd(10)}" tailB=0x${tailBCgsID.toString(16).padStart(16, '0')}  encode("${name}")=0x${computedCgsID.toString(16).padStart(16, '0')}  ${ok ? 'OK' : 'MISMATCH'}`);
	}
}
console.log(`Total ${matches}/${muNumVeh} names hashed correctly to their tailB CgsIDs.`);

// =============================================================================
// 2. tailC = vehicleTypeUpdate (5×f32) — confirm by spot-check
// =============================================================================
console.log();
console.log('='.repeat(78));
console.log('tailC = vehicleTypeUpdate (5×f32; matches v45 layout)');
console.log('='.repeat(78));
const v45PtrVTU = le32(v45, 0x30);
const v45NumVT = le16(v45, 0x16);
function le16(buf: Uint8Array, off: number): number {
	return buf[off] | (buf[off + 1] << 8);
}
function lef32(buf: Uint8Array, off: number): number {
	const view = new DataView(new ArrayBuffer(4));
	view.setUint32(0, le32(buf, off), true);
	return view.getFloat32(0, true);
}
function bef32(buf: Uint8Array, off: number): number {
	const view = new DataView(new ArrayBuffer(4));
	view.setUint32(0, be32(buf, off), false);
	return view.getFloat32(0, false);
}

console.log(`v22 tailC (BE) — vehicle update[0..2]:`);
for (let i = 0; i < 3; i++) {
	const o = ptrTailC + i * 20;
	const f = [bef32(v22, o), bef32(v22, o + 4), bef32(v22, o + 8), bef32(v22, o + 12), bef32(v22, o + 16)];
	console.log(`  [${i}] wheelR=${f[0].toFixed(3)} suspRoll=${f[1].toFixed(3)} suspPitch=${f[2].toFixed(3)} suspTravel=${f[3].toFixed(3)} mass=${f[4].toFixed(3)}`);
}
console.log(`v45 vehicleTypesUpdate (LE) — first 3:`);
for (let i = 0; i < 3; i++) {
	const o = v45PtrVTU + i * 20;
	const f = [lef32(v45, o), lef32(v45, o + 4), lef32(v45, o + 8), lef32(v45, o + 12), lef32(v45, o + 16)];
	console.log(`  [${i}] wheelR=${f[0].toFixed(3)} suspRoll=${f[1].toFixed(3)} suspPitch=${f[2].toFixed(3)} suspTravel=${f[3].toFixed(3)} mass=${f[4].toFixed(3)}`);
}

// =============================================================================
// 3. tailA = flow types (pointer table + inline records)
// =============================================================================
console.log();
console.log('='.repeat(78));
console.log('tailA = flow types (pointer table + inline records)');
console.log('='.repeat(78));
console.log(`muNumFlowTypes = ${muNumFlow}, pointer table = ${muNumFlow * 4} B, then 4 B padding, then inline records.`);
const flowPtrs: number[] = [];
for (let i = 0; i < muNumFlow; i++) flowPtrs.push(be32(v22, ptrTailA + i * 4));
flowPtrs.push(ptrTailA + 1792); // synthetic end
const sizes = flowPtrs.slice(0, muNumFlow).map((p, i) => flowPtrs[i + 1] - p);
console.log(`Per-flow record sizes (bytes): [${sizes.slice(0, 15).join(', ')}, ...]`);
const sizeFreq = new Map<number, number>();
for (const s of sizes) sizeFreq.set(s, (sizeFreq.get(s) ?? 0) + 1);
console.log(`Size distribution: ${[...sizeFreq.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}B×${v}`).join(', ')}`);

// Decode flow type [0] under the hypothesis: header (16 B = ptr_ids + ptr_probs + count + 12 B padding), then probs[count] aligned, then ids[count] aligned.
// Or simpler: header (8 B = count u32 + something), then ids[count] u16, then probs[count] u8.
console.log();
console.log('Decoding flow type [0] hex (full record):');
const flowSize0 = sizes[0];
console.log('  ' + Array.from(v22.slice(flowPtrs[0], flowPtrs[0] + flowSize0)).map(b => b.toString(16).padStart(2, '0')).join(' '));
const flowHdr = be32(v22, flowPtrs[0]);
const flowHdr1 = be32(v22, flowPtrs[0] + 4);
const flowHdr2 = be32(v22, flowPtrs[0] + 8);
console.log(`  u32be[0..2]: 0x${flowHdr.toString(16)}, 0x${flowHdr1.toString(16)}, 0x${flowHdr2.toString(16)}`);

// The first u32 looks like an inner pointer (e.g. 0x0042c2e0 from earlier
// dump). If so, the v22 flow type structure is similar to v45's:
//   ptr_vehicleTypeIds (4)
//   ptr_cumulativeProbs (4)
//   count (4)
//   pad (4)
//   ... data inline
// = 16 B header + N×u16 + N×u8 inline.

// Compute count: take (flowSize0 - 16) and split into ids+probs.
// If count = N, total inline = 2N + N = 3N bytes (plus alignment).
const expectedDataBytes = flowSize0 - 16;
console.log(`  Inline data = ${expectedDataBytes} B; if 3N: N = ${expectedDataBytes / 3} (must be int)`);
// 0x40 - 16 = 48 = 3 × 16. So count = 16. Matches the "count_byte=0x10" guess from the previous run.

// Reread byte-by-byte assuming count = 16
console.log('  Hypothesis: 16-vehicle flow record, layout = ptr_ids + ptr_probs + count_u32 + pad_u32 + data');

// =============================================================================
// 4. v22 hull #22 sub-array sizes
// =============================================================================
console.log();
console.log('='.repeat(78));
console.log('v22 hull[22] header decode + sub-array sizes');
console.log('='.repeat(78));
const ptrHulls = be32(v22, 0x0c);
const muNumHulls = be16(v22, 0x02);
const hullPtrs: number[] = [];
for (let i = 0; i < muNumHulls; i++) hullPtrs.push(be32(v22, ptrHulls + i * 4));
const hullEnd = (i: number) => i + 1 < hullPtrs.length ? hullPtrs[i + 1] : ptrTailA;

const hullIdx = 22;
const hOff = hullPtrs[hullIdx];
const hNext = hullEnd(hullIdx);
console.log(`hull[${hullIdx}] @0x${hOff.toString(16)}, next @0x${hNext.toString(16)} (size = ${hNext - hOff} B)`);
console.log('Header bytes:');
console.log(`  +0x00 (counts): ${Array.from(v22.slice(hOff, hOff + 8)).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
const counts = {
	muNumSections: v22[hOff],
	c1: v22[hOff + 1],
	c2: v22[hOff + 2],
	c3: v22[hOff + 3],
	c4: v22[hOff + 4],
	c5: v22[hOff + 5],
	c6: v22[hOff + 6],
	c7: v22[hOff + 7],
};
console.log(`  decoded: muNumSections=${counts.muNumSections}, c1..c7=[${counts.c1},${counts.c2},${counts.c3},${counts.c4},${counts.c5},${counts.c6},${counts.c7}]`);

// 8 pointers at +0x08..+0x27
const subPtrs: number[] = [];
for (let i = 0; i < 8; i++) subPtrs.push(be32(v22, hOff + 8 + i * 4));
console.log('Sub-array pointers:');
for (let i = 0; i < 8; i++) {
	const next = i + 1 < 8 ? subPtrs[i + 1] : hNext;
	const size = next - subPtrs[i];
	console.log(`  ptr[${i}] = 0x${subPtrs[i].toString(16)}  (size to next = ${size} B)`);
}

// 0x28..0x2F is padding (8 bytes)
console.log(`  +0x28 (padding 8B): ${Array.from(v22.slice(hOff + 0x28, hOff + 0x30)).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);

// Try to decode: if muNumSections=2, then ptr[0] points to 2 sections, each
// of size (subPtrs[1]-subPtrs[0])/2 bytes = (0x2530-0x24d0)/2 = 96/2 = 48 B
// per section. Compare with v45's section size (it's also 0x30 = 48 bytes)!
const sectionRegionSize = subPtrs[1] - subPtrs[0];
console.log(`\nSection region: ${sectionRegionSize} B for ${counts.muNumSections} sections`);
if (counts.muNumSections > 0) {
	const perSection = sectionRegionSize / counts.muNumSections;
	console.log(`  → ${perSection} B per section (v45 retail TrafficSection = 48 B; match? ${perSection === 48})`);
}

// =============================================================================
// 5. Cross-check by counting hulls with sub-arrays vs empty
// =============================================================================
console.log();
console.log('='.repeat(78));
console.log('Hull body size distribution (proxy for "how many hulls have actual content")');
console.log('='.repeat(78));
const hullSizes = hullPtrs.map((p, i) => hullEnd(i) - p);
const empty = hullSizes.filter((s) => s === 0x30).length;
const nonEmpty = hullSizes.filter((s) => s > 0x30).length;
console.log(`Empty (header-only, 48 B): ${empty} hulls`);
console.log(`Non-empty: ${nonEmpty} hulls`);

const v45PtrHulls = le32(v45, 0xc);
const v45NumHulls = le16(v45, 0x2);
console.log(`\nv45 retail comparison: ${v45NumHulls} hulls`);
let v45Empty = 0;
for (let i = 0; i < v45NumHulls; i++) {
	const hp = le32(v45, v45PtrHulls + i * 4);
	if (le32(v45, hp) === 0 && le32(v45, hp + 4) === 0) v45Empty++;
}
console.log(`v45 empty hulls (all counts 0): ${v45Empty}`);
