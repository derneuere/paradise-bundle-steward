// Tests for the V6 → V12 AI Sections migration (issue #40).
//
// Mirrors the V4 → V12 test layout from #36 — fixture-driven structural
// round-trip on the real V6 prototype bundle, synthetic-section
// dangerRating / flag-mapping coverage, profile wiring assertion, and
// stability checks. The V6 prototype bundle is the 2007-02-22 X360 build
// (3,900 sections); we also exercise the synthetic V6 model from
// `aiSectionsLegacy.test.ts` to keep coverage stable if the real fixture
// is ever moved.

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
	AISectionFlag,
	LegacyAISectionFlagV6,
	LegacyEDistrict,
	LegacyDangerRating,
	type ParsedAISectionsV6,
	type ParsedAISectionsV12,
	type LegacyAISection,
	type LegacyAISectionsData,
} from '@/lib/core/aiSections';
import { migrateV6toV12, migrateSectionV6toV12 } from '../aiSectionsV6toV12';
import { aiSectionsV6Profile } from '@/lib/editor/profiles/aiSections';

const V6_FIXTURE = path.resolve(__dirname, '../../../../../example/older builds/AI v6.DAT');

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

function parseV6Fixture(): ParsedAISectionsV6 {
	const slice = loadResourceBytes(V6_FIXTURE);
	const parsed = parseAISectionsData(slice, /* littleEndian */ false);
	if (parsed.kind !== 'v6') {
		throw new Error(`Expected V6 fixture, got ${parsed.kind}`);
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

describe('migrateV6toV12 — fixture-driven structural round-trip', () => {
	const v6 = parseV6Fixture();
	const { result, defaulted, lossy } = migrateV6toV12(v6);

	it('produces a v12-shaped result with retail defaults filled in', () => {
		expect(result.kind).toBe('v12');
		expect(result.version).toBe(12);
		expect(result.sectionMinSpeeds).toHaveLength(5);
		expect(result.sectionMaxSpeeds).toHaveLength(5);
		expect(result.sectionMinSpeeds[0]).toBeCloseTo(67.05, 1);
		expect(result.sectionMaxSpeeds[4]).toBeCloseTo(80.45, 1);
		expect(result.sectionResetPairs).toEqual([]);
	});

	it('preserves section / portal / boundary-line / nogo counts', () => {
		const before = legacyCounts(v6.legacy);
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
		expect(reparsed.sectionMinSpeeds).toEqual(result.sectionMinSpeeds);
		expect(reparsed.sectionMaxSpeeds).toEqual(result.sectionMaxSpeeds);
	});

	it('synthesises sequential ids (0..N-1) and passes spanIndex/district through', () => {
		for (let i = 0; i < result.sections.length; i++) {
			const s = result.sections[i];
			expect(s.id).toBe(i);
			// V6 carries spanIndex/district verbatim — assert pass-through
			// against the source legacy section. (The V6 fixture has 3,900
			// district=0 sections, so the district pass-through is a no-op
			// in practice but the assertion guards against a future regression
			// that would default it.)
			const src = v6.legacy.sections[i];
			expect(s.spanIndex).toBe(src.spanIndex ?? -1);
			expect(s.district).toBe(src.district ?? 0);
		}
	});

	it('reports the documented defaulted field paths', () => {
		// V6 — unlike V4 — does NOT default sections[].spanIndex or
		// sections[].district because the V6 schema carries them.
		expect(defaulted).toEqual([
			'sectionMaxSpeeds',
			'sectionMinSpeeds',
			'sectionResetPairs',
			'sections[].id',
		]);
	});

	it('reports the documented lossy field paths on the real V6 fixture', () => {
		// The V6 fixture has dangerRating across all sections, V6 flag bits
		// set on 1,449 of 3,900 sections, and 8,906 portals (so portal-W
		// drops are flagged).
		expect(lossy).toEqual([
			'sections[].flags (V6 IS_IN_AIR/IS_SHORTCUT/IS_JUNCTION mapped to V12 cognate bits)',
			'sections[].portals[].position (V6 midPosition.w dropped — vpu::Vector3 structural padding)',
			'sections[].speed (from dangerRating)',
		]);
	});
});

describe('migrateV6toV12 — synthetic section coverage', () => {
	function syntheticV6(sections: LegacyAISection[]): ParsedAISectionsV6 {
		return {
			kind: 'v6',
			version: 6,
			legacy: { version: 6, sections },
		};
	}

	function makeSection(overrides: Partial<LegacyAISection> = {}): LegacyAISection {
		return {
			portals: [],
			noGoLines: [],
			cornersX: [0, 1, 1, 0],
			cornersZ: [0, 0, 1, 1],
			dangerRating: LegacyDangerRating.E_DANGER_RATING_NORMAL,
			flags: 0,
			spanIndex: -1,
			district: 0,
			...overrides,
		};
	}

	it('maps Freeway → Very Fast (modal pick from V6 fixture spatial join)', () => {
		const { result } = migrateV6toV12(syntheticV6([makeSection({ dangerRating: 0 })]));
		expect(result.sections[0].speed).toBe(SectionSpeed.E_SECTION_SPEED_VERY_FAST);
	});

	it('maps Normal → Normal', () => {
		const { result } = migrateV6toV12(syntheticV6([makeSection({ dangerRating: 1 })]));
		expect(result.sections[0].speed).toBe(SectionSpeed.E_SECTION_SPEED_NORMAL);
	});

	it('maps Dangerous → Normal (the V4/V6 axis was retired in V12)', () => {
		const { result } = migrateV6toV12(syntheticV6([makeSection({ dangerRating: 2 })]));
		expect(result.sections[0].speed).toBe(SectionSpeed.E_SECTION_SPEED_NORMAL);
	});

	it('falls back to Normal for an out-of-range dangerRating value', () => {
		const { result } = migrateV6toV12(syntheticV6([makeSection({ dangerRating: 99 })]));
		expect(result.sections[0].speed).toBe(SectionSpeed.E_SECTION_SPEED_NORMAL);
	});

	it('passes V6 spanIndex through verbatim', () => {
		const { result } = migrateV6toV12(syntheticV6([
			makeSection({ spanIndex: 12345 }),
			makeSection({ spanIndex: -1 }),
			makeSection({ spanIndex: 0 }),
		]));
		expect(result.sections[0].spanIndex).toBe(12345);
		expect(result.sections[1].spanIndex).toBe(-1);
		expect(result.sections[2].spanIndex).toBe(0);
	});

	it('passes V6 district through verbatim (non-zero districts survive)', () => {
		const { result } = migrateV6toV12(syntheticV6([
			makeSection({ district: LegacyEDistrict.E_DISTRICT_CITY }),
			makeSection({ district: LegacyEDistrict.E_DISTRICT_AIRPORT }),
		]));
		expect(result.sections[0].district).toBe(LegacyEDistrict.E_DISTRICT_CITY);
		expect(result.sections[1].district).toBe(LegacyEDistrict.E_DISTRICT_AIRPORT);
	});

	it('maps V6 IS_IN_AIR → V12 IN_AIR', () => {
		const { result } = migrateV6toV12(syntheticV6([
			makeSection({ flags: LegacyAISectionFlagV6.IS_IN_AIR }),
		]));
		expect(result.sections[0].flags).toBe(AISectionFlag.IN_AIR);
	});

	it('maps V6 IS_SHORTCUT → V12 SHORTCUT', () => {
		const { result } = migrateV6toV12(syntheticV6([
			makeSection({ flags: LegacyAISectionFlagV6.IS_SHORTCUT }),
		]));
		expect(result.sections[0].flags).toBe(AISectionFlag.SHORTCUT);
	});

	it('maps V6 IS_JUNCTION → V12 JUNCTION', () => {
		const { result } = migrateV6toV12(syntheticV6([
			makeSection({ flags: LegacyAISectionFlagV6.IS_JUNCTION }),
		]));
		expect(result.sections[0].flags).toBe(AISectionFlag.JUNCTION);
	});

	it('maps a combined V6 flag mask to the union of V12 cognate bits', () => {
		const combined = LegacyAISectionFlagV6.IS_IN_AIR
			| LegacyAISectionFlagV6.IS_SHORTCUT
			| LegacyAISectionFlagV6.IS_JUNCTION;
		const { result } = migrateV6toV12(syntheticV6([makeSection({ flags: combined })]));
		expect(result.sections[0].flags).toBe(
			AISectionFlag.IN_AIR | AISectionFlag.SHORTCUT | AISectionFlag.JUNCTION,
		);
	});

	it('does not flag the flag-bit lossy entry when no V6 section sets a flag', () => {
		const { lossy } = migrateV6toV12(syntheticV6([makeSection({ flags: 0 })]));
		expect(lossy).not.toContain(
			'sections[].flags (V6 IS_IN_AIR/IS_SHORTCUT/IS_JUNCTION mapped to V12 cognate bits)',
		);
	});

	it('does flag the flag-bit lossy entry when at least one V6 section sets any bit', () => {
		const { lossy } = migrateV6toV12(syntheticV6([
			makeSection({ flags: 0 }),
			makeSection({ flags: LegacyAISectionFlagV6.IS_SHORTCUT }),
		]));
		expect(lossy).toContain(
			'sections[].flags (V6 IS_IN_AIR/IS_SHORTCUT/IS_JUNCTION mapped to V12 cognate bits)',
		);
	});

	it('does not flag the portal-W lossy entry on a portal-less section', () => {
		const { lossy } = migrateV6toV12(syntheticV6([makeSection()]));
		expect(lossy).not.toContain(
			'sections[].portals[].position (V6 midPosition.w dropped — vpu::Vector3 structural padding)',
		);
	});

	it('packs cornersX/cornersZ into Vector2[4] with x=worldX, y=worldZ', () => {
		const v6 = syntheticV6([makeSection({
			cornersX: [10, 20, 30, 40],
			cornersZ: [100, 200, 300, 400],
		})]);
		const { result } = migrateV6toV12(v6);
		expect(result.sections[0].corners).toEqual([
			{ x: 10, y: 100 },
			{ x: 20, y: 200 },
			{ x: 30, y: 300 },
			{ x: 40, y: 400 },
		]);
	});

	it('drops portal midPosition.w (vpu::Vector3 padding) on conversion', () => {
		const v6 = syntheticV6([makeSection({
			portals: [{
				midPosition: { x: 1, y: 2, z: 3, w: 999 },
				boundaryLines: [],
				linkSection: 7,
			}],
		})]);
		const { result, lossy } = migrateV6toV12(v6);
		expect(result.sections[0].portals[0].position).toEqual({ x: 1, y: 2, z: 3 });
		expect(result.sections[0].portals[0].linkSection).toBe(7);
		expect(lossy).toContain(
			'sections[].portals[].position (V6 midPosition.w dropped — vpu::Vector3 structural padding)',
		);
	});

	it('round-trips the synthetic V6 model from aiSectionsLegacy.test.ts', () => {
		// Mirrors acceptance criterion: synthetic V6 → migrate → V12 writer
		// → re-parse → assert structural shape preserved.
		const synthetic: ParsedAISectionsV6 = {
			kind: 'v6',
			version: 6,
			legacy: {
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
			},
		};

		const { result } = migrateV6toV12(synthetic);
		expect(result.sections).toHaveLength(2);
		// Section 0: spanIndex passes through, district passes through,
		// flags map cognate-name.
		expect(result.sections[0].spanIndex).toBe(42);
		expect(result.sections[0].district).toBe(LegacyEDistrict.E_DISTRICT_CITY);
		expect(result.sections[0].flags).toBe(AISectionFlag.SHORTCUT | AISectionFlag.JUNCTION);
		expect(result.sections[0].speed).toBe(SectionSpeed.E_SECTION_SPEED_NORMAL); // Dangerous → Normal
		// Section 1: empty portals/noGo branch.
		expect(result.sections[1].portals).toHaveLength(0);
		expect(result.sections[1].noGoLines).toHaveLength(0);
		expect(result.sections[1].speed).toBe(SectionSpeed.E_SECTION_SPEED_VERY_FAST); // Freeway → VERY_FAST
		expect(result.sections[1].flags).toBe(0);

		// Writer accepts it; re-parse keeps counts.
		const bytes = writeAISectionsData(result, /* littleEndian */ true);
		const reparsed = parseAISectionsData(bytes, /* littleEndian */ true);
		if (reparsed.kind !== 'v12') throw new Error('expected v12 after round-trip');
		expect(reparsed.sections).toHaveLength(2);
		expect(reparsed.sections[0].spanIndex).toBe(42);
		expect(reparsed.sections[0].district).toBe(LegacyEDistrict.E_DISTRICT_CITY);
		expect(reparsed.sections[0].flags).toBe(AISectionFlag.SHORTCUT | AISectionFlag.JUNCTION);
	});
});

describe('migrateSectionV6toV12 — per-section helper', () => {
	function makeSection(overrides: Partial<LegacyAISection> = {}): LegacyAISection {
		return {
			portals: [],
			noGoLines: [],
			cornersX: [0, 1, 1, 0],
			cornersZ: [0, 0, 1, 1],
			dangerRating: LegacyDangerRating.E_DANGER_RATING_NORMAL,
			flags: 0,
			spanIndex: -1,
			district: 0,
			...overrides,
		};
	}

	it('produces a V12 section with the destinationIndex placeholder id', () => {
		const { section } = migrateSectionV6toV12(makeSection(), { destinationIndex: 42 });
		expect(section.id).toBe(42);
	});

	it('passes spanIndex/district through (NOT defaulted on V6, unlike V4)', () => {
		const { section, report } = migrateSectionV6toV12(
			makeSection({ spanIndex: 99, district: LegacyEDistrict.E_DISTRICT_AIRPORT }),
			{ destinationIndex: 0 },
		);
		expect(section.spanIndex).toBe(99);
		expect(section.district).toBe(LegacyEDistrict.E_DISTRICT_AIRPORT);
		expect(report.defaulted.has('sections[].spanIndex')).toBe(false);
		expect(report.defaulted.has('sections[].district')).toBe(false);
	});

	it('reports sections[].id as defaulted (V6 has no AISectionId)', () => {
		const { report } = migrateSectionV6toV12(makeSection(), { destinationIndex: 0 });
		expect(report.defaulted.has('sections[].id')).toBe(true);
	});

	it('reports the dangerRating-axis lossy entry on every section', () => {
		const { report } = migrateSectionV6toV12(makeSection(), { destinationIndex: 0 });
		expect(report.lossy.has('sections[].speed (from dangerRating)')).toBe(true);
	});

	it('omits the flag lossy entry when no V6 flag bits are set', () => {
		const { report } = migrateSectionV6toV12(makeSection({ flags: 0 }), { destinationIndex: 0 });
		expect(report.lossy.has(
			'sections[].flags (V6 IS_IN_AIR/IS_SHORTCUT/IS_JUNCTION mapped to V12 cognate bits)',
		)).toBe(false);
	});

	it('flags the flag lossy entry when any V6 flag bit is set', () => {
		const { report } = migrateSectionV6toV12(
			makeSection({ flags: LegacyAISectionFlagV6.IS_JUNCTION }),
			{ destinationIndex: 0 },
		);
		expect(report.lossy.has(
			'sections[].flags (V6 IS_IN_AIR/IS_SHORTCUT/IS_JUNCTION mapped to V12 cognate bits)',
		)).toBe(true);
	});
});

describe('aiSectionsV6Profile.conversions.v12 wiring', () => {
	it('exposes migrateV6toV12 under conversions.v12.migrate (acceptance criterion)', () => {
		const conversion = aiSectionsV6Profile.conversions?.v12;
		expect(conversion).toBeDefined();
		expect(conversion?.label).toMatch(/v12/i);
		expect(conversion?.migrate).toBe(migrateV6toV12);
	});
});

describe('migrateV6toV12 — stability', () => {
	it('produces identical output on repeated calls (deterministic)', () => {
		const v6 = parseV6Fixture();
		const a = migrateV6toV12(v6);
		const b = migrateV6toV12(v6);
		expect(a.result).toEqual(b.result);
		expect(a.defaulted).toEqual(b.defaulted);
		expect(a.lossy).toEqual(b.lossy);
	});

	it('writer is stable: write → parse → write produces identical bytes', () => {
		const v6 = parseV6Fixture();
		const { result } = migrateV6toV12(v6);
		const bytes1 = writeAISectionsData(result, /* littleEndian */ true);
		const reparsed = parseAISectionsData(bytes1, /* littleEndian */ true);
		const bytes2 = writeAISectionsData(reparsed, /* littleEndian */ true);
		expect(bytes2.byteLength).toBe(bytes1.byteLength);
		for (let i = 0; i < bytes1.byteLength; i++) {
			if (bytes1[i] !== bytes2[i]) {
				throw new Error(`Stable-writer mismatch at byte ${i}`);
			}
		}
	});
});
