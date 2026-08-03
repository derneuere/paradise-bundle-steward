// The shared **Bulk transform** entry points. One compose order, one pivot
// rule, one rotation convention, for all six spatial resources.

import { addPoint, isZeroRotation, isZeroTranslate, medianPoint, rotatePointAboutPivot } from './math';
import type { Point, Resolver, SlotWrite, TransformDelta } from './types';

/** A slot paired with its pre-gesture world position. */
export type ResolvedSlot<S> = { slot: S; point: Point };

/**
 * Expand every ref into slots, dedupe by `resolver.key`, and resolve each
 * surviving slot against the (pre-gesture) model. Slots that resolve to null
 * are dropped silently — out-of-range refs are a normal consequence of a stale
 * **Selection**, not an error. First occurrence wins; order is stable.
 *
 * Dedupe here is what makes a whole-section ref SUBSUME an individually-picked
 * portal inside it, and what makes a duplicated ref (marquee ∪ inspector) move
 * its slot once. With `spin` in play a double-write is not merely a
 * double-translate — it double-composes the rotation into the orientation.
 *
 * Exported because the overlays need the same slot set for the live pivot and
 * for marquee/outline geometry.
 */
export function resolveSlots<M, R, S>(
	model: M,
	refs: readonly R[],
	resolver: Resolver<M, R, S>,
): ResolvedSlot<S>[] {
	const seen = new Set<string>();
	const out: ResolvedSlot<S>[] = [];
	for (const ref of refs) {
		for (const slot of resolver.expand(model, ref)) {
			const k = resolver.key(slot);
			if (seen.has(k)) continue;
			seen.add(k);
			const point = resolver.resolve(model, slot);
			if (!point) continue;
			out.push({ slot, point });
		}
	}
	return out;
}

/**
 * Per-component median of every point the **Selection** addresses — the
 * gizmo's default **Pivot**. Null when the Selection is empty or resolves to
 * nothing, which is also the signal to render no gizmo at all.
 *
 * Runs over the SAME deduped slot list the transform does, so a Selection
 * containing a duplicate ref (or a whole-section ref plus one of its own
 * portals) no longer skews the pivot toward the doubled entity.
 */
export function selectionPivot<M, R, S>(
	model: M,
	refs: readonly R[],
	resolver: Resolver<M, R, S>,
): Point | null {
	return medianPoint(resolveSlots(model, refs, resolver).map((s) => s.point));
}

/**
 * Apply one gesture to one model.
 *
 * Compose order, load-bearing and identical for every resource:
 *   1. translate every slot by `delta.translate`
 *   2. rotate every translated slot about `pivot + delta.translate`
 * i.e. translate first, then rotate about the TRANSLATE-ADJUSTED pivot —
 * algebraically `T(P+d) · R · T(-(P+d)) · T(d)`. Rotating about the un-moved
 * pivot, or rotating before translating, changes the result for any gesture
 * that mixes both. Preview and commit call this same function, so they cannot
 * drift.
 *
 * Every slot is resolved against the model BEFORE any write (contract W1) and
 * every write is absolute rather than incremental (contract W2). Together
 * those kill the "two endpoints packed in one Vector4, second write
 * double-rotates the first" hazard: both endpoints were read from the original
 * and each write touches only its own two floats.
 *
 * Returns the input model reference on an identity delta, an empty refs list,
 * a fully unresolvable refs list, or when the resolver reports no change.
 */
export function transform<M, R, S>(
	model: M,
	refs: readonly R[],
	delta: TransformDelta,
	resolver: Resolver<M, R, S>,
): M {
	const moving = !isZeroTranslate(delta.translate);
	const spinning = !isZeroRotation(delta.rotate);
	if (!moving && !spinning) return model;
	if (refs.length === 0) return model;

	const slots = resolveSlots(model, refs, resolver);
	if (slots.length === 0) return model;

	// `delta.pivot` is the caller's gesture-start snapshot and is used VERBATIM.
	// Re-deriving it mid-gesture from already-moved positions is the spiral bug.
	const basePivot = delta.pivot ?? medianPoint(slots.map((s) => s.point));
	if (spinning && !basePivot) return model;

	const movedPivot: Point | null = basePivot && {
		x: basePivot.x + delta.translate.x,
		y: basePivot.y + delta.translate.y,
		z: basePivot.z + delta.translate.z,
	};

	const writes: SlotWrite<S>[] = slots.map(({ slot, point }) => {
		const translated = moving ? addPoint(point, delta.translate) : point;
		const rotated = spinning && movedPivot
			? rotatePointAboutPivot(translated, movedPivot, delta.rotate)
			: translated;
		return { slot, point: rotated, spin: spinning ? delta.rotate : null };
	});

	return resolver.write(model, writes);
}
