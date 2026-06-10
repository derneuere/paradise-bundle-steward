// Csis registry handler — thin wrapper around parseCsis / writeCsis in
// src/lib/core/csis.ts.
//
// All ten retail Csis resources live in one bundle (SOUND/AEMS/CSIS.BUNDLE),
// so the handler ships a picker. Debug names are gamedb URLs
// (gamedb://…/Traffic/PC/TrafficCsis.Csis?ID=683680) — the picker shortens
// them to the basename so the tree stays readable.

import {
	parseCsis,
	writeCsis,
	csisSystemCrc,
	makeEmptyCsisEntry,
	type ParsedCsis,
} from '../../csis';
import type { ResourceHandler, PickerEntry } from '../handler';

/** 'gamedb://…/TrafficCsis.Csis?ID=683680' → 'TrafficCsis'. Non-gamedb names pass through. */
export function shortCsisName(name: string): string {
	const base = name.split('/').pop() ?? name;
	return base.replace(/\.Csis(\?ID=\d+)?$/i, '');
}

function entryCount(model: ParsedCsis | null): number {
	if (model == null) return -1;
	return model.functions.length + model.classes.length + model.globalVariables.length;
}

function compareByName(a: PickerEntry<ParsedCsis>, b: PickerEntry<ParsedCsis>): number {
	return shortCsisName(a.ctx.name).localeCompare(shortCsisName(b.ctx.name), undefined, { numeric: true });
}

