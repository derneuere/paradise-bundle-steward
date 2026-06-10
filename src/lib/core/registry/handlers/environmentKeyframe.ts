// EnvironmentKeyframe registry handler — thin wrapper around
// parseEnvironmentKeyframe / writeEnvironmentKeyframe in
// src/lib/core/environmentSettings.ts.
//
// A season bundle carries MANY keyframes (8–17 across the fixture bundles),
// so the handler ships a picker config. The time of day each keyframe is
// authored for lives only in the debug name's _HHMM suffix
// (ENV_KF_<season>_<location>_<HHMM>) — the resource itself stores no time;
// the EnvironmentTimeLine (0x10013) in the same bundle owns the schedule.

import {
	parseEnvironmentKeyframe,
	writeEnvironmentKeyframe,
	formatTimeOfDay,
	type ParsedEnvironmentKeyframe,
} from '../../environmentSettings';
import type { ResourceHandler, PickerEntry } from '../handler';

/** Seconds of day from the debug name's _HHMM suffix, or null without one. */
function timeOfDayFromName(name: string): number | null {
	const m = name.match(/_(\d{2})(\d{2})$/);
	if (!m) return null;
	return parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60;
}

function compareByName(a: PickerEntry<ParsedEnvironmentKeyframe>, b: PickerEntry<ParsedEnvironmentKeyframe>): number {
	return a.ctx.name.localeCompare(b.ctx.name, undefined, { numeric: true });
}

function fmt3(v: { x: number; y: number; z: number }): string {
	return `(${v.x.toFixed(2)}, ${v.y.toFixed(2)}, ${v.z.toFixed(2)})`;
}

