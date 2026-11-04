// Axis-profile composition for the shared **Bulk transform** gizmo (ADR-0011).
// `../transformAxes` stays the single source of the descriptor type and the
// two canonical profiles; this file only adds the null-aware layer the merged
// module needs.

import { intersectTransformAxes, type TransformAxes } from '../transformAxes';
import type { Resolver } from './types';

export {
	TRANSFORM_AXES_FULL_3D,
	TRANSFORM_AXES_XZ_PACKED,
	intersectTransformAxes,
} from '../transformAxes';
export type { TransformAxes };

/** Single-resource convenience: null-safe pass-through. */
export function resolverAxes<M, R, S>(
	refs: readonly R[],
	resolver: Resolver<M, R, S>,
): TransformAxes | null {
	return resolver.axes(refs);
}

/**
 * AND-intersect the profiles of a heterogeneous **Selection** (ADR-0011).
 * Null profiles (a resource contributing zero refs) are SKIPPED, not treated
 * as FULL_3D — and if every contributor is null the result is null so the
 * caller renders no gizmo. This is deliberately different from
 * `intersectTransformAxes([])`, which returns FULL_3D.
 *
 * Yaw-locking falls out of this: one AI-section corner, one zone point, one
 * traffic yaw box or one lane rung anywhere in the Selection collapses
 * `rotate.x` and `rotate.z` to false for the whole gesture. `translate.y`
 * stays true even for XZ-packed families — the Y component is dropped by
 * those resolvers' `write`, not by the axis profile, because a whole-section
 * bulk legitimately moves portal-anchor heights on Y.
 */
export function intersectAxesProfiles(
	profiles: readonly (TransformAxes | null)[],
): TransformAxes | null {
	const live = profiles.filter((a): a is TransformAxes => a !== null);
	if (live.length === 0) return null;
	return intersectTransformAxes(live);
}
