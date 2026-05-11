// Bulk-transform multi-Selection ops for trigger boxes (issue #77).
//
// Cardinality ≥ 1 entry points for the unified Bulk-transform gizmo over
// trigger-data entities. Mirrors the shape of `aiSectionsOps/bulk.ts`:
//
//   - A discriminated `TriggerBoxEntityRef` union addresses individual
//     entities in a `ParsedTriggerData` model. Boxes (Landmark / Generic /
//     Blackspot / VFX) carry full pose; roaming and spawn locations carry
//     position only.
//   - `bulkTriggerBoxPivot` computes the Selection's median position,
//     same shape as `bulkSelectionPivot` for AI sections.
//   - `bulkTranslateTriggerBoxes` applies a 3D translate to every ref.
//   - `bulkRotateTriggerBoxes` applies a delta Euler rotation around a
//     shared pivot to every ref, composing the orientation into each box's
//     own Euler (rigid-body composition — Q9 of the design discussion).
//
// Rigid-body invariant (load-bearing): the Selection rotates as one rigid
// body, so pairwise distances between box positions are preserved exactly
// (modulo float epsilon). The compose-then-decompose for orientation is
// Euler-representation-collapsing (Euler angles are not unique) but the
// underlying quaternion math IS rigid — only the inspector's numeric
// readout may shift while the on-screen orientation stays correct.
//
// Byte-for-byte writeback: identity gestures (zero translate + zero
// rotate) return the input `model` reference, so a no-op gesture preserves
// the on-disk bytes exactly.
//
// No cascade: trigger boxes have no neighbour topology — there's no
// portal-shared-corner cascade analogous to AI sections. The cascade
// modifier flag (`delta.cascade` from `BulkTransformDelta`) is ignored.

import type {
	ParsedTriggerData,
	Vector3,
} from '../triggerData';
import {
	rotateBoxRigid,
	rotateVec4AroundPivot,
	translateBoxRigid,
	translateVec4,
} from './translateRigid';

// =============================================================================
// Entity references
// =============================================================================

/**
 * Discriminated reference to a single spatial entity inside a
 * `ParsedTriggerData` model. The bulk ops take an array of these and apply
 * one gesture (translate or rotate) to all of them as a rigid body.
 *
 * BoxRegion-carrying kinds (`landmark` / `generic` / `blackspot` / `vfx`)
 * compose the gesture rotation into their own Euler. Vec4-position kinds
 * (`roaming` / `spawn`) orbit position only — they have no orientation
 * field. The `playerStart` singleton is intentionally absent (single-
 * entity, no bulk semantics — and there's exactly one per resource).
 *
 * The schema-path encoding the overlay's marquee produces (`['landmarks',
 * i]`, `['genericRegions', i]`, etc.) maps 1:1 to these refs; the overlay
 * carries the mapping.
 */
export type TriggerBoxEntityRef =
	| { kind: 'landmark'; idx: number }
	| { kind: 'generic'; idx: number }
	| { kind: 'blackspot'; idx: number }
	| { kind: 'vfx'; idx: number }
	| { kind: 'roaming'; idx: number }
	| { kind: 'spawn'; idx: number };

// =============================================================================
// Pivot
// =============================================================================

/**
 * Median (per-component) position across every entity addressed by `refs`.
 * The median (not centroid) so a tight cluster + a few outliers anchors
 * near the cluster — matches the spec's "median of all selected positions"
 * (CONTEXT.md / "Pivot"). Returns `null` when refs is empty or every ref
 * points at an out-of-range entity.
 *
 * Box entities contribute their `box.position`; roaming/spawn contribute
 * `position` (the Vector4's xyz; .w is just storage padding).
 */
