// Pure-math coverage for the ballistic jump-arc model.
//
// These guard the load-bearing properties the preview composition relies on:
//   - position at t=0 is exactly the launch point,
//   - the arc is a symmetric parabola (apex at the midpoint of the airborne
//     phase; equal height at mirrored times),
//   - forward tracks the instantaneous velocity (rising then falling),
//   - the car world matrix round-trips a point and composes a car-relative
//     offset into the expected world-space quadrant (behind+above stays
//     behind+above) — this is exactly the car-space→world step the viewport
//     does for car-relative (SPACE_EYE = Car) takes.

import { describe, it, expect } from 'vitest';
import {
	carStateAt,
	carWorldMatrix,
	transformPointByMatrix,
	DEFAULT_JUMP_ARC,
	type JumpArcParams,
} from '../iceJumpArc';

const close = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

describe('carStateAt position', () => {
	it('is exactly the launch point at t=0', () => {
		const s = carStateAt(DEFAULT_JUMP_ARC, 0);
		expect(s.position).toEqual(DEFAULT_JUMP_ARC.launch);
	});

	it('traces a symmetric parabola — equal height at mirrored times about the apex', () => {
		// Apex time for vertical motion: v0y / g. With pitch p and speed v,
		// v0y = v*sin(p). Height at apex - dt equals height at apex + dt.
		const p = DEFAULT_JUMP_ARC;
		const v0y = p.speed * Math.sin(p.launchPitchRad);
		const apex = v0y / p.gravity;
		const dt = 0.3;
		const before = carStateAt(p, apex - dt).position[1];
		const after = carStateAt(p, apex + dt).position[1];
		expect(close(before, after, 1e-4)).toBe(true);
	});

	it('reaches its maximum height at the apex time', () => {
		const p = DEFAULT_JUMP_ARC;
		const v0y = p.speed * Math.sin(p.launchPitchRad);
		const apex = v0y / p.gravity;
		const yApex = carStateAt(p, apex).position[1];
		const yEarly = carStateAt(p, apex - 0.5).position[1];
		const yLate = carStateAt(p, apex + 0.5).position[1];
		expect(yApex).toBeGreaterThan(yEarly);
		expect(yApex).toBeGreaterThan(yLate);
	});

	it('advances along +X for a zero heading', () => {
		const p = DEFAULT_JUMP_ARC;
		const x0 = carStateAt(p, 0).position[0];
		const x1 = carStateAt(p, 1).position[0];
		expect(x1).toBeGreaterThan(x0);
	});
});

describe('carStateAt frame', () => {
	it('forward points up while rising and down while descending', () => {
		const p = DEFAULT_JUMP_ARC;
		const rising = carStateAt(p, 0).forward;
		// At launch (rising) the forward has positive Y.
		expect(rising[1]).toBeGreaterThan(0);
		// Late in the arc the car is descending → forward Y negative.
		const falling = carStateAt(p, p.durationS).forward;
		expect(falling[1]).toBeLessThan(0);
	});

	it('forward is the unit velocity direction', () => {
		const p = DEFAULT_JUMP_ARC;
		const t = 1.0;
		const f = carStateAt(p, t).forward;
		// |forward| == 1
		expect(close(Math.hypot(f[0], f[1], f[2]), 1, 1e-6)).toBe(true);
		// Direction matches v0 + g*t analytically.
		const dir = [
			Math.cos(p.headingRad) * Math.cos(p.launchPitchRad) * p.speed,
			Math.sin(p.launchPitchRad) * p.speed - p.gravity * t,
			Math.sin(p.headingRad) * Math.cos(p.launchPitchRad) * p.speed,
		];
		const len = Math.hypot(dir[0], dir[1], dir[2]);
		expect(close(f[0], dir[0] / len, 1e-6)).toBe(true);
		expect(close(f[1], dir[1] / len, 1e-6)).toBe(true);
		expect(close(f[2], dir[2] / len, 1e-6)).toBe(true);
	});

	it('frame is orthonormal (forward ⟂ up)', () => {
		const p = DEFAULT_JUMP_ARC;
		const { forward, up } = carStateAt(p, 0.7);
		const d = forward[0] * up[0] + forward[1] * up[1] + forward[2] * up[2];
		expect(close(d, 0, 1e-6)).toBe(true);
		expect(close(Math.hypot(up[0], up[1], up[2]), 1, 1e-6)).toBe(true);
	});
});

describe('carWorldMatrix + transformPointByMatrix', () => {
	it('round-trips the origin to the car position', () => {
		const state = carStateAt(DEFAULT_JUMP_ARC, 0.5);
		const m = carWorldMatrix(state);
		const world = transformPointByMatrix(m, [0, 0, 0]);
		expect(close(world[0], state.position[0])).toBe(true);
		expect(close(world[1], state.position[1])).toBe(true);
		expect(close(world[2], state.position[2])).toBe(true);
	});

	it('maps a behind+above car-relative point to behind+above in world space', () => {
		// A level car heading +X: forward ≈ +X, up ≈ +Y. The car frame has +Z =
		// forward, so a camera "behind and above" is car-relative -Z (behind) and
		// +Y (above) — matching how ICE chase takes author the eye. With this frame
		// the world point must sit behind the car along -X and higher than it.
		const level: JumpArcParams = { ...DEFAULT_JUMP_ARC, launchPitchRad: 0 };
		const state = carStateAt(level, 0); // forward = +X, up = +Y
		const m = carWorldMatrix(state);
		const behindAbove: [number, number, number] = [0, 3, -8]; // +Y above, -Z behind
		const world = transformPointByMatrix(m, behindAbove);
		// Behind: smaller X than the car (forward is +X). Above: larger Y.
		expect(world[0]).toBeLessThan(state.position[0]);
		expect(world[1]).toBeGreaterThan(state.position[1]);
	});

	it('preserves distances (the basis is orthonormal — no scaling)', () => {
		const state = carStateAt(DEFAULT_JUMP_ARC, 1.2);
		const m = carWorldMatrix(state);
		const a = transformPointByMatrix(m, [0, 0, 0]);
		const b = transformPointByMatrix(m, [3, 0, 0]);
		const dist = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
		expect(close(dist, 3, 1e-5)).toBe(true);
	});
});
