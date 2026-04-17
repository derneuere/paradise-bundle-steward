// GraphicsStub registry handler.
//
// Wraps src/lib/core/graphicsStub.ts. Read+write, fixed 48-byte size, no
// fixture in this repo (the resource lives in VEH_*.BIN wrapper bundles that
// aren't part of the tracked example set — see src/lib/core/graphicsStub.ts
// for why).

import {
	parseGraphicsStub,
	writeGraphicsStub,
	getVehicleGraphicsSpecId,
	getWheelGraphicsSpecId,
	GRAPHICS_STUB_TYPE_ID,
	type ParsedGraphicsStub,
} from '../../graphicsStub';
import type { ResourceHandler } from '../handler';

function formatId(id: bigint | null): string {
	if (id === null) return '—';
	return '0x' + id.toString(16).toUpperCase().padStart(16, '0');
}

export const graphicsStubHandler: ResourceHandler<ParsedGraphicsStub> = {
	typeId: GRAPHICS_STUB_TYPE_ID,
	key: 'graphicsStub',
	name: 'GraphicsStub',
	description: 'Entry point of a vehicle bundle — names the GraphicsSpec + WheelGraphicsSpec',
	category: 'Graphics',
	caps: { read: true, write: true },

	parseRaw(raw, ctx) {
		return parseGraphicsStub(raw, ctx.littleEndian);
	},
	writeRaw(stub, ctx) {
		return writeGraphicsStub(stub, ctx.littleEndian);
	},
	describe(stub) {
		return `vehicle=${formatId(getVehicleGraphicsSpecId(stub))}, wheel=${formatId(getWheelGraphicsSpecId(stub))}`;
	},

	fixtures: [],

	stressScenarios: [
		{
			name: 'baseline',
			description: 'no mutation — exercises writer idempotence',
			mutate: (m) => m,
		},
		{
			name: 'swap-slot-indices',
			description: 'swap vehicle/wheel slot indices — tests slot-field writer',
			mutate: (m) => ({
				...m,
				mpVehicleGraphicsSlot: m.mpWheelGraphicsSlot,
				mpWheelGraphicsSlot: m.mpVehicleGraphicsSlot,
			}),
			verify: (mutated, reparsed) => {
				const problems: string[] = [];
				if (reparsed.mpVehicleGraphicsSlot !== mutated.mpVehicleGraphicsSlot) {
					problems.push(`vehicle slot drift: ${reparsed.mpVehicleGraphicsSlot} != ${mutated.mpVehicleGraphicsSlot}`);
				}
				if (reparsed.mpWheelGraphicsSlot !== mutated.mpWheelGraphicsSlot) {
					problems.push(`wheel slot drift: ${reparsed.mpWheelGraphicsSlot} != ${mutated.mpWheelGraphicsSlot}`);
				}
				return problems;
			},
		},
	],
};