export const environmentKeyframeHandler: ResourceHandler<ParsedEnvironmentKeyframe> = {
	typeId: 0x10012,
	key: 'environmentKeyframe',
	name: 'Environment Keyframe',
	description: 'Snapshot of the environment look at one time of day — bloom, vignette, ColourCube tint, sky/in-scattering colour ramps, the eight-direction fill-light rig, and the two cloud layers; the EnvironmentTimeLine in the same bundle schedules them',
	category: 'Graphics',
	caps: { read: true, write: true },
	wikiUrl: 'https://burnout.wiki/wiki/Environment_Keyframe',
	notes: 'Colours are linear float RGB and go HDR-overbright (lighting fills up to ~3.5 in retail) — values above 1 are intentional, not corruption.',

	parseRaw(raw, ctx) {
		return parseEnvironmentKeyframe(raw, ctx.littleEndian);
	},
	writeRaw(model, ctx) {
		return writeEnvironmentKeyframe(model, ctx.littleEndian);
	},
	importTable(payload, ctx) {
		// Fixed layout: exactly one import (the ColourCube) in the 16-byte tail.
		// Parsing first makes a malformed byte override fail loudly here instead
		// of shipping wrong envelope metadata.
		parseEnvironmentKeyframe(payload, ctx.littleEndian);
		return { offset: payload.byteLength - 16, count: 1 };
	},
	describe(model) {
		return `key light ${fmt3(model.mLightingData.mv3KeyLightColour)}, bloom ${model.mBloomData.mfLuminance.toFixed(2)}/${model.mBloomData.mfThreshold.toFixed(2)}, colour cube 0x${model.mColourCubeId.toString(16).toUpperCase()}`;
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
			const secs = timeOfDayFromName(name);
			return {
				primary: name,
				secondary: `key ${fmt3(model.mLightingData.mv3KeyLightColour)} · bloom ${model.mBloomData.mfLuminance.toFixed(2)}`,
				badges: secs != null ? [{ label: formatTimeOfDay(secs), tone: 'accent' as const }] : undefined,
			};
		},
		sortKeys: [
			{
				id: 'time',
				// Names embed the authored time as _HHMM, so name order IS time
				// order within one season — but this key survives renames and mixed
				// prefixes by parsing the suffix numerically. Suffix-less names sort
				// after timed ones, by name among themselves — the naive
				// (a ?? Infinity) - (b ?? Infinity) form yields NaN for two untimed
				// entries, which the picker contract forbids.
				label: 'Time of day',
				compare: (a, b) => {
					const ta = timeOfDayFromName(a.ctx.name);
					const tb = timeOfDayFromName(b.ctx.name);
					if (ta != null && tb != null) return ta - tb;
					if (ta != null) return -1;
					if (tb != null) return 1;
					return compareByName(a, b);
				},
			},
			{ id: 'name', label: 'Name (A→Z)', compare: compareByName },
			{ id: 'index', label: 'Bundle order', compare: (a, b) => a.ctx.index - b.ctx.index },
		],
		defaultSort: 'time',
	},

	fixtures: [
		// The auto suite only exercises the first keyframe in bundle order; all
		// 17 of SUN_A (plus the timeline↔keyframe import relationship) are
		// covered in __tests__/environmentSettings.test.ts.
		{ bundle: 'example/ENVIRONMENTSETTINGS/000_DLC24HR_FOG_A.BUNDLE', expect: { parseOk: true, byteRoundTrip: true } },
		{ bundle: 'example/ENVIRONMENTSETTINGS/000_DLC24HR_JUNKYARDT.BUNDLE', expect: { parseOk: true, byteRoundTrip: true } },
		{ bundle: 'example/ENVIRONMENTSETTINGS/000_DLC24HR_OC_A.BUNDLE', expect: { parseOk: true, byteRoundTrip: true } },
		{ bundle: 'example/ENVIRONMENTSETTINGS/000_DLC24HR_SUN_A.BUNDLE', expect: { parseOk: true, byteRoundTrip: true } },
	],

	stressScenarios: [
		{
			name: 'baseline',
			description: 'no mutation — exercises the writer on the read model unchanged',
			mutate: (m) => m,
			verify: (before, after) => {
				const problems: string[] = [];
				if (after.mColourCubeId !== before.mColourCubeId) {
					problems.push(`mColourCubeId 0x${after.mColourCubeId.toString(16)} != 0x${before.mColourCubeId.toString(16)}`);
				}
				if (after.mBloomData.mfLuminance !== before.mBloomData.mfLuminance) {
					problems.push(`mfLuminance ${after.mBloomData.mfLuminance} != ${before.mBloomData.mfLuminance}`);
				}
				return problems;
			},
		},
		{
			name: 'edit-key-light',
			// 1.5/0.25/0.125 are exact f32 values, so equality (not closeTo) holds
			// after the round-trip — and 1.5 also proves HDR >1 values survive.
			description: 'recolour the key light (including an HDR >1 channel) and verify it survives round-trip',
			mutate: (m) => ({
				...m,
				mLightingData: { ...m.mLightingData, mv3KeyLightColour: { x: 1.5, y: 0.25, z: 0.125 } },
			}),
			verify: (_before, after) => {
				const got = after.mLightingData.mv3KeyLightColour;
				return got.x === 1.5 && got.y === 0.25 && got.z === 0.125
					? []
					: [`mv3KeyLightColour (${got.x}, ${got.y}, ${got.z}), expected (1.5, 0.25, 0.125)`];
			},
		},
		{
			name: 'edit-bloom',
			description: 'change bloom luminance/threshold and verify the untouched scale vector is not perturbed',
			mutate: (m) => ({
				...m,
				mBloomData: { ...m.mBloomData, mfLuminance: 2.5, mfThreshold: 0.5 },
			}),
			verify: (afterMutate, afterReparse) => {
				const problems: string[] = [];
				if (afterReparse.mBloomData.mfLuminance !== 2.5) problems.push(`mfLuminance ${afterReparse.mBloomData.mfLuminance} != 2.5`);
				if (afterReparse.mBloomData.mfThreshold !== 0.5) problems.push(`mfThreshold ${afterReparse.mBloomData.mfThreshold} != 0.5`);
				if (afterReparse.mBloomData.mv4Scale.x !== afterMutate.mBloomData.mv4Scale.x) {
					problems.push(`mv4Scale.x drifted to ${afterReparse.mBloomData.mv4Scale.x}`);
				}
				return problems;
			},
		},
		{
			name: 'swap-colour-cube',
			description: 'retarget the ColourCube import id and verify it lands back in the inline import entry',
			mutate: (m) => ({ ...m, mColourCubeId: 0xdeadbeefn }),
			verify: (_before, after) =>
				after.mColourCubeId === 0xdeadbeefn ? [] : [`mColourCubeId 0x${after.mColourCubeId.toString(16)}, expected 0xdeadbeef`],
		},
		{
			name: 'edit-cloud-layers',
			description: 'change both cloud layer speeds and the drift angle; the fixed-2 arrays must survive intact',
			mutate: (m) => ({
				...m,
				mCloudsData: { ...m.mCloudsData, mafLayerSpeed: [4, 8], mfDirectionAngle: 90 },
			}),
			verify: (_before, after) => {
				const problems: string[] = [];
				const { mafLayerSpeed, mfDirectionAngle } = after.mCloudsData;
				if (mafLayerSpeed.length !== 2 || mafLayerSpeed[0] !== 4 || mafLayerSpeed[1] !== 8) {
					problems.push(`mafLayerSpeed [${mafLayerSpeed.join(', ')}], expected [4, 8]`);
				}
				if (mfDirectionAngle !== 90) problems.push(`mfDirectionAngle ${mfDirectionAngle} != 90`);
				return problems;
			},
		},
	],
};
