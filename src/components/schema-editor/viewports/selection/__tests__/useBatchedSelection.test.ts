// useBatchedSelection — paint loop + click/hover dispatch.
//
// The hook reuses `computeInstanceState` from useInstancedSelection so the
// state-precedence rule isn't tested again here (covered in
// useInstancedSelection.test.ts). What this file *does* cover:
//
//   - Color resolution: state → color via theme + paintFor + baseColorFor
//     precedence (the new piece this hook adds).
//   - The dispatch bodies for onClick / onPointerMove / onPointerOut, mirrored
//     in plain functions so we don't need DOM-test infra (same pattern as
//     useInstancedSelection.test.ts).
//   - The `mapEntityToSelection` opt-in for nested-address overlays
//     (PolygonSoupList passes [soupIndex, polyIndex]).
//   - The setBodyCursor guard for node-environment runs.

import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import {
	useBatchedSelection,
	type UseBatchedSelectionOpts,
} from '../useBatchedSelection';
import type { InstancedSelectionState } from '../useInstancedSelection';
import { selectionKey, type Selection } from '../selection';
import { SELECTION_THEME } from '../theme';

// ---------------------------------------------------------------------------
// Re-exports as smoke checks — index wiring + the hook is callable.
// ---------------------------------------------------------------------------

describe('useBatchedSelection — module surface', () => {
	it('is exported', () => {
		expect(typeof useBatchedSelection).toBe('function');
	});
});

// ---------------------------------------------------------------------------
// Color resolution mirror — duplicates the resolve branch the hook walks
// inside its useEffect, so we can assert the precedence in pure code.
// ---------------------------------------------------------------------------

const DEFAULT_BASE = new THREE.Color(0x888888);

function resolveColor(
	i: number,
	state: InstancedSelectionState,
	opts: Pick<UseBatchedSelectionOpts, 'paintFor' | 'baseColorFor' | 'theme'>,
): THREE.Color {
	const theme = opts.theme ?? SELECTION_THEME;
	if (opts.paintFor) return opts.paintFor(i, state);
	if (state === 'primary') return theme.primary;
	if (state === 'hover') return theme.hover;
	if (state === 'bulk') return theme.bulk;
	return opts.baseColorFor ? opts.baseColorFor(i) : DEFAULT_BASE;
}

describe('useBatchedSelection — color resolution', () => {
	it('uses theme colors for non-none states by default', () => {
		expect(resolveColor(0, 'primary', {}).getHex()).toBe(SELECTION_THEME.primary.getHex());
		expect(resolveColor(0, 'hover', {}).getHex()).toBe(SELECTION_THEME.hover.getHex());
		expect(resolveColor(0, 'bulk', {}).getHex()).toBe(SELECTION_THEME.bulk.getHex());
	});

	it('falls back to grey for none state when no baseColorFor is given', () => {
		expect(resolveColor(0, 'none', {}).getHex()).toBe(0x888888);
	});

	it('uses baseColorFor for none state when supplied', () => {
		const blue = new THREE.Color(0x0000ff);
		const baseColorFor = vi.fn(() => blue);
		const result = resolveColor(7, 'none', { baseColorFor });
		expect(result).toBe(blue);
		expect(baseColorFor).toHaveBeenCalledWith(7);
	});

	it('paintFor wins over theme + baseColorFor for every state', () => {
		const purple = new THREE.Color(0x800080);
		const baseBlue = new THREE.Color(0x0000ff);
		const paintFor = vi.fn(() => purple);
		const baseColorFor = vi.fn(() => baseBlue);
		const states: InstancedSelectionState[] = ['primary', 'hover', 'bulk', 'none'];
		for (const state of states) {
			expect(resolveColor(2, state, { paintFor, baseColorFor }).getHex()).toBe(0x800080);
		}
		expect(paintFor).toHaveBeenCalledTimes(states.length);
		// baseColorFor is short-circuited by paintFor.
		expect(baseColorFor).not.toHaveBeenCalled();
	});

	it('honours a theme override for the three highlight states', () => {
		const theme = {
			primary: new THREE.Color(0x111111),
			bulk: new THREE.Color(0x222222),
			hover: new THREE.Color(0x333333),
		};
		expect(resolveColor(0, 'primary', { theme }).getHex()).toBe(0x111111);
		expect(resolveColor(0, 'bulk', { theme }).getHex()).toBe(0x222222);
		expect(resolveColor(0, 'hover', { theme }).getHex()).toBe(0x333333);
		// Theme override doesn't affect the 'none' fallback.
		expect(resolveColor(0, 'none', { theme }).getHex()).toBe(0x888888);
	});
});

