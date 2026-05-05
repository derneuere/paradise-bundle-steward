// Pure-helper coverage for the AI Sections bulk reducer + path codec.
//
// The provider that wraps these helpers is React + context; testing them
// here at the pure-function level lets us pin the load-bearing contract
// (sub-paths collapse to their parent section, range expands inclusively,
// cross-variant ranges degrade gracefully) without spinning up react-dom.

import { describe, it, expect } from 'vitest';
import {
	applyPaths,
	normaliseToSectionPath,
	parseSectionAddress,
	parseSectionPathKey,
	pruneStaleSections,
	rangeAddSections,
	sectionPathKey,
	toggleSection,
} from '../aiSectionsBulk';

describe('parseSectionAddress', () => {
	it('decodes V12 paths at the section level and below', () => {
		expect(parseSectionAddress(['sections', 5])).toEqual({
			variant: 'v12',
			sectionIndex: 5,
		});
		expect(parseSectionAddress(['sections', 5, 'portals', 2])).toEqual({
			variant: 'v12',
			sectionIndex: 5,
		});
		expect(
			parseSectionAddress(['sections', 5, 'portals', 2, 'boundaryLines', 1, 'verts', 'x']),
		).toEqual({ variant: 'v12', sectionIndex: 5 });
	});

	it('decodes V4/V6 paths under the legacy wrapper', () => {
		expect(parseSectionAddress(['legacy', 'sections', 7])).toEqual({
			variant: 'legacy',
			sectionIndex: 7,
		});
		expect(parseSectionAddress(['legacy', 'sections', 7, 'noGoLines', 0])).toEqual({
			variant: 'legacy',
			sectionIndex: 7,
		});
	});

	it('returns null for paths outside an AI Sections resource', () => {
		expect(parseSectionAddress([])).toBeNull();
		expect(parseSectionAddress(['header'])).toBeNull();
		expect(parseSectionAddress(['sections'])).toBeNull();
		expect(parseSectionAddress(['legacy'])).toBeNull();
		expect(parseSectionAddress(['legacy', 'sections'])).toBeNull();
	});

	it('rejects V12 paths when the index is non-numeric (defensive)', () => {
		expect(
			parseSectionAddress(['sections', 'oops' as unknown as number]),
		).toBeNull();
	});
});

describe('normaliseToSectionPath', () => {
	it('preserves bare section paths', () => {
		expect(normaliseToSectionPath(['sections', 3])).toEqual(['sections', 3]);
		expect(normaliseToSectionPath(['legacy', 'sections', 4])).toEqual([
			'legacy',
			'sections',
			4,
		]);
	});

	it('collapses sub-paths to the containing section', () => {
		expect(normaliseToSectionPath(['sections', 3, 'portals', 1])).toEqual([
			'sections',
			3,
		]);
		expect(
			normaliseToSectionPath(['sections', 3, 'portals', 1, 'boundaryLines', 0]),
		).toEqual(['sections', 3]);
		expect(normaliseToSectionPath(['sections', 3, 'noGoLines', 5])).toEqual([
			'sections',
			3,
		]);
		expect(
			normaliseToSectionPath(['legacy', 'sections', 3, 'portals', 1]),
		).toEqual(['legacy', 'sections', 3]);
	});

	it('returns null for non-AI paths', () => {
		expect(normaliseToSectionPath(['unrelated'])).toBeNull();
		expect(normaliseToSectionPath([])).toBeNull();
	});
});

describe('sectionPathKey / parseSectionPathKey', () => {
	it('round-trips V12 paths', () => {
		const key = sectionPathKey(['sections', 42]);
		expect(key).toBe('sections/42');
		expect(parseSectionPathKey(key)).toEqual({ variant: 'v12', sectionIndex: 42 });
	});

	it('round-trips legacy paths', () => {
		const key = sectionPathKey(['legacy', 'sections', 7]);
		expect(key).toBe('legacy/sections/7');
		expect(parseSectionPathKey(key)).toEqual({
			variant: 'legacy',
			sectionIndex: 7,
		});
	});

	it('returns null for malformed keys (forward-compat — old shapes ignored)', () => {
		expect(parseSectionPathKey('soups/0/polygons/1')).toBeNull();
		expect(parseSectionPathKey('sections')).toBeNull();
		expect(parseSectionPathKey('legacy/sections/oops')).toBeNull();
	});
});

describe('toggleSection', () => {
	it('adds a section path that wasn’t in the set', () => {
		const next = toggleSection(new Set(), ['sections', 5]);
		expect([...next]).toEqual(['sections/5']);
	});

	it('removes a section path that was already in the set', () => {
		const start = new Set(['sections/5', 'sections/7']);
		const next = toggleSection(start, ['sections', 5]);
		expect([...next].sort()).toEqual(['sections/7']);
	});

	it('normalises sub-paths to the containing section before toggling', () => {
		const start = new Set<string>();
		const next = toggleSection(start, ['sections', 5, 'portals', 3, 'boundaryLines', 1]);
		expect([...next]).toEqual(['sections/5']);
	});

	it('toggles V12 and legacy independently — same index, different variants', () => {
		let s: ReadonlySet<string> = new Set();
		s = toggleSection(s, ['sections', 5]);
		s = toggleSection(s, ['legacy', 'sections', 5]);
		expect(s.size).toBe(2);
		expect(s.has('sections/5')).toBe(true);
		expect(s.has('legacy/sections/5')).toBe(true);
	});

	it('is a no-op for paths outside an AI Sections resource', () => {
		const start = new Set(['sections/5']);
		const next = toggleSection(start, ['unrelated', 'field']);
		expect([...next]).toEqual([...start]);
	});
});

