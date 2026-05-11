// Internal helpers shared across the aiSectionsOps directory module.
//
// Pure functions only — XZ vector arithmetic, approximate equality
// predicates, the storage-shape adapter type that lets the corner-drag
// algorithm work on both V12 (`Vector2[]`) and V4/V6 (parallel
// `cornersX[]` / `cornersZ[]`) layouts, and the structural padding helper.
//
// Underscore-prefixed because nothing here is part of the public API —
// the directory's barrel never re-exports these. External callers go
// through `'@/lib/core/aiSectionsOps'` and see only the named ops.

import type { Vector2 } from '../aiSections';

// =============================================================================
// Vector helpers (XZ-plane 2D)
// =============================================================================

export const v2add = (a: Vector2, b: Vector2): Vector2 => ({ x: a.x + b.x, y: a.y + b.y });
export const v2sub = (a: Vector2, b: Vector2): Vector2 => ({ x: a.x - b.x, y: a.y - b.y });
export const v2scale = (a: Vector2, s: number): Vector2 => ({ x: a.x * s, y: a.y * s });
export const v2dot = (a: Vector2, b: Vector2): number => a.x * b.x + a.y * b.y;
export const v2len = (a: Vector2): number => Math.hypot(a.x, a.y);
// 90° rotation in XZ. Either (y, -x) or (-y, x); we pick one and flip later
// based on which side of the polygon centroid the edge midpoint sits on.
export const v2perp = (a: Vector2): Vector2 => ({ x: a.y, y: -a.x });

export const centroid = (corners: Vector2[]): Vector2 => {
	let sx = 0, sy = 0;
	for (const c of corners) { sx += c.x; sy += c.y; }
	const n = corners.length || 1;
	return { x: sx / n, y: sy / n };
};

// =============================================================================
// Approximate-equality predicates
// =============================================================================

export const POSITION_EPS = 1e-3;

export const v3Approx = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) =>
	Math.abs(a.x - b.x) < POSITION_EPS &&
	Math.abs(a.y - b.y) < POSITION_EPS &&
	Math.abs(a.z - b.z) < POSITION_EPS;

export const v2Approx = (a: Vector2, b: Vector2) =>
	Math.abs(a.x - b.x) < POSITION_EPS && Math.abs(a.y - b.y) < POSITION_EPS;

// =============================================================================
// Padding helper for legacy V4 cornersX/Z arrays
// =============================================================================

export function padTo4(xs: number[]): number[] {
	if (xs.length >= 4) return xs.slice(0, 4);
	const out = xs.slice();
	while (out.length < 4) out.push(0);
	return out;
}

// =============================================================================
// Storage-shape adapter for the corner-drag op
// =============================================================================

/**
 * Storage-shape adapter for the corner-drag op. V12 sections store corners
 * as `Vector2[]` (with the `y` field being world-Z); V4/V6 sections store
 * them as parallel `cornersX[]` + `cornersZ[]` f32 arrays. The smart-drag
 * algorithm is identical in both — find every corner / boundary-line
 * endpoint coincident with the dragged point, shift them by the same
 * offset — so we factor the storage difference out into this adapter and
 * keep one op implementation.
 *
 * `getCorners` projects to the canonical `Vector2`-on-XZ shape (`{x, y=z}`,
 * matching V12's native storage), and `setCorners` writes back through
 * whichever native layout the section uses. Boundary lines on V12 and V4/V6
 * already share the `BoundaryLine` Vector4 shape, so no boundary-line
 * adapter is needed — the `BoundaryLine` type alias here covers both
 * (`LegacyBoundaryLine` is structurally identical to `BoundaryLine`).
 */
export type SectionLikeShape<S, P, BL extends { verts: { x: number; y: number; z: number; w: number } }> = {
	getCorners: (s: S) => Vector2[];
	setCorners: (s: S, corners: Vector2[]) => S;
	getPortals: (s: S) => P[];
	setPortals: (s: S, portals: P[]) => S;
	getNoGoLines: (s: S) => BL[];
	setNoGoLines: (s: S, lines: BL[]) => S;
	getPortalBoundaryLines: (p: P) => BL[];
	setPortalBoundaryLines: (p: P, lines: BL[]) => P;
};

