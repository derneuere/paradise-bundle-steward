// Covers the pure bulk-row accent resolution that drives the amber tint /
// count badge on hierarchy rows. The precedence itself is trivial; the
// load-bearing behaviour is the per-resource prefix rule: aiSections and
// triggerData collapse a clicked sub-path to its containing entry, so a
// sub-row must inherit the tint via prefix — while PSL polygons are leaves
// and match by exact path only.

import { describe, it, expect } from 'vitest';
import {
	isPathInsideBulkMember,
	rowIsInBulk,
} from '../WorkspaceHierarchy.helpers';

describe('isPathInsideBulkMember', () => {
	it('matches an exact entry path', () => {
		expect(
			isPathInsideBulkMember(['genericRegions', 3], new Set(['genericRegions/3'])),
		).toBe(true);
	});

	it('matches a sub-path of a bulk-member entry (prefix)', () => {
		expect(
			isPathInsideBulkMember(
				['genericRegions', 3, 'box', 'position', 'x'],
				new Set(['genericRegions/3']),
			),
		).toBe(true);
	});

	it('does not match a sibling index', () => {
		expect(
			isPathInsideBulkMember(['genericRegions', 4], new Set(['genericRegions/3'])),
		).toBe(false);
	});

	it('does not match across lists', () => {
		expect(
			isPathInsideBulkMember(['landmarks', 3], new Set(['genericRegions/3'])),
		).toBe(false);
	});

	it('never treats a longer key as a prefix of a shorter path', () => {
		expect(
			isPathInsideBulkMember(['genericRegions'], new Set(['genericRegions/3'])),
		).toBe(false);
	});
});

describe('rowIsInBulk', () => {
	it('returns false when there is no active bulk', () => {
		expect(rowIsInBulk('triggerData', ['genericRegions', 3], null)).toBe(false);
	});

	it('tints a triggerData entry row on a direct match', () => {
		expect(
			rowIsInBulk('triggerData', ['genericRegions', 3], new Set(['genericRegions/3'])),
		).toBe(true);
	});

	it('tints a triggerData sub-row via prefix (box field under a bulk entry)', () => {
		expect(
			rowIsInBulk(
				'triggerData',
				['genericRegions', 3, 'box', 'dimensions'],
				new Set(['genericRegions/3']),
			),
		).toBe(true);
	});

	it('tints trigger entries across every bulk-eligible list', () => {
		const keys = new Set([
			'landmarks/0',
			'blackspots/1',
			'vfxBoxRegions/2',
			'spawnLocations/3',
			'roamingLocations/4',
		]);
		expect(rowIsInBulk('triggerData', ['landmarks', 0], keys)).toBe(true);
		expect(rowIsInBulk('triggerData', ['blackspots', 1], keys)).toBe(true);
		expect(rowIsInBulk('triggerData', ['vfxBoxRegions', 2], keys)).toBe(true);
		expect(rowIsInBulk('triggerData', ['spawnLocations', 3], keys)).toBe(true);
		expect(rowIsInBulk('triggerData', ['roamingLocations', 4], keys)).toBe(true);
	});

	it('does not tint a non-selected trigger row', () => {
		expect(
			rowIsInBulk('triggerData', ['genericRegions', 9], new Set(['genericRegions/3'])),
		).toBe(false);
	});

	it('preserves the aiSections prefix behaviour (portal row under a bulk section)', () => {
		expect(
			rowIsInBulk('aiSections', ['sections', 5, 'portals', 0], new Set(['sections/5'])),
		).toBe(true);
	});

	it('keeps PSL to exact-match only (a poly sub-row does NOT inherit the tint)', () => {
		const keys = new Set(['polys/2']);
		expect(rowIsInBulk('polygonSoupList', ['polys', 2], keys)).toBe(true);
		expect(rowIsInBulk('polygonSoupList', ['polys', 2, 'verts', 0], keys)).toBe(false);
	});
});
