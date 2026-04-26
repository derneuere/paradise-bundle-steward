// ZoneList registry handler — wraps parseZoneListData / writeZoneListData.

import {
	parseZoneListData,
	writeZoneListData,
	type ParsedZoneList,
} from '../../zoneList';
import { HANDLER_PLATFORM, type ResourceHandler } from '../handler';

export const zoneListHandler: ResourceHandler<ParsedZoneList> = {
	typeId: 0xB000,
	key: 'zoneList',
	name: 'Zone List',
	description: 'PVS streaming zones — polygonal cells with safe/unsafe neighbour lists for track-unit loading',
	category: 'Map',
	// PC + X360 are both fixture-validated (retail PC PVS.BNDL byte-exact;
	// Nov 13 2006 X360 PVS.BNDL byte-exact through the BND1 wrapper).
	caps: { read: true, write: true, writePlatforms: [HANDLER_PLATFORM.PC, HANDLER_PLATFORM.XBOX360] },

	parseRaw(raw, ctx) {
		return parseZoneListData(raw, ctx.littleEndian);
	},
	writeRaw(model, ctx) {
		return writeZoneListData(model, ctx.littleEndian);
	},
	describe(model) {
		let pts = 0, safe = 0, unsafe = 0;
		for (const z of model.zones) {
			pts += z.points.length;
			safe += z.safeNeighbours.length;
			unsafe += z.unsafeNeighbours.length;
		}
		return `zones ${model.zones.length}, points ${pts}, safe-nbr ${safe}, unsafe-nbr ${unsafe}`;
	},

	fixtures: [
		{ bundle: 'example/PVS.BNDL', expect: { parseOk: true, byteRoundTrip: true } },
		// Nov 13 2006 / Feb 22 2007 prototype builds: same ZoneList payload
		// layout as retail (byte-identical with endianness flipped to BE),
		// wrapped in the older Bundle V1 ('bndl') container instead of BND2.
		{ bundle: 'example/older builds/PVS.BNDL', expect: { parseOk: true, byteRoundTrip: true } },
	],
};
