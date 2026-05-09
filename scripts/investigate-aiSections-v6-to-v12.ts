// Fixture triangulation for AI Sections V6 → V12 migration (issue #40).
//
// Reads the available V6 prototype + V12 retail fixtures and prints the
// distributions and spatial joins that the migration code's defaulted /
// lossy lists need to be calibrated against. Run with:
//
//   tsx scripts/investigate-aiSections-v6-to-v12.ts
//
// Findings get folded back into the migration JSDoc and the PR description.
//
// V6 vs V4 deltas the migration cares about:
//   - V6 carries `spanIndex` (i32, -1 = none), so we don't synthesise it
//     like V4 — it can pass straight through.
//   - V6 carries `district` (u8, 0..4). Always 0 in retail PC/PS3 so V12's
//     `district` slot can take it verbatim.
//   - V6 has a documented flag set (IS_IN_AIR / IS_SHORTCUT / IS_JUNCTION).
//     V12's flag set has cognate bits (IN_AIR / SHORTCUT / JUNCTION) so the
//     mapping looks 1:1 in name; we want to confirm spatially.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	parseAISectionsData,
	type ParsedAISectionsV12,
	type ParsedAISectionsV6,
	AISectionFlag,
	SectionSpeed,
	LegacyDangerRating,
	LegacyAISectionFlagV6,
	LegacyEDistrict,
} from '../src/lib/core/aiSections';
import { parseBundle } from '../src/lib/core/bundle';
import { RESOURCE_TYPE_IDS } from '../src/lib/core/types';
import { extractResourceSize, isCompressed, decompressData } from '../src/lib/core/resourceManager';

const HERE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const V6_PATH = resolve(HERE, 'example/older builds/AI v6.DAT');
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
		console.log(`    ${name_.padEnd(28)} ${String(v).padStart(6)}  ${pct}%`);
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

console.log('=== AI Sections V6 → V12 fixture triangulation ===');

const v6 = parseFile(V6_PATH, false) as ParsedAISectionsV6;
const v12pc = parseFile(V12_PC_PATH, true) as ParsedAISectionsV12;
const v12ps3 = parseFile(V12_PS3_PATH, false) as ParsedAISectionsV12;

console.log(`\nV6 (X360 BE, 2007-02-22 prototype): kind=${v6.kind} sections=${v6.legacy.sections.length} headerVersion=${v6.legacy.headerVersion}`);
console.log(`V12 PC retail:                       kind=${v12pc.kind} sections=${v12pc.sections.length} resetPairs=${v12pc.sectionResetPairs.length}`);
console.log(`V12 PS3 retail:                      kind=${v12ps3.kind} sections=${v12ps3.sections.length} resetPairs=${v12ps3.sectionResetPairs.length}`);

console.log(`\n--- Per-speed limits in V12 (the values V6 has no equivalent for) ---`);
console.log(`  sectionMinSpeeds (PC):  [${v12pc.sectionMinSpeeds.map(v => v.toFixed(2)).join(', ')}]`);
console.log(`  sectionMaxSpeeds (PC):  [${v12pc.sectionMaxSpeeds.map(v => v.toFixed(2)).join(', ')}]`);
console.log(`  sectionMinSpeeds (PS3): [${v12ps3.sectionMinSpeeds.map(v => v.toFixed(2)).join(', ')}]`);
console.log(`  sectionMaxSpeeds (PS3): [${v12ps3.sectionMaxSpeeds.map(v => v.toFixed(2)).join(', ')}]`);

console.log(`\n--- V6 dangerRating distribution ---`);
const v6Dangers = v6.legacy.sections.map(s => s.dangerRating);
fmtMap('dangerRating', distribution(v6Dangers), v6Dangers.length, k =>
	`${k}=${LegacyDangerRating[k as number] ?? '?'}`);

console.log(`\n--- V12 PC speed distribution ---`);
const v12Speeds = v12pc.sections.map(s => s.speed);
fmtMap('speed', distribution(v12Speeds), v12Speeds.length, k =>
	`${k}=${SectionSpeed[k as number] ?? '?'}`);

