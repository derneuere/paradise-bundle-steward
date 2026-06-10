// Gold coverage for parseEnvironmentDictionary / writeEnvironmentDictionary.
//
// DICTIONARY.BUNDLE carries exactly one ENV_DICTIONARY (0x10014) resource.
// Beyond the byte-exact round-trip, this suite pins the cross-bundle contract
// the dictionary exists for: each season's macBundle path resolves to a
// sibling environment-settings bundle whose single EnvironmentTimeLine
// (0x10013) resource has id crc32(lowercase(macResourceName)) and the same
// debug name — Burnout resource ids are CRC32 of the lowercased debug name.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { crc32 } from 'node:zlib';

import {
	parseEnvironmentDictionary,
	writeEnvironmentDictionary,
} from '../environmentDictionary';
import { parseBundle } from '../bundle';
import { parseDebugDataFromXml, findDebugResourceById } from '../bundle/debugData';
import { extractResourceRaw } from '../registry';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const ENV_DICTIONARY_TYPE_ID = 0x10014;
const ENV_TIMELINE_TYPE_ID = 0x10013;
const DICTIONARY_BUNDLE = 'example/ENVIRONMENTSETTINGS/DICTIONARY.BUNDLE';

function loadBundle(bundleFile: string) {
	const buf = fs.readFileSync(path.resolve(REPO_ROOT, bundleFile));
	const buffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
	return { buffer, bundle: parseBundle(buffer) };
}

function loadDictionaryRaw(): Uint8Array {
	const { buffer, bundle } = loadBundle(DICTIONARY_BUNDLE);
	const resources = bundle.resources.filter((r) => r.resourceTypeId === ENV_DICTIONARY_TYPE_ID);
	expect(resources.length).toBe(1);
	return extractResourceRaw(buffer, bundle, resources[0]);
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.byteLength !== b.byteLength) return false;
	for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
	return true;
}

/** Resolve a game-relative path ("EnvironmentSettings\X.bundle") against the
 *  fixture tree case-insensitively (retail stores mixed case, the fixtures
 *  are uppercase). */
function resolveGamePath(gamePath: string): string {
	let dir = path.resolve(REPO_ROOT, 'example');
	const segments = gamePath.split('\\');
	for (const segment of segments) {
		const match = fs.readdirSync(dir).find((e) => e.toLowerCase() === segment.toLowerCase());
		expect(match, `${segment} (from ${gamePath}) in ${dir}`).toBeDefined();
		dir = path.join(dir, match!);
	}
	return dir;
}

describe('EnvironmentDictionary gold values (example/ENVIRONMENTSETTINGS/DICTIONARY.BUNDLE)', () => {
	const raw = loadDictionaryRaw();
	const m = parseEnvironmentDictionary(raw);

	it('decodes the header: version 2, 4 seasons, 1 location, zero header pad', () => {
		expect(m.muVersion).toBe(2);
		expect(m.seasons.length).toBe(4);
		expect(m.locations.length).toBe(1);
		expect(m._headerPad.byteLength).toBe(12);
		expect(m._headerPad.every((b) => b === 0)).toBe(true);
		// Header 0x20 + 4*0x100 seasons + 1*0x40 location = 0x460, tiled exactly.
		expect(raw.byteLength).toBe(0x460);
	});

	it('decodes the four seasons in disk order: SUN, OC, FOG, JunkyardT', () => {
		expect(m.seasons.map((s) => s.macResourceName)).toEqual([
			'ENV_TL_000_DLC24hr_SUN_A',
			'ENV_TL_000_DLC24hr_OC_A',
			'ENV_TL_000_DLC24hr_FOG_A',
			'ENV_TL_000_DLC24hr_JunkyardT',
		]);
		expect(m.seasons[0].macBundle).toBe('EnvironmentSettings\\000_DLC24hr_SUN_A.bundle');
		expect(m.seasons[0].macColourCubesBundle).toBe('EnvironmentSettings\\ColourCubes\\000_DLC24hr_SUN_A.bundle');
		expect(m.seasons[3].macBundle).toBe('EnvironmentSettings\\000_DLC24hr_JunkyardT.bundle');
		expect(m.seasons[3].macColourCubesBundle).toBe('EnvironmentSettings\\ColourCubes\\000_DLC24hr_JunkyardT.bundle');
	});

	it('decodes the single location "city"', () => {
		expect(m.locations).toEqual([{ macName: 'city' }]);
	});

	it('the dictionary resource id itself is crc32("env_dictionary")', () => {
		const { bundle } = loadBundle(DICTIONARY_BUNDLE);
		const res = bundle.resources.find((r) => r.resourceTypeId === ENV_DICTIONARY_TYPE_ID)!;
		expect(res.resourceId.low >>> 0).toBe(crc32(Buffer.from('env_dictionary')) >>> 0);
		expect(res.resourceId.high).toBe(0);
	});
});

