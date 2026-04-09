// TriggerData registry handler.

import {
	parseTriggerDataData,
	writeTriggerDataData,
	type ParsedTriggerData,
} from '../../triggerData';
import type { ResourceHandler } from '../handler';

export const triggerDataHandler: ResourceHandler<ParsedTriggerData> = {
	typeId: 0x10003,
	key: 'triggerData',
	name: 'Trigger Data',
	description: 'Landmarks, generic regions, blackspots, VFX regions, spawn and roaming locations',
	category: 'Data',
	caps: { read: true, write: true },

	parseRaw(raw, ctx) {
		return parseTriggerDataData(raw, ctx.littleEndian);
	},
	writeRaw(model, ctx) {
		return writeTriggerDataData(model, ctx.littleEndian);
	},
	describe(model) {
		return `v${model.version}, landmarks ${model.landmarks.length}, genericRegions ${model.genericRegions.length}, blackspots ${model.blackspots.length}, vfxBox ${model.vfxBoxRegions.length}, killzones ${model.killzones.length}, stunts ${model.signatureStunts.length}, roaming ${model.roamingLocations.length}, spawns ${model.spawnLocations.length}`;
	},
	fixtures: [
		// TRIGGERS.DAT is a bundle with a single TriggerData resource.
		{ bundle: 'example/TRIGGERS.DAT', expect: { parseOk: true, stableWriter: true } },
	],
};
