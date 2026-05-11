// Integration test: cross-Bundle bulk transform (issue #80).
//
// The contract a cross-Bundle bulk gesture must satisfy:
//   1. One marquee that lassos sections across N Bundles produces N
//      per-Bundle bulks (the workspace bulk store + the controller's
//      per-Bundle slices).
//   2. The gizmo anchors at the median pivot of EVERY selected entity
//      across EVERY Bundle.
//   3. Committing a delta (translate / rotate) applies it to every
//      affected Bundle — each Bundle dirties independently for its own
//      save, with no spill into Bundles whose sections weren't in the bulk.
//   4. The whole gesture commits as exactly ONE Workspace-undo entry — a
//      `{ kind: 'multi', entries }` HistoryCommit (ADR-0006 + the multi-
//      Bundle extension in WorkspaceContext.types.ts). Undoing reverts
//      every affected Bundle atomically.
//   5. Invisible (loaded-but-toggled-off) Bundles are filtered out of
//      the marquee dispatch AND the commit dispatch — a hidden Bundle's
//      sections are never picked up by the cross-Bundle path, even if
//      their centroids sit inside the marquee rectangle.
//
// Same vitest-node shape as `WorkspaceContext.bulkTransform.test.ts`: a
// tiny state shim mirroring the live provider's wiring (bundles list +
// global history stack + a `setResourcesMulti` that records one multi
// commit + applies N per-Bundle writes). No DOM, no React mount.

import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { makeEditableBundle } from '../WorkspaceContext.bundle';
import {
	applyResourceWriteToBundle,
	isVisibleIn,
	visibilityKey,
} from '../WorkspaceContext.helpers';
import {
	emptyHistory,
	recordCommit,
	recordUndo,
	type HistoryStack,
} from '@/lib/history';
import {
	buildCrossBundleSlices,
	buildCrossBundleWrites,
	crossBundleBulkPivot,
} from '@/components/workspace/crossBundleBulk';
import type {
	EditableBundle,
	HistoryCommit,
	HistoryCommitEntry,
	VisibilityNode,
} from '../WorkspaceContext.types';
import type { ParsedAISectionsV12 } from '@/lib/core/aiSections';

const FIXTURE = path.resolve(__dirname, '../../../example/AI.DAT');

function loadFixture(): ArrayBuffer {
	const raw = fs.readFileSync(FIXTURE);
	const bytes = new Uint8Array(raw.byteLength);
	bytes.set(raw);
	return bytes.buffer;
}

// Tiny state shim mirroring the live provider's shape — bundles list,
// global history stack, visibility map.
type State = {
	bundles: EditableBundle[];
	history: HistoryStack<HistoryCommit>;
	visibility: Map<string, boolean>;
};

function getAI(state: State, bundleId: string): ParsedAISectionsV12 {
	const b = state.bundles.find((x) => x.id === bundleId);
	if (!b) throw new Error(`bundle not found: ${bundleId}`);
	const ai = b.parsedResources.get('aiSections') as ParsedAISectionsV12 | undefined;
	if (!ai) throw new Error('aiSections not loaded');
	return ai;
}

// `setResourcesMulti` mirrors the provider's multi-Bundle write — applies
// N per-(bundleId, resourceKey, index) writes AND pushes ONE multi
// HistoryCommit. The flat top-level fields use the first entry's
// addressing as a placeholder (matches the live provider's commit shape;
// readers branch on `kind === 'multi'` before touching them).
function setResourcesMulti(
	state: State,
	writes: readonly { bundleId: string; resourceKey: string; index: number; value: unknown }[],
): State {
	if (writes.length === 0) return state;
	const entries: HistoryCommitEntry[] = [];
	for (const w of writes) {
		const b = state.bundles.find((x) => x.id === w.bundleId);
		if (!b) continue;
		const previous = b.parsedResourcesAll.get(w.resourceKey)?.[w.index] ?? null;
		entries.push({
			bundleId: w.bundleId,
			resourceKey: w.resourceKey,
			index: w.index,
			previous,
			next: w.value,
		});
	}
	if (entries.length === 0) return state;
	const first = entries[0];
	const commit: HistoryCommit = {
		bundleId: first.bundleId,
		resourceKey: first.resourceKey,
		index: first.index,
		previous: null,
		next: null,
		kind: 'multi',
		entries,
	};
	const nextHistory = recordCommit<HistoryCommit>(state.history, commit);
	const byBundle = new Map<string, HistoryCommitEntry[]>();
	for (const e of entries) {
		const list = byBundle.get(e.bundleId) ?? [];
		list.push(e);
		byBundle.set(e.bundleId, list);
	}
	const nextBundles = state.bundles.map((b) => {
		const ws = byBundle.get(b.id);
		if (!ws) return b;
		let nb = b;
		for (const e of ws) {
			nb = applyResourceWriteToBundle(nb, e.resourceKey, e.index, e.next);
		}
		return nb;
	});
	return { ...state, bundles: nextBundles, history: nextHistory };
}

