// Tests for the Burnout 5 prototype AISections parser+writer (V4/V6).
//
// The byte-roundtrip-against-fixture test lives in registry.test.ts —
// auto-generated from the handler's fixture list (`example/older builds/AI.dat`
// is a v4 X360 BE bundle). This file pins the stronger invariants:
//
//   1. parseAISectionsData dispatches into the legacy code path when
//      muVersion is 4 or 6, returning a `kind: 'v4'` or `kind: 'v6'`
//      discriminated-union variant.
//   2. Cross-platform self-consistency: V4 payload → write as PC (LE) →
//      reparse → write as X360 (BE) === source. Proves the writer is
//      endianness-clean for legacy too.
//   3. Synthetic V6 payload → write → reparse round-trips losslessly.
//      We don't have a V6 fixture, but the writer must still produce
//      bytes the parser accepts so the format is exercised end-to-end.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { parseBundle } from './bundle';
import { extractResourceSize, isCompressed, decompressData } from './resourceManager';
import { RESOURCE_TYPE_IDS, PLATFORMS } from './types';
import {
	parseAISectionsData,
	writeAISectionsData,
} from './aiSections';
import {
	parseLegacyAISectionsData,
	writeLegacyAISectionsData,
	detectLegacyVersion,
	type LegacyAISectionsData,
	LegacyDangerRating,
	LegacyAISectionFlagV6,
	LegacyEDistrict,
} from './aiSectionsLegacy';

const LEGACY_FIXTURE = path.resolve(__dirname, '../../../example/older builds/AI.dat');

function loadResourceBytes(fixturePath: string, isLittleEndian: boolean): Uint8Array {
	const raw = fs.readFileSync(fixturePath);
	const bytes = new Uint8Array(raw.byteLength);
	bytes.set(raw);
	const buffer = bytes.buffer;
	const bundle = parseBundle(buffer);
	const resource = bundle.resources.find((r) => r.resourceTypeId === RESOURCE_TYPE_IDS.AI_SECTIONS);
	if (!resource) throw new Error(`Fixture ${fixturePath} missing AI Sections resource`);
	for (let bi = 0; bi < 3; bi++) {
		const size = extractResourceSize(resource.sizeAndAlignmentOnDisk[bi]);
		if (size <= 0) continue;
		const base = bundle.header.resourceDataOffsets[bi] >>> 0;
		const rel = resource.diskOffsets[bi] >>> 0;
		const start = (base + rel) >>> 0;
		let slice: Uint8Array = new Uint8Array(buffer.slice(start, start + size));
		if (isCompressed(slice)) slice = decompressData(slice);
		// Sanity: callers always know the platform endianness.
		void isLittleEndian;
		return slice;
	}
	throw new Error('No populated data block in AI Sections resource');
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.byteLength !== b.byteLength) return false;
	for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
	return true;
}

describe('AI Sections legacy V4/V6 dispatch', () => {
	it('detectLegacyVersion identifies the V4 fixture as version 4', () => {
		const raw = fs.readFileSync(LEGACY_FIXTURE);
		const bytes = new Uint8Array(raw.byteLength);
		bytes.set(raw);
		const bundle = parseBundle(bytes.buffer);
		expect(bundle.header.platform).toBe(PLATFORMS.XBOX360);
		const slice = loadResourceBytes(LEGACY_FIXTURE, false);
		expect(detectLegacyVersion(slice, /* littleEndian */ false)).toBe(4);
	});

	it('parseAISectionsData dispatches V4 payload into a kind: "v4" variant', () => {
		const slice = loadResourceBytes(LEGACY_FIXTURE, false);
		const model = parseAISectionsData(slice, /* littleEndian */ false);
		expect(model.kind).toBe('v4');
		if (model.kind !== 'v4') return;
		expect(model.version).toBe(4);
		expect(model.legacy.version).toBe(4);
		expect(model.legacy.sections.length).toBe(2442);
	});

	it('writeAISectionsData routes legacy models through the legacy writer', () => {
		const slice = loadResourceBytes(LEGACY_FIXTURE, false);
		const model = parseAISectionsData(slice, /* littleEndian */ false);
		const written = writeAISectionsData(model, /* littleEndian */ false);
		expect(bytesEqual(written, slice)).toBe(true);
	});
});

