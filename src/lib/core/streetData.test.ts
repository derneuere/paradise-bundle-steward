// Round-trip tests for StreetData parser+writer using the BTTSTREETDATA.DAT
// fixture committed under example/. These pin the expected counts and the
// re-encoded sha1 so the TS port stays in lockstep with the C# writer.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';

import { parseBundle } from './bundle';
import { RESOURCE_TYPE_IDS } from './types';
import { extractResourceSize, isCompressed, decompressData } from './resourceManager';
import { parseStreetData, parseStreetDataData, writeStreetData, writeStreetDataData } from './streetData';

const FIXTURE = path.resolve(__dirname, '../../../example/BTTSTREETDATA.DAT');

function sha1(bytes: Uint8Array): string {
	return createHash('sha1').update(bytes).digest('hex');
}

function loadBundle(): { buffer: ArrayBuffer } {
	const raw = fs.readFileSync(FIXTURE);
	const bytes = new Uint8Array(raw.byteLength);
	bytes.set(raw);
	return { buffer: bytes.buffer };
}

function extractStreetDataRaw(buffer: ArrayBuffer): Uint8Array {
	const bundle = parseBundle(buffer);
	const resource = bundle.resources.find((r) => r.resourceTypeId === RESOURCE_TYPE_IDS.STREET_DATA);
	if (!resource) throw new Error('Fixture missing StreetData resource');
	for (let bi = 0; bi < 3; bi++) {
		const size = extractResourceSize(resource.sizeAndAlignmentOnDisk[bi]);
		if (size <= 0) continue;
		const base = bundle.header.resourceDataOffsets[bi] >>> 0;
		const rel = resource.diskOffsets[bi] >>> 0;
		const start = (base + rel) >>> 0;
		let slice: Uint8Array<ArrayBuffer> = new Uint8Array(buffer.slice(start, start + size));
		if (isCompressed(slice)) slice = decompressData(slice) as Uint8Array<ArrayBuffer>;
		return slice;
	}
	throw new Error('StreetData resource had no populated block');
}

describe('streetData parser', () => {
	it('parses BTTSTREETDATA.DAT with the expected counts', () => {
		const { buffer } = loadBundle();
		const raw = extractStreetDataRaw(buffer);

		expect(raw.byteLength).toBe(29584);
		expect(sha1(raw)).toBe('9be20668da1bd69e1ac483018b5d7a7736f3e936');

		const sd = parseStreetDataData(raw);
		expect(sd.miVersion).toBe(6);
		expect(sd.streets).toHaveLength(310);
		expect(sd.junctions).toHaveLength(217);
		expect(sd.roads).toHaveLength(76);
		expect(sd.challenges).toHaveLength(76);

		expect(sd.mpaStreets).toBe(0x30);
		expect(sd.mpaJunctions).toBe(0x1390);
		expect(sd.mpaRoads).toBe(0x3220);
		expect(sd.mpaChallengeParScores).toBe(0x4780);
	});
});

describe('streetData writer', () => {
	it('re-encodes BTTSTREETDATA.DAT byte-for-byte identical to the C# tool output', () => {
		const { buffer } = loadBundle();
		const raw = extractStreetDataRaw(buffer);
		const sd = parseStreetDataData(raw);
		const written = writeStreetDataData(sd);

		// The current C# writer drops per-junction exits / per-road spans and
		// pads for the retail FixUp() bug. The TS port mirrors that exactly and
		// must produce the same bytes the C# tool produces in raw-new form.
		expect(written.byteLength).toBe(26992);
		expect(sha1(written)).toBe('12a3ab4dde5244bc6bf2f0ad3bf11b1530edfa4c');
	});

	it('round-trip preserves all model values', () => {
		const { buffer } = loadBundle();
		const raw = extractStreetDataRaw(buffer);
		const sd1 = parseStreetDataData(raw);
		const written = writeStreetDataData(sd1);
		const sd2 = parseStreetDataData(written);

		expect(sd2.miVersion).toBe(sd1.miVersion);
		expect(sd2.streets.length).toBe(sd1.streets.length);
		expect(sd2.junctions.length).toBe(sd1.junctions.length);
		expect(sd2.roads.length).toBe(sd1.roads.length);
		expect(sd2.challenges.length).toBe(sd1.challenges.length);

		// Spot-check a few representative rows
		expect(sd2.streets[0]).toEqual(sd1.streets[0]);
		expect(sd2.streets[sd1.streets.length - 1]).toEqual(sd1.streets[sd1.streets.length - 1]);
		// Junctions: mpaExits and miExitCount are zeroed by the writer, so
		// compare everything else.
		const j1 = sd1.junctions[0];
		const j2 = sd2.junctions[0];
		expect(j2.superSpanBase).toEqual(j1.superSpanBase);
		expect(j2.macName).toEqual(j1.macName);
		expect(j2.mpaExits).toBe(0);
		expect(j2.miExitCount).toBe(0);

		// Roads: mpaSpans and miSpanCount are zeroed by the writer.
		const r1 = sd1.roads[0];
		const r2 = sd2.roads[0];
		expect(r2.mReferencePosition).toEqual(r1.mReferencePosition);
		expect(r2.mId).toBe(r1.mId);
		expect(r2.miRoadLimitId0).toBe(r1.miRoadLimitId0);
		expect(r2.miRoadLimitId1).toBe(r1.miRoadLimitId1);
		expect(r2.macDebugName).toBe(r1.macDebugName);
		expect(r2.mChallenge).toBe(r1.mChallenge);
		expect(r2.unknown).toBe(r1.unknown);
		expect(r2.mpaSpans).toBe(0);
		expect(r2.miSpanCount).toBe(0);

		expect(sd2.challenges[0]).toEqual(sd1.challenges[0]);
	});

	it('throws when challenges.length does not equal roads.length', () => {
		const { buffer } = loadBundle();
		const raw = extractStreetDataRaw(buffer);
		const sd = parseStreetDataData(raw);
		const bad = { ...sd, challenges: sd.challenges.slice(0, sd.challenges.length - 1) };
		expect(() => writeStreetDataData(bad)).toThrow(/challenges\.length/);
	});
});