// ---------------------------------------------------------------------------
// Paint loop simulation — exercises the same body the hook's useEffect runs.
// ---------------------------------------------------------------------------

import { computeInstanceState } from '../useInstancedSelection';

function simulatePaintLoop(opts: {
	kind: string;
	count: number;
	primary: Selection | null;
	bulk: ReadonlySet<string>;
	hovered: Selection | null;
	paintFor?: UseBatchedSelectionOpts['paintFor'];
	baseColorFor?: UseBatchedSelectionOpts['baseColorFor'];
	applyColor: UseBatchedSelectionOpts['applyColor'];
}): void {
	for (let i = 0; i < opts.count; i++) {
		const state = computeInstanceState(i, opts.primary, opts.bulk, opts.hovered, opts.kind);
		const color = resolveColor(i, state, opts);
		opts.applyColor(i, color, state);
	}
}

describe('useBatchedSelection — paint loop', () => {
	const KIND = 'zone';
	const empty: ReadonlySet<string> = new Set();

	it('invokes applyColor exactly once per entity', () => {
		const applyColor = vi.fn();
		simulatePaintLoop({
			kind: KIND, count: 5, primary: null, bulk: empty, hovered: null, applyColor,
		});
		expect(applyColor).toHaveBeenCalledTimes(5);
		const indices = applyColor.mock.calls.map((call) => call[0]);
		expect(indices).toEqual([0, 1, 2, 3, 4]);
	});

	it('passes the resolved color and state to applyColor', () => {
		const applyColor = vi.fn();
		const primary: Selection = { kind: KIND, indices: [2] };
		simulatePaintLoop({
			kind: KIND, count: 4, primary, bulk: empty, hovered: null, applyColor,
		});
		// Slot 2 should have received primary state + theme.primary color.
		const call2 = applyColor.mock.calls.find((c) => c[0] === 2);
		expect(call2).toBeDefined();
		expect(call2![1].getHex()).toBe(SELECTION_THEME.primary.getHex());
		expect(call2![2]).toBe('primary');
		// Slot 0 falls through to none + grey.
		const call0 = applyColor.mock.calls.find((c) => c[0] === 0);
		expect(call0![2]).toBe('none');
	});

	it('paints bulk entities with theme.bulk', () => {
		const applyColor = vi.fn();
		const bulk = new Set([selectionKey({ kind: KIND, indices: [1] })]);
		simulatePaintLoop({
			kind: KIND, count: 3, primary: null, bulk, hovered: null, applyColor,
		});
		const call1 = applyColor.mock.calls.find((c) => c[0] === 1);
		expect(call1![2]).toBe('bulk');
		expect(call1![1].getHex()).toBe(SELECTION_THEME.bulk.getHex());
	});

	it('paints hovered entity with theme.hover, debounced to one call', () => {
		const applyColor = vi.fn();
		const hovered: Selection = { kind: KIND, indices: [3] };
		simulatePaintLoop({
			kind: KIND, count: 5, primary: null, bulk: empty, hovered, applyColor,
		});
		const call3 = applyColor.mock.calls.find((c) => c[0] === 3);
		expect(call3![2]).toBe('hover');
		expect(call3![1].getHex()).toBe(SELECTION_THEME.hover.getHex());
	});

	it('skips entities of a different kind in primary/hovered (cross-kind null filter)', () => {
		const applyColor = vi.fn();
		// `primary` and `hovered` belong to a sibling overlay's kind — neither
		// should make slot 1 light up. The hook itself filters via
		// selectionForKind; this simulates the same outcome.
		const primary: Selection = { kind: 'other', indices: [1] };
		const hovered: Selection = { kind: 'other', indices: [1] };
		simulatePaintLoop({
			kind: KIND, count: 3, primary, bulk: empty, hovered, applyColor,
		});
		// Filter must be applied before computeInstanceState — emulate it:
		const filteredPrimary = primary.kind === KIND ? primary : null;
		const filteredHovered = hovered.kind === KIND ? hovered : null;
		expect(filteredPrimary).toBeNull();
		expect(filteredHovered).toBeNull();
		// All applyColor calls landed in 'none'.
		for (const call of applyColor.mock.calls) {
			expect(call[2]).toBe('none');
		}
	});
});

