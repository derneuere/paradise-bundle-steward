// EnvironmentDictionary parser and writer (resource type 0x10014).
//
// The single ENV_DICTIONARY resource (ENVIRONMENTSETTINGS/DICTIONARY.BUNDLE)
// is the game's catalogue of environment-settings "seasons" — weather/time-of-
// day looks like SUN, OC (overcast), FOG — plus the list of locations the
// per-season keyframes are authored for. Each SeasonData row names:
//   - macResourceName: the debug name of the EnvironmentTimeLine (0x10013)
//     resource inside the season's bundle (ENV_TL_<season>). Resource IDs in
//     Burnout Paradise are CRC32 of the lowercased debug name, so
//     crc32(lower(macResourceName)) is the timeline's resource id — that is
//     how the game finds the timeline after loading the bundle.
//   - macBundle: game-relative path (backslash separators, e.g.
//     "EnvironmentSettings\000_DLC24hr_SUN_A.bundle") of the bundle carrying
//     the timeline (0x10013) + its keyframes (0x10012).
//   - macColourCubesBundle: game-relative path of the matching colour-cube
//     (post-process tint) texture bundle under EnvironmentSettings\ColourCubes.
// LocationData rows are bare names ("city") matching the location segment of
// keyframe debug names (ENV_KF_<season>_<location>_<time>).
//
// On-disk layout (32-bit PC, little-endian; wiki muVersion 2):
//   0x00 u32 muVersion          — always 2
//   0x04 u32 muSeasonCnt
//   0x08 u32 mpSeasonDatii      — file-relative offset, always 0x20 (the 0x14
//                                 header padded to 16-byte alignment)
//   0x0C u32 muLocationCnt
//   0x10 u32 mpLocationDatii    — 0x20 + muSeasonCnt * 0x100
//   0x14 12B pad to 0x20        — zeros in retail; preserved verbatim
//   SeasonData[muSeasonCnt]     — 0x100 each: char[128] macResourceName,
//                                 char[64] macBundle, char[64] macColourCubesBundle
//   LocationData[muLocationCnt] — 0x40 each: char[64] macName
// The records tile the resource exactly; record sizes are all multiples of 16
// so no trailing pad exists.
//
// Round-trip strategy: offsets/counts are recomputed from the arrays on write.
// Fixed char arrays are NUL-terminated with all-zero tails in the fixture; the
// parser THROWS on a non-zero tail (or a missing NUL) rather than silently
// dropping bytes the writer's zero-fill could not reproduce.

import { BinReader, BinWriter } from './binTools';

// =============================================================================
// Types
// =============================================================================

export type EnvironmentDictionarySeason = {
	/** Debug name of the season's EnvironmentTimeLine (0x10013); crc32(lowercase) = its resource id. Max 127 chars. */
	macResourceName: string;
	/** Game-relative path of the season's settings bundle (backslash separators). Max 63 chars. */
	macBundle: string;
	/** Game-relative path of the season's colour-cube bundle. Max 63 chars. */
	macColourCubesBundle: string;
};

export type EnvironmentDictionaryLocation = {
	/** Location name matched against the keyframe debug names (ENV_KF_<season>_<location>_<time>). Max 63 chars. */
	macName: string;
};

export type ParsedEnvironmentDictionary = {
	/** Format version — 2 in retail; the parser rejects anything else. */
	muVersion: number;
	seasons: EnvironmentDictionarySeason[];
	locations: EnvironmentDictionaryLocation[];
	/** 12 header-alignment bytes at 0x14 (zeros in retail) — preserved verbatim. */
	_headerPad: Uint8Array;
};

// =============================================================================
// Constants
// =============================================================================

const SUPPORTED_VERSION = 2;
const HEADER_FIELDS_SIZE = 0x14;
// SeasonData always starts at the 16-byte-aligned end of the header, even for
// the (unobserved) zero-season shape — keeps the writer deterministic.
const SEASONS_OFFSET = 0x20;
const HEADER_PAD_SIZE = SEASONS_OFFSET - HEADER_FIELDS_SIZE;
const SEASON_RECORD_SIZE = 0x100;
const LOCATION_RECORD_SIZE = 0x40;
export const SEASON_RESOURCE_NAME_CAP = 0x80;
export const SEASON_BUNDLE_PATH_CAP = 0x40;
export const LOCATION_NAME_CAP = 0x40;

// =============================================================================
// Fixed C-string helpers
// =============================================================================

function readFixedCString(bytes: Uint8Array, start: number, cap: number, what: string): string {
	let end = start;
	while (end < start + cap && bytes[end] !== 0) end++;
	if (end === start + cap) {
		throw new Error(`EnvironmentDictionary: ${what} has no NUL terminator within its ${cap}-byte field`);
	}
	for (let i = end; i < start + cap; i++) {
		if (bytes[i] !== 0) {
			throw new Error(
				`EnvironmentDictionary: non-zero byte 0x${bytes[i].toString(16)} after the NUL of ${what} ` +
				`(at +0x${(i - start).toString(16)}) — zero-fill write would not round-trip`,
			);
		}
	}
	return new TextDecoder().decode(bytes.subarray(start, end));
}

function writeFixedCString(w: BinWriter, value: string, cap: number, what: string): void {
	const encoded = new TextEncoder().encode(value);
	if (encoded.length > cap - 1) {
		throw new Error(`EnvironmentDictionary writer: ${what} is ${encoded.length} bytes, max ${cap - 1} (+ NUL)`);
	}
	w.writeBytes(encoded);
	w.writeZeroes(cap - encoded.length);
}

