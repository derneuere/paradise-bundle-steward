// Spec test for `BulkPanelStack` ordering. The repo's vitest env is `node`
// with no jsdom — see ConversionProvenanceBanner.test.ts for the pattern —
// so we don't mount React. The sort helper is the load-bearing piece (one
// panel per bulk, ordered most-recently-touched first); pinning it here
// covers the user-visible contract without a DOM.

import { describe, it, expect } from 'vitest';
import { sortBulkSummaries } from '../bulkPanelStack.helpers';
import type { WorkspaceAISectionsBulkSummary } from '../AISectionsBulkProvider';

function makeSummary(
	bundleId: string,
	index: number,
	count: number,
	lastTouchedAt: number,
): WorkspaceAISectionsBulkSummary {
	return {
		bundleId,
		index,
		count,
		lastTouchedAt,
		pathKeys: new Set([`sections/${index}`]),
	};
}

describe('sortBulkSummaries', () => {
	it('returns most-recently-touched first', () => {
		const summaries: WorkspaceAISectionsBulkSummary[] = [
			makeSummary('a.dat', 0, 1, 1000),
			makeSummary('b.dat', 0, 2, 3000),
			makeSummary('c.dat', 0, 3, 2000),
		];
		const sorted = sortBulkSummaries(summaries);
		expect(sorted.map((s) => s.bundleId)).toEqual(['b.dat', 'c.dat', 'a.dat']);
	});

	it('preserves input order on equal timestamps (stable sort)', () => {
		const summaries: WorkspaceAISectionsBulkSummary[] = [
			makeSummary('first.dat', 0, 1, 1000),
			makeSummary('second.dat', 0, 1, 1000),
			makeSummary('third.dat', 0, 1, 1000),
		];
		const sorted = sortBulkSummaries(summaries);
		expect(sorted.map((s) => s.bundleId)).toEqual([
			'first.dat',
			'second.dat',
			'third.dat',
		]);
	});

	it('does not mutate the input', () => {
		const summaries: WorkspaceAISectionsBulkSummary[] = [
			makeSummary('a.dat', 0, 1, 1000),
			makeSummary('b.dat', 0, 1, 2000),
		];
		const before = summaries.map((s) => s.bundleId);
		sortBulkSummaries(summaries);
		expect(summaries.map((s) => s.bundleId)).toEqual(before);
	});

	it('handles an empty input', () => {
		expect(sortBulkSummaries([])).toEqual([]);
	});
});