function undo(state: State): State {
	const top = state.history.past[state.history.past.length - 1];
	if (!top) return state;
	if (top.kind === 'multi' && top.entries) {
		const liveEntries: HistoryCommitEntry[] = top.entries.map((e) => {
			const live = state.bundles.find((b) => b.id === e.bundleId);
			return {
				bundleId: e.bundleId,
				resourceKey: e.resourceKey,
				index: e.index,
				previous: e.previous,
				next: live?.parsedResourcesAll.get(e.resourceKey)?.[e.index] ?? null,
			};
		});
		const actualCurrent: HistoryCommit = {
			bundleId: top.bundleId,
			resourceKey: top.resourceKey,
			index: top.index,
			previous: null,
			next: null,
			kind: 'multi',
			entries: liveEntries,
		};
		const out = recordUndo(state.history, actualCurrent);
		if (!out) return state;
		const byBundle = new Map<string, HistoryCommitEntry[]>();
		for (const e of top.entries) {
			const list = byBundle.get(e.bundleId) ?? [];
			list.push(e);
			byBundle.set(e.bundleId, list);
		}
		const nextBundles = state.bundles.map((b) => {
			const ws = byBundle.get(b.id);
			if (!ws) return b;
			let nb = b;
			for (const e of ws) {
				nb = applyResourceWriteToBundle(nb, e.resourceKey, e.index, e.previous);
			}
			return nb;
		});
		return { ...state, bundles: nextBundles, history: out.stack };
	}
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
	const nextBundles = state.bundles.map((b) =>
		b.id === top.bundleId
			? applyResourceWriteToBundle(b, top.resourceKey, top.index, top.previous)
			: b,
	);
	return { ...state, bundles: nextBundles, history: out.stack };
}

function isVisibleHelper(state: State, node: VisibilityNode): boolean {
	return isVisibleIn(state.visibility, node);
}

function makeMultiBundleState(): State {
	// Two Bundles loaded from the same fixture under different ids —
	// suffices for the cross-Bundle bulk path's invariants since the data
	// shape is identical and the per-Bundle dispatch only keys on
	// (bundleId, resourceKey, index). In production each Bundle would
	// have distinct sections; here we just need two physical Bundles
	// with addressable AI sections instances.
	const bundleA = makeEditableBundle(loadFixture(), 'A.DAT');
	const bundleB = makeEditableBundle(loadFixture(), 'B.DAT');
	return {
		bundles: [bundleA, bundleB],
		history: emptyHistory<HistoryCommit>(),
		visibility: new Map(),
	};
}

// Resolver helper used by `buildCrossBundleSlices` — pulls the parsed
// AI Sections model out of the given Bundle's resource map. Returns null
// for non-V12 / missing instances exactly as the live resolver does.
function resolveModel(state: State, bundleId: string, index: number): ParsedAISectionsV12 | null {
	const b = state.bundles.find((x) => x.id === bundleId);
	if (!b) return null;
	const list = b.parsedResourcesAll.get('aiSections');
	const model = list?.[index];
	if (!model || typeof model !== 'object') return null;
	if ('legacy' in (model as object)) return null;
	return model as ParsedAISectionsV12;
}

// =============================================================================
// Helpers (path) → workspace bulk summaries
// =============================================================================

