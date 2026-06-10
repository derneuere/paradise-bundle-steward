// Hand-written schema for ParsedEnvironmentDictionary (resource type 0x10014).
//
// Mirrors the types in `src/lib/core/environmentDictionary.ts`. Keep these in
// lockstep with the parser/writer — any field added to the parser needs a
// matching entry here, or the schema walker reports it as drift.
//
// Domain: the dictionary is the game's catalogue of environment-settings
// "seasons" (weather/time-of-day looks). Each entry names the season's
// EnvironmentTimeLine resource, the bundle file carrying that timeline + its
// keyframes, and the colour-cube (post-process tint) bundle. The game loads
// the bundle by macBundle's literal game-relative path and finds the timeline
// inside via crc32(lowercase(macResourceName)) — so renaming an entry without
// renaming the resource in the target bundle orphans the season. Location
// names pair with seasons to select keyframe sets
// (ENV_KF_<season>_<location>_<time>).

import {
	SEASON_RESOURCE_NAME_CAP,
	SEASON_BUNDLE_PATH_CAP,
	LOCATION_NAME_CAP,
} from '@/lib/core/environmentDictionary';
import type {
	FieldSchema,
	RecordSchema,
	ResourceSchema,
	SchemaRegistry,
	ValidationResult,
} from '../types';

// ---------------------------------------------------------------------------
// Local helpers (mirroring staticSoundMap.ts)
// ---------------------------------------------------------------------------

const u32 = (): FieldSchema => ({ kind: 'u32' });
const str = (): FieldSchema => ({ kind: 'string' });
const record = (type: string): FieldSchema => ({ kind: 'record', type });
const rawBytes = (): FieldSchema => ({ kind: 'custom', component: 'rawBytes' });

// The writer needs every string to fit its fixed char array (capacity − 1
// chars + NUL); validate at edit time so the failure isn't a write-time throw.
function fixedStringOverflow(
	value: Record<string, unknown>,
	field: string,
	cap: number,
): ValidationResult[] {
	const text = value[field];
	if (typeof text !== 'string') return [];
	const byteLength = new TextEncoder().encode(text).length;
	if (byteLength <= cap - 1) return [];
	return [{
		severity: 'error',
		message: `${field} is ${byteLength} bytes; the on-disk field holds at most ${cap - 1} (+ NUL terminator)`,
		field,
	}];
}

// ---------------------------------------------------------------------------
// Tree-label helpers
// ---------------------------------------------------------------------------

function seasonLabel(season: unknown, index: number): string {
	if (!season || typeof season !== 'object') return `#${index}`;
	const name = (season as { macResourceName?: string }).macResourceName;
	if (!name) return `#${index}`;
	// "ENV_TL_000_DLC24hr_SUN_A" → "000_DLC24hr_SUN_A": every retail timeline
	// name carries the ENV_TL_ prefix, which adds no information in the tree.
	return `#${index} · ${name.startsWith('ENV_TL_') ? name.slice('ENV_TL_'.length) : name}`;
}

function locationLabel(location: unknown, index: number): string {
	if (!location || typeof location !== 'object') return `#${index}`;
	const name = (location as { macName?: string }).macName;
	return name ? `#${index} · ${name}` : `#${index}`;
}

// ---------------------------------------------------------------------------
// Record schemas
// ---------------------------------------------------------------------------

