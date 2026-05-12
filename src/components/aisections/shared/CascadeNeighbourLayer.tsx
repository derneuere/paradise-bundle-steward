// CascadeNeighbourLayer — orange outlines for sections that the in-flight
// drag's cascade-on path mutated besides the inspector pick (and not in
// the bulk).
//
// Returns null when no drag is active so the overlay can mount this
// unconditionally — the "drag != null" guard the V12 overlay had in JSX
// moves here.

import { SelectionOverlay, type Corner } from './SelectionOverlay';

export function CascadeNeighbourLayer({
	drag,
	affectedNeighbours,
	sectionYs,
}: {
	/** Truthy when a gesture is currently in flight; null otherwise. The
	 *  caller passes whatever drag-state lives at its level — only the
	 *  truthiness matters. */
	drag: unknown;
	affectedNeighbours: readonly { idx: number; corners: Corner[] }[];
	/** Per-section ground Y. Optional; V4/V6 paths pass nothing and the
	 *  outlines render at Y=0 (matches the legacy detail-layer baseY). */
	sectionYs?: ArrayLike<number>;
}) {
	if (!drag) return null;
	return (
		<>
			{affectedNeighbours.map(({ idx, corners }) => (
				<SelectionOverlay
					key={`cascade-${idx}`}
					corners={corners}
					color="#ddaa66"
					baseY={sectionYs && idx < sectionYs.length ? sectionYs[idx] : 0}
				/>
			))}
		</>
	);
}
