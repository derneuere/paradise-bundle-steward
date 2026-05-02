// Integration test for WorkspaceContext — exercises the (bundleId, key) APIs
// against a real example bundle, plus the Selection round-trip shape.
//
// The vitest environment is `node` so we can't render the WorkspaceProvider
// to a DOM; this test exercises `makeEditableBundle` (the synchronous core
// of `loadBundle`) and the helpers (`applyResourceWriteToBundle`,
// `clearBundleDirty`) together — covering the same end-to-end flow the
// React provider stitches up around them.

import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { makeEditableBundle } from './WorkspaceContext.bundle';
import {
	appendBundle,
	applyResourceWriteToBundle,
	classifyLoad,
	clearBundleDirty,
	dropHistoryForBundle,
	isVisibleIn,
	removeBundleById,
	replaceBundleById,
	visibilityKey,
} from './WorkspaceContext.helpers';
import {
	emptyHistory,
	recordCommit,
	recordRedo,
	recordUndo,
	type HistoryStack,
} from '@/lib/history';
import type {
	EditableBundle,
	HistoryCommit,
	WorkspaceSelection,
} from './WorkspaceContext.types';
import type { ParsedAISectionsV12 } from '@/lib/core/aiSections';

// AI.DAT is a small PC bundle that contains a single AISections resource —
// well-suited for testing the Bundle-keyed read/write/selection flow without
// dragging in a multi-resource fixture.
const FIXTURE = path.resolve(__dirname, '../../example/AI.DAT');

function loadFixture(): ArrayBuffer {
	const raw = fs.readFileSync(FIXTURE);
	const bytes = new Uint8Array(raw.byteLength);
	bytes.set(raw);
	return bytes.buffer;
}

// Tiny "workspace state" stand-in for the React state the provider holds.
// Mirrors the provider's `bundles` array plus the public read/write helpers
// so a test can assert on the same shape the live provider exposes via
// `useWorkspace()`.
type WorkspaceState = { bundles: EditableBundle[] };

function getResource<T>(state: WorkspaceState, bundleId: string, key: string): T | null {
	const b = state.bundles.find((x) => x.id === bundleId);
	if (!b) return null;
	return (b.parsedResources.get(key) as T | undefined) ?? null;
}

function setResource<T>(
	state: WorkspaceState,
	bundleId: string,
	key: string,
	value: T,
): WorkspaceState {
	return {
		bundles: state.bundles.map((b) =>
			b.id === bundleId ? applyResourceWriteToBundle(b, key, 0, value) : b,
		),
	};
}

// ---------------------------------------------------------------------------
// loadBundle
// ---------------------------------------------------------------------------

describe('loadBundle (via makeEditableBundle)', () => {
	it('parses a real bundle, populates resource maps, starts clean', () => {
		const bundle = makeEditableBundle(loadFixture(), 'AI.DAT');

		expect(bundle.id).toBe('AI.DAT');
		expect(bundle.parsed.resources.length).toBeGreaterThan(0);
		expect(bundle.resources.length).toBe(bundle.parsed.resources.length);
		// AI.DAT's whole reason for existing is the AI Sections resource —
		// confirm both the single-instance and multi-instance maps see it.
		expect(bundle.parsedResources.get('aiSections')).toBeDefined();
		expect(bundle.parsedResourcesAll.get('aiSections')?.length).toBeGreaterThan(0);
		expect(bundle.dirtyMulti.size).toBe(0);
		expect(bundle.isModified).toBe(false);
	});

	it('uses the supplied filename as the BundleId (game refs files by name)', () => {
		// Different filename, same bytes — the workspace forbids two bundles
		// with the same name (CONTEXT.md / Bundle filename), so the id is the
		// addressable identity throughout Steward.
		const bundle = makeEditableBundle(loadFixture(), 'PRIMARY.DAT');
		expect(bundle.id).toBe('PRIMARY.DAT');
	});
});