describe('rangeAddSections', () => {
	it('adds every V12 section between `from` and `to` inclusive', () => {
		const next = rangeAddSections(new Set(), ['sections', 2], ['sections', 5]);
		expect([...next].sort()).toEqual([
			'sections/2',
			'sections/3',
			'sections/4',
			'sections/5',
		]);
	});

	it('handles `from > to` by walking the range in reverse', () => {
		const next = rangeAddSections(new Set(), ['sections', 5], ['sections', 2]);
		expect([...next].sort()).toEqual([
			'sections/2',
			'sections/3',
			'sections/4',
			'sections/5',
		]);
	});

	it('falls back to "just add the endpoint" when there’s no anchor', () => {
		const next = rangeAddSections(new Set(), [], ['sections', 5]);
		expect([...next]).toEqual(['sections/5']);
	});

	it('falls back to "just add the endpoint" when anchor and target differ in variant', () => {
		const next = rangeAddSections(
			new Set(),
			['sections', 2],
			['legacy', 'sections', 5],
		);
		expect([...next]).toEqual(['legacy/sections/5']);
	});

	it('unions into an existing set without dropping prior entries', () => {
		const start = new Set(['sections/100', 'legacy/sections/9']);
		const next = rangeAddSections(start, ['sections', 0], ['sections', 1]);
		expect([...next].sort()).toEqual([
			'legacy/sections/9',
			'sections/0',
			'sections/1',
			'sections/100',
		]);
	});

	it('is a no-op when the target path isn’t bulk-eligible', () => {
		const start = new Set(['sections/5']);
		const next = rangeAddSections(start, ['sections', 0], ['unrelated']);
		expect([...next]).toEqual([...start]);
	});
});

describe('applyPaths', () => {
	it('adds every input path to an empty set', () => {
		const next = applyPaths(new Set(), [
			['sections', 1],
			['sections', 2],
			['sections', 3],
		], 'add');
		expect([...next].sort()).toEqual(['sections/1', 'sections/2', 'sections/3']);
	});

	it('unions into a non-empty set without dropping prior entries', () => {
		const start = new Set(['sections/9']);
		const next = applyPaths(start, [['sections', 1], ['sections', 2]], 'add');
		expect([...next].sort()).toEqual(['sections/1', 'sections/2', 'sections/9']);
	});

	it('removes entries that exist in the set', () => {
		const start = new Set(['sections/1', 'sections/2', 'sections/3']);
		const next = applyPaths(start, [['sections', 2]], 'remove');
		expect([...next].sort()).toEqual(['sections/1', 'sections/3']);
	});

	it('is a no-op when removing entries that are not in the set', () => {
		const start = new Set(['sections/1']);
		const next = applyPaths(start, [['sections', 99]], 'remove');
		expect([...next].sort()).toEqual(['sections/1']);
	});

	it('silently skips paths outside an AI Sections resource (mixed valid + invalid)', () => {
		const next = applyPaths(new Set(), [
			['sections', 1],
			['header', 'flags'],
			['unrelated'],
			['sections', 4],
		], 'add');
		expect([...next].sort()).toEqual(['sections/1', 'sections/4']);
	});

	it('normalises sub-paths to the containing section before applying', () => {
		// The marquee never emits sub-paths today, but this property keeps
		// the API symmetric with `toggleSection` so a future caller passing
		// e.g. portal paths still ends up with section-level keys.
		const next = applyPaths(new Set(), [
			['sections', 5, 'portals', 3],
			['sections', 5, 'noGoLines', 0],
			['legacy', 'sections', 7, 'portals', 2, 'boundaryLines', 1],
		], 'add');
		expect([...next].sort()).toEqual(['legacy/sections/7', 'sections/5']);
	});

	it('handles V12 + legacy path shapes in the same call', () => {
		const next = applyPaths(new Set(), [
			['sections', 1],
			['legacy', 'sections', 1],
		], 'add');
		expect([...next].sort()).toEqual(['legacy/sections/1', 'sections/1']);
	});
});

describe('pruneStaleSections', () => {
	it('drops V12 entries whose section index is at or beyond the new max', () => {
		const start = new Set(['sections/0', 'sections/3', 'sections/10']);
		const next = pruneStaleSections(start, 'v12', 5);
		expect([...next].sort()).toEqual(['sections/0', 'sections/3']);
	});

	it('only prunes the variant it was asked about', () => {
		const start = new Set(['sections/10', 'legacy/sections/10']);
		const next = pruneStaleSections(start, 'v12', 5);
		expect([...next].sort()).toEqual(['legacy/sections/10']);
	});

	it('drops malformed keys (forward-compat sweep)', () => {
		const start = new Set(['sections/0', 'soups/0/polygons/1']);
		const next = pruneStaleSections(start, 'v12', 5);
		expect([...next]).toEqual(['sections/0']);
	});
});
