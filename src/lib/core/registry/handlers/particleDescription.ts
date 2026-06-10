// ParticleDescription registry handler — thin wrapper around
// parseParticleDescription / writeParticleDescription in
// src/lib/core/particleDescription.ts.
//
// PARTICLES.BUNDLE carries 42 of these (one per Lion effect: boost flames,
// crash debris, exhaust smoke, ...), so the handler ships a picker config.
// The debug name is the full gamedb:// URI; the parsed model carries the
// shorter authored name ("Prop_Foilage.lef") surfaced as picker secondary
// text and search input.
//
// NO importTable hook on purpose: every retail 0x1001D resource has
// importCount 0 — materials reference textures/meshes by name string, not
// through the BND2 import table.

import {
	parseParticleDescription,
	writeParticleDescription,
	type ParsedParticleDescription,
} from '../../particleDescription';
import type { ResourceHandler, PickerEntry } from '../handler';

// eDO_DISABLED — turning an emitter off is the safest interesting flag edit.
const FLAG_DISABLED = 0x8000;

function compareByName(a: PickerEntry<ParsedParticleDescription>, b: PickerEntry<ParsedParticleDescription>): number {
	return a.ctx.name.localeCompare(b.ctx.name, undefined, { numeric: true });
}

function behaviourCount(model: ParsedParticleDescription): number {
	return model.descriptors.reduce((n, d) => n + d.behaviours.length, 0);
}

export const particleDescriptionHandler: ResourceHandler<ParsedParticleDescription> = {
	typeId: 0x1001d,
	key: 'particleDescription',
	name: 'Particle Description',
	description: 'One Lion particle effect — a chain of emitter descriptors, each with timing/shape settings, 1–2 motion/colour behaviours, and a material naming the texture and blend state',
	category: 'Graphics',
	caps: { read: true, write: true },
	wikiUrl: 'https://burnout.wiki/wiki/Particle_Description',
	notes: 'Resource IDs are FNV-1a hashes of the gamedb:// URI, not CgsID CRC32s. Behaviour AABBs and several mID fields are uninitialised memory in retail — junk values there are normal, not corruption.',

	parseRaw(raw, ctx) {
		return parseParticleDescription(raw, ctx.littleEndian);
	},
	writeRaw(model, ctx) {
		return writeParticleDescription(model, ctx.littleEndian);
	},
	describe(model) {
		return `effect "${model.name}", ${model.descriptors.length} descriptor${model.descriptors.length === 1 ? '' : 's'}, ${behaviourCount(model)} behaviours`;
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
			const disabled = model.descriptors.every((d) => (d.mFlags & FLAG_DISABLED) !== 0) && model.descriptors.length > 0;
			return {
				primary: name,
				secondary: `${model.name} · ${model.descriptors.length} emitter${model.descriptors.length === 1 ? '' : 's'} · ${behaviourCount(model)} behaviours`,
				badges: disabled ? [{ label: 'disabled', tone: 'muted' as const }] : undefined,
			};
		},
		searchText(model, { name }) {
			return model == null ? name : `${name} ${model.name}`;
		},
		sortKeys: [
			{ id: 'name', label: 'Name (A→Z)', compare: compareByName },
			{ id: 'index', label: 'Bundle order', compare: (a, b) => a.ctx.index - b.ctx.index },
			{
				id: 'descriptors-desc',
				label: 'Emitter count (high→low)',
				compare: (a, b) => (b.model?.descriptors.length ?? -1) - (a.model?.descriptors.length ?? -1),
			},
		],
		defaultSort: 'name',
	},

	fixtures: [
		// The auto suite only exercises the first of the 42 resources
		// (Prop_Foilage); all 42 round-trip byte-exact in
		// __tests__/particleDescription.test.ts.
		{ bundle: 'example/PARTICLES.BUNDLE', expect: { parseOk: true, byteRoundTrip: true } },
	],

	stressScenarios: [
		{
			name: 'baseline',
			description: 'no mutation — exercises the writer on the read model unchanged',
			mutate: (m) => m,
			verify: (before, after) => {
				const problems: string[] = [];
				if (after.name !== before.name) problems.push(`name "${after.name}" != "${before.name}"`);
				if (after.descriptors.length !== before.descriptors.length) {
					problems.push(`descriptor count ${after.descriptors.length} != ${before.descriptors.length}`);
				}
				return problems;
			},
		},
		{
			name: 'edit-emission',
			// 24 and 0.75 are exact f32 values, so equality holds after round-trip.
			description: 'change emission rate and particle life on the first behaviour',
			mutate: (m) => {
				const descriptors = m.descriptors.slice();
				const behaviours = descriptors[0].behaviours.slice();
				behaviours[0] = { ...behaviours[0], mEmissionRateBase: 24, mLifeBase: 0.75 };
				descriptors[0] = { ...descriptors[0], behaviours };
				return { ...m, descriptors };
			},
			verify: (_before, after) => {
				const b = after.descriptors[0].behaviours[0];
				const problems: string[] = [];
				if (b.mEmissionRateBase !== 24) problems.push(`mEmissionRateBase ${b.mEmissionRateBase} != 24`);
				if (b.mLifeBase !== 0.75) problems.push(`mLifeBase ${b.mLifeBase} != 0.75`);
				return problems;
			},
		},
		{
			name: 'rename-emitter',
			description: 'rename descriptors[0] — string-pool length changes, so every later pool pointer must be recomputed',
			mutate: (m) => {
				const descriptors = m.descriptors.slice();
				descriptors[0] = { ...descriptors[0], name: 'STEWARDDUSTPUFF' };
				return { ...m, descriptors };
			},
			verify: (afterMutate, afterReparse) => {
				const problems: string[] = [];
				if (afterReparse.descriptors[0].name !== 'STEWARDDUSTPUFF') {
					problems.push(`descriptors[0].name "${afterReparse.descriptors[0].name}"`);
				}
				// A later string must survive the shifted pool.
				const last = afterReparse.descriptors[afterReparse.descriptors.length - 1];
				const lastBefore = afterMutate.descriptors[afterMutate.descriptors.length - 1];
				if (last.material.textureName !== lastBefore.material.textureName) {
					problems.push(`last texture "${last.material.textureName}" != "${lastBefore.material.textureName}"`);
				}
				return problems;
			},
		},
		{
			name: 'disable-emitter',
			description: 'set eDO_DISABLED on descriptors[0] and verify the other flag bits are untouched',
			mutate: (m) => {
				const descriptors = m.descriptors.slice();
				descriptors[0] = { ...descriptors[0], mFlags: descriptors[0].mFlags | FLAG_DISABLED };
				return { ...m, descriptors };
			},
			verify: (afterMutate, afterReparse) => {
				const got = afterReparse.descriptors[0].mFlags;
				return got === afterMutate.descriptors[0].mFlags ? [] : [`mFlags 0x${got.toString(16)}`];
			},
		},
		{
			name: 'retexture',
			description: 'point the first material at a new texture name (different length than the original)',
			mutate: (m) => {
				const descriptors = m.descriptors.slice();
				descriptors[0] = {
					...descriptors[0],
					material: { ...descriptors[0].material, textureName: 'STEWARDTESTTEX' },
				};
				return { ...m, descriptors };
			},
			verify: (_before, after) =>
				after.descriptors[0].material.textureName === 'STEWARDTESTTEX'
					? []
					: [`textureName "${after.descriptors[0].material.textureName}"`],
		},
	],
};
