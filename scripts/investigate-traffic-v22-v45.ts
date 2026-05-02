// V22 → V45 TrafficData migration investigation script (issue #45 follow-up).
//
// Side-by-side dump of the v22 prototype (`example/older builds/B5Traffic.bndl`,
// X360 BE) vs the v45 retail PC bundle (`example/B5TRAFFIC.BNDL`, LE) so we
// can write the cross-version migrate() with eyes open. Following the
// migration-investigation playbook: schema diff + fixture triangulation
// FIRST, implementation second. Findings get captured in
// docs/trafficData-v22-migration.md.
//
// Run with:
//   eval "$(fnm env --shell=bash)" && fnm use 22
//   node ./scripts/investigate-traffic-v22-v45.ts
// (use ts-node or tsx if available; otherwise compile via tsc)

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseBundle } from '../src/lib/core/bundle';
import { RESOURCE_TYPE_IDS } from '../src/lib/core/types';
import {
	extractResourceSize,
	isCompressed,
	decompressData,
} from '../src/lib/core/resourceManager';
import {
	parseTrafficDataData,
	type ParsedTrafficData,
	type ParsedTrafficDataV22,
	type ParsedTrafficDataRetail,
} from '../src/lib/core/trafficData';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const V22_PATH = path.join(REPO, 'example/older builds/B5Traffic.bndl');
const V45_PATH = path.join(REPO, 'example/B5TRAFFIC.BNDL');

function extractTrafficResource(filePath: string): Uint8Array {
	const raw = fs.readFileSync(filePath);
	const bytes = new Uint8Array(raw.byteLength);
	bytes.set(raw);
	const bundle = parseBundle(bytes.buffer);
	const resource = bundle.resources.find(
		(r) => r.resourceTypeId === RESOURCE_TYPE_IDS.TRAFFIC_DATA,
	);
	if (!resource) throw new Error(`${filePath}: no TrafficData resource`);
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
	throw new Error(`${filePath}: no populated TrafficData block`);
}

const v22Raw = extractTrafficResource(V22_PATH);
const v45Raw = extractTrafficResource(V45_PATH);
const v22 = parseTrafficDataData(v22Raw, /*littleEndian*/ false) as ParsedTrafficData;
const v45 = parseTrafficDataData(v45Raw, /*littleEndian*/ true) as ParsedTrafficData;

if (v22.kind !== 'v22') throw new Error(`expected v22, got ${v22.kind}`);
if (v45.kind === 'v22') throw new Error('v45 fixture parsed as v22?');

const v22M: ParsedTrafficDataV22 = v22;
const v45M: ParsedTrafficDataRetail = v45;

// =============================================================================
// 1. Bundle-level numbers
// =============================================================================
console.log('='.repeat(78));
console.log('BUNDLE SIZES');
console.log('='.repeat(78));
console.log(`v22 prototype payload: ${v22Raw.byteLength} bytes (header reports ${v22M.muSizeInBytes})`);
console.log(`v45 retail payload:    ${v45Raw.byteLength} bytes (header reports ${v45M.muSizeInBytes})`);

// =============================================================================
// 2. PVS — single most reliable cross-version anchor
// =============================================================================
console.log();
console.log('='.repeat(78));
console.log('PVS (potentially visible set — spatial grid)');
console.log('='.repeat(78));
const v22Pvs = v22M.pvs;
const v45Pvs = v45M.pvs;
console.log('               | v22 prototype                 | v45 retail');
console.log('mGridMin       |',
	`(${v22Pvs.mGridMin.x.toFixed(2)}, ${v22Pvs.mGridMin.y.toFixed(2)}, ${v22Pvs.mGridMin.z.toFixed(2)})`.padEnd(30),
	`| (${v45Pvs.mGridMin.x.toFixed(2)}, ${v45Pvs.mGridMin.y.toFixed(2)}, ${v45Pvs.mGridMin.z.toFixed(2)})`);
console.log('mRecipCellSize |',
	`(${v22Pvs.mRecipCellSize.x.toFixed(6)}, ${v22Pvs.mRecipCellSize.y.toFixed(6)}, ${v22Pvs.mRecipCellSize.z.toFixed(6)})`.padEnd(30),
	`| (${v45Pvs.mRecipCellSize.x.toFixed(6)}, ${v45Pvs.mRecipCellSize.y.toFixed(6)}, ${v45Pvs.mRecipCellSize.z.toFixed(6)})`);
// derive cell size from recip for v22
const v22CellX = v22Pvs.mRecipCellSize.x !== 0 ? 1 / v22Pvs.mRecipCellSize.x : 0;
const v22CellZ = v22Pvs.mRecipCellSize.z !== 0 ? 1 / v22Pvs.mRecipCellSize.z : 0;
console.log('cellSize (1/r) |',
	`(${v22CellX.toFixed(2)}, ?, ${v22CellZ.toFixed(2)})`.padEnd(30),
	`| (${v45Pvs.mCellSize.x.toFixed(2)}, ${v45Pvs.mCellSize.y.toFixed(2)}, ${v45Pvs.mCellSize.z.toFixed(2)})`);
