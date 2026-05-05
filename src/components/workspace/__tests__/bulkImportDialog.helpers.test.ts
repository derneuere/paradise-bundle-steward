// Spec for BulkImportDialog's pure helpers (Slice 2).

import { describe, it, expect } from 'vitest';
import {
	parseStartingId,
	defaultStartingId,
	detectIdCollisions,
	formatIdLabel,
} from '../bulkImportDialog.helpers';
import {
	SectionSpeed,
	type ParsedAISectionsV12,
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

function v12Model(ids: number[]): ParsedAISectionsV12 {
	return {
		kind: 'v12',
		version: 12,
		sectionMinSpeeds: [0, 0, 0, 0, 0],
		sectionMaxSpeeds: [0, 0, 0, 0, 0],
		sections: ids.map(v12Section),
		sectionResetPairs: [],
	};
}

describe('parseStartingId', () => {
	it('parses decimal', () => {
		expect(parseStartingId('1000')).toBe(1000);
		expect(parseStartingId('  42  ')).toBe(42);
		expect(parseStartingId('0')).toBe(0);
	});

	it('parses hex (0x prefix, lower + upper case)', () => {
		expect(parseStartingId('0x10')).toBe(16);
		expect(parseStartingId('0xFF')).toBe(255);
		expect(parseStartingId('0xdeadbeef')).toBe(0xdeadbeef);
	});

	it('rejects garbage input', () => {
		expect(parseStartingId('')).toBeNull();
		expect(parseStartingId('abc')).toBeNull();
		expect(parseStartingId('-5')).toBeNull();
		expect(parseStartingId('1.5')).toBeNull();
		expect(parseStartingId('0xZZ')).toBeNull();
	});
});

describe('defaultStartingId', () => {
	it('returns 0 for an empty destination', () => {
		expect(defaultStartingId(v12Model([]))).toBe(0);
	});

	it('returns max(id) + 1 for a non-empty destination', () => {
		expect(defaultStartingId(v12Model([100, 200, 50]))).toBe(201);
	});
});

describe('detectIdCollisions', () => {
	it('returns empty when no collisions', () => {
		expect(detectIdCollisions(v12Model([100, 200]), 1000, 5)).toEqual([]);
	});

	it('flags every colliding id in the proposed range', () => {
		expect(detectIdCollisions(v12Model([5, 10, 15]), 5, 12)).toEqual([5, 10, 15]);
	});

	it('handles count = 0 (no items)', () => {
		expect(detectIdCollisions(v12Model([5]), 0, 0)).toEqual([]);
	});
});

describe('formatIdLabel', () => {
	it('formats hex + decimal', () => {
		expect(formatIdLabel(0x9000)).toBe('0x9000 (36864)');
		expect(formatIdLabel(0)).toBe('0x0 (0)');
	});
});
