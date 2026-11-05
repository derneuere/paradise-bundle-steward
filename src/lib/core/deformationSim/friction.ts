// Slide friction: how a crashing car loses the speed it carries along the
// obstacle. Every world contact a crashing car slides through brakes the slide
// twice over, both against the contact point's slide direction:
// - an impulse of (contact impulse x min(slide speed, 1 m/s)) x 5 x dt, so a
//   hard contact grips harder (the impulse is multiplied by the step once
//   more, as the game does; it is not a typo for a force);
// - a force of 0.9 x slide speed x car mass, i.e. the slide decays at 0.9/s
//   per touching contact.
// A knock below crash speed slides freely (both rows are zero), and so does a
// slide slower than 1 cm/s. This is the only thing that stops a car scraping
// along a wall here: the editor has no ground, tyres or crash timer.
//
// What the editor leaves out: the impulse acts at the contact point in the
// game, so it also spins the car (the only term that turns a slide into a
// spin); the editor's car body only translates, so only the linear half is
// applied. Car-on-car contacts (20 x, scaled by the car's angular impulse
// attrib, and only when the other car is crashing too) and the aftertouch
// case (no friction while steering a crash outside Showtime) don't arise in
// a single-car preview.

import type { Vec3 } from '../deformationSpec';
import { dot, scale, sub, type SimState } from './state';
import { MIN_SLIDE_SQ } from './scratch';

export const WORLD_CRASH_IMPULSE_ROW = 5;
export const CRASH_FORCE_ROW = 0.9;

export type Slide = { slide: Vec3; speed: number };

// The contact point's velocity across the surface (`relVel` with its
// along-normal part removed).
export function slideAcross(relVel: Vec3, n: Vec3): Slide {
	const slide = sub(relVel, scale(n, dot(relVel, n)));
	return { slide, speed: Math.sqrt(dot(slide, slide)) };
}

// The car body's velocity change from one world contact's slide friction.
// `magnitude` is the contact's shaped impulse (N·s).
export function slideFriction(s: SimState, { slide, speed }: Slide, magnitude: number, dt: number): Vec3 {
	if (!s.crashing || speed * speed < MIN_SLIDE_SQ) return [0, 0, 0];
	const impulse = magnitude * Math.min(speed, 1) * WORLD_CRASH_IMPULSE_ROW * dt;
	const force = speed * s.attribs.mass * CRASH_FORCE_ROW;
	return scale(slide, -(impulse + force * dt) / (s.attribs.mass * speed));
}
