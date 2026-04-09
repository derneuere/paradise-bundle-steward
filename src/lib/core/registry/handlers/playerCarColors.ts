// PlayerCarColours registry handler (read-only, 32-bit PC only).

import {
	parsePlayerCarColoursData,
	type PlayerCarColours,
} from '../../playerCarColors';
import type { ResourceHandler } from '../handler';

export const playerCarColoursHandler: ResourceHandler<PlayerCarColours> = {
	typeId: 0x1001E,
	key: 'playerCarColours',
	name: 'Player Car Colours',
	description: 'Paint and pearl color palettes for player vehicles (Gloss, Metallic, Pearlescent, Special, Party)',
	category: 'Graphics',
	caps: { read: true, write: false },

	parseRaw(raw, _ctx) {
		return parsePlayerCarColoursData(raw);
	},
	describe(model) {
		return `${model.palettes.length} palettes, ${model.totalColors} total colors`;
	},
	fixtures: [
		// VEHICLELIST.BUNDLE contains both a VehicleList and a PlayerCarColours resource.
		{ bundle: 'example/VEHICLELIST.BUNDLE', expect: { parseOk: true } },
	],
};
