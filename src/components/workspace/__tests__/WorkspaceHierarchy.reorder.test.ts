// Pure-function tests for the drag-to-reorder core (branch
// feat/prop-instance-reorder). The React/DOM DnD glue in
// WorkspaceHierarchy.tsx isn't exercised here — our vitest env is `node` and
// the repo has no DOM/R3F test infra (same rationale as the
// WorldViewportComposition helper tests). The interesting behaviour is the
// index math (`moveItem`, drop-index adjustment), the reorderable-row split,
// the same-list guard, and the structural-sharing model rewrite.

import { describe, expect, it } from 'vitest';

import {
	isSameReorderList,
	listItemAddress,
	moveItem,
	reorderListInModel,
	type ReorderDragSource,
} from '../WorkspaceHierarchy.reorder';

// ---------------------------------------------------------------------------
// moveItem
// ---------------------------------------------------------------------------

describe('moveItem', () => {
	it('moves an element later in the array', () => {
		expect(moveItem(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
	});

	it('moves an element earlier in the array', () => {
		expect(moveItem(['a', 'b', 'c', 'd'], 3, 1)).toEqual(['a', 'd', 'b', 'c']);
	});

	it('returns a structural copy without mutating the source', () => {
		const src = ['a', 'b', 'c'];
		const out = moveItem(src, 0, 2);
		expect(out).not.toBe(src);
		expect(src).toEqual(['a', 'b', 'c']); // source untouched
		expect(out).toEqual(['b', 'c', 'a']);
	});

	it('is a no-op copy when from === to', () => {
		const src = ['a', 'b', 'c'];
		const out = moveItem(src, 1, 1);
		expect(out).toEqual(['a', 'b', 'c']);
		expect(out).not.toBe(src);
	});

	it('returns an unchanged copy for out-of-range indices', () => {
		expect(moveItem(['a', 'b'], 5, 0)).toEqual(['a', 'b']);
		expect(moveItem(['a', 'b'], 0, 5)).toEqual(['a', 'b']);
		expect(moveItem(['a', 'b'], -1, 0)).toEqual(['a', 'b']);
	});

	it('handles adjacent swaps', () => {
		expect(moveItem(['a', 'b'], 0, 1)).toEqual(['b', 'a']);
		expect(moveItem(['a', 'b'], 1, 0)).toEqual(['b', 'a']);
	});
});

// ---------------------------------------------------------------------------
// listItemAddress
// ---------------------------------------------------------------------------

describe('listItemAddress', () => {
	it('splits a list-item path into list path + index', () => {
		expect(listItemAddress(['instances', 7])).toEqual({
			listPath: ['instances'],
			index: 7,
		});
	});

	it('handles nested list-item paths', () => {
		expect(listItemAddress(['cells', 2, 'props', 4])).toEqual({
			listPath: ['cells', 2, 'props'],
			index: 4,
		});
	});

	it('returns null for the empty path', () => {
		expect(listItemAddress([])).toBeNull();
	});

	it('returns null when the path ends on a record field (string segment)', () => {
		// The list field itself (`['instances']`) and record sub-fields aren't
		// reorderable items — only the numeric leaves are.
		expect(listItemAddress(['instances'])).toBeNull();
		expect(listItemAddress(['cells', 2, 'muX'])).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// isSameReorderList — the same-list-only guard
// ---------------------------------------------------------------------------

describe('isSameReorderList', () => {
	const source: ReorderDragSource = {
		bundleId: 'TRK_UNIT_206.BUN',
		resourceKey: 'propInstanceData',
		instanceIndex: 0,
		listPath: ['instances'],
		itemIndex: 3,
	};

	function targetFrom(over: Partial<Omit<ReorderDragSource, 'itemIndex'>>) {
		return {
			bundleId: source.bundleId,
			resourceKey: source.resourceKey,
			instanceIndex: source.instanceIndex,
			listPath: source.listPath,
			...over,
		};
	}

	it('accepts a drop on a sibling row in the same list (different index ok)', () => {
		// Index intentionally NOT part of the guard — moving to a *different*
		// index is the whole point.
		expect(isSameReorderList(source, targetFrom({}))).toBe(true);
	});

	it('rejects a drop into a different list within the same instance', () => {
		expect(isSameReorderList(source, targetFrom({ listPath: ['cells'] }))).toBe(false);
	});

	it('rejects a drop onto a different instance index', () => {
		expect(isSameReorderList(source, targetFrom({ instanceIndex: 1 }))).toBe(false);
	});

	it('rejects a drop onto a different resource', () => {
		expect(isSameReorderList(source, targetFrom({ resourceKey: 'triggerData' }))).toBe(
			false,
		);
	});

	it('rejects a drop into a different bundle', () => {
		expect(isSameReorderList(source, targetFrom({ bundleId: 'OTHER.BUN' }))).toBe(false);
	});

	it('compares list paths element-by-element, not by reference', () => {
		// A fresh array with the same contents must still match — the tree
		// rebuilds path arrays every render, so reference equality would break
		// every drop.
		expect(isSameReorderList(source, targetFrom({ listPath: ['instances'] }))).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// reorderListInModel — structural-sharing model rewrite
// ---------------------------------------------------------------------------

describe('reorderListInModel', () => {
	function model() {
		return {
			muZoneId: 206,
			instances: [
				{ muInstanceID: 100 },
				{ muInstanceID: 101 },
				{ muInstanceID: 102 },
				{ muInstanceID: 103 },
			],
			// Cells must be untouched by a reorder — the writer recomputes the
			// partition from the reordered flat array (PropInstanceData domain).
			cells: [{ muX: 1, muStartIndex: 0, muCount: 4 }],
		};
	}

	it('moves an instance within the flat array, leaving cells untouched', () => {
		const before = model();
		const after = reorderListInModel(before, ['instances'], 0, 2) as typeof before;
		expect(after.instances.map((i) => i.muInstanceID)).toEqual([101, 102, 100, 103]);
		// Cells array is reused by reference — only the `instances` spine was
		// cloned (structural sharing).
		expect(after.cells).toBe(before.cells);
		// The unrelated header field is preserved.
		expect(after.muZoneId).toBe(206);
	});

	it('does not mutate the source model', () => {
		const before = model();
		reorderListInModel(before, ['instances'], 3, 0);
		expect(before.instances.map((i) => i.muInstanceID)).toEqual([100, 101, 102, 103]);
	});

	it('returns the SAME model reference for a no-op (from === to)', () => {
		// Lets the caller skip a pointless setResourceAt + history entry.
		const before = model();
		expect(reorderListInModel(before, ['instances'], 1, 1)).toBe(before);
	});

	it('clones only the list spine, not unrelated branches', () => {
		const before = model();
		const after = reorderListInModel(before, ['instances'], 1, 3) as typeof before;
		// New root + new instances array...
		expect(after).not.toBe(before);
		expect(after.instances).not.toBe(before.instances);
		// ...but the cells branch is shared.
		expect(after.cells).toBe(before.cells);
		expect(after.instances.map((i) => i.muInstanceID)).toEqual([100, 102, 103, 101]);
	});
});
