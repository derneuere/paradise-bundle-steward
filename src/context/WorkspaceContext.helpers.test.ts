// Unit tests for the WorkspaceContext pure-function helpers.
//
// These cover the model-edit and visibility-cascade reducers backing the
// React provider — the React layer just calls into these. Selection and
// loadBundle round-trip are exercised in the sibling integration test.

import { describe, expect, it } from 'vitest';
import {
	ancestorKeys,
	applyResourceWriteToBundle,
	clearBundleDirty,
	isVisibleIn,
	visibilityKey,
	visibilityKeysForBundle,
} from './WorkspaceContext.helpers';
import type { EditableBundle } from './WorkspaceContext.types';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeBundle(id = 'TEST.BNDL'): EditableBundle {
	return {
		id,
		// `originalArrayBuffer` and `parsed` aren't read by these helpers.
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		originalArrayBuffer: new ArrayBuffer(0) as any,
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		parsed: {} as any,
		resources: [],
		debugResources: [],
		parsedResources: new Map(),
		parsedResourcesAll: new Map(),
		dirtyMulti: new Set(),
		isModified: false,
	};
}

// ---------------------------------------------------------------------------
// Visibility helpers
// ---------------------------------------------------------------------------

describe('visibilityKey', () => {
	it('encodes Bundle-level nodes as just the BundleId', () => {
		expect(visibilityKey({ bundleId: 'A.BNDL' })).toBe('A.BNDL');
	});

	it('encodes resource-key nodes with a single delimiter', () => {
		expect(visibilityKey({ bundleId: 'A.BNDL', resourceKey: 'streetData' })).toBe(
			'A.BNDL::streetData',
		);
	});

	it('encodes index nodes with both delimiters and the index', () => {
		expect(
			visibilityKey({ bundleId: 'A.BNDL', resourceKey: 'polygonSoupList', index: 7 }),
		).toBe('A.BNDL::polygonSoupList::7');
	});
});

describe('ancestorKeys', () => {
	it('returns [] for a Bundle-level node — top of the hierarchy', () => {
		expect(ancestorKeys({ bundleId: 'A.BNDL' })).toEqual([]);
	});

	it('returns just the Bundle for a resource-key node', () => {
		expect(ancestorKeys({ bundleId: 'A.BNDL', resourceKey: 'streetData' })).toEqual([
			'A.BNDL',
		]);
	});

	it('returns Bundle then resource-key for an index node', () => {
		expect(
			ancestorKeys({ bundleId: 'A.BNDL', resourceKey: 'polygonSoupList', index: 7 }),
		).toEqual(['A.BNDL', 'A.BNDL::polygonSoupList']);
	});
});

describe('isVisibleIn — default-true semantics + ancestor cascade', () => {
	it('returns true when the visibility map is empty', () => {
		const v = new Map<string, boolean>();
		expect(isVisibleIn(v, { bundleId: 'A' })).toBe(true);
		expect(isVisibleIn(v, { bundleId: 'A', resourceKey: 'streetData' })).toBe(true);
		expect(
			isVisibleIn(v, { bundleId: 'A', resourceKey: 'polygonSoupList', index: 0 }),
		).toBe(true);
	});

	it('honours an explicit false on the node itself', () => {
		const v = new Map([['A', false]]);
		expect(isVisibleIn(v, { bundleId: 'A' })).toBe(false);
	});

	it('cascades: hiding a Bundle hides every nested resource', () => {
		const v = new Map([['A', false]]);
		expect(isVisibleIn(v, { bundleId: 'A', resourceKey: 'streetData' })).toBe(false);
		expect(
			isVisibleIn(v, { bundleId: 'A', resourceKey: 'polygonSoupList', index: 7 }),
		).toBe(false);
	});

	it('cascade is one-way — explicit re-enable on a child does NOT override a hidden ancestor', () => {
		const v = new Map<string, boolean>([
			['A', false],
			['A::streetData', true],
		]);
		// Documented behaviour: hidden ancestor wins. Re-enabling a child while
		// the Bundle is hidden has no effect — toggle the Bundle back on first.
		expect(isVisibleIn(v, { bundleId: 'A', resourceKey: 'streetData' })).toBe(false);
	});

	it('hides one resource-key without hiding siblings or the Bundle itself', () => {
		const v = new Map([['A::streetData', false]]);
		expect(isVisibleIn(v, { bundleId: 'A' })).toBe(true);
		expect(isVisibleIn(v, { bundleId: 'A', resourceKey: 'streetData' })).toBe(false);
		expect(isVisibleIn(v, { bundleId: 'A', resourceKey: 'aiSections' })).toBe(true);
	});
});