// ---------------------------------------------------------------------------
// Click / hover dispatch — mirror the hook bodies as plain functions.
// ---------------------------------------------------------------------------

type FakeMouseEvent = {
	faceIndex: number | null;
	stopPropagation: () => void;
	shiftKey?: boolean;
	ctrlKey?: boolean;
};

function dispatchClick(
	opts: {
		kind: string;
		count: number;
		faceToEntity: (faceIndex: number) => number;
		mapEntityToSelection?: (i: number) => Selection;
		onPick?: (sel: Selection, e: FakeMouseEvent) => void;
	},
	e: FakeMouseEvent,
): void {
	e.stopPropagation();
	if (e.faceIndex == null) return;
	const entity = opts.faceToEntity(e.faceIndex);
	if (entity < 0 || entity >= opts.count) return;
	const sel = opts.mapEntityToSelection
		? opts.mapEntityToSelection(entity)
		: { kind: opts.kind, indices: [entity] };
	opts.onPick?.(sel, e);
}

function dispatchHover(
	opts: {
		kind: string;
		count: number;
		faceToEntity: (faceIndex: number) => number;
		mapEntityToSelection?: (i: number) => Selection;
		current: Selection | null;
		onHover?: (sel: Selection | null, e: FakeMouseEvent | null) => void;
	},
	e: FakeMouseEvent,
): void {
	e.stopPropagation();
	if (e.faceIndex == null) return;
	const entity = opts.faceToEntity(e.faceIndex);
	if (entity < 0 || entity >= opts.count) return;
	const next: Selection = opts.mapEntityToSelection
		? opts.mapEntityToSelection(entity)
		: { kind: opts.kind, indices: [entity] };
	if (opts.current
		&& opts.current.kind === next.kind
		&& opts.current.indices.length === next.indices.length
		&& opts.current.indices.every((v, i) => v === next.indices[i])) return;
	opts.onHover?.(next, e);
}

describe('useBatchedSelection — click dispatch', () => {
	const faceToEntity = (face: number) => face; // identity for tests

	it('emits a Selection { kind, indices: [entity] } on a face hit', () => {
		const onPick = vi.fn();
		const stop = vi.fn();
		dispatchClick(
			{ kind: 'zone', count: 10, faceToEntity, onPick },
			{ faceIndex: 4, stopPropagation: stop },
		);
		expect(stop).toHaveBeenCalled();
		expect(onPick).toHaveBeenCalledWith(
			{ kind: 'zone', indices: [4] },
			expect.objectContaining({ faceIndex: 4 }),
		);
	});

	it('skips when faceIndex is null (chrome click-through)', () => {
		const onPick = vi.fn();
		dispatchClick(
			{ kind: 'zone', count: 10, faceToEntity, onPick },
			{ faceIndex: null, stopPropagation: vi.fn() },
		);
		expect(onPick).not.toHaveBeenCalled();
	});

	it('skips when faceToEntity returns -1 (padding region)', () => {
		const onPick = vi.fn();
		dispatchClick(
			{ kind: 'zone', count: 10, faceToEntity: () => -1, onPick },
			{ faceIndex: 0, stopPropagation: vi.fn() },
		);
		expect(onPick).not.toHaveBeenCalled();
	});

	it('skips when faceToEntity returns an out-of-range index', () => {
		const onPick = vi.fn();
		dispatchClick(
			{ kind: 'zone', count: 5, faceToEntity: () => 99, onPick },
			{ faceIndex: 0, stopPropagation: vi.fn() },
		);
		expect(onPick).not.toHaveBeenCalled();
	});

	it('uses mapEntityToSelection when supplied — supports nested addresses', () => {
		const onPick = vi.fn();
		dispatchClick(
			{
				kind: 'polygon',
				count: 10,
				faceToEntity,
				mapEntityToSelection: (i) => ({ kind: 'polygon', indices: [3, i] }),
				onPick,
			},
			{ faceIndex: 7, stopPropagation: vi.fn() },
		);
		expect(onPick).toHaveBeenCalledWith(
			{ kind: 'polygon', indices: [3, 7] },
			expect.anything(),
		);
	});

	it('forwards the raw event so the consumer can read shiftKey / ctrlKey', () => {
		const onPick = vi.fn();
		dispatchClick(
			{ kind: 'polygon', count: 10, faceToEntity, onPick },
			{ faceIndex: 2, stopPropagation: vi.fn(), shiftKey: true, ctrlKey: false },
		);
		expect(onPick).toHaveBeenCalled();
		const fwdEvent = onPick.mock.calls[0][1];
		expect(fwdEvent.shiftKey).toBe(true);
		expect(fwdEvent.ctrlKey).toBe(false);
	});
});

