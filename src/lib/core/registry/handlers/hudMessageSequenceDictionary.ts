// HudMessageSequenceDictionary registry handler — thin wrapper around
// parseHudMessageSequenceDictionary / writeHudMessageSequenceDictionary in
// src/lib/core/hudMessageSequences.ts.
//
// One resource in the whole game (HUDMESSAGESEQUENCES.HMSC): the name list
// the game uses to enumerate the bundle's HudMessageSequence (0x2E)
// resources. Entries reference sequences BY NAME — each char[13] entry is
// the macSequenceId of one 0x2E resource, so renaming a sequence without
// updating its dictionary entry orphans it.

import {
	parseHudMessageSequenceDictionary,
	writeHudMessageSequenceDictionary,
	type ParsedHudMessageSequenceDictionary,
} from '../../hudMessageSequences';
import type { ResourceHandler } from '../handler';

export const hudMessageSequenceDictionaryHandler: ResourceHandler<ParsedHudMessageSequenceDictionary> = {
	typeId: 0x2f,
	key: 'hudMessageSequenceDictionary',
	name: 'HUD Message Sequence Dictionary',
	description: 'Name list enumerating every HUD Message Sequence in the bundle — entries are the sequences\' macSequenceId strings, referenced by name',
	category: 'Data',
	caps: { read: true, write: true },
	wikiUrl: 'https://burnout.wiki/wiki/HUD_Message_Sequence_Dictionary',
	notes: 'Same on-disk shape as the HUD Message List (0x30) per the wiki. The single retail resource lists the six DT* Dirty Tricks sequences.',

	parseRaw(raw, ctx) {
		return parseHudMessageSequenceDictionary(raw, ctx.littleEndian);
	},
	writeRaw(model, ctx) {
		return writeHudMessageSequenceDictionary(model, ctx.littleEndian);
	},
	describe(model) {
		return `${model.sequenceNames.length} sequence name${model.sequenceNames.length === 1 ? '' : 's'}: ${model.sequenceNames.join(', ')}`;
	},

	fixtures: [
		{ bundle: 'example/HUDMESSAGESEQUENCES.HMSC', expect: { parseOk: true, byteRoundTrip: true } },
	],

	stressScenarios: [
		{
			name: 'baseline',
			description: 'no mutation — exercises the writer on the read model unchanged',
			mutate: (m) => m,
			verify: (before, after) => {
				const problems: string[] = [];
				if (after.sequenceNames.length !== before.sequenceNames.length) {
					problems.push(`name count ${after.sequenceNames.length} != ${before.sequenceNames.length}`);
				}
				return problems;
			},
		},
		{
			name: 'rename-entry',
			description: 'rename the first entry and verify it survives round-trip with its siblings untouched',
			mutate: (m) => {
				const sequenceNames = m.sequenceNames.slice();
				sequenceNames[0] = 'StressSeq';
				return { ...m, sequenceNames };
			},
			verify: (afterMutate, afterReparse) => {
				const problems: string[] = [];
				if (afterReparse.sequenceNames[0] !== 'StressSeq') {
					problems.push(`sequenceNames[0] "${afterReparse.sequenceNames[0]}", expected "StressSeq"`);
				}
				if (afterReparse.sequenceNames.length !== afterMutate.sequenceNames.length) {
					problems.push(`name count ${afterReparse.sequenceNames.length} != ${afterMutate.sequenceNames.length}`);
				}
				return problems;
			},
		},
		{
			name: 'append-name',
			description: 'append an entry — size, count, every name pointer, and the alignment pad are all re-derived',
			mutate: (m) => ({ ...m, sequenceNames: [...m.sequenceNames, 'StressSeqNew'] }),
			verify: (afterMutate, afterReparse) => {
				const problems: string[] = [];
				if (afterReparse.sequenceNames.length !== afterMutate.sequenceNames.length) {
					problems.push(`name count ${afterReparse.sequenceNames.length} != ${afterMutate.sequenceNames.length}`);
				}
				if (afterReparse.sequenceNames[afterReparse.sequenceNames.length - 1] !== 'StressSeqNew') {
					problems.push('appended name did not survive round-trip');
				}
				return problems;
			},
		},
		{
			name: 'remove-last-name',
			description: 'drop the final entry — the shrunken pointer array and name pool must reparse cleanly',
			mutate: (m) => ({ ...m, sequenceNames: m.sequenceNames.slice(0, -1) }),
			verify: (afterMutate, afterReparse) => {
				const problems: string[] = [];
				if (afterReparse.sequenceNames.length !== afterMutate.sequenceNames.length) {
					problems.push(`name count ${afterReparse.sequenceNames.length} != ${afterMutate.sequenceNames.length}`);
				}
				return problems;
			},
		},
	],
};
