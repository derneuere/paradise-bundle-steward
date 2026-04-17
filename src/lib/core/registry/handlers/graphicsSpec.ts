// GraphicsSpec registry handler.
//
// Wraps src/lib/core/graphicsSpec.ts. Read-only for now — the resource has
// multiple inline pointer-chained regions (locators, part-volume IDs,
// rigid-body transforms, shattered-glass table) and a writer would need to
// reproduce the exact packing. The viewer already consumes the parsed model
// to resolve body parts; this handler surfaces the same data through the
// CLI and UI pipelines.

import {
	parseGraphicsSpecData,
	GRAPHICS_SPEC_TYPE_ID,
	type ParsedGraphicsSpec,
} from '../../graphicsSpec';
import type { ResourceHandler } from '../handler';

export const graphicsSpecHandler: ResourceHandler<ParsedGraphicsSpec> = {
	typeId: GRAPHICS_SPEC_TYPE_ID,
	key: 'graphicsSpec',
	name: 'GraphicsSpec',
	description: 'Vehicle body-part → Model map with per-part locators and shattered-glass table',
	category: 'Graphics',
	caps: { read: true, write: false },

	parseRaw(raw, ctx) {
		return parseGraphicsSpecData(raw, ctx.littleEndian);
	},
	describe(gs) {
		return `v${gs.version}, ${gs.partsCount} parts, ${gs.shatteredGlassPartsCount} shattered-glass, ${gs.imports.length} imports`;
	},

	fixtures: [
		{ bundle: 'example/VEH_CARBRWDS_GR.BIN', expect: { parseOk: true } },
	],
};
