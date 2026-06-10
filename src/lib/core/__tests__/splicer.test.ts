// Gold coverage for parseSplicer / writeSplicer (resource type 0xA025).
//
// Sweeps all six retail SOUND/SPLICER bundles (one 0xA025 each — verified
// here too, since "samples are embedded, not sibling resources" is a
// load-bearing claim), pins hand-decoded values from BIKESOUNDS (the
// smallest fixture), and pins the cross-fixture invariants the parser's
// asserts and the schema's descriptions rely on.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { parseSplicer, writeSplicer, splicerSampleInfo, type ParsedSplicer } from '../splicer';
import { parseBundle } from '../bundle';
import { extractResourceRaw } from '../registry';
import { splicerHandler } from '../registry/handlers/splicer';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const SPLICER_TYPE_ID = 0xa025;

const FIXTURES = [
	'example/SOUND/SPLICER/AGGDRIVINGSPLICE_ASSET.BUNDLE',
	'example/SOUND/SPLICER/BIKESOUNDS.BUNDLE',
	'example/SOUND/SPLICER/COLLISIONSPLICEBANK.BUNDLE',
	'example/SOUND/SPLICER/FX_SPLICE.BUNDLE',
	'example/SOUND/SPLICER/PASSBYASSET.BUNDLE',
	'example/SOUND/SPLICER/PRESENTATIONASSET.BUNDLE',
];

function loadSplicerRaw(bundleFile: string): Uint8Array {
	const buf = fs.readFileSync(path.resolve(REPO_ROOT, bundleFile));
	const buffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
	const bundle = parseBundle(buffer);
	// Every retail splicer bundle is exactly one 0xA025 — the samples are
	// embedded, so there are no wave-content siblings to find.
	expect(bundle.resources.length, bundleFile).toBe(1);
	expect(bundle.resources[0].resourceTypeId, bundleFile).toBe(SPLICER_TYPE_ID);
	return extractResourceRaw(buffer, bundle, bundle.resources[0]);
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.byteLength !== b.byteLength) return false;
	for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
	return true;
}

function totalRefs(m: ParsedSplicer): number {
	return m.splices.reduce((a, s) => a + s.sampleRefs.length, 0);
}

describe('Splicer gold values (example/SOUND/SPLICER/BIKESOUNDS.BUNDLE)', () => {
	const m = parseSplicer(loadSplicerRaw('example/SOUND/SPLICER/BIKESOUNDS.BUNDLE'));

	it('decodes the splice table', () => {
		expect(m.splices.length).toBe(6);
		expect(totalRefs(m)).toBe(23);
		expect(m.samples.length).toBe(9);
		expect(m.splices.map((s) => s.sampleRefs.length)).toEqual([2, 3, 5, 4, 5, 4]);
		// Splice volumes step on the 2^(n/6) ladder (≈1 dB per step, 6 dB per
		// doubling): 2^(1/6), 2^(7/6), 2^(10/6).
		expect(m.splices[0].Volume).toBe(1.1224620342254639);
		expect(m.splices[2].Volume).toBe(2.2449240684509277);
		expect(m.splices[4].Volume).toBe(3.17480206489563);
		for (const s of m.splices) {
			expect(s.RND_Pitch).toBe(0);
			expect(s.RND_Vol).toBe(1);
		}
	});

	it('decodes splice 0\'s SampleRefs (hand-verified from bytes at 0xAC)', () => {
		const [r0, r1] = m.splices[0].sampleRefs;
		expect(r0.SampleIndex).toBe(7);
		expect(r0.Volume).toBe(2);
		expect(r0.Pitch).toBe(1);
		expect(r0.Offset).toBe(0);
		expect(r0.Az).toBe(0);
		expect(r0.Duration).toBe(0.4155833423137665);
		expect(r0.FadeIn).toBe(0);
		expect(r0.FadeOut).toBe(0);
		expect(r0.RND_Vol).toBe(1);
		expect(r0.RND_Pitch).toBe(-0.15910357236862183);
		expect(r1.SampleIndex).toBe(8);
		expect(r1.Volume).toBe(1.2599210739135742); // 2^(2/6)
		expect(r1.Duration).toBe(0.6626666784286499);
	});

	it('assigns the flat SampleRef array to splices in SpliceIndex order', () => {
		// Splice 1's first two refs are the 3rd and 4th records of the shared
		// array — pitch 2^(-3/12) (three semitones down) on the first.
		const [r0, r1] = m.splices[1].sampleRefs;
		expect(r0.SampleIndex).toBe(6);
		expect(r0.Pitch).toBe(0.8408964276313782);
		expect(r0.RND_Pitch).toBe(-0.13378961384296417);
		expect(r1.SampleIndex).toBe(0);
		expect(r1.Volume).toBe(0.25);
		expect(r1.Duration).toBe(0.44085416197776794);
	});

	it('slices the embedded samples by the TOC', () => {
		expect(m.samples.map((s) => s.byteLength)).toEqual([5979, 2232, 2387, 6463, 4459, 7177, 5452, 5449, 8106]);
		const info = splicerSampleInfo(m.samples[0])!;
		expect(info.codec).toBe(7); // EA-XAS
		expect(info.channels).toBe(1);
		expect(info.sampleRate).toBe(48000);
		expect(info.sampleCount).toBe(21161);
		expect(info.seconds).toBeCloseTo(0.441, 3);
	});
});

