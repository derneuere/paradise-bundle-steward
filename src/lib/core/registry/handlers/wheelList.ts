// WheelList registry handler — thin wrapper around parseWheelList /
// writeWheelList in src/lib/core/wheelList.ts.
//
// WHEELLIST.BUNDLE carries exactly one resource (debug name "B5WheelList"),
// so no picker config. Each entry's CgsID encodes the wheel CODE that names
// the wheel's graphics bundle (WHE_<code>_GR.BNDL) — retargeting mId repoints
// a wheel at different graphics.

import { decodeCgsId, encodeCgsId } from '../../cgsid';
import { parseWheelList, writeWheelList, type ParsedWheelList } from '../../wheelList';
import type { ResourceHandler } from '../handler';

// A valid 8-char wheel code distinct from every retail id, so the stress
// mutation provably changes the value.
const STRESS_WHEEL_CODE = '99999999';

export const wheelListHandler: ResourceHandler<ParsedWheelList> = {
	typeId: 0x10009,
	key: 'wheelList',
	name: 'Wheel List',
	description: 'The global wheel catalogue — one entry per wheel in the game, pairing a CgsID wheel code (which names the WHE_<code>_GR.BNDL graphics bundle) with a human-readable wheel name',
	category: 'Data',
	caps: { read: true, write: true },
	wikiUrl: 'https://burnout.wiki/wiki/Wheel_List',

	parseRaw(raw, ctx) {
		return parseWheelList(raw, ctx.littleEndian);
	},
	writeRaw(model, ctx) {
		return writeWheelList(model, ctx.littleEndian);
	},
	describe(model) {
		return `${model.entries.length} wheels`;
	},

	fixtures: [
		{ bundle: 'example/WHEELLIST.BUNDLE', expect: { parseOk: true, byteRoundTrip: true } },
	],

	stressScenarios: [
		{
			name: 'baseline',
			description: 'no mutation — exercises the writer on the read model unchanged',
			mutate: (m) => m,
			verify: (before, after) =>
				after.entries.length === before.entries.length
					? []
					: [`entry count ${after.entries.length} != ${before.entries.length}`],
		},
		{
			name: 'rename-wheel',
			description: 'rename entries[0] and verify the new name survives alongside an untouched mId',
			mutate: (m) => {
				const entries = m.entries.slice();
				entries[0] = { ...entries[0], macWheelName: 'Stress_Wheel_Name' };
				return { ...m, entries };
			},
			verify: (afterMutate, afterReparse) => {
				const problems: string[] = [];
				if (afterReparse.entries[0].macWheelName !== 'Stress_Wheel_Name') {
					problems.push(`name "${afterReparse.entries[0].macWheelName}", expected "Stress_Wheel_Name"`);
				}
				if (afterReparse.entries[0].mId !== afterMutate.entries[0].mId) {
					problems.push(`mId drifted to 0x${afterReparse.entries[0].mId.toString(16)}`);
				}
				return problems;
			},
		},
		{
			name: 'retarget-wheel-code',
			description: 'point entries[0].mId at a different wheel code and verify the u64 survives round-trip',
			mutate: (m) => {
				const entries = m.entries.slice();
				entries[0] = { ...entries[0], mId: encodeCgsId(STRESS_WHEEL_CODE) };
				return { ...m, entries };
			},
			verify: (_before, after) =>
				decodeCgsId(after.entries[0].mId) === STRESS_WHEEL_CODE
					? []
					: [`mId decodes to "${decodeCgsId(after.entries[0].mId)}", expected "${STRESS_WHEEL_CODE}"`],
		},
		{
			name: 'add-wheel',
			description: 'append a synthetic entry — muNumWheels must grow and the new entry survive',
			mutate: (m) => ({
				...m,
				entries: [...m.entries, { mId: encodeCgsId(STRESS_WHEEL_CODE), macWheelName: 'Stress_Added_Wheel' }],
			}),
			verify: (afterMutate, afterReparse) => {
				const problems: string[] = [];
				if (afterReparse.entries.length !== afterMutate.entries.length) {
					problems.push(`entry count ${afterReparse.entries.length} != ${afterMutate.entries.length}`);
				}
				const tail = afterReparse.entries[afterReparse.entries.length - 1];
				if (tail?.macWheelName !== 'Stress_Added_Wheel') {
					problems.push(`tail name "${tail?.macWheelName}", expected "Stress_Added_Wheel"`);
				}
				return problems;
			},
		},
		{
			name: 'remove-last-wheel',
			description: 'drop the final entry — muNumWheels must shrink without disturbing the survivors',
			mutate: (m) => ({ ...m, entries: m.entries.slice(0, -1) }),
			verify: (afterMutate, afterReparse) => {
				const problems: string[] = [];
				if (afterReparse.entries.length !== afterMutate.entries.length) {
					problems.push(`entry count ${afterReparse.entries.length} != ${afterMutate.entries.length}`);
				}
				if (afterReparse.entries[0]?.mId !== afterMutate.entries[0]?.mId) {
					problems.push('entries[0].mId drifted after tail removal');
				}
				return problems;
			},
		},
	],
};
