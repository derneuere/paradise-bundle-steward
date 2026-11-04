// Cross-resource / cross-**Bundle** **Bulk transform**.
//
// A heterogeneous Selection mixes model types, so the boundary needs an
// existential. We get one with a closure rather than `unknown` casts: each
// binding captures its own `M`, `R`, `S` and the model type never escapes,
// so no call site can pair an AI-sections ref list with the traffic resolver.

import { intersectAxesProfiles } from './axes';
import { medianPoint } from './math';
import { resolveSlots, transform } from './transform';
import type { Point, Resolver, TransformAxes, TransformDelta } from './types';

/** One resource slice of a heterogeneous **Selection**, type-erased at the
 *  boundary but never internally. */
export type TransformBinding = {
	readonly id: string;
	/** Every point this slice contributes to the SHARED pivot median. */
	pivotSamples(): readonly Point[];
	axes(): TransformAxes | null;
	/** Applies the delta; invokes `commit` only when the model reference
	 *  actually changed, so untouched **Bundles** are never dirtied. */
	apply(delta: TransformDelta): void;
};

export function bindTransform<M, R, S>(
	resolver: Resolver<M, R, S>,
	model: M,
	refs: readonly R[],
	commit: (next: M) => void,
): TransformBinding {
	return {
		id: resolver.id,
		pivotSamples: () => resolveSlots(model, refs, resolver).map((s) => s.point),
		axes: () => resolver.axes(refs),
		apply: (delta) => {
			const next = transform(model, refs, delta, resolver);
			if (next !== model) commit(next);
		},
	};
}

/**
 * The shared **Pivot** for a mixed Selection: the median over the
 * CONCATENATION of every slice's samples, not a median of per-slice medians.
 * Weighting therefore follows slot count — a section contributes one sample
 * per corner and per portal, a lane rung two, a prop one — which is the
 * behaviour the per-resource samplers had by accident and this has on purpose.
 */
export function bindingsPivot(bindings: readonly TransformBinding[]): Point | null {
	const all: Point[] = [];
	for (const b of bindings) all.push(...b.pivotSamples());
	return medianPoint(all);
}

export function bindingsAxes(bindings: readonly TransformBinding[]): TransformAxes | null {
	return intersectAxesProfiles(bindings.map((b) => b.axes()));
}
