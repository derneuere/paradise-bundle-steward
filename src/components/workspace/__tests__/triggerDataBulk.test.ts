// Pure-helper coverage for the TriggerData bulk reducer + path codec.
//
// The provider that wraps these helpers is React + context; testing them
// here at the pure-function level lets us pin the load-bearing contract
// (sub-paths collapse to their parent entry, range expands inclusively,
// cross-list ranges degrade gracefully) without spinning up react-dom.
//
// Mirrors `aiSectionsBulk.test.ts` — same shape, same coverage targets.

import { describe, it, expect } from 'vitest';
import {
	applyPaths,
	entryPathKey,
	normaliseToEntryPath,
	parseEntryAddress,
	parseEntryPathKey,
	pruneStaleEntries,
	rangeAddEntries,
	toggleEntry,
} from '../triggerDataBulk';

describe('parseEntryAddress', () => {
	it('decodes top-level entry paths for every bulk-eligible list', () => {
		expect(parseEntryAddress(['landmarks', 0])).toEqual({
			listKey: 'landmarks',
			index: 0,
		});
		expect(parseEntryAddress(['genericRegions', 7])).toEqual({
			listKey: 'genericRegions',
			index: 7,
		});
		expect(parseEntryAddress(['blackspots', 3])).toEqual({
			listKey: 'blackspots',
			index: 3,
		});
		expect(parseEntryAddress(['vfxBoxRegions', 2])).toEqual({
			listKey: 'vfxBoxRegions',
			index: 2,
		});
		expect(parseEntryAddress(['spawnLocations', 5])).toEqual({
			listKey: 'spawnLocations',
			index: 5,
		});
		expect(parseEntryAddress(['roamingLocations', 99])).toEqual({
			listKey: 'roamingLocations',
			index: 99,
		});
	});

	it('decodes sub-paths under an entry to the entry itself', () => {
		expect(
			parseEntryAddress(['landmarks', 3, 'box', 'position', 'x']),
		).toEqual({ listKey: 'landmarks', index: 3 });
		expect(
			parseEntryAddress(['roamingLocations', 5, 'position']),
		).toEqual({ listKey: 'roamingLocations', index: 5 });
	});

	it('returns null for player-start singletons (no bulk-set of one)', () => {
		expect(parseEntryAddress(['playerStartPosition'])).toBeNull();
		expect(parseEntryAddress(['playerStartDirection'])).toBeNull();
	});

	it('returns null for non-bulk-eligible top-level fields', () => {
		expect(parseEntryAddress([])).toBeNull();
		expect(parseEntryAddress(['header'])).toBeNull();
		expect(parseEntryAddress(['unknownList', 0])).toBeNull();
		expect(parseEntryAddress(['landmarks'])).toBeNull();
	});

	it('rejects entry paths when the index segment is non-numeric (defensive)', () => {
		expect(
			parseEntryAddress(['landmarks', 'oops' as unknown as number]),
		).toBeNull();
	});
});

describe('normaliseToEntryPath', () => {
	it('preserves bare entry paths', () => {
		expect(normaliseToEntryPath(['landmarks', 3])).toEqual(['landmarks', 3]);
		expect(normaliseToEntryPath(['roamingLocations', 5])).toEqual([
			'roamingLocations',
			5,
		]);
	});

	it('collapses sub-paths to the containing entry', () => {
		expect(normaliseToEntryPath(['landmarks', 3, 'box', 'position'])).toEqual([
			'landmarks',
			3,
		]);
		expect(
			normaliseToEntryPath(['vfxBoxRegions', 0, 'box', 'dimensions', 'y']),
		).toEqual(['vfxBoxRegions', 0]);
	});

	it('returns null for non-entry paths', () => {
		expect(normaliseToEntryPath(['playerStartPosition'])).toBeNull();
		expect(normaliseToEntryPath(['header', 'flags'])).toBeNull();
		expect(normaliseToEntryPath([])).toBeNull();
	});
});

