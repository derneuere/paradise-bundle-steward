// Fixture triangulation for AI Sections V4 → V12 migration (issue #36).
//
// Reads the three available fixtures and prints distributions to inform the
// lossy-mapping decisions in `migrateV4toV12`. Run with:
//
//   npm run bundle -- ai-investigate
//
// or directly:
//
//   tsx scripts/investigate-aiSections-v4-to-v12.ts
//
// Findings get folded back into the migration JSDoc and the PR description.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	parseAISectionsData,
	type ParsedAISectionsV12,
	type ParsedAISectionsV4,
	AISectionFlag,
	SectionSpeed,
	LegacyDangerRating,
} from '../src/lib/core/aiSections';
import { parseBundle } from '../src/lib/core/bundle';
import { RESOURCE_TYPE_IDS } from '../src/lib/core/types';
import { extractResourceSize, isCompressed, decompressData } from '../src/lib/core/resourceManager';

const HERE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const V4_PATH = resolve(HERE, 'example/older builds/AI.dat');
const V12_PC_PATH = resolve(HERE, 'example/AI.DAT');
const V12_PS3_PATH = resolve(HERE, 'example/ps3/AI.DAT');

function loadResourceBytes(fixturePath: string): Uint8Array {
	const raw = readFileSync(fixturePath);
	const bytes = new Uint8Array(raw.byteLength);
	bytes.set(raw);
	const buffer = bytes.buffer;
	const bundle = parseBundle(buffer);
	const resource = bundle.resources.find((r) => r.resourceTypeId === RESOURCE_TYPE_IDS.AI_SECTIONS);
	if (!resource) throw new Error(`Fixture ${fixturePath} missing AI Sections resource`);
	for (let bi = 0; bi < 3; bi++) {
		const size = extractResourceSize(resource.sizeAndAlignmentOnDisk[bi]);
		if (size <= 0) continue;
		const base = bundle.header.resourceDataOffsets[bi] >>> 0;
		const rel = resource.diskOffsets[bi] >>> 0;
		const start = (base + rel) >>> 0;
		let slice: Uint8Array = new Uint8Array(buffer.slice(start, start + size));
		if (isCompressed(slice)) slice = decompressData(slice);
		return slice;
	}
	throw new Error(`No populated data block in AI Sections resource of ${fixturePath}`);
}

function parseFile(path: string, littleEndian: boolean) {
	const slice = loadResourceBytes(path);
	return parseAISectionsData(slice, littleEndian);
}

function distribution<K extends string | number>(items: Iterable<K>): Map<K, number> {
	const out = new Map<K, number>();
	for (const item of items) out.set(item, (out.get(item) ?? 0) + 1);
	return out;
}

function fmtMap<K>(label: string, map: Map<K, number>, total: number, name?: (k: K) => string) {
	console.log(`\n  ${label} (n=${total}):`);
	const entries = [...map.entries()].sort((a, b) => Number(a[0]) - Number(b[0]));
	for (const [k, v] of entries) {
		const pct = ((v / total) * 100).toFixed(1).padStart(5);
		const name_ = name ? name(k) : String(k);
		console.log(`    ${name_.padEnd(24)} ${String(v).padStart(6)}  ${pct}%`);
	}
}

function sectionCentroid(section: { cornersX: number[]; cornersZ: number[] }): { x: number; z: number } {
	const x = (section.cornersX[0] + section.cornersX[1] + section.cornersX[2] + section.cornersX[3]) / 4;
	const z = (section.cornersZ[0] + section.cornersZ[1] + section.cornersZ[2] + section.cornersZ[3]) / 4;
	return { x, z };
}

function v12Centroid(section: { corners: { x: number; y: number }[] }): { x: number; z: number } {
	let x = 0, z = 0;
	for (const c of section.corners) { x += c.x; z += c.y; }
	return { x: x / 4, z: z / 4 };
}

