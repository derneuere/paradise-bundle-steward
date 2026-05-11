// V12 retail snap-to-edges. Corner & section drag magnetism for the
// in-viewport drag gestures.
//
// `snapSectionOffset` adjusts a proposed section-translate so a source
// corner that lands within `snapRadius` of a foreign corner or edge snaps
// onto that target exactly. `snapCornerOffset` adjusts a proposed
// corner-drag offset the same way for a single corner.
//
// "Foreign" means corners/edges on OTHER sections, with cascade-partner
// corners excluded — the magnetism never tugs the drag onto its own
// cascade-driven moving neighbours. Legacy V4/V6 siblings live in
// `legacy.ts`.

import type {
	ParsedAISectionsV12,
	Vector2,
} from '../aiSections';
import { POSITION_EPS } from './_helpers';

// =============================================================================
// Snap-to-edges (corner & edge magnetism for the in-viewport drag gestures)
// =============================================================================

/**
 * Project `p` onto the segment `a→b` and return both the closest point on
 * the segment and the XZ distance from `p` to that point. Endpoints are
 * clamped — a probe that overshoots either end snaps to that end's corner.
 */
export function nearestPointOnSegment(
	p: Vector2,
	a: Vector2,
	b: Vector2,
): { point: Vector2; dist: number } {
	const abx = b.x - a.x;
	const aby = b.y - a.y;
	const lenSq = abx * abx + aby * aby;
	if (lenSq === 0) {
		// Degenerate edge — `a` and `b` are the same point. Treat as that point.
		const dx = p.x - a.x;
		const dy = p.y - a.y;
		return { point: { x: a.x, y: a.y }, dist: Math.hypot(dx, dy) };
	}
	const t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq;
	const tClamped = Math.max(0, Math.min(1, t));
	const point = { x: a.x + tClamped * abx, y: a.y + tClamped * aby };
	return { point, dist: Math.hypot(p.x - point.x, p.y - point.y) };
}

/**
 * Search every foreign corner and edge for the nearest target to a probe
 * point. Returns the world XZ position of the target plus its distance, or
 * `null` when nothing is in range.
 *
 * `cascadePartner` lets the caller exclude points already moving with the
 * drag (e.g., for a corner-drag, the corners coincident with the OLD
 * dragged position; for a section-drag, every corner coincident with any
 * source corner). Edges with either endpoint flagged as a cascade partner
 * are also skipped — those edges are deforming with us, snapping onto
 * them is meaningless.
 */
function findNearestSnapTarget(
	model: ParsedAISectionsV12,
	srcIdx: number,
	probe: Vector2,
	snapRadius: number,
	cascadePartner: (c: Vector2) => boolean,
): { point: Vector2; dist: number } | null {
	if (snapRadius <= 0) return null;

	let best: { point: Vector2; dist: number } | null = null;

	for (let si = 0; si < model.sections.length; si++) {
		if (si === srcIdx) continue;
		const s = model.sections[si];
		const N = s.corners.length;
		if (N === 0) continue;

		// Test every corner.
		for (const c of s.corners) {
			if (cascadePartner(c)) continue;
			const dist = Math.hypot(probe.x - c.x, probe.y - c.y);
			if (dist < (best?.dist ?? snapRadius)) {
				best = { point: { x: c.x, y: c.y }, dist };
			}
		}

		// Test every edge (corner-pair). Skip edges whose endpoints are
		// cascade partners — those edges move with us.
		for (let i = 0; i < N; i++) {
			const a = s.corners[i];
			const b = s.corners[(i + 1) % N];
			if (cascadePartner(a) || cascadePartner(b)) continue;
			const candidate = nearestPointOnSegment(probe, a, b);
			if (candidate.dist < (best?.dist ?? snapRadius)) {
				best = candidate;
			}
		}
	}

	return best;
}

/**
 * Adjust a proposed translate-offset so a source corner that lands within
 * `snapRadius` of a foreign corner OR a point on a foreign edge snaps onto
 * that target exactly. Tries every source corner against every foreign
 * snap target; the closest pair wins. Returns the original offset when
 * nothing's in range.
 *
 * "Foreign" excludes:
 *   - corners and edges on the source section itself,
 *   - corners on neighbour sections world-coincident with any source
 *     corner (cascade partners — they translate with us, so they're not
 *     stationary snap targets),
 *   - edges with either endpoint flagged as a cascade partner (they
 *     deform with us).
 */
export function snapSectionOffset(
	model: ParsedAISectionsV12,
	srcIdx: number,
	proposedOffset: { x: number; z: number },
	snapRadius: number,
): { x: number; z: number } {
	if (srcIdx < 0 || srcIdx >= model.sections.length) return proposedOffset;
	if (snapRadius <= 0) return proposedOffset;

	const src = model.sections[srcIdx];
	const srcCorners = src.corners;

	const isCascadePartner = (c: Vector2): boolean => {
		for (const s of srcCorners) {
			if (Math.abs(s.x - c.x) < POSITION_EPS && Math.abs(s.y - c.y) < POSITION_EPS) {
				return true;
			}
		}
		return false;
	};

	let bestDist = snapRadius;
	let bestAdjustment: { x: number; z: number } | null = null;

	for (const srcCorner of srcCorners) {
		const probe: Vector2 = {
			x: srcCorner.x + proposedOffset.x,
			y: srcCorner.y + proposedOffset.z,
		};
		const found = findNearestSnapTarget(model, srcIdx, probe, bestDist, isCascadePartner);
		if (found && found.dist < bestDist) {
			bestDist = found.dist;
			bestAdjustment = {
				x: found.point.x - probe.x,
				z: found.point.y - probe.y,
			};
		}
	}

	if (!bestAdjustment) return proposedOffset;
	return {
		x: proposedOffset.x + bestAdjustment.x,
		z: proposedOffset.z + bestAdjustment.z,
	};
}

/**
 * Adjust a proposed corner-drag offset so the dragged corner snaps onto
 * the closest foreign corner OR point on a foreign edge within
 * `snapRadius`. Returns the original offset when nothing's in range.
 */
export function snapCornerOffset(
	model: ParsedAISectionsV12,
	srcIdx: number,
	cornerIdx: number,
	proposedOffset: { x: number; z: number },
	snapRadius: number,
): { x: number; z: number } {
	if (srcIdx < 0 || srcIdx >= model.sections.length) return proposedOffset;
	const src = model.sections[srcIdx];
	if (cornerIdx < 0 || cornerIdx >= src.corners.length) return proposedOffset;
	if (snapRadius <= 0) return proposedOffset;

	const oldCorner = src.corners[cornerIdx];
	const probe: Vector2 = {
		x: oldCorner.x + proposedOffset.x,
		y: oldCorner.y + proposedOffset.z,
	};

	const isCascadePartner = (c: Vector2): boolean =>
		Math.abs(c.x - oldCorner.x) < POSITION_EPS &&
		Math.abs(c.y - oldCorner.y) < POSITION_EPS;

	const found = findNearestSnapTarget(model, srcIdx, probe, snapRadius, isCascadePartner);
	if (!found) return proposedOffset;

	return {
		x: found.point.x - oldCorner.x,
		z: found.point.y - oldCorner.y,
	};
}
