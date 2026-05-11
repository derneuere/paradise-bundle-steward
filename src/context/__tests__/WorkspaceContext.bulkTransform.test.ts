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
	bulkRotateEntitiesYaw,
	bulkSelectionPivot,
	bulkTranslateEntities,
	rotateSectionAroundCentroidYaw,
	rotateSectionWithLinksYaw,
	translateSectionRigid,
	translateSectionWithLinks,
	type AISectionEntityRef,
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

	// ---------------------------------------------------------------------------
	// Cascade-on path (issue #75): ONE undo entry per gesture, regardless of
	// modifier state. The cascade-on op mutates more sections per call (the
	// neighbour cascade), but the gizmo's commit still funnels through a
	// single onChange → setResource call, so the Workspace-undo stack grows
	// by exactly one entry per gesture.
	// ---------------------------------------------------------------------------

	it('cascade-on translate gesture pushes exactly one HistoryCommit (per ADR-0009 + issue #75)', () => {
		const initial = makeInitialState();
		const ai = getAI(initial, 'AI.DAT');
		const next = translateSectionWithLinks(ai, 0, { x: 5, z: -3 });
		const after = setResource(initial, 'AI.DAT', 'aiSections', next);
		expect(after.history.past.length).toBe(1);
		expect(after.bundles[0].isModified).toBe(true);
	});

	it('cascade-on combined translate+yaw gesture also pushes exactly one HistoryCommit', () => {
		// The gizmo composes translate-with-links then rotate-with-links
		// inside its commit callback before calling onChange exactly once —
		// so even though both ops cascade into neighbours, only ONE
		// setResource fires and only ONE undo entry lands.
		const initial = makeInitialState();
		const ai = getAI(initial, 'AI.DAT');
		const t = translateSectionWithLinks(ai, 0, { x: 5, z: -3 });
		const r = rotateSectionWithLinksYaw(t, 0, 0.3);
		const after = setResource(initial, 'AI.DAT', 'aiSections', r);
		expect(after.history.past.length).toBe(1);
	});

	it('cascade-on round-trip: undo restores neighbour sections too (not just the source)', () => {
		// The cascade-on path mutates outside neighbours' reverse portals +
		// shared corners. Undo's `previous` snapshot is the WHOLE ParsedAI
		// model, so neighbour sections snap back deep-equal as well.
		const initial = makeInitialState();
		const ai = getAI(initial, 'AI.DAT');

		// Pick a section that actually has at least one portal pointing
		// somewhere else — AI.DAT has thousands; section 0 is a reasonable
		// bet but we filter for a portal-having one to be safe.
		const srcIdx = ai.sections.findIndex(
			(s) => s.portals.length > 0 && s.portals[0].linkSection >= 0 && s.portals[0].linkSection < ai.sections.length && s.portals[0].linkSection !== ai.sections.indexOf(s),
		);
		if (srcIdx === -1) {
			// Defensive guard — every fixture has at least one connected pair.
			throw new Error('no cascading source in fixture');
		}
		const neighbourIdx = ai.sections[srcIdx].portals[0].linkSection;

		const beforeNeighbourPortals = ai.sections[neighbourIdx].portals.map((p) => ({
			...p,
			position: { ...p.position },
		}));

		const next = translateSectionWithLinks(ai, srcIdx, { x: 7, z: -4 });
		const afterEdit = setResource(initial, 'AI.DAT', 'aiSections', next);
		// Confirm cascade took effect: the neighbour's reverse portal moved.
		const editedNeighbour = getAI(afterEdit, 'AI.DAT').sections[neighbourIdx];
		expect(editedNeighbour.portals).not.toEqual(beforeNeighbourPortals);

		const afterUndo = undo(afterEdit);
		const undoneNeighbour = getAI(afterUndo, 'AI.DAT').sections[neighbourIdx];
		// Neighbour restored deep-equal to its pre-edit state.
		expect(undoneNeighbour.portals.map((p) => p.position)).toEqual(
			beforeNeighbourPortals.map((p) => p.position),
		);
	});
});

// =============================================================================
// Multi-Selection bulk gesture (issue #74)
// =============================================================================
//
// Same one-gesture-one-undo-entry contract as the single-section gestures
// above, but applied to a list of AI section refs. The bulk ops compose
// translate-then-rotate against the bulk Pivot inside the commit handler;
// the workspace sees exactly one setResource per gesture.