describe('entryPathKey / parseEntryPathKey', () => {
	it('round-trips landmark entry paths', () => {
		const key = entryPathKey(['landmarks', 42]);
		expect(key).toBe('landmarks/42');
		expect(parseEntryPathKey(key)).toEqual({ listKey: 'landmarks', index: 42 });
	});

	it('round-trips roamingLocations paths', () => {
		const key = entryPathKey(['roamingLocations', 7]);
		expect(key).toBe('roamingLocations/7');
		expect(parseEntryPathKey(key)).toEqual({
			listKey: 'roamingLocations',
			index: 7,
		});
	});

	it('returns null for malformed keys (forward-compat — old shapes ignored)', () => {
		expect(parseEntryPathKey('sections/0')).toBeNull();
		expect(parseEntryPathKey('landmarks')).toBeNull();
		expect(parseEntryPathKey('landmarks/oops')).toBeNull();
		expect(parseEntryPathKey('unknown/1')).toBeNull();
		expect(parseEntryPathKey('landmarks/3/box')).toBeNull();
	});
});

describe('toggleEntry', () => {
	it('adds an entry path that wasn’t in the set', () => {
		const next = toggleEntry(new Set(), ['landmarks', 5]);
		expect([...next]).toEqual(['landmarks/5']);
	});

	it('removes an entry path that was already in the set', () => {
		const start = new Set(['landmarks/5', 'landmarks/7']);
		const next = toggleEntry(start, ['landmarks', 5]);
		expect([...next].sort()).toEqual(['landmarks/7']);
	});

	it('normalises sub-paths to the containing entry before toggling', () => {
		const start = new Set<string>();
		const next = toggleEntry(start, [
			'landmarks',
			5,
			'box',
			'position',
			'x',
		]);
		expect([...next]).toEqual(['landmarks/5']);
	});

	it('treats different lists at the same index as independent entries', () => {
		let s: ReadonlySet<string> = new Set();
		s = toggleEntry(s, ['landmarks', 5]);
		s = toggleEntry(s, ['blackspots', 5]);
		s = toggleEntry(s, ['roamingLocations', 5]);
		expect(s.size).toBe(3);
		expect(s.has('landmarks/5')).toBe(true);
		expect(s.has('blackspots/5')).toBe(true);
		expect(s.has('roamingLocations/5')).toBe(true);
	});

	it('is a no-op for player-start singletons', () => {
		const start = new Set(['landmarks/5']);
		const next = toggleEntry(start, ['playerStartPosition']);
		expect([...next]).toEqual([...start]);
	});

	it('is a no-op for paths outside any bulk-eligible list', () => {
		const start = new Set(['landmarks/5']);
		const next = toggleEntry(start, ['header', 'flags']);
		expect([...next]).toEqual([...start]);
	});
});

describe('rangeAddEntries', () => {
	it('adds every entry between `from` and `to` inclusive in the same list', () => {
		const next = rangeAddEntries(
			new Set(),
			['landmarks', 2],
			['landmarks', 5],
		);
		expect([...next].sort()).toEqual([
			'landmarks/2',
			'landmarks/3',
			'landmarks/4',
			'landmarks/5',
		]);
	});

	it('handles `from > to` by walking the range in reverse', () => {
		const next = rangeAddEntries(
			new Set(),
			['blackspots', 5],
			['blackspots', 2],
		);
		expect([...next].sort()).toEqual([
			'blackspots/2',
			'blackspots/3',
			'blackspots/4',
			'blackspots/5',
		]);
	});

	it('falls back to "just add the endpoint" when there’s no anchor', () => {
		const next = rangeAddEntries(new Set(), [], ['roamingLocations', 5]);
		expect([...next]).toEqual(['roamingLocations/5']);
	});

	it('falls back to "just add the endpoint" when anchor and target differ in list', () => {
		const next = rangeAddEntries(
			new Set(),
			['landmarks', 2],
			['blackspots', 5],
		);
		expect([...next]).toEqual(['blackspots/5']);
	});

	it('unions into an existing set without dropping prior entries', () => {
		const start = new Set(['landmarks/100', 'roamingLocations/9']);
		const next = rangeAddEntries(start, ['landmarks', 0], ['landmarks', 1]);
		expect([...next].sort()).toEqual([
			'landmarks/0',
			'landmarks/1',
			'landmarks/100',
			'roamingLocations/9',
		]);
	});

	it('is a no-op when the target path isn’t bulk-eligible', () => {
		const start = new Set(['landmarks/5']);
		const next = rangeAddEntries(
			start,
			['landmarks', 0],
			['playerStartPosition'],
		);
		expect([...next]).toEqual([...start]);
	});
});