describe('streetData byte-level fidelity', () => {
	// Targets the readFixedAscii NUL-terminator scan (loop body and break).
	// Stryker survivors showed the loop bound and break could be neutered
	// without any assertion noticing, because no test round-tripped a string
	// containing an embedded NUL.
	it('truncates fixed-ASCII strings at the first embedded NUL on round-trip', () => {
		const { buffer } = loadBundle();
		const raw = extractStreetDataRaw(buffer);
		const sd = parseStreetDataData(raw);
		sd.junctions[0].macName = 'AB\0CD';
		const written = writeStreetDataData(sd);
		const sd2 = parseStreetDataData(written);
		expect(sd2.junctions[0].macName).toBe('AB');
	});

	// Targets the `?? 0` / `?? 0n` nullish coalescing in writeChallengeParScores.
	// Without this test, those could be flipped to `&& 0` (which silently zeroes
	// valid values) and round-trip would still pass because the fixture has all
	// fields populated.
	it('writeChallengeParScores tolerates missing scalar score/rival values', () => {
		const { buffer } = loadBundle();
		const raw = extractStreetDataRaw(buffer);
		const sd = parseStreetDataData(raw);

		// Strip the optional scalars on the first challenge. The writer must
		// still emit 0-filled slots and keep byte alignment intact so the
		// remaining challenges round-trip unchanged.
		sd.challenges[0] = {
			...sd.challenges[0],
			challengeData: {
				...sd.challenges[0].challengeData,
				mScoreList: { maScores: [123] }, // maScores[1] missing
			},
			mRivals: [], // both rivals missing
		} as unknown as typeof sd.challenges[0];

		const written = writeStreetDataData(sd);
		const sd2 = parseStreetDataData(written);

		expect(sd2.challenges[0].challengeData.mScoreList.maScores).toEqual([123, 0]);
		expect(sd2.challenges[0].mRivals).toEqual([0n, 0n]);
		// Second challenge is untouched — alignment preserved.
		expect(sd2.challenges[1]).toEqual(sd.challenges[1]);
	});

	// Targets `data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)`
	// at parseStreetDataData. If the slice is dropped, the reader sees the whole
	// underlying buffer and parses garbage from the prefix instead of the payload.
	it('parses a Uint8Array view with a non-zero byteOffset correctly', () => {
		const { buffer } = loadBundle();
		const raw = extractStreetDataRaw(buffer);

		const prefix = 17;
		const wrapped = new Uint8Array(prefix + raw.byteLength);
		wrapped.set(raw, prefix);
		const view = wrapped.subarray(prefix);
		expect(view.byteOffset).toBe(prefix);

		const sd = parseStreetDataData(view);
		expect(sd.miVersion).toBe(6);
		expect(sd.streets).toHaveLength(310);
		expect(sd.junctions).toHaveLength(217);
		expect(sd.roads).toHaveLength(76);
	});
});

describe('streetData high-level wrappers', () => {
	function findStreetDataResource(buffer: ArrayBuffer) {
		const bundle = parseBundle(buffer);
		const resource = bundle.resources.find((r) => r.resourceTypeId === RESOURCE_TYPE_IDS.STREET_DATA);
		if (!resource) throw new Error('Fixture missing StreetData resource');
		return resource;
	}

	// Covers parseStreetData end-to-end (bundle lookup + pako/nested handling +
	// progress callback). The round-trip suite above only exercises the inner
	// parseStreetDataData entry, leaving this whole wrapper at zero coverage.
	it('parseStreetData parses from a bundle buffer and reports progress', () => {
		const { buffer } = loadBundle();
		const resource = findStreetDataResource(buffer);
		const events: { stage: string; progress: number }[] = [];
		const sd = parseStreetData(buffer, resource, {}, (ev) => {
			events.push({ stage: ev.stage, progress: ev.progress });
		});

		expect(sd.miVersion).toBe(6);
		expect(sd.streets).toHaveLength(310);
		expect(events.length).toBeGreaterThanOrEqual(3);
		expect(events[0].progress).toBe(0);
		expect(events.at(-1)?.progress).toBe(1);
	});

	it('writeStreetData delegates to writeStreetDataData and reports progress', () => {
		const { buffer } = loadBundle();
		const raw = extractStreetDataRaw(buffer);
		const sd = parseStreetDataData(raw);

		const events: number[] = [];
		const bytes = writeStreetData(sd, {}, (ev) => events.push(ev.progress));

		expect(bytes.byteLength).toBe(26992);
		expect(sha1(bytes)).toBe('12a3ab4dde5244bc6bf2f0ad3bf11b1530edfa4c');
		expect(events).toEqual([0, 1]);
	});

	// Targets the `progress?.(...)` optional chaining in both wrappers. Without
	// this test the `?.` could be turned into a bare call and every other test
	// (which always supplies a callback) would still pass.
	it('wrappers work when no progress callback is provided', () => {
		const { buffer } = loadBundle();
		const resource = findStreetDataResource(buffer);

		const sd = parseStreetData(buffer, resource);
		expect(sd.streets).toHaveLength(310);

		const bytes = writeStreetData(sd);
		expect(bytes.byteLength).toBe(26992);
	});
});
