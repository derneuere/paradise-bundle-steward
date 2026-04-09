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

	// Killzones and signatureStunts reference GenericRegion entries by id
	// (triggerIds / stuntElementRegionIds). Fuzz mutations that pop or clear
	// genericRegions without updating the referrers trip the writer's
	// "Missing GenericRegion offset for id X" guard — this is expected.
	fuzz: {
		tolerateErrors: [/Missing GenericRegion offset for id/],
	},

	stressScenarios: [
		{
			name: 'baseline',
			description: 'no mutation — exercises the writer on the read model unchanged',
			mutate: (m) => m,
		},
		{
			name: 'remove-last-landmark',
			description: 'pop landmarks[-1] (onlineLandmarkCount is independent, left unchanged)',
			mutate: (m) => ({ ...m, landmarks: m.landmarks.slice(0, -1) }),
			verify: (before, after) => {
				const problems: string[] = [];
				if (after.landmarks.length !== before.landmarks.length) {
					problems.push(`landmark count ${after.landmarks.length} != ${before.landmarks.length}`);
				}
				return problems;
			},
		},
		{
			name: 'remove-last-generic-region',
			description: 'pop genericRegions[-1]',
			mutate: (m) => ({ ...m, genericRegions: m.genericRegions.slice(0, -1) }),
			verify: (before, after) => {
				const problems: string[] = [];
				if (after.genericRegions.length !== before.genericRegions.length) {
					problems.push(`genericRegion count ${after.genericRegions.length} != ${before.genericRegions.length}`);
				}
				return problems;
			},
		},
		{
			name: 'remove-last-blackspot',
			description: 'pop blackspots[-1]',
			mutate: (m) => ({ ...m, blackspots: m.blackspots.slice(0, -1) }),
			verify: (before, after) => {
				const problems: string[] = [];
				if (after.blackspots.length !== before.blackspots.length) {
					problems.push(`blackspot count ${after.blackspots.length} != ${before.blackspots.length}`);
				}
				return problems;
			},
		},
		{
			name: 'remove-last-spawn-location',
			description: 'pop spawnLocations[-1]',
			mutate: (m) => ({ ...m, spawnLocations: m.spawnLocations.slice(0, -1) }),
			verify: (before, after) => {
				const problems: string[] = [];
				if (after.spawnLocations.length !== before.spawnLocations.length) {
					problems.push(`spawnLocation count ${after.spawnLocations.length} != ${before.spawnLocations.length}`);
				}
				return problems;
			},
		},
		{
			name: 'edit-first-landmark-id',
			description: 'set landmarks[0].id to a marker and verify it survives round-trip',
			mutate: (m) => {
				if (m.landmarks.length === 0) return m;
				const landmarks = m.landmarks.slice();
				landmarks[0] = { ...landmarks[0], id: 0x13371337 };
				return { ...m, landmarks };
			},
			verify: (_before, after) => {
				const problems: string[] = [];
				if (after.landmarks.length > 0 && after.landmarks[0].id !== 0x13371337) {
					problems.push(`landmarks[0].id is 0x${after.landmarks[0].id.toString(16)}`);
				}
				return problems;
			},
		},
		{
			name: 'zero-first-spawn-position',
			description: 'zero spawnLocations[0].position and verify it survives',
			mutate: (m) => {
				if (m.spawnLocations.length === 0) return m;
				const spawnLocations = m.spawnLocations.slice();
				spawnLocations[0] = {
					...spawnLocations[0],
					position: { x: 0, y: 0, z: 0, w: 0 },
				};
				return { ...m, spawnLocations };
			},
			verify: (_before, after) => {
				const problems: string[] = [];
				if (after.spawnLocations.length > 0) {
					const p = after.spawnLocations[0].position;
					if (p.x !== 0 || p.y !== 0 || p.z !== 0 || p.w !== 0) {
						problems.push(`spawnLocations[0].position = [${p.x}, ${p.y}, ${p.z}, ${p.w}]`);
					}
				}
				return problems;
			},
		},
		{
			name: 'bulk-pop-every-array',
			description: 'pop the last entry from every non-empty top-level array at once',
			mutate: (m) => ({
				...m,
				landmarks: m.landmarks.length > 0 ? m.landmarks.slice(0, -1) : m.landmarks,
				signatureStunts: m.signatureStunts.length > 0 ? m.signatureStunts.slice(0, -1) : m.signatureStunts,
				genericRegions: m.genericRegions.length > 0 ? m.genericRegions.slice(0, -1) : m.genericRegions,
				killzones: m.killzones.length > 0 ? m.killzones.slice(0, -1) : m.killzones,
				blackspots: m.blackspots.length > 0 ? m.blackspots.slice(0, -1) : m.blackspots,
				vfxBoxRegions: m.vfxBoxRegions.length > 0 ? m.vfxBoxRegions.slice(0, -1) : m.vfxBoxRegions,
				roamingLocations: m.roamingLocations.length > 0 ? m.roamingLocations.slice(0, -1) : m.roamingLocations,
				spawnLocations: m.spawnLocations.length > 0 ? m.spawnLocations.slice(0, -1) : m.spawnLocations,
			}),
		},
	],
};
