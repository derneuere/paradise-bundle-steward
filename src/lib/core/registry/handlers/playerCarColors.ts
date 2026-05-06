// PlayerCarColours registry handler (32-bit PC only).

import {
	parsePlayerCarColoursData,
	writePlayerCarColoursData,
	type PlayerCarColours,
} from '../../playerCarColors';
import type { ResourceHandler } from '../handler';

export const playerCarColoursHandler: ResourceHandler<PlayerCarColours> = {
	typeId: 0x1001E,
	key: 'playerCarColours',
	featureId: 'player-car-colours',
	name: 'Player Car Colours',
	description: 'Paint and pearl color palettes for player vehicles (Gloss, Metallic, Pearlescent, Special, Party)',
	category: 'Graphics',
	caps: { read: true, write: true },
	// Writer normalizes retail palette gaps / aliased pointers between palettes
	// and reconciles `numColours` against realized array lengths (the neon-colour
	// exploit), so the first write is intentionally lossy and only subsequent
	// writes are byte-stable — see fixture `expect: { stableWriter: true }`.
	notes: 'Full read/write support. Writer normalizes retail palette gaps / aliased pointers and is idempotent after the first pass.',
	wikiUrl: 'https://burnout.wiki/wiki/Player_Car_Colours',

	parseRaw(raw, _ctx) {
		return parsePlayerCarColoursData(raw);
	},
	writeRaw(model, _ctx) {
		return writePlayerCarColoursData(model);
	},
	describe(model) {
		return `${model.palettes.length} palettes, ${model.totalColors} total colors`;
	},
	fixtures: [
		// VEHICLELIST.BUNDLE contains both a VehicleList and a PlayerCarColours resource.
		// stableWriter (not byteRoundTrip): retail files may have palette-data gaps,
		// aliased pointers between palettes, or numColours values that don't match
		// the realized array length (neon-colour exploit). The writer normalizes to
		// a dense layout; idempotence after the first write is the realistic bar.
		{ bundle: 'example/VEHICLELIST.BUNDLE', expect: { parseOk: true, stableWriter: true } },
	],

	// The format has exactly 5 palettes (Gloss, Metallic, Pearlescent, Special,
	// Party). Generic array fuzzing will happily push/pop palettes, which the
	// writer rejects. Also catches palette-level numColours drift after entry
	// mutations (paintColours.length / pearlColours.length vs numColours).
	fuzz: {
		tolerateErrors: [
			/expected exactly 5 palettes/,
			/paintColours\.length.*!= numColours/,
			/pearlColours\.length.*!= numColours/,
		],
	},
};