describe('Splicer cross-fixture invariants', () => {
	for (const fixture of FIXTURES) {
		it(`${path.basename(fixture)} holds the retail invariants`, () => {
			const m = parseSplicer(loadSplicerRaw(fixture));
			expect(m.splices.length).toBeGreaterThan(0);
			expect(m.samples.length).toBeGreaterThan(0);
			// The wrapper pad is zero in every retail resource.
			expect([...m._wrapperPad]).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
			const usedSamples = new Set<number>();
			for (let i = 0; i < m.splices.length; i++) {
				const s = m.splices[i];
				// SpliceIndex is identity in all retail data — game events bind
				// to splices by this order.
				expect(s.SpliceIndex, `splice ${i}`).toBe(i);
				expect(s.NameHash).toBe(0);
				expect(s.eSpliceType).toBe(0);
				for (const ref of s.sampleRefs) {
					expect(ref.eSpliceType).toBe(0);
					expect(ref._pad03).toBe(0);
					expect(ref.Priority).toBe(0);
					expect(ref.eRollOffType).toBe(0);
					expect(ref._pad2A).toBe(0);
					expect(ref.Duration).toBeGreaterThan(0);
					usedSamples.add(ref.SampleIndex);
				}
			}
			// Every embedded sample is referenced by at least one SampleRef in
			// every retail splicer — no orphans.
			expect(usedSamples.size).toBe(m.samples.length);
			// Every sample decodes as 48 kHz EA-XAS, mono or stereo.
			for (const sample of m.samples) {
				const info = splicerSampleInfo(sample);
				expect(info).not.toBeNull();
				expect(info!.codec).toBe(7);
				expect(info!.sampleRate).toBe(48000);
				expect([1, 2]).toContain(info!.channels);
			}
		});
	}

	it('pins each fixture\'s shape (drift alarm for the fixtures themselves)', () => {
		const shapes = FIXTURES.map((f) => {
			const m = parseSplicer(loadSplicerRaw(f));
			return [m.splices.length, totalRefs(m), m.samples.length];
		});
		expect(shapes).toEqual([
			[31, 61, 15], // AGGDRIVINGSPLICE_ASSET
			[6, 23, 9], // BIKESOUNDS
			[359, 955, 368], // COLLISIONSPLICEBANK
			[9, 16, 11], // FX_SPLICE
			[143, 245, 45], // PASSBYASSET
			[219, 631, 134], // PRESENTATIONASSET
		]);
	});

	it('zero-ref splices exist in retail (CollisionSpliceBank, PresentationAsset)', () => {
		const collision = parseSplicer(loadSplicerRaw('example/SOUND/SPLICER/COLLISIONSPLICEBANK.BUNDLE'));
		expect(collision.splices.filter((s) => s.sampleRefs.length === 0).length).toBe(1);
		const presentation = parseSplicer(loadSplicerRaw('example/SOUND/SPLICER/PRESENTATIONASSET.BUNDLE'));
		expect(presentation.splices.filter((s) => s.sampleRefs.length === 0).length).toBe(2);
		// PresentationAsset's splice 0 is one of them — handler stress
		// scenarios must not assume splices[0] has refs.
		expect(presentation.splices[0].sampleRefs.length).toBe(0);
	});
});

