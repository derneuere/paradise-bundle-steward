// Gold coverage for parseStaticSoundMap / writeStaticSoundMap.
//
// Every track unit carries TWO StaticSoundMap resources (emitter + passby) but
// the auto-generated registry fixture suite only exercises the first resource
// of a type per bundle — so this suite walks BOTH, pins hand-verified decoded
// values from TRK_UNIT100, and covers the empty-map shape (TRK_UNIT0) that the
// handler's entities[0] stress scenarios can't run on.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { parseStaticSoundMap, writeStaticSoundMap, PASSBY_TYPES } from '../staticSoundMap';
import { parseBundle } from '../bundle';
import { parseDebugDataFromXml, findDebugResourceById } from '../bundle/debugData';
import { extractResourceRaw } from '../registry';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const STATIC_SOUND_MAP_TYPE_ID = 0x10016;

type ExtractedMap = { name: string; raw: Uint8Array };

function loadMaps(bundleFile: string): ExtractedMap[] {
	const buf = fs.readFileSync(path.resolve(REPO_ROOT, bundleFile));
	const buffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
	const bundle = parseBundle(buffer);
	const debugResources = typeof bundle.debugData === 'string'
		? parseDebugDataFromXml(bundle.debugData)
		: [];
	return bundle.resources
		.filter((r) => r.resourceTypeId === STATIC_SOUND_MAP_TYPE_ID)
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

describe('StaticSoundMap gold values (example/TRK_UNIT100_GR.BNDL)', () => {
	const maps = loadMaps('example/TRK_UNIT100_GR.BNDL');

	it('finds exactly two maps, emitter first, named by role', () => {
		expect(maps.length).toBe(2);
		expect(maps[0].name).toBe('TRK_UNIT100_Emitter');
		expect(maps[1].name).toBe('TRK_UNIT100_Passby');
	});

	it('decodes the emitter map', () => {
		const m = parseStaticSoundMap(maps[0].raw);
		expect(m.mMin).toEqual({ x: 3400, y: -500 });
		expect(m.mMax).toEqual({ x: 3450, y: -350 });
		expect(m.mfSubRegionSize).toBe(50);
		expect(m.miNumSubRegionsX).toBe(1);
		expect(m.miNumSubRegionsZ).toBe(3);
		expect(m.entities.length).toBe(2);
		// Emitter semantics: muTypeOrDistance is the audible distance in metres.
		expect(m.entities[0].mPosition.x).toBeCloseTo(3417.8, 1);
		expect(m.entities[0].mPosition.y).toBeCloseTo(-32.9, 1);
		expect(m.entities[0].mPosition.z).toBeCloseTo(-458.2, 1);
		expect(m.entities[0].muTypeOrDistance).toBe(86);
		expect(m.entities[0].muSoundIndex).toBe(14);
		// rootType is 0 even though this is the emitter map — the role only
		// exists in the debug name. Pin it so a "fix" trusting it gets caught.
		expect(m.meRootType).toBe(0);
	});

	it('decodes the passby map', () => {
		const m = parseStaticSoundMap(maps[1].raw);
		expect(m.miNumSubRegionsX).toBe(4);
		expect(m.miNumSubRegionsZ).toBe(8);
		expect(m.entities.length).toBe(24);
		// Passby semantics: muTypeOrDistance indexes PASSBY_TYPES.
		expect(m.entities[0].muTypeOrDistance).toBe(12);
		expect(PASSBY_TYPES[m.entities[0].muTypeOrDistance]).toBe('Collision');
		expect(m.entities[0].muSoundIndex).toBe(7);
		expect(m.subRegions.length).toBe(4 * 8);
		expect(m.subRegions[0]).toEqual({ mi16First: 0, mi16Count: 2 });
	});

	it('subregion runs exactly cover the entity array', () => {
		for (const { raw } of maps) {
			const m = parseStaticSoundMap(raw);
			let covered = 0;
			for (const cell of m.subRegions) {
				if (cell.mi16First >= 0) covered += cell.mi16Count;
				else expect(cell.mi16Count).toBe(0);
			}
			expect(covered).toBe(m.entities.length);
		}
	});
});

describe('StaticSoundMap empty maps (example/TRK_UNIT0_GR.BNDL)', () => {
	const maps = loadMaps('example/TRK_UNIT0_GR.BNDL');

	it('parses the empty shape: 1x1 grid, no entities, [-1,0] cell', () => {
		expect(maps.length).toBe(2);
		for (const { raw } of maps) {
			const m = parseStaticSoundMap(raw);
			expect(m.entities.length).toBe(0);
			expect(m.miNumSubRegionsX).toBe(1);
			expect(m.miNumSubRegionsZ).toBe(1);
			expect(m.subRegions).toEqual([{ mi16First: -1, mi16Count: 0 }]);
			// Empty maps keep valid offsets (header 0x40 + 4-byte grid → pad to
			// 0x50), unlike the null-pointer shape empty prop zones use.
			expect(m._trailingPad.byteLength).toBe(0x50 - 0x44);
		}
	});
});

describe('StaticSoundMap round-trip', () => {
	const bundles = [
		'example/TRK_UNIT100_GR.BNDL',
		'example/TRK_UNIT380_GR.BNDL',
		'example/TRK_UNIT0_GR.BNDL',
	];

	for (const bundleFile of bundles) {
		it(`round-trips both maps of ${bundleFile} byte-for-byte`, () => {
			for (const { name, raw } of loadMaps(bundleFile)) {
				const rewritten = writeStaticSoundMap(parseStaticSoundMap(raw));
				expect(rewritten.byteLength, name).toBe(raw.byteLength);
				expect(bytesEqual(rewritten, raw), name).toBe(true);
			}
		});
	}

	it('writer rejects a subregion array inconsistent with the grid dims', () => {
		const m = parseStaticSoundMap(loadMaps(bundles[0])[0].raw);
		const broken = { ...m, subRegions: m.subRegions.slice(0, -1) };
		expect(() => writeStaticSoundMap(broken)).toThrow(/subregions/);
	});
});
