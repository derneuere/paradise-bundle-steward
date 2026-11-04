// The trigger-data half of the shared **Bulk transform**.
//
// Six selectable kinds, but only two storage shapes:
//
//   * `BoxRegion` (landmark / generic / blackspot / VFX) — a `Vector3`
//     position AND a `Vector3` of Euler radians, so a trigger box is the one
//     resource in the editor that is genuinely 3D-rotation-capable in its own
//     right. Four parallel lists, one behaviour: they differ only in which
//     array they live in, so this file has ONE box path rather than the eight
//     near-identical wrappers the old op module carried.
//   * `Vector4` position (roaming / spawn) — a 3D point with no orientation
//     field; `.w` is trailing storage from the source format and must echo
//     back verbatim through translate AND rotate.
//
// `playerStart` is selectable (the gold cone) but deliberately NOT
// transformable: it expands to zero slots, which yields no pivot and hence no
// gizmo — the honest encoding of "no write semantics designed for it".
//
// NOT slots, and never to be turned into slots without fixture evidence:
// `BoxRegion.dimensions` (a half-extent, not a position — translating it would
// resize the volume), `SpawnLocation.direction` and `playerStartDirection`
// (facing data the transform deliberately leaves alone), and landmark
// `startingGrids` (world-space sub-entities, always empty in retail).

import * as THREE from 'three';

import type {
	BoxRegion,
	ParsedTriggerData,
	Vector3,
	Vector4,
} from '../../triggerData';
import { TRANSFORM_AXES_FULL_3D, type TransformAxes } from '../../transformAxes';
import { intersectAxesProfiles } from '../axes';
import type { Resolver, Rotation, SlotWrite } from '../types';

/**
 * Euler order for `BoxRegion.rotation`, pinned in one place.
 *
 * The on-disk record is three contiguous f32s (X / Y / Z) and the viewport
 * renders them with `dummy.rotation.set(rx, ry, rz)`, which is three.js's
 * default intrinsic 'XYZ'. Compose-then-decompose here MUST use the same order
 * or the in-memory model, the on-screen preview and the writeback disagree.
 */
export const TRIGGER_BOX_EULER_ORDER: THREE.EulerOrder = 'XYZ';

/** Translate freely, rotate nothing: a `Vector4` location has no orientation
 *  field, so the rings render disabled rather than enabled-and-silently-no-op. */
const TRANSFORM_AXES_TRANSLATE_ONLY: TransformAxes = {
	translate: { x: true, y: true, z: true },
	rotate: { x: false, y: false, z: false },
};

// =============================================================================
// Refs and slots
// =============================================================================

export type TriggerDataRef =
	| { kind: 'landmark'; idx: number }
	| { kind: 'generic'; idx: number }
	| { kind: 'blackspot'; idx: number }
	| { kind: 'vfx'; idx: number }
	| { kind: 'roaming'; idx: number }
	| { kind: 'spawn'; idx: number }
	| { kind: 'playerStart' };

/** Every ref that addresses storage addresses exactly ONE position, so slots
 *  are refs minus the non-transformable singleton. Excluding `playerStart` at
 *  the type level is what stops `write` from ever having to consider it. */
export type TriggerDataSlot = Exclude<TriggerDataRef, { kind: 'playerStart' }>;

export type TriggerDataResolverT = Resolver<
	ParsedTriggerData,
	TriggerDataRef,
	TriggerDataSlot
>;

type BoxKind = 'landmark' | 'generic' | 'blackspot' | 'vfx';
type VecKind = 'roaming' | 'spawn';

function boxList(model: ParsedTriggerData, kind: BoxKind): readonly { box: BoxRegion }[] {
	switch (kind) {
		case 'landmark': return model.landmarks;
		case 'generic': return model.genericRegions;
		case 'blackspot': return model.blackspots;
		case 'vfx': return model.vfxBoxRegions;
	}
}

function vecList(model: ParsedTriggerData, kind: VecKind): readonly { position: Vector4 }[] {
	return kind === 'roaming' ? model.roamingLocations : model.spawnLocations;
}

