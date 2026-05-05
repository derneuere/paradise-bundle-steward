// Coverage for the AI Sections bulk-import pipeline (Slice 2).

import { describe, it, expect } from 'vitest';
import {
	SectionSpeed,
	parseAISectionsData,
	writeAISectionsData,
	type ParsedAISectionsV12,
	type AISection,
	type LegacyAISection,
	type Portal,
} from '@/lib/core/aiSections';
import { exportAISectionsBulk } from '../aiSectionsBulkExport';
import {
	importAISectionsBulk,
	NO_LINK_SENTINEL,
} from '../aiSectionsBulkImport';
import type { BulkEnvelope } from '../bulkEnvelope';
import type { AISectionsBulkItem } from '../aiSectionsBulkExport';

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

function v12Portal(linkSection: number): Portal {
	return {
		position: { x: 0, y: 0, z: 0 },
		boundaryLines: [],
		linkSection,
	};
}

function v12Section(overrides: Partial<AISection> = {}): AISection {
	return {
		portals: [],
		noGoLines: [],
		corners: [
			{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 },
		],
		id: 0,
		spanIndex: -1,
		speed: SectionSpeed.E_SECTION_SPEED_NORMAL,
		district: 0,
		flags: 0,
		...overrides,
	};
}

function v12Model(sections: AISection[]): ParsedAISectionsV12 {
	return {
		kind: 'v12',
		version: 12,
		sectionMinSpeeds: [10, 20, 30, 40, 50],
		sectionMaxSpeeds: [11, 22, 33, 44, 55],
		sections,
		sectionResetPairs: [],
	};
}

