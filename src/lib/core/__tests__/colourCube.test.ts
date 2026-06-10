// Gold coverage for parseColourCube / writeColourCube (resource type 0x2B).
//
// Pins the byte-level facts established against all four retail DLC24HR
// fixtures: 16-byte header (the wiki's struct table only documents 8 bytes,
// but its file-size formula m_size^3*3+16 implies — and the bytes confirm —
// the 16-byte header), m_pixels always 0x10, dense X-major RGB24 body, and
// the surprising retail content: all four payloads are byte-identical and
// hold the SAME separable "default RGB CLUT" (one shared per-channel S-curve
// ramp), matching the wiki's note that the 1.6 update reverted the art-style
// cubes to a default RGB CLUT.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
	parseColourCube,
	writeColourCube,
	colourCubeTexel,
	setColourCubeTexel,
	COLOURCUBE_HEADER_SIZE,
} from '../colourCube';
import { parseBundle } from '../bundle';
import { extractResourceRaw } from '../registry';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const COLOURCUBE_TYPE_ID = 0x2b;

const FIXTURES = [
	'example/ENVIRONMENTSETTINGS/COLOURCUBES/000_DLC24HR_FOG_A.BUNDLE',
	'example/ENVIRONMENTSETTINGS/COLOURCUBES/000_DLC24HR_JUNKYARDT.BUNDLE',
	'example/ENVIRONMENTSETTINGS/COLOURCUBES/000_DLC24HR_OC_A.BUNDLE',
	'example/ENVIRONMENTSETTINGS/COLOURCUBES/000_DLC24HR_SUN_A.BUNDLE',
];

// Hand-verified shared per-channel tone ramp of the retail default CLUT —
// texel(x,y,z) = (RAMP[x], RAMP[y], RAMP[z]) for every one of the 32^3 texels.
const RETAIL_RAMP = [
	0, 5, 10, 16, 22, 28, 35, 44, 51, 60, 69, 78, 89, 99, 110, 121,
	134, 145, 156, 166, 177, 186, 195, 204, 211, 220, 227, 233, 239, 245, 250, 255,
];

function loadCube(bundleFile: string): Uint8Array {
	const buf = fs.readFileSync(path.resolve(REPO_ROOT, bundleFile));
	const buffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
	const bundle = parseBundle(buffer);
	const resources = bundle.resources.filter((r) => r.resourceTypeId === COLOURCUBE_TYPE_ID);
	expect(resources.length).toBe(1);
	return extractResourceRaw(buffer, bundle, resources[0]);
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.byteLength !== b.byteLength) return false;
	for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
	return true;
}

describe('ColourCube gold values (example/ENVIRONMENTSETTINGS/COLOURCUBES)', () => {
	const raws = FIXTURES.map(loadCube);

	it('decodes the header: 32^3 cube, m_pixels offset 0x10, zero pads', () => {
		const m = parseColourCube(raws[0]);
		expect(m.mSize).toBe(32);
		expect(m.pixels.byteLength).toBe(32 * 32 * 32 * 3);
		expect(m._pad08).toBe(0);
		expect(m._pad0C).toBe(0);
		// The wiki size formula: m_size^3 * 3 + 16.
		expect(raws[0].byteLength).toBe(32 ** 3 * 3 + COLOURCUBE_HEADER_SIZE);
	});

	it('all four DLC24HR payloads are byte-identical (the shared default RGB CLUT)', () => {
		for (let i = 1; i < raws.length; i++) {
			expect(bytesEqual(raws[i], raws[0]), FIXTURES[i]).toBe(true);
		}
	});

	it('corner texels prove the axis mapping: x→R, y→G, z→B', () => {
		const m = parseColourCube(raws[0]);
		expect(colourCubeTexel(m, 0, 0, 0)).toEqual({ r: 0, g: 0, b: 0 });
		expect(colourCubeTexel(m, 31, 0, 0)).toEqual({ r: 255, g: 0, b: 0 });
		expect(colourCubeTexel(m, 0, 31, 0)).toEqual({ r: 0, g: 255, b: 0 });
		expect(colourCubeTexel(m, 0, 0, 31)).toEqual({ r: 0, g: 0, b: 255 });
		expect(colourCubeTexel(m, 31, 31, 31)).toEqual({ r: 255, g: 255, b: 255 });
	});

	it('the retail default CLUT is separable: texel(x,y,z) = (RAMP[x], RAMP[y], RAMP[z])', () => {
		const m = parseColourCube(raws[0]);
		for (let i = 0; i < 32; i++) {
			expect(colourCubeTexel(m, i, 0, 0).r, `RAMP[${i}]`).toBe(RETAIL_RAMP[i]);
		}
		// Full-cube separability — the grade is a pure per-channel tone curve.
		for (let z = 0; z < 32; z++) {
			for (let y = 0; y < 32; y++) {
				for (let x = 0; x < 32; x++) {
					const t = colourCubeTexel(m, x, y, z);
					if (t.r !== RETAIL_RAMP[x] || t.g !== RETAIL_RAMP[y] || t.b !== RETAIL_RAMP[z]) {
						throw new Error(`texel (${x},${y},${z}) = (${t.r},${t.g},${t.b}), expected ramp (${RETAIL_RAMP[x]},${RETAIL_RAMP[y]},${RETAIL_RAMP[z]})`);
					}
				}
			}
		}
	});

	it('parsed pixels are a copy, not a view of the source bytes', () => {
		const raw = loadCube(FIXTURES[0]);
		const m = parseColourCube(raw);
		setColourCubeTexel(m, 0, 0, 0, { r: 99, g: 99, b: 99 });
		expect(raw[COLOURCUBE_HEADER_SIZE]).toBe(0);
	});
});

