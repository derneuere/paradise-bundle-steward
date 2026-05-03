// useBatchedSelection — sibling of useInstancedSelection for overlays whose
// scene is one merged BufferGeometry (per-vertex colors / per-face index map)
// rather than a THREE.InstancedMesh.
//
// The state machine is identical (primary > hover > bulk > none) and the
// click/hover decoding mirrors useInstancedSelection's. The two hooks differ
// only in *how* paint is applied: InstancedMesh has a built-in
// `setColorAt(i, color)`, whereas a batched-geometry consumer needs to write
// per-vertex colors itself, so we hand the consumer an `applyColor(i, color,
// state)` callback and let it stamp whatever range of vertices belongs to
// entity `i`.
//
// We also accept a `faceToEntity` decoder because the hit triangle from R3F's
// pointer event (`e.faceIndex`) needs translation back to the entity index
// the merged mesh combines (zone index, polygon-within-soup index, etc.).
//
// `computeInstanceState` and the kind-filter helper come from
// useInstancedSelection — there's exactly one source of truth for the
// precedence rule, and re-implementing it here would invite drift.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { ThreeEvent } from '@react-three/fiber';
import type { Selection } from './selection';
import { selectionEquals } from './selection';
import { SELECTION_THEME, type SelectionTheme } from './theme';
import {
	computeInstanceState,
	type InstancedSelectionState,
} from './useInstancedSelection';

export type UseBatchedSelectionOpts = {
	/** Selection kind this batched mesh represents (e.g. `'zone'`, `'polygon'`). */
	kind: string;
	/** Total entity count (zones, polys — not vertex/face count). */
	count: number;
	/** Current single-selection. */
	primary: Selection | null;
	/** Multi-select set; entries encoded with `selectionKey()`. */
	bulk: ReadonlySet<string>;
	/** Pointer hover. */
	hovered: Selection | null;
	/**
	 * Decode a hit triangle index into an entity index. The hook calls this
	 * inside the click and pointermove handlers it returns. Return `-1` (or
	 * any out-of-range index) if the triangle doesn't belong to a selectable
	 * entity (e.g. an empty padding region).
	 */
	faceToEntity: (faceIndex: number) => number;
	/**
	 * Apply paint for entity `i` in state `state`. Implementations write into
	 * the mesh's BufferGeometry color attribute (or whatever per-entity
	 * representation the overlay uses). Called once per entity each time the
	 * selection inputs change.
	 *
	 * The hook supplies `theme.primary` / `.hover` / `.bulk` for the
	 * non-`'none'` states; for `'none'` it passes `baseColorFor(i)` (or grey
	 * if not given). When `paintFor` is set its return value wins instead.
	 *
	 * The callback is responsible for marking the underlying attribute dirty
	 * (`attr.needsUpdate = true`) — the hook doesn't own the geometry handle.
	 */
	applyColor: (i: number, color: THREE.Color, state: InstancedSelectionState) => void;
	/** Override per-entity paint resolution. */
	paintFor?: (i: number, state: InstancedSelectionState) => THREE.Color;
	/** Per-entity base color for the `'none'` state — falls back to grey. */
	baseColorFor?: (i: number) => THREE.Color;
	/** Theme override. */
	theme?: SelectionTheme;
	/**
	 * Derive the `Selection` to emit for entity `i`. Defaults to
	 * `{ kind, indices: [i] }`. Overlays whose entities have a 2-deep address
	 * (e.g. soup-poly = `[soupIndex, polyIndex]`) supply this to prepend
	 * the parent index — the entity index alone isn't enough.
	 */
	mapEntityToSelection?: (i: number) => Selection;
	/**
	 * Click → Selection. The raw R3F event is forwarded so the overlay can
	 * branch on `e.shiftKey` / `e.ctrlKey` (modifier-aware bulk toggling).
	 */
	onPick?: (sel: Selection, e: ThreeEvent<MouseEvent>) => void;
	/**
	 * Hover → Selection (or null on out). The raw R3F event is forwarded for
	 * symmetry with onPick; pass `null` on pointer-out (no event).
	 */
	onHover?: (sel: Selection | null, e: ThreeEvent<PointerEvent> | null) => void;
};