describe('applyPaths', () => {
	it('adds every input path to an empty set', () => {
		const next = applyPaths(
			new Set(),
			[
				['landmarks', 1],
				['blackspots', 2],
				['roamingLocations', 3],
			],
			'add',
		);
		expect([...next].sort()).toEqual([
			'blackspots/2',
			'landmarks/1',
			'roamingLocations/3',
		]);
	});

	it('unions into a non-empty set without dropping prior entries', () => {
		const start = new Set(['landmarks/9']);
		const next = applyPaths(
			start,
			[
				['landmarks', 1],
				['landmarks', 2],
			],
			'add',
		);
		expect([...next].sort()).toEqual([
			'landmarks/1',
			'landmarks/2',
			'landmarks/9',
		]);
	});

	it('removes entries that exist in the set', () => {
		const start = new Set([
			'landmarks/1',
			'landmarks/2',
			'roamingLocations/3',
		]);
		const next = applyPaths(start, [['landmarks', 2]], 'remove');
		expect([...next].sort()).toEqual(['landmarks/1', 'roamingLocations/3']);
	});

	it('is a no-op when removing entries that are not in the set', () => {
		const start = new Set(['landmarks/1']);
		const next = applyPaths(start, [['landmarks', 99]], 'remove');
		expect([...next].sort()).toEqual(['landmarks/1']);
	});

	it('silently skips non-entry paths (mixed valid + invalid)', () => {
		const next = applyPaths(
			new Set(),
			[
				['landmarks', 1],
				['header', 'flags'],
				['playerStartPosition'],
				['landmarks', 4],
			],
			'add',
		);
		expect([...next].sort()).toEqual(['landmarks/1', 'landmarks/4']);
	});

	it('normalises sub-paths to the containing entry before applying', () => {
		// The marquee never emits sub-paths today, but this property keeps the
		// API symmetric with `toggleEntry` so a future caller passing e.g. box-
		// position paths still ends up with entry-level keys.
		const next = applyPaths(
			new Set(),
			[
				['landmarks', 5, 'box', 'position'],
				['vfxBoxRegions', 7, 'box', 'dimensions', 'y'],
			],
			'add',
		);
		expect([...next].sort()).toEqual(['landmarks/5', 'vfxBoxRegions/7']);
	});

	it('handles every entry kind in the same call', () => {
		const next = applyPaths(
			new Set(),
			[
				['landmarks', 1],
				['genericRegions', 1],
				['blackspots', 1],
				['vfxBoxRegions', 1],
				['spawnLocations', 1],
				['roamingLocations', 1],
			],
			'add',
		);
		expect([...next].sort()).toEqual([
			'blackspots/1',
			'genericRegions/1',
			'landmarks/1',
			'roamingLocations/1',
			'spawnLocations/1',
			'vfxBoxRegions/1',
		]);
	});
});

describe('pruneStaleEntries', () => {
	it('drops entries whose index is at or beyond the new max', () => {
		const start = new Set(['landmarks/0', 'landmarks/3', 'landmarks/10']);
		const next = pruneStaleEntries(start, 'landmarks', 5);
		expect([...next].sort()).toEqual(['landmarks/0', 'landmarks/3']);
	});

	it('only prunes the list it was asked about', () => {
		const start = new Set(['landmarks/10', 'roamingLocations/10']);
		const next = pruneStaleEntries(start, 'landmarks', 5);
		expect([...next].sort()).toEqual(['roamingLocations/10']);
	});

	it('drops malformed keys (forward-compat sweep)', () => {
		const start = new Set(['landmarks/0', 'sections/0/portals/1']);
		const next = pruneStaleEntries(start, 'landmarks', 5);
		expect([...next]).toEqual(['landmarks/0']);
	});
});