console.log('muNumCells_X   |', String(v22Pvs.muNumCells_X).padEnd(30), `| ${v45Pvs.muNumCells_X}`);
console.log('muNumCells_Z   |', String(v22Pvs.muNumCells_Z).padEnd(30), `| ${v45Pvs.muNumCells_Z}`);
console.log('muNumCells     |', String(v22Pvs.muNumCells).padEnd(30), `| ${v45Pvs.muNumCells}`);
console.log('hullPvsSets    |', `${v22Pvs.hullPvsSets.length} entries`.padEnd(30), `| ${v45Pvs.hullPvsSets.length} entries`);

// =============================================================================
// 3. Counts — what's bigger / smaller / missing
// =============================================================================
console.log();
console.log('='.repeat(78));
console.log('TOP-LEVEL COUNTS');
console.log('='.repeat(78));
console.log('               | v22 prototype  | v45 retail');
console.log('hulls          |', String(v22M.hullPointers.length).padEnd(15), `| ${v45M.hulls.length}`);
console.log('flowTypes      |', String(v22M.muNumFlowTypes).padEnd(15), `| ${v45M.flowTypes.length}`);
console.log('vehicleTypes   |', String(v22M.muNumVehicleTypes).padEnd(15), `| ${v45M.vehicleTypes.length}`);
console.log('killZones      |', '(not in v22)'.padEnd(15), `| ${v45M.killZones.length}`);
console.log('vehicleAssets  |', '(not in v22)'.padEnd(15), `| ${v45M.vehicleAssets.length}`);
console.log('vehicleTraits  |', '(not in v22)'.padEnd(15), `| ${v45M.vehicleTraits.length}`);
console.log('paintColours   |', '(not in v22)'.padEnd(15), `| ${v45M.paintColours.length}`);
console.log('TLC lights     |', '(not in v22)'.padEnd(15), `| ${v45M.trafficLights.posAndYRotations.length}`);

// =============================================================================
// 4. v22 hull pointer table — stride confirmation + first-hull byte dump
// =============================================================================
console.log();
console.log('='.repeat(78));
console.log('V22 HULL TABLE — stride / spacing');
console.log('='.repeat(78));
const ptrs = v22M.hullPointers;
const strides = new Map<number, number>();
for (let i = 1; i < ptrs.length; i++) {
	const d = ptrs[i] - ptrs[i - 1];
	strides.set(d, (strides.get(d) ?? 0) + 1);
}
console.log('Adjacent pointer deltas:');
for (const [d, count] of [...strides.entries()].sort((a, b) => b[1] - a[1])) {
	console.log(`  ${d.toString(16).padStart(4, '0')}h = ${d}d → ${count} occurrences`);
}
const firstHullSize = v22M.hullsRaw[0]?.byteLength ?? 0;
console.log(`First hull raw bytes: ${firstHullSize}`);
if (firstHullSize > 0) {
	const buf = v22M.hullsRaw[0];
	let hex = '';
	for (let i = 0; i < buf.byteLength; i++) {
		hex += buf[i].toString(16).padStart(2, '0') + (i % 4 === 3 ? ' ' : '');
		if (i % 16 === 15) hex += '\n  ';
	}
	console.log('  ' + hex);
}

// =============================================================================
// 5. v45 retail hull #0 — for cross-reference
// =============================================================================
console.log();
console.log('='.repeat(78));
console.log('V45 RETAIL HULL #0 — for cross-reference');
console.log('='.repeat(78));
if (v45M.hulls.length > 0) {
	const h = v45M.hulls[0];
	console.log(`sections: ${h.sections.length}`);
	console.log(`rungs: ${h.rungs.length}`);
	console.log(`neighbours: ${h.neighbours.length}`);
	console.log(`junctions: ${h.junctions.length}`);
	console.log(`stopLines: ${h.stopLines.length}`);
	console.log(`lightTriggers: ${h.lightTriggers.length}`);
	console.log(`staticTrafficVehicles: ${h.staticTrafficVehicles.length}`);
	console.log(`sectionSpans: ${h.sectionSpans.length}`);
	console.log(`muNumVehicleAssets: ${h.muNumVehicleAssets}`);
	console.log(`first 3 sections .mfSpeed: ${h.sections.slice(0, 3).map(s => s.mfSpeed).join(', ')}`);
	console.log(`first 3 sections .muSpanIndex: ${h.sections.slice(0, 3).map(s => s.muSpanIndex).join(', ')}`);
}

