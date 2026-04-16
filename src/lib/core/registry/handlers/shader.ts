// Shader (0x32) and ShaderProgramBuffer (0x12) registry handlers.
//
// Both are byte-preserving. Shader exposes the decoded shader name and a
// few header counts for inspection; ShaderProgramBuffer is opaque.

import {
	parseShaderData,
	writeShaderData,
	parseShaderProgramBufferData,
	writeShaderProgramBufferData,
	SHADER_TYPE_ID,
	SHADER_PROGRAM_BUFFER_TYPE_ID,
	type ParsedShader,
	type ParsedShaderProgramBuffer,
} from '../../shader';
import type { ResourceHandler } from '../handler';

export const shaderHandler: ResourceHandler<ParsedShader> = {
	typeId: SHADER_TYPE_ID,
	key: 'shader',
	name: 'Shader',
	description: 'ShaderTechnique wrapper: name, constant slots, samplers; references precompiled bytecode',
	category: 'Graphics',
	caps: { read: true, write: true },

	parseRaw(raw, ctx) {
		return parseShaderData(raw, ctx.littleEndian);
	},
	writeRaw(model, ctx) {
		return writeShaderData(model, ctx.littleEndian);
	},
	describe(model) {
		return `"${model.name}", ${model.numTechniques} techs, `
			+ `${model.numConstants} consts (${model.numConstantsWithInstanceData} w/ data), `
			+ `flags=0x${model.flags.toString(16)}${model.hasInlineHLSL ? ', inline-HLSL' : ''}`;
	},

	// SHADERS.BNDL is the only place 0x32 resources live in this repo and it
	// isn't tracked (~628 KB of game-asset data). Sweep it locally with
	// scripts/sweep-roundtrip.ts to validate the 86-resource round-trip.
	fixtures: [],

	stressScenarios: [
		{
			name: 'baseline',
			description: 'no mutation — exercises writer idempotence on the preserved bytes',
			mutate: (m) => m,
		},
		{
			name: 'flip-flags-bit',
			description: 'toggle bit 0 of the flags byte at +0x05',
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

export const shaderProgramBufferHandler: ResourceHandler<ParsedShaderProgramBuffer> = {
	typeId: SHADER_PROGRAM_BUFFER_TYPE_ID,
	key: 'shaderProgramBuffer',
	name: 'Shader Program Buffer',
	description: 'Precompiled HLSL bytecode imported by the Remastered Shader resource (opaque)',
	category: 'Graphics',
	caps: { read: true, write: true },

	parseRaw(raw, ctx) {
		return parseShaderProgramBufferData(raw, ctx.littleEndian);
	},
	writeRaw(model, ctx) {
		return writeShaderProgramBufferData(model, ctx.littleEndian);
	},
	describe(model) {
		return `${model.totalSize} bytes of precompiled bytecode`;
	},

	// Same as Shader: only available in untracked SHADERS.BNDL. Sweep
	// locally to validate the 242-resource round-trip.
	fixtures: [],

	stressScenarios: [
		{
			name: 'baseline',
			description: 'no mutation — exercises writer idempotence on the preserved bytes',
			mutate: (m) => m,
		},
	],
};
