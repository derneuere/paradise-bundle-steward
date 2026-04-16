// Model registry handler.
//
// Wraps src/lib/core/model.ts. Read+write, layout-preserving.

import {
	parseModelData,
	writeModelData,
	MODEL_TYPE_ID,
	type ParsedModelResource,
} from '../../model';
import type { ResourceHandler } from '../handler';

export const modelHandler: ResourceHandler<ParsedModelResource> = {
	typeId: MODEL_TYPE_ID,
	key: 'model',
	name: 'Model',
	description: 'LOD/state → Renderable mapping with per-renderable LOD distance thresholds',
	category: 'Graphics',
	caps: { read: true, write: true },

	parseRaw(raw, ctx) {
		return parseModelData(raw, ctx.littleEndian);
	},
	writeRaw(model, ctx) {
		return writeModelData(model, ctx.littleEndian);
	},
	describe(model) {
		const r = model.lodDistances.length;
		const s = model.stateRenderableIndices.length;
		const dists = model.lodDistances.map((d) => d.toFixed(0)).join(',');
		return `${r} renderables, ${s} states, lod=[${dists}], flags=0x${model.flags.toString(16)}`;
	},

	fixtures: [
		// Other bundles in this repo (GLOBALPROPS.BIN, GLOBALBACKDROPS.BNDL,
		// any TRK_*) also contain Models and round-trip cleanly — point the
		// CLI sweep script at them locally to widen coverage. Only the
		// tracked fixture is enrolled in the auto-test suite.
		{ bundle: 'example/VEH_CARBRWDS_GR.BIN', expect: { parseOk: true, byteRoundTrip: true } },
	],

	stressScenarios: [
		{
			name: 'baseline',
			description: 'no mutation — exercises writer idempotence',
			mutate: (m) => m,
		},
		{
			name: 'bump-lod-distances',
			description: 'add 10m to every LOD distance — common edit, no layout change',
			mutate: (m) => ({
				...m,
				lodDistances: m.lodDistances.map((d) => d + 10),
			}),
			verify: (mutated, reparsed) => {
				const problems: string[] = [];
				if (reparsed.lodDistances.length !== mutated.lodDistances.length) {
					problems.push(`distance count drift`);
				}
				for (let i = 0; i < mutated.lodDistances.length; i++) {
					if (Math.abs(reparsed.lodDistances[i] - mutated.lodDistances[i]) > 1e-3) {
						problems.push(`lod[${i}] = ${reparsed.lodDistances[i]} != ${mutated.lodDistances[i]}`);
					}
				}
				return problems;
			},
		},
		{
			name: 'shuffle-state-mapping',
			description: 'reverse the state→renderable mapping — exercises u8 array writer',
			mutate: (m) => ({
				...m,
				stateRenderableIndices: m.stateRenderableIndices.slice().reverse(),
			}),
			verify: (mutated, reparsed) => {
				const problems: string[] = [];
				for (let i = 0; i < mutated.stateRenderableIndices.length; i++) {
					if (reparsed.stateRenderableIndices[i] !== mutated.stateRenderableIndices[i]) {
						problems.push(`state[${i}] = ${reparsed.stateRenderableIndices[i]} != ${mutated.stateRenderableIndices[i]}`);
					}
				}
				return problems;
			},
		},
		{
			name: 'flip-flags-bit',
			description: 'toggle bit 0 of mu8Flags — single-byte header field',
			mutate: (m) => ({ ...m, flags: m.flags ^ 0x01 }),
			verify: (mutated, reparsed) => {
				const problems: string[] = [];
				if (reparsed.flags !== mutated.flags) {
					problems.push(`flags = 0x${reparsed.flags.toString(16)} != 0x${mutated.flags.toString(16)}`);
				}
				return problems;
			},
		},
	],
};
