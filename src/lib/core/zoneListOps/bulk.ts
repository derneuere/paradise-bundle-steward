// Bulk-transform ops for the zone-list resource family.
//
// Cardinality ≥ 1 entry points for the unified Bulk-transform gizmo. A
// **Selection** of zone points (whole zones AND/or individual points across
// any zones) is treated as one rigid body: every member orbits the same
// pivot. No cascade — there's no "neighbour follows" topology to maintain
// on zones (the safe/unsafe-neighbour lists are graph edges, not geometric
// joins — moving a zone leaves them semantically intact).
//
// XZ-packed per ADR-0011: yaw-only rotate, full 3-axis translate (the Y
// delta is dropped on commit because zone points are `Vec2Padded` with no
// Y component). The transformAxes profile lives in `./transformAxes`.

import type { ParsedZoneList, Zone } from '../zoneList';
import type { TransformAxes } from '../transformAxes';
import { ZONE_POINT_AXES } from './transformAxes';

// =============================================================================
// Entity references
// =============================================================================

/** Discriminated reference to a single spatial datum in a ParsedZoneList. */
export type ZoneListEntityRef =
	/** The whole zone — every point moves together. */
	| { kind: 'zone'; zoneIdx: number }
	/** A single point on a zone (one of four in retail). */
	| { kind: 'zonePoint'; zoneIdx: number; pointIdx: number };

// =============================================================================
// Pivot
// =============================================================================

/**
 * Median (per-component) of every spatial point the Selection addresses.
 * Returns a 3D point with Y = 0 — zone points have no Y, but the gizmo's
 * pivot is a `Vector3` so heterogeneous bulks (zone + 3D resource) can mix.
 *
 * Returns `null` when the refs list is empty or every ref points at an
 * out-of-range entity.
 */
export function zoneListSelectionPivot(
	model: ParsedZoneList,
	refs: readonly ZoneListEntityRef[],
): { x: number; y: number; z: number } | null {
	const xs: number[] = [];
	const zs: number[] = [];
	for (const ref of refs) {
		const zone = model.zones[ref.zoneIdx];
		if (!zone) continue;
		if (ref.kind === 'zone') {
			for (const p of zone.points) {
				xs.push(p.x);
				zs.push(p.y);
			}
			continue;
		}
		const point = zone.points[ref.pointIdx];
		if (!point) continue;
		xs.push(point.x);
		zs.push(point.y);
	}
	if (xs.length === 0) return null;
	return { x: median(xs), y: 0, z: median(zs) };
}

