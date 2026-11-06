// Slide friction: how a crashing car loses the speed it carries along a
// surface. Every world contact a crashing car slides through brakes the slide
// at the contact point twice over, both against the point's slide direction:
// - an impulse of (contact impulse x min(slide speed, 1 m/s)) x 5 x dt, so a
//   hard contact grips harder (the impulse is multiplied by the step once
//   more, as the game does; it is not a typo for a force);
// - a force of 0.9 x slide speed x car mass, i.e. the slide decays at 0.9/s
//   per touching contact.
// Both act at the contact point, so a car scraping along a wall is turned as
// well as slowed. They reach the velocity when the body is next drained,
// which the contact loop does after every contact, so the next contact
// already slides slower.
//
// A knock below crash speed slides freely (both rows are zero), and so does a
// slide slower than 1 cm/s; the slide still scratches the paint either way.
// Car-on-car contacts (20 x, scaled by the car's angular impulse attrib, and
// only when the other car is crashing too) and the aftertouch case (no
// friction while steering a crash outside Showtime) don't arise in a
// single-car preview.

import type { Vec3 } from '../deformationSpec';
import { addForceAt, addImpulseAt, type RigidBody } from '../vehicleSim/body';
import { dot, scale, sub, type SimState } from './state';
import { MIN_SLIDE_SQ, scratchSensor } from './scratch';

export const WORLD_CRASH_IMPULSE_ROW = 5;
export const CRASH_FORCE_ROW = 0.9;

export type Slide = { slide: Vec3; speed: number };

// The contact point's velocity across the surface (`relVel` with its
// along-normal part removed).
export function slideAcross(relVel: Vec3, n: Vec3): Slide {
	const slide = sub(relVel, scale(n, dot(relVel, n)));
	return { slide, speed: Math.sqrt(dot(slide, slide)) };
}

// One world contact's friction and scratch. `relVel` is the contact point's
// live velocity (the one its impulse was sized from), `magnitude` the
// contact's shaped impulse, `pA` the contact point (world). Returns the slide
// and the scratch it added to the sensor.
export function applyContactFriction(
	s: SimState, body: RigidBody, sensor: number, relVel: Vec3, n: Vec3, magnitude: number, pA: Vec3, dt: number,
): { slide: Vec3; scratch: number } {
	const { slide, speed } = slideAcross(relVel, n);
	if (speed * speed < MIN_SLIDE_SQ) return { slide, scratch: 0 };
	if (s.vehicle.crashing) {
		const against = scale(slide, -1 / speed);
		const felt = magnitude * Math.min(speed, 1);
		addImpulseAt(body, scale(against, felt * WORLD_CRASH_IMPULSE_ROW * dt), 'world', pA, 'world');
		addForceAt(body, scale(against, speed * body.mass * CRASH_FORCE_ROW), 'world', pA, 'world');
	}
	return { slide, scratch: scratchSensor(s, sensor, relVel, n, magnitude, dt) };
}
