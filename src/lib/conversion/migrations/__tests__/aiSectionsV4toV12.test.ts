// Tests for the V4 → V12 AI Sections migration (issue #36).
//
// Three flavours of coverage:
//   1. Structural round-trip on the real V4 fixture: parse → migrate →
//      writeAISectionsData → parseAISectionsData → assert section /
//      portal / boundary-line counts survive.
//   2. defaulted / lossy lists match the documented investigation
//      findings (acceptance criteria #5 + #6).
//   3. Stability: migrating twice produces identical output, and
//      re-encoding the V12 result through the writer is byte-stable
//      (acceptance criteria #7).

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { parseBundle } from '@/lib/core/bundle';
import { extractResourceSize, isCompressed, decompressData } from '@/lib/core/resourceManager';
import { RESOURCE_TYPE_IDS } from '@/lib/core/types';
import {
	parseAISectionsData,
	writeAISectionsData,
	SectionSpeed,
	type ParsedAISectionsV4,
	type ParsedAISectionsV12,
	type LegacyAISection,
	type LegacyAISectionsData,
} from '@/lib/core/aiSections';
import { migrateV4toV12 } from '../aiSectionsV4toV12';
import { aiSectionsV4Profile } from '@/lib/editor/profiles/aiSections';

const V4_FIXTURE = path.resolve(__dirname, '../../../../../example/older builds/AI.dat');

function loadResourceBytes(fixturePath: string): Uint8Array {
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
		return slice;
	}
	throw new Error('No populated data block in AI Sections resource');
}

function parseV4Fixture(): ParsedAISectionsV4 {
	const slice = loadResourceBytes(V4_FIXTURE);
	const parsed = parseAISectionsData(slice, /* littleEndian */ false);
	if (parsed.kind !== 'v4') {
		throw new Error(`Expected V4 fixture, got ${parsed.kind}`);
	}
	return parsed;
}

function legacyCounts(legacy: LegacyAISectionsData) {
	let portals = 0, portalBLs = 0, noGoLines = 0;
	for (const s of legacy.sections) {
		portals += s.portals.length;
		noGoLines += s.noGoLines.length;
		for (const p of s.portals) portalBLs += p.boundaryLines.length;
	}
	return {
		sections: legacy.sections.length,
		portals,
		portalBLs,
		noGoLines,
	};
}

function v12Counts(model: ParsedAISectionsV12) {
	let portals = 0, portalBLs = 0, noGoLines = 0;
	for (const s of model.sections) {
		portals += s.portals.length;
		noGoLines += s.noGoLines.length;
		for (const p of s.portals) portalBLs += p.boundaryLines.length;
	}
	return {
		sections: model.sections.length,
		portals,
		portalBLs,
		noGoLines,
	};
}

describe('migrateV4toV12 — fixture-driven structural round-trip', () => {
	const v4 = parseV4Fixture();
	const { result, defaulted, lossy } = migrateV4toV12(v4);

	it('produces a v12-shaped result with retail defaults filled in', () => {
		expect(result.kind).toBe('v12');
		expect(result.version).toBe(12);
		expect(result.sectionMinSpeeds).toHaveLength(5);
		expect(result.sectionMaxSpeeds).toHaveLength(5);
		// Match the retail PC fixture's first speed limit (anchored on a
		// real value so a regression in the constants table fails loudly).
		expect(result.sectionMinSpeeds[0]).toBeCloseTo(67.05, 1);
		expect(result.sectionMaxSpeeds[4]).toBeCloseTo(80.45, 1);
		// V4 has no reset-pair table.
		expect(result.sectionResetPairs).toEqual([]);
	});

	it('preserves section / portal / boundary-line / nogo counts', () => {
		const before = legacyCounts(v4.legacy);
		const after = v12Counts(result);
		expect(after.sections).toBe(before.sections);
		expect(after.portals).toBe(before.portals);
		expect(after.portalBLs).toBe(before.portalBLs);
		expect(after.noGoLines).toBe(before.noGoLines);
	});

	it('writes through the V12 writer and re-parses with identical counts', () => {
		const bytes = writeAISectionsData(result, /* littleEndian */ true);
		const reparsed = parseAISectionsData(bytes, /* littleEndian */ true);
		if (reparsed.kind !== 'v12') {
			throw new Error(`Expected v12 after round-trip, got ${reparsed.kind}`);
		}
		expect(v12Counts(reparsed)).toEqual(v12Counts(result));
		// Speed-limit table survives the writer→reader round-trip exactly.
		expect(reparsed.sectionMinSpeeds).toEqual(result.sectionMinSpeeds);
		expect(reparsed.sectionMaxSpeeds).toEqual(result.sectionMaxSpeeds);
	});

	it('synthesises sequential ids (0..N-1) and defaults spanIndex/district', () => {
		for (let i = 0; i < result.sections.length; i++) {
			const s = result.sections[i];
			expect(s.id).toBe(i);
			expect(s.spanIndex).toBe(-1);
			expect(s.district).toBe(0);
			expect(s.flags).toBe(0);
		}
	});

	it('reports the documented defaulted field paths', () => {
		// The exact set the investigation pinned. If a new defaulted field
		// is added in a future schema bump, update this list explicitly.
		expect(defaulted).toEqual([
			'sectionMaxSpeeds',
			'sectionMinSpeeds',
			'sectionResetPairs',
			'sections[].district',
			'sections[].id',
			'sections[].spanIndex',
		]);
	});

	it('reports the documented lossy field paths on the real V4 fixture', () => {
		// The fixture contains: dangerRating across all sections, the
		// 0x01 flag bit on 80 sections, and 5,402 portals (so portal-W
		// drops are flagged).
		expect(lossy).toEqual([
			'sections[].flags (V4 bit 0x01 dropped — meaning unknown)',
			'sections[].portals[].position (V4 midPosition.w dropped — vpu::Vector3 structural padding)',
			'sections[].speed (from dangerRating)',
		]);
	});
});

