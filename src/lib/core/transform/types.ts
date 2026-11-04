// Public types for the shared **Bulk transform** core.
//
// This module — and every file in `src/lib/core/transform/` outside
// `resolvers/` — deliberately imports NO three.js. The transform math is
// plain arithmetic on `{x,y,z}` records so it can run in the CLI, in Node
// tests, and inside a resolver that never touches a scene graph. Resolvers
// may import three (prop/static-vehicle Matrix44, trigger-box Euler); the
// core may not.

import type { TransformAxes } from '../transformAxes';

export type { TransformAxes };

/** A world-space position in editor frame: x = east, y = up, z = north.
 *  No swapYZ is ever applied inside this module or any resolver — swapYZ is
 *  an inspector-form label only (VectorField.tsx). */
export type Point = { x: number; y: number; z: number };

/** A rotation delta as Euler radians, order 'XYZ', right-hand rule about each
 *  world axis. Matches THREE.Euler(x, y, z, 'XYZ'); see math.ts for the exact
 *  matrix a resolver must build if it composes this into an orientation. */
export type Rotation = { x: number; y: number; z: number };

/**
 * One gesture's accumulated delta, already stripped of the UI-only fields of
 * `BulkTransformDelta` (`cascade` is handled above transform(), by the
 * overlay, because it changes the REF LIST rather than the maths).
 *
 * `pivot` is the caller's GESTURE-START SNAPSHOT. Pass null only when there is
 * no gesture in flight (transform() then derives the median itself). Never
 * re-derive the pivot per frame from moving positions — that produces a spiral
 * instead of a rigid rotate.
 */
export type TransformDelta = {
	translate: Point;
	rotate: Rotation;
	pivot: Point | null;
};

/**
 * One slot's new state, produced by transform() and consumed by
 * `Resolver.write`.
 *
 * `point` is ABSOLUTE (contract W2): the slot's new world position, already
 * translated and orbited. A resolver whose slot has no Y storage discards
 * `point.y`; a resolver whose slot is XZ-packed writes `point.z` into the
 * model's `.y` field (Burnout packs world Z into the second component of
 * `Vector2` / `Vec2Padded`).
 *
 * `spin` is the gesture's rotation delta, identical for every slot in the
 * gesture, and non-null only when the gesture actually rotates. Resolvers
 * whose slot carries an orientation (trigger-box Euler, traffic yaw in `.w`,
 * Matrix44 basis) compose it in; every other resolver ignores it.
 * A resolver MUST NOT re-derive the position from `spin` — the orbit has
 * already been applied to `point`.
 */
export type SlotWrite<S> = {
	slot: S;
	point: Point;
	spin: Rotation | null;
};

/**
 * The per-resource half of the transform. `M` = parsed model, `R` = the
 * resource's selection-ref union, `S` = its slot union (often identical to R).
 *
 * The unit a resolver deals in is the SLOT — a single leaf spatial datum with
 * exactly one position — not the selection ref. A ref *expands* into slots, so
 * a whole-section or whole-zone ref rotates its body rather than just its
 * anchor, and its constituent points each carry their own pivot-sampling
 * weight for free.
 */
export interface Resolver<M, R, S = R> {
	/** Stable id for diagnostics and for keying cross-resource bindings. */
	readonly id: string;

	/**
	 * Expand a selection ref into the leaf spatial slots it addresses.
	 * Return `[]` for refs that are selectable but deliberately NOT
	 * transformable (AI-sections whole-boundary-line / whole-no-go-line
	 * markers, trigger-data `playerStart`, traffic `section` picks). An
	 * empty expansion yields no pivot and therefore no gizmo — that is the
	 * honest encoding of "no write semantics designed yet".
	 * Out-of-range refs expand to `[]`; never throw.
	 */
	expand(model: M, ref: R): readonly S[];

	/** Stable identity of a slot. Two slots addressing the same storage MUST
	 *  produce the same key — this is what makes a whole-section ref subsume
	 *  an individually-picked portal inside it. */
	key(slot: S): string;

	/** The slot's current world position, or null when the slot is out of
	 *  range (silent skip — no RangeError anywhere in the merged module).
	 *  Only ever called against the pre-gesture model (contract W1).
	 *  Synthetic Ys (AI-section corner Y from `resolveSectionYs`, zone-point
	 *  y = 0) are produced here. Visual gizmo lifts (+1.5, +0.5) are NOT —
	 *  they stay in the overlay's gizmo-geometry layer. */
	resolve(model: M, slot: S): Point | null;

	/**
	 * BATCHED, single-pass write of every slot the gesture touched.
	 * Batched, not per-slot, for two reasons: (a) per-slot folding is
	 * O(slots x entities) and a 500-section bulk rebuilds the sections array
	 * thousands of times per frame; (b) the existing per-resource bucketing
	 * (SectionRefBucket, bucketRefs, the traffic per-hull Sets) is exactly
	 * this shape and transplants unchanged.
	 *
	 * Reference-identity contract (BND2 byte-for-byte writeback, NOT a perf
	 * tweak): return the INPUT model reference when nothing actually changed;
	 * return untouched sub-objects (sections, hulls, roads, instances,
	 * points, `trafficLights`) by reference. The cross-Bundle dirty check,
	 * every overlay's `if (next !== data)` gate, and the AI-sections orange
	 * cascade highlight all depend on it.
	 */
	write(model: M, writes: readonly SlotWrite<S>[]): M;

	/** This resource's axis profile for the given refs. Null for an empty
	 *  refs list (caller renders no gizmo). Pure function of the ref kinds —
	 *  deliberately NOT cardinality-dependent: with a drag-repositionable
	 *  pivot a lone point genuinely orbits, so "one ref ⇒ no rotate rings"
	 *  is no longer true. */
	axes(refs: readonly R[]): TransformAxes | null;
}
