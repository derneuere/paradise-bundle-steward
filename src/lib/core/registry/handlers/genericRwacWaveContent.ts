// GenericRwacWaveContent (0xA020) registry handler — thin wrapper around
// parseGenericRwacWaveContent / writeGenericRwacWaveContent in
// src/lib/core/genericRwacWaveContent.ts.
//
// SOUND/GLOBALWAVES.BUNDLE carries 37 of these in one bundle, so the handler
// ships a picker config. Debug names are gamedb asset URLs
// (gamedb://burnout5/Burnout/Sound/GlobalWaves/<name>.wav.WaveFile?ID=<n>);
// the picker shows just the basename. The wave bytes are an opaque codec
// payload (EALayer3 in retail) — steward edits the header metadata and
// preserves the audio verbatim; re-encoding needs external tools (EALayer3 /
// EA Sound Exchange, see the wiki's modding page).

import {
	parseGenericRwacWaveContent,
	writeGenericRwacWaveContent,
	waveDurationSeconds,
	SNDPLAYER_CODECS,
	SNDPLAYER_PLAY_TYPES,
	type ParsedGenericRwacWaveContent,
} from '../../genericRwacWaveContent';
import type { PickerEntry, ResourceHandler } from '../handler';

/** Basename of a gamedb wave URL — 'gamedb://…/BikeToyCarHorn.wav.WaveFile?ID=805063'
 *  → 'BikeToyCarHorn.wav'. Non-gamedb names pass through unchanged. */
export function waveDisplayName(name: string): string {
	const base = name.split('/').pop() ?? name;
	return base.replace(/\.WaveFile(\?ID=\d+)?$/, '');
}

function codecLabel(codec: number): string {
	return SNDPLAYER_CODECS[codec] ?? `codec ${codec}`;
}

function describeWave(model: ParsedGenericRwacWaveContent): string {
	const dur = waveDurationSeconds(model);
	const loop = model.loopStartSample != null ? `, loop @ sample ${model.loopStartSample}` : '';
	const play = model.playType === 0 ? '' : `, ${SNDPLAYER_PLAY_TYPES[model.playType] ?? '?'}`;
	return `${codecLabel(model.codec)}, ${model.sampleRate} Hz ${model.channels === 1 ? 'mono' : model.channels === 2 ? 'stereo' : `${model.channels}ch`}, `
		+ `${model.numSamples} samples (${dur.toFixed(2)} s), ${model.chunks.length} chunk${model.chunks.length === 1 ? '' : 's'}${loop}${play}`;
}

function compareByName(a: PickerEntry<ParsedGenericRwacWaveContent>, b: PickerEntry<ParsedGenericRwacWaveContent>): number {
	return waveDisplayName(a.ctx.name).localeCompare(waveDisplayName(b.ctx.name), undefined, { numeric: true });
}

