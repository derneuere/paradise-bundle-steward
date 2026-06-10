// StaticSoundMap registry handler — wraps parseStaticSoundMap /
// writeStaticSoundMap in src/lib/core/staticSoundMap.ts, with
// rebucketStaticSoundMap on the write path: every write recomputes the
// culling grid (bounds, dims, entity order, subregion runs) from entity
// positions, so position edits and entity add/remove can never leave the
// grid stale. Rebucketing reproduces the retail convention exactly
// (854/854 retail resources byte-identical), so unedited resources still
// round-trip byte-for-byte.
//
// Every track unit carries TWO of these (TRK_UNIT<N>_Emitter + _Passby), so
// the handler ships a picker config. The role is only recoverable from the
// debug name — meRootType is 0 in every retail resource — which the picker's
// ctx.name surfaces.

import {
	parseStaticSoundMap,
	writeStaticSoundMap,
	rebucketStaticSoundMap,
	staticSoundMapCellIndex,
	PASSBY_TYPES,
	type ParsedStaticSoundMap,
} from '../../staticSoundMap';
import type { ResourceHandler, PickerEntry } from '../handler';

// A passby type guaranteed valid (index into PASSBY_TYPES) and distinct from
// Collision (12), the most common retail value, so 'change-passby-type'
// provably changes the value.
const STRESS_PASSBY_TYPE = 9; // Tunnel

function compareByName(a: PickerEntry<ParsedStaticSoundMap>, b: PickerEntry<ParsedStaticSoundMap>): number {
	return a.ctx.name.localeCompare(b.ctx.name, undefined, { numeric: true });
}

// Grid-consistency invariants every reparsed model must satisfy after a
// rebucketing write: runs cover the entity array exactly, in cell order,
// and every entity's position maps back into the cell whose run owns it.
function gridProblems(m: ParsedStaticSoundMap): string[] {
	const problems: string[] = [];
	if (m.subRegions.length !== m.miNumSubRegionsX * m.miNumSubRegionsZ) {
		problems.push(`subregion count ${m.subRegions.length} != ${m.miNumSubRegionsX}x${m.miNumSubRegionsZ} grid`);
	}
	let next = 0;
	m.subRegions.forEach((cell, ci) => {
		if (cell.mi16First === -1) {
			if (cell.mi16Count !== 0) problems.push(`cell ${ci} is empty but has count ${cell.mi16Count}`);
			return;
		}
		if (cell.mi16First !== next) problems.push(`cell ${ci} run starts at ${cell.mi16First}, expected ${next}`);
		for (let j = cell.mi16First; j < cell.mi16First + cell.mi16Count; j++) {
			const owned = staticSoundMapCellIndex(m, m.entities[j].mPosition);
			if (owned !== ci) problems.push(`entity ${j} lives in cell ${ci}'s run but its position maps to cell ${owned}`);
		}
		next = cell.mi16First + cell.mi16Count;
	});
	if (next !== m.entities.length) problems.push(`runs cover ${next} entities, expected ${m.entities.length}`);
	return problems;
}

// Rebucketing sorts entities by grid cell, so a moved entity's array index
// can change across write→parse; verifies locate it by position instead.
function countAt(m: ParsedStaticSoundMap, pos: { x: number; y: number; z: number }): number {
	return m.entities.filter((e) =>
		Math.abs(e.mPosition.x - pos.x) < 1e-3 &&
		Math.abs(e.mPosition.y - pos.y) < 1e-3 &&
		Math.abs(e.mPosition.z - pos.z) < 1e-3,
	).length;
}

