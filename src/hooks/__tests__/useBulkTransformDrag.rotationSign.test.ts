// Regression test for the gizmo's rotate-direction sign convention.
//
// This convention is one half of a pair, and both halves have to be read
// together or the sign looks arbitrary:
//
//   1. `rotatePointAboutPivot` (@/lib/core/transform) rotates by the true
//      right-hand rule, matching `THREE.Matrix4.makeRotationFromEuler` with
//      Euler order 'XYZ'. A `+Y` rotation by `+π/2` therefore maps
//      `(10, 0, 0) → (0, 0, -10)`: `+X → -Z`, NOT `+X → +Z`.
//   2. This helper decides whether the raw screen-space drag angle is used
//      as-is or negated before it becomes that rotation.
//
// For the typical top-down map view, dragging the yaw ring clockwise on
// screen must yaw the geometry clockwise on screen, which in world terms is
// `+X → +Z`, i.e. `Ry(-θ_raw)`. So the top-down case must return -1.
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
	it('returns -1 for the typical top-down view (camera above pivot, yaw axis = +Y)', () => {
		// Camera looks down at the map. Raw θ from atan2(dy, dx) increases
		// clockwise on screen. Clockwise on a top-down view is `+X → +Z`,
		// which under the right-hand rule is `Ry(-θ)` — so the raw angle is
		// negated. This is the single most load-bearing assertion in the
		// gizmo: every spatial resource shares `rotatePointAboutPivot`, so
		// flipping it here counter-rotates the entire editor at once.
		const axis = new THREE.Vector3(0, 1, 0);
		const camera = new THREE.Vector3(0, 100, 0);
		const pivot = new THREE.Vector3(0, 0, 0);
		expect(rotationSignForCameraSide(axis, camera, pivot)).toBe(-1);
	});

	it('returns +1 when the camera looks up the axis from below (mirrored view)', () => {
		// Camera below pivot, looking up the +Y axis. Screen motion is
		// mirrored relative to the top-down case, so the raw angle is used
		// verbatim.
		const axis = new THREE.Vector3(0, 1, 0);
		const camera = new THREE.Vector3(0, -100, 0);
		const pivot = new THREE.Vector3(0, 0, 0);
		expect(rotationSignForCameraSide(axis, camera, pivot)).toBe(1);
	});

	it('returns -1 when the camera is offset but still on the +axis side', () => {
		// The predicate is a half-space test, not an axis-alignment test:
		// any camera position with `axisWorld · (pivot − camera) < 0`
		// counts as "camera on the +axis side." Verify with an off-axis
		// top-down camera so the test covers the generic case, not just
		// the axis-aligned one.
		const axis = new THREE.Vector3(0, 1, 0);
		const camera = new THREE.Vector3(50, 80, 30);
		const pivot = new THREE.Vector3(0, 0, 0);
		expect(rotationSignForCameraSide(axis, camera, pivot)).toBe(-1);
	});

	it('generalises to pitch (X axis) and roll (Z axis) — same +axis / -axis half-space rule', () => {
		// AI sections only render the Y ring today (pitch/roll auto-
		// disabled per ADR-0011), but trigger boxes and Matrix44 vehicles
		// expose all three. Pin the geometric predicate's behaviour for
		// those axes so the convention is consistent regardless of which
		// ring is being dragged.
		//
		// Rule: camera on the +axis side of pivot → return -1 (negate);
		// camera on the -axis side → return +1 (use raw). Same as the yaw
		// case verified above, applied to X and Z.
		const pivot = new THREE.Vector3(0, 0, 0);

		// Pitch (around +X). Camera at (+x, 0, 0) is on the +X side.
		expect(
			rotationSignForCameraSide(
				new THREE.Vector3(1, 0, 0),
				new THREE.Vector3(100, 0, 0),
				pivot,
			),
		).toBe(-1);
		expect(
			rotationSignForCameraSide(
				new THREE.Vector3(1, 0, 0),
				new THREE.Vector3(-100, 0, 0),
				pivot,
			),
		).toBe(1);

		// Roll (around +Z). Camera at (0, 0, +z) is on the +Z side.
		expect(
			rotationSignForCameraSide(
				new THREE.Vector3(0, 0, 1),
				new THREE.Vector3(0, 0, 100),
				pivot,
			),
		).toBe(-1);
		expect(
			rotationSignForCameraSide(
				new THREE.Vector3(0, 0, 1),
				new THREE.Vector3(0, 0, -100),
				pivot,
			),
		).toBe(1);
	});

	it('treats axisWorld · camToPivot === 0 (camera in the rotation plane) as the raw-angle side', () => {
		// Edge case: camera sits exactly in the plane perpendicular to
		// the rotation axis at the pivot. The predicate `>= 0` puts this
		// on the use-raw side. Behaviourally irrelevant for AI sections
		// (camera never lives in the XZ plane through the pivot) but
		// pinned so the convention is explicit.
		const axis = new THREE.Vector3(0, 1, 0);
		const camera = new THREE.Vector3(100, 0, 50); // same Y as pivot
		const pivot = new THREE.Vector3(0, 0, 0);
		expect(rotationSignForCameraSide(axis, camera, pivot)).toBe(1);
	});
});
