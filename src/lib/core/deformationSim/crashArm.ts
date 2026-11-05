// Which of the step's candidate contacts the game's crash test looks at, and
// in what order. Before the car's own update it takes up to five of them,
// ordered by when each would close at the car's velocity, and asks the crash
// arm (vehicleSim/crash.ts worldCrashArm) of each in turn whether it crashes
// the car. The road under a driving car is in the list too, re-pointed to a
// hub's height along the car's up (validate.ts); while the car rises even
// slightly those contacts "close" at a large negative time, sort first and can
// take all five slots, so the obstacle is not looked at on that step. The game
// does the same.

import type { ArmContact } from '../vehicleSim/crash';
import { dot, scale, sub, type SimState } from './state';
import type { PotentialContact } from './world';

const MAX_ORDERED = 5;
const GROUND_NORMAL_UP_COSINE = 0.9;

// When the contact would close at the car's own velocity; a surface facing
// the car's up sorts a whole step later.
function predictedTime(s: SimState, c: PotentialContact): number {
	const t = dot(sub(c.pA, c.pB), c.n) / dot(s.body.v, scale(c.n, -1));
	return dot(c.n, s.body.axes[1]) > GROUND_NORMAL_UP_COSINE ? t + 1 : t;
}

// Up to five candidates, earliest first (a tie goes after the earlier
// entries; past five the latest drop out), without any that lie behind the
// surface of an earlier one.
export function orderWorldContacts(s: SimState, potential: PotentialContact[] = s.potential): PotentialContact[] {
	const entries: { c: PotentialContact; t: number }[] = [];
	for (const c of potential) {
		const t = predictedTime(s, c);
		let at = 0;
		while (at < entries.length && t >= entries[at].t) at++;
		if (at >= MAX_ORDERED) continue;
		entries.splice(at, 0, { c, t });
		if (entries.length > MAX_ORDERED) entries.pop();
	}
	const valid = entries.map(() => true);
	for (let i = 1; i < entries.length; i++) {
		for (let p = 0; p < i; p++) {
			if (valid[p] && 0 > dot(sub(entries[i].c.pB, entries[p].c.pB), entries[p].c.n)) { valid[i] = false; break; }
		}
	}
	return entries.filter((_, i) => valid[i]).map((e) => e.c);
}

const armContact = (c: PotentialContact): ArmContact => ({ pointA: c.pA, pointB: c.pB, normal: c.n, ground: c.surface === 'ground' });

// The ordered contacts in the shape the crash arm reads.
export const crashArmContacts = (s: SimState): ArmContact[] => orderWorldContacts(s).map(armContact);

// Every contact of the step in that shape (what a forced crash looks at).
export const allArmContacts = (s: SimState): ArmContact[] => s.potential.map(armContact);
