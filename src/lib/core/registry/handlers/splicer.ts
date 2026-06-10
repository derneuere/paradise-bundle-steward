// Splicer registry handler — thin wrapper around parseSplicer / writeSplicer
// in src/lib/core/splicer.ts.
//
// Every retail splicer bundle holds exactly ONE 0xA025 resource and nothing
// else — the audio samples live embedded inside the splicer, not in sibling
// wave-content resources — so no picker config and no importTable hook
// (retail importCount is 0 on all six fixtures).

import { parseSplicer, writeSplicer, splicerSampleInfo, type ParsedSplicer } from '../../splicer';
import type { ResourceHandler, StressScenario } from '../handler';

function totalRefs(model: ParsedSplicer): number {
	return model.splices.reduce((a, s) => a + s.sampleRefs.length, 0);
}

/** Index of the first splice that has at least one SampleRef. Scenarios use
 *  it because zero-ref splices exist in retail (CollisionSpliceBank has one,
 *  PresentationAsset two — and PresentationAsset's is splice 0). */
function firstSpliceWithRefs(model: ParsedSplicer): number {
	const i = model.splices.findIndex((s) => s.sampleRefs.length > 0);
	if (i < 0) throw new Error('stress scenario expects at least one splice with SampleRefs');
	return i;
}

const stressScenarios: StressScenario<ParsedSplicer>[] = [
	{
		name: 'baseline',
		description: 'no mutation — exercises the writer on the read model unchanged',
		mutate: (m) => m,
		verify: (before, after) => {
			const problems: string[] = [];
			if (after.splices.length !== before.splices.length) {
				problems.push(`splice count ${after.splices.length} != ${before.splices.length}`);
			}
			if (totalRefs(after) !== totalRefs(before)) {
				problems.push(`ref count ${totalRefs(after)} != ${totalRefs(before)}`);
			}
			if (after.samples.length !== before.samples.length) {
				problems.push(`sample count ${after.samples.length} != ${before.samples.length}`);
			}
			return problems;
		},
	},
	{
		name: 'edit-splice-volume',
		// 2.5 is an exact f32 value, so equality (not closeTo) holds.
		description: 'boost splices[0].Volume and verify it survives round-trip',
		mutate: (m) => {
			m.splices[0] = { ...m.splices[0], Volume: 2.5 };
			return m;
		},
		verify: (_before, after) =>
			after.splices[0].Volume === 2.5 ? [] : [`splices[0].Volume ${after.splices[0].Volume}, expected 2.5`],
	},
	{
		name: 'edit-ref-pitch',
		description: 'retune the first populated splice\'s first SampleRef and verify its untouched neighbour fields survive',
		mutate: (m) => {
			const i = firstSpliceWithRefs(m);
			const refs = m.splices[i].sampleRefs.slice();
			refs[0] = { ...refs[0], Pitch: 0.5, Volume: 1.5 };
			m.splices[i] = { ...m.splices[i], sampleRefs: refs };
			return m;
		},
		verify: (afterMutate, afterReparse) => {
			const i = firstSpliceWithRefs(afterReparse);
			const got = afterReparse.splices[i].sampleRefs[0];
			const problems: string[] = [];
			if (got.Pitch !== 0.5) problems.push(`Pitch ${got.Pitch} != 0.5`);
			if (got.Volume !== 1.5) problems.push(`Volume ${got.Volume} != 1.5`);
			if (got.Duration !== afterMutate.splices[i].sampleRefs[0].Duration) {
				problems.push(`Duration drifted to ${got.Duration}`);
			}
			if (got.SampleIndex !== afterMutate.splices[i].sampleRefs[0].SampleIndex) {
				problems.push(`SampleIndex drifted to ${got.SampleIndex}`);
			}
			return problems;
		},
	},
	{
		name: 'retime-ref',
		description: 'delay and fade the first populated splice\'s first SampleRef (seconds-domain fields)',
		mutate: (m) => {
			const i = firstSpliceWithRefs(m);
			const refs = m.splices[i].sampleRefs.slice();
			refs[0] = { ...refs[0], Offset: 0.25, FadeIn: 0.125, FadeOut: 0.5 };
			m.splices[i] = { ...m.splices[i], sampleRefs: refs };
			return m;
		},
		verify: (_before, after) => {
			const got = after.splices[firstSpliceWithRefs(after)].sampleRefs[0];
			const problems: string[] = [];
			if (got.Offset !== 0.25) problems.push(`Offset ${got.Offset} != 0.25`);
			if (got.FadeIn !== 0.125) problems.push(`FadeIn ${got.FadeIn} != 0.125`);
			if (got.FadeOut !== 0.5) problems.push(`FadeOut ${got.FadeOut} != 0.5`);
			return problems;
		},
	},
	{
		name: 'remove-last-splice',
		// Dropping the LAST splice keeps the remaining SpliceIndex set gap-free
		// in retail (identity indices), and the samples list is untouched — the
		// removed refs just shrink the shared SampleRef array.
		description: 'drop the final splice (with its refs) and verify counts and sample table survive',
		mutate: (m) => {
			m.splices = m.splices.slice(0, -1);
			return m;
		},
		verify: (afterMutate, afterReparse) => {
			const problems: string[] = [];
			if (afterReparse.splices.length !== afterMutate.splices.length) {
				problems.push(`splice count ${afterReparse.splices.length} != ${afterMutate.splices.length}`);
			}
			if (totalRefs(afterReparse) !== totalRefs(afterMutate)) {
				problems.push(`ref count ${totalRefs(afterReparse)} != ${totalRefs(afterMutate)}`);
			}
			if (afterReparse.samples.length !== afterMutate.samples.length) {
				problems.push(`sample count ${afterReparse.samples.length} != ${afterMutate.samples.length}`);
			}
			return problems;
		},
	},
];

