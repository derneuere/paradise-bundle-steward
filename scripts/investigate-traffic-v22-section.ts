// Final verification: decode v22 hull[22].sections[0] under v45's
// TrafficSection layout (48 B) and check if the fields decode to plausible
// values. If yes, hull section migration is just an endian flip.

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

function be32(buf: Uint8Array, off: number): number {
	return ((buf[off] << 24) | (buf[off + 1] << 16) | (buf[off + 2] << 8) | buf[off + 3]) >>> 0;
}
function be16(buf: Uint8Array, off: number): number {
	return (buf[off] << 8) | buf[off + 1];
}
function bef32(buf: Uint8Array, off: number): number {
	const view = new DataView(new ArrayBuffer(4));
	view.setUint32(0, be32(buf, off), false);
	return view.getFloat32(0, false);
}
function le32(buf: Uint8Array, off: number): number {
	return (buf[off] | (buf[off + 1] << 8) | (buf[off + 2] << 16) | (buf[off + 3] << 24)) >>> 0;
}
function le16(buf: Uint8Array, off: number): number {
	return buf[off] | (buf[off + 1] << 8);
}
function lef32(buf: Uint8Array, off: number): number {
	const view = new DataView(new ArrayBuffer(4));
	view.setUint32(0, le32(buf, off), true);
	return view.getFloat32(0, true);
}

const v22 = extractTraffic(path.join(REPO, 'example/older builds/B5Traffic.bndl'));
const v45 = extractTraffic(path.join(REPO, 'example/B5TRAFFIC.BNDL'));

// v45 TrafficSection layout (from src/lib/core/trafficData.ts):
//   muRungOffset       u32  (4)
//   muNumRungs         u8   (1)
//   muStopLineOffset   u8   (1)
//   muNumStopLines     u8   (1)
//   muSpanIndex        u8   (1)
//   mauForwardHulls    u16[3] (6)
//   mauBackwardHulls   u16[3] (6)
//   mauForwardSections u8[3]  (3)
//   mauBackwardSections u8[3] (3)
//   muTurnLeftProb     u8 (1)
//   muTurnRightProb    u8 (1)
//   muNeighbourOffset  u16 (2)
//   muLeftNeighbourCount  u8 (1)
//   muRightNeighbourCount u8 (1)
//   muChangeLeftProb   u8 (1)
//   muChangeRightProb  u8 (1)
//   _pad22             u8[2] (2)
//   mfSpeed            f32 (4)
//   mfLength           f32 (4)
//   _pad2C             u8[4] (4)
// Total: 48 B

// Decode v22 hull[22].section[0] under that layout (BE)
function decodeSectionBE(buf: Uint8Array, off: number) {
	return {
		muRungOffset: be32(buf, off + 0),
		muNumRungs: buf[off + 4],
		muStopLineOffset: buf[off + 5],
		muNumStopLines: buf[off + 6],
		muSpanIndex: buf[off + 7],
		mauForwardHulls: [be16(buf, off + 8), be16(buf, off + 10), be16(buf, off + 12)],
		mauBackwardHulls: [be16(buf, off + 14), be16(buf, off + 16), be16(buf, off + 18)],
		mauForwardSections: [buf[off + 20], buf[off + 21], buf[off + 22]],
		mauBackwardSections: [buf[off + 23], buf[off + 24], buf[off + 25]],
		muTurnLeftProb: buf[off + 26],
		muTurnRightProb: buf[off + 27],
		muNeighbourOffset: be16(buf, off + 28),
		muLeftNeighbourCount: buf[off + 30],
		muRightNeighbourCount: buf[off + 31],
		muChangeLeftProb: buf[off + 32],
		muChangeRightProb: buf[off + 33],
		_pad22: [buf[off + 34], buf[off + 35]],
		mfSpeed: bef32(buf, off + 36),
		mfLength: bef32(buf, off + 40),
		_pad2C: [buf[off + 44], buf[off + 45], buf[off + 46], buf[off + 47]],
	};
}
function decodeSectionLE(buf: Uint8Array, off: number) {
	return {
		muRungOffset: le32(buf, off + 0),
		muNumRungs: buf[off + 4],
		muStopLineOffset: buf[off + 5],
		muNumStopLines: buf[off + 6],
		muSpanIndex: buf[off + 7],
		mauForwardHulls: [le16(buf, off + 8), le16(buf, off + 10), le16(buf, off + 12)],
		mauBackwardHulls: [le16(buf, off + 14), le16(buf, off + 16), le16(buf, off + 18)],
		mauForwardSections: [buf[off + 20], buf[off + 21], buf[off + 22]],
		mauBackwardSections: [buf[off + 23], buf[off + 24], buf[off + 25]],
		muTurnLeftProb: buf[off + 26],
		muTurnRightProb: buf[off + 27],
		muNeighbourOffset: le16(buf, off + 28),
		muLeftNeighbourCount: buf[off + 30],
		muRightNeighbourCount: buf[off + 31],
		muChangeLeftProb: buf[off + 32],
		muChangeRightProb: buf[off + 33],
		_pad22: [buf[off + 34], buf[off + 35]],
		mfSpeed: lef32(buf, off + 36),
		mfLength: lef32(buf, off + 40),
		_pad2C: [buf[off + 44], buf[off + 45], buf[off + 46], buf[off + 47]],
	};
}

