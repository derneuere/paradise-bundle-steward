// Gold coverage for parseWorldPainter2D / writeWorldPainter2D.
//
// Fixtures: example/DISTRICTS.DAT ("Districts") and example/SOUND/
// AMBIENCES.DAT ("Ambiences") — both 0x30 resources decompress ~42x to the
// SAME 98,336 bytes (the maps are mostly long runs of the same index) with
// identical container shape; only the palette the cell bytes index differs.
// Pins hand-verified decoded values from byte-level probes: the BinaryFile
// wrapper offsets, the 384x256 grid dims, individual cells located on the
// downsampled ASCII renders, the exact value histograms (Districts: all 23
// v1.9/Remastered districts + 41,449 0xFF; Ambiences: ids 0..20 + 44,796
// 0xFF), and the cross-fixture mainland-mirror relationship.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
	parseWorldPainter2D,
	writeWorldPainter2D,
	worldPainter2DVariantFromName,
	AMBIENCE_INDEX_COUNT,
	DISTRICT_NAMES,
	INVALID_CELL,
} from '../worldPainter2D';
import { parseBundle } from '../bundle';
import { parseDebugDataFromXml, findDebugResourceById } from '../bundle/debugData';
import { extractResourceRaw } from '../registry';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const WORLD_PAINTER_2D_TYPE_ID = 0x30;

type ExtractedMap = { name: string; raw: Uint8Array };

function loadMaps(bundleFile: string): ExtractedMap[] {
	const buf = fs.readFileSync(path.resolve(REPO_ROOT, bundleFile));
	const buffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
	const bundle = parseBundle(buffer);
	const debugResources = typeof bundle.debugData === 'string'
		? parseDebugDataFromXml(bundle.debugData)
		: [];
	return bundle.resources
		.filter((r) => r.resourceTypeId === WORLD_PAINTER_2D_TYPE_ID)
		.map((r) => ({
			name: findDebugResourceById(debugResources, r.resourceId.low.toString(16))?.name ?? '?',
			raw: extractResourceRaw(buffer, bundle, r),
		}));
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.byteLength !== b.byteLength) return false;
	for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
	return true;
}

const maps = loadMaps('example/DISTRICTS.DAT');
const ambMaps = loadMaps('example/SOUND/AMBIENCES.DAT');

describe('WorldPainter2D gold values (example/DISTRICTS.DAT)', () => {
	it('finds exactly one map, named Districts', () => {
		expect(maps.length).toBe(1);
		expect(maps[0].name).toBe('Districts');
		expect(maps[0].raw.byteLength).toBe(98336);
	});

	it('decodes the wrapper and grid header', () => {
		const m = parseWorldPainter2D(maps[0].raw);
		// 384x256 — the post-v1.0 grid (Big Surf Island widened the map).
		expect(m.muWidth).toBe(384);
		expect(m.muHeight).toBe(256);
		expect(m.cells.length).toBe(384 * 256);
		// Wrapper pad (0x8..0xF) and trailing 16-byte-alignment pad are zero.
		expect(m._wrapperPad.length).toBe(8);
		expect(m._wrapperPad.every((b) => b === 0)).toBe(true);
		expect(m._trailingPad.length).toBe(98336 - 0x10 - 4 - 384 * 256);
		expect(m._trailingPad.length).toBe(12);
		expect(m._trailingPad.every((b) => b === 0)).toBe(true);
	});

	it('decodes hand-verified cells (row-major from the north-west corner)', () => {
		const m = parseWorldPainter2D(maps[0].raw);
		const cell = (x: number, y: number) => m.cells[y * m.muWidth + x];
		expect(cell(100, 100)).toBe(4); // Eastern Shore
		expect(cell(200, 128)).toBe(14); // Downtown
		expect(cell(300, 60)).toBe(21); // South Coast (Big Surf Island, east side)
		expect(cell(50, 200)).toBe(12); // Lone Peaks (White Mountain, west side)
		// All four map corners are ocean / out of bounds.
		expect(cell(0, 0)).toBe(INVALID_CELL);
		expect(cell(383, 0)).toBe(INVALID_CELL);
		expect(cell(0, 255)).toBe(INVALID_CELL);
		expect(cell(383, 255)).toBe(INVALID_CELL);
	});

	it('uses exactly the 23 v1.9/Remastered district values plus 0xFF', () => {
		const m = parseWorldPainter2D(maps[0].raw);
		const hist = new Map<number, number>();
		for (const v of m.cells) hist.set(v, (hist.get(v) ?? 0) + 1);
		expect(hist.size).toBe(24);
		for (let d = 0; d < DISTRICT_NAMES.length; d++) {
			expect(hist.get(d) ?? 0, `district ${d} ${DISTRICT_NAMES[d]}`).toBeGreaterThan(0);
		}
		// No value falls between the last district and the 0xFF sentinel — in
		// particular the enum's E_DISTRICT_INVALID (23) never appears on disk.
		expect(hist.get(INVALID_CELL)).toBe(41449);
		expect(hist.get(23)).toBeUndefined();
		// Largest and smallest painted districts, pinned from the probe.
		expect(hist.get(12)).toBe(6170); // Lone Peaks
		expect(hist.get(18)).toBe(687); // Paradise Keys Bridge
	});

	it('DISTRICT_NAMES matches the BrnWorld::EDistrict wiki table', () => {
		expect(DISTRICT_NAMES.length).toBe(23);
		expect(DISTRICT_NAMES[0]).toBe('Ocean View');
		expect(DISTRICT_NAMES[14]).toBe('Downtown');
		expect(DISTRICT_NAMES[22]).toBe("Perren's Point");
	});
});