export const csisHandler: ResourceHandler<ParsedCsis> = {
	typeId: 0xa023,
	key: 'csis',
	name: 'CSIS',
	description: 'Customizable Subscription-based Interfacing System descriptor — the named functions / classes / global variables one AEMS audio module exposes; AEMS banks subscribe to them by CrcAndKey through their tail interface references',
	category: 'Audio',
	caps: { read: true, write: true },
	wikiUrl: 'https://burnout.wiki/wiki/CSIS',
	notes: 'Entry crcs are matched against AEMS bank interface references at load — renaming or re-crcing an entry without updating the subscribing banks (or vice versa) silently breaks the audio link.',

	parseRaw(raw, ctx) {
		return parseCsis(raw, ctx.littleEndian);
	},
	writeRaw(model, ctx) {
		return writeCsis(model, ctx.littleEndian);
	},
	describe(model) {
		const parts = [
			`${model.functions.length} function${model.functions.length === 1 ? '' : 's'}`,
			`${model.classes.length} class${model.classes.length === 1 ? '' : 'es'}`,
		];
		if (model.globalVariables.length > 0) parts.push(`${model.globalVariables.length} globals`);
		return `${parts.join(', ')}, system crc 0x${csisSystemCrc(model).toString(16).toUpperCase()}`;
	},

	picker: {
		labelOf(model, { name }) {
			const primary = shortCsisName(name);
			if (model == null) {
				return {
					primary,
					secondary: 'parse failed',
					badges: [{ label: 'parse failed', tone: 'warn' }],
				};
			}
			const count = entryCount(model);
			if (count === 0) {
				return { primary, secondary: 'no entries', badges: [{ label: 'empty', tone: 'muted' }] };
			}
			const parts: string[] = [];
			if (model.classes.length > 0) parts.push(`${model.classes.length} class${model.classes.length === 1 ? '' : 'es'}`);
			if (model.functions.length > 0) parts.push(`${model.functions.length} fn`);
			if (model.globalVariables.length > 0) parts.push(`${model.globalVariables.length} gv`);
			return {
				primary,
				secondary: `${parts.join(' · ')} · crc 0x${csisSystemCrc(model).toString(16).toUpperCase()}`,
			};
		},
		sortKeys: [
			{ id: 'name', label: 'Name (A→Z)', compare: compareByName },
			{ id: 'index', label: 'Bundle order', compare: (a, b) => a.ctx.index - b.ctx.index },
			{
				id: 'entries-desc',
				label: 'Entry count (high→low)',
				compare: (a, b) => entryCount(b.model) - entryCount(a.model),
			},
		],
		defaultSort: 'name',
		searchText(model, { name }) {
			const entries = model == null
				? []
				: [...model.functions, ...model.classes, ...model.globalVariables].map((e) => e.name);
			return [shortCsisName(name), ...entries].join(' ');
		},
	},

	fixtures: [
		// CSIS.BUNDLE is the only retail carrier (10 Csis + 30 Registry
		// resources); the auto suite exercises the first in bundle order
		// (TrafficCsis). All ten, plus the bank↔csis CrcAndKey links, are
		// covered in __tests__/csis.test.ts.
		{ bundle: 'example/SOUND/AEMS/CSIS.BUNDLE', expect: { parseOk: true, byteRoundTrip: true } },
	],

	stressScenarios: [
		{
			name: 'baseline',
			description: 'no mutation — exercises the writer on the read model unchanged',
			mutate: (m) => m,
			verify: (before, after) => {
				const problems: string[] = [];
				if (after.classes.length !== before.classes.length) {
					problems.push(`class count ${after.classes.length} != ${before.classes.length}`);
				}
				if (csisSystemCrc(after) !== csisSystemCrc(before)) {
					problems.push(`system crc 0x${csisSystemCrc(after).toString(16)} != 0x${csisSystemCrc(before).toString(16)}`);
				}
				return problems;
			},
		},
		{
			name: 'rename-class',
			description: 'rename classes[0] to a longer name — string table, sizes, and the garbage pad must re-derive',
			mutate: (m) => {
				const classes = m.classes.slice();
				classes[0] = { ...classes[0], name: 'RenamedAudioModuleClass' };
				return { ...m, classes };
			},
			verify: (afterMutate, afterReparse) => {
				const problems: string[] = [];
				if (afterReparse.classes[0].name !== 'RenamedAudioModuleClass') {
					problems.push(`name '${afterReparse.classes[0].name}'`);
				}
				// Renaming does NOT change the crc (it is not name-derived) —
				// the link to subscribing banks is by CrcAndKey.
				if (afterReparse.classes[0].crc !== afterMutate.classes[0].crc) {
					problems.push(`crc drifted to 0x${afterReparse.classes[0].crc.toString(16)}`);
				}
				return problems;
			},
		},
		{
			name: 'edit-entry-crc',
			description: 'change classes[0].crc — the header system crc must re-derive as (Σ entry crcs) & 0x7FFF',
			mutate: (m) => {
				const classes = m.classes.slice();
				classes[0] = { ...classes[0], crc: 0x1234 };
				return { ...m, classes };
			},
			verify: (afterMutate, afterReparse) => {
				const problems: string[] = [];
				if (afterReparse.classes[0].crc !== 0x1234) {
					problems.push(`crc 0x${afterReparse.classes[0].crc.toString(16)}, expected 0x1234`);
				}
				// The parser asserts stored crc == derivation, so reparse
				// succeeding already proves the writer re-derived; double-check
				// the value matches the mutated model's derivation anyway.
				if (csisSystemCrc(afterReparse) !== csisSystemCrc(afterMutate)) {
					problems.push(`system crc 0x${csisSystemCrc(afterReparse).toString(16)} != 0x${csisSystemCrc(afterMutate).toString(16)}`);
				}
				return problems;
			},
		},
		{
			name: 'add-function',
			description: 'append a function entry — counts, desc array, string table, and system crc all re-derive',
			mutate: (m) => ({
				...m,
				functions: [...m.functions, { ...makeEmptyCsisEntry(), name: 'NewFunction', crc: 0x42 }],
			}),
			verify: (afterMutate, afterReparse) => {
				const problems: string[] = [];
				if (afterReparse.functions.length !== afterMutate.functions.length) {
					problems.push(`function count ${afterReparse.functions.length} != ${afterMutate.functions.length}`);
				}
				const added = afterReparse.functions[afterReparse.functions.length - 1];
				if (!added || added.name !== 'NewFunction' || added.crc !== 0x42) {
					problems.push(`appended entry came back as ${added ? `'${added.name}'/0x${added.crc.toString(16)}` : 'nothing'}`);
				}
				if (afterReparse.classes.length !== afterMutate.classes.length) {
					problems.push('class array perturbed');
				}
				return problems;
			},
		},
	],
};
