// ICE Data registry handler — thin wrapper around parseIceData / writeIceData
// in src/lib/core/iceData.ts.
//
// ICE Data is one standalone camera take (the same ICETakeData the ICE Take
// Dictionary wraps many of). It is an early-development type superseded by the
// dictionary (0x41), so there is no example bundle that ships one; the
// parser/writer are validated by round-trip tests built from a CAMERAS.BUNDLE
// take in src/lib/core/__tests__/iceData.test.ts instead.

import {
	parseIceData,
	writeIceData,
	describeIceData,
	type ParsedIceData,
} from '../../iceData';
import type { ResourceHandler } from '../handler';

export const iceDataHandler: ResourceHandler<ParsedIceData> = {
	typeId: 0x1000d,
	key: 'iceData',
	name: 'ICE Data',
	description: 'Early-development standalone camera take; superseded by the ICE Take Dictionary',
	category: 'Camera',
	caps: { read: true, write: true },
	wikiUrl: 'https://burnout.wiki/wiki/ICE_Data',

	parseRaw(raw, ctx) {
		return parseIceData(raw, ctx.littleEndian);
	},
	writeRaw(model, ctx) {
		return writeIceData(model, ctx.littleEndian);
	},
	describe(model) {
		return describeIceData(model);
	},

	fixtures: [],
};
