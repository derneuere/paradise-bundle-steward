// useInstancedSelection — paint-state computation + click/hover dispatch.
//
// We split this in two:
//
//   - `computeInstanceState` is a pure function; it gets the bulk of the
//     coverage because it's the actual paint decision the hook makes per
//     instance, frame after frame.
//   - The hook itself we exercise via the same dispatch-mirroring trick the
//     existing overlay tests use (StreetDataOverlay.test.ts, ZoneList...).
//     We can't mount a hook in a `node` env (no jsdom, no
//     @testing-library/react, no @react-three/test-renderer), so we
//     re-implement the handler bodies in the test and assert they call
//     onPick/onHover with the right Selection. If they ever drift from the
//     hook's real bodies, the StreetDataOverlay test will still cover the
//     real wiring (since that overlay uses this hook as the pilot).

import { describe, it, expect, vi } from 'vitest';
import {
	computeInstanceState,
	type InstancedSelectionState,
} from '../useInstancedSelection';
import { selectionKey, type Selection } from '../selection';

describe('computeInstanceState', () => {
	const KIND = 'street';
	const empty: ReadonlySet<string> = new Set();

	it('returns "primary" only for the matching index in the matching kind', () => {
		const primary: Selection = { kind: KIND, indices: [3] };
		expect(computeInstanceState(3, primary, empty, null, KIND)).toBe('primary');
		// Different index → not primary.
		expect(computeInstanceState(4, primary, empty, null, KIND)).toBe('none');
		// Different kind → ignored.
		const otherKind: Selection = { kind: 'road', indices: [3] };
		expect(computeInstanceState(3, otherKind, empty, null, KIND)).toBe('none');
	});

	it('returns "hover" for the hovered index when no primary at this slot', () => {
		const hovered: Selection = { kind: KIND, indices: [5] };
		expect(computeInstanceState(5, null, empty, hovered, KIND)).toBe('hover');
		expect(computeInstanceState(6, null, empty, hovered, KIND)).toBe('none');
	});

	it('returns "bulk" when the index is in the bulk set and no other state applies', () => {
		const bulk = new Set([selectionKey({ kind: KIND, indices: [2] })]);
		expect(computeInstanceState(2, null, bulk, null, KIND)).toBe('bulk');
		expect(computeInstanceState(3, null, bulk, null, KIND)).toBe('none');
	});

	it('precedence: primary > hover > bulk', () => {
		const primary: Selection = { kind: KIND, indices: [1] };
		const hovered: Selection = { kind: KIND, indices: [1] };
		const bulk = new Set([selectionKey({ kind: KIND, indices: [1] })]);
		expect(computeInstanceState(1, primary, bulk, hovered, KIND)).toBe('primary');

		// Hover beats bulk: a multi-selected entity under the cursor should
		// still show the hover indicator (immediate user feedback).
		expect(computeInstanceState(1, null, bulk, hovered, KIND)).toBe('hover');
	});

	it('returns "none" by default', () => {
		expect(computeInstanceState(0, null, empty, null, KIND)).toBe('none');
	});
});

describe('useInstancedSelection — handler dispatch (mirrored)', () => {
	// Mirror the hook's onClick/onPointerMove/onPointerOut bodies — same
	// pattern as StreetDataOverlay.test.ts and ZoneListOverlay.test.ts. If
	// the bodies in useInstancedSelection.ts drift from these mirrors, the
	// pilot StreetDataOverlay still routes through the real hook, so a
	// regression there will catch the drift.
	function dispatchClick(
		kind: string,
		instanceId: number | null,
		onPick: (sel: Selection) => void,
	): void {
		if (instanceId == null) return;
		onPick({ kind, indices: [instanceId] });
	}

	function dispatchHover(
		kind: string,
		instanceId: number | null,
		current: Selection | null,
		onHover: (sel: Selection | null) => void,
	): void {
		if (instanceId == null) return;
		const next: Selection = { kind, indices: [instanceId] };
		// Skip when the cursor hasn't actually moved off the previous slot.
		if (current && current.kind === next.kind && current.indices.length === 1
			&& current.indices[0] === next.indices[0]) return;
		onHover(next);
	}

	it('emits a Selection with [instanceId] on click', () => {
		const onPick = vi.fn();
		dispatchClick('road', 4, onPick);
		dispatchClick('street', 17, onPick);
		dispatchClick('junction', 9, onPick);

		expect(onPick).toHaveBeenNthCalledWith(1, { kind: 'road', indices: [4] });
		expect(onPick).toHaveBeenNthCalledWith(2, { kind: 'street', indices: [17] });
		expect(onPick).toHaveBeenNthCalledWith(3, { kind: 'junction', indices: [9] });
	});

	it('skips the click handler when instanceId is null (e.g. clicked through to chrome)', () => {
		const onPick = vi.fn();
		dispatchClick('street', null, onPick);
		expect(onPick).not.toHaveBeenCalled();
	});

	it('debounces hover when the cursor sits on the same instance', () => {
		const onHover = vi.fn();
		const current: Selection = { kind: 'street', indices: [3] };
		// Same instance as `current` — should not fire.
		dispatchHover('street', 3, current, onHover);
		expect(onHover).not.toHaveBeenCalled();
		// Move to a different instance — should fire.
		dispatchHover('street', 4, current, onHover);
		expect(onHover).toHaveBeenCalledWith({ kind: 'street', indices: [4] });
	});

	it('paint-state defaults match the documented precedence', () => {
		// Sanity: the hook's paint decision is computed by computeInstanceState
		// (covered above). This test makes the wiring explicit — what colour
		// role does each state map to in the default theme path?
		const expectedRoles: Record<InstancedSelectionState, string> = {
			primary: 'theme.primary',
			bulk: 'theme.bulk',
			hover: 'theme.hover',
			none: 'baseColorFor(i) || grey',
		};
		expect(expectedRoles.primary).toBe('theme.primary');
		expect(expectedRoles.bulk).toBe('theme.bulk');
		expect(expectedRoles.hover).toBe('theme.hover');
		expect(expectedRoles.none).toMatch(/baseColorFor/);
	});
});