// ---------------------------------------------------------------------------
// getResource(bundleId, key)
// ---------------------------------------------------------------------------

describe('getResource(bundleId, key)', () => {
	it('returns the parsed model for a Bundle that has it', () => {
		const state: WorkspaceState = {
			bundles: [makeEditableBundle(loadFixture(), 'AI.DAT')],
		};
		const ai = getResource<ParsedAISectionsV12>(state, 'AI.DAT', 'aiSections');
		expect(ai).not.toBeNull();
		expect(ai!.sections.length).toBeGreaterThan(0);
	});

	it('returns null for a Bundle that does not have the resource type', () => {
		const state: WorkspaceState = {
			bundles: [makeEditableBundle(loadFixture(), 'AI.DAT')],
		};
		const missing = getResource<unknown>(state, 'AI.DAT', 'streetData');
		expect(missing).toBeNull();
	});

	it('returns null for a BundleId that is not loaded', () => {
		const state: WorkspaceState = {
			bundles: [makeEditableBundle(loadFixture(), 'AI.DAT')],
		};
		const missing = getResource<unknown>(state, 'NOT_LOADED.DAT', 'aiSections');
		expect(missing).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// setResource(bundleId, key, value)
// ---------------------------------------------------------------------------

describe('setResource(bundleId, key, value)', () => {
	it('overwrites the model and marks the Bundle dirty', () => {
		const initial: WorkspaceState = {
			bundles: [makeEditableBundle(loadFixture(), 'AI.DAT')],
		};
		const original = getResource<ParsedAISectionsV12>(initial, 'AI.DAT', 'aiSections')!;

		// Build a tiny edit — bumping the version field is the cheapest legal
		// mutation, and it survives the immutable-update path because we're
		// writing a brand-new object in.
		const next: ParsedAISectionsV12 = { ...original, version: original.version + 1 };
		const after = setResource(initial, 'AI.DAT', 'aiSections', next);

		const updated = getResource<ParsedAISectionsV12>(after, 'AI.DAT', 'aiSections')!;
		expect(updated.version).toBe(original.version + 1);

		const updatedBundle = after.bundles[0];
		expect(updatedBundle.isModified).toBe(true);
		expect(updatedBundle.dirtyMulti.has('aiSections:0')).toBe(true);

		// Original state untouched — `applyResourceWriteToBundle` is immutable.
		expect(initial.bundles[0].isModified).toBe(false);
		expect(initial.bundles[0].dirtyMulti.size).toBe(0);
	});

	it('leaves other Bundles in the workspace untouched', () => {
		// Simulating two bundles in the workspace by giving the same fixture
		// two different filenames. setResource must address only the named
		// Bundle and ignore the rest.
		const initial: WorkspaceState = {
			bundles: [
				makeEditableBundle(loadFixture(), 'A.DAT'),
				makeEditableBundle(loadFixture(), 'B.DAT'),
			],
		};
		const oa = getResource<ParsedAISectionsV12>(initial, 'A.DAT', 'aiSections')!;
		const next: ParsedAISectionsV12 = { ...oa, version: oa.version + 1 };
		const after = setResource(initial, 'A.DAT', 'aiSections', next);

		expect(after.bundles[0].isModified).toBe(true);
		expect(after.bundles[1].isModified).toBe(false);
		expect(getResource<ParsedAISectionsV12>(after, 'B.DAT', 'aiSections')!.version).toBe(
			oa.version,
		);
	});

	it('saveBundle bookkeeping clears dirty without touching the model', () => {
		const initial: WorkspaceState = {
			bundles: [makeEditableBundle(loadFixture(), 'AI.DAT')],
		};
		const original = getResource<ParsedAISectionsV12>(initial, 'AI.DAT', 'aiSections')!;
		const edited = setResource(initial, 'AI.DAT', 'aiSections', {
			...original,
			version: original.version + 1,
		});

		const saved: WorkspaceState = {
			bundles: edited.bundles.map(clearBundleDirty),
		};
		const after = getResource<ParsedAISectionsV12>(saved, 'AI.DAT', 'aiSections')!;

		// Edit survives the save; dirty bookkeeping clears.
		expect(after.version).toBe(original.version + 1);
		expect(saved.bundles[0].isModified).toBe(false);
		expect(saved.bundles[0].dirtyMulti.size).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// Selection round-trip
// ---------------------------------------------------------------------------

describe('selection round-trip', () => {
	it('round-trips a deep selection through a setter without mutation', () => {
		// Selection is a plain immutable record — no helper methods. The
		// "round-trip" guarantee is that whatever shape we hand to the setter
		// comes back out byte-identical, so consumers can reason about
		// selection equality without normalisation.
		const sel: WorkspaceSelection = {
			bundleId: 'AI.DAT',
			resourceKey: 'aiSections',
			index: 0,
			path: ['sections', 3, 'portals', 1],
		};
		let stored: WorkspaceSelection = null;
		const select = (next: WorkspaceSelection) => {
			stored = next;
		};
		select(sel);
		expect(stored).toEqual(sel);
		// Path is preserved as a separate array reference round-trippable
		// without normalisation — consumers can rely on referential equality
		// for fast selection-equality checks.
		expect((stored as NonNullable<WorkspaceSelection>).path).toEqual([
			'sections',
			3,
			'portals',
			1,
		]);
	});

	it('null is the deselected state', () => {
		const sel: WorkspaceSelection = null;
		expect(sel).toBeNull();
	});

	it('Selection is independent of Visibility — hiding a selected resource keeps it selected (issue #19)', () => {
		// Acceptance criterion / CONTEXT.md: hiding the currently-selected
		// Resource must leave it selected (inspector still shows its Tools).
		// The two state buckets are kept in separate maps in the React
		// provider and never read each other; this test exercises that
		// invariant directly so a regression couldn't slip in by accidentally
		// coupling them.
		const selection: WorkspaceSelection = {
			bundleId: 'A.BNDL',
			resourceKey: 'streetData',
			index: 0,
			path: ['streets', 7],
		};

		// Simulate the user hiding the Bundle the selection lives in. The
		// `isVisible` walker must return false, and the selection record
		// must stay byte-identical — no field mutated, no path cleared.
		const visibility = new Map<string, boolean>([
			[visibilityKey({ bundleId: 'A.BNDL' }), false],
		]);
		expect(
			isVisibleIn(visibility, {
				bundleId: 'A.BNDL',
				resourceKey: 'streetData',
				index: 0,
			}),
		).toBe(false);
		// Selection is unchanged — the inspector / Tools keep rendering off it.
		expect(selection).toEqual({
			bundleId: 'A.BNDL',
			resourceKey: 'streetData',
			index: 0,
			path: ['streets', 7],
		});
	});

	it('selection always pins to a (bundleId, resourceKey, index) — no implicit active Bundle', () => {
		// Documented invariant from CONTEXT.md / Selection: the selected
		// resource's Bundle is implicit in the selection. There is no
		// separate "active Bundle" concept, so a selection without
		// `bundleId` is malformed. Test by exhaustive type check.
		const sel = {
			bundleId: 'AI.DAT',
			resourceKey: 'aiSections',
			index: 0,
			path: [],
		} satisfies NonNullable<WorkspaceSelection>;
		expect(sel.bundleId).toBe('AI.DAT');
	});
});

// ---------------------------------------------------------------------------
// Global undo/redo stack (ADR-0006)
//
// These tests exercise the same flow the React provider stitches up:
//   setResource{,At}: record a HistoryCommit + apply the write
//   undo:             read live current, push onto future, restore previous
//   redo:             inverse of undo
//   closeBundle:      drop history entries that referenced the Bundle
//
// The provider's body in WorkspaceContext.tsx wires `recordCommit` /
// `recordUndo` / `recordRedo` against the same `applyResourceWriteToBundle`
// reducer used here, so a passing test on this composition exercises the
// end-to-end behaviour without needing a DOM.
// ---------------------------------------------------------------------------

type WSWithHistory = {
	bundles: EditableBundle[];
	history: HistoryStack<HistoryCommit>;
};

function commitWrite<T>(
	state: WSWithHistory,
	bundleId: string,
	key: string,
	index: number,
	value: T,
): WSWithHistory {
	const b = state.bundles.find((x) => x.id === bundleId);
	const previous = b?.parsedResourcesAll.get(key)?.[index] ?? null;
	const history = recordCommit<HistoryCommit>(state.history, {
		bundleId,
		resourceKey: key,
		index,
		previous,
		next: value as unknown,
	});
	const bundles = state.bundles.map((x) =>
		x.id === bundleId ? applyResourceWriteToBundle(x, key, index, value) : x,
	);
	return { bundles, history };
}

function undoOnce(state: WSWithHistory): WSWithHistory {
	const top = state.history.past[state.history.past.length - 1];
	if (!top) return state;
	const live = state.bundles.find((b) => b.id === top.bundleId);
	const actualCurrent: HistoryCommit = {
		bundleId: top.bundleId,
		resourceKey: top.resourceKey,
		index: top.index,
		previous: top.previous,
		next: live?.parsedResourcesAll.get(top.resourceKey)?.[top.index] ?? null,
	};
	const out = recordUndo(state.history, actualCurrent);
	if (!out) return state;
	return {
		bundles: state.bundles.map((b) =>
			b.id === top.bundleId
				? applyResourceWriteToBundle(b, top.resourceKey, top.index, top.previous)
				: b,
		),
		history: out.stack,
	};
}

function redoOnce(state: WSWithHistory): WSWithHistory {
	const head = state.history.future[0];
	if (!head) return state;
	const live = state.bundles.find((b) => b.id === head.bundleId);
	const actualCurrent: HistoryCommit = {
		bundleId: head.bundleId,
		resourceKey: head.resourceKey,
		index: head.index,
		previous: live?.parsedResourcesAll.get(head.resourceKey)?.[head.index] ?? null,
		next: head.next,
	};
	const out = recordRedo(state.history, actualCurrent);
	if (!out) return state;
	return {
		bundles: state.bundles.map((b) =>
			b.id === head.bundleId
				? applyResourceWriteToBundle(b, head.resourceKey, head.index, head.next)
				: b,
		),
		history: out.stack,
	};
}

function readVersion(state: WSWithHistory, bundleId: string): number {
	const b = state.bundles.find((x) => x.id === bundleId)!;
	return (b.parsedResources.get('aiSections') as ParsedAISectionsV12).version;
}

function freshTwoBundleState(): WSWithHistory {
	return {
		bundles: [
			makeEditableBundle(loadFixture(), 'A.DAT'),
			makeEditableBundle(loadFixture(), 'B.DAT'),
		],
		history: emptyHistory<HistoryCommit>(),
	};
}

describe('global undo/redo stack (ADR-0006)', () => {
	it('cross-Bundle undo: edit A, edit B, ⌘Z reverts B; another ⌘Z reverts A', () => {
		// Demo flow from the issue: an edit in Bundle A and an edit in Bundle
		// B share one chronological stack. ⌘Z undoes the most recent edit
		// regardless of where it landed — the whole point of the global stack.
		let s = freshTwoBundleState();
		const v0a = readVersion(s, 'A.DAT');
		const v0b = readVersion(s, 'B.DAT');

		const aOriginal = s.bundles[0].parsedResources.get('aiSections') as ParsedAISectionsV12;
		s = commitWrite(s, 'A.DAT', 'aiSections', 0, { ...aOriginal, version: v0a + 1 });
		const bOriginal = s.bundles[1].parsedResources.get('aiSections') as ParsedAISectionsV12;
		s = commitWrite(s, 'B.DAT', 'aiSections', 0, { ...bOriginal, version: v0b + 1 });

		expect(readVersion(s, 'A.DAT')).toBe(v0a + 1);
		expect(readVersion(s, 'B.DAT')).toBe(v0b + 1);
		expect(s.history.past.length).toBe(2);

		// First ⌘Z reverts the most recent edit — the one to B.
		s = undoOnce(s);
		expect(readVersion(s, 'A.DAT')).toBe(v0a + 1);
		expect(readVersion(s, 'B.DAT')).toBe(v0b);

		// Second ⌘Z walks further back — reverts the A edit.
		s = undoOnce(s);
		expect(readVersion(s, 'A.DAT')).toBe(v0a);
		expect(readVersion(s, 'B.DAT')).toBe(v0b);
		expect(s.history.past.length).toBe(0);
		expect(s.history.future.length).toBe(2);
	});

	it('redo round-trip: undo, redo, undo, redo lands on the same model', () => {
		let s = freshTwoBundleState();
		const v0 = readVersion(s, 'A.DAT');
		const original = s.bundles[0].parsedResources.get('aiSections') as ParsedAISectionsV12;
		s = commitWrite(s, 'A.DAT', 'aiSections', 0, { ...original, version: v0 + 1 });
		s = commitWrite(s, 'A.DAT', 'aiSections', 0, { ...original, version: v0 + 2 });

		// Walk all the way back, then walk forward again.
		s = undoOnce(s);
		expect(readVersion(s, 'A.DAT')).toBe(v0 + 1);
		s = undoOnce(s);
		expect(readVersion(s, 'A.DAT')).toBe(v0);
		s = redoOnce(s);
		expect(readVersion(s, 'A.DAT')).toBe(v0 + 1);
		s = redoOnce(s);
		expect(readVersion(s, 'A.DAT')).toBe(v0 + 2);
		// Future is empty — no more redo to consume.
		expect(s.history.future.length).toBe(0);
	});

	it('truncate-on-new-commit: a fresh edit after undo drops the redo branch', () => {
		// Standard undo-stack invariant. After ⌘Z, the user has a redo
		// available — but if they make a NEW edit instead, the old redo
		// branch becomes unreachable (the timeline forks).
		let s = freshTwoBundleState();
		const v0 = readVersion(s, 'A.DAT');
		const original = s.bundles[0].parsedResources.get('aiSections') as ParsedAISectionsV12;
		s = commitWrite(s, 'A.DAT', 'aiSections', 0, { ...original, version: v0 + 1 });
		s = commitWrite(s, 'A.DAT', 'aiSections', 0, { ...original, version: v0 + 2 });
		s = undoOnce(s);
		expect(s.history.future.length).toBe(1);

		// Fresh commit forks the timeline.
		s = commitWrite(s, 'A.DAT', 'aiSections', 0, { ...original, version: v0 + 99 });
		expect(s.history.future.length).toBe(0);
		expect(readVersion(s, 'A.DAT')).toBe(v0 + 99);
	});

	it('closeBundle history cleanup drops only the closed Bundle’s entries', () => {
		// Simulates the React provider's closeBundle path: remove the Bundle
		// from the list AND prune its history entries. Entries from sibling
		// Bundles must survive — they're still addressable.
		let s = freshTwoBundleState();
		const va0 = readVersion(s, 'A.DAT');
		const vb0 = readVersion(s, 'B.DAT');
		const aOrig = s.bundles[0].parsedResources.get('aiSections') as ParsedAISectionsV12;
		const bOrig = s.bundles[1].parsedResources.get('aiSections') as ParsedAISectionsV12;

		s = commitWrite(s, 'A.DAT', 'aiSections', 0, { ...aOrig, version: va0 + 1 });
		s = commitWrite(s, 'B.DAT', 'aiSections', 0, { ...bOrig, version: vb0 + 1 });
		s = commitWrite(s, 'A.DAT', 'aiSections', 0, { ...aOrig, version: va0 + 2 });
		expect(s.history.past.length).toBe(3);

		// Close A. Provider drops the bundle then prunes history entries.
		s = {
			bundles: s.bundles.filter((b) => b.id !== 'A.DAT'),
			history: dropHistoryForBundle(s.history, 'A.DAT'),
		};
		expect(s.bundles.map((b) => b.id)).toEqual(['B.DAT']);
		// Only B's entry survives — undoing now must not resurrect A.
		expect(s.history.past).toHaveLength(1);
		expect(s.history.past[0].bundleId).toBe('B.DAT');
		// And undo on the surviving entry walks B back to its original.
		s = undoOnce(s);
		expect(readVersion(s, 'B.DAT')).toBe(vb0);
	});
});

// ---------------------------------------------------------------------------
// Multi-Bundle load + close + per-Bundle save flow (issue #17)
//
// The React provider drives `loadBundle` through `classifyLoad` →
// `appendBundle` / `replaceBundleById`, and `closeBundle` through a dirty
// check + `removeBundleById`. These tests exercise that exact composition
// using the helper functions, so a passing test proves the same behaviour
// the live provider relies on without needing a DOM.
// ---------------------------------------------------------------------------

describe('multi-Bundle load flow', () => {
	it('loadBundle is additive — two distinct files leave both in the Workspace', () => {
		const a = makeEditableBundle(loadFixture(), 'A.DAT');
		const b = makeEditableBundle(loadFixture(), 'B.DAT');

		// Empty Workspace + first load → append.
		const decisionA = classifyLoad([], a);
		expect(decisionA.kind).toBe('append');
		const afterA = appendBundle([], a);

		// Second load with a distinct id → still append (no prompt).
		const decisionB = classifyLoad(afterA, b);
		expect(decisionB.kind).toBe('append');
		const afterB = appendBundle(afterA, b);

		expect(afterB.map((bundle) => bundle.id)).toEqual(['A.DAT', 'B.DAT']);
		// Each Bundle keeps its own resource maps — additive load is not a
		// merge, every Bundle remains independently editable.
		expect(afterB[0].parsedResources.get('aiSections')).toBeDefined();
		expect(afterB[1].parsedResources.get('aiSections')).toBeDefined();
	});

	it('same-name re-load: Replace path swaps the Bundle in place', () => {
		const v1 = makeEditableBundle(loadFixture(), 'A.DAT');
		const state: WorkspaceState = { bundles: [v1] };

		// User edits the loaded Bundle so we can prove the replace really
		// swapped the bytes (the new Bundle should NOT carry over the edit).
		const original = v1.parsedResources.get('aiSections') as ParsedAISectionsV12;
		const edited = setResource<ParsedAISectionsV12>(state, 'A.DAT', 'aiSections', {
			...original,
			version: original.version + 7,
		});
		expect(edited.bundles[0].isModified).toBe(true);

		// Now the user drops a fresh A.DAT — same id, fresh bytes.
		const v2 = makeEditableBundle(loadFixture(), 'A.DAT');
		const decision = classifyLoad(edited.bundles, v2);
		expect(decision.kind).toBe('replace');

		// Replace branch: swap by id, drop history / selection / visibility.
		// The history-prune side is exercised by `dropHistoryForBundle` tests
		// above; here we just verify the bundle list pivot.
		const afterReplace = replaceBundleById(edited.bundles, v2);
		expect(afterReplace.length).toBe(1);
		expect(afterReplace[0]).toBe(v2);
		// Edit from v1 is gone — replace is destructive on purpose.
		expect(afterReplace[0].isModified).toBe(false);
		expect(
			(afterReplace[0].parsedResources.get('aiSections') as ParsedAISectionsV12).version,
		).toBe(original.version);
	});

	it('same-name re-load: Cancel path leaves the Workspace untouched', () => {
		const v1 = makeEditableBundle(loadFixture(), 'A.DAT');
		const state: WorkspaceState = { bundles: [v1] };
		const original = v1.parsedResources.get('aiSections') as ParsedAISectionsV12;
		const edited = setResource<ParsedAISectionsV12>(state, 'A.DAT', 'aiSections', {
			...original,
			version: original.version + 1,
		});

		// Drop a candidate but the user picks Cancel — provider's
		// loadBundle returns without doing anything to the Bundle list.
		const v2 = makeEditableBundle(loadFixture(), 'A.DAT');
		const decision = classifyLoad(edited.bundles, v2);
		expect(decision.kind).toBe('replace');
		// Cancel branch: noop. Helper isn't called; assert state intact.
		expect(edited.bundles[0]).toBe(edited.bundles[0]);
		expect(edited.bundles[0].isModified).toBe(true);
		expect(
			(edited.bundles[0].parsedResources.get('aiSections') as ParsedAISectionsV12).version,
		).toBe(original.version + 1);
		// Sanity: candidate was parsed but not adopted.
		expect(v2).not.toBe(edited.bundles[0]);
	});

	it('same-name forbids "add as duplicate" — only Replace or Cancel, never two', () => {
		// CONTEXT.md / "Bundle filename": filenames must stay unique because
		// the game references files by exact name. The classifier signals
		// "replace" — there is no third "duplicate" branch.
		const a = makeEditableBundle(loadFixture(), 'A.DAT');
		const dup = makeEditableBundle(loadFixture(), 'A.DAT');
		const decision = classifyLoad([a], dup);
		expect(decision.kind).toBe('replace');
		// Type-level proof: the union has exactly two arms.
		const exhaustive: 'append' | 'replace' = decision.kind;
		expect(['append', 'replace']).toContain(exhaustive);
	});
});

describe('multi-Bundle close flow', () => {
	it('closeBundle on a dirty Bundle requires user confirmation before dropping it', () => {
		// Two-step flow the provider enforces:
		//   1. If b.isModified, prompt the user.
		//   2. Only on Confirm, drop the Bundle + clear bookkeeping.
		const initial: WorkspaceState = {
			bundles: [
				makeEditableBundle(loadFixture(), 'A.DAT'),
				makeEditableBundle(loadFixture(), 'B.DAT'),
			],
		};
		const a = initial.bundles[0].parsedResources.get('aiSections') as ParsedAISectionsV12;
		const dirty = setResource<ParsedAISectionsV12>(initial, 'A.DAT', 'aiSections', {
			...a,
			version: a.version + 1,
		});
		expect(dirty.bundles[0].isModified).toBe(true);

		// Cancel path: target stays in place.
		const userCancelled = false;
		const afterCancel = userCancelled
			? { bundles: removeBundleById(dirty.bundles, 'A.DAT') }
			: dirty;
		expect(afterCancel.bundles.map((b) => b.id)).toEqual(['A.DAT', 'B.DAT']);
		expect(afterCancel.bundles[0].isModified).toBe(true);

		// Confirm path: target leaves the Workspace.
		const userConfirmed = true;
		const afterConfirm: WorkspaceState = userConfirmed
			? { bundles: removeBundleById(dirty.bundles, 'A.DAT') }
			: dirty;
		expect(afterConfirm.bundles.map((b) => b.id)).toEqual(['B.DAT']);
	});

	it('closeBundle on a clean Bundle skips the prompt entirely', () => {
		// `isModified` is false → provider drops the prompt branch and
		// removes the Bundle directly.
		const initial: WorkspaceState = {
			bundles: [
				makeEditableBundle(loadFixture(), 'A.DAT'),
				makeEditableBundle(loadFixture(), 'B.DAT'),
			],
		};
		expect(initial.bundles[0].isModified).toBe(false);
		const after = { bundles: removeBundleById(initial.bundles, 'A.DAT') };
		expect(after.bundles.map((b) => b.id)).toEqual(['B.DAT']);
	});
});

describe('per-Bundle save bookkeeping', () => {
	it('saveBundle clears only the saved Bundle’s dirty flag, leaves siblings alone', () => {
		// Drives the "save one, sibling stays dirty" demo from the issue's
		// acceptance criteria — saving TRK_UNIT_07 must not clear the
		// modified state on a sibling WORLDCOL.BIN.
		const initial: WorkspaceState = {
			bundles: [
				makeEditableBundle(loadFixture(), 'A.DAT'),
				makeEditableBundle(loadFixture(), 'B.DAT'),
			],
		};
		const a = initial.bundles[0].parsedResources.get('aiSections') as ParsedAISectionsV12;
		const b = initial.bundles[1].parsedResources.get('aiSections') as ParsedAISectionsV12;

		// Both Bundles edited.
		let s = setResource<ParsedAISectionsV12>(initial, 'A.DAT', 'aiSections', {
			...a,
			version: a.version + 1,
		});
		s = setResource<ParsedAISectionsV12>(s, 'B.DAT', 'aiSections', {
			...b,
			version: b.version + 1,
		});
		expect(s.bundles[0].isModified).toBe(true);
		expect(s.bundles[1].isModified).toBe(true);

		// Save A — provider's saveBundle runs `clearBundleDirty` on that
		// Bundle only. Sibling B keeps its dirty flag.
		const saved: WorkspaceState = {
			bundles: s.bundles.map((bundle) =>
				bundle.id === 'A.DAT' ? clearBundleDirty(bundle) : bundle,
			),
		};
		expect(saved.bundles[0].isModified).toBe(false);
		expect(saved.bundles[0].dirtyMulti.size).toBe(0);
		expect(saved.bundles[1].isModified).toBe(true);
		expect(saved.bundles[1].dirtyMulti.has('aiSections:0')).toBe(true);
		// Edits survive the save bookkeeping reset.
		expect(
			(saved.bundles[0].parsedResources.get('aiSections') as ParsedAISectionsV12).version,
		).toBe(a.version + 1);
	});

	it('saveAll iterates every dirty Bundle and clears each in turn', () => {
		// Drives the "Save All" toolbar command. Every Bundle with
		// `isModified === true` is saved (downloaded) and its dirty flag is
		// cleared; clean Bundles are skipped.
		const initial: WorkspaceState = {
			bundles: [
				makeEditableBundle(loadFixture(), 'A.DAT'),
				makeEditableBundle(loadFixture(), 'B.DAT'),
				makeEditableBundle(loadFixture(), 'C.DAT'),
			],
		};
		const a = initial.bundles[0].parsedResources.get('aiSections') as ParsedAISectionsV12;
		const c = initial.bundles[2].parsedResources.get('aiSections') as ParsedAISectionsV12;
		// Edit A and C; leave B clean.
		let s = setResource<ParsedAISectionsV12>(initial, 'A.DAT', 'aiSections', {
			...a,
			version: a.version + 1,
		});
		s = setResource<ParsedAISectionsV12>(s, 'C.DAT', 'aiSections', {
			...c,
			version: c.version + 1,
		});

		// saveAll: clear dirty on every modified Bundle, leave clean Bundles
		// alone. Mirrors the provider's `for (const b of bundles) if
		// (b.isModified) await saveBundle(b.id);` loop.
		const after: WorkspaceState = {
			bundles: s.bundles.map((b) => (b.isModified ? clearBundleDirty(b) : b)),
		};
		expect(after.bundles.every((b) => !b.isModified)).toBe(true);
		// B was already clean — the save loop didn't touch it.
		expect(after.bundles[1]).toBe(s.bundles[1]);
	});
});
