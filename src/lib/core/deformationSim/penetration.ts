// Penetration correction, run once the step's pose has been integrated. It
// moves the car's position only: velocity and rotation are left alone, so
// pushing the car out of a wall never adds speed.
//
// The contacts are the ones each sensor stored when they were generated (up
// to three per sensor, with their world points and normals fixed then). The
// car end of each is re-anchored on the sensor's current centre, so a sensor
// that dented this step asks for less push-out. Before solving, a sensor
// drops a stored contact that another of its contacts already covers (the
// test is the game's own and deliberately lopsided). The solve then walks the
// contacts twice, sensor by sensor, each time pushing the car out along the
// normal by the full remaining depth.

import type { Vec3 } from '../deformationSpec';
import { toWorld, translate } from '../vehicleSim/body';
import { sensorLocal } from './contacts';
import { add, dot, scale, sub, type SimState, type StoredContact } from './state';

export const PENETRATION_PASSES = 2;

// Indices into `store` that survive the cull, in the order they are solved.
// The game keeps the world points and the surviving indices in two arrays and
// writes some swaps through a contact index rather than a list position; that
// is reproduced as is.
export function cullStoredContacts(store: StoredContact[]): number[] {
	let count = store.length;
	const points: Vec3[] = store.map((c) => c.B);
	const index = store.map((_, i) => i);
	for (let li = 0; li < count; li++) {
		const ci = index[li];
		const pi = points[ci], di = store[ci].projDist;
		for (let lj = li + 1; lj < count; lj++) {
			const cj = index[lj];
			const diff = sub(pi, points[cj]);
			if (!(store[cj].projDist < di)) {
				if (dot(diff, store[ci].n) >= 0) {
					points[cj] = points[count - 1];
					index[cj] = index[count - 1];
					count--;
					lj--;
				}
			} else if (dot(diff, store[cj].n) < 0) {
				points[li] = points[count - 1];
				index[li] = index[count - 1];
				count--;
				li--;
				break;
			}
		}
	}
	return index.slice(0, count);
}

export function penetrationContacts(s: SimState): { A: Vec3; B: Vec3; n: Vec3 }[] {
	const out: { A: Vec3; B: Vec3; n: Vec3 }[] = [];
	s.stored.forEach((store, sensor) => {
		const centre = sensorLocal(s, sensor);
		for (const k of cullStoredContacts(store)) {
			const c = store[k];
			out.push({ A: add(c.localA, centre), B: c.B, n: c.n });
		}
	});
	return out;
}

export function solvePenetration(s: SimState): void {
	const contacts = penetrationContacts(s);
	for (let pass = 0; pass < PENETRATION_PASSES; pass++) {
		for (const c of contacts) {
			const depth = Math.max(dot(sub(c.B, toWorld(s.body, c.A)), c.n), 0);
			if (depth > 0) translate(s.body, scale(c.n, depth));
		}
	}
}
