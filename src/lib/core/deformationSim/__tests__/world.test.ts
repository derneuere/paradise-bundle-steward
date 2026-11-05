import { describe, expect, it } from 'vitest';
import { sphereVsGround, sphereVsObstacle, sphereVsPlane, sphereVsPole } from '../world';

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
