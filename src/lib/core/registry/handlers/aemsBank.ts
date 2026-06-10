// AemsBank registry handler — thin wrapper around parseAemsBank /
// writeAemsBank in src/lib/core/aemsBank.ts.
//
// Every retail AEMS bundle carries exactly ONE bank resource, so no picker.
// Read is marked partial: the compiled module (x86 glue code) and the SND10
// sample bank are preserved as opaque blobs — only the envelope, fixup
// tables, and CSIS interface references are decoded.

import {
	parseAemsBank,
	writeAemsBank,
	aemsSfxBankInfo,
	type ParsedAemsBank,
} from '../../aemsBank';
import type { ResourceHandler } from '../handler';

export const aemsBankHandler: ResourceHandler<ParsedAemsBank> = {
	typeId: 0xa022,
	key: 'aemsBank',
	name: 'AEMS Bank',
	description: 'Event-driven audio bank — a compiled AEMS module (x86 glue code + static data) plus an SND10 sample bank holding the boost / skid / scrape / horn / surface sounds; binds to the CSIS subscription system via tail interface references',
	category: 'Audio',
	caps: { read: true, write: true },
	wikiUrl: 'https://burnout.wiki/wiki/AEMS_Bank',
	notes: 'The module interior (compiled x86 glue) and the SND10 sample bank are opaque verbatim blobs — the decoded surface is the envelope, the load-time fixup tables, and the CSIS class subscriptions.',
	capabilityOverrides: { read: 'partial' },

	parseRaw(raw, ctx) {
		return parseAemsBank(raw, ctx.littleEndian);
	},
	writeRaw(model, ctx) {
		return writeAemsBank(model, ctx.littleEndian);
	},
	describe(model) {
		const sfx = aemsSfxBankInfo(model);
		const refs = model.interfaceRefs.map((r) => r.idName).join(', ') || 'none';
		return `${sfx ? `${sfx.numSamples} sample${sfx.numSamples === 1 ? '' : 's'} (${sfx.id})` : 'no SFX bank'}, ${model.numModules} module${model.numModules === 1 ? '' : 's'}, fixups ${model.funcFixups.length}+${model.staticDataFixups.length}, subscribes ${refs}`;
	},

	fixtures: [
		// All 23 retail banks (plus the CSIS cross-links) are swept in
		// __tests__/aemsBank.test.ts; these five cover the size extremes, the
		// two-module shape (INAIR — the wiki claims nummodules is always 1),
		// and the multi-interface-reference shape.
		{ bundle: 'example/SOUND/AEMS/BOOST_BANK_EXOTIC.BUNDLE', expect: { parseOk: true, byteRoundTrip: true } },
		{ bundle: 'example/SOUND/AEMS/SKIDS.BUNDLE', expect: { parseOk: true, byteRoundTrip: true } },
		{ bundle: 'example/SOUND/AEMS/TRAFFIC_BANK.BUNDLE', expect: { parseOk: true, byteRoundTrip: true } },
		{ bundle: 'example/SOUND/AEMS/GEARWHINEPATCHBANK.BUNDLE', expect: { parseOk: true, byteRoundTrip: true } },
		{ bundle: 'example/SOUND/AEMS/INAIR.BUNDLE', expect: { parseOk: true, byteRoundTrip: true } },
	],

	stressScenarios: [
		{
			name: 'baseline',
			description: 'no mutation — exercises the writer on the read model unchanged',
			mutate: (m) => m,
			verify: (before, after) => {
				const problems: string[] = [];
				if (after.funcFixups.length !== before.funcFixups.length) {
					problems.push(`func fixup count ${after.funcFixups.length} != ${before.funcFixups.length}`);
				}
				if (after.interfaceRefs.length !== before.interfaceRefs.length) {
					problems.push(`interface ref count ${after.interfaceRefs.length} != ${before.interfaceRefs.length}`);
				}
				if (after._sfxBank.byteLength !== before._sfxBank.byteLength) {
					problems.push(`SFX bank size ${after._sfxBank.byteLength} != ${before._sfxBank.byteLength}`);
				}
				return problems;
			},
		},
		{
			name: 'rename-interface',
			description: 'rename interfaceRefs[0] to a longer name — the ID blob, totalsize, and both alignment pads must re-derive',
			mutate: (m) => {
				const interfaceRefs = m.interfaceRefs.slice();
				interfaceRefs[0] = { ...interfaceRefs[0], idName: 'RenamedSubscriptionClass' };
				return { ...m, interfaceRefs };
			},
			verify: (afterMutate, afterReparse) => {
				const problems: string[] = [];
				const ref = afterReparse.interfaceRefs[0];
				if (ref.idName !== 'RenamedSubscriptionClass') problems.push(`idName '${ref.idName}'`);
				// The CrcAndKey shares the ID blob with the name — renaming must
				// not perturb it.
				if (ref.idCrc !== afterMutate.interfaceRefs[0].idCrc) problems.push(`idCrc drifted to 0x${ref.idCrc.toString(16)}`);
				if (ref.idKey !== afterMutate.interfaceRefs[0].idKey) problems.push(`idKey drifted to 0x${ref.idKey.toString(16)}`);
				return problems;
			},
		},
		{
			name: 'retarget-crc-key',
			description: 'point interfaceRefs[0] at a different CSIS entry by CrcAndKey and verify both u16 lanes survive',
			mutate: (m) => {
				const interfaceRefs = m.interfaceRefs.slice();
				interfaceRefs[0] = { ...interfaceRefs[0], idCrc: 0x1234, idKey: 0x5678 };
				return { ...m, interfaceRefs };
			},
			verify: (_before, after) => {
				const ref = after.interfaceRefs[0];
				return ref.idCrc === 0x1234 && ref.idKey === 0x5678
					? []
					: [`CrcAndKey (0x${ref.idCrc.toString(16)}, 0x${ref.idKey.toString(16)}), expected (0x1234, 0x5678)`];
			},
		},
		{
			name: 'add-func-fixup',
			description: 'append a func fixup — the three tail tables and every derived offset must shift consistently',
			mutate: (m) => ({ ...m, funcFixups: [...m.funcFixups, 0xdead] }),
			verify: (afterMutate, afterReparse) => {
				const problems: string[] = [];
				if (afterReparse.funcFixups.length !== afterMutate.funcFixups.length) {
					problems.push(`func fixup count ${afterReparse.funcFixups.length} != ${afterMutate.funcFixups.length}`);
				}
				if (afterReparse.funcFixups[afterReparse.funcFixups.length - 1] !== 0xdead) {
					problems.push('appended fixup value lost');
				}
				if (afterReparse.staticDataFixups.length !== afterMutate.staticDataFixups.length) {
					problems.push('static data fixup table perturbed');
				}
				return problems;
			},
		},
	],
};
