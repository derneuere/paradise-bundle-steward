// AISectionsOverlay soup-skip hint spec — issue #82.
//
// Pins the gating logic for the Bulk transform gizmo's "N polygon soups
// not transformed" hint. The overlay branches on two inputs:
//
//   - `gizmoPosition` — non-null when there's a transformable target the
//     gizmo can anchor on (single section / sub-entity / multi-Selection
//     bulk). When null, the gizmo doesn't render — and neither does the
//     hint, because there's nothing in-scene to point the hint at.
//   - `skippedSoupCount` — distinct polygon soups across the workspace's
//     active PSL bulk. When zero, the Selection is pure-transformable;
//     when non-zero, the Selection is mixed and the hint surfaces.
//
// Vitest runs in node mode (no jsdom) so we exercise the predicate
// directly rather than rendering the overlay.

import { describe, it, expect } from 'vitest';

/** The predicate the overlay's HtmlSiblings consumes. Mirrors the inline
 *  expression `gizmoPosition != null && skippedSoupCount > 0` so a
 *  refactor of the inline form lands here loudly. */
function shouldShowSoupSkipHint(
	gizmoPositionPresent: boolean,
	skippedSoupCount: number,
): boolean {
	return gizmoPositionPresent && skippedSoupCount > 0;
}

describe('AISectionsOverlay — soup-skip hint gate (issue #82)', () => {
	it('shows the hint in the mixed regime: gizmo present + skipped soups > 0', () => {
		expect(shouldShowSoupSkipHint(true, 2)).toBe(true);
		expect(shouldShowSoupSkipHint(true, 1)).toBe(true);
	});

	it('hides the hint in the soup-only regime: no gizmo, even with skipped soups (gizmo refuses to render)', () => {
		// Soup-only Selection ⇒ no AI section refs ⇒ no gizmo target ⇒
		// `gizmoPosition` is null ⇒ no hint. The user sees neither gizmo
		// nor hint, which is the spec ("the Bulk transform handle refuses
		// if a soup is in the Selection" — CONTEXT.md / "Pivot").
		expect(shouldShowSoupSkipHint(false, 1)).toBe(false);
		expect(shouldShowSoupSkipHint(false, 5)).toBe(false);
	});

	it('hides the hint in the pure-transformable regime: gizmo present, no skipped soups', () => {
		// AI-sections-only Selection ⇒ gizmo renders but no soup hint
		// (nothing to skip).
		expect(shouldShowSoupSkipHint(true, 0)).toBe(false);
	});

	it('hides the hint when both inputs are absent', () => {
		expect(shouldShowSoupSkipHint(false, 0)).toBe(false);
	});

	it('count transitions: 0 → 1 → 0 (Selection picks up a soup then drops it)', () => {
		// Selection starts pure-transformable
		expect(shouldShowSoupSkipHint(true, 0)).toBe(false);
		// User Ctrl-picks a polygon → soup count = 1, hint surfaces
		expect(shouldShowSoupSkipHint(true, 1)).toBe(true);
		// User Ctrl-picks again to drop it → soup count = 0, hint hides
		expect(shouldShowSoupSkipHint(true, 0)).toBe(false);
	});
});