console.log(`\n--- V6 flags distribution (raw u8 byte) ---`);
const v6Flags = v6.legacy.sections.map(s => s.flags);
fmtMap('flags (raw u8)', distribution(v6Flags), v6Flags.length, k => `0x${(k as number).toString(16).padStart(2, '0')}`);

console.log(`\n--- V6 flags distribution (per-bit) ---`);
const v6BitCounts = new Map<string, number>();
for (const s of v6.legacy.sections) {
	for (const [name, mask] of Object.entries(LegacyAISectionFlagV6)) {
		if (typeof mask !== 'number' || mask === 0) continue;
		if (s.flags & mask) v6BitCounts.set(name, (v6BitCounts.get(name) ?? 0) + 1);
	}
}
console.log(`\n  bit set counts (n=${v6.legacy.sections.length}):`);
for (const [name, count] of v6BitCounts) {
	const pct = ((count / v6.legacy.sections.length) * 100).toFixed(1);
	console.log(`    ${name.padEnd(20)} ${String(count).padStart(6)}  ${pct}%`);
}

console.log(`\n--- V6 spanIndex distribution ---`);
const v6SpanCounts = { negative: 0, zero: 0, positive: 0 };
for (const s of v6.legacy.sections) {
	const sp = s.spanIndex ?? -1;
	if (sp < 0) v6SpanCounts.negative++;
	else if (sp === 0) v6SpanCounts.zero++;
	else v6SpanCounts.positive++;
}
console.log(`  spanIndex: ${v6SpanCounts.negative} <0, ${v6SpanCounts.zero} =0, ${v6SpanCounts.positive} >0  (n=${v6.legacy.sections.length})`);

console.log(`\n--- V6 district distribution ---`);
const v6Districts = v6.legacy.sections.map(s => s.district ?? 0);
fmtMap('district', distribution(v6Districts), v6Districts.length, k =>
	`${k}=${LegacyEDistrict[k as number] ?? '?'}`);

console.log(`\n--- V12 PC flags distribution (per-bit) ---`);
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

console.log(`\n--- V6 vs V12 spatial overlap (centroid bbox) ---`);
const v6Centroids = v6.legacy.sections.map(sectionCentroid);
const v12Centroids = v12pc.sections.map(v12Centroid);
console.log(`  V6 centroid bbox:  ${JSON.stringify(bbox(v6Centroids))}`);
console.log(`  V12 centroid bbox: ${JSON.stringify(bbox(v12Centroids))}`);

console.log(`\n--- Spatial correlation: V6 dangerRating → nearest V12 speed ---`);
const PROXIMITY_THRESHOLD = 50;
const joint = new Map<string, number>();
let matched = 0;
for (let i = 0; i < v6.legacy.sections.length; i++) {
	const s = v6.legacy.sections[i];
	const { idx, dist } = nearestV12Section(v6Centroids[i], v12pc);
	if (dist > PROXIMITY_THRESHOLD) continue;
	matched++;
	const key = `dr=${s.dangerRating} → speed=${v12pc.sections[idx].speed}`;
	joint.set(key, (joint.get(key) ?? 0) + 1);
}
console.log(`  Matched ${matched}/${v6.legacy.sections.length} V6 sections within ${PROXIMITY_THRESHOLD} units of a V12 section.`);
const sortedJoint = [...joint.entries()].sort((a, b) => b[1] - a[1]);
for (const [key, count] of sortedJoint) {
	console.log(`    ${key.padEnd(28)} ${count}`);
}

console.log(`\n--- Spatial correlation: V6 IS_IN_AIR → nearest V12 IN_AIR? ---`);
const v6InAir = v6.legacy.sections
	.map((s, i) => ({ s, i }))
	.filter(({ s }) => s.flags & LegacyAISectionFlagV6.IS_IN_AIR);