describe('ColourCube round-trip', () => {
	for (const fixture of FIXTURES) {
		it(`round-trips ${path.basename(fixture)} byte-for-byte`, () => {
			const raw = loadCube(fixture);
			const rewritten = writeColourCube(parseColourCube(raw));
			expect(rewritten.byteLength).toBe(raw.byteLength);
			expect(bytesEqual(rewritten, raw)).toBe(true);
		});
	}

	it('writer is idempotent', () => {
		const raw = loadCube(FIXTURES[0]);
		const once = writeColourCube(parseColourCube(raw));
		const twice = writeColourCube(parseColourCube(once));
		expect(bytesEqual(twice, once)).toBe(true);
	});

	it('an edited texel survives parse→write→parse', () => {
		const m = parseColourCube(loadCube(FIXTURES[0]));
		setColourCubeTexel(m, 5, 6, 7, { r: 1, g: 2, b: 3 });
		const back = parseColourCube(writeColourCube(m));
		expect(colourCubeTexel(back, 5, 6, 7)).toEqual({ r: 1, g: 2, b: 3 });
	});
});

describe('ColourCube rigid-layout guards', () => {
	it('parser rejects a resource whose size disagrees with m_size^3*3+16', () => {
		const raw = loadCube(FIXTURES[0]);
		expect(() => parseColourCube(raw.subarray(0, raw.byteLength - 1))).toThrow(/m_size/);
	});

	it('parser rejects a non-0x10 m_pixels offset', () => {
		const raw = new Uint8Array(loadCube(FIXTURES[0]));
		raw[4] = 0x20;
		expect(() => parseColourCube(raw)).toThrow(/m_pixels/);
	});

	it('parser rejects a sub-header-sized resource', () => {
		expect(() => parseColourCube(new Uint8Array(8))).toThrow(/header/);
	});

	it('writer rejects a pixel buffer inconsistent with mSize', () => {
		const m = parseColourCube(loadCube(FIXTURES[0]));
		const broken = { ...m, pixels: m.pixels.subarray(0, m.pixels.byteLength - 3) };
		expect(() => writeColourCube(broken)).toThrow(/pixel bytes/);
	});

	it('texel accessors reject out-of-cube coordinates', () => {
		const m = parseColourCube(loadCube(FIXTURES[0]));
		expect(() => colourCubeTexel(m, 32, 0, 0)).toThrow(/outside/);
		expect(() => colourCubeTexel(m, 0, -1, 0)).toThrow(/outside/);
		expect(() => setColourCubeTexel(m, 0, 0, 32, { r: 0, g: 0, b: 0 })).toThrow(/outside/);
	});
});