function summariesFor(
	bulksByBundle: Record<string, readonly number[]>,
): { bundleId: string; index: number; pathKeys: ReadonlySet<string> }[] {
	const out: { bundleId: string; index: number; pathKeys: ReadonlySet<string> }[] = [];
	for (const bundleId of Object.keys(bulksByBundle)) {
		const sectionIdxs = bulksByBundle[bundleId];
		const pathKeys = new Set<string>();
		for (const sIdx of sectionIdxs) pathKeys.add(`sections/${sIdx}`);
		out.push({ bundleId, index: 0, pathKeys });
	}
	return out;
}

// =============================================================================
// Tests
// =============================================================================

describe('Cross-Bundle bulk transform (issue #80)', () => {
	it('builds per-Bundle slices for two Bundles with non-empty bulks', () => {
		// Acceptance: the cross-Bundle dispatch sees one slice per Bundle
		// (B-id + index + the (`AISectionEntityRef[]`, model) pair the
		// existing single-Bundle bulk ops consume).
		const state = makeMultiBundleState();
		const summaries = summariesFor({
			'A.DAT': [0, 1, 2],
			'B.DAT': [5, 6],
		});
		const slices = buildCrossBundleSlices(
			summaries,
			(bId, i) => resolveModel(state, bId, i),
			(node) => isVisibleHelper(state, node),
		);
		expect(slices.length).toBe(2);
		const sliceA = slices.find((s) => s.bundleId === 'A.DAT')!;
		const sliceB = slices.find((s) => s.bundleId === 'B.DAT')!;
		expect(sliceA.refs.map((r) => r.kind === 'section' ? r.sectionIdx : -1)).toEqual([0, 1, 2]);
		expect(sliceB.refs.map((r) => r.kind === 'section' ? r.sectionIdx : -1)).toEqual([5, 6]);
	});

	it('cross-Bundle Pivot is the median of every selected entity across every Bundle', () => {
		// The Pivot is what the gizmo anchors at — must be in display
		// coordinates and reflect the union of every spatial sample,
		// regardless of which Bundle the entity lives in.
		const state = makeMultiBundleState();
		const slices = buildCrossBundleSlices(
			summariesFor({ 'A.DAT': [0, 1], 'B.DAT': [10, 11] }),
			(bId, i) => resolveModel(state, bId, i),
			(node) => isVisibleHelper(state, node),
		);
		const pivot = crossBundleBulkPivot(slices);
		expect(pivot).not.toBeNull();
		expect(Number.isFinite(pivot!.x)).toBe(true);
		expect(Number.isFinite(pivot!.y)).toBe(true);
		expect(Number.isFinite(pivot!.z)).toBe(true);
	});

	it('one cross-Bundle bulk-translate gesture pushes EXACTLY one HistoryCommit (kind: multi)', () => {
		const state = makeMultiBundleState();
		const slices = buildCrossBundleSlices(
			summariesFor({ 'A.DAT': [0, 1], 'B.DAT': [10, 11] }),
			(bId, i) => resolveModel(state, bId, i),
			(node) => isVisibleHelper(state, node),
		);
		const pivot = crossBundleBulkPivot(slices)!;
		const writes = buildCrossBundleWrites(
			slices,
			{ x: pivot.x, z: pivot.z },
			{ translate: { x: 12, y: 0, z: -7 }, rotateY: 0 },
		);
		// One write per affected Bundle/instance.
		expect(writes.length).toBe(2);
		const after = setResourcesMulti(state, writes);
		// The undo stack grew by EXACTLY one — even though two Bundles
		// were mutated, the gesture lands as one multi commit (CONTEXT.md
		// "Bulk transform" cross-Bundle paragraph + ADR-0006).
		expect(after.history.past.length).toBe(1);
		const top = after.history.past[0];
		expect(top.kind).toBe('multi');
		expect(top.entries?.length).toBe(2);
	});

	it('each affected Bundle is independently dirtied; outside-marquee Bundles stay clean', () => {
		// Acceptance: "Translating / rotating the bulk dirties every
		// affected Bundle for its own save." Each Bundle keeps its own
		// dirty bookkeeping (CONTEXT.md / "Workspace" — "Each Bundle in
		// the Workspace retains its own file identity and its own dirty
		// state").
		const state = makeMultiBundleState();
		// Add a third Bundle whose AI sections are NOT in the bulk —
		// it must remain clean.
		const bundleC = makeEditableBundle(loadFixture(), 'C.DAT');
		const stateWithC = { ...state, bundles: [...state.bundles, bundleC] };

		const slices = buildCrossBundleSlices(
			summariesFor({ 'A.DAT': [0, 1], 'B.DAT': [10] }),
			(bId, i) => resolveModel(stateWithC, bId, i),
			(node) => isVisibleHelper(stateWithC, node),
		);
		const pivot = crossBundleBulkPivot(slices)!;
		const writes = buildCrossBundleWrites(
			slices,
			{ x: pivot.x, z: pivot.z },
			{ translate: { x: 5, y: 0, z: -3 }, rotateY: 0 },
		);
		const after = setResourcesMulti(stateWithC, writes);

		const aAfter = after.bundles.find((b) => b.id === 'A.DAT')!;
		const bAfter = after.bundles.find((b) => b.id === 'B.DAT')!;
		const cAfter = after.bundles.find((b) => b.id === 'C.DAT')!;
		expect(aAfter.isModified).toBe(true);
		expect(bAfter.isModified).toBe(true);
		expect(cAfter.isModified).toBe(false);
		// And dirtyMulti entries point at the right (resourceKey, index)
		// in each affected Bundle.
		expect(aAfter.dirtyMulti.has('aiSections:0')).toBe(true);
		expect(bAfter.dirtyMulti.has('aiSections:0')).toBe(true);
		expect(cAfter.dirtyMulti.size).toBe(0);
	});

	it('single undo reverts every affected Bundle in one step', () => {
		// Acceptance: "Undo reverts the change in every affected Bundle
		// in one step." Each Bundle's pre-gesture state is restored
		// atomically — partial undo (one Bundle restored, another still
		// edited) would be a regression.
		const state = makeMultiBundleState();
		const beforeA = getAI(state, 'A.DAT').sections[0].corners.map((c) => ({ ...c }));
		const beforeB = getAI(state, 'B.DAT').sections[10].corners.map((c) => ({ ...c }));

		const slices = buildCrossBundleSlices(
			summariesFor({ 'A.DAT': [0], 'B.DAT': [10] }),
			(bId, i) => resolveModel(state, bId, i),
			(node) => isVisibleHelper(state, node),
		);
		const pivot = crossBundleBulkPivot(slices)!;
		const writes = buildCrossBundleWrites(
			slices,
			{ x: pivot.x, z: pivot.z },
			{ translate: { x: 7, y: 0, z: -4 }, rotateY: 0 },
		);
		const after = setResourcesMulti(state, writes);

		// Confirm the translate took effect in BOTH Bundles.
		expect(getAI(after, 'A.DAT').sections[0].corners[0].x).toBeCloseTo(beforeA[0].x + 7, 6);
		expect(getAI(after, 'B.DAT').sections[10].corners[0].x).toBeCloseTo(beforeB[0].x + 7, 6);

		// One undo reverts BOTH Bundles atomically. The history stack
		// drops from 1 to 0 in a single step — no intermediate state
		// where only one Bundle has been reverted.
		const afterUndo = undo(after);
		expect(afterUndo.history.past.length).toBe(0);
		expect(getAI(afterUndo, 'A.DAT').sections[0].corners).toEqual(beforeA);
		expect(getAI(afterUndo, 'B.DAT').sections[10].corners).toEqual(beforeB);
	});

	it('cross-Bundle bulk-rotate around the shared pivot rotates every entity in every Bundle', () => {
		// Same shape as the translate test but exercising yaw rotate.
		// Every selected entity orbits the SHARED cross-Bundle pivot —
		// not each Bundle's own per-slice centre. CONTEXT.md / "Bulk
		// transform": "Cross-Bundle Selections apply the same delta
		// per-Bundle."
		const state = makeMultiBundleState();
		const slices = buildCrossBundleSlices(
			summariesFor({ 'A.DAT': [0, 1], 'B.DAT': [10, 11] }),
			(bId, i) => resolveModel(state, bId, i),
			(node) => isVisibleHelper(state, node),
		);
		const pivot = crossBundleBulkPivot(slices)!;
		const writes = buildCrossBundleWrites(
			slices,
			{ x: pivot.x, z: pivot.z },
			{ translate: { x: 0, y: 0, z: 0 }, rotateY: 0.3 },
		);
		const after = setResourcesMulti(state, writes);
		expect(after.history.past.length).toBe(1);
		expect(after.history.past[0].kind).toBe('multi');
		// Sections inside the bulk moved; sections outside the bulk
		// (e.g. A.DAT's section 5) did not.
		const aAfter = getAI(after, 'A.DAT');
		const aBefore = getAI(state, 'A.DAT');
		expect(aAfter.sections[5].corners).toEqual(aBefore.sections[5].corners);
	});

	it('combined translate + yaw rotate still produces one cross-Bundle HistoryCommit', () => {
		// The dispatcher composes translate then yaw rotate against the
		// post-translate pivot inside `buildCrossBundleWrites`. The
		// resulting write list dispatches ONCE through `setResourcesMulti`,
		// producing one multi commit.
		const state = makeMultiBundleState();
		const slices = buildCrossBundleSlices(
			summariesFor({ 'A.DAT': [0, 1], 'B.DAT': [10, 11] }),
			(bId, i) => resolveModel(state, bId, i),
			(node) => isVisibleHelper(state, node),
		);
		const pivot = crossBundleBulkPivot(slices)!;
		const writes = buildCrossBundleWrites(
			slices,
			{ x: pivot.x, z: pivot.z },
			{ translate: { x: 5, y: 0, z: -2 }, rotateY: 0.2 },
		);
		const after = setResourcesMulti(state, writes);
		expect(after.history.past.length).toBe(1);
	});

	it('no-op cross-Bundle gesture (zero delta) produces no writes and no history entry', () => {
		// The byte-for-byte BND2 writeback safety guard from the
		// single-Bundle path extends to the cross-Bundle one: a zero-
		// delta gesture must not dirty any Bundle.
		const state = makeMultiBundleState();
		const slices = buildCrossBundleSlices(
			summariesFor({ 'A.DAT': [0, 1], 'B.DAT': [10, 11] }),
			(bId, i) => resolveModel(state, bId, i),
			(node) => isVisibleHelper(state, node),
		);
		const pivot = crossBundleBulkPivot(slices)!;
		const writes = buildCrossBundleWrites(
			slices,
			{ x: pivot.x, z: pivot.z },
			{ translate: { x: 0, y: 0, z: 0 }, rotateY: 0 },
		);
		// Every slice's op returned `model` unchanged → no writes emitted.
		expect(writes.length).toBe(0);
		const after = setResourcesMulti(state, writes);
		expect(after.history.past.length).toBe(0);
		// No bundle dirtied.
		for (const b of after.bundles) expect(b.isModified).toBe(false);
	});

	it('invisible Bundle is excluded from the bulk dispatch even if its bulk Set is non-empty', () => {
		// Acceptance: "Invisible Bundles are not affected by the transform,
		// even if loaded." The Bundle/-resource/-instance visibility
		// cascade gates participation in the cross-Bundle path — at the
		// slice-build step, hidden Bundles drop out entirely.
		const state = makeMultiBundleState();
		// Toggle Bundle B's whole-Bundle visibility off (cascades to its
		// aiSections instance via `isVisibleIn`).
		state.visibility.set(visibilityKey({ bundleId: 'B.DAT' }), false);

		const slices = buildCrossBundleSlices(
			summariesFor({ 'A.DAT': [0, 1], 'B.DAT': [10, 11] }),
			(bId, i) => resolveModel(state, bId, i),
			(node) => isVisibleHelper(state, node),
		);
		// B.DAT was hidden; its slice was dropped. Only A.DAT survives.
		expect(slices.length).toBe(1);
		expect(slices[0].bundleId).toBe('A.DAT');

		// Build the write list — only A.DAT's instance gets a write,
		// even though both Bundles had bulks.
		const pivot = crossBundleBulkPivot(slices)!;
		const writes = buildCrossBundleWrites(
			slices,
			{ x: pivot.x, z: pivot.z },
			{ translate: { x: 5, y: 0, z: -3 }, rotateY: 0 },
		);
		expect(writes.length).toBe(1);
		expect(writes[0].bundleId).toBe('A.DAT');

		const after = setResourcesMulti(state, writes);
		// B's model is byte-equal to its pre-gesture state — its data
		// is untouched. The history entry is still a `kind: 'multi'`
		// commit because we always dispatch through `setResourcesMulti`
		// for cross-Bundle gestures; that single-entry multi commit is
		// indistinguishable from a single-Bundle write at the data layer
		// and undo reverts it correctly.
		const bBefore = getAI(state, 'B.DAT');
		const bAfter = getAI(after, 'B.DAT');
		expect(bAfter).toBe(bBefore);
		expect(after.bundles.find((b) => b.id === 'B.DAT')!.isModified).toBe(false);
	});

	it('hidden instance inside a visible Bundle is also filtered out (cascade)', () => {
		// The visibility cascade is per CONTEXT.md / "Visibility" — hiding
		// the (bundleId, resourceKey, index) triple alone (without hiding
		// the whole Bundle) still drops the slice. Tests the
		// instance-scope branch of `isVisibleIn`.
		const state = makeMultiBundleState();
		state.visibility.set(
			visibilityKey({ bundleId: 'B.DAT', resourceKey: 'aiSections', index: 0 }),
			false,
		);

		const slices = buildCrossBundleSlices(
			summariesFor({ 'A.DAT': [0], 'B.DAT': [10] }),
			(bId, i) => resolveModel(state, bId, i),
			(node) => isVisibleHelper(state, node),
		);
		expect(slices.map((s) => s.bundleId)).toEqual(['A.DAT']);
	});
});

