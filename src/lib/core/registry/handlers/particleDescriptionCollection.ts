// ParticleDescriptionCollection registry handler — thin wrapper around
// parseParticleDescriptionCollection / writeParticleDescriptionCollection in
// src/lib/core/particleDescriptionCollection.ts.
//
// One collection per particles bundle (no picker needed). Every entry is a
// BND2 import of a ParticleDescription (0x1001D) in the SAME bundle — the
// retail collection covers all 42 of its bundle's descriptions exactly once,
// in authoring order (NOT bundle order; the envelope sorts resources by id).
// Adding/removing entries resizes the inline import table; the bundle
// envelope recomputes its import metadata via importTable() on export.

import {
	parseParticleDescriptionCollection,
	writeParticleDescriptionCollection,
	type ParsedParticleDescriptionCollection,
} from '../../particleDescriptionCollection';
import type { ResourceHandler } from '../handler';

export const particleDescriptionCollectionHandler: ResourceHandler<ParsedParticleDescriptionCollection> = {
	typeId: 0x10008,
	key: 'particleDescriptionCollection',
	name: 'Particle Description Collection',
	description: 'The particles bundle\'s master list — a pointer table holding every ParticleDescription the Lion particle system can spawn, populated at load from the resource\'s inline import table',
	category: 'Graphics',
	caps: { read: true, write: true },
	wikiUrl: 'https://burnout.wiki/wiki/Particle_Description_Collection',
	notes: 'Entry ids are FNV-1a hashes (lowercased) of each description\'s full gamedb URI — ParticleDescription resource ids are FNV-1a, not crc32.',

	parseRaw(raw, ctx) {
		return parseParticleDescriptionCollection(raw, ctx.littleEndian);
	},
	writeRaw(model, ctx) {
		return writeParticleDescriptionCollection(model, ctx.littleEndian);
	},
	importTable(payload, ctx) {
		// One import per table slot, at the payload tail (the parser throws
		// unless the layout is canonical, so a malformed override fails loudly
		// here instead of shipping wrong envelope metadata).
		const model = parseParticleDescriptionCollection(payload, ctx.littleEndian);
		const count = model.descriptions.length;
		return { offset: payload.byteLength - count * 16, count };
	},
	describe(model) {
		return `${model.descriptions.length} particle description${model.descriptions.length === 1 ? '' : 's'}`;
	},

	fixtures: [
		// The import-set ↔ 0x1001D-resource relationship and the FNV-1a id
		// derivation are pinned in __tests__/particleDescriptionCollection.test.ts.
		{ bundle: 'example/PARTICLES.BUNDLE', expect: { parseOk: true, byteRoundTrip: true } },
	],

	stressScenarios: [
		{
			name: 'baseline',
			description: 'no mutation — exercises the writer on the read model unchanged',
			mutate: (m) => m,
			verify: (before, after) =>
				after.descriptions.length === before.descriptions.length
					? []
					: [`description count ${after.descriptions.length} != ${before.descriptions.length}`],
		},
		{
			name: 'retarget-description',
			description: 'point the first slot at a different description id; the import entry must carry it',
			mutate: (m) => {
				const descriptions = m.descriptions.slice();
				descriptions[0] = { mDescriptionId: 0xdeadbeefn };
				return { ...m, descriptions };
			},
			verify: (_before, after) =>
				after.descriptions[0].mDescriptionId === 0xdeadbeefn
					? []
					: [`mDescriptionId 0x${after.descriptions[0].mDescriptionId.toString(16)}, expected 0xdeadbeef`],
		},
		{
			name: 'append-description',
			description: 'append an entry — the slot table, its one-based ordinals, and the import table must all grow consistently',
			mutate: (m) => ({ ...m, descriptions: [...m.descriptions, { mDescriptionId: 0xabcdef01n }] }),
			verify: (afterMutate, afterReparse) => {
				const problems: string[] = [];
				if (afterReparse.descriptions.length !== afterMutate.descriptions.length) {
					problems.push(`description count ${afterReparse.descriptions.length} != ${afterMutate.descriptions.length}`);
				}
				const last = afterReparse.descriptions[afterReparse.descriptions.length - 1];
				if (last.mDescriptionId !== 0xabcdef01n) {
					problems.push(`appended id 0x${last.mDescriptionId.toString(16)} != 0xabcdef01`);
				}
				return problems;
			},
		},
		{
			name: 'remove-last-description',
			description: 'drop the final entry; the layout (and import table) must shrink consistently',
			mutate: (m) => ({ ...m, descriptions: m.descriptions.slice(0, -1) }),
			verify: (afterMutate, afterReparse) =>
				afterReparse.descriptions.length === afterMutate.descriptions.length
					? []
					: [`description count ${afterReparse.descriptions.length} != ${afterMutate.descriptions.length}`],
		},
	],
};
