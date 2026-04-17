// Material registry handler.
//
// Wraps src/lib/core/material.ts. Read+write, layout-preserving via opaque
// body bytes + structured trailing import table.

import {
	parseMaterialData,
	writeMaterialData,
	MATERIAL_TYPE_ID,
	type ParsedMaterial,
} from '../../material';
import type { ResourceHandler } from '../handler';

function formatId(id: bigint): string {
	return '0x' + id.toString(16).toUpperCase().padStart(16, '0');
}

export const materialHandler: ResourceHandler<ParsedMaterial> = {
	typeId: MATERIAL_TYPE_ID,
	key: 'material',
	name: 'Material',
	description: 'Shader + MaterialStates + TextureStates binding, with per-constant parameter blobs',
	category: 'Graphics',
	caps: { read: true, write: true },

	parseRaw(raw, ctx) {
		return parseMaterialData(raw, ctx.littleEndian);
	},
	writeRaw(mat, ctx) {
		return writeMaterialData(mat, ctx.littleEndian);
	},
	describe(mat) {
		return `shader=${formatId(mat.shaderImport.id)}, ${mat.numMaterialStates} material-states, ${mat.numTextureStates} texture-states`;
	},

	fixtures: [
		{ bundle: 'example/VEH_CARBRWDS_GR.BIN', expect: { parseOk: true, byteRoundTrip: true } },
	],

	stressScenarios: [
		{
			name: 'baseline',
			description: 'no mutation — exercises writer idempotence',
			mutate: (m) => m,
		},
		{
			name: 'flip-shader-id-low-bit',
			description: 'toggle bit 0 of the shader id — single-bit change to the import table',
			mutate: (m) => ({
				...m,
				shaderImport: { ...m.shaderImport, id: m.shaderImport.id ^ 1n },
			}),
			verify: (mutated, reparsed) => {
				if (reparsed.shaderImport.id !== mutated.shaderImport.id) {
					return [`shader id drift: ${reparsed.shaderImport.id.toString(16)} != ${mutated.shaderImport.id.toString(16)}`];
				}
				return [];
			},
		},
		{
			name: 'reverse-material-states',
			description: 'reverse the material-state import order — exercises array writer',
			mutate: (m) => ({
				...m,
				materialStateImports: m.materialStateImports.slice().reverse(),
			}),
			verify: (mutated, reparsed) => {
				const problems: string[] = [];
				if (reparsed.materialStateImports.length !== mutated.materialStateImports.length) {
					problems.push('material-state count drift');
					return problems;
				}
				for (let i = 0; i < mutated.materialStateImports.length; i++) {
					if (reparsed.materialStateImports[i].id !== mutated.materialStateImports[i].id) {
						problems.push(`materialStates[${i}] id drift`);
					}
				}
				return problems;
			},
		},
	],

	fuzz: {
		// The generic structural fuzzer mutates top-level arrays — that means
		// it can clear or shrink the import arrays without updating the u8
		// counts inside `body`, and it can clear `body` itself (which our
		// parser correctly rejects when it turns out too small to hold the
		// import table the counts promise). Both are the right failure mode
		// — count them as expected rejections rather than crashes.
		tolerateErrors: [
			/materialStateImports length .* != numMaterialStates/,
			/textureStateImports length .* != numTextureStates/,
			/Material too small/,
			/Material import table .* does not fit/,
		],
	},
};