export function bulkTriggerBoxPivot(
	model: ParsedTriggerData,
	refs: readonly TriggerBoxEntityRef[],
): Vector3 | null {
	const xs: number[] = [];
	const ys: number[] = [];
	const zs: number[] = [];
	const push = (p: { x: number; y: number; z: number }) => {
		xs.push(p.x); ys.push(p.y); zs.push(p.z);
	};
	for (const ref of refs) {
		switch (ref.kind) {
			case 'landmark': {
				const e = model.landmarks[ref.idx];
				if (e) push(e.box.position);
				break;
			}
			case 'generic': {
				const e = model.genericRegions[ref.idx];
				if (e) push(e.box.position);
				break;
			}
			case 'blackspot': {
				const e = model.blackspots[ref.idx];
				if (e) push(e.box.position);
				break;
			}
			case 'vfx': {
				const e = model.vfxBoxRegions[ref.idx];
				if (e) push(e.box.position);
				break;
			}
			case 'roaming': {
				const e = model.roamingLocations[ref.idx];
				if (e) push(e.position);
				break;
			}
			case 'spawn': {
				const e = model.spawnLocations[ref.idx];
				if (e) push(e.position);
				break;
			}
		}
	}
	if (xs.length === 0) return null;
	return { x: median(xs), y: median(ys), z: median(zs) };
}

