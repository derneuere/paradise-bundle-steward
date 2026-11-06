import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../../deformationSpec';
import { cross, dot, length } from '../../deformationSim/state';
import {
	addImpulseAt, boxInvInertia, createBody, dampPitchYawRoll, drain, GRAVITY, integrate, invEffectiveMass,
	mulMat, orthonormalize, toBody, toWorld, velocityAt,
} from '../body';

const close = (a: Vec3, b: Vec3, d = 9) => a.forEach((x, i) => expect(x).toBeCloseTo(b[i], d));

describe('rigid body', () => {
	it('builds the solid-box inverse inertia over the handling half extents', () => {
		const inv = boxInvInertia([1.05081, 0.57608, 2.41295], 1589);
		expect(inv[0]).toBeCloseTo(3.0678e-4, 8);
		expect(inv[1]).toBeCloseTo(2.7257e-4, 8);
		expect(inv[2]).toBeCloseTo(1.3147e-3, 7);
	});

	it('drains an impulse at an offset into dv = j/m and dw = I⁻¹(r×j), then clears it', () => {
		const b = createBody(1500, [1, 0.5, 2]);
		const r: Vec3 = [0, 0.2, 2], j: Vec3 = [0, 0, -1000];
		addImpulseAt(b, j, 'world', r, 'world');
		drain(b, 1 / 60);
		close(b.v, [0, 0, -1000 / 1500]);
		close(b.w, mulMat(b.invIWorld, cross(r, j)));
		close(b.J, [0, 0, 0]);
		close(b.L, [0, 0, 0]);
	});

	it('the effective mass along n is the mass when the arm is parallel to n', () => {
		const b = createBody(1500, [1, 0.5, 2]);
		expect(invEffectiveMass(b, [0, 0, 2], [0, 0, -1])).toBeCloseTo(1 / 1500, 12);
		const r: Vec3 = [0, 0.2, 2];
		expect(invEffectiveMass(b, r, [0, 0, -1])).toBeCloseTo(1 / 1500 + b.invILocal[0] * 0.04, 12);
	});

	it('keeps the axes orthonormal through many random spins', () => {
		const b = createBody(1500, [1, 0.5, 2]);
		let seed = 7;
		const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
		for (let i = 0; i < 10000; i++) {
			b.w = [rnd() * 20, rnd() * 20, rnd() * 20];
			integrate(b, 1 / 60);
		}
		const [r, u, a] = b.axes;
		[r, u, a].forEach((x) => expect(length(x)).toBeCloseTo(1, 6));
		expect(Math.max(Math.abs(dot(r, u)), Math.abs(dot(u, a)), Math.abs(dot(a, r)))).toBeLessThan(1e-5);
		close(cross(r, u), a, 5);
	});

	it('falls semi-implicitly: velocity first, then position', () => {
		const b = createBody(1500, [1, 0.5, 2], [0, 10, 0]);
		for (let i = 1; i <= 30; i++) integrate(b, 1 / 60);
		const g = GRAVITY / 3600;
		expect(b.v[1]).toBeCloseTo(-30 * GRAVITY / 60, 9);
		expect(b.pos[1]).toBeCloseTo(10 - g * (30 * 31) / 2, 9);
	});

	it('maps between body and world, and reads point velocity', () => {
		const b = createBody(1500, [1, 0.5, 2], [1, 2, 3]);
		b.axes = [[0, 0, -1], [0, 1, 0], [1, 0, 0]];
		close(toWorld(b, [0, 0, 1]), [2, 2, 3]);
		close(toBody(b, [2, 2, 3]), [0, 0, 1]);
		b.w = [0, 1, 0];
		close(velocityAt(b, [2, 2, 3]), [0, 0, -1]);
	});

	it('orthonormalize rebuilds a sheared basis around the squarest row', () => {
		const out = orthonormalize([[1, 0.01, 0], [0, 1, 0], [0, 0, 2]]);
		out.forEach((x) => expect(length(x)).toBeCloseTo(1, 9));
		expect(Math.abs(dot(out[0], out[1]))).toBeLessThan(1e-9);
	});

	it('orthonormalize never pivots on a zero-length row', () => {
		// Row 1 is dead: the engine pivots on row 2 whatever the dot products say.
		const out = orthonormalize([[1, 0, 0], [0, 0, 0], [0.6, 0, 0.8]]);
		close(out[2], [0.6, 0, 0.8]);
		close(out[1], [0, 1, 0]);
		close(out[0], [0.8, 0, -0.6]);
	});

	it('dampPitchYawRoll removes the whole component at k=1 and nothing at k=0', () => {
		const b = createBody(1500, [1, 0.5, 2]);
		b.w = [1, 2, 3];
		dampPitchYawRoll(b, 0, 1, 0, 1 / 60);
		close(b.w, [1, 0, 3]);
	});
});
