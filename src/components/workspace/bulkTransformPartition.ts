// bulkTransformPartition — the central "which refs in the current Selection
// can the Bulk transform gizmo actually move?" predicate.
//
// CONTEXT.md / "Pivot": polygon soups have no world-space placement field
// and are excluded from Bulk transforms entirely — vertices are u16-packed
// into local soup-space with a (min, max) bounding box per soup, so there
// is no "move this soup as a rigid body" operation in the file format. The
// marquee can still pick one up (per-overlay marqueeing is rough at the
// boundary between AI sections + polygon soups in dense scenes), so this
// slice (#82) gives the user honest feedback when that happens:
//
//   - Mixed Selection (1+ transformable + 1+ soup): the gizmo still appears,
//     applies the transform to the non-soup entities only, and a hint near
//     the gizmo reads "N polygon soups not transformed".
//   - Soup-only Selection: the gizmo does not appear. The Selection is
//     still valid for non-spatial ops (inspector content, deletion, etc.).
//
// The predicate intentionally lives in `workspace/` (not deeper inside the
// AI sections ops module) so the future cross-resource Selection can mix
// AI sections + trigger boxes + traffic vehicles + polygon-soup polys
// without each ops module having to know about "soup-ness". Each ref kind
// declares its own `isTransformable` here once.
//
// The "polygon soup" carrier is a polygon-inside-a-soup ref — that's the
// shape the PSL workspace bulk speaks. Whole-soup refs aren't yet a thing
// in the Selection currency (the PSL codec is `{ kind: 'polygon', indices:
// [soupIdx, polyIdx] }`), but the partition treats both the same way: any
// ref whose containing structure is a `PolygonSoup` is ineligible.

/** Cross-resource Selection-entry shape used by the Bulk transform gizmo's
 *  partition. The discriminator is `kind`; future ref kinds (trigger box,
 *  traffic vehicle, zone point) extend this union as their issues land. */
export type BulkTransformRef =
	/** A polygon-soup polygon. Ineligible for transform — the parent soup
	 *  has no world-space placement and vertices are u16-packed locally. */
	| { kind: 'polygonSoupPoly'; bundleId: string; index: number; soupIdx: number; polyIdx: number }
	/** Any other ref kind (AI section, sub-entity, trigger box, traffic
	 *  vehicle, etc.) that has a world-space coordinate the gizmo can move.
	 *  Carried opaquely — the partition only needs the eligibility flag. */
	| { kind: 'transformable'; tag: string };

/**
 * Split a list of refs into the two partitions the gizmo cares about:
 * `transformable` is the subset the transform delta should apply to; `soups`
 * is the subset the hint counter reports. Pure function — kept here (no
 * React, no model access) so unit tests can drive it directly.
 */
export function partitionForTransform(refs: readonly BulkTransformRef[]): {
	transformable: readonly BulkTransformRef[];
	soups: readonly BulkTransformRef[];
} {
	const transformable: BulkTransformRef[] = [];
	const soups: BulkTransformRef[] = [];
	for (const ref of refs) {
		if (ref.kind === 'polygonSoupPoly') soups.push(ref);
		else transformable.push(ref);
	}
	return { transformable, soups };
}

/**
 * Returns true if `ref` is ineligible for the Bulk transform gizmo because
 * it's a polygon-soup polygon (the soup has no world-space placement, per
 * CONTEXT.md / "Pivot"). Future ineligible kinds (e.g. read-only V4 sections
 * once #33's editable promotion lands) gate through here too.
 */
export function isPolygonSoupRef(ref: BulkTransformRef): boolean {
	return ref.kind === 'polygonSoupPoly';
}

/**
 * Count the distinct polygon-soup *soups* in a refs list. Multiple polys
 * within the same soup collapse to a single count entry — the hint copy is
 * "N polygon soups not transformed", not "N polygons" — so a user who
 * marquee-selects 200 polys inside two soups sees "2 polygon soups not
 * transformed", not "200".
 */
export function countSoups(refs: readonly BulkTransformRef[]): number {
	const seen = new Set<string>();
	for (const ref of refs) {
		if (ref.kind !== 'polygonSoupPoly') continue;
		seen.add(`${ref.bundleId}::${ref.index}::${ref.soupIdx}`);
	}
	return seen.size;
}
