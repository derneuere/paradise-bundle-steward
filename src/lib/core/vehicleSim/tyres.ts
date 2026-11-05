// Tyre forces. Each axle pair is solved together: the longitudinal force
// grows with slip ratio (wheel surface speed vs road speed) and the lateral
// force with sideways speed, each through a piecewise-linear grip curve, and
// both scale with the slip SPEED, not just the ratio, which makes the model
// stiff (keep dt at 1/60). A friction cone caps their sum; past it the tyre
// switches to dynamic friction and the force is re-aimed (with the lateral
// part trimmed by LongForceBias). The reaction spins the wheel back toward
// free rolling, never past it. The force reaches the body at the wheel's
// streamed x/z but at the bodyroll attribs' heights, which is what gives the
// car its pitch and roll feel.
//
// While crashing, an extra scrub drags each grounded tyre sideways with its
// full weight, at a lever dropped up to 3 m below the contact: the game's main
// lever for rolling a crashed car over.

import type { Vec3 } from '../deformationSpec';
import { add, cross, dot, length, normalize, scale, sub } from '../deformationSim/state';
import { addWorldForce, addWorldTorque, GRAVITY, toWorldDir, velocityAt } from './body';
import { surfaceGrip } from './ground';
import type { GripCurve } from './params';
import type { VehicleState, WheelState } from './vehicleState';

// |slip| ramps to the peak coefficient at peakSlip, blends to the fall
// coefficient at floorSlip, then stays; the sign follows the slip (0 -> +).
export function gripCurve(c: GripCurve, slip: number): number {
	const sign = slip >= 0 ? 1 : -1, a = Math.abs(slip);
	let co: number;
	if (a <= c.peakSlip) co = c.peakSlip !== 0 ? c.peakCo * (a / c.peakSlip) : c.peakCo;
	else if (a <= c.floorSlip) {
		const span = c.floorSlip - c.peakSlip;
		co = c.peakCo + (c.fallCo - c.peakCo) * (span !== 0 ? (a - c.peakSlip) / span : 0);
	} else co = c.fallCo;
	return sign * co;
}

// A friction torque changes the spin, but never carries it past the speed
// at which the tyre would roll freely on the road.
export function applyFrictionReaction(w: WheelState, radius: number, torque: number, roadLongSpeed: number, dt: number): void {
	const roll = radius !== 0 ? roadLongSpeed / radius : 0;
	let next = w.omega + torque * w.invInertia * dt;
	if ((w.omega - roll >= 0) !== (next - roll >= 0)) next = roll;
	w.omega = next;
}

type Solve = { lng: Vec3; lat: Vec3; vl: number; fl: number; ft: number; cone: boolean; enabled: boolean };

// One axle: `a`, `b` are wheel indices, `rollDir` the axle's heading (the
// steered direction for the fronts), `downForce` the aero load that widens
// the friction cone.
export function wheelPairFriction(v: VehicleState, a: number, b: number, rollDir: Vec3, downForce: number, mostWheelsHaveTraction: boolean, dt: number): void {
	const B = v.body, P = v.params;
	const solves: Solve[] = [a, b].map((i) => {
		const w = v.wheels[i], tyre = i < 2 ? P.front : P.rear, r = P.wheels[i].radius;
		const n = normalize(w.contact.normal);
		const lat = normalize(cross(n, rollDir)), lng = normalize(cross(lat, n));
		const vc = velocityAt(B, w.contact.pos);
		const vl = dot(vc, lng), vt = dot(vc, lat);
		const ws = w.omega * r;
		const slip = (ws - vl) / Math.max(Math.abs(vl), 1);
		const load = Math.max(w.massOnWheel * GRAVITY * w.contact.normal[1], 0);
		let fl = gripCurve(tyre.long, slip) * load * Math.abs(vl - ws);
		let ft = gripCurve(tyre.lat, -vt) * load * Math.abs(vt);
		const adhesive = tyre.adhesiveLimit * surfaceGrip(v, i);
		const co = w.broken ? tyre.dynamicFriction : tyre.staticFriction;
		const cap = Math.min(co * (load + downForce), adhesive);
		const capDynamic = Math.min(tyre.dynamicFriction * (load + downForce), adhesive);
		const cone = fl * fl + ft * ft > cap * cap;
		if (cone) {
			const f = scale(normalize(add(scale(lng, fl), scale(lat, ft * (1 - tyre.longForceBias)))), capDynamic);
			fl = dot(f, lng); ft = dot(f, lat);
		}
		const enabled = v.crashing ? w.hasTraction : mostWheelsHaveTraction && w.closeToGround && w.contact.normal[1] > 0.5;
		return enabled ? { lng, lat, vl, fl, ft, cone, enabled } : { lng, lat, vl: 0, fl: 0, ft: 0, cone: false, enabled };
	});
	[a, b].forEach((i, k) => {
		const s = solves[k], w = v.wheels[i];
		w.broken = s.cone;
		applyFrictionReaction(w, P.wheels[i].radius, -s.fl * P.wheels[i].radius, s.vl, dt);
	});
	[a, b].forEach((i, k) => {
		const s = solves[k];
		if (!s.enabled) return;
		const st = P.wheels[i].streamed;
		const pairs: [Vec3, Vec3][] = [
			[scale(s.lng, s.fl), [st[0], P.wheelLongForceHeight, st[2]]],
			[scale(s.lat, s.ft), [st[0], P.wheelLatForceHeight, st[2]]],
		];
		for (const [f, p] of pairs) {
			addWorldTorque(B, cross(toWorldDir(B, p), f));
			addWorldForce(B, f);
		}
	});
}

const SCRUB = { speedForMaxRoll: 30, maxHeightOffset: 3, latFriction: 0.95, linearMultiplier: 1 };

// The crashed car's sideways scrub at one wheel. A wheel off the road just
// spins down.
export function crashScrub(v: VehicleState, i: number): void {
	const w = v.wheels[i], B = v.body;
	if (!w.hasTraction || w.detached) { w.omega *= 0.95; return; }
	const n = w.contact.normal;
	const pv = velocityAt(B, w.contact.pos);
	const planar = sub(pv, scale(n, dot(pv, n)));
	if (!(dot(planar, planar) > 0.1)) return;
	const lat = normalize(cross(n, B.axes[2]));
	const fdir = scale(normalize(planar), -1);
	const s = Math.min(length(pv), SCRUB.speedForMaxRoll) / SCRUB.speedForMaxRoll;
	// The lever drops along world -Y, up to 3 m at 30 m/s.
	const lever: Vec3 = [w.contact.pos[0], w.contact.pos[1] - SCRUB.maxHeightOffset * s, w.contact.pos[2]];
	const f = scale(lat, dot(lat, fdir) * w.massOnWheel * GRAVITY * SCRUB.latFriction);
	addWorldTorque(B, cross(sub(lever, B.pos), f));
	addWorldForce(B, scale(f, SCRUB.linearMultiplier));
}