function isBoxKind(kind: TriggerDataSlot['kind']): kind is BoxKind {
	return kind !== 'roaming' && kind !== 'spawn';
}

// =============================================================================
// Orientation
// =============================================================================

/**
 * Compose the gesture's rotation into a box's own Euler as `delta * own`
 * (left-multiply). Reversing the operands compiles, passes every
 * yaw-from-identity test, and corrupts every already-rotated box — the
 * gesture is applied in WORLD space, after the box's own orientation.
 *
 * The round-trip through quaternions is representation-collapsing by design:
 * applying a yaw to an already-pitched box can yield a numerically different
 * `x/y/z` triple for the same orientation. The on-screen orientation stays
 * correct; the inspector's numbers may shift. Tests must compare orientations
 * via quaternion dot, never `toEqual` on the triple.
 */
function composeEuler(own: Vector3, spin: Rotation): Vector3 {
	const ownQ = new THREE.Quaternion().setFromEuler(
		new THREE.Euler(own.x, own.y, own.z, TRIGGER_BOX_EULER_ORDER),
	);
	const deltaQ = new THREE.Quaternion().setFromEuler(
		new THREE.Euler(spin.x, spin.y, spin.z, TRIGGER_BOX_EULER_ORDER),
	);
	const e = new THREE.Euler().setFromQuaternion(
		deltaQ.multiply(ownQ),
		TRIGGER_BOX_EULER_ORDER,
	);
	return { x: e.x, y: e.y, z: e.z };
}

// =============================================================================
// Batched write
// =============================================================================

type Bucket = Map<number, SlotWrite<TriggerDataSlot>>;
type Buckets = Record<TriggerDataSlot['kind'], Bucket>;

function bucketWrites(writes: readonly SlotWrite<TriggerDataSlot>[]): Buckets {
	const buckets: Buckets = {
		landmark: new Map(), generic: new Map(), blackspot: new Map(),
		vfx: new Map(), roaming: new Map(), spawn: new Map(),
	};
	for (const w of writes) buckets[w.slot.kind].set(w.slot.idx, w);
	return buckets;
}

/**
 * Position comes from `w.point` and nothing else — the orbit was already
 * applied by the shared math, so re-deriving it from `spin` here would rotate
 * twice. `dimensions` is passed through by reference: it is an extent, not a
 * position.
 */
function writeBox(box: BoxRegion, w: SlotWrite<TriggerDataSlot>): BoxRegion {
	const rotation = w.spin ? composeEuler(box.rotation, w.spin) : box.rotation;
	const p = box.position;
	if (rotation === box.rotation && p.x === w.point.x && p.y === w.point.y && p.z === w.point.z) {
		return box;
	}
	return {
		position: { x: w.point.x, y: w.point.y, z: w.point.z },
		rotation,
		dimensions: box.dimensions,
	};
}

/** Returns the INPUT array reference when nothing in it moved, so the model
 *  spread below can hand the whole list back unchanged (BND2 writeback). */
function writeBoxes<T extends { box: BoxRegion }>(list: T[], bucket: Bucket): T[] {
	if (bucket.size === 0) return list;
	let changed = false;
	const next = list.map((entry, i) => {
		const w = bucket.get(i);
		if (!w) return entry;
		const box = writeBox(entry.box, w);
		if (box === entry.box) return entry;
		changed = true;
		// Spread keeps every non-spatial field — `GenericRegion.id` above all,
		// which the writer needs to resolve its offset table, plus landmark
		// `startingGrids`, `designIndex`, blackspot scores and so on.
		return { ...entry, box };
	});
	return changed ? next : list;
}

/** `spin` is ignored: a `Vector4` location has no orientation field, and `.w`
 *  is echoed verbatim — it is storage padding, not a coordinate. */