function nearestV12Section(point: { x: number; z: number }, v12: ParsedAISectionsV12): { idx: number; dist: number } {
	let best = -1, bestD = Infinity;
	for (let i = 0; i < v12.sections.length; i++) {
		const c = v12Centroid(v12.sections[i]);
		const d = (c.x - point.x) ** 2 + (c.z - point.z) ** 2;
		if (d < bestD) { bestD = d; best = i; }
	}
	return { idx: best, dist: Math.sqrt(bestD) };
}

function bbox(points: { x: number; z: number }[]) {
	let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
	for (const p of points) {
		if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
		if (p.z < minZ) minZ = p.z; if (p.z > maxZ) maxZ = p.z;
	}
	return { minX, maxX, minZ, maxZ };
}

console.log('=== AI Sections V4 → V12 fixture triangulation ===');

const v4 = parseFile(V4_PATH, false) as ParsedAISectionsV4;
const v12pc = parseFile(V12_PC_PATH, true) as ParsedAISectionsV12;
const v12ps3 = parseFile(V12_PS3_PATH, false) as ParsedAISectionsV12;

console.log(`\nV4 (X360 BE, 2006-11-13 dev): kind=${v4.kind} sections=${v4.legacy.sections.length}`);
console.log(`V12 PC retail:                kind=${v12pc.kind} sections=${v12pc.sections.length} resetPairs=${v12pc.sectionResetPairs.length}`);
console.log(`V12 PS3 retail:               kind=${v12ps3.kind} sections=${v12ps3.sections.length} resetPairs=${v12ps3.sectionResetPairs.length}`);

console.log(`\n--- Per-speed limits in V12 PC (the values V4 has no equivalent for) ---`);
console.log(`  sectionMinSpeeds: [${v12pc.sectionMinSpeeds.map(v => v.toFixed(2)).join(', ')}]`);
console.log(`  sectionMaxSpeeds: [${v12pc.sectionMaxSpeeds.map(v => v.toFixed(2)).join(', ')}]`);
console.log(`\n  sectionMinSpeeds (PS3): [${v12ps3.sectionMinSpeeds.map(v => v.toFixed(2)).join(', ')}]`);
console.log(`  sectionMaxSpeeds (PS3): [${v12ps3.sectionMaxSpeeds.map(v => v.toFixed(2)).join(', ')}]`);

console.log(`\n--- V4 dangerRating distribution ---`);
const v4Dangers = v4.legacy.sections.map(s => s.dangerRating);
fmtMap('dangerRating', distribution(v4Dangers), v4Dangers.length, k =>
	`${k}=${LegacyDangerRating[k as number] ?? '?'}`);

console.log(`\n--- V12 PC speed distribution ---`);
const v12Speeds = v12pc.sections.map(s => s.speed);
fmtMap('speed', distribution(v12Speeds), v12Speeds.length, k =>
	`${k}=${SectionSpeed[k as number] ?? '?'}`);

console.log(`\n--- V4 flags distribution ---`);
const v4Flags = v4.legacy.sections.map(s => s.flags);
fmtMap('flags (raw u8)', distribution(v4Flags), v4Flags.length, k => `0x${(k as number).toString(16).padStart(2, '0')}`);

console.log(`\n--- V12 PC flags distribution (each bit) ---`);
const v12FlagBitCounts = new Map<string, number>();
for (const s of v12pc.sections) {
	for (const [name, mask] of Object.entries(AISectionFlag)) {
		if (typeof mask !== 'number') continue;
		if (s.flags & mask) v12FlagBitCounts.set(name, (v12FlagBitCounts.get(name) ?? 0) + 1);
	}
}
console.log(`\n  bit set counts (n=${v12pc.sections.length}):`);
for (const [name, count] of v12FlagBitCounts) {
	const pct = ((count / v12pc.sections.length) * 100).toFixed(1);
	console.log(`    ${name.padEnd(20)} ${String(count).padStart(6)}  ${pct}%`);
}