describe('WorldPainter2D gold values (example/SOUND/AMBIENCES.DAT)', () => {
	it('finds exactly one map, named Ambiences, in the same container shape as Districts', () => {
		expect(ambMaps.length).toBe(1);
		expect(ambMaps[0].name).toBe('Ambiences');
		// Identical decompressed size — the two retail resources share the
		// container byte-for-byte in shape; only the painted values differ.
		expect(ambMaps[0].raw.byteLength).toBe(98336);
	});

	it('decodes the same wrapper, grid dims, and pads as Districts', () => {
		const m = parseWorldPainter2D(ambMaps[0].raw);
		expect(m.muWidth).toBe(384);
		expect(m.muHeight).toBe(256);
		expect(m.cells.length).toBe(384 * 256);
		expect(m._wrapperPad.length).toBe(8);
		expect(m._wrapperPad.every((b) => b === 0)).toBe(true);
		expect(m._trailingPad.length).toBe(12);
		expect(m._trailingPad.every((b) => b === 0)).toBe(true);
	});

	it('decodes hand-verified cells (mainland mirrors Districts; island does not)', () => {
		const m = parseWorldPainter2D(ambMaps[0].raw);
		const cell = (x: number, y: number) => m.cells[y * m.muWidth + x];
		// Mainland cells carry the SAME byte as the district map (the mirror).
		expect(cell(100, 100)).toBe(4); // district 4 Eastern Shore → ambience 4
		expect(cell(200, 128)).toBe(14); // district 14 Downtown → ambience 14
		expect(cell(50, 200)).toBe(12); // district 12 Lone Peaks → ambience 12
		// Big Surf Island breaks the mirror: district 21 South Coast → ambience 20.
		expect(cell(300, 60)).toBe(20);
		// All four map corners are ocean / out of bounds, same as Districts.
		expect(cell(0, 0)).toBe(INVALID_CELL);
		expect(cell(383, 0)).toBe(INVALID_CELL);
		expect(cell(0, 255)).toBe(INVALID_CELL);
		expect(cell(383, 255)).toBe(INVALID_CELL);
	});

	it('uses exactly ambience ids 0..20 plus 0xFF — never 21, 22, or 23', () => {
		const m = parseWorldPainter2D(ambMaps[0].raw);
		const hist = new Map<number, number>();
		for (const v of m.cells) hist.set(v, (hist.get(v) ?? 0) + 1);
		expect(hist.size).toBe(AMBIENCE_INDEX_COUNT + 1);
		for (let a = 0; a < AMBIENCE_INDEX_COUNT; a++) {
			expect(hist.get(a) ?? 0, `ambience ${a}`).toBeGreaterThan(0);
		}
		expect(hist.get(21)).toBeUndefined();
		expect(hist.get(22)).toBeUndefined();
		expect(hist.get(23)).toBeUndefined();
		// More unpainted cells than Districts (41,449): the island's ambience
		// coverage is sparser than its district coverage.
		expect(hist.get(INVALID_CELL)).toBe(44796);
		// Largest and smallest painted ambiences, pinned from the probe.
		expect(hist.get(12)).toBe(6170); // == district 12's count, the mirror at work
		expect(hist.get(20)).toBe(496);
	});

	it('variant is recoverable from the debug name only', () => {
		expect(worldPainter2DVariantFromName(ambMaps[0].name)).toBe('ambiences');
		expect(worldPainter2DVariantFromName(maps[0].name)).toBe('districts');
		expect(worldPainter2DVariantFromName('SomethingElse')).toBeNull();
	});
});

