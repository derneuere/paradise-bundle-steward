// ICE List registry handler — thin wrapper around parseIceList / writeIceList
// in src/lib/core/iceList.ts.
//
// The low-level parser/writer live outside the registry so the registry never
// imports from src/lib/core/bundle/index.ts (which could create a cycle).
//
// No fixtures: the ICE List is an early-development type superseded by the ICE
// Take Dictionary (0x41), so there is no example bundle that ships one. The
// parser/writer are validated by synthetic round-trip tests in
// src/lib/core/__tests__/iceList.test.ts instead.

import {
	parseIceList,
	writeIceList,
	describeIceList,
	type ParsedIceList,
} from '../../iceList';
import type { ResourceHandler } from '../handler';

export const iceListHandler: ResourceHandler<ParsedIceList> = {
	typeId: 0x1000c,
	key: 'iceList',
	name: 'ICE List',
	description: 'Early-development list of camera-movie IDs; superseded by the ICE Take Dictionary',
	category: 'Camera',
	caps: { read: true, write: true },
	wikiUrl: 'https://burnout.wiki/wiki/ICE_List',

	parseRaw(raw, ctx) {
		return parseIceList(raw, ctx.littleEndian);
	},
	writeRaw(model, ctx) {
		return writeIceList(model, ctx.littleEndian);
	},
	describe(model) {
		return describeIceList(model);
	},

	fixtures: [],
};
