// Coverage for the AI Sections bulk-export pipeline (Slice 2).

import { describe, it, expect } from 'vitest';
import {
	SectionSpeed,
	type ParsedAISectionsV12,
	type ParsedAISectionsV4,
	type AISection,
	type LegacyAISection,
} from '@/lib/core/aiSections';
import { exportAISectionsBulk } from '../aiSectionsBulkExport';

function makeV12Section(overrides: Partial<AISection> = {}): AISection {
	return {
		portals: [],
		noGoLines: [],
		corners: [
			{ x: 0, y: 0 },
			{ x: 1, y: 0 },
			{ x: 1, y: 1 },
			{ x: 0, y: 1 },
		],
		id: 0,
		spanIndex: -1,
		speed: SectionSpeed.E_SECTION_SPEED_NORMAL,
		district: 0,
		flags: 0,
		...overrides,
	};
}

function makeV12Model(sections: AISection[]): ParsedAISectionsV12 {
	return {
		kind: 'v12',
		version: 12,
		sectionMinSpeeds: [0, 0, 0, 0, 0],
		sectionMaxSpeeds: [0, 0, 0, 0, 0],
		sections,
		sectionResetPairs: [],
	};
}

function makeLegacySection(
	overrides: Partial<LegacyAISection> = {},
): LegacyAISection {
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

function makeV4Model(sections: LegacyAISection[]): ParsedAISectionsV4 {
	return {
		kind: 'v4',
		version: 4,
		legacy: { version: 4, sections },
	};
}

describe('exportAISectionsBulk — V12 source', () => {
	it('emits items in ascending sourceIndex order regardless of click order', () => {
		const sections = [
			makeV12Section({ id: 100 }),
			makeV12Section({ id: 200 }),
			makeV12Section({ id: 300 }),
			makeV12Section({ id: 400 }),
		];
		const model = makeV12Model(sections);
		const env = exportAISectionsBulk({
			model,
			selectedSectionIndices: new Set([3, 0, 2]),
		});
		expect(env.items.map((i) => i.sourceIndex)).toEqual([0, 2, 3]);
	});

	it('writes profile = v12 and resourceKey = aiSections', () => {
		const env = exportAISectionsBulk({
			model: makeV12Model([makeV12Section()]),
			selectedSectionIndices: new Set([0]),
		});
		expect(env.profile).toBe('v12');
		expect(env.resourceKey).toBe('aiSections');
		expect(env.kind).toBe('steward.bulk');
		expect(env.version).toBe(1);
	});

	it('embeds the V12 AISection verbatim', () => {
		const section = makeV12Section({
			id: 42,
			speed: SectionSpeed.E_SECTION_SPEED_FAST,
			flags: 0x10,
		});
		const env = exportAISectionsBulk({
			model: makeV12Model([section]),
			selectedSectionIndices: new Set([0]),
		});
		expect(env.items[0].section).toEqual(section);
	});

	it('skips selected indices that are out of range', () => {
		const env = exportAISectionsBulk({
			model: makeV12Model([makeV12Section({ id: 1 })]),
			selectedSectionIndices: new Set([0, 5, 10]),
		});
		expect(env.items).toHaveLength(1);
		expect(env.items[0].sourceIndex).toBe(0);
	});

	it('returns empty items when no indices match', () => {
		const env = exportAISectionsBulk({
			model: makeV12Model([]),
			selectedSectionIndices: new Set(),
		});
		expect(env.items).toEqual([]);
	});

	it('includes sourceBundle when provided', () => {
		const env = exportAISectionsBulk({
			model: makeV12Model([makeV12Section()]),
			selectedSectionIndices: new Set([0]),
			sourceBundleFilename: 'AI.DAT',
		});
		expect(env.sourceBundle).toBe('AI.DAT');
	});

	it('omits sourceBundle when not provided', () => {
		const env = exportAISectionsBulk({
			model: makeV12Model([makeV12Section()]),
			selectedSectionIndices: new Set([0]),
		});
		expect(env.sourceBundle).toBeUndefined();
	});

	it('writes an ISO 8601 exportedAt timestamp', () => {
		const before = Date.now();
		const env = exportAISectionsBulk({
			model: makeV12Model([makeV12Section()]),
			selectedSectionIndices: new Set([0]),
		});
		const exportedMs = Date.parse(env.exportedAt);
		expect(Number.isFinite(exportedMs)).toBe(true);
		expect(exportedMs).toBeGreaterThanOrEqual(before - 1000);
	});

	it('drops negative or non-integer indices', () => {
		const env = exportAISectionsBulk({
			model: makeV12Model([makeV12Section(), makeV12Section()]),
			// Cast through unknown so we can simulate junk in the Set without
			// fighting the TS Set<number> signature.
			selectedSectionIndices: new Set([-1, 0.5, 1] as unknown as Iterable<number>),
		});
		expect(env.items.map((i) => i.sourceIndex)).toEqual([1]);
	});
});

describe('exportAISectionsBulk — V4 source', () => {
	it('writes profile = v4 and pulls from legacy.sections', () => {
		const sections = [
			makeLegacySection({ dangerRating: 0 }),
			makeLegacySection({ dangerRating: 1 }),
		];
		const env = exportAISectionsBulk({
			model: makeV4Model(sections),
			selectedSectionIndices: new Set([1]),
		});
		expect(env.profile).toBe('v4');
		expect(env.items).toHaveLength(1);
		expect(env.items[0].sourceIndex).toBe(1);
		expect((env.items[0].section as LegacyAISection).dangerRating).toBe(1);
	});

	it('embeds the LegacyAISection verbatim (no migration)', () => {
		const sec = makeLegacySection({
			dangerRating: 2,
			flags: 0x01,
			portals: [
				{
					midPosition: { x: 1, y: 2, z: 3, w: 99 },
					boundaryLines: [],
					linkSection: 5,
				},
			],
		});
		const env = exportAISectionsBulk({
			model: makeV4Model([sec]),
			selectedSectionIndices: new Set([0]),
		});
		expect(env.items[0].section).toEqual(sec);
		expect((env.items[0].section as LegacyAISection).portals[0].midPosition.w).toBe(99);
	});
});

describe('exportAISectionsBulk — V6 source', () => {
	it('writes profile = v6', () => {
		const env = exportAISectionsBulk({
			model: {
				kind: 'v6',
				version: 6,
				legacy: { version: 6, sections: [makeLegacySection()] },
			},
			selectedSectionIndices: new Set([0]),
		});
		expect(env.profile).toBe('v6');
		expect(env.items).toHaveLength(1);
	});
});
