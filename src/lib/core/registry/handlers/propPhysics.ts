// PropPhysics registry handler — thin wrapper around
// parsePropPhysics / writePropPhysics in src/lib/core/propPhysics.ts.
//
// One resource in the whole game (PROPS/PROPPHYSICS.BUNDLE): the global
// physics catalogue every PropInstanceData placement references by index.
// PropTypeData[i] is the physics of PROP_TYPES[i] (propTypes.ts).

import {
	parsePropPhysics,
	writePropPhysics,
	VOLUME_TYPE,
	type ParsedPropPhysics,
} from '../../propPhysics';
import type { ResourceHandler } from '../handler';

// propTypes[0] (sig_warningchevron) carries 3 own volumes in retail — the
// structural scenarios below lean on that shape.
const STRESS_TYPE = 0;

export const propPhysicsHandler: ResourceHandler<ParsedPropPhysics> = {
	typeId: 0x1000f,
	key: 'propPhysics',
	name: 'Prop Physics',
	description: 'Global prop collision-physics catalogue — per prop type: mass, inertia, lean/move/smash speed thresholds, joint behaviour, collision volumes, and breakable parts. PropInstanceData placements reference entries by index.',
	category: 'Data',
	caps: { read: true, write: true },
	wikiUrl: 'https://burnout.wiki/wiki/Prop_Physics',

	parseRaw(raw, ctx) {
		return parsePropPhysics(raw, ctx.littleEndian);
	},
	writeRaw(model, ctx) {
		return writePropPhysics(model, ctx.littleEndian);
	},
	describe(model) {
		const parts = model.propTypes.reduce((n, t) => n + t.parts.length, 0);
		const vols = model.propTypes.reduce(
			(n, t) => n + t.volumes.length + t.parts.reduce((m, p) => m + p.volumes.length, 0),
			0,
		);
		return `${model.propTypes.length} prop types, ${parts} parts, ${vols} volumes`;
	},

	fixtures: [
		{ bundle: 'example/PROPPHYSICS.BUNDLE', expect: { parseOk: true, byteRoundTrip: true } },
	],

	stressScenarios: [
		{
			name: 'baseline',
			description: 'no mutation — exercises the writer on the read model unchanged',
			mutate: (m) => m,
			verify: (before, after) => {
				const problems: string[] = [];
				if (after.propTypes.length !== before.propTypes.length) {
					problems.push(`prop type count ${after.propTypes.length} != ${before.propTypes.length}`);
				}
				return problems;
			},
		},
		{
			name: 'edit-mass-and-smash',
			description: 'change a prop type\'s mass and smash threshold and verify they survive round-trip',
			mutate: (m) => {
				const propTypes = m.propTypes.slice();
				propTypes[STRESS_TYPE] = { ...propTypes[STRESS_TYPE], mfMass: 123.5, mfSmashThreshold: 42 };
				return { ...m, propTypes };
			},
			verify: (_before, after) => {
				const problems: string[] = [];
				const t = after.propTypes[STRESS_TYPE];
				if (Math.abs(t.mfMass - 123.5) > 1e-4) problems.push(`mfMass = ${t.mfMass}, expected 123.5`);
				if (Math.abs(t.mfSmashThreshold - 42) > 1e-4) problems.push(`mfSmashThreshold = ${t.mfSmashThreshold}, expected 42`);
				return problems;
			},
		},
		{
			name: 'resize-box-volume',
			description: 'grow a box volume\'s half extents and verify the union lanes survive',
			mutate: (m) => {
				const propTypes = m.propTypes.slice();
				const t = { ...propTypes[STRESS_TYPE], volumes: propTypes[STRESS_TYPE].volumes.slice() };
				t.volumes[0] = { ...t.volumes[0], mUnion: [1.5, 2.5, 3.5] };
				propTypes[STRESS_TYPE] = t;
				return { ...m, propTypes };
			},
			verify: (_before, after) => {
				const problems: string[] = [];
				const v = after.propTypes[STRESS_TYPE].volumes[0];
				if (v.vType !== VOLUME_TYPE.BOX) problems.push(`vType = ${v.vType}, expected box`);
				if (Math.abs(v.mUnion[0] - 1.5) > 1e-4 || Math.abs(v.mUnion[1] - 2.5) > 1e-4 || Math.abs(v.mUnion[2] - 3.5) > 1e-4) {
					problems.push(`mUnion = ${v.mUnion}, expected [1.5, 2.5, 3.5]`);
				}
				return problems;
			},
		},
		{
			name: 'remove-last-volume',
			description: 'drop a prop type\'s last volume — counts, pointer tables, and every later record\'s offsets are re-derived',
			mutate: (m) => {
				const propTypes = m.propTypes.slice();
				const t = { ...propTypes[STRESS_TYPE], volumes: propTypes[STRESS_TYPE].volumes.slice(0, -1) };
				propTypes[STRESS_TYPE] = t;
				return { ...m, propTypes };
			},
			verify: (afterMutate, afterReparse) => {
				const problems: string[] = [];
				if (afterReparse.propTypes[STRESS_TYPE].volumes.length !== afterMutate.propTypes[STRESS_TYPE].volumes.length) {
					problems.push(`volume count ${afterReparse.propTypes[STRESS_TYPE].volumes.length} != ${afterMutate.propTypes[STRESS_TYPE].volumes.length}`);
				}
				// The last prop type must still parse identically — its records moved
				// but every pointer was re-derived.
				const last = afterReparse.propTypes.length - 1;
				if (afterReparse.propTypes[last].mResourceId !== afterMutate.propTypes[last].mResourceId) {
					problems.push('trailing prop type corrupted by the shifted layout');
				}
				return problems;
			},
		},
		{
			name: 'clone-volume',
			description: 'append a copy of a volume — the grown layout and tables must reparse cleanly',
			mutate: (m) => {
				const propTypes = m.propTypes.slice();
				const src = propTypes[STRESS_TYPE];
				const clone = { ...src.volumes[0], mTransform: src.volumes[0].mTransform.slice(), mUnion: [...src.volumes[0].mUnion] as [number, number, number] };
				propTypes[STRESS_TYPE] = { ...src, volumes: [...src.volumes, clone] };
				return { ...m, propTypes };
			},
			verify: (afterMutate, afterReparse) => {
				const problems: string[] = [];
				if (afterReparse.propTypes[STRESS_TYPE].volumes.length !== afterMutate.propTypes[STRESS_TYPE].volumes.length) {
					problems.push(`volume count ${afterReparse.propTypes[STRESS_TYPE].volumes.length} != ${afterMutate.propTypes[STRESS_TYPE].volumes.length}`);
				}
				return problems;
			},
		},
	],
};