function median(values: number[]): number {
	const sorted = values.slice().sort((a, b) => a - b);
	const n = sorted.length;
	if (n === 0) return 0;
	const mid = n >> 1;
	return n % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// =============================================================================
// Bucketing helpers
// =============================================================================

type ZoneRefBucket = {
	wholeZone: boolean;
	pointIdxs: Set<number>;
};

function bucketRefs(refs: readonly ZoneListEntityRef[]): Map<number, ZoneRefBucket> {
	const map = new Map<number, ZoneRefBucket>();
	for (const ref of refs) {
		let bucket = map.get(ref.zoneIdx);
		if (!bucket) {
			bucket = { wholeZone: false, pointIdxs: new Set() };
			map.set(ref.zoneIdx, bucket);
		}
		if (ref.kind === 'zone') bucket.wholeZone = true;
		else bucket.pointIdxs.add(ref.pointIdx);
	}
	return map;
}

// =============================================================================
// Translate
// =============================================================================

/**
 * Translate every entity in the Selection by the same `(dx, dz)` offset,
 * treating the bulk as one rigid body. No cascade — neighbour lists keep
 * their indices and the zone graph is otherwise untouched.
 *
 * Returns the original `model` reference on a (0, 0) offset OR an empty
 * refs list so byte-for-byte BND2 writeback is preserved on a no-op
 * gesture.
 */
export function bulkTranslateZoneEntities(
	model: ParsedZoneList,
	refs: readonly ZoneListEntityRef[],
	offset: { x: number; z: number },
): ParsedZoneList {
	const dx = offset.x;
	const dz = offset.z;
	if (dx === 0 && dz === 0) return model;
	if (refs.length === 0) return model;

	const buckets = bucketRefs(refs);
	let anyChange = false;
	const nextZones = model.zones.map((zone, zoneIdx) => {
		const bucket = buckets.get(zoneIdx);
		if (!bucket) return zone;
		if (bucket.wholeZone) {
			anyChange = true;
			return {
				...zone,
				points: zone.points.map((p) => ({ ...p, x: p.x + dx, y: p.y + dz })),
			};
		}
		let zoneTouched = false;
		const nextPoints = zone.points.map((p, pi) => {
			if (!bucket.pointIdxs.has(pi)) return p;
			zoneTouched = true;
			return { ...p, x: p.x + dx, y: p.y + dz };
		});
		if (!zoneTouched) return zone;
		anyChange = true;
		return { ...zone, points: nextPoints } satisfies Zone;
	});
	if (!anyChange) return model;
	return { ...model, zones: nextZones };
}

// =============================================================================
// Rotate (yaw)
// =============================================================================

/**
 * Yaw-rotate every entity in the Selection around `pivot` by `theta`
 * radians. Treats the bulk as one rigid body — every selected coordinate
 * orbits the single shared pivot, so relative distances within the bulk
 * are preserved exactly.
 *
 * Yaw direction follows the right-hand rule with thumb along world +Y
 * (positive `theta` rotates +X towards +Z) — same convention as
 * `bulkRotateEntitiesYaw` for AI sections.
 *
 * Returns the original `model` reference on `theta === 0` OR an empty
 * refs list.
 */
export function bulkRotateZoneEntitiesYaw(
	model: ParsedZoneList,
	refs: readonly ZoneListEntityRef[],
	pivot: { x: number; z: number },
	theta: number,
): ParsedZoneList {
	if (theta === 0) return model;
	if (refs.length === 0) return model;

	const cosT = Math.cos(theta);
	const sinT = Math.sin(theta);
	const cx = pivot.x;
	const cz = pivot.z;

	const rotXZ = (x: number, z: number): { x: number; z: number } => {
		const ox = x - cx;
		const oz = z - cz;
		return {
			x: ox * cosT - oz * sinT + cx,
			z: ox * sinT + oz * cosT + cz,
		};
	};

	const buckets = bucketRefs(refs);
	let anyChange = false;
	const nextZones = model.zones.map((zone, zoneIdx) => {
		const bucket = buckets.get(zoneIdx);
		if (!bucket) return zone;
		if (bucket.wholeZone) {
			anyChange = true;
			return {
				...zone,
				points: zone.points.map((p) => {
					const r = rotXZ(p.x, p.y);
					return { ...p, x: r.x, y: r.z };
				}),
			};
		}
		let zoneTouched = false;
		const nextPoints = zone.points.map((p, pi) => {
			if (!bucket.pointIdxs.has(pi)) return p;
			zoneTouched = true;
			const r = rotXZ(p.x, p.y);
			return { ...p, x: r.x, y: r.z };
		});
		if (!zoneTouched) return zone;
		anyChange = true;
		return { ...zone, points: nextPoints };
	});
	if (!anyChange) return model;
	return { ...model, zones: nextZones };
}

// =============================================================================
// Axes intersection contribution
// =============================================================================

/**
 * Effective TransformAxes for a multi-Selection of zone-list entities. Every
 * member is XZ-packed (`Vec2Padded`) per ADR-0011 — yaw-only on rotate. The
 * function exists as a separate export so cross-resource bulks (zone +
 * trigger box, for instance) can run their axes profile through
 * `intersectTransformAxes` and have the zone-list contribution AND-down the
 * pitch/roll rings.
 *
 * Returns `null` for an empty refs list so callers can fall back to "no
 * gizmo".
 */
export function bulkZoneListAxes(
	refs: readonly ZoneListEntityRef[],
): TransformAxes | null {
	if (refs.length === 0) return null;
	return ZONE_POINT_AXES;
}
