// StreetData registry handler — thin wrapper around parseStreetDataData /
// writeStreetDataData in src/lib/core/streetData.ts.
//
// The low-level parser/writer live outside the registry so the registry never
// imports from src/lib/core/bundle/index.ts (which could create a cycle).

import {
	parseStreetDataData,
	writeStreetDataData,
	type ParsedStreetData,
} from '../../streetData';
import type { ResourceHandler } from '../handler';

export const streetDataHandler: ResourceHandler<ParsedStreetData> = {
	typeId: 0x10018,
	key: 'streetData',
	name: 'Street Data',
	description: 'Streets, junctions, roads, and per-challenge par scores used by the road network',
	category: 'Data',
	caps: { read: true, write: true },

	parseRaw(raw, _ctx) {
		return parseStreetDataData(raw);
	},
	writeRaw(model, _ctx) {
		return writeStreetDataData(model);
	},
	describe(model) {
		return `version ${model.miVersion}, streets ${model.streets.length}, junctions ${model.junctions.length}, roads ${model.roads.length}, challenges ${model.challenges.length}`;
	},

	fixtures: [
		// byteRoundTrip cannot hold here: the writer intentionally drops the
		// spans/exits tail and shrinks the resource from 29584 to 26992 bytes.
		// stableWriter catches regressions by asserting the writer is idempotent
		// after the first lossy pass. The byte-exact sha1 pin against the
		// original fixture lives in streetData.test.ts.
		{ bundle: 'example/BTTSTREETDATA.DAT', expect: { parseOk: true, stableWriter: true } },
	],

	stressScenarios: [
		{
			name: 'baseline',
			description: 'no mutation — exercises the writer on the read model unchanged',
			mutate: (m) => m,
		},
		{
			name: 'remove-last-street',
			description: 'pop the last street (streets have no sub-arrays so counts stay consistent)',
			mutate: (m) => {
				const next = { ...m, streets: m.streets.slice(0, -1) };
				return next;
			},
			verify: (before, after) => {
				const problems: string[] = [];
				if (after.streets.length !== before.streets.length) {
					problems.push(`street count ${after.streets.length} != ${before.streets.length}`);
				}
				return problems;
			},
		},
		{
			name: 'remove-last-road-and-challenge',
			description: 'pop matching last road + challenge (writer enforces roads.length == challenges.length)',
			mutate: (m) => ({
				...m,
				roads: m.roads.slice(0, -1),
				challenges: m.challenges.slice(0, -1),
			}),
			verify: (before, after) => {
				const problems: string[] = [];
				if (after.roads.length !== before.roads.length) {
					problems.push(`road count ${after.roads.length} != ${before.roads.length}`);
				}
				if (after.challenges.length !== before.challenges.length) {
					problems.push(`challenge count ${after.challenges.length} != ${before.challenges.length}`);
				}
				return problems;
			},
		},
		{
			name: 'edit-road-debug-name',
			description: 'rename roads[0].macDebugName to a known marker and verify it survives round-trip',
			mutate: (m) => {
				const roads = m.roads.slice();
				roads[0] = { ...roads[0], macDebugName: 'STRESSED_A' };
				return { ...m, roads };
			},
			verify: (_before, after) => {
				const problems: string[] = [];
				if (after.roads[0].macDebugName !== 'STRESSED_A') {
					problems.push(`roads[0].macDebugName is "${after.roads[0].macDebugName}"`);
				}
				return problems;
			},
		},
		{
			name: 'zero-all-challenge-scores',
			description: 'set every challenge par score to [0, 0]',
			mutate: (m) => ({
				...m,
				challenges: m.challenges.map((c) => ({
					...c,
					challengeData: {
						...c.challengeData,
						mScoreList: { maScores: [0, 0] },
					},
				})),
			}),
			verify: (_before, after) => {
				const problems: string[] = [];
				for (let i = 0; i < after.challenges.length; i++) {
					const s = after.challenges[i].challengeData.mScoreList.maScores;
					if (s[0] !== 0 || s[1] !== 0) {
						problems.push(`challenges[${i}].maScores = [${s[0]}, ${s[1]}]`);
						break;
					}
				}
				return problems;
			},
		},
	],
};
