// Nicotine registry handler — thin wrapper around parseNicotine /
// writeNicotine in src/lib/core/nicotine.ts.
//
// Retail ships exactly two Nicotine maps, one resource per bundle:
// NicotineAssetMain (stereo) and NicotineAssetSurround (5.1). Both carry the
// same 9-state mixer graph; only 13 master-channel mixData attenuation words
// (and 3 stale-pointer reserved words) differ, so editing mixData is THE
// use case this type exists for. The companion SnapshotData (0xA029) in the
// same bundle references this map's master channels by MIXCHID.

import { parseNicotine, writeNicotine, type ParsedNicotine } from '../../nicotine';
import type { ResourceHandler } from '../handler';

const countChannels = (m: ParsedNicotine, section: 'masterMix' | 'subMix') =>
	m.states.reduce((n, s) => n + (s[section]?.channels.length ?? 0), 0);

export const nicotineHandler: ResourceHandler<ParsedNicotine> = {
	typeId: 0xa024,
	key: 'nicotine',
	name: 'Nicotine Map',
	description: 'Sound-mixing map (EA Nicotine middleware) — per-state mix/3D/submix/master channel graphs with event controls and presets; one map for stereo output and one for 5.1 surround',
	category: 'Audio',
	caps: { read: true, write: true },
	wikiUrl: 'https://burnout.wiki/wiki/Nicotine_Map',
	notes: 'Nearly every value word is an undocumented bit field — counts are recomputed on write but packed per-record count bytes are validated, not rewritten. Stereo and surround maps differ only in master-channel mixData attenuation.',

	parseRaw(raw, ctx) {
		return parseNicotine(raw, ctx.littleEndian);
	},
	writeRaw(model, ctx) {
		return writeNicotine(model, ctx.littleEndian);
	},
	describe(model) {
		return `${model.states.length} states, ${countChannels(model, 'masterMix')} master + ${countChannels(model, 'subMix')} submix channels`;
	},

	fixtures: [
		{ bundle: 'example/SOUND/NICOTINEASSETMAIN.BUNDLE', expect: { parseOk: true, byteRoundTrip: true } },
		{ bundle: 'example/SOUND/NICOTINEASSETSURROUND.BUNDLE', expect: { parseOk: true, byteRoundTrip: true } },
	],

	// Both fixtures carry the identical 9-state structure (states[0] has 25
	// master channels + 18 events, states[1] has 8 3D controls), so every
	// scenario below can index the same paths on either fixture.
	stressScenarios: [
		{
			name: 'baseline',
			description: 'no mutation — exercises the writer on the read model unchanged',
			mutate: (m) => m,
			verify: (before, after) => {
				const problems: string[] = [];
				if (after.states.length !== before.states.length) {
					problems.push(`state count ${after.states.length} != ${before.states.length}`);
				}
				if (countChannels(after, 'masterMix') !== countChannels(before, 'masterMix')) {
					problems.push('master channel count changed');
				}
				return problems;
			},
		},
		{
			name: 'edit-master-mix-data',
			description: 'set states[0].masterMix.channels[0].mixData (the attenuation word — the only field differing between stereo and surround maps) and verify it survives',
			mutate: (m) => {
				m.states[0].masterMix!.channels[0].mixData = 0xff9cd8f0; // -100 centi-dB over the -10000 floor
				return m;
			},
			verify: (_afterMutate, afterReparse) => {
				const ch = afterReparse.states[0].masterMix?.channels[0];
				return ch?.mixData === 0xff9cd8f0 ? [] : [`mixData = 0x${ch?.mixData.toString(16)}, expected 0xff9cd8f0`];
			},
		},
		{
			name: 'edit-event-trigger',
			description: 'change states[0].events.events[0].nTriggerId and verify it survives alongside untouched params',
			mutate: (m) => {
				m.states[0].events!.events[0].nTriggerId = 0x12345678;
				return m;
			},
			verify: (afterMutate, afterReparse) => {
				const problems: string[] = [];
				const ev = afterReparse.states[0].events?.events[0];
				if (ev?.nTriggerId !== 0x12345678) problems.push(`nTriggerId = 0x${ev?.nTriggerId.toString(16)}, expected 0x12345678`);
				if (ev?.nParam00 !== afterMutate.states[0].events!.events[0].nParam00) problems.push('nParam00 changed');
				return problems;
			},
		},
		{
			name: 'edit-3d-state-params',
			description: 'change states[1].threeDControls.controls[0].stateParams[0].nQ0MinMax and verify it survives',
			mutate: (m) => {
				m.states[1].threeDControls!.controls[0].stateParams[0].nQ0MinMax = 0x00400040;
				return m;
			},
			verify: (_afterMutate, afterReparse) => {
				const q = afterReparse.states[1].threeDControls?.controls[0].stateParams[0].nQ0MinMax;
				return q === 0x00400040 ? [] : [`nQ0MinMax = 0x${q?.toString(16)}, expected 0x400040`];
			},
		},
		{
			name: 'remove-last-state',
			description: 'drop the final (submix-only) state — NumStates and every state-table offset are re-derived',
			mutate: (m) => ({ ...m, states: m.states.slice(0, -1) }),
			verify: (afterMutate, afterReparse) => {
				const problems: string[] = [];
				if (afterReparse.states.length !== afterMutate.states.length) {
					problems.push(`state count ${afterReparse.states.length} != ${afterMutate.states.length}`);
				}
				const last = afterReparse.states[afterReparse.states.length - 1];
				const expected = afterMutate.states[afterMutate.states.length - 1];
				if (last?.stateIndex !== expected?.stateIndex) {
					problems.push(`last stateIndex 0x${last?.stateIndex.toString(16)}, expected 0x${expected?.stateIndex.toString(16)}`);
				}
				return problems;
			},
		},
	],
};
