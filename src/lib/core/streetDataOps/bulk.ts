// Bulk-transform ops for the street-data resource family.
//
// Today the only spatial datum on a Road is its `mReferencePosition`
// (Vector3) — Streets and Junctions share a Road's anchor in the overlay
// today (they're indexed off a parent Road), so the bulk-transform target
// is the Road itself. If/when Street and Junction acquire their own
// world-space positions they'll fold into this same module.
//
// Pure-3D resource (per ADR-0011): does NOT auto-disable any rotate axis.
// The intersection helper will AND down pitch/roll only if the bulk also
// contains an XZ-packed contributor (zone point, AI section corner, traffic
// yaw box, lane rung).

import type { ParsedStreetData, Road } from '../streetData';
import type { TransformAxes } from '../transformAxes';
import { STREET_REF_POSITION_BULK_AXES } from './transformAxes';

// =============================================================================
// Entity references
// =============================================================================

/** Discriminated reference to a single spatial datum in a ParsedStreetData. */
export type StreetDataEntityRef =
	/** A road's `mReferencePosition` (Vector3). */
	| { kind: 'road'; roadIdx: number };

// =============================================================================
// Pivot
// =============================================================================

/**
 * Median (per-component) of every spatial point the Selection addresses.
 * Returns `null` when the refs list is empty or every ref points at an
 * out-of-range entity.
 */
export function streetDataSelectionPivot(
	model: ParsedStreetData,
	refs: readonly StreetDataEntityRef[],
): { x: number; y: number; z: number } | null {
	const xs: number[] = [];
	const ys: number[] = [];
	const zs: number[] = [];
	for (const ref of refs) {
		const road = model.roads[ref.roadIdx];
		if (!road) continue;
		xs.push(road.mReferencePosition.x);
		ys.push(road.mReferencePosition.y);
		zs.push(road.mReferencePosition.z);
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
// Translate
// =============================================================================

/**
 * Translate every road reference in the Selection by the same
 * `(dx, dy, dz)` offset, treating the bulk as one rigid body. No cascade —
 * no spatial join to maintain.
 *
 * Returns the original `model` reference on an identity offset OR an empty
 * refs list so byte-for-byte BND2 writeback is preserved on a no-op
 * gesture.
 */
export function bulkTranslateRoadRefs(
	model: ParsedStreetData,
	refs: readonly StreetDataEntityRef[],
	offset: { x: number; y: number; z: number },
): ParsedStreetData {
	const dx = offset.x;
	const dy = offset.y;
	const dz = offset.z;
	if (dx === 0 && dy === 0 && dz === 0) return model;
	if (refs.length === 0) return model;

	const touched = new Set<number>();
	for (const ref of refs) touched.add(ref.roadIdx);

	let anyChange = false;
	const nextRoads = model.roads.map((road, idx) => {
		if (!touched.has(idx)) return road;
		anyChange = true;
		const next: Road = {
			...road,
			mReferencePosition: {
				x: road.mReferencePosition.x + dx,
				y: road.mReferencePosition.y + dy,
				z: road.mReferencePosition.z + dz,
			},
		};
		return next;
	});
	if (!anyChange) return model;
	return { ...model, roads: nextRoads };
}

// =============================================================================
// Rotate (yaw)
// =============================================================================

/**
 * Yaw-rotate every road reference in the Selection around `pivot` by
 * `theta` radians. Treats the bulk as one rigid body — every selected
 * position orbits the single shared pivot, so relative distances are
 * preserved exactly. Y is left untouched (yaw is the only ring exposed for
 * cross-resource bulks containing XZ-packed contributors — for pure
 * street-ref bulks we still call this op via the gizmo's yaw ring).
 *
 * Returns the original `model` reference on `theta === 0` OR an empty refs
 * list.
 */
export function bulkRotateRoadRefsYaw(
	model: ParsedStreetData,
	refs: readonly StreetDataEntityRef[],
	pivot: { x: number; z: number },
	theta: number,
): ParsedStreetData {
	if (theta === 0) return model;
	if (refs.length === 0) return model;

	const cosT = Math.cos(theta);
	const sinT = Math.sin(theta);
	const cx = pivot.x;
	const cz = pivot.z;

	const touched = new Set<number>();
	for (const ref of refs) touched.add(ref.roadIdx);

	let anyChange = false;
	const nextRoads = model.roads.map((road, idx) => {
		if (!touched.has(idx)) return road;
		anyChange = true;
		const ox = road.mReferencePosition.x - cx;
		const oz = road.mReferencePosition.z - cz;
		const rx = ox * cosT - oz * sinT + cx;
		const rz = ox * sinT + oz * cosT + cz;
		const next: Road = {
			...road,
			mReferencePosition: { x: rx, y: road.mReferencePosition.y, z: rz },
		};
		return next;
	});
	if (!anyChange) return model;
	return { ...model, roads: nextRoads };
}

// =============================================================================
// Axes intersection contribution
// =============================================================================

/**
 * Effective TransformAxes for a multi-Selection of street-data entities.
 * Street refs are pure-3D, so they don't veto any rotation axis. The bulk
 * helper here returns the all-enabled axes set; cross-resource bulks
 * (street + zone point, for instance) get pitch/roll AND-ed off by the
 * XZ-packed contributor's profile.
 *
 * Returns `null` for an empty refs list so callers can fall back to "no
 * gizmo".
 */
export function bulkStreetDataAxes(
	refs: readonly StreetDataEntityRef[],
): TransformAxes | null {
	if (refs.length === 0) return null;
	return STREET_REF_POSITION_BULK_AXES;
}
