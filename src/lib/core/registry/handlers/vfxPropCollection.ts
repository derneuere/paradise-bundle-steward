// VFXPropCollection registry handler — thin wrapper around
// parseVFXPropCollection / writeVFXPropCollection in
// src/lib/core/vfxPropCollection.ts.
//
// Exactly ONE retail instance exists (vfx_props_collection in
// PARTICLES.BUNDLE), so no picker config. No importTable hook: the payload
// carries no inline BND2 import table (importCount 0) — every cross-record
// reference is an element index inside this resource, and props are keyed by
// GameDB id rather than resource imports.

import {
	parseVFXPropCollection,
	writeVFXPropCollection,
	VFX_MATERIAL_TYPES,
	type ParsedVFXPropCollection,
} from '../../vfxPropCollection';
import type { ResourceHandler } from '../handler';

export const vfxPropCollectionHandler: ResourceHandler<ParsedVFXPropCollection> = {
	typeId: 0x1001b,
	key: 'vfxPropCollection',
	name: 'VFX Prop Collection',
	description: 'Maps every breakable prop (by GameDB id) to its crash particle effects — per-state VFX materials (metal sparks, wood splinters, …), prop-local emitter locators, and corona light glows with shared flash-timing presets',
	category: 'Graphics',
	caps: { read: true, write: true },
	wikiUrl: 'https://burnout.wiki/wiki/VFX_Prop_Collection',
	notes: 'Cross-record references are element indices grouped into contiguous runs (index + count). Steward edits values in place but does not regroup runs, so adding/removing entries is disabled in the editor.',

	parseRaw(raw, ctx) {
		return parseVFXPropCollection(raw, ctx.littleEndian);
	},
	writeRaw(model, ctx) {
		return writeVFXPropCollection(model, ctx.littleEndian);
	},
	describe(model) {
		return `${model.props.length} props, ${model.propStates.length} states, ${model.materials.length} materials, ${model.locators.length} locators, ${model.coronas.length} coronas (${model.coronaTypeData.length} presets)`;
	},

	fixtures: [
		{ bundle: 'example/PARTICLES.BUNDLE', expect: { parseOk: true, byteRoundTrip: true } },
	],

	stressScenarios: [
		{
			name: 'baseline',
			description: 'no mutation — exercises the writer on the read model unchanged',
			mutate: (m) => m,
			verify: (before, after) => {
				const problems: string[] = [];
				if (after.props.length !== before.props.length) problems.push(`props ${after.props.length} != ${before.props.length}`);
				if (after.locators.length !== before.locators.length) problems.push(`locators ${after.locators.length} != ${before.locators.length}`);
				return problems;
			},
		},
		{
			name: 'retarget-prop-id',
			description: 'point props[0] at a different GameDB id and verify its state run is untouched',
			mutate: (m) => {
				const props = m.props.slice();
				props[0] = { ...props[0], mPropID: 0xdeadbeefn };
				return { ...m, props };
			},
			verify: (afterMutate, afterReparse) => {
				const problems: string[] = [];
				if (afterReparse.props[0].mPropID !== 0xdeadbeefn) problems.push(`mPropID 0x${afterReparse.props[0].mPropID.toString(16)}, expected 0xdeadbeef`);
				if (afterReparse.props[0].muNumPropStates !== afterMutate.props[0].muNumPropStates) {
					problems.push(`muNumPropStates changed to ${afterReparse.props[0].muNumPropStates}`);
				}
				return problems;
			},
		},
		{
			name: 'change-material-type',
			// 5 = Wood; distinct from retail's dominant None (14) and Metal (2), so
			// the change is provably observed.
			description: 'switch materials[0] to the Wood effect set and verify its locator run is untouched',
			mutate: (m) => {
				const materials = m.materials.slice();
				materials[0] = { ...materials[0], mType: 5 };
				return { ...m, materials };
			},
			verify: (afterMutate, afterReparse) => {
				const problems: string[] = [];
				if (afterReparse.materials[0].mType !== 5) {
					problems.push(`mType ${afterReparse.materials[0].mType}, expected 5 (${VFX_MATERIAL_TYPES[5]})`);
				}
				if (afterReparse.materials[0].mpLocators !== afterMutate.materials[0].mpLocators) {
					problems.push(`mpLocators changed to ${afterReparse.materials[0].mpLocators}`);
				}
				return problems;
			},
		},
		{
			name: 'move-locator',
			description: 'translate locators[0] and verify the new prop-local coords and the fixed-width debug name survive',
			mutate: (m) => {
				const locators = m.locators.slice();
				const { x, y, z } = locators[0].mPosition;
				locators[0] = { ...locators[0], mPosition: { x: x + 0.25, y: y + 0.5, z: z - 0.25 } };
				return { ...m, locators };
			},
			verify: (afterMutate, afterReparse) => {
				const problems: string[] = [];
				const a = afterMutate.locators[0];
				const b = afterReparse.locators[0];
				for (const axis of ['x', 'y', 'z'] as const) {
					if (Math.abs(a.mPosition[axis] - b.mPosition[axis]) > 1e-5) problems.push(`pos.${axis} = ${b.mPosition[axis]}, expected ${a.mPosition[axis]}`);
				}
				if (b.macDebugLefName !== a.macDebugLefName) problems.push(`name "${b.macDebugLefName}" != "${a.macDebugLefName}"`);
				return problems;
			},
		},
		{
			name: 'edit-corona-timing',
			description: 'change a corona preset\'s flash timing and sync flag; the bool+pad byte packing must survive',
			mutate: (m) => {
				const coronaTypeData = m.coronaTypeData.slice();
				coronaTypeData[0] = { ...coronaTypeData[0], mrTimeOn: 0.25, mrTimeOff: 0.75, mbSynchronised: true };
				return { ...m, coronaTypeData };
			},
			verify: (_afterMutate, afterReparse) => {
				const problems: string[] = [];
				const d = afterReparse.coronaTypeData[0];
				if (d.mrTimeOn !== 0.25) problems.push(`mrTimeOn ${d.mrTimeOn} != 0.25`);
				if (d.mrTimeOff !== 0.75) problems.push(`mrTimeOff ${d.mrTimeOff} != 0.75`);
				if (d.mbSynchronised !== true) problems.push('mbSynchronised did not survive');
				return problems;
			},
		},
	],
};
