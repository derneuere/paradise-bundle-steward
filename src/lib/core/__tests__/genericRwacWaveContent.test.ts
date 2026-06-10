// Gold coverage for parseGenericRwacWaveContent / writeGenericRwacWaveContent.
//
// SOUND/GLOBALWAVES.BUNDLE carries 37 waves but the auto-generated registry
// fixture suite only exercises the first resource of a type per bundle — so
// this suite walks ALL 37, pins hand-verified decoded values, and pins the
// spec-vs-bytes findings (chunk byte counts include their 8-byte header,
// loop points split chunks, garbage pad bytes survive verbatim).

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
	parseGenericRwacWaveContent,
	writeGenericRwacWaveContent,
	waveDurationSeconds,
	SNDPLAYER_PLAY_TYPE,
} from '../genericRwacWaveContent';
import { waveDisplayName, genericRwacWaveContentHandler } from '../registry/handlers/genericRwacWaveContent';
import { parseBundle } from '../bundle';
import { parseDebugDataFromXml, findDebugResourceById } from '../bundle/debugData';
import { extractResourceRaw } from '../registry';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const WAVE_TYPE_ID = 0xa020;
const BUNDLE_FIXTURE = 'example/SOUND/GLOBALWAVES.BUNDLE';

type ExtractedWave = { name: string; raw: Uint8Array };

function loadWaves(bundleFile: string): ExtractedWave[] {
	const buf = fs.readFileSync(path.resolve(REPO_ROOT, bundleFile));
	const buffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
	const bundle = parseBundle(buffer);
	const debugResources = typeof bundle.debugData === 'string'
		? parseDebugDataFromXml(bundle.debugData)
		: [];
	return bundle.resources
		.filter((r) => r.resourceTypeId === WAVE_TYPE_ID)
		.map((r) => ({
			name: findDebugResourceById(debugResources, r.resourceId.low.toString(16))?.name ?? '?',
			raw: new Uint8Array(extractResourceRaw(buffer, bundle, r)),
		}));
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.byteLength !== b.byteLength) return false;
	for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
	return true;
}

const waves = loadWaves(BUNDLE_FIXTURE);
const byName = (stem: string) => {
	const hit = waves.find((w) => waveDisplayName(w.name) === stem);
	if (!hit) throw new Error(`fixture wave ${stem} not found`);
	return hit;
};