export const splicerHandler: ResourceHandler<ParsedSplicer> = {
	typeId: 0xa025,
	key: 'splicer',
	name: 'Splicer',
	description: 'Bank of triggered sounds — each splice plays one or more embedded 48 kHz EA-XAS samples with volume/pitch/delay/fade controls; game events bind to splices by hardcoded order',
	category: 'Audio',
	caps: { read: true, write: true },
	wikiUrl: 'https://burnout.wiki/wiki/Splicer',
	notes: 'Self-contained: the audio sample payloads are embedded in the resource (no imports, no sibling wave resources). Volumes are linear amplitude multipliers; pitches are frequency ratios.',

	parseRaw(raw, ctx) {
		return parseSplicer(raw, ctx.littleEndian);
	},
	writeRaw(model, ctx) {
		return writeSplicer(model, ctx.littleEndian);
	},
	describe(model) {
		const refs = totalRefs(model);
		const seconds = model.samples.reduce((a, s) => a + (splicerSampleInfo(s)?.seconds ?? 0), 0);
		return `${model.splices.length} splices, ${refs} sample refs, ${model.samples.length} samples (${seconds.toFixed(1)} s of audio)`;
	},

	fixtures: [
		{ bundle: 'example/SOUND/SPLICER/AGGDRIVINGSPLICE_ASSET.BUNDLE', expect: { parseOk: true, byteRoundTrip: true } },
		{ bundle: 'example/SOUND/SPLICER/BIKESOUNDS.BUNDLE', expect: { parseOk: true, byteRoundTrip: true } },
		{ bundle: 'example/SOUND/SPLICER/COLLISIONSPLICEBANK.BUNDLE', expect: { parseOk: true, byteRoundTrip: true } },
		{ bundle: 'example/SOUND/SPLICER/FX_SPLICE.BUNDLE', expect: { parseOk: true, byteRoundTrip: true } },
		{ bundle: 'example/SOUND/SPLICER/PASSBYASSET.BUNDLE', expect: { parseOk: true, byteRoundTrip: true } },
		{ bundle: 'example/SOUND/SPLICER/PRESENTATIONASSET.BUNDLE', expect: { parseOk: true, byteRoundTrip: true } },
	],

	stressScenarios,
};
