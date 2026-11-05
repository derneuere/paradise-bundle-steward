// Paint scratches. Every contact that slides across the obstacle scratches
// the sensor it touched: the faster the slide (the contact point's velocity
// with its along-normal part removed) and the harder the contact, the more.
// A sensor's scratch only grows, and saturates at 0.75 (a value already past
// that, which only the game's debug tools set, is kept but not grown). Tag
// points blend their two sensors' scratch with the tag's scalar weights,
// driven points blend their two tags' by where they sit between them, and the
// skin rows carry the result in w, where the damaged vehicle shaders turn it
// into bare-metal scratches through the car's scratch map.

import type { Vec3 } from '../deformationSpec';
import { dot, scale, sub, type SimState } from './state';

// Below this squared slide speed (m²/s²) a contact leaves no scratch.
export const MIN_SLIDE_SQ = 1e-4;
export const SCRATCH_RATE = 1.5e-4;
// Contact impulses above this (N·s) scratch no faster.
export const SCRATCH_IMPULSE_CAP = 1000;
// A crashing car scratches five times as fast as one scraping by.
export const CRASH_SCRATCH_SCALE = 5;
export const MAX_SCRATCH = 0.75;

// Adds one contact's scratch to its sensor; returns how much it added.
// `relVel` is the contact point's velocity against the obstacle, `n` the
// contact normal, `magnitude` the contact's shaped impulse.
export function scratchSensor(s: SimState, sensor: number, relVel: Vec3, n: Vec3, magnitude: number, dt: number): number {
	const slide = sub(relVel, scale(n, dot(relVel, n)));
	const slideSq = dot(slide, slide);
	if (slideSq < MIN_SLIDE_SQ) return 0;
	const speed = Math.sqrt(slideSq);
	const felt = magnitude * Math.min(speed, 1);
	let add = speed * dt * SCRATCH_RATE * Math.min(felt, SCRATCH_IMPULSE_CAP);
	if (s.crashing) add *= CRASH_SCRATCH_SCALE;
	const before = s.scratch[sensor];
	s.scratch[sensor] = Math.min(Math.max(0, before + add), Math.max(MAX_SCRATCH, before));
	return s.scratch[sensor] - before;
}

export function tagScratch(s: SimState, i: number): number {
	const t = s.spec.tagPoints[i];
	if (!t) return 0;
	return (s.scratch[t.deformationSensorA] ?? 0) * t.fWeightA + (s.scratch[t.deformationSensorB] ?? 0) * t.fWeightB;
}

export function drivenScratch(s: SimState, i: number): number {
	const d = s.spec.drivenPoints[i];
	const span = d.distanceFromA + d.distanceFromB;
	const t = span > 0 ? d.distanceFromA / span : 0.5;
	return (1 - t) * tagScratch(s, d.tagPointIndexA) + t * tagScratch(s, d.tagPointIndexB);
}
