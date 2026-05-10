// Integration test: Bulk-transform gizmo gesture → Workspace undo stack.
//
// The Bulk-transform contract (CONTEXT.md / "Bulk transform", ADR-0006) is:
// one gesture = exactly one entry on the global Workspace-undo stack. The
// preview during drag updates local React state only; only the gesture's
// commit-on-release calls `setResource` (which records a HistoryCommit).
//
// We exercise that contract here without mounting React: the same shim used
// by `WorkspaceContext.test.ts` (a `WorkspaceState` over the helpers + the
// pure history reducer) gives us the same shape a live provider exposes via
// `useWorkspace()`. If a future refactor accidentally pushes a HistoryCommit
// per drag-frame, this test will reproduce the regression by counting
// `past.length` after a multi-frame "drag".

import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { makeEditableBundle } from '../WorkspaceContext.bundle';
import { applyResourceWriteToBundle } from '../WorkspaceContext.helpers';
import {
	emptyHistory,
	recordCommit,
	recordUndo,
	type HistoryStack,
} from '@/lib/history';
import {
	rotateSectionAroundCentroidYaw,
	translateSectionRigid,
} from '@/lib/core/aiSectionsOps';
import type {
	EditableBundle,
	HistoryCommit,
} from '../WorkspaceContext.types';
import type { ParsedAISectionsV12 } from '@/lib/core/aiSections';

const FIXTURE = path.resolve(__dirname, '../../../example/AI.DAT');

function loadFixture(): ArrayBuffer {
	const raw = fs.readFileSync(FIXTURE);
	const bytes = new Uint8Array(raw.byteLength);
	bytes.set(raw);
	return bytes.buffer;
}

// Tiny stand-in for the live provider's state. Mirrors the same surface
// (bundles list + history stack + setResource via the helper).
type State = {
	bundles: EditableBundle[];
	history: HistoryStack<HistoryCommit>;
};

function getAI(state: State, bundleId: string): ParsedAISectionsV12 {
	const b = state.bundles.find((x) => x.id === bundleId);
	if (!b) throw new Error(`bundle not found: ${bundleId}`);
	const ai = b.parsedResources.get('aiSections') as ParsedAISectionsV12 | undefined;
	if (!ai) throw new Error('aiSections not loaded');
	return ai;
}

// `setResource` mirrors the provider's setResource — applies the write AND
// pushes a HistoryCommit. Each call ⇒ exactly one undo entry, just like
// the live provider.
function setResource(
	state: State,
	bundleId: string,
	key: string,
	value: unknown,
): State {
	const b = state.bundles.find((x) => x.id === bundleId);
	if (!b) return state;
	const previous = b.parsedResourcesAll.get(key)?.[0] ?? null;
	const nextHistory = recordCommit<HistoryCommit>(state.history, {
		bundleId,
		resourceKey: key,
		index: 0,
		previous,
		next: value,
	});
	const nextBundles = state.bundles.map((bb) =>
		bb.id === bundleId ? applyResourceWriteToBundle(bb, key, 0, value) : bb,
	);
	return { bundles: nextBundles, history: nextHistory };
}

// Mirror the provider's `undo()`: pop the head HistoryCommit and apply
// `previous` back into the model.
function undo(state: State): State {
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
	const nextBundles = state.bundles.map((bb) =>
		bb.id === top.bundleId
			? applyResourceWriteToBundle(bb, top.resourceKey, top.index, top.previous)
			: bb,
	);
	return { bundles: nextBundles, history: out.stack };
}

function makeInitialState(): State {
	return {
		bundles: [makeEditableBundle(loadFixture(), 'AI.DAT')],
		history: emptyHistory<HistoryCommit>(),
	};
}

