// VFXMeshCollection registry handler — thin wrapper around
// parseVFXMeshCollection / writeVFXMeshCollection in
// src/lib/core/vfxMeshCollection.ts.
//
// PARTICLES.BUNDLE carries THREE of these (highres_debris_02.rf3,
// lowres_debris.rf3, Glass_debris.rf3), so the handler ships a picker config.
// No importTable hook: the retail resources carry no inline BND2 import table
// (importCount 0) — the material is referenced by texture NAME, and the mesh
// geometry lives in the resource's own secondary-memory block.

import {
	parseVFXMeshCollection,
	writeVFXMeshCollection,
	type ParsedVFXMeshCollection,
} from '../../vfxMeshCollection';
import type { ResourceHandler, PickerEntry } from '../handler';

function compareByName(a: PickerEntry<ParsedVFXMeshCollection>, b: PickerEntry<ParsedVFXMeshCollection>): number {
	return a.ctx.name.localeCompare(b.ctx.name, undefined, { numeric: true });
}

export const vfxMeshCollectionHandler: ResourceHandler<ParsedVFXMeshCollection> = {
	typeId: 0x10019,
	key: 'vfxMeshCollection',
	name: 'VFX Mesh Collection',
	description: 'Particle debris meshes the VFX system spawns during crashes — a 32-slot per-mesh radius table, a texture-name material reference, and index/vertex buffer descriptors into the resource\'s secondary-memory geometry block',
	category: 'Graphics',
	caps: { read: true, write: true },
	wikiUrl: 'https://burnout.wiki/wiki/VFX_Mesh_Collection',
	notes: 'The wiki lists the type id as 0x100019; the retail PC id is 0x10019. Geometry bytes live in block 1 (secondary memory) and are not editable here — only the descriptors that point into them.',

	parseRaw(raw, ctx) {
		return parseVFXMeshCollection(raw, ctx.littleEndian);
	},
	writeRaw(model, ctx) {
		return writeVFXMeshCollection(model, ctx.littleEndian);
	},
	describe(model) {
		return `texture "${model.textureName}", ${model.muNumVertices} verts / ${model.muNumIndices} indices, ${model.indexBuffers.length}+${model.vertexBuffers.length} buffers`;
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
			return {
				primary: name,
				secondary: `${model.muNumVertices.toLocaleString()} verts · ${model.muNumIndices.toLocaleString()} indices`,
				badges: [{ label: model.textureName, tone: 'accent' }],
			};
		},
		sortKeys: [
			{ id: 'name', label: 'Name (A→Z)', compare: compareByName },
			{ id: 'index', label: 'Bundle order', compare: (a, b) => a.ctx.index - b.ctx.index },
			{
				id: 'verts-desc',
				label: 'Vertex count (high→low)',
				compare: (a, b) => (b.model?.muNumVertices ?? -1) - (a.model?.muNumVertices ?? -1),
			},
		],
		defaultSort: 'name',
	},

	fixtures: [
		// The auto suite only exercises the first collection in bundle order; all
		// three (and the radius-cycle data facts) are covered in
		// __tests__/vfxMeshCollection.test.ts.
		{ bundle: 'example/PARTICLES.BUNDLE', expect: { parseOk: true, byteRoundTrip: true } },
	],

	stressScenarios: [
		{
			name: 'baseline',
			description: 'no mutation — exercises the writer on the read model unchanged',
			mutate: (m) => m,
			verify: (before, after) => {
				const problems: string[] = [];
				if (after.textureName !== before.textureName) problems.push(`textureName "${after.textureName}" != "${before.textureName}"`);
				if (after.muNumVertices !== before.muNumVertices) problems.push(`muNumVertices ${after.muNumVertices} != ${before.muNumVertices}`);
				return problems;
			},
		},
		{
			name: 'edit-radius',
			// 2.5 is an exact f32 value, so equality (not closeTo) holds.
			description: 'change radius slot 0 and verify slot 1 is not perturbed',
			mutate: (m) => {
				const mafRadius = m.mafRadius.slice();
				mafRadius[0] = 2.5;
				return { ...m, mafRadius };
			},
			verify: (afterMutate, afterReparse) => {
				const problems: string[] = [];
				if (afterReparse.mafRadius[0] !== 2.5) problems.push(`mafRadius[0] = ${afterReparse.mafRadius[0]}, expected 2.5`);
				if (afterReparse.mafRadius[1] !== afterMutate.mafRadius[1]) problems.push(`mafRadius[1] drifted to ${afterReparse.mafRadius[1]}`);
				return problems;
			},
		},
		{
			name: 'rename-texture',
			// A longer name moves mpMeshHelper and every buffer pointer — proves the
			// writer recomputes the variable-length layout instead of copying offsets.
			description: 'retarget the material to a longer texture name and verify the buffer descriptors survive the layout shift',
			mutate: (m) => ({ ...m, textureName: 'steward_stress_texture' }),
			verify: (afterMutate, afterReparse) => {
				const problems: string[] = [];
				if (afterReparse.textureName !== 'steward_stress_texture') problems.push(`textureName "${afterReparse.textureName}"`);
				if (afterReparse.indexBuffers.length !== afterMutate.indexBuffers.length) {
					problems.push(`indexBuffers ${afterReparse.indexBuffers.length} != ${afterMutate.indexBuffers.length}`);
				}
				const a = afterMutate.indexBuffers[0];
				const b = afterReparse.indexBuffers[0];
				if (a && b && (a.muByteLength !== b.muByteLength || a.muStride !== b.muStride)) {
					problems.push(`indexBuffers[0] ${b.muByteLength}/${b.muStride}, expected ${a.muByteLength}/${a.muStride}`);
				}
				return problems;
			},
		},
		{
			name: 'shorten-texture-name',
			description: 'shrink the texture name and verify the resource shrinks consistently (round-trip through the smaller layout)',
			mutate: (m) => ({ ...m, textureName: 'W' }),
			verify: (_afterMutate, afterReparse) =>
				afterReparse.textureName === 'W' ? [] : [`textureName "${afterReparse.textureName}", expected "W"`],
		},
	],
};
