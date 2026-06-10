// Gold coverage for parseWorldPainter2D / writeWorldPainter2D.
//
// Fixture: example/DISTRICTS.DAT — a 2,560-byte bundle whose single 0x30
// resource decompresses 42x to 98,336 bytes (the map is mostly long runs of
// the same district). Pins hand-verified decoded values from a byte-level
// probe: the BinaryFile wrapper offsets, the 384x256 grid dims, individual
// cells located on the downsampled ASCII render, and the exact value
// histogram (all 23 v1.9/Remastered districts in use + 41,449 0xFF cells).

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
	parseWorldPainter2D,
	writeWorldPainter2D,
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

describe('WorldPainter2D round-trip', () => {
	it('round-trips byte-for-byte', () => {
		const rewritten = writeWorldPainter2D(parseWorldPainter2D(maps[0].raw));
		expect(rewritten.byteLength).toBe(maps[0].raw.byteLength);
		expect(bytesEqual(rewritten, maps[0].raw)).toBe(true);
	});

	it('writer is idempotent', () => {
		const write1 = writeWorldPainter2D(parseWorldPainter2D(maps[0].raw));
		const write2 = writeWorldPainter2D(parseWorldPainter2D(write1));
		expect(bytesEqual(write2, write1)).toBe(true);
	});

	it('edited cells survive a round-trip', () => {
		const m = parseWorldPainter2D(maps[0].raw);
		const cells = m.cells.slice();
		cells[100 * m.muWidth + 100] = 16; // Eastern Shore cell → Motor City
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