describe('GenericRwacWaveContent gold values (example/SOUND/GLOBALWAVES.BUNDLE)', () => {
	it('finds all 37 waves, BikeToyCarHorn first in bundle order', () => {
		expect(waves.length).toBe(37);
		expect(waveDisplayName(waves[0].name)).toBe('BikeToyCarHorn.wav');
	});

	it('decodes BikeToyCarHorn (looped mono horn with garbage pads)', () => {
		const m = parseGenericRwacWaveContent(byName('BikeToyCarHorn.wav').raw);
		expect(m.version).toBe(0);
		expect(m.codec).toBe(5); // SNDPLAYER_CODEC_EALAYER31_INT
		expect(m.channels).toBe(1);
		expect(m.sampleRate).toBe(48000);
		expect(m.playType).toBe(SNDPLAYER_PLAY_TYPE.RAM);
		expect(m.loopStartSample).toBe(0);
		expect(m.gigaResidentSamples).toBeNull();
		expect(m.numSamples).toBe(4890);
		expect(m.chunks.length).toBe(1);
		// On-disk chunk byte count (1855) INCLUDES its 8-byte header — the model
		// keeps only the codec payload.
		expect(m.chunks[0].data.byteLength).toBe(1855 - 8);
		expect(m.chunks[0].samples).toBe(4890);
		// Stale heap garbage leaked into the wrapper pad ("ation\Cg" — a path
		// fragment from the build machine) and the alignment tail. Pin both so
		// a "cleanup" that zeroes them breaks loudly.
		expect(Array.from(m._binPad)).toEqual([0x61, 0x74, 0x69, 0x6f, 0x6e, 0x5c, 0x43, 0x67]);
		expect(m._trailingPad.byteLength).toBe(5);
		expect(m._trailingPad.some((b) => b !== 0)).toBe(true);
	});

	it('decodes HUD_counter_crit (stereo, loop point splits the chunks)', () => {
		const m = parseGenericRwacWaveContent(byName('HUD_counter_crit.wav').raw);
		expect(m.channels).toBe(2);
		expect(m.sampleRate).toBe(48000);
		expect(m.loopStartSample).toBe(23056);
		expect(m.numSamples).toBe(34260);
		expect(m.chunks.length).toBe(2);
		expect(m.chunks[0].samples).toBe(23056);
		expect(m.chunks[1].samples).toBe(34260 - 23056);
		expect(m.chunks[0].data.byteLength).toBe(15980 - 8);
		expect(m.chunks[1].data.byteLength).toBe(7228 - 8);
	});

	it('decodes B2FDeLorean_Down (one-shot — no loop field in the header)', () => {
		const m = parseGenericRwacWaveContent(byName('B2FDeLorean_Down.wav').raw);
		expect(m.loopStartSample).toBeNull();
		expect(m.numSamples).toBe(103681);
		expect(m.chunks.length).toBe(1);
		expect(waveDurationSeconds(m)).toBeCloseTo(103681 / 48000, 5);
	});

	it('pins the retail population: all EALayer3 v1 RAM waves, known rate/channel mix', () => {
		const models = waves.map((w) => parseGenericRwacWaveContent(w.raw));
		expect(models.every((m) => m.version === 0)).toBe(true);
		expect(models.every((m) => m.codec === 5)).toBe(true);
		expect(models.every((m) => m.playType === SNDPLAYER_PLAY_TYPE.RAM)).toBe(true);
		expect(models.every((m) => m.gigaResidentSamples === null)).toBe(true);
		expect(models.every((m) => m._unchunkedData === null)).toBe(true);
		expect(models.filter((m) => m.channels === 2).length).toBe(8);
		expect(models.filter((m) => m.channels === 1).length).toBe(29);
		const rates = new Map<number, number>();
		for (const m of models) rates.set(m.sampleRate, (rates.get(m.sampleRate) ?? 0) + 1);
		expect(rates).toEqual(new Map([[48000, 31], [44100, 2], [22050, 4]]));
		expect(models.filter((m) => m.loopStartSample != null).length).toBe(24);
	});

	it('multi-chunk waves exist exactly where the loop starts mid-asset, split at the loop sample', () => {
		const multi = waves
			.map((w) => ({ name: waveDisplayName(w.name), m: parseGenericRwacWaveContent(w.raw) }))
			.filter(({ m }) => m.chunks.length > 1);
		expect(multi.map(({ name }) => name).sort()).toEqual([
			'B2FDeLorean_Up.wav',
			'B2FDeLorean_UpToy.wav',
			'EctoSiren.wav',
			'HUD_counter_crit.wav',
		]);
		for (const { name, m } of multi) {
			expect(m.chunks.length, name).toBe(2);
			// The decoder can only restart a loop on a chunk boundary, so the
			// first chunk ends exactly at the loop start sample.
			expect(m.chunks[0].samples, name).toBe(m.loopStartSample);
		}
		// And the converse: every single-chunk loop starts at sample 0.
		for (const w of waves) {
			const m = parseGenericRwacWaveContent(w.raw);
			if (m.chunks.length === 1 && m.loopStartSample != null) {
				expect(m.loopStartSample, waveDisplayName(w.name)).toBe(0);
			}
		}
	});

	it('chunk samples always sum to the header total', () => {
		for (const w of waves) {
			const m = parseGenericRwacWaveContent(w.raw);
			const sum = m.chunks.reduce((acc, c) => acc + c.samples, 0);
			expect(sum, waveDisplayName(w.name)).toBe(m.numSamples);
		}
	});

	it('four waves carry uninitialised (non-zero) trailing pad bytes', () => {
		const garbage = waves
			.map((w) => ({ name: waveDisplayName(w.name), m: parseGenericRwacWaveContent(w.raw) }))
			.filter(({ m }) => m._trailingPad.some((b) => b !== 0))
			.map(({ name }) => name)
			.sort();
		expect(garbage).toEqual([
			'BikeToyCarHorn.wav',
			'CarsInfToyCarHorn.wav',
			'ConGTToyCarHorn.wav',
			'StuntScoreCounter.wav',
		]);
	});
});