describe('visibilityKeysForBundle', () => {
	it('returns every key referencing the Bundle (own + nested)', () => {
		const v = new Map<string, boolean>([
			['A', false],
			['A::streetData', false],
			['A::polygonSoupList::3', true],
			['B', false],
			['B::streetData', false],
		]);
		const dropped = visibilityKeysForBundle(v, 'A').sort();
		expect(dropped).toEqual(['A', 'A::polygonSoupList::3', 'A::streetData']);
	});

	it('does not match Bundles whose id is a prefix of another', () => {
		const v = new Map<string, boolean>([
			['A', false],
			['A.BNDL', false],
			['A.BNDL::streetData', false],
		]);
		// 'A' should match only 'A' — not the longer Bundle ids.
		expect(visibilityKeysForBundle(v, 'A')).toEqual(['A']);
	});
});

// ---------------------------------------------------------------------------
// EditableBundle reducer
// ---------------------------------------------------------------------------

describe('applyResourceWriteToBundle', () => {
	it('writes a single-instance resource at index 0 and mirrors into parsedResources', () => {
		const next = applyResourceWriteToBundle(makeBundle(), 'streetData', 0, { v: 42 });
		expect(next.parsedResourcesAll.get('streetData')).toEqual([{ v: 42 }]);
		expect(next.parsedResources.get('streetData')).toEqual({ v: 42 });
		expect(next.dirtyMulti.has('streetData:0')).toBe(true);
		expect(next.isModified).toBe(true);
	});

	it('writes index N>0 without touching the single-instance shortcut', () => {
		const next = applyResourceWriteToBundle(makeBundle(), 'polygonSoupList', 3, {
			soup: 'three',
		});
		expect(next.parsedResourcesAll.get('polygonSoupList')).toEqual([
			null,
			null,
			null,
			{ soup: 'three' },
		]);
		expect(next.parsedResources.has('polygonSoupList')).toBe(false);
		expect(next.dirtyMulti.has('polygonSoupList:3')).toBe(true);
	});

	it('does NOT mutate the input bundle (immutable update)', () => {
		const before = makeBundle();
		applyResourceWriteToBundle(before, 'streetData', 0, { v: 1 });
		expect(before.parsedResourcesAll.has('streetData')).toBe(false);
		expect(before.parsedResources.has('streetData')).toBe(false);
		expect(before.dirtyMulti.size).toBe(0);
		expect(before.isModified).toBe(false);
	});

	it('clearing index 0 to null also drops it from the single-instance shortcut', () => {
		// Round-trip: write, then clear by writing null.
		const written = applyResourceWriteToBundle(makeBundle(), 'streetData', 0, { v: 1 });
		const cleared = applyResourceWriteToBundle(written, 'streetData', 0, null);
		expect(cleared.parsedResourcesAll.get('streetData')).toEqual([null]);
		expect(cleared.parsedResources.has('streetData')).toBe(false);
	});
});

describe('clearBundleDirty', () => {
	it('drops the dirty set and the modified flag without touching parsed maps', () => {
		const dirtied = applyResourceWriteToBundle(makeBundle(), 'streetData', 0, { v: 1 });
		const cleaned = clearBundleDirty(dirtied);
		expect(cleaned.dirtyMulti.size).toBe(0);
		expect(cleaned.isModified).toBe(false);
		// Models survive — clearBundleDirty is for post-save bookkeeping, not
		// for reverting edits.
		expect(cleaned.parsedResourcesAll.get('streetData')).toEqual([{ v: 1 }]);
		expect(cleaned.parsedResources.get('streetData')).toEqual({ v: 1 });
	});
});