describe('AI Sections legacy cross-platform self-consistency', () => {
	it('V4 X360 (BE) payload → write as PC (LE) → reparse → write as X360 === source', () => {
		const sourceBE = loadResourceBytes(LEGACY_FIXTURE, false);
		const modelFromBE = parseLegacyAISectionsData(sourceBE, /* littleEndian */ false);

		const asLE = writeLegacyAISectionsData(modelFromBE, /* littleEndian */ true);
		const modelFromLE = parseLegacyAISectionsData(asLE, /* littleEndian */ true);
		expect(modelFromLE.version).toBe(modelFromBE.version);
		expect(modelFromLE.sections.length).toBe(modelFromBE.sections.length);

		const backToBE = writeLegacyAISectionsData(modelFromLE, /* littleEndian */ false);
		expect(backToBE.byteLength).toBe(sourceBE.byteLength);
		if (!bytesEqual(backToBE, sourceBE)) {
			let firstDiff = -1;
			for (let i = 0; i < sourceBE.byteLength; i++) {
				if (sourceBE[i] !== backToBE[i]) { firstDiff = i; break; }
			}
			throw new Error(`X360→PC→X360 drift; first byte diff at 0x${firstDiff.toString(16)}`);
		}
	});
});

describe('AI Sections legacy V6 synthetic round-trip', () => {
	// We don't have a V6 fixture, so synthesise one to exercise the V6
	// section-header layout (4-byte spanIndex + district + 2-byte pad
	// instead of V4's 3-byte pad).
	const v6Model: LegacyAISectionsData = {
		version: 6,
		sections: [
			{
				portals: [
					{
						midPosition: { x: 1, y: 2, z: 3, w: 0 },
						boundaryLines: [
							{ verts: { x: 10, y: 20, z: 30, w: 40 } },
							{ verts: { x: 11, y: 21, z: 31, w: 41 } },
						],
						linkSection: 7,
					},
					{
						midPosition: { x: -100.5, y: 50.25, z: -200.75, w: 0 },
						boundaryLines: [{ verts: { x: 0, y: 0, z: 0, w: 0 } }],
						linkSection: 0,
					},
				],
				noGoLines: [
					{ verts: { x: 1, y: 2, z: 3, w: 4 } },
					{ verts: { x: 5, y: 6, z: 7, w: 8 } },
					{ verts: { x: 9, y: 10, z: 11, w: 12 } },
				],
				cornersX: [-10, 10, 10, -10],
				cornersZ: [-20, -20, 20, 20],
				dangerRating: LegacyDangerRating.E_DANGER_RATING_DANGEROUS,
				flags: LegacyAISectionFlagV6.IS_SHORTCUT | LegacyAISectionFlagV6.IS_JUNCTION,
				spanIndex: 42,
				district: LegacyEDistrict.E_DISTRICT_CITY,
			},
			{
				portals: [],
				noGoLines: [],
				cornersX: [0, 1, 2, 3],
				cornersZ: [4, 5, 6, 7],
				dangerRating: LegacyDangerRating.E_DANGER_RATING_FREEWAY,
				flags: LegacyAISectionFlagV6.NONE,
				spanIndex: -1,
				district: LegacyEDistrict.E_DISTRICT_SUBURBS,
			},
		],
	};

	for (const littleEndian of [true, false]) {
		const tag = littleEndian ? 'LE' : 'BE';
		it(`writeLegacyAISectionsData → parseLegacyAISectionsData round-trips a synthetic V6 payload (${tag})`, () => {
			const bytes = writeLegacyAISectionsData(v6Model, littleEndian);
			const parsed = parseLegacyAISectionsData(bytes, littleEndian);
			expect(parsed.version).toBe(6);
			expect(parsed.sections.length).toBe(v6Model.sections.length);

			const a = parsed.sections[0];
			const e = v6Model.sections[0];
			expect(a.cornersX).toEqual(e.cornersX);
			expect(a.cornersZ).toEqual(e.cornersZ);
			expect(a.dangerRating).toBe(e.dangerRating);
			expect(a.flags).toBe(e.flags);
			expect(a.spanIndex).toBe(e.spanIndex);
			expect(a.district).toBe(e.district);
			expect(a.portals.length).toBe(e.portals.length);
			expect(a.portals[0].linkSection).toBe(e.portals[0].linkSection);
			expect(a.portals[0].boundaryLines.length).toBe(e.portals[0].boundaryLines.length);
			expect(a.portals[0].boundaryLines[0].verts).toEqual(e.portals[0].boundaryLines[0].verts);
			expect(a.noGoLines.length).toBe(e.noGoLines.length);
			expect(a.noGoLines[2].verts).toEqual(e.noGoLines[2].verts);

			// Second section has no portals/nogo — covers the empty-arrays branch.
			expect(parsed.sections[1].portals.length).toBe(0);
			expect(parsed.sections[1].noGoLines.length).toBe(0);
			expect(parsed.sections[1].spanIndex).toBe(-1);

			// Writing the reparsed model should be idempotent.
			const bytes2 = writeLegacyAISectionsData(parsed, littleEndian);
			expect(bytesEqual(bytes2, bytes)).toBe(true);
		});
	}
});
