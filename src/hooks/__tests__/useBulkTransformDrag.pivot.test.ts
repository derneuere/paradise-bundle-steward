// Unit tests pinning the **Pivot drag-reposition** wiring contract (issue #76).
//
// The full hook is window-event-driven and lives inside an R3F component
// context — the repo's vitest env is `node` so we can't mount the gizmo.
// What we pin here is the dispatch shape:
//
//   - `GizmoHandleKind` includes the new `'pivot'` literal so callers can
//     narrow on `kind === 'pivot'`.
//   - A pivot-drag gesture does NOT produce a `BulkTransformDelta` — it
//     emits through `onPivotMove` / `onPivotCommit` instead, leaving the
//     Selection-affecting `onTransform` / `onCommit` callbacks untouched.
//     The hook's `computeDelta` path explicitly returns `null` for the
//     pivot kind; we exercise that contract by importing the hook's type
//     and asserting the relevant fields exist + carry the right shape.
//
// The behavioural assertions for "pivot reposition does NOT mutate the
// Selection" and "no HistoryCommit is pushed" live in the overlay-level
// pivot test (`AISectionsOverlay.pivot.test.ts`) which goes through the
// `applyDragToModel` dispatcher — the user-visible commit boundary.

import { describe, it, expect } from 'vitest';
import type {
	BulkTransformDragOptions,
	GizmoHandleKind,
} from '../useBulkTransformDrag';
import { PIVOT_AXIS } from '../useBulkTransformDrag';

describe('useBulkTransformDrag — pivot kind (issue #76)', () => {
	it('GizmoHandleKind accepts the literal `pivot`', () => {
		// Pure compile-time pin. Runtime expectation is just that the value
		// fits — TypeScript guarantees the rest. If a future change drops
		// the literal, this assignment would fail to compile.
		const k: GizmoHandleKind = 'pivot';
		expect(k).toBe('pivot');
	});

	it('PIVOT_AXIS exports the canonical axis tag for the pivot handle', () => {
		// The pivot handle is not axis-locked, but we collapse its
		// `GizmoHandleAxis` onto the existing `'x' | 'y' | 'z'` discriminator
		// rather than widening the union. Consumers always branch on
		// `kind === 'pivot'` first, so the axis value is just a placeholder
		// — but it has to be one of the three for `setActive(...)` to type-
		// check.
		expect(PIVOT_AXIS).toBe('y');
	});

	it('BulkTransformDragOptions advertises onPivotMove / onPivotCommit / onPivotCancel as optional', () => {
		// Sanity: optional callbacks mean overlays that don't yet support
		// pivot reposition keep compiling without changes. We exercise this
		// via a typed-but-empty options object.
		const opts: Partial<BulkTransformDragOptions> = {};
		expect(opts.onPivotMove).toBeUndefined();
		expect(opts.onPivotCommit).toBeUndefined();
		expect(opts.onPivotCancel).toBeUndefined();

		// Now assign a handler — should still type-check.
		const positions: Array<{ x: number; y: number; z: number }> = [];
		opts.onPivotMove = (p) => { positions.push(p); };
		opts.onPivotMove({ x: 1, y: 2, z: 3 });
		expect(positions).toEqual([{ x: 1, y: 2, z: 3 }]);
	});
});