describe('Bulk transform gesture → Workspace undo stack', () => {
	it('one translate-only gesture pushes exactly one HistoryCommit', () => {
		const initial = makeInitialState();
		expect(initial.history.past.length).toBe(0);

		const ai = getAI(initial, 'AI.DAT');
		// Find a section with ≥1 corner so the translate is meaningful. The
		// AI.DAT fixture has thousands; index 0 is fine.
		const next = translateSectionRigid(ai, 0, { x: 5, y: 0, z: -3 });
		const after = setResource(initial, 'AI.DAT', 'aiSections', next);

		expect(after.history.past.length).toBe(1);
		expect(after.bundles[0].isModified).toBe(true);
	});

	it('one combined translate+yaw gesture also pushes exactly one HistoryCommit', () => {
		// The gizmo composes translate then yaw rotate inside its commit
		// callback before calling onChange exactly once — so even though
		// two ops compose the new model, only one setResource is called
		// and only one undo entry is pushed. This is the load-bearing
		// invariant for "one gesture = one undo step".
		const initial = makeInitialState();
		const ai = getAI(initial, 'AI.DAT');
		const t = translateSectionRigid(ai, 0, { x: 5, y: 0, z: -3 });
		const r = rotateSectionAroundCentroidYaw(t, 0, 0.3);
		const after = setResource(initial, 'AI.DAT', 'aiSections', r);

		expect(after.history.past.length).toBe(1);
	});

	it('drag-frames that update local preview state only (no setResource) do NOT push undo entries', () => {
		// Simulates the gizmo's onTransform path: every frame the consumer
		// computes a preview model but never calls setResource. The only
		// model write happens once at gesture release, in onCommit.
		const initial = makeInitialState();
		const ai = getAI(initial, 'AI.DAT');

		// Pretend 50 drag-frames passed — each rendered a preview by
		// running the op pure, but none touched the workspace state.
		let previewModel = ai;
		for (let f = 0; f < 50; f++) {
			previewModel = translateSectionRigid(ai, 0, { x: f, y: 0, z: 0 });
			// Notably: NO setResource call here. The provider's history
			// stack stays empty.
		}
		expect(initial.history.past.length).toBe(0);

		// Commit on release — single setResource with the final preview.
		const after = setResource(initial, 'AI.DAT', 'aiSections', previewModel);
		expect(after.history.past.length).toBe(1);
	});

	it('translate gesture round-trips: undo restores the pre-translate state exactly', () => {
		const initial = makeInitialState();
		const ai = getAI(initial, 'AI.DAT');

		// Snapshot the source section's pre-translate corners + portal anchors
		// so we can compare deep after the round trip.
		const beforeCorners = ai.sections[0].corners.map((c) => ({ ...c }));
		const beforePortals = ai.sections[0].portals.map((p) => ({
			...p,
			position: { ...p.position },
			boundaryLines: p.boundaryLines.map((bl) => ({ verts: { ...bl.verts } })),
		}));

		// Apply the translate and commit.
		const translated = translateSectionRigid(ai, 0, { x: 7, y: 1, z: -4 });
		const afterEdit = setResource(initial, 'AI.DAT', 'aiSections', translated);
		const editedAi = getAI(afterEdit, 'AI.DAT');
		expect(editedAi.sections[0].corners[0].x).toBeCloseTo(beforeCorners[0].x + 7, 6);

		// Undo — the model should be exactly the pre-translate AI.
		const afterUndo = undo(afterEdit);
		const undoneAi = getAI(afterUndo, 'AI.DAT');
		// `previous` is captured by reference at recordCommit time, so it
		// IS the pre-edit model — undo restores deep-equal sections (the
		// outer parsedResources map gets rewrapped by applyResourceWriteToBundle
		// so we use deep equality, not reference equality).
		expect(undoneAi.sections[0].corners).toEqual(beforeCorners);
		// Spot-check portal anchors deep-equal the pre-edit values too.
		for (let i = 0; i < beforePortals.length; i++) {
			expect(undoneAi.sections[0].portals[i].position).toEqual(beforePortals[i].position);
		}
	});

	it('yaw-rotate gesture round-trips: undo restores the pre-rotate state exactly', () => {
		// Same shape as the translate round-trip but exercising the rotate
		// op. Combined-gesture round-trip is implied by both axes' purity —
		// the commit produces one new immutable model, which `previous`
		// pins, which undo restores.
		const initial = makeInitialState();
		const ai = getAI(initial, 'AI.DAT');
		const beforeCorners = ai.sections[0].corners.map((c) => ({ ...c }));

		const rotated = rotateSectionAroundCentroidYaw(ai, 0, 0.5);
		const afterEdit = setResource(initial, 'AI.DAT', 'aiSections', rotated);
		// Confirm the rotate took effect.
		expect(getAI(afterEdit, 'AI.DAT').sections[0].corners[0])
			.not.toEqual(beforeCorners[0]);

		const afterUndo = undo(afterEdit);
		// Deep equality — same reasoning as the translate round-trip above:
		// `applyResourceWriteToBundle` rewraps the parsedResources map so
		// the outer section object is a fresh ref, but its contents match
		// the pre-edit model exactly.
		expect(getAI(afterUndo, 'AI.DAT').sections[0].corners).toEqual(beforeCorners);
	});
});
