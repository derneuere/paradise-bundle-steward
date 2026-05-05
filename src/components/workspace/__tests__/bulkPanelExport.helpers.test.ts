// Spec for the BulkPanel export helpers (Slice 2).

import { describe, it, expect } from 'vitest';
import {
	bulkPathKeysToSectionIndices,
	buildEnvelopeFromBulk,
	exportEnvelopeFilename,
} from '../bulkPanelExport.helpers';
import type { WorkspaceAISectionsBulkSummary } from '../AISectionsBulkProvider';
import {
	SectionSpeed,
	type ParsedAISectionsV12,
	type ParsedAISectionsV4,
	type AISection,
} from '@/lib/core/aiSections';

function v12Section(id: number): AISection {
	return {
		portals: [],
		noGoLines: [],
		corners: [
			{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 },
		],
		id,
		spanIndex: -1,
		speed: SectionSpeed.E_SECTION_SPEED_NORMAL,
		district: 0,
		flags: 0,
	};
}

function v12Model(sections: AISection[]): ParsedAISectionsV12 {
	return {
		kind: 'v12',
		version: 12,
		sectionMinSpeeds: [0, 0, 0, 0, 0],
		sectionMaxSpeeds: [0, 0, 0, 0, 0],
		sections,
		sectionResetPairs: [],
	};
}

function summary(pathKeys: string[]): WorkspaceAISectionsBulkSummary {
	return {
		bundleId: 'test.dat',
		index: 0,
		count: pathKeys.length,
		lastTouchedAt: 1000,
		pathKeys: new Set(pathKeys),
	};
}

describe('bulkPathKeysToSectionIndices', () => {
	it('decodes V12 path keys', () => {
		const indices = bulkPathKeysToSectionIndices(
			new Set(['sections/0', 'sections/5', 'sections/100']),
			'v12',
		);
		expect([...indices].sort((a, b) => a - b)).toEqual([0, 5, 100]);
	});

	it('decodes legacy path keys for v4 model', () => {
		const indices = bulkPathKeysToSectionIndices(
			new Set(['legacy/sections/0', 'legacy/sections/3']),
			'v4',
		);
		expect([...indices].sort((a, b) => a - b)).toEqual([0, 3]);
	});

	it('drops cross-variant keys (legacy keys against v12 model)', () => {
		const indices = bulkPathKeysToSectionIndices(
			new Set(['sections/0', 'legacy/sections/5']),
			'v12',
		);
		expect([...indices]).toEqual([0]);
	});

	it('drops malformed keys', () => {
		const indices = bulkPathKeysToSectionIndices(
			new Set(['header/flags', 'something/random/path']),
			'v12',
		);
		expect([...indices]).toEqual([]);
	});
});

describe('buildEnvelopeFromBulk', () => {
	it('produces a v12 envelope from V12 model + path keys', () => {
		const model = v12Model([v12Section(100), v12Section(200), v12Section(300)]);
		const env = buildEnvelopeFromBulk(
			model,
			summary(['sections/0', 'sections/2']),
			'AI.DAT',
		);
		expect(env.profile).toBe('v12');
		expect(env.resourceKey).toBe('aiSections');
		expect(env.sourceBundle).toBe('AI.DAT');
		expect(env.items.map((i) => i.sourceIndex)).toEqual([0, 2]);
	});

	it('produces a v4 envelope from V4 model + legacy path keys', () => {
		const v4Model: ParsedAISectionsV4 = {
			kind: 'v4',
			version: 4,
			legacy: {
				version: 4,
				sections: [
					{
						portals: [],
						noGoLines: [],
						cornersX: [0, 1, 1, 0],
						cornersZ: [0, 0, 1, 1],
						dangerRating: 1,
						flags: 0,
					},
				],
			},
		};
		const env = buildEnvelopeFromBulk(
			v4Model,
			summary(['legacy/sections/0']),
			'AI-v4.DAT',
		);
		expect(env.profile).toBe('v4');
		expect(env.items).toHaveLength(1);
	});
});

describe('exportEnvelopeFilename', () => {
	it('produces a stable filename with timestamp', () => {
		const d = new Date(2026, 4, 5, 13, 7, 9); // 2026-05-05 13:07:09 local
		expect(exportEnvelopeFilename('AI.DAT', d)).toBe(
			'bulk-aisections-AI-20260505-130709.json',
		);
	});

	it('strips file extension on the bundle name', () => {
		const d = new Date(2026, 0, 1, 0, 0, 0);
		expect(exportEnvelopeFilename('B5TRAFFIC.BNDL', d)).toBe(
			'bulk-aisections-B5TRAFFIC-20260101-000000.json',
		);
	});

	it('sanitises forbidden filename characters', () => {
		const d = new Date(2026, 0, 1, 0, 0, 0);
		expect(exportEnvelopeFilename('weird/name?.dat', d)).toMatch(
			/^bulk-aisections-weird_name_-20260101-000000\.json$/,
		);
	});
});
