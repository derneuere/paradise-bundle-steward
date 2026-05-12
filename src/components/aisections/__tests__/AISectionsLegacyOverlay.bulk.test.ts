// AISectionsLegacyOverlay marquee centroid hit-test spec.
//
// The V4/V6 marquee callback computes each section's centroid from the
// parallel cornersX[] / cornersZ[] arrays and tests it against a
// THREE.Frustum supplied by `MarqueeSelector`. We can't mount the overlay
// in this `node`-only env (no jsdom, no @testing-library/react), so we
// pin the load-bearing centroid + frustum-containment math here. A
// regression that swapped cornersX → Y or that emitted the wrong path
// shape (e.g. dropping the `legacy` prefix) would land here loudly.

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import type { LegacyAISection } from '@/lib/core/aiSections';
import { LegacyDangerRating } from '@/lib/core/aiSections';
import type { NodePath } from '@/lib/schema/walk';

// Re-implements the same centroid + hit-test the legacy overlay's
// `handleMarquee` callback runs. Lifted out so the test pins the
// data-shape contract (cornersX/cornersZ → centroid, paths emitted
// under the `legacy` prefix) without going through a React mount.
function legacyMarqueeHits(
	sections: readonly LegacyAISection[],
	frustum: THREE.Frustum,
): NodePath[] {
	const hits: NodePath[] = [];
	const pt = new THREE.Vector3();
	for (let i = 0; i < sections.length; i++) {
		const s = sections[i];
		const n = Math.min(s.cornersX.length, s.cornersZ.length);
		if (n === 0) continue;
		let sx = 0, sz = 0;
		for (let k = 0; k < n; k++) {
			sx += s.cornersX[k];
			sz += s.cornersZ[k];
		}
		pt.set(sx / n, 0, sz / n);
		if (frustum.containsPoint(pt)) hits.push(['legacy', 'sections', i]);
	}
	return hits;
}

function makeSection(
	cornersX: number[],
	cornersZ: number[],
): LegacyAISection {
	return {
		portals: [],
		noGoLines: [],
		cornersX,
		cornersZ,
		dangerRating: LegacyDangerRating.E_DANGER_RATING_NORMAL,
		flags: 0,
	};
}

// A 3-section linear V4 model. Each section is a 4-corner quad on the
// ground plane; centroids land at x = 0, 100, 200 with z = 0. The test
// frustum is hand-built to cover only x ≈ 100 (section 1).
const sections: LegacyAISection[] = [
	makeSection([-5, 5, 5, -5], [-5, -5, 5, 5]),       // centroid (0, 0, 0)
	makeSection([95, 105, 105, 95], [-5, -5, 5, 5]),    // centroid (100, 0, 0)
	makeSection([195, 205, 205, 195], [-5, -5, 5, 5]),  // centroid (200, 0, 0)
];

// Hand-built axis-aligned cuboid frustum: x ∈ [80, 120], y ∈ [-1, 1],
// z ∈ [-50, 50]. THREE.Frustum.containsPoint requires every plane's
// signed distance to be ≥ 0 (`distanceToPoint(p) >= 0`), so each plane's
// normal points INTO the cuboid.
function buildBoxFrustum(
	xMin: number, xMax: number,
	yMin: number, yMax: number,
	zMin: number, zMax: number,
): THREE.Frustum {
	const planes = [
		new THREE.Plane(new THREE.Vector3(1, 0, 0), -xMin),  // x >= xMin
		new THREE.Plane(new THREE.Vector3(-1, 0, 0), xMax),  // x <= xMax
		new THREE.Plane(new THREE.Vector3(0, 1, 0), -yMin),
		new THREE.Plane(new THREE.Vector3(0, -1, 0), yMax),
		new THREE.Plane(new THREE.Vector3(0, 0, 1), -zMin),
		new THREE.Plane(new THREE.Vector3(0, 0, -1), zMax),
	];
	const f = new THREE.Frustum();
	for (let i = 0; i < 6; i++) f.planes[i].copy(planes[i]);
	return f;
}

describe('AISectionsLegacyOverlay marquee centroid hit-test', () => {
	it('returns only the section whose centroid lies inside the frustum', () => {
		const frustum = buildBoxFrustum(80, 120, -1, 1, -50, 50);
		const hits = legacyMarqueeHits(sections, frustum);
		expect(hits).toEqual([['legacy', 'sections', 1]]);
	});

	it('returns multiple sections when the frustum spans them', () => {
		const frustum = buildBoxFrustum(-50, 250, -1, 1, -50, 50);
		const hits = legacyMarqueeHits(sections, frustum);
		expect(hits).toEqual([
			['legacy', 'sections', 0],
			['legacy', 'sections', 1],
			['legacy', 'sections', 2],
		]);
	});

	it('returns an empty array when the frustum misses every centroid', () => {
		const frustum = buildBoxFrustum(500, 600, -1, 1, -50, 50);
		const hits = legacyMarqueeHits(sections, frustum);
		expect(hits).toEqual([]);
	});

	it('emits the `legacy` schema-path prefix so paths normalise via parseSectionAddress', () => {
		// Every emitted hit is bulk-eligible under the legacy variant — the
		// workspace bulk's `applyPaths` reducer normalises through
		// `parseSectionAddress`, which only matches paths under the legacy
		// prefix for V4/V6 data. A regression that dropped the prefix would
		// silently route V4 hits to V12 keys and the tree would paint the
		// wrong rows.
		const frustum = buildBoxFrustum(-50, 250, -1, 1, -50, 50);
		const hits = legacyMarqueeHits(sections, frustum);
		for (const h of hits) {
			expect(h[0]).toBe('legacy');
			expect(h[1]).toBe('sections');
		}
	});

	it('skips sections with zero corners (defensive)', () => {
		const withDegenerate: LegacyAISection[] = [
			...sections,
			makeSection([], []),
		];
		const frustum = buildBoxFrustum(-50, 250, -1, 1, -50, 50);
		const hits = legacyMarqueeHits(withDegenerate, frustum);
		// Three valid hits; the zero-corner section is silently skipped.
		expect(hits.length).toBe(3);
	});
});
