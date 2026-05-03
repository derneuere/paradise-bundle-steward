// useInstancedSelection — unified paint + click/hover hook for
// InstancedMesh-driven WorldViewport overlays.
//
// Pre-extraction every overlay rolled its own copy of "walk 0..count, set
// matrix, decide selected/hovered/base color, attach click + pointerMove +
// pointerOut" — typically 60+ lines duplicated three or four times per file.
// This hook collapses that to one call: the consumer hands in `count`, a
// per-instance `setMatrix`, the current `primary` / `bulk` / `hovered`
// selections, and a base-color resolver. The hook walks the instances each
// time those inputs change, paints the right state colour, and returns the
// three event handlers ready to spread onto `<instancedMesh>`.
//
// The hook *only* writes to instance buffers when the selection inputs the
// `kind` actually cares about change. The `kind` filter on selections ensures
// e.g. paint loops for the streets mesh don't re-run when the user selects a
// junction — the inputs that flow in via `selectionMatchesKind` short-circuit
// to null when they belong to a different kind.

import { useCallback, useMemo } from 'react';
import * as THREE from 'three';
import type { ThreeEvent } from '@react-three/fiber';
import { useUpdateInstancedMesh } from '@/hooks/useUpdateInstancedMesh';
import type { Selection } from './selection';
import { selectionEquals, selectionKey } from './selection';
import { SELECTION_THEME, type SelectionTheme } from './theme';

export type InstancedSelectionState = 'primary' | 'bulk' | 'hover' | 'none';

/**
 * Pure state computation — exported so unit tests can exercise it without a
 * three.js mesh in scope. Given an instance index and the three current
 * selection inputs (already filtered to this hook's `kind`), returns which
 * paint state the instance should render in.
 *
 * Precedence: primary > hover > bulk > none. Hover beats bulk because a
 * hover indicator under the cursor is feedback the user just produced and
 * should always be visible, even on a multi-selected entity.
 */
export function computeInstanceState(
	index: number,
	primary: Selection | null,
	bulk: ReadonlySet<string>,
	hovered: Selection | null,
	kind: string,
): InstancedSelectionState {
	const single: Selection = { kind, indices: [index] };
	if (primary && primary.kind === kind && primary.indices.length === 1 && primary.indices[0] === index) {
		return 'primary';
	}
	if (hovered && hovered.kind === kind && hovered.indices.length === 1 && hovered.indices[0] === index) {
		return 'hover';
	}
	if (bulk.has(selectionKey(single))) {
		return 'bulk';
	}
	return 'none';
}

/**
 * Filter helper — returns the selection only if it belongs to this kind. Used
 * to short-circuit re-paints when a selection elsewhere changes.
 */
function selectionForKind(sel: Selection | null, kind: string): Selection | null {
	if (!sel || sel.kind !== kind) return null;
	return sel;
}

export type UseInstancedSelectionOpts = {
	/** Selection kind this mesh represents (e.g. `'road'`). */
	kind: string;
	/** Number of instances. */
	count: number;
	/** Current single-selection (primary) — already a Selection from the codec. */
	primary: Selection | null;
	/** Multi-selection set; entries encoded with `selectionKey`. */
	bulk: ReadonlySet<string>;
	/** Pointer hover. */
	hovered: Selection | null;
	/** Per-instance matrix writer; receives a shared dummy Object3D the hook flushes. */
	setMatrix: (i: number, dummy: THREE.Object3D) => void;
	/**
	 * Override per-instance paint. Called for every instance with its computed
	 * state; return the THREE.Color to write. When omitted the hook falls back
	 * to `theme.primary`/`theme.bulk`/`theme.hover` for non-`'none'` states and
	 * `baseColorFor(i)` (or grey) for `'none'`.
	 */
	paintFor?: (i: number, state: InstancedSelectionState) => THREE.Color;
	/** Convenience used when paintFor is omitted — base color for 'none' state. */
	baseColorFor?: (i: number) => THREE.Color;
	/** Theme override; defaults to SELECTION_THEME. */
	theme?: SelectionTheme;
	/** Click → Selection. */
	onPick?: (sel: Selection) => void;
	/** Hover → Selection (or null on out). */
	onHover?: (sel: Selection | null) => void;
};

export type UseInstancedSelectionResult = {
	onClick: (e: ThreeEvent<MouseEvent>) => void;
	onPointerMove: (e: ThreeEvent<PointerEvent>) => void;
	onPointerOut: () => void;
};

const DEFAULT_BASE = new THREE.Color(0x888888);

// Guarded so the hook can run in node-environment unit tests where `document`
// is not defined. Real browser usage hits the assignment path verbatim.
function setBodyCursor(value: string): void {
	if (typeof document !== 'undefined' && document.body) {
		document.body.style.cursor = value;
	}
}

export function useInstancedSelection(
	meshRef: React.RefObject<THREE.InstancedMesh>,
	opts: UseInstancedSelectionOpts,
): UseInstancedSelectionResult {
	const {
		kind, count, primary, bulk, hovered,
		setMatrix, paintFor, baseColorFor,
		theme = SELECTION_THEME,
		onPick, onHover,
	} = opts;

	// Filter the three selection inputs to this kind. The paint effect only
	// re-runs when *this* kind's inputs change; cross-kind selections (a
	// different mesh's primary) become `null` here and don't re-trigger.
	const localPrimary = useMemo(() => selectionForKind(primary, kind), [primary, kind]);
	const localHovered = useMemo(() => selectionForKind(hovered, kind), [hovered, kind]);

	useUpdateInstancedMesh(
		meshRef,
		count,
		(mesh) => {
			const dummy = new THREE.Object3D();
			for (let i = 0; i < count; i++) {
				setMatrix(i, dummy);
				dummy.updateMatrix();
				mesh.setMatrixAt(i, dummy.matrix);

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
				mesh.setColorAt(i, color);
			}
		},
		// Selection inputs are already filtered to this kind; cross-kind changes
		// reduce to identity (null === null) so this effect doesn't re-run.
		[count, localPrimary, bulk, localHovered, kind, setMatrix, paintFor, baseColorFor, theme],
	);

	const onClick = useCallback(
		(e: ThreeEvent<MouseEvent>) => {
			e.stopPropagation();
			if (e.instanceId == null) return;
			onPick?.({ kind, indices: [e.instanceId] });
		},
		[onPick, kind],
	);

	const onPointerMove = useCallback(
		(e: ThreeEvent<PointerEvent>) => {
			e.stopPropagation();
			if (e.instanceId == null) return;
			const next: Selection = { kind, indices: [e.instanceId] };
			// Skip notifying the parent if the hover hasn't actually moved off the
			// previous instance — fires every frame the cursor sits on a hot mesh.
			if (selectionEquals(localHovered, next)) return;
			onHover?.(next);
			setBodyCursor('pointer');
		},
		[onHover, kind, localHovered],
	);

	const onPointerOut = useCallback(() => {
		onHover?.(null);
		setBodyCursor('auto');
	}, [onHover]);

	return { onClick, onPointerMove, onPointerOut };
}
