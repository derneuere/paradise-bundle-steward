// ICE Take Dictionary registry handler (read-only, partial — spec incomplete).
//
// The existing parser uses a heuristic scan that tries both endiannesses and
// both pointer widths and picks whichever finds the most valid-looking takes.
// We pass raw bytes through unchanged; per the refactor's "32-bit PC only"
// constraint the parser will be narrowed separately if/when the wiki spec
// catches up.

import {
	parseIceTakeDictionaryData,
	type ParsedIceTakeDictionary,
} from '../../iceTakeDictionary';
import type { ResourceHandler } from '../handler';

export const iceTakeDictionaryHandler: ResourceHandler<ParsedIceTakeDictionary> = {
	typeId: 0x41,
	key: 'iceTakeDictionary',
	featureId: 'icetake-dictionary',
	name: 'ICE Dictionary',
	description: 'In-game Camera Editor take dictionary (camera cuts for race starts, Picture Paradise, Super Jumps)',
	category: 'Camera',
	caps: { read: true, write: false },
	notes: 'Partial support: can view some of the data, but not save changes. Blocked: specification missing from Burnout Wiki.',
	wikiUrl: 'https://burnout.wiki/wiki/ICE_Take_Dictionary',
	// caps.read is `true` (the heuristic parser does return data), but the
	// spec is incomplete so the UI flags this as a `'partial'` read with a
	// matching `'partial'` editor signal.
	capabilityOverrides: {
		read: 'partial',
		editor: 'partial',
	},

	parseRaw(raw, _ctx) {
		return parseIceTakeDictionaryData(raw);
	},
	describe(model) {
		return `takes ${model.totalTakes}`;
	},
	fixtures: [
		{ bundle: 'example/CAMERAS.BUNDLE', expect: { parseOk: true } },
	],
};