// =============================================================================
// Reader
// =============================================================================

export function parseEnvironmentDictionary(raw: Uint8Array, littleEndian = true): ParsedEnvironmentDictionary {
	// Copy up front: raw may be a Node Buffer whose .slice is a view.
	const bytes = new Uint8Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
	const r = new BinReader(bytes.buffer, littleEndian);

	const muVersion = r.readU32();
	if (muVersion !== SUPPORTED_VERSION) {
		throw new Error(`EnvironmentDictionary: unsupported muVersion ${muVersion} (expected ${SUPPORTED_VERSION})`);
	}
	const muSeasonCnt = r.readU32();
	const mpSeasonDatii = r.readU32();
	const muLocationCnt = r.readU32();
	const mpLocationDatii = r.readU32();

	// Rigid layout — bail loudly on violations rather than silently mis-parsing.
	const locationsOffset = SEASONS_OFFSET + muSeasonCnt * SEASON_RECORD_SIZE;
	const totalSize = locationsOffset + muLocationCnt * LOCATION_RECORD_SIZE;
	if (mpSeasonDatii !== SEASONS_OFFSET) {
		throw new Error(`EnvironmentDictionary: mpSeasonDatii is 0x${mpSeasonDatii.toString(16)}, expected 0x${SEASONS_OFFSET.toString(16)}`);
	}
	if (mpLocationDatii !== locationsOffset) {
		throw new Error(
			`EnvironmentDictionary: mpLocationDatii is 0x${mpLocationDatii.toString(16)}, ` +
			`expected 0x${locationsOffset.toString(16)} for ${muSeasonCnt} seasons`,
		);
	}
	if (totalSize !== bytes.byteLength) {
		throw new Error(`EnvironmentDictionary: records end at 0x${totalSize.toString(16)}, resource is 0x${bytes.byteLength.toString(16)} bytes`);
	}

	const _headerPad = bytes.slice(HEADER_FIELDS_SIZE, SEASONS_OFFSET);

	const seasons: EnvironmentDictionarySeason[] = [];
	for (let i = 0; i < muSeasonCnt; i++) {
		const base = SEASONS_OFFSET + i * SEASON_RECORD_SIZE;
		seasons.push({
			macResourceName: readFixedCString(bytes, base, SEASON_RESOURCE_NAME_CAP, `season[${i}].macResourceName`),
			macBundle: readFixedCString(bytes, base + SEASON_RESOURCE_NAME_CAP, SEASON_BUNDLE_PATH_CAP, `season[${i}].macBundle`),
			macColourCubesBundle: readFixedCString(
				bytes,
				base + SEASON_RESOURCE_NAME_CAP + SEASON_BUNDLE_PATH_CAP,
				SEASON_BUNDLE_PATH_CAP,
				`season[${i}].macColourCubesBundle`,
			),
		});
	}

	const locations: EnvironmentDictionaryLocation[] = [];
	for (let i = 0; i < muLocationCnt; i++) {
		const base = locationsOffset + i * LOCATION_RECORD_SIZE;
		locations.push({
			macName: readFixedCString(bytes, base, LOCATION_NAME_CAP, `location[${i}].macName`),
		});
	}

	return { muVersion, seasons, locations, _headerPad };
}

// =============================================================================
// Writer
// =============================================================================

export function writeEnvironmentDictionary(model: ParsedEnvironmentDictionary, littleEndian = true): Uint8Array {
	const { seasons, locations } = model;
	if (model._headerPad.byteLength !== HEADER_PAD_SIZE) {
		throw new Error(`EnvironmentDictionary writer: _headerPad is ${model._headerPad.byteLength} bytes, expected ${HEADER_PAD_SIZE}`);
	}

	const locationsOffset = SEASONS_OFFSET + seasons.length * SEASON_RECORD_SIZE;
	const totalSize = locationsOffset + locations.length * LOCATION_RECORD_SIZE;
	const w = new BinWriter(totalSize, littleEndian);

	w.writeU32(model.muVersion);
	w.writeU32(seasons.length);
	w.writeU32(SEASONS_OFFSET); // mpSeasonDatii
	w.writeU32(locations.length);
	w.writeU32(locationsOffset); // mpLocationDatii
	w.writeBytes(model._headerPad);
	if (w.offset !== SEASONS_OFFSET) {
		throw new Error(`EnvironmentDictionary writer: header offset mismatch ${w.offset} vs ${SEASONS_OFFSET}`);
	}

	seasons.forEach((s, i) => {
		writeFixedCString(w, s.macResourceName, SEASON_RESOURCE_NAME_CAP, `season[${i}].macResourceName`);
		writeFixedCString(w, s.macBundle, SEASON_BUNDLE_PATH_CAP, `season[${i}].macBundle`);
		writeFixedCString(w, s.macColourCubesBundle, SEASON_BUNDLE_PATH_CAP, `season[${i}].macColourCubesBundle`);
	});
	if (w.offset !== locationsOffset) {
		throw new Error(`EnvironmentDictionary writer: locations offset mismatch ${w.offset} vs ${locationsOffset}`);
	}

	locations.forEach((l, i) => {
		writeFixedCString(w, l.macName, LOCATION_NAME_CAP, `location[${i}].macName`);
	});
	if (w.offset !== totalSize) {
		throw new Error(`EnvironmentDictionary writer: wrote ${w.offset} bytes, expected ${totalSize}`);
	}

	return w.bytes;
}