describe('migrateV4toV12 — dangerRating → speed mapping', () => {
	function syntheticV4(sections: LegacyAISection[]): ParsedAISectionsV4 {
		return {
			kind: 'v4',
			version: 4,
			legacy: { version: 4, sections },
		};
	}

	function makeSection(overrides: Partial<LegacyAISection> = {}): LegacyAISection {
		return {
			portals: [],
			noGoLines: [],
			cornersX: [0, 1, 1, 0],
			cornersZ: [0, 0, 1, 1],
			dangerRating: 1,
			flags: 0,
			...overrides,
		};
	}

	it('maps Freeway → Very Fast', () => {
		const { result } = migrateV4toV12(syntheticV4([makeSection({ dangerRating: 0 })]));
		expect(result.sections[0].speed).toBe(SectionSpeed.E_SECTION_SPEED_VERY_FAST);
	});

	it('maps Normal → Normal', () => {
		const { result } = migrateV4toV12(syntheticV4([makeSection({ dangerRating: 1 })]));
		expect(result.sections[0].speed).toBe(SectionSpeed.E_SECTION_SPEED_NORMAL);
	});

	it('maps Dangerous → Normal (the V4 axis was retired in V12)', () => {
		const { result } = migrateV4toV12(syntheticV4([makeSection({ dangerRating: 2 })]));
		expect(result.sections[0].speed).toBe(SectionSpeed.E_SECTION_SPEED_NORMAL);
	});

	it('falls back to Normal for an out-of-range dangerRating value', () => {
		const { result } = migrateV4toV12(syntheticV4([makeSection({ dangerRating: 99 })]));
		expect(result.sections[0].speed).toBe(SectionSpeed.E_SECTION_SPEED_NORMAL);
	});

	it('does not flag the flag-bit lossy entry when no V4 section sets bit 0x01', () => {
		const { lossy } = migrateV4toV12(syntheticV4([makeSection({ flags: 0 })]));
		expect(lossy).not.toContain('sections[].flags (V4 bit 0x01 dropped — meaning unknown)');
	});

	it('does flag the flag-bit lossy entry when at least one V4 section sets bit 0x01', () => {
		const { lossy } = migrateV4toV12(syntheticV4([
			makeSection({ flags: 0 }),
			makeSection({ flags: 0x01 }),
		]));
		expect(lossy).toContain('sections[].flags (V4 bit 0x01 dropped — meaning unknown)');
	});

	it('does not flag the portal-W lossy entry on a portal-less section', () => {
		const { lossy } = migrateV4toV12(syntheticV4([makeSection()]));
		expect(lossy).not.toContain(
			'sections[].portals[].position (V4 midPosition.w dropped — vpu::Vector3 structural padding)',
		);
	});

	it('packs cornersX/cornersZ into Vector2[4] with x=worldX, y=worldZ', () => {
		const v4 = syntheticV4([makeSection({
			cornersX: [10, 20, 30, 40],
			cornersZ: [100, 200, 300, 400],
		})]);
		const { result } = migrateV4toV12(v4);
		expect(result.sections[0].corners).toEqual([
			{ x: 10, y: 100 },
			{ x: 20, y: 200 },
			{ x: 30, y: 300 },
			{ x: 40, y: 400 },
		]);
	});

	it('drops portal midPosition.w (vpu::Vector3 padding) on conversion', () => {
		const v4 = syntheticV4([makeSection({
			portals: [{
				midPosition: { x: 1, y: 2, z: 3, w: 999 },
				boundaryLines: [],
				linkSection: 7,
			}],
		})]);
		const { result, lossy } = migrateV4toV12(v4);
		expect(result.sections[0].portals[0].position).toEqual({ x: 1, y: 2, z: 3 });
		expect(result.sections[0].portals[0].linkSection).toBe(7);
		expect(lossy).toContain(
			'sections[].portals[].position (V4 midPosition.w dropped — vpu::Vector3 structural padding)',
		);
	});
});

describe('aiSectionsV4Profile.conversions.v12 wiring', () => {
	it('exposes migrateV4toV12 under conversions.v12.migrate (acceptance criterion)', () => {
		const conversion = aiSectionsV4Profile.conversions?.v12;
		expect(conversion).toBeDefined();
		expect(conversion?.label).toMatch(/v12/i);
		expect(conversion?.migrate).toBe(migrateV4toV12);
	});
});

describe('migrateV4toV12 — stability', () => {
	it('produces identical output on repeated calls (deterministic)', () => {
		const v4 = parseV4Fixture();
		const a = migrateV4toV12(v4);
		const b = migrateV4toV12(v4);
		expect(a.result).toEqual(b.result);
		expect(a.defaulted).toEqual(b.defaulted);
		expect(a.lossy).toEqual(b.lossy);
	});

	it('writer is stable: write → parse → write produces identical bytes', () => {
		const v4 = parseV4Fixture();
		const { result } = migrateV4toV12(v4);
		const bytes1 = writeAISectionsData(result, /* littleEndian */ true);
		const reparsed = parseAISectionsData(bytes1, /* littleEndian */ true);
		const bytes2 = writeAISectionsData(reparsed, /* littleEndian */ true);
		expect(bytes2.byteLength).toBe(bytes1.byteLength);
		// Tight loop is faster than `toEqual` on a multi-MB Uint8Array.
		for (let i = 0; i < bytes1.byteLength; i++) {
			if (bytes1[i] !== bytes2[i]) {
				throw new Error(`Stable-writer mismatch at byte ${i}`);
			}
		}
	});
});
