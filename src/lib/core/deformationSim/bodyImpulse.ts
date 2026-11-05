// How the part of a world contact's impulse that the sensors did not absorb
// reaches the car body. The sensor chain hands over one body-axis impulse per
// crush direction (DIRECTIONS[d] x remainder); it acts at the contact point,
// so it turns the car as well as slowing it. Nothing reaches the velocity
// until the body is drained.
//
// - A crashing car takes it whole, with its full turning effect.
// - A car that is not crashing (a knock) takes a quarter of it. Unless the
//   surface faces mostly up (normal y >= 0.65), the impulse loses its body-up
//   part and the lever loses its body-up part and 30 % of its forward part, so
//   brushing a wall cannot lift, pitch or spin the car much.
//
// Either way the vehicle's world-collision count goes up and its time since
// the last wall contact restarts.

import type { Vec3 } from '../deformationSpec';
import { addImpulseAt, toBody, type RigidBody } from '../vehicleSim/body';
import { scale, type ContactCounters } from './state';

export const KNOCK_IMPULSE_SCALE = 0.25;
export const KNOCK_UPRIGHT_NORMAL_Y = 0.65;
export const KNOCK_LEVER_FORWARD_SCALE = 0.7;

// `jBody` is in body axes, `pA` the contact point (world), `n` the contact
// normal (world, out of the surface toward the car).
export function bankWorldImpulse(
	body: RigidBody, crashing: boolean, counters: ContactCounters, jBody: Vec3, pA: Vec3, n: Vec3,
): void {
	counters.numCollisions++;
	counters.numWorldCollisions++;
	counters.secondsSinceWallContact = 0;
	if (crashing) {
		addImpulseAt(body, jBody, 'body', pA, 'world');
		return;
	}
	const j = scale(jBody, KNOCK_IMPULSE_SCALE);
	const lever = toBody(body, pA);
	if (n[1] < KNOCK_UPRIGHT_NORMAL_Y) {
		j[1] = 0;
		lever[1] = 0;
		lever[2] *= KNOCK_LEVER_FORWARD_SCALE;
	}
	addImpulseAt(body, j, 'body', lever, 'body');
}
