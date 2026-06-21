// ICE Take Dictionary registry handler.
//
// Structured, byte-exact parser + writer. The payload is a CgsContainers
// dictionary: a DictionaryBase header, a DictEntry table at mpaIndex, then the
// ICETakeData payloads packed contiguously after it. mpData/mpaIndex are plain
// payload file offsets (no BND2 inline import table), so no importTable() hook
// is needed — the writer recomputes the offsets from the layout.
//
// The take variable-data codec preserves each value's raw packed bits, so an
// unedited dictionary round-trips bit-for-bit; see src/lib/core/iceVariableData.ts.

import {
	parseIceTakeDictionaryStructured,
	writeIceTakeDictionary,
	describeIceTakeDictionary,
	isStructuredDictionary,
	type IceTakeDictionaryModel,
} from '../../iceTakeDictionary';
import { BundleError } from '../../errors';
import type { ResourceHandler } from '../handler';

export const iceTakeDictionaryHandler: ResourceHandler<IceTakeDictionaryModel> = {
	typeId: 0x41,
	key: 'iceTakeDictionary',
	featureId: 'icetake-dictionary',
	name: 'ICE Dictionary',
	description: 'In-game Camera Editor take dictionary (camera cuts for race starts, Picture Paradise, Super Jumps)',
	category: 'Camera',
	caps: { read: true, write: true },
	wikiUrl: 'https://burnout.wiki/wiki/ICE_Take_Dictionary',
	notes: 'Each take is a fixed header plus a bit-packed keyframe stream decoded with the ICE element-descriptions table. Values keep their raw packed bits so unedited takes round-trip byte-exact.',

	parseRaw(raw, ctx) {
		return parseIceTakeDictionaryStructured(raw, ctx.littleEndian);
	},
	writeRaw(model, ctx) {
		if (!isStructuredDictionary(model)) {
			throw new BundleError(
				'ICE dictionary writer requires a structured parse (heuristic fallback is read-only)',
				'ICE_WRITE_UNSUPPORTED',
			);
		}
		return writeIceTakeDictionary(model, ctx.littleEndian);
	},
	describe(model) {
		return describeIceTakeDictionary(model);
	},
	fixtures: [
		{ bundle: 'example/CAMERAS.BUNDLE', expect: { parseOk: true, byteRoundTrip: true, stableWriter: true } },
	],
};