/**
 * Generic smart corner-drag — the meat of `translateCornerWithShared`
 * (V12) and `translateLegacyCornerWithShared` (V4/V6). Walks every section
 * via the supplied `shape`, looking for corners and boundary-line endpoints
 * that coincide with the OLD dragged-corner position, and shifts them by
 * `(dx, dz)`. Sections, portals, and lines that don't touch the dragged
 * point are returned `===`-identical so React renderers can cheaply skip.
 */
export function translateCornerWithSharedGeneric<
	S,
	P,
	BL extends { verts: { x: number; y: number; z: number; w: number } },
>(
	sections: S[],
	srcIdx: number,
	cornerIdx: number,
	offset: { x: number; z: number },
	shape: SectionLikeShape<S, P, BL>,
): { sections: S[]; changed: boolean } {
	if (srcIdx < 0 || srcIdx >= sections.length) {
		throw new RangeError(`srcIdx ${srcIdx} out of range [0, ${sections.length})`);
	}
	const src = sections[srcIdx];
	const srcCorners = shape.getCorners(src);
	if (cornerIdx < 0 || cornerIdx >= srcCorners.length) {
		throw new RangeError(`cornerIdx ${cornerIdx} out of range [0, ${srcCorners.length})`);
	}
	if (offset.x === 0 && offset.z === 0) return { sections, changed: false };

	const oldCorner = srcCorners[cornerIdx];
	const dx = offset.x;
	const dz = offset.z;

	let anyChanged = false;
	const next = sections.map((sec) => {
		const corners = shape.getCorners(sec);
		let cornersChanged = false;
		const newCorners = corners.map((c) => {
			if (v2Approx(c, oldCorner)) {
				cornersChanged = true;
				return { x: c.x + dx, y: c.y + dz };
			}
			return c;
		});

		const portals = shape.getPortals(sec);
		let portalsChanged = false;
		const newPortals = portals.map((p) => {
			const bls = shape.getPortalBoundaryLines(p);
			let blsChanged = false;
			const newBLs = bls.map((bl) => {
				const shifted = shiftBoundaryEndpointsAt(bl, oldCorner, dx, dz);
				if (shifted !== bl) blsChanged = true;
				return shifted;
			});
			if (!blsChanged) return p;
			portalsChanged = true;
			return shape.setPortalBoundaryLines(p, newBLs);
		});

		const noGo = shape.getNoGoLines(sec);
		let noGoChanged = false;
		const newNoGo = noGo.map((bl) => {
			const shifted = shiftBoundaryEndpointsAt(bl, oldCorner, dx, dz);
			if (shifted !== bl) noGoChanged = true;
			return shifted;
		});

		if (!cornersChanged && !portalsChanged && !noGoChanged) return sec;
		anyChanged = true;
		let updated = sec;
		if (cornersChanged) updated = shape.setCorners(updated, newCorners);
		if (portalsChanged) updated = shape.setPortals(updated, newPortals);
		if (noGoChanged) updated = shape.setNoGoLines(updated, newNoGo);
		return updated;
	});

	return { sections: anyChanged ? next : sections, changed: anyChanged };
}

/**
 * Return a new BoundaryLine with any endpoint that matches `point` shifted
 * by `(dx, dz)`. Returns the original input (`===`-equal) when no endpoint
 * matched, so callers can detect "no change" cheaply.
 *
 * Generic over the boundary-line shape — V12 `BoundaryLine` and V4/V6
 * `LegacyBoundaryLine` are structurally identical (both wrap a Vector4
 * packing the two endpoints) so the same helper drives both ops.
 */
function shiftBoundaryEndpointsAt<BL extends { verts: { x: number; y: number; z: number; w: number } }>(
	bl: BL,
	point: Vector2,
	dx: number,
	dz: number,
): BL {
	const startMatches =
		Math.abs(bl.verts.x - point.x) < POSITION_EPS &&
		Math.abs(bl.verts.y - point.y) < POSITION_EPS;
	const endMatches =
		Math.abs(bl.verts.z - point.x) < POSITION_EPS &&
		Math.abs(bl.verts.w - point.y) < POSITION_EPS;
	if (!startMatches && !endMatches) return bl;
	return {
		...bl,
		verts: {
			x: startMatches ? bl.verts.x + dx : bl.verts.x,
			y: startMatches ? bl.verts.y + dz : bl.verts.y,
			z: endMatches ? bl.verts.z + dx : bl.verts.z,
			w: endMatches ? bl.verts.w + dz : bl.verts.w,
		},
	};
}
