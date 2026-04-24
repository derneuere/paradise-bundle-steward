// ChallengeList registry handler.

import {
	parseChallengeListData,
	writeChallengeListData,
	type ParsedChallengeList,
} from '../../challengeList';
import type { ResourceHandler } from '../handler';

export const challengeListHandler: ResourceHandler<ParsedChallengeList> = {
	typeId: 0x1001F,
	key: 'challengeList',
	name: 'Challenge List',
	description: 'Freeburn challenges with their actions, locations, and rewards',
	category: 'Data',
	caps: { read: true, write: true },

	parseRaw(raw, ctx) {
		return parseChallengeListData(raw, ctx.littleEndian);
	},
	writeRaw(model, ctx) {
		return writeChallengeListData(model, ctx.littleEndian);
	},
	describe(model) {
		return `numChallenges ${model.numChallenges}, entries ${model.challenges.length}`;
	},
	fixtures: [
		{ bundle: 'example/ONLINECHALLENGES.BNDL', expect: { parseOk: true, byteRoundTrip: true, stableWriter: true } },
	],

	// Generic structural mutations on `challenges` don't update `numChallenges`,
	// which the writer rejects. This is the intentional invariant guard — fuzz
	// should count these as expected rejections, not crashes.
	fuzz: {
		tolerateErrors: [/numChallenges.*must equal challenges\.length/i],
	},

	stressScenarios: [
		{
			name: 'baseline',
			description: 'no mutation — exercises the writer on the read model unchanged',
			mutate: (m) => m,
		},
		{
			name: 'remove-last-challenge',
			description: 'pop challenges[-1] and decrement numChallenges to keep the invariant',
			mutate: (m) => ({
				...m,
				challenges: m.challenges.slice(0, -1),
				numChallenges: Math.max(0, m.numChallenges - 1),
			}),
			verify: (before, after) => {
				const problems: string[] = [];
				if (after.challenges.length !== before.challenges.length) {
					problems.push(`challenge count ${after.challenges.length} != ${before.challenges.length}`);
				}
				if (after.numChallenges !== after.challenges.length) {
					problems.push(`numChallenges ${after.numChallenges} != challenges.length ${after.challenges.length}`);
				}
				return problems;
			},
		},
		{
			name: 'edit-first-challenge-title',
			description: 'set challenges[0].titleStringID to a marker and verify it survives',
			mutate: (m) => {
				if (m.challenges.length === 0) return m;
				const challenges = m.challenges.slice();
				challenges[0] = { ...challenges[0], titleStringID: 'FBCT_STRESSED' };
				return { ...m, challenges };
			},
			verify: (_before, after) => {
				const problems: string[] = [];
				if (after.challenges.length > 0) {
					// Reader strips trailing NULs via TextDecoder; startsWith is the safest comparison.
					const title = after.challenges[0].titleStringID.replace(/\0.*$/, '');
					if (title !== 'FBCT_STRESSED') {
						problems.push(`challenges[0].titleStringID = "${title}"`);
					}
				}
				return problems;
			},
		},
		{
			name: 'zero-first-challenge-difficulty',
			description: 'set challenges[0].difficulty to 0 (EASY)',
			mutate: (m) => {
				if (m.challenges.length === 0) return m;
				const challenges = m.challenges.slice();
				challenges[0] = { ...challenges[0], difficulty: 0 };
				return { ...m, challenges };
			},
			verify: (_before, after) => {
				const problems: string[] = [];
				if (after.challenges.length > 0 && after.challenges[0].difficulty !== 0) {
					problems.push(`challenges[0].difficulty = ${after.challenges[0].difficulty}`);
				}
				return problems;
			},
		},
		{
			name: 'zero-first-action-time-limit',
			description: 'set challenges[0].actions[0].timeLimit to 0 (un-timed)',
			mutate: (m) => {
				if (m.challenges.length === 0 || m.challenges[0].actions.length === 0) return m;
				const challenges = m.challenges.slice();
				const actions = challenges[0].actions.slice();
				actions[0] = { ...actions[0], timeLimit: 0 };
				challenges[0] = { ...challenges[0], actions };
				return { ...m, challenges };
			},
			verify: (_before, after) => {
				const problems: string[] = [];
				if (
					after.challenges.length > 0 &&
					after.challenges[0].actions.length > 0 &&
					after.challenges[0].actions[0].timeLimit !== 0
				) {
					problems.push(`actions[0].timeLimit = ${after.challenges[0].actions[0].timeLimit}`);
				}
				return problems;
			},
		},
		{
			name: 'duplicate-last-challenge',
			description: 'clone challenges[-1], append, and bump numChallenges',
			mutate: (m) => {
				if (m.challenges.length === 0) return m;
				const last = m.challenges[m.challenges.length - 1];
				// Deep clone the nested action/locationData structure so mutations
				// to the copy don't alias the original.
				const clone = JSON.parse(JSON.stringify(last, (_k, v) =>
					typeof v === 'bigint' ? { __bigint: v.toString() } : v,
				), (_k, v) =>
					v && typeof v === 'object' && '__bigint' in v
						? BigInt((v as { __bigint: string }).__bigint)
						: v,
				);
				return {
					...m,
					challenges: [...m.challenges, clone],
					numChallenges: m.numChallenges + 1,
				};
			},
			verify: (before, after) => {
				const problems: string[] = [];
				if (after.challenges.length !== before.challenges.length) {
					problems.push(`challenge count ${after.challenges.length} != ${before.challenges.length}`);
				}
				if (after.numChallenges !== after.challenges.length) {
					problems.push(`numChallenges ${after.numChallenges} != challenges.length ${after.challenges.length}`);
				}
				return problems;
			},
		},
	],
};
