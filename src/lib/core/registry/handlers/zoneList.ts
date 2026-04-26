// ZoneList registry handler — wraps parseZoneListData / writeZoneListData.

import {
	parseZoneListData,
	writeZoneListData,
	type ParsedZoneList,
} from '../../zoneList';
import type { ResourceHandler } from '../handler';

export const zoneListHandler: ResourceHandler<ParsedZoneList> = {
	typeId: 0xB000,
	key: 'zoneList',
	name: 'Zone List',
	description: 'PVS streaming zones — polygonal cells with safe/unsafe neighbour lists for track-unit loading',
	category: 'Map',
	caps: { read: true, write: true },

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
	],
};
