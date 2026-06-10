// Language registry handler — thin wrapper around parseLanguage /
// writeLanguage in src/lib/core/language.ts.
//
// Each of the 14 LANGUAGE/<NNNN>.BUNDLE files carries exactly one Language
// resource, so no picker is needed. The fixtures below are three
// representative bundles (retail UK, Japanese for heavy multibyte, the
// Russian-content bundle with the most pad entries); the gold test in
// __tests__/language.test.ts sweeps all 14.

import {
	parseLanguage,
	writeLanguage,
	languageName,
	type ParsedLanguage,
} from '../../language';
import type { ResourceHandler } from '../handler';

// Hash with no retail collision risk for the add-entry scenario (retail hashes
// are unique per bundle and 0 is reserved for the filler entry).
const STRESS_NEW_HASH = 0xdeadbeef;
const STRESS_TEXT = 'Edited ünïcøde string ✓';

export const languageHandler: ResourceHandler<ParsedLanguage> = {
	typeId: 0x27,
	key: 'language',
	name: 'Language',
	description: 'Localised game strings for one language — UTF-8 translations keyed by a u32 hash of the untranslated string ID; the same hash resolves in every language bundle',
	category: 'Data',
	caps: { read: true, write: true },
	wikiUrl: 'https://burnout.wiki/wiki/Language',

	parseRaw(raw, ctx) {
		return parseLanguage(raw, ctx.littleEndian);
	},
	writeRaw(model, ctx) {
		return writeLanguage(model, ctx.littleEndian);
	},
	describe(model) {
		return `${languageName(model.meLanguageID)} · ${model.entries.length} strings`;
	},

	fixtures: [
		{ bundle: 'example/LANGUAGE/0002.BUNDLE', expect: { parseOk: true, byteRoundTrip: true } },
		{ bundle: 'example/LANGUAGE/0007.BUNDLE', expect: { parseOk: true, byteRoundTrip: true } },
		{ bundle: 'example/LANGUAGE/0008.BUNDLE', expect: { parseOk: true, byteRoundTrip: true } },
	],

	stressScenarios: [
		{
			name: 'baseline',
			description: 'no mutation — exercises the writer on the read model unchanged',
			mutate: (m) => m,
			verify: (before, after) => {
				const problems: string[] = [];
				if (after.entries.length !== before.entries.length) {
					problems.push(`entry count ${after.entries.length} != ${before.entries.length}`);
				}
				if (after.meLanguageID !== before.meLanguageID) {
					problems.push(`meLanguageID ${after.meLanguageID} != ${before.meLanguageID}`);
				}
				return problems;
			},
		},
		{
			name: 'edit-string',
			description: 'replace entries[0].text with a longer multibyte string — every later offset must shift correctly',
			mutate: (m) => {
				const entries = m.entries.slice();
				entries[0] = { ...entries[0], text: STRESS_TEXT };
				return { ...m, entries };
			},
			verify: (afterMutate, afterReparse) => {
				const problems: string[] = [];
				if (afterReparse.entries[0].text !== STRESS_TEXT) {
					problems.push(`entries[0].text = ${JSON.stringify(afterReparse.entries[0].text)}, expected ${JSON.stringify(STRESS_TEXT)}`);
				}
				// The neighbour right after the grown string is the first one whose
				// offset moved — it must survive untouched.
				if (afterReparse.entries[1].text !== afterMutate.entries[1].text) {
					problems.push(`entries[1].text changed to ${JSON.stringify(afterReparse.entries[1].text)}`);
				}
				return problems;
			},
		},
		{
			name: 'change-hash',
			description: 'rekey entries[1] to a new hash and verify it survives alongside untouched text',
			mutate: (m) => {
				const entries = m.entries.slice();
				entries[1] = { ...entries[1], muHash: STRESS_NEW_HASH };
				return { ...m, entries };
			},
			verify: (afterMutate, afterReparse) => {
				const problems: string[] = [];
				if (afterReparse.entries[1].muHash !== STRESS_NEW_HASH) {
					problems.push(`entries[1].muHash = 0x${afterReparse.entries[1].muHash.toString(16)}, expected 0x${STRESS_NEW_HASH.toString(16)}`);
				}
				if (afterReparse.entries[1].text !== afterMutate.entries[1].text) {
					problems.push(`entries[1].text changed to ${JSON.stringify(afterReparse.entries[1].text)}`);
				}
				return problems;
			},
		},
		{
			name: 'add-entry',
			description: 'insert a new string before the trailing filler entry and verify count + content survive',
			mutate: (m) => {
				const entries = m.entries.slice();
				entries.splice(entries.length - 1, 0, { muHash: STRESS_NEW_HASH, text: STRESS_TEXT, _padAfter: 0 });
				return { ...m, entries };
			},
			verify: (afterMutate, afterReparse) => {
				const problems: string[] = [];
				if (afterReparse.entries.length !== afterMutate.entries.length) {
					problems.push(`entry count ${afterReparse.entries.length} != ${afterMutate.entries.length}`);
				}
				const added = afterReparse.entries[afterReparse.entries.length - 2];
				if (added.muHash !== STRESS_NEW_HASH || added.text !== STRESS_TEXT) {
					problems.push(`inserted entry came back as hash 0x${added.muHash.toString(16)} text ${JSON.stringify(added.text)}`);
				}
				return problems;
			},
		},
		{
			name: 'remove-entry',
			description: 'drop entries[2] and verify the count shrinks and both neighbours survive',
			mutate: (m) => {
				const entries = m.entries.slice();
				entries.splice(2, 1);
				return { ...m, entries };
			},
			verify: (afterMutate, afterReparse) => {
				const problems: string[] = [];
				if (afterReparse.entries.length !== afterMutate.entries.length) {
					problems.push(`entry count ${afterReparse.entries.length} != ${afterMutate.entries.length}`);
				}
				for (const i of [1, 2]) {
					if (afterReparse.entries[i].muHash !== afterMutate.entries[i].muHash
						|| afterReparse.entries[i].text !== afterMutate.entries[i].text) {
						problems.push(`entries[${i}] changed after removal`);
					}
				}
				return problems;
			},
		},
	],
};