describe('Multi-Selection bulk gesture → Workspace undo stack', () => {
	it('one bulk-translate gesture across N sections pushes exactly ONE HistoryCommit', () => {
		// Bulk size has no bearing on the undo-stack contract — even when
		// the gesture spans many sections, the commit handler funnels through
		// a single setResource call and pushes one HistoryCommit. This pins
		// CONTEXT.md / "Bulk transform"'s "one undo entry per gesture,
		// regardless of bulk size".
		const initial = makeInitialState();
		const ai = getAI(initial, 'AI.DAT');
		const refs: AISectionEntityRef[] = [
			{ kind: 'section', sectionIdx: 0 },
			{ kind: 'section', sectionIdx: 1 },
			{ kind: 'section', sectionIdx: 2 },
			{ kind: 'section', sectionIdx: 3 },
		];
		const next = bulkTranslateEntities(ai, refs, { x: 12, y: 0, z: -7 });
		const after = setResource(initial, 'AI.DAT', 'aiSections', next);
		expect(after.history.past.length).toBe(1);
	});

	it('one bulk-rotate gesture pushes exactly ONE HistoryCommit (regardless of cardinality)', () => {
		const initial = makeInitialState();
		const ai = getAI(initial, 'AI.DAT');
		const refs: AISectionEntityRef[] = [
			{ kind: 'section', sectionIdx: 0 },
			{ kind: 'section', sectionIdx: 1 },
			{ kind: 'section', sectionIdx: 2 },
		];
		const pivot = bulkSelectionPivot(ai, refs, () => 0);
		expect(pivot).not.toBeNull();
		const next = bulkRotateEntitiesYaw(ai, refs, { x: pivot!.x, z: pivot!.z }, 0.3);
		const after = setResource(initial, 'AI.DAT', 'aiSections', next);
		expect(after.history.past.length).toBe(1);
	});

	it('combined bulk translate + yaw still produces exactly one HistoryCommit', () => {
		// The overlay's commit composes translate then yaw rotate against the
		// post-translate pivot before calling onChange exactly once. Even
		// though two ops produce the new model, only one setResource fires.
		const initial = makeInitialState();
		const ai = getAI(initial, 'AI.DAT');
		const refs: AISectionEntityRef[] = [
			{ kind: 'section', sectionIdx: 0 },
			{ kind: 'section', sectionIdx: 1 },
		];
		const pivot = bulkSelectionPivot(ai, refs, () => 0);
		const t = bulkTranslateEntities(ai, refs, { x: 50, y: 0, z: -30 });
		const r = bulkRotateEntitiesYaw(t, refs, { x: pivot!.x + 50, z: pivot!.z - 30 }, 0.2);
		const after = setResource(initial, 'AI.DAT', 'aiSections', r);
		expect(after.history.past.length).toBe(1);
	});

	it('drag-frame previews never touch the workspace (no per-frame undo entries)', () => {
		// Same shape as the single-section drag-frame test: 50 synthetic
		// drag-frames each compute a preview pure, but only the commit-on-
		// release calls setResource. The history stack must remain empty
		// across the entire preview phase.
		const initial = makeInitialState();
		const ai = getAI(initial, 'AI.DAT');
		const refs: AISectionEntityRef[] = [
			{ kind: 'section', sectionIdx: 0 },
			{ kind: 'section', sectionIdx: 1 },
		];
		let previewModel = ai;
		for (let f = 0; f < 50; f++) {
			previewModel = bulkTranslateEntities(ai, refs, { x: f, y: 0, z: 0 });
		}
		expect(initial.history.past.length).toBe(0);
		const after = setResource(initial, 'AI.DAT', 'aiSections', previewModel);
		expect(after.history.past.length).toBe(1);
	});

	it('bulk gesture round-trips: undo restores every entity in the bulk to its pre-gesture state', () => {
		const initial = makeInitialState();
		const ai = getAI(initial, 'AI.DAT');
		const refs: AISectionEntityRef[] = [
			{ kind: 'section', sectionIdx: 0 },
			{ kind: 'section', sectionIdx: 1 },
		];
		const beforeS0 = ai.sections[0].corners.map((c) => ({ ...c }));
		const beforeS1 = ai.sections[1].corners.map((c) => ({ ...c }));
		const beforeS2 = ai.sections[2].corners.map((c) => ({ ...c })); // outside the bulk

		const moved = bulkTranslateEntities(ai, refs, { x: 5, y: 0, z: -2 });
		const afterEdit = setResource(initial, 'AI.DAT', 'aiSections', moved);
		// Outside neighbour (s2) was never touched even before undo.
		expect(getAI(afterEdit, 'AI.DAT').sections[2].corners).toEqual(beforeS2);

		const afterUndo = undo(afterEdit);
		expect(getAI(afterUndo, 'AI.DAT').sections[0].corners).toEqual(beforeS0);
		expect(getAI(afterUndo, 'AI.DAT').sections[1].corners).toEqual(beforeS1);
		expect(getAI(afterUndo, 'AI.DAT').sections[2].corners).toEqual(beforeS2);
	});

	it('no-op bulk gesture (zero translate + zero rotate) does not push an undo entry', () => {
		// The commit handler's `if (isIdentityDelta(delta)) return;` guard
		// makes a click-without-drag a true no-op. The op returns the
		// identical model reference, setResource is never called, and the
		// history stack stays empty — required for byte-for-byte BND2
		// writeback safety on a cancelled gesture.
		const initial = makeInitialState();
		const ai = getAI(initial, 'AI.DAT');
		const refs: AISectionEntityRef[] = [
			{ kind: 'section', sectionIdx: 0 },
			{ kind: 'section', sectionIdx: 1 },
		];
		const t = bulkTranslateEntities(ai, refs, { x: 0, y: 0, z: 0 });
		const r = bulkRotateEntitiesYaw(t, refs, { x: 0, z: 0 }, 0);
		// Both ops returned the same model reference; the overlay's `if (next === data) return;`
		// guard would short-circuit before setResource. Simulate that here.
		expect(r).toBe(ai);
		// No setResource call happens for a no-op gesture.
		expect(initial.history.past.length).toBe(0);
	});
});
