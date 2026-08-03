// Pins the two things the whole merged **Bulk transform** rests on:
//
//   1. the **Pivot** is a per-axis MEDIAN (not a centroid, not a real point);
//   2. `rotatePointAboutPivot` uses the TRUE right-hand / three.js convention.
//
// (2) is cross-validated against THREE.Euler('XYZ') below. The module under
// test imports no three.js — the test may, precisely so the two can be
// compared. If these ever disagree, prop/static-vehicle/trigger-box
// orientations and their orbit positions part company.

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';

import {
	addPoint,
	isZeroRotation,
	isZeroTranslate,
	median,
	medianPoint,
	rotatePointAboutPivot,
} from '../math';

const ORIGIN = { x: 0, y: 0, z: 0 };

/** Floating-point comparison for rotated coordinates. */
function expectPoint(
	actual: { x: number; y: number; z: number },
	expected: { x: number; y: number; z: number },
) {
	expect(actual.x).toBeCloseTo(expected.x, 10);
	expect(actual.y).toBeCloseTo(expected.y, 10);
	expect(actual.z).toBeCloseTo(expected.z, 10);
}

describe('median', () => {
	it('returns 0 for an empty list so callers never branch', () => {
		expect(median([])).toBe(0);
	});

	it('returns the middle sample for an odd count', () => {
		expect(median([5, 1, 3])).toBe(3);
	});

	it('averages the two middle samples for an even count', () => {
		expect(median([1, 2, 3, 4])).toBe(2.5);
	});

	it('sorts numerically, not lexicographically', () => {
		// The default Array#sort comparator would order these 10, 2, 9 and
		// report 2 as the median.
		expect(median([10, 2, 9])).toBe(9);
	});

	it('does not mutate the caller list', () => {
		const values = [3, 1, 2];
		median(values);
		expect(values).toEqual([3, 1, 2]);
	});

	it('anchors near a tight cluster rather than being dragged by outliers', () => {
		// This is WHY the Pivot is a median: one far-away selection member
		// must not pull the gizmo out into empty space.
		expect(median([0, 1, 2, 3, 100000])).toBe(2);
	});
});

describe('medianPoint', () => {
	it('is null for an empty list — the signal to render no gizmo', () => {
		expect(medianPoint([])).toBeNull();
	});

	it('takes each axis independently, so the pivot need not be a real point', () => {
		const pivot = medianPoint([
			{ x: 0, y: 10, z: 100 },
			{ x: 1, y: 0, z: 300 },
			{ x: 2, y: 20, z: 200 },
		]);
		expect(pivot).toEqual({ x: 1, y: 10, z: 200 });
	});
});

describe('zero tests and addPoint', () => {
	it('treats only an exact all-zero delta as identity', () => {
		expect(isZeroTranslate(ORIGIN)).toBe(true);
		expect(isZeroTranslate({ x: 0, y: 1e-12, z: 0 })).toBe(false);
		expect(isZeroRotation(ORIGIN)).toBe(true);
		expect(isZeroRotation({ x: 0, y: 0, z: -1e-12 })).toBe(false);
	});

	it('adds componentwise without mutating either operand', () => {
		const p = { x: 1, y: 2, z: 3 };
		const d = { x: 10, y: 20, z: 30 };
		expect(addPoint(p, d)).toEqual({ x: 11, y: 22, z: 33 });
		expect(p).toEqual({ x: 1, y: 2, z: 3 });
	});
});