export const staticSoundMapHandler: ResourceHandler<ParsedStaticSoundMap> = {
	typeId: 0x10016,
	key: 'staticSoundMap',
	name: 'Static Sound Map',
	description: 'Ambient sounds placed around a track unit — an emitter map (looping positional sounds) and a passby map (one-shot whooshes for lampposts, trees, bridges, …), each a grid-bucketed entity list',
	category: 'Audio',
	caps: { read: true, write: true },
	notes: 'The culling grid (bounds, dims, subregion runs, entity order) is recomputed from entity positions on every write — entities can be added, removed and moved freely.',
	wikiUrl: 'https://burnout.wiki/wiki/Static_Sound_Map',

	parseRaw(raw, ctx) {
		return parseStaticSoundMap(raw, ctx.littleEndian);
	},
	writeRaw(model, ctx) {
		return writeStaticSoundMap(rebucketStaticSoundMap(model), ctx.littleEndian);
	},
	describe(model) {
		return `entities ${model.entities.length}, grid ${model.miNumSubRegionsX}x${model.miNumSubRegionsZ}, cell ${model.mfSubRegionSize}m`;
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
			const role = name.endsWith('_Emitter') ? 'emitter' : name.endsWith('_Passby') ? 'passby' : null;
			if (model.entities.length === 0) {
				return {
					primary: name,
					secondary: 'no sounds',
					badges: [{ label: 'empty', tone: 'muted' }],
				};
			}
			return {
				primary: name,
				secondary: `${model.entities.length} sound${model.entities.length === 1 ? '' : 's'} · ${model.miNumSubRegionsX}×${model.miNumSubRegionsZ} grid`,
				badges: role ? [{ label: role, tone: 'accent' as const }] : undefined,
			};
		},
		sortKeys: [
			{ id: 'name', label: 'Name (A→Z)', compare: compareByName },
			{ id: 'index', label: 'Bundle order', compare: (a, b) => a.ctx.index - b.ctx.index },
			{
				id: 'entities-desc',
				label: 'Sound count (high→low)',
				compare: (a, b) => (b.model?.entities.length ?? -1) - (a.model?.entities.length ?? -1),
			},
		],
		defaultSort: 'name',
	},

	fixtures: [
		// The auto suite only exercises whichever map is first in bundle order —
		// and that order is a coin flip across retail (217 emitter-first vs 210
		// passby-first), another reason role can never be inferred from position.
		// Both maps per bundle, plus the empty-map shape (e.g. TRK_UNIT0: 1x1
		// grid, zero entities — which the entities[0] stress scenarios below
		// can't run on), are covered in __tests__/staticSoundMap.test.ts.
		{ bundle: 'example/TRK_UNIT100_GR.BNDL', expect: { parseOk: true, byteRoundTrip: true } },
		{ bundle: 'example/TRK_UNIT380_GR.BNDL', expect: { parseOk: true, byteRoundTrip: true } },
	],

	stressScenarios: [
		{
			name: 'baseline',
			description: 'no mutation — the rebucketing write must reproduce the retail bytes' ,
			mutate: (m) => m,
			verify: (before, after) => {
				const problems = gridProblems(after);
				if (after.entities.length !== before.entities.length) {
					problems.push(`entity count ${after.entities.length} != ${before.entities.length}`);
				}
				if (after.subRegions.length !== before.subRegions.length) {
					problems.push(`subregion count ${after.subRegions.length} != ${before.subRegions.length}`);
				}
				return problems;
			},
		},
		{
			name: 'edit-entity-position',
			description: 'translate entities[0] without touching the grid; the write-path rebucket must keep the grid consistent and preserve the new coords',
			mutate: (m) => {
				const entities = m.entities.slice();
				const { x, y, z } = entities[0].mPosition;
				entities[0] = { ...entities[0], mPosition: { x: x + 10, y: y + 20, z: z + 30 } };
				return { ...m, entities };
			},
			verify: (afterMutate, afterReparse) => {
				const problems = gridProblems(afterReparse);
				// Rebucketing may reorder the array — find the moved entity by
				// position rather than index.
				const moved = afterMutate.entities[0].mPosition;
				if (countAt(afterReparse, moved) < 1) {
					problems.push(`no entity found at moved position (${moved.x}, ${moved.y}, ${moved.z})`);
				}
				if (afterReparse.entities.length !== afterMutate.entities.length) {
					problems.push(`entity count ${afterReparse.entities.length} != ${afterMutate.entities.length}`);
				}
				return problems;
			},
		},
		{
			name: 'change-passby-type',
			description: 'set entities[0].muTypeOrDistance to Tunnel and verify it survives alongside an untouched muSoundIndex',
			mutate: (m) => {
				const entities = m.entities.slice();
				entities[0] = { ...entities[0], muTypeOrDistance: STRESS_PASSBY_TYPE };
				return { ...m, entities };
			},
			verify: (afterMutate, afterReparse) => {
				const problems: string[] = [];
				// Positions are untouched, so the rebucket is order-stable and
				// index 0 still names the same entity after reparse.
				if (afterReparse.entities[0].muTypeOrDistance !== STRESS_PASSBY_TYPE) {
					problems.push(`muTypeOrDistance = ${afterReparse.entities[0].muTypeOrDistance}, expected ${STRESS_PASSBY_TYPE} (${PASSBY_TYPES[STRESS_PASSBY_TYPE]})`);
				}
				// The two u16s share the packed Vector3Plus lane — editing one must
				// not perturb the other.
				if (afterReparse.entities[0].muSoundIndex !== afterMutate.entities[0].muSoundIndex) {
					problems.push(`muSoundIndex changed to ${afterReparse.entities[0].muSoundIndex}`);
				}
				return problems;
			},
		},
		{
			name: 'remove-entity',
			description: 'drop entities[0] WITHOUT fixing up the grid — the write-path rebucket must rebuild every run',
			mutate: (m) => ({ ...m, entities: m.entities.slice(1) }),
			verify: (afterMutate, afterReparse) => {
				const problems = gridProblems(afterReparse);
				if (afterReparse.entities.length !== afterMutate.entities.length) {
					problems.push(`entity count ${afterReparse.entities.length} != ${afterMutate.entities.length}`);
				}
				return problems;
			},
		},
		{
			name: 'add-entity-outside-grid',
			description: 'append an entity beyond mMax — rebucketing must grow the grid to cover it',
			mutate: (m) => {
				const added = {
					mPosition: { x: m.mMax.x + 75, y: 0, z: m.mMin.y - 75 },
					muTypeOrDistance: STRESS_PASSBY_TYPE,
					muSoundIndex: 0,
				};
				return { ...m, entities: [...m.entities, added] };
			},
			verify: (afterMutate, afterReparse) => {
				const problems = gridProblems(afterReparse);
				const added = afterMutate.entities[afterMutate.entities.length - 1].mPosition;
				if (countAt(afterReparse, added) !== 1) {
					problems.push(`added entity not found at (${added.x}, ${added.y}, ${added.z})`);
				}
				if (afterReparse.mMax.x < added.x || afterReparse.mMin.y > added.z) {
					problems.push(`grid bounds did not grow to cover the added entity`);
				}
				if (afterReparse.entities.length !== afterMutate.entities.length) {
					problems.push(`entity count ${afterReparse.entities.length} != ${afterMutate.entities.length}`);
				}
				return problems;
			},
		},
		{
			name: 'move-entity-across-cells',
			description: 'drag entities[0] several cells away — the stale-subregion trap rebucketing exists to close',
			mutate: (m) => {
				const entities = m.entities.slice();
				const { y } = entities[0].mPosition;
				// Multiple cell diameters past the far corner of the grid.
				entities[0] = { ...entities[0], mPosition: { x: m.mMax.x + 125, y, z: m.mMax.y + 125 } };
				return { ...m, entities };
			},
			verify: (afterMutate, afterReparse) => {
				const problems = gridProblems(afterReparse);
				const moved = afterMutate.entities[0].mPosition;
				if (countAt(afterReparse, moved) !== 1) {
					problems.push(`moved entity not found at (${moved.x}, ${moved.y}, ${moved.z})`);
				}
				return problems;
			},
		},
	],
};
