// WorldPainter2D registry handler — thin wrapper around
// parseWorldPainter2D / writeWorldPainter2D in src/lib/core/worldPainter2D.ts.
//
// One resource per bundle (DISTRICTS.DAT carries a single map named
// "Districts"), so no picker. Whether the cells are district indices or
// ambience indices is only recoverable from the debug name — the container
// is identical.

import {
	parseWorldPainter2D,
	writeWorldPainter2D,
	DISTRICT_NAMES,
	INVALID_CELL,
	type ParsedWorldPainter2D,
} from '../../worldPainter2D';
import type { ResourceHandler } from '../handler';

function firstPaintedIndex(m: ParsedWorldPainter2D): number {
	for (let i = 0; i < m.cells.length; i++) {
		if (m.cells[i] !== INVALID_CELL) return i;
	}
	throw new Error('WorldPainter2D stress: fixture has no painted cells to mutate');
}

function cellsMismatch(a: ParsedWorldPainter2D, b: ParsedWorldPainter2D): string[] {
	const problems: string[] = [];
	if (b.cells.length !== a.cells.length) {
		problems.push(`cell count ${b.cells.length} != ${a.cells.length}`);
		return problems;
	}
	for (let i = 0; i < a.cells.length; i++) {
		if (a.cells[i] !== b.cells[i]) {
			problems.push(`cells[${i}] = ${b.cells[i]}, expected ${a.cells[i]}`);
			if (problems.length >= 5) return problems;
		}
	}
	return problems;
}

export const worldPainter2DHandler: ResourceHandler<ParsedWorldPainter2D> = {
	typeId: 0x30,
	key: 'worldPainter2D',
	name: 'World Painter 2D',
	description: 'Dense 2D byte grid painted over the world map — one district (or ambience) index per map cell, 0xFF where nothing is painted. DISTRICTS.DAT maps every cell to a BrnWorld::EDistrict.',
	category: 'Data',
	caps: { read: true, write: true },
	wikiUrl: 'https://burnout.wiki/wiki/World_Painter_2D',

	parseRaw(raw, ctx) {
		return parseWorldPainter2D(raw, ctx.littleEndian);
	},
	writeRaw(model, ctx) {
		return writeWorldPainter2D(model, ctx.littleEndian);
	},
	describe(model) {
		let painted = 0;
		const seen = new Set<number>();
		for (const v of model.cells) {
			if (v !== INVALID_CELL) {
				painted++;
				seen.add(v);
			}
		}
		return `${model.muWidth}x${model.muHeight} grid, ${painted} painted cells, ${seen.size} indices in use`;
	},

	fixtures: [
		{ bundle: 'example/DISTRICTS.DAT', expect: { parseOk: true, byteRoundTrip: true } },
	],

	stressScenarios: [
		{
			name: 'baseline',
			description: 'no mutation — exercises the writer on the read model unchanged',
			mutate: (m) => m,
			verify: (before, after) => {
				const problems = cellsMismatch(before, after);
				if (after.muWidth !== before.muWidth || after.muHeight !== before.muHeight) {
					problems.push(`grid ${after.muWidth}x${after.muHeight} != ${before.muWidth}x${before.muHeight}`);
				}
				return problems;
			},
		},
		{
			name: 'repaint-cell',
			description: 'cycle the first painted cell to the next district index and verify it survives round-trip',
			mutate: (m) => {
				const cells = m.cells.slice();
				const i = firstPaintedIndex(m);
				cells[i] = (cells[i] + 1) % DISTRICT_NAMES.length;
				return { ...m, cells };
			},
			verify: cellsMismatch,
		},
		{
			name: 'erase-cell',
			description: 'set the first painted cell to 0xFF (no district) and verify the sentinel survives',
			mutate: (m) => {
				const cells = m.cells.slice();
				cells[firstPaintedIndex(m)] = INVALID_CELL;
				return { ...m, cells };
			},
			// cellsMismatch already proves the 0xFF sentinel byte survived at the
			// erased index — nothing role-specific to re-verify.
			verify: cellsMismatch,
		},
		{
			name: 'paint-block',
			description: 'flood an 8x8 block at the grid centre with Motor City (16) and verify every cell of the block',
			mutate: (m) => {
				const cells = m.cells.slice();
				const cx = m.muWidth >> 1;
				const cy = m.muHeight >> 1;
				for (let dy = 0; dy < 8; dy++) {
					for (let dx = 0; dx < 8; dx++) cells[(cy + dy) * m.muWidth + (cx + dx)] = 16;
				}
				return { ...m, cells };
			},
			verify: (afterMutate, afterReparse) => {
				const problems = cellsMismatch(afterMutate, afterReparse);
				const cx = afterReparse.muWidth >> 1;
				const cy = afterReparse.muHeight >> 1;
				for (let dy = 0; dy < 8; dy++) {
					for (let dx = 0; dx < 8; dx++) {
						const i = (cy + dy) * afterReparse.muWidth + (cx + dx);
						if (afterReparse.cells[i] !== 16) {
							problems.push(`block cell (${cx + dx}, ${cy + dy}) = ${afterReparse.cells[i]}, expected 16`);
							return problems;
						}
					}
				}
				return problems;
			},
		},
	],
};