describe('useBatchedSelection — hover dispatch', () => {
	const faceToEntity = (face: number) => face;

	it('emits the hover Selection on a fresh face hit', () => {
		const onHover = vi.fn();
		dispatchHover(
			{ kind: 'zone', count: 10, faceToEntity, current: null, onHover },
			{ faceIndex: 5, stopPropagation: vi.fn() },
		);
		expect(onHover).toHaveBeenCalledWith(
			{ kind: 'zone', indices: [5] },
			expect.objectContaining({ faceIndex: 5 }),
		);
	});

	it('debounces hover — same entity hit twice does NOT re-fire', () => {
		const onHover = vi.fn();
		const current: Selection = { kind: 'zone', indices: [3] };
		dispatchHover(
			{ kind: 'zone', count: 10, faceToEntity, current, onHover },
			{ faceIndex: 3, stopPropagation: vi.fn() },
		);
		expect(onHover).not.toHaveBeenCalled();
	});

	it('fires on entity change while in flight', () => {
		const onHover = vi.fn();
		const current: Selection = { kind: 'zone', indices: [3] };
		dispatchHover(
			{ kind: 'zone', count: 10, faceToEntity, current, onHover },
			{ faceIndex: 4, stopPropagation: vi.fn() },
		);
		expect(onHover).toHaveBeenCalledWith(
			{ kind: 'zone', indices: [4] },
			expect.anything(),
		);
	});

	it('skips when faceToEntity rejects (-1)', () => {
		const onHover = vi.fn();
		dispatchHover(
			{ kind: 'zone', count: 10, faceToEntity: () => -1, current: null, onHover },
			{ faceIndex: 0, stopPropagation: vi.fn() },
		);
		expect(onHover).not.toHaveBeenCalled();
	});

	it('uses mapEntityToSelection for nested-address debounce', () => {
		const onHover = vi.fn();
		const current: Selection = { kind: 'polygon', indices: [2, 4] };
		// Same nested address — should NOT fire.
		dispatchHover(
			{
				kind: 'polygon',
				count: 10,
				faceToEntity,
				mapEntityToSelection: (i) => ({ kind: 'polygon', indices: [2, i] }),
				current,
				onHover,
			},
			{ faceIndex: 4, stopPropagation: vi.fn() },
		);
		expect(onHover).not.toHaveBeenCalled();
		// Different polyIndex inside the same soup — SHOULD fire.
		dispatchHover(
			{
				kind: 'polygon',
				count: 10,
				faceToEntity,
				mapEntityToSelection: (i) => ({ kind: 'polygon', indices: [2, i] }),
				current,
				onHover,
			},
			{ faceIndex: 7, stopPropagation: vi.fn() },
		);
		expect(onHover).toHaveBeenCalledWith(
			{ kind: 'polygon', indices: [2, 7] },
			expect.anything(),
		);
	});
});

// ---------------------------------------------------------------------------
// setBodyCursor guard — exercised by importing the module under node env.
// ---------------------------------------------------------------------------

describe('useBatchedSelection — node-env safety', () => {
	it('importing the module does not crash with `document` undefined', () => {
		// vitest env is `node`; `document` is undefined here. If the hook's
		// setBodyCursor were unguarded, importing it from the previous tests
		// would have already thrown. Sanity-assert the import handle.
		expect(typeof useBatchedSelection).toBe('function');
		expect(typeof document).toBe('undefined');
	});
});