function legacySection(overrides: Partial<LegacyAISection> = {}): LegacyAISection {
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

function envelopeFor(
	model: Parameters<typeof exportAISectionsBulk>[0]['model'],
	indices: ReadonlySet<number>,
	sourceBundle?: string,
): BulkEnvelope<AISectionsBulkItem> {
	return exportAISectionsBulk({
		model,
		selectedSectionIndices: indices,
		sourceBundleFilename: sourceBundle,
	});
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('importAISectionsBulk — V12 → V12 Append', () => {
	it('appends items past the existing sections list', () => {
		const source = v12Model([
			v12Section({ id: 100 }),
			v12Section({ id: 200 }),
		]);
		const dest = v12Model([v12Section({ id: 999 })]);
		const env = envelopeFor(source, new Set([0, 1]));
		const out = importAISectionsBulk({
			envelope: env,
			destination: dest,
			mode: 'append',
			startId: 0x9000,
		});
		expect(out.result.sections).toHaveLength(3);
		expect(out.result.sections[0].id).toBe(999);
		expect(out.result.sections[1].id).toBe(0x9000);
		expect(out.result.sections[2].id).toBe(0x9001);
	});

	it('reports no defaulted/lossy entries (V12 → V12 is lossless)', () => {
		const source = v12Model([v12Section()]);
		const env = envelopeFor(source, new Set([0]));
		const out = importAISectionsBulk({
			envelope: env,
			destination: v12Model([]),
			mode: 'append',
			startId: 0,
		});
		expect(out.defaulted).toEqual([]);
		expect(out.lossy).toEqual([]);
	});

	it('returns the assignedIdRange for the imported items', () => {
		const env = envelopeFor(
			v12Model([v12Section(), v12Section(), v12Section()]),
			new Set([0, 1, 2]),
		);
		const out = importAISectionsBulk({
			envelope: env,
			destination: v12Model([]),
			mode: 'append',
			startId: 1000,
		});
		expect(out.assignedIdRange).toEqual({ firstId: 1000, lastId: 1002 });
	});

	it('returns null assignedIdRange for an empty envelope', () => {
		const env = envelopeFor(v12Model([]), new Set());
		const out = importAISectionsBulk({
			envelope: env,
			destination: v12Model([v12Section()]),
			mode: 'append',
			startId: 5,
		});
		expect(out.assignedIdRange).toBeNull();
		expect(out.result.sections).toHaveLength(1); // destination unchanged
	});

	it('preserves top-level destination fields on Append', () => {
		const dest = v12Model([v12Section()]);
		const env = envelopeFor(v12Model([v12Section()]), new Set([0]));
		const out = importAISectionsBulk({
			envelope: env,
			destination: dest,
			mode: 'append',
			startId: 0,
		});
		expect(out.result.sectionMinSpeeds).toEqual(dest.sectionMinSpeeds);
		expect(out.result.sectionMaxSpeeds).toEqual(dest.sectionMaxSpeeds);
		expect(out.result.sectionResetPairs).toEqual(dest.sectionResetPairs);
		expect(out.result.version).toBe(dest.version);
	});

	it('deep-clones imported sections so source mutations do not bleed into the destination', () => {
		const sourceSection = v12Section({
			portals: [v12Portal(123)],
		});
		const source = v12Model([sourceSection]);
		const env = envelopeFor(source, new Set([0]));
		const out = importAISectionsBulk({
			envelope: env,
			destination: v12Model([]),
			mode: 'append',
			startId: 0,
		});
		// Mutating the source should not change the imported copy.
		sourceSection.portals[0].linkSection = 999;
		expect(out.result.sections[0].portals[0].linkSection).not.toBe(999);
	});
});

describe('importAISectionsBulk — V12 → V12 Replace', () => {
	it('wipes existing sections but keeps top-level fields', () => {
		const dest = v12Model([
			v12Section({ id: 1 }),
			v12Section({ id: 2 }),
		]);
		const env = envelopeFor(v12Model([v12Section()]), new Set([0]));
		const out = importAISectionsBulk({
			envelope: env,
			destination: dest,
			mode: 'replace',
			startId: 0x1000,
		});
		expect(out.result.sections).toHaveLength(1);
		expect(out.result.sections[0].id).toBe(0x1000);
		// Top-level retained from destination.
		expect(out.result.sectionMinSpeeds).toEqual(dest.sectionMinSpeeds);
		expect(out.result.sectionMaxSpeeds).toEqual(dest.sectionMaxSpeeds);
	});

	it('places replace-mode items starting at destination index 0', () => {
		// Self-link 0→0 should remap to 0 in the new list.
		const source = v12Model([v12Section({ portals: [v12Portal(0)] })]);
		const env = envelopeFor(source, new Set([0]));
		const out = importAISectionsBulk({
			envelope: env,
			destination: v12Model([v12Section(), v12Section(), v12Section()]),
			mode: 'replace',
			startId: 0,
		});
		expect(out.result.sections).toHaveLength(1);
		expect(out.result.sections[0].portals[0].linkSection).toBe(0);
	});
});

describe('importAISectionsBulk — link remapping', () => {
	it('rewrites in-bulk portal links to their new destination index (Append)', () => {
		// Source: section 0 portal points at section 1; both in the bulk.
		const source = v12Model([
			v12Section({ portals: [v12Portal(1)] }), // → src#1
			v12Section({ portals: [v12Portal(0)] }), // → src#0
		]);
		const env = envelopeFor(source, new Set([0, 1]));
		const dest = v12Model([v12Section(), v12Section(), v12Section()]); // length 3
		const out = importAISectionsBulk({
			envelope: env,
			destination: dest,
			mode: 'append',
			startId: 0,
		});
		// Imported items land at index 3 and 4 in the destination.
		expect(out.result.sections[3].portals[0].linkSection).toBe(4);
		expect(out.result.sections[4].portals[0].linkSection).toBe(3);
		expect(out.unlinkedPortals).toEqual([]);
	});

	it('rewrites out-of-bulk portal links to NO_LINK_SENTINEL and records them', () => {
		const source = v12Model([
			v12Section({ portals: [v12Portal(1234)] }), // not in bulk
		]);
		const env = envelopeFor(source, new Set([0]));
		const out = importAISectionsBulk({
			envelope: env,
			destination: v12Model([]),
			mode: 'append',
			startId: 0,
		});
		expect(out.result.sections[0].portals[0].linkSection).toBe(NO_LINK_SENTINEL);
		expect(out.unlinkedPortals).toEqual([
			{ destinationSectionIdx: 0, portalIdx: 0, originalLinkSection: 1234 },
		]);
	});

	it('handles a mix of in-bulk and out-of-bulk links on one section', () => {
		const source = v12Model([
			v12Section({
				portals: [
					v12Portal(1),    // in bulk
					v12Portal(99),   // out of bulk
					v12Portal(2),    // in bulk
				],
			}),
			v12Section(),
			v12Section(),
		]);
		const env = envelopeFor(source, new Set([0, 1, 2]));
		const out = importAISectionsBulk({
			envelope: env,
			destination: v12Model([]),
			mode: 'append',
			startId: 0,
		});
		expect(out.result.sections[0].portals[0].linkSection).toBe(1);
		expect(out.result.sections[0].portals[1].linkSection).toBe(NO_LINK_SENTINEL);
		expect(out.result.sections[0].portals[2].linkSection).toBe(2);
		expect(out.unlinkedPortals).toEqual([
			{ destinationSectionIdx: 0, portalIdx: 1, originalLinkSection: 99 },
		]);
	});
});

describe('importAISectionsBulk — V4 → V12', () => {
	it('migrates each item via migrateSectionV4toV12 and aggregates reports', () => {
		const source = {
			kind: 'v4' as const,
			version: 4,
			legacy: {
				version: 4 as const,
				sections: [
					legacySection({
						dangerRating: 0,
						portals: [{ midPosition: { x: 0, y: 0, z: 0, w: 7 }, boundaryLines: [], linkSection: 1 }],
					}),
					legacySection({ dangerRating: 1 }),
				],
			},
		};
		const env = envelopeFor(source, new Set([0, 1]));
		const dest = v12Model([]);
		const out = importAISectionsBulk({
			envelope: env,
			destination: dest,
			mode: 'append',
			startId: 0x9000,
		});
		expect(out.result.sections).toHaveLength(2);
		// V4 → V12 is lossy.
		expect(out.lossy.length).toBeGreaterThan(0);
		expect(out.lossy).toContain('sections[].speed (from dangerRating)');
		// Defaulted ids/spanIndex/district from per-section reports.
		expect(out.defaulted).toContain('sections[].id');
		expect(out.defaulted).toContain('sections[].spanIndex');
		expect(out.defaulted).toContain('sections[].district');
		// IDs assigned from startId regardless of any placeholder.
		expect(out.result.sections[0].id).toBe(0x9000);
		expect(out.result.sections[1].id).toBe(0x9001);
	});

	it('preserves V4 portal-link remap semantics', () => {
		// Section 0 portal points at section 1; both in the bulk.
		const source = {
			kind: 'v4' as const,
			version: 4,
			legacy: {
				version: 4 as const,
				sections: [
					legacySection({
						portals: [{ midPosition: { x: 0, y: 0, z: 0, w: 0 }, boundaryLines: [], linkSection: 1 }],
					}),
					legacySection(),
				],
			},
		};
		const env = envelopeFor(source, new Set([0, 1]));
		const out = importAISectionsBulk({
			envelope: env,
			destination: v12Model([v12Section()]), // length 1
			mode: 'append',
			startId: 0,
		});
		expect(out.result.sections[1].portals[0].linkSection).toBe(2);
	});

	it('records out-of-bulk V4 links as unlinked', () => {
		const source = {
			kind: 'v4' as const,
			version: 4,
			legacy: {
				version: 4 as const,
				sections: [
					legacySection({
						portals: [{ midPosition: { x: 0, y: 0, z: 0, w: 0 }, boundaryLines: [], linkSection: 999 }],
					}),
				],
			},
		};
		const env = envelopeFor(source, new Set([0]));
		const out = importAISectionsBulk({
			envelope: env,
			destination: v12Model([]),
			mode: 'append',
			startId: 0,
		});
		expect(out.unlinkedPortals).toHaveLength(1);
		expect(out.unlinkedPortals[0].originalLinkSection).toBe(999);
		expect(out.result.sections[0].portals[0].linkSection).toBe(NO_LINK_SENTINEL);
	});
});

describe('importAISectionsBulk — error paths', () => {
	it('throws on an unsupported envelope profile', () => {
		const env: BulkEnvelope<AISectionsBulkItem> = {
			kind: 'steward.bulk',
			version: 1,
			resourceKey: 'aiSections',
			profile: 'mystery',
			exportedAt: new Date().toISOString(),
			items: [],
		};
		expect(() =>
			importAISectionsBulk({
				envelope: env,
				destination: v12Model([]),
				mode: 'append',
				startId: 0,
			}),
		).toThrow(/unsupported envelope profile/i);
	});
});

describe('importAISectionsBulk — round-trip through writer', () => {
	it('NO_LINK_SENTINEL survives writeAISectionsData → parseAISectionsData', () => {
		// A section whose portal carries the sentinel must round-trip cleanly
		// through the binary writer/reader; otherwise the import flow would
		// produce data that corrupts on the next save.
		const source = v12Model([v12Section({ portals: [v12Portal(99)] })]);
		const env = envelopeFor(source, new Set([0]));
		const out = importAISectionsBulk({
			envelope: env,
			destination: v12Model([]),
			mode: 'append',
			startId: 0,
		});
		expect(out.result.sections[0].portals[0].linkSection).toBe(NO_LINK_SENTINEL);

		const bytes = writeAISectionsData(out.result, true);
		const reparsed = parseAISectionsData(bytes, true);
		if (reparsed.kind !== 'v12') throw new Error('expected v12');
		expect(reparsed.sections[0].portals[0].linkSection).toBe(NO_LINK_SENTINEL);
	});
});
