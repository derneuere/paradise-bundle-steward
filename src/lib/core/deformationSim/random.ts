// The crash's random draws (a wheel's twist limit, which panel a spinning
// wreck shakes loose). The game draws them from its global generator, whose
// state depends on everything that ran before, so its sequence can't be
// reproduced; the simulator uses its own seeded generator instead, restarted
// with every run, so the same hit always plays out the same way.

import type { SimState } from './state';

export const RANDOM_SEED = 0x5eed1234;

// One step of a 32-bit mixing generator (mulberry32): a uniform u32.
export function randomUInt(s: SimState): number {
	s.random = (s.random + 0x6d2b79f5) >>> 0;
	let t = s.random;
	t = Math.imul(t ^ (t >>> 15), t | 1);
	t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
	return (t ^ (t >>> 14)) >>> 0;
}

// Uniform in [0, 1).
export const randomFloat = (s: SimState): number => randomUInt(s) / 4294967296;
