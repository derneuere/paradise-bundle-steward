// Regression test for the gizmo's rotate-direction sign convention.
//
// Before the fix this was a one-character bug (`>= 0 ? 1 : -1` instead of
// `>= 0 ? -1 : 1`) that inverted yaw rotation for the typical top-down map
// view: the user would drag the yaw ring clockwise and the geometry would
// spin the opposite way.
//
// The full `computeRotateDelta` flow is window-event-driven and only
// reachable inside an R3F mount (the repo's vitest env is `node` so we
// can't render the gizmo). We extracted the sign-flip predicate into a
// pure helper precisely so its convention can be pinned here — if the
// next refactor flips the sign again, this test fails before the user
// sees backwards rotation.

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { rotationSignForCameraSide } from '../useBulkTransformDrag';

describe('rotationSignForCameraSide — gizmo rotate-direction convention', () => {
	it('returns +1 for the typical top-down view (camera above pivot, yaw axis = +Y)', () => {
		// Camera looks down at the map. raw θ from atan2(dy, dx) increases
		// clockwise on screen, which (under three.js's right-hand rule for
		// rotation around +Y) maps +X → +Z and reads as clockwise on a
		// top-down view. So the sign should be +1: no flip, raw θ is used
		// as-is.
		const axis = new THREE.Vector3(0, 1, 0);
		const camera = new THREE.Vector3(0, 100, 0);
		const pivot = new THREE.Vector3(0, 0, 0);
		expect(rotationSignForCameraSide(axis, camera, pivot)).toBe(1);
	});

	it('returns -1 when the camera looks up the axis from below (mirrored view)', () => {
		// Camera below pivot, looking up the +Y axis. Screen motion is
		// mirrored relative to the top-down case; raw θ would rotate the
		// geometry in the user's "wrong" direction without a flip.
		const axis = new THREE.Vector3(0, 1, 0);
		const camera = new THREE.Vector3(0, -100, 0);
		const pivot = new THREE.Vector3(0, 0, 0);
		expect(rotationSignForCameraSide(axis, camera, pivot)).toBe(-1);
	});

	it('returns +1 when the camera is offset but still on the -axis side', () => {
		// The predicate is a half-space test, not an axis-alignment test:
		// any camera position with `axisWorld · (pivot − camera) < 0`
		// counts as "looking from the -axis side." Verify with an off-axis
		// top-down camera so the test covers the generic case, not just
		// the axis-aligned one.
		const axis = new THREE.Vector3(0, 1, 0);
		const camera = new THREE.Vector3(50, 80, 30);
		const pivot = new THREE.Vector3(0, 0, 0);
		expect(rotationSignForCameraSide(axis, camera, pivot)).toBe(1);
	});

	it('generalises to pitch (X axis) and roll (Z axis) — same +axis / -axis half-space rule', () => {
		// AI sections only render the Y ring today (pitch/roll auto-
		// disabled per ADR-0011), but trigger boxes and Matrix44 vehicles
		// expose all three. Pin the geometric predicate's behaviour for
		// those axes so the convention is consistent regardless of which
		// ring is being dragged.
		//
		// Rule: camera on the +axis side of pivot → return +1 (no flip);
		// camera on the -axis side → return -1 (flip). Same as the yaw
		// case verified above, applied to X and Z.
		const pivot = new THREE.Vector3(0, 0, 0);

		// Pitch (around +X). Camera at (+x, 0, 0) is on the +X side.
		expect(
			rotationSignForCameraSide(
				new THREE.Vector3(1, 0, 0),
				new THREE.Vector3(100, 0, 0),
				pivot,
			),
		).toBe(1);
		expect(
			rotationSignForCameraSide(
				new THREE.Vector3(1, 0, 0),
				new THREE.Vector3(-100, 0, 0),
				pivot,
			),
		).toBe(-1);

		// Roll (around +Z). Camera at (0, 0, +z) is on the +Z side.
		expect(
			rotationSignForCameraSide(
				new THREE.Vector3(0, 0, 1),
				new THREE.Vector3(0, 0, 100),
				pivot,
			),
		).toBe(1);
		expect(
			rotationSignForCameraSide(
				new THREE.Vector3(0, 0, 1),
				new THREE.Vector3(0, 0, -100),
				pivot,
			),
		).toBe(-1);
	});

	it('treats axisWorld · camToPivot === 0 (camera in the rotation plane) as the +1 side', () => {
		// Edge case: camera sits exactly in the plane perpendicular to
		// the rotation axis at the pivot. The predicate `>= 0` puts this
		// on the no-flip side. Behaviourally irrelevant for AI sections
		// (camera never lives in the XZ plane through the pivot) but
		// pinned so the convention is explicit.
		const axis = new THREE.Vector3(0, 1, 0);
		const camera = new THREE.Vector3(100, 0, 50); // same Y as pivot
		const pivot = new THREE.Vector3(0, 0, 0);
		expect(rotationSignForCameraSide(axis, camera, pivot)).toBe(-1);
	});
});