console.log(`  V6 sections with IS_IN_AIR set: ${v6InAir.length}`);
let inAirHits = 0, otherHits = 0, far = 0;
for (const { i } of v6InAir) {
	const { idx, dist } = nearestV12Section(v6Centroids[i], v12pc);
	if (dist > PROXIMITY_THRESHOLD) { far++; continue; }
	const f = v12pc.sections[idx].flags;
	if (f & AISectionFlag.IN_AIR) inAirHits++;
	else otherHits++;
}
console.log(`  matched in V12 IN_AIR: ${inAirHits}`);
console.log(`  matched other:          ${otherHits}`);
console.log(`  too far:                ${far}`);

console.log(`\n--- Spatial correlation: V6 IS_SHORTCUT → nearest V12 SHORTCUT? ---`);
const v6Shortcut = v6.legacy.sections
	.map((s, i) => ({ s, i }))
	.filter(({ s }) => s.flags & LegacyAISectionFlagV6.IS_SHORTCUT);
console.log(`  V6 sections with IS_SHORTCUT set: ${v6Shortcut.length}`);
let scHits = 0, scAi = 0, scOther = 0, scFar = 0;
for (const { i } of v6Shortcut) {
	const { idx, dist } = nearestV12Section(v6Centroids[i], v12pc);
	if (dist > PROXIMITY_THRESHOLD) { scFar++; continue; }
	const f = v12pc.sections[idx].flags;
	if (f & AISectionFlag.SHORTCUT) scHits++;
	else if (f & AISectionFlag.AI_SHORTCUT) scAi++;
	else scOther++;
}
console.log(`  matched V12 SHORTCUT:     ${scHits}`);
console.log(`  matched V12 AI_SHORTCUT:  ${scAi}`);
console.log(`  matched V12 other:        ${scOther}`);
console.log(`  too far:                  ${scFar}`);

console.log(`\n--- Spatial correlation: V6 IS_JUNCTION → nearest V12 JUNCTION? ---`);
const v6Junction = v6.legacy.sections
	.map((s, i) => ({ s, i }))
	.filter(({ s }) => s.flags & LegacyAISectionFlagV6.IS_JUNCTION);
console.log(`  V6 sections with IS_JUNCTION set: ${v6Junction.length}`);
let jHits = 0, jOther = 0, jFar = 0;
for (const { i } of v6Junction) {
	const { idx, dist } = nearestV12Section(v6Centroids[i], v12pc);
	if (dist > PROXIMITY_THRESHOLD) { jFar++; continue; }
	const f = v12pc.sections[idx].flags;
	if (f & AISectionFlag.JUNCTION) jHits++;
	else jOther++;
}
console.log(`  matched V12 JUNCTION: ${jHits}`);
console.log(`  matched V12 other:    ${jOther}`);
console.log(`  too far:              ${jFar}`);

console.log(`\n--- V6 portal/noGo characteristics ---`);
let v6Portals = 0, v6NoGos = 0, v6PortalBLs = 0;
let v6PortalNonZeroW = 0;
for (const s of v6.legacy.sections) {
	v6Portals += s.portals.length;
	v6NoGos += s.noGoLines.length;
	for (const p of s.portals) {
		v6PortalBLs += p.boundaryLines.length;
		if (p.midPosition.w !== 0) v6PortalNonZeroW++;
	}
}
console.log(`  total portals: ${v6Portals}, total portal BLs: ${v6PortalBLs}, total noGoLines: ${v6NoGos}`);
console.log(`  portals with non-zero midPosition.w (structural pad): ${v6PortalNonZeroW}`);

console.log(`\n--- V6 spanIndex co-occurrence with district ---`);
let spanWithDistrictNonZero = 0, spanZeroDistrictNonZero = 0;
for (const s of v6.legacy.sections) {
	if ((s.district ?? 0) !== 0) {
		if ((s.spanIndex ?? -1) >= 0) spanWithDistrictNonZero++;
		else spanZeroDistrictNonZero++;
	}
}
console.log(`  district != 0 with spanIndex >= 0: ${spanWithDistrictNonZero}`);
console.log(`  district != 0 with spanIndex < 0:  ${spanZeroDistrictNonZero}`);

console.log('\nDone.\n');