console.log(`\n--- V12 PC district / spanIndex distribution ---`);
const v12Districts = v12pc.sections.map(s => s.district);
fmtMap('district', distribution(v12Districts), v12Districts.length);
const v12SpanCounts = { negative: 0, zero: 0, positive: 0 };
for (const s of v12pc.sections) {
	if (s.spanIndex < 0) v12SpanCounts.negative++;
	else if (s.spanIndex === 0) v12SpanCounts.zero++;
	else v12SpanCounts.positive++;
}
console.log(`  spanIndex: ${v12SpanCounts.negative} <0, ${v12SpanCounts.zero} =0, ${v12SpanCounts.positive} >0  (n=${v12pc.sections.length})`);

console.log(`\n--- V4 vs V12 spatial overlap (centroid bbox) ---`);
const v4Centroids = v4.legacy.sections.map(sectionCentroid);
const v12Centroids = v12pc.sections.map(v12Centroid);
console.log(`  V4 centroid bbox:  ${JSON.stringify(bbox(v4Centroids))}`);
console.log(`  V12 centroid bbox: ${JSON.stringify(bbox(v12Centroids))}`);

console.log(`\n--- Spatial correlation: V4 dangerRating → nearest V12 speed ---`);
// Each V4 section: find nearest V12 centroid; tabulate (dangerRating, V12 speed) joint distribution.
// Skip V4 sections where nearest V12 is too far (different map regions).
const PROXIMITY_THRESHOLD = 50; // world units; tune from bbox above
const joint = new Map<string, number>();
let matched = 0;
for (let i = 0; i < v4.legacy.sections.length; i++) {
	const s = v4.legacy.sections[i];
	const { idx, dist } = nearestV12Section(v4Centroids[i], v12pc);
	if (dist > PROXIMITY_THRESHOLD) continue;
	matched++;
	const key = `dr=${s.dangerRating} → speed=${v12pc.sections[idx].speed}`;
	joint.set(key, (joint.get(key) ?? 0) + 1);
}
console.log(`  Matched ${matched}/${v4.legacy.sections.length} V4 sections within ${PROXIMITY_THRESHOLD} units of a V12 section.`);
const sortedJoint = [...joint.entries()].sort((a, b) => b[1] - a[1]);
for (const [key, count] of sortedJoint) {
	console.log(`    ${key.padEnd(28)} ${count}`);
}

console.log(`\n--- Spatial correlation: V4 flags=0x01 → nearest V12 IN_AIR? ---`);
const v4WithBit0 = v4.legacy.sections
	.map((s, i) => ({ s, i }))
	.filter(({ s }) => s.flags & 0x01);
console.log(`  V4 sections with bit 0x01 set: ${v4WithBit0.length}`);
let inAirHits = 0, junctionHits = 0, otherHits = 0, far = 0;
for (const { i } of v4WithBit0) {
	const { idx, dist } = nearestV12Section(v4Centroids[i], v12pc);
	if (dist > PROXIMITY_THRESHOLD) { far++; continue; }
	const f = v12pc.sections[idx].flags;
	if (f & AISectionFlag.IN_AIR) inAirHits++;
	else if (f & AISectionFlag.JUNCTION) junctionHits++;
	else otherHits++;
}
console.log(`  matched in-air:   ${inAirHits}`);
console.log(`  matched junction: ${junctionHits}`);
console.log(`  matched other:    ${otherHits}`);
console.log(`  too far:          ${far}`);

console.log(`\n--- V4 portal/noGo characteristics ---`);
let v4Portals = 0, v4NoGos = 0, v4PortalBLs = 0;
for (const s of v4.legacy.sections) {
	v4Portals += s.portals.length;
	v4NoGos += s.noGoLines.length;
	for (const p of s.portals) v4PortalBLs += p.boundaryLines.length;
}
console.log(`  total portals: ${v4Portals}, total portal BLs: ${v4PortalBLs}, total noGoLines: ${v4NoGos}`);

console.log(`\n--- V12 PC reset pairs distribution ---`);
const resetSpeeds = v12pc.sectionResetPairs.map(p => p.resetSpeed);
fmtMap('resetSpeed', distribution(resetSpeeds), resetSpeeds.length);

console.log('\nDone.\n');
