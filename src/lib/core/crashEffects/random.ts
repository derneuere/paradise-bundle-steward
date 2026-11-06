// Seeded random numbers, so a crash replays with the same particles: the
// effects draw only from this stream and only on simulator steps.

export type Rng = {
	next(): number;                       // [0, 1)
	range(lo: number, hi: number): number; // [lo, hi)
};

export function makeRng(seed: number): Rng {
	let a = seed >>> 0;
	const next = () => {
		// mulberry32
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
	return { next, range: (lo, hi) => lo + (hi - lo) * next() };
}

// How far a particle has travelled per unit of launch velocity after `t`
// seconds when its velocity scale ramps linearly from `initial` to
// `terminal` over `duration` and then holds: the integral of that scale.
export function dragDistance(t: number, drag: { initial: number; terminal: number; duration: number }): number {
	const { initial, terminal, duration } = drag;
	if (duration <= 0) return t * terminal;
	const lo = Math.min(t, duration), hi = Math.max(t, duration);
	return lo * initial + hi * terminal + (lo * lo * (terminal - initial)) / (2 * duration) - duration * terminal;
}
