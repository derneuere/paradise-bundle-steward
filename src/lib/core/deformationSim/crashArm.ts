// Whether a world contact would make the game declare a crash. The game asks
// this before the car's own update, of up to five of the step's candidate
// contacts ordered by when they would close, and flips the car into crashing
// on the first one that qualifies:
// - head-on: the surface point lies across the front of the deformed box
//   (within its width, within 0.3 m of its front face), the surface faces
//   the car's nose closely enough (a cone that widens with forward speed),
//   and the car's own velocity closes on it at 40.5 m/s or more;
// - side-on: any other point above the centre of mass that the contact point
//   closes on at 50 m/s or more;
// - rolled: the car is more than 80° off upright and the surface faces up.
// The car's crash-speed attrib plays no part. Entering the crash is the
// vehicle's business; this only answers the question.

import type { Vec3 } from '../deformationSpec';
import { toBody, velocityAt } from '../vehicleSim/body';
import { add, dot, scale, sub, type SimState } from './state';
import type { PotentialContact } from './world';

export const HEAD_ON_WORLD_CRASH_SPEED = 40.5;
export const SIDE_ON_WORLD_CRASH_SPEED = 50.0;
const MAX_ORDERED = 5;
const FRONT_FACE_DEPTH = 0.3;
const HEAD_ON_COSINE_STOPPED = -0.7;
const HEAD_ON_COSINE_AT_SPEED = -0.53;
const HEAD_ON_SPEED_RANGE = 200;
const ROLLED_UP_COSINE = 0.173648178;   // cos 80°
const ROLLED_MIN_NORMAL_Y = 0.1;
const GROUND_NORMAL_UP_COSINE = 0.9;

export type WorldCrash = 'headOn' | 'sideOn' | 'rolled';

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

// `vulnerability` scales the closing speeds (1 normally; the game raises it
// for a while after a car-on-car hit).
export function classifyWorldCrash(s: SimState, c: PotentialContact, dt: number, vulnerability = 1): WorldCrash | null {
	const b = s.body;
	const pointVel = velocityAt(b, c.pA);
	if (dot(sub(add(c.pA, scale(pointVel, dt)), c.pB), c.n) > 0) return null;
	const local = toBody(b, c.pB);
	const forward = Math.min(Math.max(dot(b.v, b.axes[2]), 0), HEAD_ON_SPEED_RANGE);
	const cone = (forward / HEAD_ON_SPEED_RANGE) * (HEAD_ON_COSINE_AT_SPEED - HEAD_ON_COSINE_STOPPED) + HEAD_ON_COSINE_STOPPED;
	const headOnDir = cone > dot(c.n, b.axes[2]);
	// The deformed box, in the body frame.
	const min = sub(s.aabb.min, s.com), max = sub(s.aabb.max, s.com);
	const front = local[0] >= min[0] && max[0] >= local[0] && local[2] >= max[2] - FRONT_FACE_DEPTH;
	const closing = (v: Vec3) => -dot(c.n, v) * vulnerability;
	if (front && headOnDir && closing(b.v) >= HEAD_ON_WORLD_CRASH_SPEED) return 'headOn';
	if (!front && closing(pointVel) >= SIDE_ON_WORLD_CRASH_SPEED && local[1] > 0) return 'sideOn';
	if (ROLLED_UP_COSINE > b.axes[1][1] && c.n[1] > ROLLED_MIN_NORMAL_Y) return 'rolled';
	return null;
}

// The first crash the step's ordered contacts would trigger, if any.
export function predictWorldCrash(s: SimState, dt: number): { contact: PotentialContact; kind: WorldCrash } | null {
	for (const c of orderWorldContacts(s)) {
		const kind = classifyWorldCrash(s, c, dt);
		if (kind) return { contact: c, kind };
	}
	return null;
}
