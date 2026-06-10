// EnvironmentDictionary registry handler — thin wrapper around
// parseEnvironmentDictionary / writeEnvironmentDictionary in
// src/lib/core/environmentDictionary.ts.
//
// One ENV_DICTIONARY resource per game install (DICTIONARY.BUNDLE carries
// exactly one), so no picker config. Adding a season here only matters if the
// referenced bundle paths exist on disk — the game loads macBundle /
// macColourCubesBundle by these literal game-relative paths and resolves the
// timeline inside by crc32(lowercase(macResourceName)).

import {
	parseEnvironmentDictionary,
	writeEnvironmentDictionary,
	type ParsedEnvironmentDictionary,
} from '../../environmentDictionary';
import type { ResourceHandler } from '../handler';

export const environmentDictionaryHandler: ResourceHandler<ParsedEnvironmentDictionary> = {
	typeId: 0x10014,
	key: 'environmentDictionary',
	name: 'Environment Dictionary',
	description: 'Catalogue of environment-settings bundles — one entry per weather/time-of-day "season" naming its timeline resource, settings bundle, and colour-cube bundle, plus the location names its keyframes are authored for',
	category: 'Data',
	caps: { read: true, write: true },
	wikiUrl: 'https://burnout.wiki/wiki/Environment_Dictionary',

	parseRaw(raw, ctx) {
		return parseEnvironmentDictionary(raw, ctx.littleEndian);
	},
	writeRaw(model, ctx) {
		return writeEnvironmentDictionary(model, ctx.littleEndian);
	},
	describe(model) {
		const locations = model.locations.map((l) => l.macName).join(', ');
		return `seasons ${model.seasons.length}, locations ${model.locations.length}${locations ? ` (${locations})` : ''}`;
	},

	fixtures: [
		{ bundle: 'example/ENVIRONMENTSETTINGS/DICTIONARY.BUNDLE', expect: { parseOk: true, byteRoundTrip: true } },
	],

	stressScenarios: [
		{
			name: 'baseline',
			description: 'no mutation — exercises the writer on the read model unchanged',
			mutate: (m) => m,
			verify: (before, after) => {
				const problems: string[] = [];
				if (after.seasons.length !== before.seasons.length) {
					problems.push(`season count ${after.seasons.length} != ${before.seasons.length}`);
				}
				if (after.locations.length !== before.locations.length) {
					problems.push(`location count ${after.locations.length} != ${before.locations.length}`);
				}
				return problems;
			},
		},
		{
			name: 'rename-season-timeline',
			description: 'rename seasons[0].macResourceName and verify it survives with the bundle paths untouched',
			mutate: (m) => {
				const seasons = m.seasons.slice();
				seasons[0] = { ...seasons[0], macResourceName: 'ENV_TL_STRESS_RENAME' };
				return { ...m, seasons };
			},
			verify: (afterMutate, afterReparse) => {
				const problems: string[] = [];
				if (afterReparse.seasons[0].macResourceName !== 'ENV_TL_STRESS_RENAME') {
					problems.push(`macResourceName = "${afterReparse.seasons[0].macResourceName}", expected "ENV_TL_STRESS_RENAME"`);
				}
				if (afterReparse.seasons[0].macBundle !== afterMutate.seasons[0].macBundle) {
					problems.push(`macBundle changed to "${afterReparse.seasons[0].macBundle}"`);
				}
				if (afterReparse.seasons[0].macColourCubesBundle !== afterMutate.seasons[0].macColourCubesBundle) {
					problems.push(`macColourCubesBundle changed to "${afterReparse.seasons[0].macColourCubesBundle}"`);
				}
				return problems;
			},
		},
		{
			name: 'retarget-bundle-path',
			description: 'point seasons[0].macBundle at a different bundle path and verify the exact string survives',
			mutate: (m) => {
				const seasons = m.seasons.slice();
				seasons[0] = { ...seasons[0], macBundle: 'EnvironmentSettings\\stress_retarget.bundle' };
				return { ...m, seasons };
			},
			verify: (_afterMutate, afterReparse) => {
				const got = afterReparse.seasons[0].macBundle;
				return got === 'EnvironmentSettings\\stress_retarget.bundle'
					? []
					: [`macBundle = "${got}"`];
			},
		},
		{
			name: 'add-season',
			description: 'append a new season entry; verify the count, the new strings, and the shifted location array all survive',
			mutate: (m) => ({
				...m,
				seasons: [
					...m.seasons,
					{
						macResourceName: 'ENV_TL_STRESS_NEW',
						macBundle: 'EnvironmentSettings\\stress_new.bundle',
						macColourCubesBundle: 'EnvironmentSettings\\ColourCubes\\stress_new.bundle',
					},
				],
			}),
			verify: (afterMutate, afterReparse) => {
				const problems: string[] = [];
				if (afterReparse.seasons.length !== afterMutate.seasons.length) {
					problems.push(`season count ${afterReparse.seasons.length} != ${afterMutate.seasons.length}`);
				}
				const added = afterReparse.seasons[afterReparse.seasons.length - 1];
				if (added?.macResourceName !== 'ENV_TL_STRESS_NEW') {
					problems.push(`appended macResourceName = "${added?.macResourceName}"`);
				}
				// mpLocationDatii moves by 0x100 — the locations must still parse.
				if (afterReparse.locations.length !== afterMutate.locations.length) {
					problems.push(`location count ${afterReparse.locations.length} != ${afterMutate.locations.length}`);
				}
				if (afterReparse.locations[0]?.macName !== afterMutate.locations[0]?.macName) {
					problems.push(`location[0] = "${afterReparse.locations[0]?.macName}"`);
				}
				return problems;
			},
		},
		{
			name: 'add-location',
			description: 'append a new location name and verify both locations survive',
			mutate: (m) => ({ ...m, locations: [...m.locations, { macName: 'stress_location' }] }),
			verify: (afterMutate, afterReparse) => {
				const problems: string[] = [];
				if (afterReparse.locations.length !== afterMutate.locations.length) {
					problems.push(`location count ${afterReparse.locations.length} != ${afterMutate.locations.length}`);
				}
				const added = afterReparse.locations[afterReparse.locations.length - 1];
				if (added?.macName !== 'stress_location') {
					problems.push(`appended macName = "${added?.macName}"`);
				}
				return problems;
			},
		},
	],
};