export type UseBatchedSelectionResult = {
	onClick: (e: ThreeEvent<MouseEvent>) => void;
	onPointerMove: (e: ThreeEvent<PointerEvent>) => void;
	onPointerOut: () => void;
	/** Sentinel that goes up when the paint loop has run; useful for tests. */
	paintCount: number;
};

const DEFAULT_BASE = new THREE.Color(0x888888);

// Guarded so the hook can run in node-environment unit tests where `document`
// is not defined. Real browser usage hits the assignment path verbatim.
function setBodyCursor(value: string): void {
	if (typeof document !== 'undefined' && document.body) {
		document.body.style.cursor = value;
	}
}

function selectionForKind(sel: Selection | null, kind: string): Selection | null {
	if (!sel || sel.kind !== kind) return null;
	return sel;
}

export function useBatchedSelection(
	opts: UseBatchedSelectionOpts,
): UseBatchedSelectionResult {
	const {
		kind, count, primary, bulk, hovered,
		faceToEntity, applyColor, paintFor, baseColorFor,
		theme = SELECTION_THEME,
		mapEntityToSelection,
		onPick, onHover,
	} = opts;

	// Filter cross-kind selections to null so this hook's paint effect doesn't
	// re-run when a sibling overlay changes selection.
	const localPrimary = useMemo(() => selectionForKind(primary, kind), [primary, kind]);
	const localHovered = useMemo(() => selectionForKind(hovered, kind), [hovered, kind]);

	const [paintCount, setPaintCount] = useState(0);
	const paintCountRef = useRef(0);

	useEffect(() => {
		for (let i = 0; i < count; i++) {
			const state = computeInstanceState(i, localPrimary, bulk, localHovered, kind);
			let color: THREE.Color;
			if (paintFor) {
				color = paintFor(i, state);
			} else if (state === 'primary') {
				color = theme.primary;
			} else if (state === 'hover') {
				color = theme.hover;
			} else if (state === 'bulk') {
				color = theme.bulk;
			} else {
				color = baseColorFor ? baseColorFor(i) : DEFAULT_BASE;
			}
			applyColor(i, color, state);
		}
		paintCountRef.current += 1;
		setPaintCount(paintCountRef.current);
	}, [count, localPrimary, bulk, localHovered, kind, applyColor, paintFor, baseColorFor, theme]);

	const onClick = useCallback(
		(e: ThreeEvent<MouseEvent>) => {
			e.stopPropagation();
			if (e.faceIndex == null) return;
			const entity = faceToEntity(e.faceIndex);
			if (entity < 0 || entity >= count) return;
			const sel = mapEntityToSelection
				? mapEntityToSelection(entity)
				: { kind, indices: [entity] };
			onPick?.(sel, e);
		},
		[onPick, kind, count, faceToEntity, mapEntityToSelection],
	);

	const onPointerMove = useCallback(
		(e: ThreeEvent<PointerEvent>) => {
			e.stopPropagation();
			if (e.faceIndex == null) return;
			const entity = faceToEntity(e.faceIndex);
			if (entity < 0 || entity >= count) return;
			const next: Selection = mapEntityToSelection
				? mapEntityToSelection(entity)
				: { kind, indices: [entity] };
			// Skip notifying the parent if the cursor hasn't moved off the previous
			// entity — pointermove fires every frame the cursor sits on a hot mesh.
			if (selectionEquals(localHovered, next)) return;
			onHover?.(next, e);
			setBodyCursor('pointer');
		},
		[onHover, kind, count, faceToEntity, mapEntityToSelection, localHovered],
	);

	const onPointerOut = useCallback(() => {
		onHover?.(null, null);
		setBodyCursor('auto');
	}, [onHover]);

	return { onClick, onPointerMove, onPointerOut, paintCount };
}
