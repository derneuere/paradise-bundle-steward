// PolygonSoupList registry handler.

import {
	parsePolygonSoupListData,
	writePolygonSoupListData,
	type ParsedPolygonSoupList,
	type PolygonSoup,
	type PolygonSoupPoly,
	type PolygonSoupVertex,
} from '../../polygonSoupList';
import type { PickerEntry, ResourceHandler } from '../handler';

// Natural-order collator so `trk_2_*` sorts before `trk_10_*` rather than
// lexicographic `trk_10_*` < `trk_2_*`. Shared across every sort key that
// compares resource names.
const NATURAL_NAME = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function countTriangles(model: ParsedPolygonSoupList | null): number {
	if (model == null) return 0;
	let tris = 0;
	for (const s of model.soups) {
		for (const p of s.polygons) tris += p.vertexIndices[3] === 0xFF ? 1 : 2;
	}
	return tris;
}

function compareByName(a: PickerEntry<ParsedPolygonSoupList>, b: PickerEntry<ParsedPolygonSoupList>): number {
	return NATURAL_NAME.compare(a.ctx.name, b.ctx.name);
}

/**
 * Clone a soup deeply enough that mutating the copy can't affect the
 * original. `JSON.parse(JSON.stringify(...))` would work too but is slower
 * and obscures intent.
 */
function cloneSoup(s: PolygonSoup): PolygonSoup {
	return {
		vertexOffsets: [...s.vertexOffsets] as [number, number, number],
		comprGranularity: s.comprGranularity,
		numQuads: s.numQuads,
		padding: [...s.padding] as [number, number, number],
		vertices: s.vertices.map((v) => ({ ...v })),
		polygons: s.polygons.map((p) => ({
			collisionTag: p.collisionTag,
			vertexIndices: [...p.vertexIndices] as [number, number, number, number],
			edgeCosines: [...p.edgeCosines] as [number, number, number, number],
		})),
		min: { ...s.min },
		max: { ...s.max },
		offset: s.offset,
		verticesOffset: s.verticesOffset,
		polygonsOffset: s.polygonsOffset,
		dataSize: s.dataSize,
	};
}

/** Build a minimal valid soup: 3 packed verts, 1 triangle poly, zero bbox. */
function makeSyntheticSoup(): PolygonSoup {
	const vertices: PolygonSoupVertex[] = [
		{ x: 0,      y: 0,      z: 0 },
		{ x: 0x0100, y: 0,      z: 0 },
		{ x: 0,      y: 0x0100, z: 0 },
	];
	const polygons: PolygonSoupPoly[] = [
		{
			collisionTag: 0xCAFEBABE,
			vertexIndices: [0, 1, 2, 0xFF], // 0xFF in slot 3 means triangle
			edgeCosines: [0, 0, 0, 0],
		},
	];
	return {
		vertexOffsets: [0, 0, 0],
		comprGranularity: 1.0,
		numQuads: 0,
		padding: [0, 0, 0],
		vertices,
		polygons,
		min: { x: 0, y: 0, z: 0 },
		max: { x: 1, y: 1, z: 0 },
		// Layout fields are placeholders — the writer will detect the offset
		// collision (shared 0) against any other soup and normalize layout.
		offset: 0,
		verticesOffset: 0,
		polygonsOffset: 0,
		dataSize: 0,
	};
}