const EnvironmentDictionarySeason: RecordSchema = {
	name: 'EnvironmentDictionarySeason',
	description: 'One environment-settings "season" (weather/time-of-day look): the timeline resource it provides, the bundle carrying it, and the matching colour-cube bundle.',
	fields: {
		macResourceName: str(),
		macBundle: str(),
		macColourCubesBundle: str(),
	},
	fieldMetadata: {
		macResourceName: {
			label: 'Timeline resource name',
			description: `Debug name of the EnvironmentTimeLine (0x10013) inside the season's bundle, e.g. ENV_TL_000_DLC24hr_SUN_A. The game resolves it by crc32(lowercase(name)), so it must match the resource in the target bundle exactly (case-insensitively). Max ${SEASON_RESOURCE_NAME_CAP - 1} chars.`,
		},
		macBundle: {
			label: 'Settings bundle path',
			description: `Game-relative path of the bundle carrying the timeline + keyframes, backslash separators, e.g. EnvironmentSettings\\000_DLC24hr_SUN_A.bundle. Loaded literally — a wrong path is a missing season at runtime. Max ${SEASON_BUNDLE_PATH_CAP - 1} chars.`,
		},
		macColourCubesBundle: {
			label: 'Colour-cubes bundle path',
			description: `Game-relative path of the season's colour-cube (post-process tint) texture bundle, e.g. EnvironmentSettings\\ColourCubes\\000_DLC24hr_SUN_A.bundle. Max ${SEASON_BUNDLE_PATH_CAP - 1} chars.`,
		},
	},
	propertyGroups: [
		{ title: 'Season', properties: ['macResourceName', 'macBundle', 'macColourCubesBundle'] },
	],
	label: (value, index) => seasonLabel(value, index ?? 0),
	validate: (value) => [
		...fixedStringOverflow(value, 'macResourceName', SEASON_RESOURCE_NAME_CAP),
		...fixedStringOverflow(value, 'macBundle', SEASON_BUNDLE_PATH_CAP),
		...fixedStringOverflow(value, 'macColourCubesBundle', SEASON_BUNDLE_PATH_CAP),
	],
};

const EnvironmentDictionaryLocation: RecordSchema = {
	name: 'EnvironmentDictionaryLocation',
	description: 'A location the environment keyframes are authored for — pairs with a season to select a keyframe set (ENV_KF_<season>_<location>_<time>). Retail uses a single "city".',
	fields: {
		macName: str(),
	},
	fieldMetadata: {
		macName: {
			label: 'Name',
			description: `Location name matched against the keyframe debug names in the season bundles. Max ${LOCATION_NAME_CAP - 1} chars.`,
		},
	},
	label: (value, index) => locationLabel(value, index ?? 0),
	validate: (value) => fixedStringOverflow(value, 'macName', LOCATION_NAME_CAP),
};

// ---------------------------------------------------------------------------
// Root + registry export
// ---------------------------------------------------------------------------

const ParsedEnvironmentDictionary: RecordSchema = {
	name: 'ParsedEnvironmentDictionary',
	description: 'Root record for the EnvironmentDictionary resource (0x10014): the catalogue of every environment-settings bundle the game can load, plus the location names their keyframes cover.',
	fields: {
		muVersion: u32(),
		seasons: {
			kind: 'list',
			item: record('EnvironmentDictionarySeason'),
			itemLabel: (item, index) => seasonLabel(item, index),
			makeEmpty: () => ({ macResourceName: '', macBundle: '', macColourCubesBundle: '' }),
		},
		locations: {
			kind: 'list',
			item: record('EnvironmentDictionaryLocation'),
			itemLabel: (item, index) => locationLabel(item, index),
			makeEmpty: () => ({ macName: '' }),
		},
		_headerPad: rawBytes(),
	},
	fieldMetadata: {
		muVersion: {
			label: 'Version',
			description: 'Dictionary format version — 2 in every retail build; the parser rejects anything else.',
			readOnly: true,
		},
		seasons: {
			label: 'Seasons',
			description: 'One entry per environment-settings bundle. An entry only works if its bundle paths exist on disk and the named timeline resource lives inside.',
		},
		locations: {
			label: 'Locations',
			description: 'Location names the per-season keyframes are authored for. Retail uses a single "city".',
		},
		_headerPad: {
			label: 'Header pad',
			description: '12 alignment bytes between the 0x14-byte header and the season table (zeros in retail). Preserved verbatim for byte-exact round-trip.',
			hidden: true,
		},
	},
	propertyGroups: [
		{ title: 'Dictionary', properties: ['muVersion', 'seasons', 'locations'] },
	],
};

const registry: SchemaRegistry = {
	ParsedEnvironmentDictionary,
	EnvironmentDictionarySeason,
	EnvironmentDictionaryLocation,
};

export const environmentDictionaryResourceSchema: ResourceSchema = {
	key: 'environmentDictionary',
	name: 'Environment Dictionary',
	rootType: 'ParsedEnvironmentDictionary',
	registry,
};
