// MassiveLookupTable registry handler — thin wrapper around
// parseMassiveLookupTable / writeMassiveLookupTable in
// src/lib/core/massiveLookupTable.ts.
//
// One resource in the whole game (MASSIVETABLE.BIN → MassiveTable): the 20 ad
// placements the defunct Massive Incorporated service filled with served ads.

import {
	parseMassiveLookupTable,
	writeMassiveLookupTable,
	makeEmptyMassiveItem,
	type ParsedMassiveLookupTable,
} from '../../massiveLookupTable';
import type { ResourceHandler } from '../handler';

export const massiveLookupTableHandler: ResourceHandler<ParsedMassiveLookupTable> = {
	typeId: 0x1001a,
	key: 'massiveLookupTable',
	name: 'Massive Lookup Table',
	description: 'In-game ad placement lookup for the defunct Massive Incorporated ad service — per placement: the ad quad\'s bounding box, owning Scene ID, inventory slot, and the Renderable whose texture the served ad replaced',
	category: 'Data',
	caps: { read: true, write: true },
	wikiUrl: 'https://burnout.wiki/wiki/Massive_Lookup_Table',
	notes: 'The ad service shut down with Massive Incorporated; the table is inert in retail but still parsed by the game where the asset survives.',

	parseRaw(raw, ctx) {
		return parseMassiveLookupTable(raw, ctx.littleEndian);
	},
	writeRaw(model, ctx) {
		return writeMassiveLookupTable(model, ctx.littleEndian);
	},
	describe(model) {
		const indexed = model.items.filter((i) => i.miIEIndex >= 0).length;
		return `${model.items.length} ad placement${model.items.length === 1 ? '' : 's'}, ${indexed} with inventory slots`;
	},

	fixtures: [
		{ bundle: 'example/MASSIVETABLE.BIN', expect: { parseOk: true, byteRoundTrip: true } },
	],

	stressScenarios: [
		{
			name: 'baseline',
			description: 'no mutation — exercises the writer on the read model unchanged',
			mutate: (m) => m,
			verify: (before, after) => {
				const problems: string[] = [];
				if (after.items.length !== before.items.length) {
					problems.push(`item count ${after.items.length} != ${before.items.length}`);
				}
				return problems;
			},
		},
		{
			name: 'move-bounding-box',
			description: 'translate items[0]\'s AABB and verify the new bounds survive round-trip',
			mutate: (m) => {
				const items = m.items.slice();
				const it = items[0];
				items[0] = {
					...it,
					mBoundingBoxMin: { x: it.mBoundingBoxMin.x + 1, y: it.mBoundingBoxMin.y + 2, z: it.mBoundingBoxMin.z + 3 },
					mBoundingBoxMax: { x: it.mBoundingBoxMax.x + 1, y: it.mBoundingBoxMax.y + 2, z: it.mBoundingBoxMax.z + 3 },
				};
				return { ...m, items };
			},
			verify: (afterMutate, afterReparse) => {
				const problems: string[] = [];
				for (const axis of ['x', 'y', 'z'] as const) {
					if (Math.abs(afterMutate.items[0].mBoundingBoxMin[axis] - afterReparse.items[0].mBoundingBoxMin[axis]) > 1e-3) {
						problems.push(`min.${axis} = ${afterReparse.items[0].mBoundingBoxMin[axis]}`);
					}
				}
				return problems;
			},
		},
		{
			name: 'change-ie-index',
			description: 'assign items[0] a new inventory slot, leaving its scene/renderable untouched',
			mutate: (m) => {
				const items = m.items.slice();
				items[0] = { ...items[0], miIEIndex: 42 };
				return { ...m, items };
			},
			verify: (afterMutate, afterReparse) => {
				const problems: string[] = [];
				if (afterReparse.items[0].miIEIndex !== 42) {
					problems.push(`miIEIndex = ${afterReparse.items[0].miIEIndex}, expected 42`);
				}
				if (afterReparse.items[0].mSceneId !== afterMutate.items[0].mSceneId) {
					problems.push('mSceneId changed');
				}
				return problems;
			},
		},
		{
			name: 'add-item',
			description: 'append a placement — count and mpItems are re-derived from the array',
			mutate: (m) => ({
				...m,
				items: [...m.items, { ...makeEmptyMassiveItem(), mSceneId: 0x1234n, muRenderableIndex: 20 }],
			}),
			verify: (afterMutate, afterReparse) => {
				const problems: string[] = [];
				if (afterReparse.items.length !== afterMutate.items.length) {
					problems.push(`item count ${afterReparse.items.length} != ${afterMutate.items.length}`);
				}
				const last = afterReparse.items[afterReparse.items.length - 1];
				if (last.mSceneId !== 0x1234n) problems.push(`appended sceneId ${last.mSceneId}`);
				return problems;
			},
		},
		{
			name: 'remove-last-item',
			description: 'drop the final placement — the shrunken table must reparse cleanly',
			mutate: (m) => ({ ...m, items: m.items.slice(0, -1) }),
			verify: (afterMutate, afterReparse) => {
				const problems: string[] = [];
				if (afterReparse.items.length !== afterMutate.items.length) {
					problems.push(`item count ${afterReparse.items.length} != ${afterMutate.items.length}`);
				}
				return problems;
			},
		},
	],
};
