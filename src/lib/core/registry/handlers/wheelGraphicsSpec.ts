// WheelGraphicsSpec registry handler.
//
// Wraps src/lib/core/wheelGraphicsSpec.ts. Read+write, layout-preserving.

import {
	parseWheelGraphicsSpec,
	writeWheelGraphicsSpec,
	WHEEL_GRAPHICS_SPEC_TYPE_ID,
	type ParsedWheelGraphicsSpec,
} from '../../wheelGraphicsSpec';
import type { ResourceHandler } from '../handler';

function formatId(id: bigint): string {
	return '0x' + id.toString(16).toUpperCase().padStart(16, '0');
}

export const wheelGraphicsSpecHandler: ResourceHandler<ParsedWheelGraphicsSpec> = {
	typeId: WHEEL_GRAPHICS_SPEC_TYPE_ID,
	key: 'wheelGraphicsSpec',
	name: 'WheelGraphicsSpec',
	description: 'Wheel + optional caliper Model references for a per-wheel bundle',
	category: 'Graphics',
	caps: { read: true, write: true },

	parseRaw(raw, ctx) {
		return parseWheelGraphicsSpec(raw, ctx.littleEndian);
	},
	writeRaw(spec, ctx) {
		return writeWheelGraphicsSpec(spec, ctx.littleEndian);
	},
	describe(spec) {
		const wheel = `wheel=${formatId(spec.wheelImport.id)}`;
		const caliper = spec.caliperImport
			? `caliper=${formatId(spec.caliperImport.id)}`
			: 'no caliper';
		return `v${spec.version}, ${wheel}, ${caliper}`;
	},

	fixtures: [
		{ bundle: 'example/WHE_00218650_GR.BNDL', expect: { parseOk: true, byteRoundTrip: true } },
		{ bundle: 'example/WHE_00318650_GR.BNDL', expect: { parseOk: true, byteRoundTrip: true } },
	],

	stressScenarios: [
		{
			name: 'baseline',
			description: 'no mutation — exercises writer idempotence',
			mutate: (m) => m,
		},
		{
			name: 'swap-wheel-caliper-ids',
			description: 'swap the wheel and caliper resource ids — exercises u64 writer',
			mutate: (m) => {
				if (!m.caliperImport) return m;
				return {
					...m,
					wheelImport: { ...m.wheelImport, id: m.caliperImport.id },
					caliperImport: { ...m.caliperImport, id: m.wheelImport.id },
				};
			},
			verify: (mutated, reparsed) => {
				const problems: string[] = [];
				if (reparsed.wheelImport.id !== mutated.wheelImport.id) {
					problems.push(`wheel id = ${reparsed.wheelImport.id.toString(16)} != ${mutated.wheelImport.id.toString(16)}`);
				}
				if ((reparsed.caliperImport?.id ?? null) !== (mutated.caliperImport?.id ?? null)) {
					problems.push(`caliper id drift`);
				}
				return problems;
			},
		},
		{
			name: 'drop-caliper',
			description: 'remove the caliper entry — tests size-changing mutation (48 → 32 B)',
			mutate: (m) => ({
				...m,
				mpCaliperModel: 0,
				caliperImport: null,
			}),
			verify: (mutated, reparsed) => {
				const problems: string[] = [];
				if (reparsed.caliperImport !== null) problems.push('caliper still present after drop');
				if (reparsed.mpCaliperModel !== 0) {
					problems.push(`mpCaliperModel = 0x${reparsed.mpCaliperModel.toString(16)} != 0`);
				}
				return problems;
			},
		},
	],
};