export const polygonSoupListHandler: ResourceHandler<ParsedPolygonSoupList> = {
	typeId: 0x43,
	key: 'polygonSoupList',
	name: 'Polygon Soup List',
	description: 'Per-track-unit collision meshes — packed vertices, polygons, and AABB4 tables',
	category: 'Data',
	caps: { read: true, write: true },

	parseRaw(raw, ctx) {
		return parsePolygonSoupListData(raw, ctx.littleEndian);
	},
	writeRaw(model, ctx) {
		return writePolygonSoupListData(model, ctx.littleEndian);
	},
	describe(model) {
		let polys = 0;
		let verts = 0;
		for (const s of model.soups) {
			polys += s.polygons.length;
			verts += s.vertices.length;
		}
		return `${model.soups.length} soups, ${polys} polys, ${verts} verts, dataSize ${model.dataSize}`;
	},

	// WORLDCOL.BIN ships ~200 PSL resources, ~160 of them empty stubs and the
	// rest named by track unit via debug XML (e.g. `trk_unit_XXX_col`). The
	// picker lets the user sort by name, populate-first, or size metrics so
	// the interesting ones surface without scrolling a fixed-position dropdown.
	picker: {
		labelOf(model, { name }) {
			const soupCount = model?.soups.length ?? 0;
			const tris = countTriangles(model);
			if (model == null) {
				return {
					primary: name,
					secondary: 'parse failed',
					badges: [{ label: 'parse failed', tone: 'warn' }],
				};
			}
			if (soupCount === 0) {
				return {
					primary: name,
					secondary: 'no geometry',
					badges: [{ label: 'empty', tone: 'muted' }],
				};
			}
			return {
				primary: name,
				secondary: `${soupCount} soup${soupCount === 1 ? '' : 's'} · ${tris.toLocaleString()} tris`,
			};
		},
		sortKeys: [
			{
				id: 'populated',
				label: 'Non-empty first, then name',
				// Populated < empty < parse-failed, ties broken by natural-order name.
				compare: (a, b) => {
					const rank = (e: PickerEntry<ParsedPolygonSoupList>) =>
						e.model == null ? 2 : e.model.soups.length === 0 ? 1 : 0;
					const dr = rank(a) - rank(b);
					return dr !== 0 ? dr : compareByName(a, b);
				},
			},
			{ id: 'name', label: 'Name (A→Z)', compare: compareByName },
			{ id: 'index', label: 'Bundle order', compare: (a, b) => a.ctx.index - b.ctx.index },
			{
				id: 'tris-desc',
				label: 'Triangles (high→low)',
				compare: (a, b) => countTriangles(b.model) - countTriangles(a.model),
			},
			{
				id: 'soups-desc',
				label: 'Soup count (high→low)',
				compare: (a, b) => (b.model?.soups.length ?? 0) - (a.model?.soups.length ?? 0),
			},
		],
		defaultSort: 'populated',
		searchText: (_m, { name }) => name,
	},

	fixtures: [
		{
			bundle: 'example/WORLDCOL.BIN',
			expect: { parseOk: true, byteRoundTrip: true },
		},
	],

	// The stress runner passes `verify(mutated, reparsed)` where `mutated` is
	// the return value of `mutate` (post-mutation pre-write) and `reparsed` is
	// what comes back after `parse(write(mutated))`. These checks confirm the
	// round-trip faithfully reproduces the mutation — writer idempotence is
	// asserted separately by the runner's bytesEqual(write1, write2) check.
	stressScenarios: [
		{
			name: 'baseline',
			description: 'no mutation — exercises writer idempotence on the parsed model',
			mutate: (m) => m,
			verify: (mutated, reparsed) => {
				const problems: string[] = [];
				if (reparsed.soups.length !== mutated.soups.length) {
					problems.push(`soup count drift: ${reparsed.soups.length} != ${mutated.soups.length}`);
				}
				return problems;
			},
		},
		{
			name: 'pop-last-soup',
			description: 'remove the last soup — surviving offsets stay unique (preserving path)',
			mutate: (m) => ({ ...m, soups: m.soups.slice(0, -1) }),
			verify: (mutated, reparsed) => {
				const problems: string[] = [];
				if (reparsed.soups.length !== mutated.soups.length) {
					problems.push(`count drift: ${reparsed.soups.length} != ${mutated.soups.length}`);
				}
				const tail = reparsed.soups[reparsed.soups.length - 1];
				const expected = mutated.soups[mutated.soups.length - 1];
				if (tail && expected && tail.polygons.length !== expected.polygons.length) {
					problems.push(`tail.polys = ${tail.polygons.length}, expected ${expected.polygons.length}`);
				}
				return problems;
			},
		},
		{
			name: 'pop-first-soup',
			description: 'remove the first soup — remaining pointers still land at valid unique offsets',
			mutate: (m) => ({ ...m, soups: m.soups.slice(1) }),
			verify: (mutated, reparsed) => {
				const problems: string[] = [];
				if (reparsed.soups.length !== mutated.soups.length) {
					problems.push(`count drift: ${reparsed.soups.length} != ${mutated.soups.length}`);
				}
				if (reparsed.soups[0] && mutated.soups[0]) {
					if (reparsed.soups[0].polygons.length !== mutated.soups[0].polygons.length) {
						problems.push(
							`soups[0].polys = ${reparsed.soups[0].polygons.length}, expected ${mutated.soups[0].polygons.length}`,
						);
					}
				}
				return problems;
			},
		},
		{
			name: 'swap-first-two-soups',
			description: 'swap soups[0] and soups[1] — count and offsets unchanged, only order flips',
			mutate: (m) => {
				if (m.soups.length < 2) return m;
				const soups = m.soups.slice();
				[soups[0], soups[1]] = [soups[1], soups[0]];
				return { ...m, soups };
			},
			verify: (mutated, reparsed) => {
				const problems: string[] = [];
				if (mutated.soups.length < 2) return problems;
				if (reparsed.soups[0].polygons.length !== mutated.soups[0].polygons.length) {
					problems.push(
						`soups[0].polys = ${reparsed.soups[0].polygons.length}, expected ${mutated.soups[0].polygons.length}`,
					);
				}
				if (reparsed.soups[1].polygons.length !== mutated.soups[1].polygons.length) {
					problems.push(
						`soups[1].polys = ${reparsed.soups[1].polygons.length}, expected ${mutated.soups[1].polygons.length}`,
					);
				}
				return problems;
			},
		},
		{
			name: 'duplicate-first-soup',
			description: 'clone soups[0] and append — triggers hasLayoutConflict + normalization',
			mutate: (m) => {
				if (m.soups.length === 0) return m;
				return { ...m, soups: [...m.soups, cloneSoup(m.soups[0])] };
			},
			verify: (mutated, reparsed) => {
				const problems: string[] = [];
				if (mutated.soups.length === 0) return problems;
				if (reparsed.soups.length !== mutated.soups.length) {
					problems.push(`count drift: ${reparsed.soups.length} != ${mutated.soups.length}`);
				}
				const first = reparsed.soups[0];
				const last = reparsed.soups[reparsed.soups.length - 1];
				if (first && last) {
					if (first.polygons.length !== last.polygons.length) {
						problems.push(`clone poly count ${last.polygons.length} != ${first.polygons.length}`);
					}
					if (first.vertices.length !== last.vertices.length) {
						problems.push(`clone vertex count ${last.vertices.length} != ${first.vertices.length}`);
					}
					// Normalization must have given the duplicate a distinct offset.
					if (first.offset === last.offset) {
						problems.push(`duplicate shares offset 0x${first.offset.toString(16)} — normalize didn't run`);
					}
				}
				return problems;
			},
		},
		{
			name: 'insert-synthetic-at-middle',
			description: 'splice a freshly constructed soup into soups[1] — exercises offset normalization mid-stream',
			mutate: (m) => {
				const soups = m.soups.slice();
				const insertAt = Math.min(1, soups.length);
				soups.splice(insertAt, 0, makeSyntheticSoup());
				return { ...m, soups };
			},
			verify: (mutated, reparsed) => {
				const problems: string[] = [];
				if (reparsed.soups.length !== mutated.soups.length) {
					problems.push(`count drift: ${reparsed.soups.length} != ${mutated.soups.length}`);
				}
				const insertAt = Math.min(1, mutated.soups.length - 1);
				const inserted = reparsed.soups[insertAt];
				if (!inserted) {
					problems.push(`inserted soup missing at index ${insertAt}`);
					return problems;
				}
				if (inserted.polygons.length !== 1) {
					problems.push(`inserted.polys = ${inserted.polygons.length}, expected 1`);
				}
				if (inserted.vertices.length !== 3) {
					problems.push(`inserted.vertices = ${inserted.vertices.length}, expected 3`);
				}
				if ((inserted.polygons[0]?.collisionTag >>> 0) !== 0xCAFEBABE) {
					problems.push(`inserted.collisionTag = 0x${(inserted.polygons[0]?.collisionTag ?? 0).toString(16)}`);
				}
				return problems;
			},
		},
		{
			name: 'append-synthetic-soup',
			description: 'append a freshly constructed soup to the end',
			mutate: (m) => ({ ...m, soups: [...m.soups, makeSyntheticSoup()] }),
			verify: (mutated, reparsed) => {
				const problems: string[] = [];
				if (reparsed.soups.length !== mutated.soups.length) {
					problems.push(`count drift: ${reparsed.soups.length} != ${mutated.soups.length}`);
				}
				const tail = reparsed.soups[reparsed.soups.length - 1];
				if ((tail?.polygons[0]?.collisionTag >>> 0) !== 0xCAFEBABE) {
					problems.push(`tail.collisionTag = 0x${(tail?.polygons[0]?.collisionTag ?? 0).toString(16)}`);
				}
				return problems;
			},
		},
	],
};