export const genericRwacWaveContentHandler: ResourceHandler<ParsedGenericRwacWaveContent> = {
	typeId: 0xa020,
	key: 'genericRwacWaveContent',
	name: 'Generic RWAC Wave Content',
	description: 'One EA SndPlayer wave asset (RWAC = RenderWare Audio Core) — the primary sound container: codec/rate/channel header plus the encoded audio in load-play-unload chunks. Car horns, sirens, and HUD sounds live in GLOBALWAVES',
	category: 'Audio',
	caps: { read: true, write: true },
	wikiUrl: 'https://burnout.wiki/wiki/Wave/Burnout_Paradise',
	notes: 'Header metadata (sample rate, loop point) is editable; the audio itself is an opaque codec payload preserved verbatim — re-encoding needs EALayer3 / EA Sound Exchange. Stream/gigasample waves round-trip as opaque blobs (no fixture validates their chunking).',

	parseRaw(raw, ctx) {
		return parseGenericRwacWaveContent(raw, ctx.littleEndian);
	},
	writeRaw(model, ctx) {
		return writeGenericRwacWaveContent(model, ctx.littleEndian);
	},
	describe(model) {
		return describeWave(model);
	},

	picker: {
		labelOf(model, { name }) {
			const primary = waveDisplayName(name);
			if (model == null) {
				return { primary, secondary: 'parse failed', badges: [{ label: 'parse failed', tone: 'warn' }] };
			}
			const kHz = model.sampleRate >= 1000 ? `${(model.sampleRate / 1000).toFixed(model.sampleRate % 1000 === 0 ? 0 : 1)} kHz` : `${model.sampleRate} Hz`;
			const ch = model.channels === 1 ? 'mono' : model.channels === 2 ? 'stereo' : `${model.channels}ch`;
			return {
				primary,
				secondary: `${kHz} ${ch} · ${waveDurationSeconds(model).toFixed(2)} s · ${codecLabel(model.codec)}`,
				badges: model.loopStartSample != null ? [{ label: 'looped', tone: 'accent' as const }] : undefined,
			};
		},
		sortKeys: [
			{ id: 'name', label: 'Name (A→Z)', compare: compareByName },
			{ id: 'index', label: 'Bundle order', compare: (a, b) => a.ctx.index - b.ctx.index },
			{
				id: 'duration-desc',
				label: 'Duration (long→short)',
				// waveDurationSeconds is 0 for rate 0 and the null-model fallback
				// is -1, so this can never return NaN (picker contract).
				compare: (a, b) =>
					(b.model ? waveDurationSeconds(b.model) : -1) - (a.model ? waveDurationSeconds(a.model) : -1),
			},
		],
		defaultSort: 'name',
		searchText(model, { name }) {
			return `${waveDisplayName(name)} ${model ? codecLabel(model.codec) : ''}`;
		},
	},

	fixtures: [
		// The auto suite only exercises the first wave in bundle order
		// (BikeToyCarHorn — looped, single chunk, garbage pads); all 37,
		// including the four two-chunk loop-split waves, are swept in
		// __tests__/genericRwacWaveContent.test.ts.
		{ bundle: 'example/SOUND/GLOBALWAVES.BUNDLE', expect: { parseOk: true, byteRoundTrip: true } },
	],

	stressScenarios: [
		{
			name: 'baseline',
			description: 'no mutation — exercises the writer on the read model unchanged',
			mutate: (m) => m,
			verify: (before, after) => {
				const problems: string[] = [];
				if (after.codec !== before.codec) problems.push(`codec ${after.codec} != ${before.codec}`);
				if (after.sampleRate !== before.sampleRate) problems.push(`sampleRate ${after.sampleRate} != ${before.sampleRate}`);
				if (after.chunks.length !== before.chunks.length) problems.push(`chunk count ${after.chunks.length} != ${before.chunks.length}`);
				return problems;
			},
		},
		{
			name: 'retune-sample-rate',
			description: 'change the sample rate (pitch shift without re-encoding) and verify it survives round-trip',
			mutate: (m) => ({ ...m, sampleRate: 32000 }),
			verify: (_before, after) =>
				after.sampleRate === 32000 ? [] : [`sampleRate ${after.sampleRate}, expected 32000`],
		},
		{
			name: 'clear-loop',
			description: 'drop the loop point — the header shrinks 4 bytes and the alignment pad is re-derived',
			mutate: (m) => ({ ...m, loopStartSample: null }),
			verify: (afterMutate, afterReparse) => {
				const problems: string[] = [];
				if (afterReparse.loopStartSample !== null) problems.push(`loopStartSample ${afterReparse.loopStartSample}, expected null`);
				if (afterReparse.numSamples !== afterMutate.numSamples) {
					problems.push(`numSamples ${afterReparse.numSamples} != ${afterMutate.numSamples}`);
				}
				return problems;
			},
		},
		{
			name: 'set-loop-start',
			description: 'set a nonzero loop point (adding the optional header field when absent) and verify it survives',
			mutate: (m) => ({ ...m, loopStartSample: 1000 }),
			verify: (_before, after) =>
				after.loopStartSample === 1000 ? [] : [`loopStartSample ${after.loopStartSample}, expected 1000`],
		},
		{
			name: 'swap-chunk-data',
			description: 'replace the first chunk with a different-sized payload — sizes, sample total, and pad must all re-derive',
			mutate: (m) => {
				const chunks = m.chunks.slice();
				chunks[0] = { samples: 123, data: new Uint8Array(257).fill(0xab) };
				return { ...m, chunks };
			},
			verify: (afterMutate, afterReparse) => {
				const problems: string[] = [];
				const c = afterReparse.chunks[0];
				if (c?.samples !== 123) problems.push(`chunks[0].samples ${c?.samples}, expected 123`);
				if (c?.data.byteLength !== 257) problems.push(`chunks[0].data ${c?.data.byteLength} bytes, expected 257`);
				const expected = afterMutate.chunks.reduce((sum, ch) => sum + ch.samples, 0);
				if (afterReparse.numSamples !== expected) {
					problems.push(`numSamples ${afterReparse.numSamples}, expected re-derived ${expected}`);
				}
				return problems;
			},
		},
	],
};
