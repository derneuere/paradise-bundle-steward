// The loose bodies a crash sheds: knocked-off panels (a box at the panel's
// centre of mass) and wheels (a tube about the axle). Both start with the
// car's motion and then fly, bounce and come to rest on their own
// (looseBody.ts). A loose body stays until the car is reset.
//
// Panels: 100 kg, restitution 0.05, grip 0.6 static / 0.4 sliding, at most
// 30 m/s and 30 rad/s, drag 0.005 per step. A box with a side 0.15 m or less
// thick makes its contacts 0.5 m ahead (so a flat panel cannot slip through
// the road between steps), a thicker one as far ahead as its thinnest half.
// Wheels: 10 kg, a tube whose inner radius is 0.98 of the outer, restitution
// 0.2, grip 0.8, at most 60 m/s and 10 rad/s, drag 0.001 per step.

import type { Vec3 } from '../deformationSpec';
import { add, cross, type FreePart, type LooseBody, type LooseBodyProps, type LooseWheel, type SimState } from './state';
import { stepLooseBody, worldSurfaces } from './looseBody';
import { mul3 } from './rotation';
import { boxCorners, partInertia, PART_MASS, type PartBox } from './partBox';
import { GROUND_Y } from './world';

const PART_PROPS: LooseBodyProps = {
	restitution: 0.05, staticFriction: 0.6, dynamicFriction: 0.4, maxSpeed: 30, maxSpin: 30, drag: 0.005, limitVelocities: true,
};
const WHEEL_PROPS: LooseBodyProps = {
	restitution: 0.2, staticFriction: 0.8, dynamicFriction: 0.8, maxSpeed: 60, maxSpin: 10, drag: 0.001, limitVelocities: false,
};
const THIN_BOX = 0.15;
const MAX_PAD = 0.5;
const WHEEL_MASS = 10;
const WHEEL_INNER_RADIUS = 0.98;
const WHEEL_RIM_POINTS = 12;
// A wheel's contacts reach out 0.1 m plus one step of its travel.
const WHEEL_PAD = 0.1;

const fresh = (pos: Vec3, rotation: number[], vel: Vec3, spin: Vec3) => ({
	pos: [...pos] as Vec3, rotation: [...rotation], vel: [...vel] as Vec3, spin: [...spin] as Vec3,
	sleepEnergy: Infinity, sleepSteps: 0, frozen: false,
});

// `rotation` takes the mesh frame to the world; `pos` is where the box's
// centre is in the world.
export function makeFreePart(box: PartBox, rotation: number[], pos: Vec3, vel: Vec3, spin: Vec3): FreePart {
	const thinnest = Math.min(...box.half);
	return {
		...fresh(pos, rotation, vel, spin),
		origin: [...box.centre] as Vec3,
		invMass: 1 / PART_MASS,
		...partInertia(box),
		points: boxCorners(box),
		pad: thinnest > THIN_BOX ? Math.min(thinnest, MAX_PAD) : MAX_PAD,
		props: PART_PROPS,
	};
}

// A wheel about its body x axis (the car's axle when it came off).
export function makeLooseWheel(wheel: number, radius: number, halfWidth: number, rotation: number[], pos: Vec3, vel: Vec3, spin: Vec3): LooseWheel {
	const rr = radius * radius + (WHEEL_INNER_RADIUS * radius) ** 2;
	const axial = 0.5 * WHEEL_MASS * rr;
	const across = (WHEEL_MASS / 12) * (2 * halfWidth) ** 2 + (WHEEL_MASS / 4) * rr;
	const points: Vec3[] = [];
	for (const side of [-1, 1]) {
		for (let k = 0; k < WHEEL_RIM_POINTS; k++) {
			const a = (2 * Math.PI * k) / WHEEL_RIM_POINTS;
			points.push([side * halfWidth, radius * Math.cos(a), radius * Math.sin(a)]);
		}
	}
	return {
		...fresh(pos, rotation, vel, spin),
		wheel, radius, halfWidth,
		invMass: 1 / WHEEL_MASS,
		invInertia: [1 / axial, 0, 0, 0, 1 / across, 0, 0, 0, 1 / across],
		inertiaRatio: Math.max(axial, across) / WHEEL_MASS,
		points,
		pad: WHEEL_PAD,
		props: WHEEL_PROPS,
	};
}

export function updateFreeParts(s: SimState, dt: number, groundY = GROUND_Y): void {
	const surfaces = worldSurfaces(s.obstacle, groundY);
	for (const f of s.free.values()) stepLooseBody(f, surfaces, dt);
	for (const w of s.looseWheels) {
		w.pad = WHEEL_PAD + Math.hypot(...w.vel) * dt;
		stepLooseBody(w, surfaces, dt);
	}
}

// How far a loose body's lowest contact point is above the ground.
export function lowestGap(b: LooseBody, groundY = GROUND_Y): number {
	return Math.min(...b.points.map((p) => b.pos[1] + mul3(b.rotation, p)[1] - groundY));
}

// The velocity a part leaves the car with when it comes off: the car's own
// plus its spin across the part's arm. The arm is taken in the car's own axes
// and not turned into the world first, a quirk of the game's launch that a
// spinning, tilted car shows.
export const launchVelocity = (carVel: Vec3, carSpin: Vec3, armCarAxes: Vec3): Vec3 => add(carVel, cross(carSpin, armCarAxes));