describe('WorldPainter2D Districts↔Ambiences relationship', () => {
	// The retail ambience map is NOT an independent painting. Pinning the
	// relationship so a future painter overlay can lean on it.
	const dist = parseWorldPainter2D(maps[0].raw);
	const amb = parseWorldPainter2D(ambMaps[0].raw);

	it('mainland ambience bytes mirror the district bytes cell-for-cell (11 exceptions)', () => {
		let equal = 0;
		let unequal = 0;
		for (let i = 0; i < dist.cells.length; i++) {
			const d = dist.cells[i];
			if (d > 17) continue; // mainland districts only
			if (amb.cells[i] === d) equal++;
			else unequal++;
		}
		expect(equal).toBe(44523);
		expect(unequal).toBe(11); // 6 cells bleed to ambience 19, 5 are unpainted
	});

	it('Big Surf Island districts (18..22) collapse into ambiences 18..20', () => {
		const islandAmbiences = new Set<number>();
		for (let i = 0; i < dist.cells.length; i++) {
			if (dist.cells[i] >= 18 && dist.cells[i] !== INVALID_CELL && amb.cells[i] !== INVALID_CELL) {
				islandAmbiences.add(amb.cells[i]);
			}
		}
		expect([...islandAmbiences].sort((a, b) => a - b)).toEqual([18, 19, 20]);
	});

	it('ambiences spill past the district paint only as ambience 19 (76 cells)', () => {
		// Cells painted in Ambiences but unpainted in Districts — all carry 19,
		// the island's dominant ambience washing past the district shoreline.
		const spill = new Map<number, number>();
		for (let i = 0; i < dist.cells.length; i++) {
			if (dist.cells[i] === INVALID_CELL && amb.cells[i] !== INVALID_CELL) {
				spill.set(amb.cells[i], (spill.get(amb.cells[i]) ?? 0) + 1);
			}
		}
		expect([...spill.entries()]).toEqual([[19, 76]]);
	});
});

describe('WorldPainter2D round-trip', () => {
	const fixtures = [
		{ label: 'Districts', raw: () => maps[0].raw },
		{ label: 'Ambiences', raw: () => ambMaps[0].raw },
	];

	it.each(fixtures)('$label round-trips byte-for-byte', ({ raw }) => {
		const rewritten = writeWorldPainter2D(parseWorldPainter2D(raw()));
		expect(rewritten.byteLength).toBe(raw().byteLength);
		expect(bytesEqual(rewritten, raw())).toBe(true);
	});

	it.each(fixtures)('$label writer is idempotent', ({ raw }) => {
		const write1 = writeWorldPainter2D(parseWorldPainter2D(raw()));
		const write2 = writeWorldPainter2D(parseWorldPainter2D(write1));
		expect(bytesEqual(write2, write1)).toBe(true);
	});

	it.each(fixtures)('$label edited cells survive a round-trip', ({ raw }) => {
		const m = parseWorldPainter2D(raw());
		const cells = m.cells.slice();
		cells[100 * m.muWidth + 100] = 16; // index 16 is valid in both palettes
		const reparsed = parseWorldPainter2D(writeWorldPainter2D({ ...m, cells }));
		expect(reparsed.cells[100 * m.muWidth + 100]).toBe(16);
	});

	it('writer rejects a cell array inconsistent with the grid dims', () => {
		const m = parseWorldPainter2D(maps[0].raw);
		expect(() => writeWorldPainter2D({ ...m, cells: m.cells.slice(0, -1) })).toThrow(/cells/);
	});
});

describe('WorldPainter2D rigid-layout asserts', () => {
	// Uint8Array.from, NOT .slice(): extractResourceRaw returns a Node Buffer
	// when zlib decompresses, and Buffer.prototype.slice aliases the shared
	// bytes — mutating a "copy" would corrupt every other test's fixture.
	it('rejects a wrapper whose data offset is not 0x10', () => {
		const broken = Uint8Array.from(maps[0].raw);
		broken[4] = 0x20;
		expect(() => parseWorldPainter2D(broken)).toThrow(/mu32DataOffset/);
	});

	it('rejects a wrapper whose data size disagrees with the resource size', () => {
		const broken = Uint8Array.from(maps[0].raw);
		broken[0] = 0x00; // 0x18010 → 0x18000
		expect(() => parseWorldPainter2D(broken)).toThrow(/mu32DataSize/);
	});

	it('rejects grid dims that overrun the resource', () => {
		const broken = Uint8Array.from(maps[0].raw);
		broken[0x12] = 0xff; // muHeight 256 → 0x1FF rows
		broken[0x13] = 0x01;
		expect(() => parseWorldPainter2D(broken)).toThrow(/overruns/);
	});
});
