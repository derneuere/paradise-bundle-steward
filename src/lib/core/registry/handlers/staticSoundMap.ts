// StaticSoundMap registry handler — thin wrapper around
// parseStaticSoundMap / writeStaticSoundMap in src/lib/core/staticSoundMap.ts.
//
// Every track unit carries TWO of these (TRK_UNIT<N>_Emitter + _Passby), so
// the handler ships a picker config. The role is only recoverable from the
// debug name — meRootType is 0 in every retail resource — which the picker's
// ctx.name surfaces.

import {
	parseStaticSoundMap,
	writeStaticSoundMap,
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

export const staticSoundMapHandler: ResourceHandler<ParsedStaticSoundMap> = {
	typeId: 0x10016,
	key: 'staticSoundMap',
	name: 'Static Sound Map',
	description: 'Ambient sounds placed around a track unit — an emitter map (looping positional sounds) and a passby map (one-shot whooshes for lampposts, trees, bridges, …), each a grid-bucketed entity list',
	category: 'Audio',
	caps: { read: true, write: true },
	wikiUrl: 'https://burnout.wiki/wiki/Static_Sound_Map',

	parseRaw(raw, ctx) {
		return parseStaticSoundMap(raw, ctx.littleEndian);
	},
	writeRaw(model, ctx) {
		return writeStaticSoundMap(model, ctx.littleEndian);
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
			description: 'no mutation — exercises the writer on the read model unchanged',
			mutate: (m) => m,
			verify: (before, after) => {
				const problems: string[] = [];
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
			description: 'translate entities[0] and verify the new coords survive round-trip',
			mutate: (m) => {
				const entities = m.entities.slice();
				const { x, y, z } = entities[0].mPosition;
				entities[0] = { ...entities[0], mPosition: { x: x + 10, y: y + 20, z: z + 30 } };
				return { ...m, entities };
			},
			verify: (afterMutate, afterReparse) => {
				const problems: string[] = [];
				const a = afterMutate.entities[0].mPosition;
				const b = afterReparse.entities[0].mPosition;
				for (const axis of ['x', 'y', 'z'] as const) {
					if (Math.abs(a[axis] - b[axis]) > 1e-3) problems.push(`pos.${axis} = ${b[axis]}, expected ${a[axis]}`);
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
			name: 'remove-last-entity',
			description: 'drop the final entity and shrink its owning subregion run; verify counts and grid consistency survive',
			mutate: (m) => {
				const entities = m.entities.slice(0, -1);
				const removedIndex = m.entities.length - 1;
				// Fix up the one cell whose run covered the removed entity — the
				// grid stays consistent (runs are contiguous and non-overlapping).
				const subRegions = m.subRegions.map((cell) => {
					if (cell.mi16First < 0) return cell;
					if (removedIndex >= cell.mi16First && removedIndex < cell.mi16First + cell.mi16Count) {
						const count = cell.mi16Count - 1;
						return { mi16First: count === 0 ? -1 : cell.mi16First, mi16Count: count };
					}
					return cell;
				});
				return { ...m, entities, subRegions };
			},
			verify: (afterMutate, afterReparse) => {
				const problems: string[] = [];
				if (afterReparse.entities.length !== afterMutate.entities.length) {
					problems.push(`entity count ${afterReparse.entities.length} != ${afterMutate.entities.length}`);
				}
				let covered = 0;
				for (const cell of afterReparse.subRegions) {
					if (cell.mi16First >= 0) covered += cell.mi16Count;
				}
				if (covered !== afterReparse.entities.length) {
					problems.push(`grid covers ${covered} entities, expected ${afterReparse.entities.length}`);
				}
				return problems;
			},
		},
	],
};
