// Tests for the BulkTransformGizmoSession plumbing (issue #81).
//
// The repo's vitest env is `node` with no jsdom — see existing test files
// for the pattern. So we exercise the pure helpers (`applyTypedDeltaEdit`,
// `applyTypedPivotEdit`) and the session contract by hand-driving the
// GizmoSession shape: build a session, simulate the panel's calls into it,
// and assert the published mutations.

import { describe, it, expect, vi } from 'vitest';
import {
	applyTypedDeltaEdit,
	applyTypedPivotEdit,
	type GizmoSession,
} from '../BulkTransformGizmoSession';
import {
	identityDelta,
	type BulkTransformDelta,
} from '@/hooks/useBulkTransformDrag';
import { TRANSFORM_AXES_FULL_3D, TRANSFORM_AXES_XZ_PACKED } from '@/lib/core/transformAxes';

// =============================================================================
// applyTypedDeltaEdit
// =============================================================================

describe('applyTypedDeltaEdit', () => {
	it('replaces the named translate axis verbatim', () => {
		const before = identityDelta();
		const after = applyTypedDeltaEdit(before, 'translate', 'x', 42.5);
		expect(after).toEqual({
			translate: { x: 42.5, y: 0, z: 0 },
			rotate: { x: 0, y: 0, z: 0 },
			cascade: false,
		});
	});

	it('replaces the named rotate axis verbatim (radians on the wire)', () => {
		const before = identityDelta();
		// 90° == π/2 radians.
		const after = applyTypedDeltaEdit(before, 'rotate', 'y', Math.PI / 2);
		expect(after.rotate.y).toBeCloseTo(Math.PI / 2);
		expect(after.rotate.x).toBe(0);
		expect(after.rotate.z).toBe(0);
		expect(after.translate).toEqual({ x: 0, y: 0, z: 0 });
	});

	it('preserves the cascade flag (and never auto-flips it from a typed edit)', () => {
		const before: BulkTransformDelta = { ...identityDelta(true) };
		const after = applyTypedDeltaEdit(before, 'translate', 'z', 7);
		expect(after.cascade).toBe(true);
	});

	it('treats sibling axes as untouched', () => {
		const before: BulkTransformDelta = {
			translate: { x: 1, y: 2, z: 3 },
			rotate: { x: 4, y: 5, z: 6 },
			cascade: false,
		};
		const after = applyTypedDeltaEdit(before, 'rotate', 'x', 999);
		expect(after.translate).toEqual({ x: 1, y: 2, z: 3 });
		expect(after.rotate).toEqual({ x: 999, y: 5, z: 6 });
	});

	it('does not mutate the input', () => {
		const before = identityDelta();
		const snap = JSON.stringify(before);
		applyTypedDeltaEdit(before, 'translate', 'y', 9);
		expect(JSON.stringify(before)).toBe(snap);
	});
});

// =============================================================================
// applyTypedPivotEdit
// =============================================================================

describe('applyTypedPivotEdit', () => {
	it('replaces the named axis verbatim', () => {
		const before = { x: 100, y: 0, z: -50 };
		expect(applyTypedPivotEdit(before, 'x', 42)).toEqual({ x: 42, y: 0, z: -50 });
		expect(applyTypedPivotEdit(before, 'y', 1.5)).toEqual({ x: 100, y: 1.5, z: -50 });
		expect(applyTypedPivotEdit(before, 'z', 0)).toEqual({ x: 100, y: 0, z: 0 });
	});

	it('does not mutate the input', () => {
		const before = { x: 1, y: 2, z: 3 };
		const snap = JSON.stringify(before);
		applyTypedPivotEdit(before, 'x', 99);
		expect(JSON.stringify(before)).toBe(snap);
	});
});

// =============================================================================
// GizmoSession contract — the four asserts from the issue's "Tests" section.
//
// Strategy: build a fake "overlay-side" session backed by a tiny state-
// machine that mirrors what AISectionsOverlay does. Drive it from the
// panel-side calls (the panel ends up calling `session.setDelta` on every
// keystroke, `session.commit` on Enter, `session.setPivot` on every pivot
// keystroke). Assert the overlay-side observables match the issue's
// acceptance criteria.
// =============================================================================

function makeFakeOverlay() {
	const state: {
		delta: BulkTransformDelta;
		pivot: { x: number; y: number; z: number };
		commits: BulkTransformDelta[];
	} = {
		delta: identityDelta(),
		pivot: { x: 0, y: 0, z: 0 },
		commits: [],
	};
	const session: GizmoSession = {
		id: 'test::session',
		delta: state.delta,
		pivot: state.pivot,
		axes: TRANSFORM_AXES_FULL_3D,
		setDelta: vi.fn((d) => {
			state.delta = d;
			session.delta = d;
		}),
		commit: vi.fn((typed) => {
			// Mirror the overlay's commit contract — push to history, reset
			// staged delta to identity. The fake's `commits` array stands
			// in for the HistoryCommit log.
			state.commits.push(typed);
			state.delta = identityDelta();
			session.delta = identityDelta();
		}),
		setPivot: vi.fn((world) => {
			state.pivot = { ...world };
			session.pivot = state.pivot;
		}),
	};
	return { state, session };
}

describe('GizmoSession — drag updates the panel', () => {
	it('a drag-frame mutation to delta is visible to the panel via session.delta', () => {
		const { session } = makeFakeOverlay();
		// Pretend a drag-frame fired — the overlay would write a new delta
		// through `setDelta` (or equivalent internal state), and the
		// re-published session reflects it. The panel reads `session.delta`
		// every render.
		const dragFrame: BulkTransformDelta = {
			translate: { x: 12, y: 0, z: 0 },
			rotate: { x: 0, y: 0, z: 0 },
			cascade: false,
		};
		session.setDelta(dragFrame);
		expect(session.delta).toEqual(dragFrame);
	});
});

