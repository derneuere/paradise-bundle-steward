// Which world contacts a car that is not crashing keeps, and how it bends the
// road ones. A driving car rides on its wheels; its body's collision spheres
// would otherwise scrape the road under it (and crush the sills) at every bump,
// so the game rewrites the road's contacts before anything uses them:
//
// 1. a near-horizontal normal (|y| < 0.5) is made exactly horizontal;
// 2. below 10 mph every contact is kept as it is;
// 3. a road point within the cull height of the wheels' road plane (or of the
//    ground straight below, when that faces the car's up) is re-pointed: its
//    normal becomes the car's up and its car point is moved down the up axis
//    onto the front-left hub's plane. Such a contact sits a hub's height above
//    the road, so it never closes and never pushes. The cull height is 0.4 m
//    from 25 mph, scaled down to 0 at 10 mph. A wall (a tall, upright face)
//    is never culled;
// 4. the contact survives if its world point lies in the car's deformable box
//    (grown by 0.1 m sideways and up/down and by this step's travel), or the
//    car is airborne, or slower than 25 mph forward; and
// 5. it must still lie within a band 0.2 m either side of the box, stretched
//    by the step's sideways travel.
//
// The game's box test compares local Y against all three lower bounds; that is
// reproduced. Where the step's sideways travel is exactly zero the game's band
// collapses to nothing (a case it practically never meets); the preview's car
// drives exactly straight, so there the band keeps its 0.2 m margins instead.
// A crashing car keeps every contact unchanged.

import type { Vec3 } from '../deformationSpec';
import { toBody, toBodyDir, toWorld } from '../vehicleSim/body';
import { MPS_TO_MPH, type VehicleState } from '../vehicleSim/vehicleState';
import { dot, normalize, scale, sub, type SimState } from './state';
import type { PotentialContact } from './world';

const WALL_NORMAL_FLATTEN_Y = 0.5;
const ACCEPT_ALL_BELOW_MPH = 10;
const FULL_CULL_MPH = 25;
const GROUND_CULL_HEIGHT = 0.4;
const GROUND_FACES_UP = 0.8;
const BOX_MARGIN_XY = 0.1;
const LATERAL_MARGIN = 0.2;
const KEEP_OUTSIDE_BOX_BELOW_MPH = 25;

// The preview's world has the ground plane, a curb in the game's sense (it is
// level with the road under the wheels), and upright obstacles, which are walls.
const isWall = (c: PotentialContact) => c.surface === 'obstacle';

export function cullHeight(mph: number): number {
	if (mph >= FULL_CULL_MPH) return GROUND_CULL_HEIGHT;
	return (GROUND_CULL_HEIGHT * (mph - ACCEPT_ALL_BELOW_MPH)) / (FULL_CULL_MPH - ACCEPT_ALL_BELOW_MPH);
}

// Edits `c` in place; returns whether the contact is kept.
export function validateWorldContact(v: VehicleState, c: PotentialContact, dt: number): boolean {
	if (Math.abs(c.n[1]) < WALL_NORMAL_FLATTEN_Y) c.n = normalize([c.n[0], 0, c.n[2]]);
	const b = v.body, up = b.axes[1];
	const mph = v.speedMag * MPS_TO_MPH;
	if (mph < ACCEPT_ALL_BELOW_MPH) return true;
	const h = cullHeight(mph);
	const wp = v.wheelPlane, ag = v.aboveGround;
	const nearWheels = wp.valid && wp.height + h > dot(sub(c.pB, wp.pos), up);
	const nearGround = dot(up, ag.normal) > GROUND_FACES_UP && h > dot(sub(c.pB, ag.pos), ag.normal);
	if ((nearWheels || nearGround) && !isWall(c)) {
		const plane = toWorld(b, v.params.wheels[0].streamed);
		c.n = [...up] as Vec3;
		c.pA = sub(c.pA, scale(up, dot(sub(c.pA, plane), up)));
	}
	return insideBox(v, c.pB, dt) || v.hasAir || KEEP_OUTSIDE_BOX_BELOW_MPH > v.speedMph
		? withinLateralBand(v, c.pB, dt)
		: false;
}

function insideBox(v: VehicleState, pB: Vec3, dt: number): boolean {
	const b = v.body, box = v.aabb;
	const [x, y, z] = toBody(b, pB);
	const d = toBodyDir(b, scale(b.v, dt)).map(Math.abs);
	return box.max[0] + BOX_MARGIN_XY + d[0] > x && y > box.min[0] - BOX_MARGIN_XY - d[0]
		&& box.max[1] + BOX_MARGIN_XY + d[1] > y && y > box.min[1] - BOX_MARGIN_XY - d[1]
		&& box.max[2] + d[2] > z && y > box.min[2] - d[2];
}

function withinLateralBand(v: VehicleState, pB: Vec3, dt: number): boolean {
	const b = v.body, box = v.aabb;
	const x = toBody(b, pB)[0];
	const dx = dot(scale(b.v, dt), b.axes[0]);
	const upper = box.max[0] + LATERAL_MARGIN + Math.max(dx, 0);
	const lower = box.min[0] - LATERAL_MARGIN + Math.min(dx, 0);
	return !(x > upper || lower > x);
}

// The step's candidates as a car that is not crashing keeps them.
export function validateWorldContacts(s: SimState, dt: number): void {
	if (s.vehicle.crashing) return;
	s.potential = s.potential.filter((c) => validateWorldContact(s.vehicle, c, dt));
}
