// Thin spec for the ICE take preview viewport (component itself needs WebGL, so
// per CLAUDE.md this is a single spec covering the exported pure helpers a
// future agent reads to learn the feature):
//
//   - resolveSelectedTake picks the right take from a dictionary entry index
//     and from ICE Data,
//   - composeCameraWorld performs the load-bearing car-space→world step: a
//     car-relative (SPACE = Car) eye lands at the car, while a world-space
//     (SPACE = World) eye is used verbatim.

import { describe, it, expect } from 'vitest';
import { resolveSelectedTake, composeCameraWorld } from '../IceTakePreviewViewport';
import { buildIceCameraTrack } from '@/lib/ice/iceTakeSampler';
import { DEFAULT_JUMP_ARC, carStateAt } from '@/lib/ice/iceJumpArc';
import type { IceTake, IceElementCount, IceElementRun } from '@/lib/core/iceVariableData';

// Element-description indices for the channel-0 camera path (mirrors the sampler).
const EL = {
	EYE_X: 0, EYE_Y: 1, EYE_Z: 2,
	LOOK_X: 3, LOOK_Y: 4, LOOK_Z: 5,
	LENS: 9,
	SPACE_EYE: 30, SPACE_LOOK: 31,
};

/**
 * Build a minimal single-interval (2-key) take whose channel-0 eye/look hold the
 * given constant values and whose SPACE tokens are set. Only the fields the
 * sampler reads are populated. `space` 0 = Car, 1 = World.
 */
function makeTake(opts: {
	eye: [number, number, number];
	look: [number, number, number];
	space: number;
}): IceTake {
	const counts: IceElementCount[] = Array.from({ length: 12 }, () => ({ intervals: 1, keys: 2 }));
	const runs: IceElementRun[] = [];
	const keyRun = (index: number, v: number): IceElementRun => ({
		index,
		isKey: true,
		values: [{ raw: 0, value: v }, { raw: 0, value: v }],
	});
	const intervalRun = (index: number, v: number): IceElementRun => ({
		index,
		isKey: false,
		values: [{ raw: 0, value: v }],
	});
	runs.push(keyRun(EL.EYE_X, opts.eye[0]), keyRun(EL.EYE_Y, opts.eye[1]), keyRun(EL.EYE_Z, opts.eye[2]));
	runs.push(keyRun(EL.LOOK_X, opts.look[0]), keyRun(EL.LOOK_Y, opts.look[1]), keyRun(EL.LOOK_Z, opts.look[2]));
	runs.push(keyRun(EL.LENS, 24));
	runs.push(intervalRun(EL.SPACE_EYE, opts.space), intervalRun(EL.SPACE_LOOK, opts.space));
	return {
		nodeBase: [0, 0],
		guid: 1,
		name: 'TEST_TAKE',
		nameBytes: new Uint8Array(32),
		lengthSeconds: 2,
		allocated: 0,
		elementCounts: counts,
		indices: [],
		parameters: [],
		alignPadBytes: 0,
		runs,
	};
}

describe('resolveSelectedTake', () => {
	it('reads the single take from ICE Data', () => {
		const take = makeTake({ eye: [1, 2, 3], look: [0, 0, 0], space: 0 });
		expect(resolveSelectedTake({ take }, [])).toBe(take);
	});

	it('reads the dictionary entry at the selected index, defaulting to 0', () => {
		const t0 = makeTake({ eye: [0, 0, 0], look: [0, 0, 0], space: 0 });
		const t1 = makeTake({ eye: [9, 9, 9], look: [0, 0, 0], space: 0 });
		const model = {
			kind: 'structured' as const,
			indexOffset: 16,
			entries: [
				{ key: 0n, userFlags: 0, take: t0 },
				{ key: 1n, userFlags: 0, take: t1 },
			],
		};
		expect(resolveSelectedTake(model, ['entries', 1])).toBe(t1);
		expect(resolveSelectedTake(model, [])).toBe(t0);
	});

	it('returns null for a heuristic-only dictionary', () => {
		expect(resolveSelectedTake({ takes: [], totalTakes: 0, is64Bit: false }, [])).toBeNull();
	});
});

describe('composeCameraWorld car-space→world step', () => {
	it('places a car-relative eye at the car position when the offset is zero', () => {
		// SPACE = Car (0), eye = (0,0,0) → world eye == car position at this t.
		const take = makeTake({ eye: [0, 0, 0], look: [0, 0, -1], space: 0 });
		const track = buildIceCameraTrack(take);
		const t01 = 0.4;
		const { eye } = composeCameraWorld(track, DEFAULT_JUMP_ARC, t01);
		const car = carStateAt(DEFAULT_JUMP_ARC, t01 * DEFAULT_JUMP_ARC.durationS).position;
		expect(eye.x).toBeCloseTo(car[0], 4);
		expect(eye.y).toBeCloseTo(car[1], 4);
		expect(eye.z).toBeCloseTo(car[2], 4);
	});

	it('uses a world-space eye verbatim (ignores the car frame)', () => {
		const worldEye: [number, number, number] = [100, 50, -200];
		const take = makeTake({ eye: worldEye, look: [0, 0, 0], space: 1 });
		const track = buildIceCameraTrack(take);
		const { eye } = composeCameraWorld(track, DEFAULT_JUMP_ARC, 0.5);
		expect(eye.x).toBeCloseTo(worldEye[0], 4);
		expect(eye.y).toBeCloseTo(worldEye[1], 4);
		expect(eye.z).toBeCloseTo(worldEye[2], 4);
	});

	it('a car-relative eye behind+above the car lands behind+above in world space', () => {
		// A LEVEL car (pitch 0) heading +X has forward ≈ +X, up ≈ +Y. The car frame
		// has +Z = forward, so a camera "behind and above" (car-space -Z behind,
		// +Y up) must read as a lower X (behind the nose) and a raised Y vs the car.
		// (A pitched-up nose tilts the car-frame up backward, which is correct but
		// muddies the axis test — the level case isolates the compose step.)
		const level = { ...DEFAULT_JUMP_ARC, launchPitchRad: 0 };
		const take = makeTake({ eye: [0, 4, -10], look: [0, 0, 0], space: 0 });
		const track = buildIceCameraTrack(take);
		const { eye } = composeCameraWorld(track, level, 0);
		const car = carStateAt(level, 0).position;
		expect(eye.x).toBeLessThan(car[0]);
		expect(eye.y).toBeGreaterThan(car[1]);
	});
});