// =============================================================================
// 6. v22 tail regions — sizes + first bytes
// =============================================================================
console.log();
console.log('='.repeat(78));
console.log('V22 TAIL REGIONS');
console.log('='.repeat(78));
const tails = [
	['A', v22M.ptrTailA, v22M.tailABytes],
	['B', v22M.ptrTailB, v22M.tailBBytes],
	['C', v22M.ptrTailC, v22M.tailCBytes],
	['D', v22M.ptrTailD, v22M.tailDBytes],
] as const;
for (const [label, ptr, bytes] of tails) {
	const len = bytes.byteLength;
	const head = Array.from(bytes.slice(0, 32)).map(b => b.toString(16).padStart(2, '0')).join(' ');
	console.log(`Tail ${label}: ptr=0x${ptr.toString(16)}, ${len} bytes`);
	console.log(`  first 32: ${head}`);
}

// Hypothesis tester: assume tail A is flow types laid out as v45-style
// `{ ptr_ids: u32be, ptr_probs: u32be, count: u8, _pad: u8[3] }`. That's 12
// bytes per FlowType; muNumFlowTypes header field tells us count. If the
// numbers match, the prototype's flow-type record shape was carried forward
// nearly verbatim into retail.
const v22NumFlow = v22M.muNumFlowTypes;
console.log();
console.log(`Hypothesis: tailA is flow-type records (12 B each), header says muNumFlowTypes=${v22NumFlow}.`);
console.log(`  Expected size if so: ${v22NumFlow * 12} B; actual tailA size: ${v22M.tailABytes.byteLength} B`);
console.log(`  → ${v22NumFlow * 12 === v22M.tailABytes.byteLength ? 'MATCH (record shape probably retained)' : 'MISMATCH (record shape changed or layout differs)'}.`);

// Same tactic for vehicle types — v45 layout is 8 bytes (TrafficVehicleTypeData);
// muNumVehicleTypes is the header count.
const v22NumVeh = v22M.muNumVehicleTypes;
console.log();
console.log(`Hypothesis: tailB is vehicle-type records (8 B each), header says muNumVehicleTypes=${v22NumVeh}.`);
console.log(`  Expected size if so: ${v22NumVeh * 8} B; actual tailB size: ${v22M.tailBBytes.byteLength} B`);
console.log(`  → ${v22NumVeh * 8 === v22M.tailBBytes.byteLength ? 'MATCH' : 'MISMATCH'}.`);

// Vehicle types update — 5×f32 = 20 bytes per record in v45.
console.log();
console.log(`Hypothesis: tailC is vehicle-type-update records (20 B each), n=${v22NumVeh}.`);
console.log(`  Expected: ${v22NumVeh * 20} B; actual tailC: ${v22M.tailCBytes.byteLength} B`);
console.log(`  → ${v22NumVeh * 20 === v22M.tailCBytes.byteLength ? 'MATCH' : 'MISMATCH'}.`);

// =============================================================================
// 7. Spatial overlap between v22 and v45 PVS
// =============================================================================
console.log();
console.log('='.repeat(78));
console.log('SPATIAL OVERLAP — v22 vs v45 PVS bounds');
console.log('='.repeat(78));
function pvsBounds(min: { x: number; z: number }, cellX: number, cellZ: number, nx: number, nz: number) {
	return {
		minX: min.x, minZ: min.z,
		maxX: min.x + cellX * nx, maxZ: min.z + cellZ * nz,
	};
}
const v22Bounds = pvsBounds(v22Pvs.mGridMin, v22CellX, v22CellZ, v22Pvs.muNumCells_X, v22Pvs.muNumCells_Z);
const v45Bounds = pvsBounds(v45Pvs.mGridMin, v45Pvs.mCellSize.x, v45Pvs.mCellSize.z, v45Pvs.muNumCells_X, v45Pvs.muNumCells_Z);
console.log('v22 grid bounds: x=[', v22Bounds.minX.toFixed(0), ',', v22Bounds.maxX.toFixed(0), ']  z=[', v22Bounds.minZ.toFixed(0), ',', v22Bounds.maxZ.toFixed(0), ']');
console.log('v45 grid bounds: x=[', v45Bounds.minX.toFixed(0), ',', v45Bounds.maxX.toFixed(0), ']  z=[', v45Bounds.minZ.toFixed(0), ',', v45Bounds.maxZ.toFixed(0), ']');
const overlapX = Math.max(0, Math.min(v22Bounds.maxX, v45Bounds.maxX) - Math.max(v22Bounds.minX, v45Bounds.minX));
const overlapZ = Math.max(0, Math.min(v22Bounds.maxZ, v45Bounds.maxZ) - Math.max(v22Bounds.minZ, v45Bounds.minZ));
const v22Area = (v22Bounds.maxX - v22Bounds.minX) * (v22Bounds.maxZ - v22Bounds.minZ);
const v45Area = (v45Bounds.maxX - v45Bounds.minX) * (v45Bounds.maxZ - v45Bounds.minZ);
console.log(`Overlap area: ${(overlapX * overlapZ).toFixed(0)}  (v22 area ${v22Area.toFixed(0)}, v45 area ${v45Area.toFixed(0)})`);

console.log();
console.log('Investigation script complete. Capture findings in docs/trafficData-v22-migration.md');
