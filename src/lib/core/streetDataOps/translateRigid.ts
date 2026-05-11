// Street-data single-entity rigid translate.
//
// `Road.mReferencePosition` is a plain `Vector3` — no rotation field — so the
// gizmo exposes translate only. Bulk Selections (where the position orbits a
// pivot) use `bulkRotateRoadRefsYaw` in `./bulk.ts`; for a single-entity
// pick rotation has nowhere to apply (a point rotating around itself is a
// no-op).
//
// No cascade — Roads have no "linked" topology to drag along; the resource's
// only structural pointers (Streets / Junctions / Spans / Challenges) are
// graph edges by index, not geometric joins, so a translate leaves them
// semantically intact.

import type { ParsedStreetData, Road } from '../streetData';

/**
 * Translate one road's reference position by a 3D offset. Only
 * `model.roads[roadIdx].mReferencePosition` moves; every other field on the
 * road, every other road, and every other top-level array stays
 * structurally identical (===-equal).
 *
 * Returns the original `model` reference when `(dx, dy, dz) === (0, 0, 0)`
 * so byte-for-byte BND2 writeback is preserved on a no-op gesture.
 *
 * @throws RangeError if `roadIdx` is out of range.
 */
export function translateRoadRefPositionRigid(
	model: ParsedStreetData,
	roadIdx: number,
	offset: { x: number; y: number; z: number },
): ParsedStreetData {
	if (roadIdx < 0 || roadIdx >= model.roads.length) {
		throw new RangeError(`roadIdx ${roadIdx} out of range [0, ${model.roads.length})`);
	}
	const dx = offset.x;
	const dy = offset.y;
	const dz = offset.z;
	if (dx === 0 && dy === 0 && dz === 0) return model;

	const src = model.roads[roadIdx];
	const next: Road = {
		...src,
		mReferencePosition: {
			x: src.mReferencePosition.x + dx,
			y: src.mReferencePosition.y + dy,
			z: src.mReferencePosition.z + dz,
		},
	};
	const roads = model.roads.map((r, i) => (i === roadIdx ? next : r));
	return { ...model, roads };
}
