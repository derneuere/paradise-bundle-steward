import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../../deformationSpec';
import {
	sphereVsGround, sphereVsObstacle, sphereVsPlane, sphereVsPole, sweptSphereVsGround, sweptSphereVsObstacle, sweptSphereVsPlane,
	sweptSphereVsPole,
} from '../world';

const near = (a: Vec3, b: Vec3, d = 12) => b.forEach((x, i) => expect(a[i]).toBeCloseTo(x, d));
const WALL = { kind: 'wall' as const, point: [0, 0, 2] as Vec3, normal: [0, 0, 1] as Vec3, poleAxis: [0, 1, 0] as Vec3, poleRadius: 0.15 };

describe('sphere against a surface', () => {
	it('is one-sided: a centre less than 1 mm in front of the face touches nothing', () => {
		expect(sphereVsPlane([0, 0.0005, 0], 0.4, [0, 0, 0], [0, 1, 0])).toBeNull();
		expect(sphereVsPlane([0, -0.2, 0], 0.4, [0, 0, 0], [0, 1, 0])).toBeNull();
		const hit = sphereVsPlane([0, 0.001, 0], 0.4, [0, 0, 0], [0, 1, 0]);
		expect(hit).not.toBeNull();
		expect(hit!.n).toEqual([0, 1, 0]);
		expect(hit!.pA[1]).toBeCloseTo(0.001 - 0.4, 12);   // deepest point of the sphere
		expect(hit!.pB[1]).toBeCloseTo(0, 12);              // closest point on the face
	});

	it('still reports a surface up to 2 m beyond the sphere, and nothing past that', () => {
		expect(sphereVsGround([3, 2.4, 1], 0.4)).not.toBeNull();
		expect(sphereVsGround([3, 2.4001, 1], 0.4)).toBeNull();
	});

	it('meets a wall on its face, which points back at the car', () => {
		const hit = sphereVsObstacle([0, 1, 1.5], 0.4, { kind: 'wall', point: [0, 0, 2], normal: [0, 0, 1], poleAxis: [0, 1, 0], poleRadius: 0.15 });
		expect(hit!.n).toEqual([-0, -0, -1]);
		expect(hit!.pA).toEqual([0, 1, 1.9]);
		expect(hit!.pB).toEqual([0, 1, 2]);
	});

	it('meets a pole on the nearest line of its round surface', () => {
		const hit = sphereVsPole([0.3, 0.7, 0.4], 0.2, [0, 0, 0], [0, 1, 0], 0.15)!;
		expect(hit.n.map((x) => +x.toFixed(9))).toEqual([0.6, 0, 0.8]);
		hit.pB.forEach((x, i) => expect(x).toBeCloseTo([0.09, 0.7, 0.12][i], 12));
		hit.pA.forEach((x, i) => expect(x).toBeCloseTo([0.18, 0.7, 0.24][i], 12));
		expect(sphereVsPole([0.1, 0, 0], 0.2, [0, 0, 0], [0, 1, 0], 0.15)).toBeNull();   // centre inside
	});
});

describe('swept sphere against a surface', () => {
	// A sphere of radius 0.4 whose skin is 0.3 m short of the wall at z = 2.
	const C: Vec3 = [0, 1, 1.3];

	it('meets a wall it reaches during the step where it first touches, with the wall normal', () => {
		const hit = sweptSphereVsObstacle(C, 0.4, [0, 0, 0.5], WALL)!;
		expect(hit.n).toEqual([-0, -0, -1]);
		near(hit.pB, [0, 1, 2]);     // under the centre when the skin reaches the face (t = 0.6)
		near(hit.pA, [0, 1, 1.7]);   // the start sphere's point toward it
	});

	it('takes the car point toward where the sphere meets the surface, not straight down the normal', () => {
		// Sliding along the wall as it closes: it meets the face 0.3 m further on.
		const hit = sweptSphereVsObstacle(C, 0.4, [0.5, 0, 0.5], WALL)!;
		near(hit.pB, [0.3, 1, 2]);
		const f: Vec3 = [0.3 / Math.hypot(0.3, 0.7), 0, 0.7 / Math.hypot(0.3, 0.7)];
		near(hit.pA, [C[0] + 0.4 * f[0], 1, C[2] + 0.4 * f[2]]);
		expect(hit.n).toEqual([-0, -0, -1]);
	});

	it('finds nothing the sweep does not reach, or moves away from', () => {
		expect(sweptSphereVsObstacle(C, 0.4, [0, 0, 0.29], WALL)).toBeNull();
		expect(sweptSphereVsObstacle(C, 0.4, [0, 0, -0.5], WALL)).toBeNull();
		expect(sweptSphereVsObstacle([0, 1, 0.3], 0.4, [0, 0, 0.5], WALL)).toBeNull();   // 1 m out
	});

	it('reports a sphere already overlapping the surface at the start of the step, unless its centre is behind it', () => {
		const hit = sweptSphereVsPlane([0, 0.2, 0], 0.4, [0, 0.1, 0], [0, 0, 0], [0, 1, 0])!;
		near(hit.pB, [0, 0, 0]);
		near(hit.pA, [0, -0.2, 0]);
		expect(sweptSphereVsPlane([0, -0.2, 0], 0.4, [0, -0.1, 0], [0, 0, 0], [0, 1, 0])).toBeNull();
	});

	it('leaves a sphere riding just above the road alone, so a car on its wheels has no road contacts', () => {
		expect(sweptSphereVsGround([0, 0.43, 0], 0.4, [0, 0, 0.67])).toBeNull();          // level
		expect(sweptSphereVsGround([0, 0.43, 0], 0.4, [0, -0.005, 0.67])).toBeNull();     // settling a little
		expect(sweptSphereVsGround([0, 0.43, 0], 0.4, [0, -0.04, 0.67])).not.toBeNull();  // dropping onto it
		// Exactly parallel: only a sphere already inside the slab counts.
		expect(sweptSphereVsGround([0, 0.39, 0], 0.4, [0, 0, 0.67])).not.toBeNull();
	});

	it('meets a pole where the sweep first comes within reach of its axis, with the pole normal there', () => {
		// Moving +z past a pole on the z axis, offset 0.3 sideways: reach 0.5.
		const hit = sweptSphereVsPole([0.3, 0.7, -1], 0.35, [0, 0, 1], [0, 0, 0], [0, 1, 0], 0.15)!;
		near(hit.n, [0.6, 0, -0.8]);
		near(hit.pB, [0.09, 0.7, -0.12]);
		const toP: Vec3 = [0.09 - 0.3, 0, -0.12 + 1], l = Math.hypot(toP[0], toP[2]);
		near(hit.pA, [0.3 + 0.35 * toP[0] / l, 0.7, -1 + 0.35 * toP[2] / l]);
		expect(sweptSphereVsPole([0.6, 0.7, -1], 0.35, [0, 0, 1], [0, 0, 0], [0, 1, 0], 0.15)).toBeNull();   // passes beside it
		expect(sweptSphereVsPole([0.3, 0.7, -2], 0.35, [0, 0, 1], [0, 0, 0], [0, 1, 0], 0.15)).toBeNull();   // not reached yet
		expect(sweptSphereVsPole([0.1, 0, 0], 0.2, [0, 0, 0.5], [0, 0, 0], [0, 1, 0], 0.15)).toBeNull();   // centre inside
	});
});