function writeVecs<T extends { position: Vector4 }>(list: T[], bucket: Bucket): T[] {
	if (bucket.size === 0) return list;
	let changed = false;
	const next = list.map((entry, i) => {
		const w = bucket.get(i);
		if (!w) return entry;
		const p = entry.position;
		if (p.x === w.point.x && p.y === w.point.y && p.z === w.point.z) return entry;
		changed = true;
		return { ...entry, position: { x: w.point.x, y: w.point.y, z: w.point.z, w: p.w } };
	});
	return changed ? next : list;
}

// =============================================================================
// Resolver
// =============================================================================

export const triggerDataResolver: TriggerDataResolverT = {
	id: 'triggerData',

	/**
	 * Every transformable ref IS its own leaf datum, so expansion is the
	 * identity — except `playerStart`, which expands to nothing. Out-of-range
	 * indices are not filtered here; `resolve` returns null for them and
	 * `resolveSlots` drops them, keeping one silent-skip path rather than two.
	 * (The old ops threw `RangeError`; nothing in production range-guarded
	 * before calling them, so the overlay wrapped every call in try/catch.)
	 */
	expand(_model, ref) {
		return ref.kind === 'playerStart' ? [] : [ref];
	},

	key(slot) {
		return `${slot.kind}:${slot.idx}`;
	},

	resolve(model, slot) {
		if (isBoxKind(slot.kind)) {
			const entry = boxList(model, slot.kind)[slot.idx];
			if (!entry) return null;
			const p = entry.box.position;
			// Copied, not aliased: the caller holds this point for the whole
			// gesture and it must not be a live handle into the pre-gesture model.
			return { x: p.x, y: p.y, z: p.z };
		}
		const entry = vecList(model, slot.kind)[slot.idx];
		if (!entry) return null;
		const p = entry.position;
		return { x: p.x, y: p.y, z: p.z };
	},

	/**
	 * Batched, single-pass write over the six lists.
	 *
	 * Reference identity is the BND2 byte-for-byte writeback contract, not a
	 * perf tweak: untouched entries, untouched lists and the model itself all
	 * come back by reference so the overlay's `next !== data` gate never
	 * dirties a Bundle that did not actually move.
	 */
	write(model, writes) {
		if (writes.length === 0) return model;
		const b = bucketWrites(writes);

		const landmarks = writeBoxes(model.landmarks, b.landmark);
		const genericRegions = writeBoxes(model.genericRegions, b.generic);
		const blackspots = writeBoxes(model.blackspots, b.blackspot);
		const vfxBoxRegions = writeBoxes(model.vfxBoxRegions, b.vfx);
		const roamingLocations = writeVecs(model.roamingLocations, b.roaming);
		const spawnLocations = writeVecs(model.spawnLocations, b.spawn);

		if (
			landmarks === model.landmarks
			&& genericRegions === model.genericRegions
			&& blackspots === model.blackspots
			&& vfxBoxRegions === model.vfxBoxRegions
			&& roamingLocations === model.roamingLocations
			&& spawnLocations === model.spawnLocations
		) {
			return model;
		}
		return {
			...model,
			landmarks,
			genericRegions,
			blackspots,
			vfxBoxRegions,
			roamingLocations,
			spawnLocations,
		};
	},

	/**
	 * Boxes are full 3D; roaming/spawn veto all three rotate rings; a
	 * `playerStart` ref contributes no profile at all (skipped, not AND-ed as
	 * all-false) so picking the gold cone alongside a box does not disable the
	 * box's gizmo. A refs list of nothing but `playerStart` therefore yields
	 * null — no gizmo, matching its empty expansion.
	 *
	 * Deliberately NOT cardinality-dependent: with a drag-repositionable pivot
	 * a lone box genuinely orbits, so the old "one ref ⇒ no rotate rings" rule
	 * is gone.
	 */
	axes(refs) {
		return intersectAxesProfiles(
			refs.map((ref) => {
				if (ref.kind === 'playerStart') return null;
				return isBoxKind(ref.kind) ? TRANSFORM_AXES_FULL_3D : TRANSFORM_AXES_TRANSLATE_ONLY;
			}),
		);
	},
};