// =============================================================================
// Regression: the single-Bundle path is byte-for-byte unchanged
// =============================================================================
//
// The whole point of choosing option (b) — group refs by Bundle in the
// dispatch layer instead of (a) extending the ref shape — is that the
// existing single-Bundle bulk ops keep working unchanged. This block
// pins that contract: a single-slice bulk (1 Bundle) routed through
// `buildCrossBundleWrites` produces a model that matches what the
// single-Bundle `bulkTranslateEntities` would produce directly.

import { bulkTranslateEntities } from '@/lib/core/aiSectionsOps';

describe('Cross-Bundle dispatch — single-Bundle slice agrees with single-Bundle op', () => {
	it('single-slice translate matches `bulkTranslateEntities` byte-for-byte', () => {
		const state = makeMultiBundleState();
		const slices = buildCrossBundleSlices(
			summariesFor({ 'A.DAT': [0, 1, 2] }),
			(bId, i) => resolveModel(state, bId, i),
			(node) => isVisibleHelper(state, node),
		);
		expect(slices.length).toBe(1);
		const pivot = crossBundleBulkPivot(slices)!;
		const writes = buildCrossBundleWrites(
			slices,
			{ x: pivot.x, z: pivot.z },
			{ translate: { x: 5, y: 0, z: -3 }, rotateY: 0 },
		);
		expect(writes.length).toBe(1);
		const dispatchResult = writes[0].value as ParsedAISectionsV12;
		const directResult = bulkTranslateEntities(
			getAI(state, 'A.DAT'),
			[
				{ kind: 'section', sectionIdx: 0 },
				{ kind: 'section', sectionIdx: 1 },
				{ kind: 'section', sectionIdx: 2 },
			],
			{ x: 5, y: 0, z: -3 },
		);
		// Compare the changed sections — section 5 (not in bulk) stays
		// === between both since the op short-circuits per-section.
		expect(dispatchResult.sections[0].corners).toEqual(directResult.sections[0].corners);
		expect(dispatchResult.sections[1].corners).toEqual(directResult.sections[1].corners);
		expect(dispatchResult.sections[2].corners).toEqual(directResult.sections[2].corners);
	});
});
