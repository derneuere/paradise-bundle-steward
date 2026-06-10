// IdList registry handler — thin wrapper around parseIdList / writeIdList in
// src/lib/core/idList.ts.
//
// WORLDCOL.BIN carries 428 of these (TRK_CLIL<N>, one per track unit), so the
// handler ships a picker config. Every retail IdList holds exactly one id —
// the sibling PolygonSoupList named TRK_COL_<N> — which the picker surfaces.

import { parseIdList, writeIdList, type ParsedIdList } from '../../idList';
import type { PickerEntry, ResourceHandler } from '../handler';

// Natural-order collator so TRK_CLIL2 sorts before TRK_CLIL10.
const NATURAL_NAME = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function compareByName(a: PickerEntry<ParsedIdList>, b: PickerEntry<ParsedIdList>): number {
	return NATURAL_NAME.compare(a.ctx.name, b.ctx.name);
}

function formatId(id: bigint): string {
	return '0x' + id.toString(16).toUpperCase().padStart(8, '0');
}

export const idListHandler: ResourceHandler<ParsedIdList> = {
	typeId: 0x25,
	key: 'idList',
	name: 'ID List',
	description: 'Collision resource ids for one track unit — every retail IdList lists exactly the sibling PolygonSoupList in the same bundle, making the type redundant in practice',
	category: 'Data',
	caps: { read: true, write: true },
	wikiUrl: 'https://burnout.wiki/wiki/ID_List',

	parseRaw(raw, ctx) {
		return parseIdList(raw, ctx.littleEndian);
	},
	writeRaw(model, ctx) {
		return writeIdList(model, ctx.littleEndian);
	},
	describe(model) {
		return `${model.ids.length} collision resource id${model.ids.length === 1 ? '' : 's'}: ${model.ids.map(formatId).join(', ')}`;
	},

	picker: {
		labelOf(model, { name }) {
			if (model == null) {
				return {
					primary: name,
					secondary: 'parse failed',
					badges: [{ label: 'parse failed', tone: 'warn' }],
				};
			}
			if (model.ids.length === 0) {
				return {
					primary: name,
					secondary: 'no ids',
					badges: [{ label: 'empty', tone: 'muted' }],
				};
			}
			return {
				primary: name,
				secondary: model.ids.map(formatId).join(', '),
			};
		},
		sortKeys: [
			{ id: 'name', label: 'Name (A→Z)', compare: compareByName },
			{ id: 'index', label: 'Bundle order', compare: (a, b) => a.ctx.index - b.ctx.index },
		],
		defaultSort: 'name',
	},

	fixtures: [
		// The auto suite only exercises the first IdList in bundle order; all
		// 428 (including TRK_CLIL99's garbage pads) are swept byte-exact in
		// __tests__/idList.test.ts.
		{ bundle: 'example/WORLDCOL.BIN', expect: { parseOk: true, byteRoundTrip: true } },
	],

	stressScenarios: [
		{
			name: 'baseline',
			description: 'no mutation — exercises the writer on the read model unchanged',
			mutate: (m) => m,
			verify: (before, after) =>
				after.ids.length === before.ids.length
					? []
					: [`id count ${after.ids.length} != ${before.ids.length}`],
		},
		{
			name: 'retarget-id',
			description: 'point ids[0] at a different resource id and verify the u64 survives round-trip',
			mutate: (m) => {
				const ids = m.ids.slice();
				ids[0] = 0xdeadbeefn;
				return { ...m, ids };
			},
			verify: (_before, after) =>
				after.ids[0] === 0xdeadbeefn ? [] : [`ids[0] = ${formatId(after.ids[0])}, expected 0xDEADBEEF`],
		},
		{
			name: 'add-id',
			description: 'append a second id — muNumIds must grow and both ids survive',
			mutate: (m) => ({ ...m, ids: [...m.ids, 0xcafebaben] }),
			verify: (afterMutate, afterReparse) => {
				const problems: string[] = [];
				if (afterReparse.ids.length !== afterMutate.ids.length) {
					problems.push(`id count ${afterReparse.ids.length} != ${afterMutate.ids.length}`);
				}
				if (afterReparse.ids[afterReparse.ids.length - 1] !== 0xcafebaben) {
					problems.push(`tail id ${formatId(afterReparse.ids[afterReparse.ids.length - 1])}, expected 0xCAFEBABE`);
				}
				return problems;
			},
		},
		{
			name: 'remove-only-id',
			description: 'empty the id list — the engine never sees this shape in retail but the writer must stay consistent',
			mutate: (m) => ({ ...m, ids: [] }),
			verify: (_before, after) =>
				after.ids.length === 0 ? [] : [`id count ${after.ids.length}, expected 0`],
		},
	],
};
