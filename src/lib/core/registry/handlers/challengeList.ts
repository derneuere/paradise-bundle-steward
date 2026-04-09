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
		{ bundle: 'example/ONLINECHALLENGES.BNDL', expect: { parseOk: true, stableWriter: true } },
	],
};