function median(values: number[]): number {
	const sorted = values.slice().sort((a, b) => a - b);
	const n = sorted.length;
	if (n === 0) return 0;
	const mid = n >> 1;
	return n % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// =============================================================================
// Bulk translate
// =============================================================================

/**
 * Translate every entity in `refs` by the same `(dx, dy, dz)` offset.
 * Rigid-body translate — every spatial coordinate shifts in lockstep so
 * relative positions are preserved exactly. Returns the input `model`
 * reference on an identity offset OR empty refs list.
 *
 * Duplicate refs (same kind + idx) are coalesced via a bucket Set per
 * list so the same entity can't be moved twice in one gesture.
 */
export function bulkTranslateTriggerBoxes(
	model: ParsedTriggerData,
	refs: readonly TriggerBoxEntityRef[],
	offset: { x: number; y: number; z: number },
): ParsedTriggerData {
	if (offset.x === 0 && offset.y === 0 && offset.z === 0) return model;
	if (refs.length === 0) return model;

	const buckets = bucketRefs(refs);
	let touched = false;

	const landmarks = mapBoxList(
		model.landmarks,
		buckets.landmark,
		(e) => ({ ...e, box: translateBoxRigid(e.box, offset) }),
		() => (touched = true),
	);
	const genericRegions = mapBoxList(
		model.genericRegions,
		buckets.generic,
		(e) => ({ ...e, box: translateBoxRigid(e.box, offset) }),
		() => (touched = true),
	);
	const blackspots = mapBoxList(
		model.blackspots,
		buckets.blackspot,
		(e) => ({ ...e, box: translateBoxRigid(e.box, offset) }),
		() => (touched = true),
	);
	const vfxBoxRegions = mapBoxList(
		model.vfxBoxRegions,
		buckets.vfx,
		(e) => ({ ...e, box: translateBoxRigid(e.box, offset) }),
		() => (touched = true),
	);
	const roamingLocations = mapBoxList(
		model.roamingLocations,
		buckets.roaming,
		(e) => ({ ...e, position: translateVec4(e.position, offset) }),
		() => (touched = true),
	);
	const spawnLocations = mapBoxList(
		model.spawnLocations,
		buckets.spawn,
		(e) => ({ ...e, position: translateVec4(e.position, offset) }),
		() => (touched = true),
	);

	if (!touched) return model;
	return {
		...model,
		landmarks,
		genericRegions,
		blackspots,
		vfxBoxRegions,
		roamingLocations,
		spawnLocations,
	};
}

// =============================================================================
// Bulk rotate
// =============================================================================

/**
 * Rotate every entity in `refs` around `pivot` by the delta Euler
 * `(rx, ry, rz)` in radians, composing the gesture rotation into each
 * box's own Euler (rigid-body composition — Q9 of the design discussion).
 *
 * For box-carrying entities (landmark / generic / blackspot / vfx):
 *   - position orbits the pivot via quaternion rotation (rigid-body —
 *     pairwise distances preserved).
 *   - own Euler rotation is left-multiplied with the delta quaternion,
 *     then decomposed back to Euler in the pinned `TRIGGER_BOX_EULER_ORDER`.
 *
 * For position-only entities (roaming / spawn):
 *   - position orbits the pivot; no rotation field to compose into.
 *
 * Returns the input `model` reference on an identity delta OR empty refs
 * list so byte-for-byte BND2 writeback is preserved.
 *
 * Euler-representation collapse: the compose-then-decompose may produce
 * a numerically different `rotation.x/y/z` triple representing the same
 * orientation. Documented in CONTEXT.md / "Bulk transform" + ADR-0011.
 */
export function bulkRotateTriggerBoxes(
	model: ParsedTriggerData,
	refs: readonly TriggerBoxEntityRef[],
	pivot: { x: number; y: number; z: number },
	deltaEuler: { x: number; y: number; z: number },
): ParsedTriggerData {
	if (deltaEuler.x === 0 && deltaEuler.y === 0 && deltaEuler.z === 0) return model;
	if (refs.length === 0) return model;

	const buckets = bucketRefs(refs);
	let touched = false;

	const landmarks = mapBoxList(
		model.landmarks,
		buckets.landmark,
		(e) => ({ ...e, box: rotateBoxRigid(e.box, pivot, deltaEuler) }),
		() => (touched = true),
	);
	const genericRegions = mapBoxList(
		model.genericRegions,
		buckets.generic,
		(e) => ({ ...e, box: rotateBoxRigid(e.box, pivot, deltaEuler) }),
		() => (touched = true),
	);
	const blackspots = mapBoxList(
		model.blackspots,
		buckets.blackspot,
		(e) => ({ ...e, box: rotateBoxRigid(e.box, pivot, deltaEuler) }),
		() => (touched = true),
	);
	const vfxBoxRegions = mapBoxList(
		model.vfxBoxRegions,
		buckets.vfx,
		(e) => ({ ...e, box: rotateBoxRigid(e.box, pivot, deltaEuler) }),
		() => (touched = true),
	);
	const roamingLocations = mapBoxList(
		model.roamingLocations,
		buckets.roaming,
		(e) => ({ ...e, position: rotateVec4AroundPivot(e.position, pivot, deltaEuler) }),
		() => (touched = true),
	);
	const spawnLocations = mapBoxList(
		model.spawnLocations,
		buckets.spawn,
		(e) => ({ ...e, position: rotateVec4AroundPivot(e.position, pivot, deltaEuler) }),
		() => (touched = true),
	);

	if (!touched) return model;
	return {
		...model,
		landmarks,
		genericRegions,
		blackspots,
		vfxBoxRegions,
		roamingLocations,
		spawnLocations,
	};
}

// =============================================================================
// Internal — bucketing + per-list map
// =============================================================================

type Buckets = {
	landmark: Set<number>;
	generic: Set<number>;
	blackspot: Set<number>;
	vfx: Set<number>;
	roaming: Set<number>;
	spawn: Set<number>;
};

function bucketRefs(refs: readonly TriggerBoxEntityRef[]): Buckets {
	const buckets: Buckets = {
		landmark: new Set(),
		generic: new Set(),
		blackspot: new Set(),
		vfx: new Set(),
		roaming: new Set(),
		spawn: new Set(),
	};
	for (const ref of refs) {
		buckets[ref.kind].add(ref.idx);
	}
	return buckets;
}

/**
 * Map a list, applying `transform` only to indices in `selected`. Calls
 * `onChange` exactly once iff any element was transformed. If no element
 * is in the selection bucket, returns the original list reference so the
 * `{...model, ...}` spread above ends up structurally identical to
 * `model` and `triggerData.write` produces byte-identical output.
 */
function mapBoxList<T>(
	list: readonly T[],
	selected: ReadonlySet<number>,
	transform: (entry: T) => T,
	onChange: () => void,
): T[] {
	if (selected.size === 0) return list as T[];
	let anyChanged = false;
	const next = list.map((entry, i) => {
		if (!selected.has(i)) return entry;
		const t = transform(entry);
		if (t !== entry) anyChanged = true;
		return t;
	});
	if (anyChanged) onChange();
	return next;
}
