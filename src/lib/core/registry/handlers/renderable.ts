// Renderable registry handler.
//
// Wraps src/lib/core/renderable.ts. Read-only, no writer planned.
//
// Caveats vs the rest of the registry:
//
//   1. The registry is built around "one model per type per bundle". A car
//      bundle has ~100 Renderables; this handler can only return one. We
//      return the FIRST Renderable's parsed header so the registry tests have
//      something to chew on. The actual viewer (src/pages/RenderablePage.tsx)
//      bypasses this handler entirely and walks every Renderable in the
//      bundle directly via parseRenderable() / getRenderableBlocks().
//
//   2. parseRaw() only sees the raw header bytes — no ResourceEntry, no
//      bundle. That means the in-header import table can't be read at this
//      level (resource.importOffset isn't accessible from raw bytes alone),
//      so the meshes returned here have null materialAssemblyId and null
//      vertexDescriptorIds. That's fine for the describe() summary; the
//      viewer re-parses with imports populated.

import {
	parseRenderable,
	type ParsedRenderable,
	RENDERABLE_TYPE_ID,
} from '../../renderable';
import type { ResourceHandler } from '../handler';

export const renderableHandler: ResourceHandler<ParsedRenderable> = {
	typeId: RENDERABLE_TYPE_ID,
	key: 'renderable',
	name: 'Renderable',
	description: '3D mesh data: index buffer, vertex buffer, and per-mesh draw parameters',
	category: 'Graphics',
	caps: { read: true, write: false },

	parseRaw(raw, _ctx) {
		// Empty imports map: this entry point can't reach the ResourceEntry to
		// read importOffset. The viewer page calls parseRenderable directly with
		// a populated map.
		return parseRenderable(raw, new Map());
	},

	describe(model) {
		const [cx, cy, cz, r] = model.header.boundingSphere;
		return `v${model.header.version}, ${model.meshes.length} meshes, bound (${cx.toFixed(2)}, ${cy.toFixed(2)}, ${cz.toFixed(2)}) r=${r.toFixed(2)}`;
	},

	fixtures: [
		// Smoke test: parseOk only. The first Renderable in this bundle is
		// resource 0x00334801 (P_CA_Sportscar_Body_Bonnet_LOD0), 6 meshes,
		// version 11. byteRoundTrip and stableWriter don't apply (read-only).
		{ bundle: 'example/VEH_CARBRWDS_GR.BIN', expect: { parseOk: true } },
	],
};
