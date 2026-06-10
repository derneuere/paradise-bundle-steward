// EnvironmentTimeLine registry handler — thin wrapper around
// parseEnvironmentTimeLine / writeEnvironmentTimeLine in
// src/lib/core/environmentSettings.ts.
//
// One timeline per season bundle (no picker needed). Its keyframe references
// are BND2 imports resolved by resource id against the EnvironmentKeyframe
// (0x10012) resources in the SAME bundle — every fixture timeline covers all
// of its bundle's keyframes exactly once, in ascending time order.

import {
	parseEnvironmentTimeLine,
	writeEnvironmentTimeLine,
	formatTimeOfDay,
	type ParsedEnvironmentTimeLine,
} from '../../environmentSettings';
import type { ResourceHandler } from '../handler';

export const environmentTimeLineHandler: ResourceHandler<ParsedEnvironmentTimeLine> = {
	typeId: 0x10013,
	key: 'environmentTimeLine',
	name: 'Environment Timeline',
	description: 'Time-of-day schedule for a season — per location, an ascending list of (clock time, EnvironmentKeyframe) pairs the game interpolates between as the in-game clock advances',
	category: 'Graphics',
	caps: { read: true, write: true },
	wikiUrl: 'https://burnout.wiki/wiki/Environment_Timeline',
	notes: 'Keyframe references live in the resource\'s inline import table — one entry per schedule entry. Adding/removing entries resizes the table; the bundle envelope recomputes its import metadata via importTable() on export.',

	parseRaw(raw, ctx) {
		return parseEnvironmentTimeLine(raw, ctx.littleEndian);
	},
	writeRaw(model, ctx) {
		return writeEnvironmentTimeLine(model, ctx.littleEndian);
	},
	importTable(payload, ctx) {
		// One import per schedule entry, at the payload tail (the parser throws
		// unless the layout — including the table position — is canonical).
		const model = parseEnvironmentTimeLine(payload, ctx.littleEndian);
		const count = model.locations.reduce((n, l) => n + l.keyframes.length, 0);
		return { offset: payload.byteLength - count * 16, count };
	},
	describe(model) {
		const total = model.locations.reduce((n, l) => n + l.keyframes.length, 0);
		const first = model.locations[0]?.keyframes[0];
		const lastLoc = model.locations[model.locations.length - 1];
		const last = lastLoc?.keyframes[lastLoc.keyframes.length - 1];
		const span = first && last ? `, ${formatTimeOfDay(first.mfTimeOfDay)} → ${formatTimeOfDay(last.mfTimeOfDay)}` : '';
		return `${model.locations.length} location${model.locations.length === 1 ? '' : 's'}, ${total} keyframe${total === 1 ? '' : 's'}${span}`;
	},

	fixtures: [
		// Timeline↔keyframe set equality and the import-order ↔ time-order
		// relationship are pinned in __tests__/environmentSettings.test.ts.
		{ bundle: 'example/ENVIRONMENTSETTINGS/000_DLC24HR_FOG_A.BUNDLE', expect: { parseOk: true, byteRoundTrip: true } },
		{ bundle: 'example/ENVIRONMENTSETTINGS/000_DLC24HR_JUNKYARDT.BUNDLE', expect: { parseOk: true, byteRoundTrip: true } },
		{ bundle: 'example/ENVIRONMENTSETTINGS/000_DLC24HR_OC_A.BUNDLE', expect: { parseOk: true, byteRoundTrip: true } },
		{ bundle: 'example/ENVIRONMENTSETTINGS/000_DLC24HR_SUN_A.BUNDLE', expect: { parseOk: true, byteRoundTrip: true } },
	],

	stressScenarios: [
		{
			name: 'baseline',
			description: 'no mutation — exercises the writer on the read model unchanged',
			mutate: (m) => m,
			verify: (before, after) => {
				const problems: string[] = [];
				if (after.locations.length !== before.locations.length) {
					problems.push(`location count ${after.locations.length} != ${before.locations.length}`);
				}
				const a = after.locations[0]?.keyframes.length ?? -1;
				const b = before.locations[0]?.keyframes.length ?? -1;
				if (a !== b) problems.push(`keyframe count ${a} != ${b}`);
				return problems;
			},
		},
		{
			name: 'shift-time',
			description: 'move the first keyframe 5 minutes later (stays below entry [1]) and verify the time survives',
			mutate: (m) => {
				const keyframes = m.locations[0].keyframes.slice();
				keyframes[0] = { ...keyframes[0], mfTimeOfDay: keyframes[0].mfTimeOfDay + 300 };
				return { ...m, locations: [{ keyframes }, ...m.locations.slice(1)] };
			},
			verify: (afterMutate, afterReparse) => {
				const want = afterMutate.locations[0].keyframes[0].mfTimeOfDay;
				const got = afterReparse.locations[0].keyframes[0].mfTimeOfDay;
				return got === want ? [] : [`mfTimeOfDay ${got}, expected ${want}`];
			},
		},
		{
			name: 'retarget-keyframe',
			description: 'point the first entry at a different keyframe id; the import entry must carry it while its time stays put',
			mutate: (m) => {
				const keyframes = m.locations[0].keyframes.slice();
				keyframes[0] = { ...keyframes[0], mKeyframeId: 0x12345678n };
				return { ...m, locations: [{ keyframes }, ...m.locations.slice(1)] };
			},
			verify: (afterMutate, afterReparse) => {
				const problems: string[] = [];
				const got = afterReparse.locations[0].keyframes[0];
				if (got.mKeyframeId !== 0x12345678n) problems.push(`mKeyframeId 0x${got.mKeyframeId.toString(16)}, expected 0x12345678`);
				if (got.mfTimeOfDay !== afterMutate.locations[0].keyframes[0].mfTimeOfDay) {
					problems.push(`mfTimeOfDay drifted to ${got.mfTimeOfDay}`);
				}
				return problems;
			},
		},
		{
			name: 'append-keyframe',
			// Counts, pointers, and import patch-offsets are all recomputed from
			// the arrays — appending grows the resource by 4+4+16 bytes (slot,
			// time, import entry) plus alignment. Payload-level only: the bundle
			// envelope's importCount is not this writer's to update.
			description: 'append a 23:59 entry and verify counts, the new entry, and the grown import table reparse correctly',
			mutate: (m) => ({
				...m,
				locations: [
					{ keyframes: [...m.locations[0].keyframes, { mfTimeOfDay: 86340, mKeyframeId: 0xabcdef01n }] },
					...m.locations.slice(1),
				],
			}),
			verify: (afterMutate, afterReparse) => {
				const problems: string[] = [];
				const want = afterMutate.locations[0].keyframes.length;
				const got = afterReparse.locations[0].keyframes;
				if (got.length !== want) problems.push(`keyframe count ${got.length} != ${want}`);
				const last = got[got.length - 1];
				if (last.mfTimeOfDay !== 86340) problems.push(`appended time ${last.mfTimeOfDay} != 86340`);
				if (last.mKeyframeId !== 0xabcdef01n) problems.push(`appended id 0x${last.mKeyframeId.toString(16)} != 0xabcdef01`);
				return problems;
			},
		},
		{
			name: 'remove-last-keyframe',
			description: 'drop the final entry; the layout (and import table) must shrink consistently',
			mutate: (m) => ({
				...m,
				locations: [
					{ keyframes: m.locations[0].keyframes.slice(0, -1) },
					...m.locations.slice(1),
				],
			}),
			verify: (afterMutate, afterReparse) => {
				const want = afterMutate.locations[0].keyframes.length;
				const got = afterReparse.locations[0].keyframes.length;
				return got === want ? [] : [`keyframe count ${got} != ${want}`];
			},
		},
	],
};
