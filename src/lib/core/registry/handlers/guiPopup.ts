// GuiPopup registry handler — thin wrapper around parseGuiPopup /
// writeGuiPopup in src/lib/core/guiPopup.ts.
//
// One resource game-wide (GUI/POPUPS.PUP), exactly one 0x1F per bundle, so
// no picker config. The writer recomputes the whole layout from the popup
// count, so popups can be added/removed freely — the add-popup scenario
// below exercises the pointer-array growth and alignment-pad recompute.

import {
	parseGuiPopup,
	writeGuiPopup,
	countMessageParamsUsed,
	type ParsedGuiPopup,
	type GuiPopup,
} from '../../guiPopup';
import { encodeCgsId } from '../../cgsid';
import type { ResourceHandler } from '../handler';

// 13 = E_POPUPSTYLE_CUSTOM — valid and absent from retail POPUPS.PUP (which
// uses 1 and 4–12), so 'change-style' provably changes the value.
const STRESS_STYLE = 13;

function makeStressPopup(macName: string): GuiPopup {
	return {
		mNameId: encodeCgsId(macName.toUpperCase()),
		macName,
		meStyle: 7, // In-game — OK
		meIcon: 0,
		macTitleId: 'PLACEHOLDER_TEMP_STRING',
		macMessageId: 'PLACEHOLDER_TEMP_STRING',
		maeMessageParams: [0, 0],
		miMessageParamsUsed: 0,
		macButton1Id: 'GENERAL_OPTION_OK',
		meButton1Param: 0,
		mbButton1ParamUsed: false,
		macButton2Id: '',
		meButton2Param: 0,
		mbButton2ParamUsed: false,
		_pad15: [0, 0, 0],
		_padB1: [0, 0, 0],
		_padB9: [0, 0, 0, 0, 0, 0, 0],
	};
}

export const guiPopupHandler: ResourceHandler<ParsedGuiPopup> = {
	typeId: 0x1f,
	key: 'guiPopup',
	name: 'GUI Popup',
	description: 'Card-styled in-game popup messages (POPUPS.PUP) — per popup: a CgsID name code summons it by, a style/icon, and Language string keys for title, message, and up to two buttons',
	category: 'Data',
	caps: { read: true, write: true },
	wikiUrl: 'https://burnout.wiki/wiki/GUI_Popup',

	parseRaw(raw, ctx) {
		return parseGuiPopup(raw, ctx.littleEndian);
	},
	writeRaw(model, ctx) {
		return writeGuiPopup(model, ctx.littleEndian);
	},
	describe(model) {
		const withButtons = model.popups.filter((p) => p.macButton1Id !== '').length;
		return `${model.popups.length} popups (${withButtons} with buttons)`;
	},

	fixtures: [
		{ bundle: 'example/POPUPS.PUP', expect: { parseOk: true, byteRoundTrip: true } },
	],

	stressScenarios: [
		{
			name: 'baseline',
			description: 'no mutation — exercises the writer on the read model unchanged',
			mutate: (m) => m,
			verify: (before, after) => {
				const problems: string[] = [];
				if (after.popups.length !== before.popups.length) {
					problems.push(`popup count ${after.popups.length} != ${before.popups.length}`);
				}
				return problems;
			},
		},
		{
			name: 'edit-message-id',
			description: 'retarget popups[0] at a different Language string key and verify the title is untouched',
			mutate: (m) => {
				const popups = m.popups.slice();
				popups[0] = { ...popups[0], macMessageId: 'PLACEHOLDER_TEMP_STRING' };
				return { ...m, popups };
			},
			verify: (afterMutate, afterReparse) => {
				const problems: string[] = [];
				if (afterReparse.popups[0].macMessageId !== 'PLACEHOLDER_TEMP_STRING') {
					problems.push(`macMessageId = "${afterReparse.popups[0].macMessageId}"`);
				}
				if (afterReparse.popups[0].macTitleId !== afterMutate.popups[0].macTitleId) {
					problems.push(`macTitleId changed to "${afterReparse.popups[0].macTitleId}"`);
				}
				return problems;
			},
		},
		{
			name: 'change-style',
			description: 'set popups[0].meStyle to Custom (13) and verify it survives round-trip',
			mutate: (m) => {
				const popups = m.popups.slice();
				popups[0] = { ...popups[0], meStyle: STRESS_STYLE };
				return { ...m, popups };
			},
			verify: (_afterMutate, afterReparse) => {
				const problems: string[] = [];
				if (afterReparse.popups[0].meStyle !== STRESS_STYLE) {
					problems.push(`meStyle = ${afterReparse.popups[0].meStyle}, expected ${STRESS_STYLE}`);
				}
				return problems;
			},
		},
		{
			name: 'rename-popup',
			description: 'rename popups[0] and recompute its CgsID the way retail derives it (uppercased macName)',
			mutate: (m) => {
				const popups = m.popups.slice();
				popups[0] = { ...popups[0], macName: 'StressRename', mNameId: encodeCgsId('STRESSRENAME') };
				return { ...m, popups };
			},
			verify: (_afterMutate, afterReparse) => {
				const problems: string[] = [];
				const p = afterReparse.popups[0];
				if (p.macName !== 'StressRename') problems.push(`macName = "${p.macName}"`);
				if (p.mNameId !== encodeCgsId('STRESSRENAME')) {
					problems.push(`mNameId = 0x${p.mNameId.toString(16)}, expected encodeCgsId('STRESSRENAME')`);
				}
				return problems;
			},
		},
		{
			name: 'add-popup',
			description: 'append a popup — grows the pointer array and recomputes the alignment pad, header count, and size',
			mutate: (m) => ({ ...m, popups: [...m.popups, makeStressPopup('StressAdd')] }),
			verify: (afterMutate, afterReparse) => {
				const problems: string[] = [];
				if (afterReparse.popups.length !== afterMutate.popups.length) {
					problems.push(`popup count ${afterReparse.popups.length} != ${afterMutate.popups.length}`);
				}
				const added = afterReparse.popups[afterReparse.popups.length - 1];
				if (added.macName !== 'StressAdd') problems.push(`added popup macName = "${added.macName}"`);
				if (added.miMessageParamsUsed !== countMessageParamsUsed(added.maeMessageParams)) {
					problems.push('added popup miMessageParamsUsed inconsistent with maeMessageParams');
				}
				return problems;
			},
		},
	],
};