describe('rotatePointAboutPivot — the yaw convention', () => {
	it('maps +X to -Z for a positive Y rotation (THE pin)', () => {
		// This is the single most dangerous line in the merge and the reason
		// this test exists. Positive yaw is the RIGHT-HAND rule about +Y,
		// which is what THREE.Euler('XYZ') / makeRotationFromEuler does:
		// +X swings toward -Z, NOT toward +Z.
		//
		// Four of the six resources' legacy ops rotated +X -> +Z, so a mixed
		// traffic selection counter-rotated on screen (junctions one way,
		// static vehicles the other). The shared math cannot deviate from
		// three's convention, because `SlotWrite.spin` is fed straight into
		// makeRotationFromEuler by the prop / static-vehicle / trigger-box
		// resolvers — the orbit and the facing must agree.
		const rotated = rotatePointAboutPivot({ x: 10, y: 0, z: 0 }, ORIGIN, {
			x: 0,
			y: Math.PI / 2,
			z: 0,
		});
		expectPoint(rotated, { x: 0, y: 0, z: -10 });
	});

	it('maps +Z to +X for a positive Y rotation', () => {
		const rotated = rotatePointAboutPivot({ x: 0, y: 0, z: 10 }, ORIGIN, {
			x: 0,
			y: Math.PI / 2,
			z: 0,
		});
		expectPoint(rotated, { x: 10, y: 0, z: 0 });
	});

	it('maps +Y to +Z for a positive X rotation (right-hand about +X)', () => {
		const rotated = rotatePointAboutPivot({ x: 0, y: 10, z: 0 }, ORIGIN, {
			x: Math.PI / 2,
			y: 0,
			z: 0,
		});
		expectPoint(rotated, { x: 0, y: 0, z: 10 });
	});

	it('maps +X to +Y for a positive Z rotation (right-hand about +Z)', () => {
		const rotated = rotatePointAboutPivot({ x: 10, y: 0, z: 0 }, ORIGIN, {
			x: 0,
			y: 0,
			z: Math.PI / 2,
		});
		expectPoint(rotated, { x: 0, y: 10, z: 0 });
	});

	it('orbits about a non-origin pivot rather than the world origin', () => {
		// The old traffic Matrix44 path hardcoded the pivot's y to 0; a full
		// 3D pivot must carry Y through untouched for a yaw-only gesture.
		const pivot = { x: 100, y: 7, z: 100 };
		const rotated = rotatePointAboutPivot({ x: 110, y: 7, z: 100 }, pivot, {
			x: 0,
			y: Math.PI / 2,
			z: 0,
		});
		expectPoint(rotated, { x: 100, y: 7, z: 90 });
	});

	it('leaves the point exactly untouched for a zero rotation', () => {
		// Exact equality, not toBeCloseTo: the three `!== 0` guards must skip
		// every axis so an identity rotate cannot introduce float drift and
		// dirty a Bundle that nothing actually moved.
		const p = { x: 1.5, y: -2.25, z: 3.125 };
		expect(rotatePointAboutPivot(p, { x: 9, y: 9, z: 9 }, ORIGIN)).toEqual(p);
	});

	it('returns the pivot exactly when the point IS the pivot', () => {
		// Also exact: a slot sitting on the pivot must produce a byte-identical
		// position, so a resolver can report "nothing changed" and preserve the
		// model reference.
		const pivot = { x: 12.5, y: 3, z: -8 };
		expect(rotatePointAboutPivot(pivot, pivot, { x: 0, y: 1.234, z: 0 })).toEqual(pivot);
	});

	it('composes XYZ in the same order as THREE.Euler for a compound rotation', () => {
		// R = Rx * Ry * Rz, i.e. applied to a vector: Rz first, then Ry, then
		// Rx. Any other order agrees on single-axis cases and silently diverges
		// the moment a user drags two rings in one gesture.
		const r = { x: 0.37, y: -1.12, z: 0.83 };
		const pivot = { x: -4, y: 11, z: 2.5 };
		const p = { x: 17, y: -3, z: 6 };

		const mine = rotatePointAboutPivot(p, pivot, r);

		const theirs = new THREE.Vector3(p.x - pivot.x, p.y - pivot.y, p.z - pivot.z)
			.applyMatrix4(
				new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(r.x, r.y, r.z, 'XYZ')),
			)
			.add(new THREE.Vector3(pivot.x, pivot.y, pivot.z));

		expectPoint(mine, theirs);
	});

	it('agrees with THREE for a yaw-only rotation (the common case)', () => {
		const r = { x: 0, y: 2.0, z: 0 };
		const mine = rotatePointAboutPivot({ x: 10, y: 0, z: 0 }, ORIGIN, r);
		const theirs = new THREE.Vector3(10, 0, 0).applyMatrix4(
			new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(0, r.y, 0, 'XYZ')),
		);
		expectPoint(mine, theirs);
	});
});