describe('EnvironmentDictionary cross-bundle contract', () => {
	const m = parseEnvironmentDictionary(loadDictionaryRaw());

	it('every macBundle / macColourCubesBundle path resolves to a fixture bundle', () => {
		for (const s of m.seasons) {
			expect(fs.existsSync(resolveGamePath(s.macBundle)), s.macBundle).toBe(true);
			expect(fs.existsSync(resolveGamePath(s.macColourCubesBundle)), s.macColourCubesBundle).toBe(true);
		}
	});

	it('each season bundle has exactly one timeline (0x10013) whose id and debug name derive from macResourceName', () => {
		for (const s of m.seasons) {
			const sibPath = resolveGamePath(s.macBundle);
			const buf = fs.readFileSync(sibPath);
			const buffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
			const bundle = parseBundle(buffer);
			const timelines = bundle.resources.filter((r) => r.resourceTypeId === ENV_TIMELINE_TYPE_ID);
			expect(timelines.length, s.macBundle).toBe(1);
			// Resource ids are CRC32 of the lowercased debug name — this is how
			// the game finds the timeline named by the dictionary entry.
			const expectedId = crc32(Buffer.from(s.macResourceName.toLowerCase())) >>> 0;
			expect(timelines[0].resourceId.low >>> 0, s.macResourceName).toBe(expectedId);
			const debugResources = typeof bundle.debugData === 'string'
				? parseDebugDataFromXml(bundle.debugData)
				: [];
			const debugEntry = findDebugResourceById(debugResources, timelines[0].resourceId.low.toString(16));
			expect(debugEntry?.name, s.macBundle).toBe(s.macResourceName);
		}
	});

	it('the location name appears in every season bundle\'s keyframe names (ENV_KF_<season>_<location>_<time>)', () => {
		const location = m.locations[0].macName;
		for (const s of m.seasons) {
			const buf = fs.readFileSync(resolveGamePath(s.macBundle));
			const buffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
			const bundle = parseBundle(buffer);
			const debugResources = typeof bundle.debugData === 'string'
				? parseDebugDataFromXml(bundle.debugData)
				: [];
			const keyframeNames = debugResources
				.filter((d) => d.name.startsWith('ENV_KF_'))
				.map((d) => d.name);
			expect(keyframeNames.length, s.macBundle).toBeGreaterThan(0);
			for (const name of keyframeNames) {
				expect(name, s.macBundle).toContain(`_${location}_`);
			}
		}
	});
});

describe('EnvironmentDictionary round-trip', () => {
	const raw = loadDictionaryRaw();

	it('round-trips byte-for-byte and the writer is idempotent', () => {
		const write1 = writeEnvironmentDictionary(parseEnvironmentDictionary(raw));
		expect(write1.byteLength).toBe(raw.byteLength);
		expect(bytesEqual(write1, raw)).toBe(true);
		const write2 = writeEnvironmentDictionary(parseEnvironmentDictionary(write1));
		expect(bytesEqual(write2, write1)).toBe(true);
	});

	it('recomputes mpLocationDatii when a season is removed', () => {
		const m = parseEnvironmentDictionary(raw);
		const out = writeEnvironmentDictionary({ ...m, seasons: m.seasons.slice(0, 2) });
		expect(out.byteLength).toBe(0x20 + 2 * 0x100 + 0x40);
		const dv = new DataView(out.buffer, out.byteOffset, out.byteLength);
		expect(dv.getUint32(0x10, true)).toBe(0x20 + 2 * 0x100);
		const back = parseEnvironmentDictionary(out);
		expect(back.seasons.map((s) => s.macResourceName)).toEqual([
			'ENV_TL_000_DLC24hr_SUN_A',
			'ENV_TL_000_DLC24hr_OC_A',
		]);
		expect(back.locations).toEqual([{ macName: 'city' }]);
	});
});

describe('EnvironmentDictionary rigid-layout guards', () => {
	const raw = loadDictionaryRaw();

	it('parser rejects an unknown version', () => {
		const mutated = new Uint8Array(raw); // copy — raw may be a Buffer view
		mutated[0] = 3;
		expect(() => parseEnvironmentDictionary(mutated)).toThrow(/muVersion 3/);
	});

	it('parser rejects a season count inconsistent with mpLocationDatii', () => {
		const mutated = new Uint8Array(raw);
		mutated[0x4] = 5; // muSeasonCnt 4 -> 5 without moving mpLocationDatii
		expect(() => parseEnvironmentDictionary(mutated)).toThrow(/mpLocationDatii/);
	});

	it('parser rejects garbage after a string NUL (zero-fill write could not reproduce it)', () => {
		const mutated = new Uint8Array(raw);
		mutated[0x9f] = 0xab; // last byte of season[0].macResourceName's zero tail
		expect(() => parseEnvironmentDictionary(mutated)).toThrow(/non-zero byte/);
	});

	it('parser rejects a string with no NUL terminator', () => {
		const mutated = new Uint8Array(raw);
		mutated.fill(0x41, 0x420, 0x460); // location[0].macName all 'A'
		expect(() => parseEnvironmentDictionary(mutated)).toThrow(/no NUL terminator/);
	});

	it('writer rejects a string that overflows its fixed field', () => {
		const m = parseEnvironmentDictionary(raw);
		const seasons = m.seasons.slice();
		seasons[0] = { ...seasons[0], macBundle: 'x'.repeat(0x40) };
		expect(() => writeEnvironmentDictionary({ ...m, seasons })).toThrow(/max 63/);
	});
});
