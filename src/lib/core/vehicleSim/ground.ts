// How the car finds the road. Each wheel casts a "traction line" down its
// body's up axis from just above the hub; the nearest one-sided hit becomes
// the wheel's road contact, and the hub's reach to it decides whether the
// wheel is on the ground. A separate long ray straight down from the centre of
// mass (the above-ground test) feeds the landing and in-air rules.
//
// The world is anything that can answer those two queries. `flatGround` is the
// Crash Preview's plane: y = h, normal up, a plain road surface.

import type { Vec3 } from '../deformationSpec';
import { add, dot, length, scale, sub } from '../deformationSim/state';
import { toWorld } from './body';
import { DEFAULT_SURFACE, type Surface, type VehicleState } from './vehicleState';

export type LineHit = { pos: Vec3; normal: Vec3; surface: Surface };

export interface World {
	// Nearest hit on the segment start -> end of a surface facing against the
	// segment (back faces are ignored), or null.
	lineTest(start: Vec3, end: Vec3): LineHit | null;
	// The ground straight below `pos` (world -Y ray), or null.
	aboveGround(pos: Vec3): LineHit | null;
}

export function flatGround(height = 0, surface: Surface = DEFAULT_SURFACE): World {
	const normal: Vec3 = [0, 1, 0];
	return {
		lineTest(start, end) {
			const a = start[1] - height, b = end[1] - height;
			if (!(a >= 0 && b < 0)) return null;
			const t = a / (a - b);
			return { pos: add(start, scale(sub(end, start), t)), normal, surface };
		},
		aboveGround(pos) {
			return pos[1] >= height ? { pos: [pos[0], height, pos[2]], normal, surface } : null;
		},
	};
}

const LINE_START_LIFT = 0.4;
const LINE_EXTRA_LENGTH = 1.0;

// The wheel's line: from 0.4 m above the hub down past full droop plus the
// tyre and the attrib slack, along the body's up axis.
export function tractionLine(v: VehicleState, i: number): { start: Vec3; end: Vec3 } {
	const w = v.wheels[i], p = v.params.wheels[i], up = v.body.axes[1];
	const hub = toWorld(v.body, w.pos);
	const len = (w.pos[1] - p.yMin + p.radius) + v.params.base.tractionLineLength + LINE_EXTRA_LENGTH;
	return { start: add(hub, scale(up, LINE_START_LIFT)), end: sub(hub, scale(up, len)) };
}

export function castTractionLines(v: VehicleState, world: World, lift: Vec3 = [0, 0, 0]): (LineHit | null)[] {
	return v.wheels.map((_, i) => {
		const { start, end } = tractionLine(v, i);
		return world.lineTest(add(start, lift), end);
	});
}

// Start of the vehicle update: last step's flags become history; the contact
// position and normal stay (stale) for wheels that find nothing this step.
export function resetWheelFlags(v: VehicleState): void {
	for (const w of v.wheels) {
		w.wasOnGround = w.onGround;
		w.onGround = w.closeToGround = w.lineValid = w.hasTraction = false;
	}
	v.aboveGround = { valid: false, pos: [0, 0, 0], normal: [0, 0, 0], verticalDistance: 0, surface: DEFAULT_SURFACE };
}

const BEACHED_TIME = 0.5;

// A beached car (see updateBeachedTime) treats a wheel close to the road as on
// it, so a car left hanging a wheel against a wall can drive off.
export function addTractionPoint(v: VehicleState, i: number, hit: LineHit): void {
	setRoadContact(v, i, hit);
	const w = v.wheels[i];
	if (v.beachedTime >= BEACHED_TIME && w.closeToGround) w.onGround = true;
}

// The hub reaches the road when the line hit is closer than full droop plus
// the tyre radius; "close" allows the attrib slack on top.
function setRoadContact(v: VehicleState, i: number, hit: LineHit): void {
	const w = v.wheels[i], p = v.params.wheels[i];
	if (w.detached) return;
	const lineDist = length(sub(toWorld(v.body, w.pos), hit.pos));
	const reach = w.pos[1] - p.yMin + p.radius;
	w.onGround = reach > lineDist;
	w.closeToGround = reach + v.params.base.tractionLineLength > lineDist;
	w.lineValid = true;
	w.contact = { pos: hit.pos, normal: hit.normal, lineDist, surface: hit.surface };
	w.hasTraction = w.onGround && hit.normal[1] > 0.5;
}

export function setAboveGround(v: VehicleState, hit: LineHit | null): void {
	if (!hit) return;
	v.aboveGround = { valid: true, pos: hit.pos, normal: hit.normal, verticalDistance: v.body.pos[1] - hit.pos[1], surface: hit.surface };
}

// The lowest wheel's road point and how far the lowest airborne tyre hangs
// above its last contact (0 once any wheel is down). The contact side uses it
// to tell ground hits from wall hits.
export function calculateWheelPlane(v: VehicleState): void {
	let best = 1000, bestPos: Vec3 = [0, 0, 0], any = false;
	const up = v.body.axes[1];
	for (let i = 0; i < 4; i++) {
		const w = v.wheels[i];
		if (w.detached) { v.wheelPlane = { ...v.wheelPlane, valid: false }; return; }
		if (!w.lineValid) continue;
		any = true;
		if (w.onGround) { best = 0; bestPos = w.contact.pos; continue; }
		const bottom = toWorld(v.body, [w.pos[0], w.pos[1] - v.params.wheels[i].radius, w.pos[2]]);
		const h = dot(sub(bottom, w.contact.pos), up);
		if (!(h > best)) { best = h; bestPos = w.contact.pos; }
	}
	v.wheelPlane = { valid: any, pos: bestPos, height: Math.max(best, 0) };
}

// The game's surface grip blend: a corner keeps part of its grip on any
// surface, by the front/rear surface factor.
export function surfaceGrip(v: VehicleState, i: number): number {
	const f = i < 2 ? v.params.base.surfaceFrontGrip : v.params.base.surfaceRearGrip;
	return 1 - (1 - v.wheels[i].contact.surface.grip) * f;
}