describe('GizmoSession — panel-typed value commits once (one HistoryCommit per gesture)', () => {
	it('commit fires exactly once per typed Enter; delta resets to identity', () => {
		const { state, session } = makeFakeOverlay();
		// User types into rotate-Y and presses Enter.
		const typed: BulkTransformDelta = {
			translate: { x: 0, y: 0, z: 0 },
			rotate: { x: 0, y: Math.PI / 4, z: 0 },
			cascade: false,
		};
		session.commit(typed);
		expect(state.commits).toHaveLength(1);
		expect(state.commits[0]).toEqual(typed);
		// Reset-to-zero rule.
		expect(session.delta).toEqual(identityDelta());
	});

	it('typed commits are independent — three typed-Enters yield three HistoryCommits', () => {
		const { state, session } = makeFakeOverlay();
		const d1: BulkTransformDelta = { translate: { x: 1, y: 0, z: 0 }, rotate: { x: 0, y: 0, z: 0 }, cascade: false };
		const d2: BulkTransformDelta = { translate: { x: 0, y: 2, z: 0 }, rotate: { x: 0, y: 0, z: 0 }, cascade: false };
		const d3: BulkTransformDelta = { translate: { x: 0, y: 0, z: 3 }, rotate: { x: 0, y: 0, z: 0 }, cascade: false };
		session.commit(d1);
		session.commit(d2);
		session.commit(d3);
		expect(state.commits).toEqual([d1, d2, d3]);
	});
});

describe('GizmoSession — pivot edits do NOT push history', () => {
	it('setPivot moves the pivot; no entries land in the commits log', () => {
		const { state, session } = makeFakeOverlay();
		session.setPivot({ x: 100, y: 5, z: -200 });
		expect(state.pivot).toEqual({ x: 100, y: 5, z: -200 });
		expect(state.commits).toEqual([]); // no undo entry pushed
	});

	it('multiple pivot edits never push history', () => {
		const { state, session } = makeFakeOverlay();
		session.setPivot({ x: 1, y: 0, z: 0 });
		session.setPivot({ x: 2, y: 0, z: 0 });
		session.setPivot({ x: 3, y: 0, z: 0 });
		expect(state.pivot.x).toBe(3);
		expect(state.commits).toEqual([]);
	});
});

describe('GizmoSession — auto-disable rule (XZ-packed selection → rotate X/Z disabled)', () => {
	it('XZ-packed axes profile leaves rotate.y enabled and rotate.x / rotate.z disabled', () => {
		expect(TRANSFORM_AXES_XZ_PACKED.rotate.x).toBe(false);
		expect(TRANSFORM_AXES_XZ_PACKED.rotate.y).toBe(true);
		expect(TRANSFORM_AXES_XZ_PACKED.rotate.z).toBe(false);
	});

	it('session carries the axes profile to the panel verbatim', () => {
		const { session } = makeFakeOverlay();
		// Mutate the axes — same shape the overlay would publish when its
		// gizmoTarget switches from FULL_3D to XZ_PACKED.
		const sessionWithXZ: GizmoSession = {
			...session,
			axes: TRANSFORM_AXES_XZ_PACKED,
		};
		expect(sessionWithXZ.axes.rotate.x).toBe(false);
		expect(sessionWithXZ.axes.rotate.z).toBe(false);
		expect(sessionWithXZ.axes.translate.x).toBe(true);
		expect(sessionWithXZ.axes.translate.y).toBe(true);
		expect(sessionWithXZ.axes.translate.z).toBe(true);
	});
});

describe('GizmoSession — composed scenario (drag→commit→typed commit→reset)', () => {
	it('one drag updates delta live, commit resets; a typed Enter then commits with a fresh start', () => {
		const { state, session } = makeFakeOverlay();
		// Frame 1 of a drag — panel sees delta.
		session.setDelta({
			translate: { x: 1.0, y: 0, z: 0 },
			rotate: { x: 0, y: 0, z: 0 },
			cascade: false,
		});
		expect(session.delta.translate.x).toBe(1.0);
		// Frame 2 — delta grows.
		session.setDelta({
			translate: { x: 1.5, y: 0, z: 0 },
			rotate: { x: 0, y: 0, z: 0 },
			cascade: false,
		});
		expect(session.delta.translate.x).toBe(1.5);
		// Pointerup — commit fires, delta resets.
		session.commit(session.delta);
		expect(state.commits).toHaveLength(1);
		expect(state.commits[0].translate.x).toBe(1.5);
		expect(session.delta).toEqual(identityDelta());
		// Now the user types into Z and presses Enter.
		session.commit({
			translate: { x: 0, y: 0, z: 7 },
			rotate: { x: 0, y: 0, z: 0 },
			cascade: false,
		});
		expect(state.commits).toHaveLength(2);
		expect(state.commits[1].translate.z).toBe(7);
		expect(session.delta).toEqual(identityDelta());
	});

	it('an identity delta is the post-commit observable; the panel will display zeros', () => {
		const { session } = makeFakeOverlay();
		session.setDelta({
			translate: { x: 3, y: 0, z: 0 },
			rotate: { x: 0, y: 0, z: 0 },
			cascade: false,
		});
		session.commit(session.delta);
		// Reset-to-zero rule — each axis reads 0 after the commit.
		expect(session.delta.translate.x).toBe(0);
		expect(session.delta.translate.y).toBe(0);
		expect(session.delta.translate.z).toBe(0);
		expect(session.delta.rotate.x).toBe(0);
		expect(session.delta.rotate.y).toBe(0);
		expect(session.delta.rotate.z).toBe(0);
	});
});