describe('Splicer round-trip', () => {
	for (const fixture of FIXTURES) {
		it(`round-trips ${path.basename(fixture)} byte-for-byte (and idempotently)`, () => {
			const raw = loadSplicerRaw(fixture);
			const write1 = writeSplicer(parseSplicer(raw));
			expect(write1.byteLength).toBe(raw.byteLength);
			expect(bytesEqual(write1, raw)).toBe(true);
			const write2 = writeSplicer(parseSplicer(write1));
			expect(bytesEqual(write2, write1)).toBe(true);
		});
	}

	it('reorders SampleRef batches by SpliceIndex rank when splices are stored permuted', () => {
		const m = parseSplicer(loadSplicerRaw('example/SOUND/SPLICER/BIKESOUNDS.BUNDLE'));
		// Store splice 1 before splice 0 without touching their SpliceIndex.
		const permuted: ParsedSplicer = { ...m, splices: [m.splices[1], m.splices[0], ...m.splices.slice(2)] };
		const reparsed = parseSplicer(writeSplicer(permuted));
		expect(reparsed.splices[0].SpliceIndex).toBe(1);
		expect(reparsed.splices[0].sampleRefs).toEqual(m.splices[1].sampleRefs);
		expect(reparsed.splices[1].SpliceIndex).toBe(0);
		expect(reparsed.splices[1].sampleRefs).toEqual(m.splices[0].sampleRefs);
		// And the permuted layout itself stays byte-stable.
		expect(bytesEqual(writeSplicer(reparsed), writeSplicer(permuted))).toBe(true);
	});

	it('writer rejects a SampleRef pointing past the sample table', () => {
		const m = parseSplicer(loadSplicerRaw('example/SOUND/SPLICER/BIKESOUNDS.BUNDLE'));
		m.splices[0].sampleRefs[0].SampleIndex = m.samples.length;
		expect(() => writeSplicer(m)).toThrow(/references sample/);
	});

	it('writer rejects duplicate SpliceIndex values', () => {
		const m = parseSplicer(loadSplicerRaw('example/SOUND/SPLICER/BIKESOUNDS.BUNDLE'));
		m.splices[1].SpliceIndex = m.splices[0].SpliceIndex;
		expect(() => writeSplicer(m)).toThrow(/duplicate SpliceIndex/);
	});

	it('parser rejects a corrupted version field', () => {
		const raw = new Uint8Array(loadSplicerRaw('example/SOUND/SPLICER/BIKESOUNDS.BUNDLE'));
		raw[0x10] = 2;
		expect(() => parseSplicer(raw)).toThrow(/versionOfData/);
	});
});

// The handler isn't registered yet when this suite is authored, so the
// registry auto-suite can't exercise its fixtures/scenarios — pre-flight them
// here the same way registry.test.ts will (deep clone → mutate → write →
// reparse → verify), across EVERY fixture. PresentationAsset matters most:
// its splice 0 has zero refs, which the ref-editing scenarios must survive.
describe('splicerHandler stress scenarios pre-flight', () => {
	const ctx = { littleEndian: true, platform: 1 };

	it('describe() summarises every fixture', () => {
		for (const fixture of FIXTURES) {
			const model = splicerHandler.parseRaw(loadSplicerRaw(fixture), ctx);
			expect(splicerHandler.describe(model)).toMatch(/\d+ splices, \d+ sample refs, \d+ samples/);
		}
	});

	for (const scenario of splicerHandler.stressScenarios!) {
		it(`scenario '${scenario.name}' verifies on every byteRoundTrip fixture`, () => {
			for (const fixture of FIXTURES) {
				const baseModel = splicerHandler.parseRaw(loadSplicerRaw(fixture), ctx);
				const afterMutate = scenario.mutate(structuredClone(baseModel));
				const written = splicerHandler.writeRaw!(afterMutate, ctx);
				const afterReparse = splicerHandler.parseRaw(written, ctx);
				const problems = scenario.verify ? scenario.verify(afterMutate, afterReparse) : [];
				expect(problems, `${scenario.name} on ${fixture}`).toEqual([]);
			}
		});
	}
});