describe('GenericRwacWaveContent round-trip', () => {
	it('round-trips all 37 waves byte-for-byte, idempotently', () => {
		for (const { name, raw } of waves) {
			const label = waveDisplayName(name);
			const once = writeGenericRwacWaveContent(parseGenericRwacWaveContent(raw));
			expect(once.byteLength, label).toBe(raw.byteLength);
			expect(bytesEqual(once, raw), label).toBe(true);
			const twice = writeGenericRwacWaveContent(parseGenericRwacWaveContent(once));
			expect(bytesEqual(twice, once), label).toBe(true);
		}
	});

	it('re-derives sizes, sample total, and pad after a chunk edit', () => {
		const m = parseGenericRwacWaveContent(byName('HUD_counter_crit.wav').raw);
		const edited = { ...m, chunks: [m.chunks[0]] };
		const written = writeGenericRwacWaveContent(edited);
		expect(written.byteLength % 16).toBe(0);
		const reparsed = parseGenericRwacWaveContent(written);
		expect(reparsed.numSamples).toBe(m.chunks[0].samples);
		expect(reparsed.chunks.length).toBe(1);
		expect(bytesEqual(writeGenericRwacWaveContent(reparsed), written)).toBe(true);
	});

	it('drops a garbage pad whose length no longer fits, replacing it with zeros', () => {
		const m = parseGenericRwacWaveContent(byName('BikeToyCarHorn.wav').raw);
		// Clearing the loop shrinks the header by 4, so the captured 5-byte
		// garbage pad can't be reused; the writer must still 16-align.
		const written = writeGenericRwacWaveContent({ ...m, loopStartSample: null });
		expect(written.byteLength % 16).toBe(0);
		const reparsed = parseGenericRwacWaveContent(written);
		expect(reparsed.loopStartSample).toBeNull();
		expect(reparsed.numSamples).toBe(m.numSamples);
		expect(reparsed._trailingPad.every((b) => b === 0)).toBe(true);
	});

	it('parser rejects a wrong data offset', () => {
		const raw = new Uint8Array(byName('BikeToyCarHorn.wav').raw);
		raw[4] = 0x18;
		expect(() => parseGenericRwacWaveContent(raw)).toThrow(/mu32DataOffset/);
	});

	it('parser rejects a data size inconsistent with the resource length', () => {
		const raw = new Uint8Array(byName('BikeToyCarHorn.wav').raw);
		raw[0] = raw[0] + 1;
		expect(() => parseGenericRwacWaveContent(raw)).toThrow(/mu32DataSize/);
	});

	it('parser rejects a truncated chunk', () => {
		const raw = new Uint8Array(byName('BikeToyCarHorn.wav').raw).slice(0, 0x100);
		raw[0] = 0xf0; raw[1] = 0x00; raw[2] = 0x00; raw[3] = 0x00; // dataSize 0xF0
		expect(() => parseGenericRwacWaveContent(raw)).toThrow(/overruns|ran out/);
	});

	it('writer rejects out-of-range header fields', () => {
		const m = parseGenericRwacWaveContent(byName('BikeToyCarHorn.wav').raw);
		expect(() => writeGenericRwacWaveContent({ ...m, sampleRate: 0x40000 })).toThrow(/sample rate/);
		expect(() => writeGenericRwacWaveContent({ ...m, channels: 0 })).toThrow(/channels/);
		expect(() => writeGenericRwacWaveContent({ ...m, codec: 16 })).toThrow(/codec/);
		expect(() => writeGenericRwacWaveContent({ ...m, gigaResidentSamples: 5 })).toThrow(/gigasample/);
	});
});

describe('genericRwacWaveContentHandler', () => {
	it('describes a wave in one line', () => {
		const m = parseGenericRwacWaveContent(byName('HUD_counter_crit.wav').raw);
		const line = genericRwacWaveContentHandler.describe(m);
		expect(line).toContain('EALayer3 v1');
		expect(line).toContain('48000 Hz stereo');
		expect(line).toContain('2 chunks');
		expect(line).toContain('loop @ sample 23056');
	});

	it('picker labels strip the gamedb URL and never sort to NaN', () => {
		expect(waveDisplayName('gamedb://burnout5/Burnout/Sound/GlobalWaves/BikeToyCarHorn.wav.WaveFile?ID=805063'))
			.toBe('BikeToyCarHorn.wav');
		expect(waveDisplayName('Resource_12345678')).toBe('Resource_12345678');
		const picker = genericRwacWaveContentHandler.picker!;
		const entries = [
			{ model: parseGenericRwacWaveContent(waves[0].raw), ctx: { id: '0x1', name: waves[0].name, index: 0 } },
			{ model: null, ctx: { id: '0x2', name: 'Resource_2', index: 1 } },
		];
		for (const key of picker.sortKeys) {
			const v = key.compare(entries[0], entries[1]);
			expect(Number.isNaN(v), key.id).toBe(false);
		}
		const label = picker.labelOf(entries[0].model, entries[0].ctx);
		expect(label.primary).toBe('BikeToyCarHorn.wav');
		expect(label.badges?.[0]?.label).toBe('looped');
	});
});