// v22 hull[22] is at 0x24a0; ptr[0] for sections is at hull header + 8 = 0x24a8
const v22Hull22 = 0x24a0;
const v22SectionsPtr = be32(v22, v22Hull22 + 8);
console.log(`v22 hull[22] sections start at 0x${v22SectionsPtr.toString(16)}`);
console.log('Section[0] hex:', Array.from(v22.slice(v22SectionsPtr, v22SectionsPtr + 48)).map(b => b.toString(16).padStart(2, '0')).join(' '));
console.log('Section[1] hex:', Array.from(v22.slice(v22SectionsPtr + 48, v22SectionsPtr + 96)).map(b => b.toString(16).padStart(2, '0')).join(' '));

console.log();
console.log('Decoded v22 hull[22].section[0] under v45 layout (BE):');
const v22S0 = decodeSectionBE(v22, v22SectionsPtr);
console.log(JSON.stringify(v22S0, null, 2));

console.log();
console.log('Decoded v22 hull[22].section[1]:');
const v22S1 = decodeSectionBE(v22, v22SectionsPtr + 48);
console.log(JSON.stringify(v22S1, null, 2));

// Cross-reference: decode a v45 section to see what plausible field values look like
const v45PtrHulls = le32(v45, 0xc);
const v45NumHulls = le16(v45, 0x2);
let v45Hull2Sec = 0;
let v45HullIdx = 0;
for (let i = 0; i < v45NumHulls; i++) {
	const hp = le32(v45, v45PtrHulls + i * 4);
	if (v45[hp] === 2) { v45Hull2Sec = hp; v45HullIdx = i; break; } // first hull with 2 sections
}
console.log();
if (v45Hull2Sec) {
	const sectPtr = le32(v45, v45Hull2Sec + 0x10); // hull's first sub-array pointer
	console.log(`v45 hull[${v45HullIdx}] (first 2-section hull) sections start at 0x${sectPtr.toString(16)}`);
	console.log('Decoded v45 hull[].section[0]:');
	console.log(JSON.stringify(decodeSectionLE(v45, sectPtr), null, 2));
} else {
	// Fallback: any non-empty hull
	for (let i = 0; i < v45NumHulls; i++) {
		const hp = le32(v45, v45PtrHulls + i * 4);
		if (v45[hp] > 0) {
			const sectPtr = le32(v45, hp + 0x10);
			console.log(`v45 hull[${i}] (n=${v45[hp]} sections) section[0] at 0x${sectPtr.toString(16)}:`);
			console.log(JSON.stringify(decodeSectionLE(v45, sectPtr), null, 2));
			break;
		}
	}
}
