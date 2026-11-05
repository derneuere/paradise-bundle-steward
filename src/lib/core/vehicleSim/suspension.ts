// Suspension. Each corner is a 1-D spring-damper whose position is the hub's
// travel. A grounded hub is put back onto the road at tyre-radius distance
// every step; its spring then pushes the body along the body's up axis at the
// hub (only ever pushing, never pulling). An airborne hub droops on its own
// light spring. There is no anti-roll bar and, as shipped, no load transfer:
// each grounded tyre always carries mass * its static share.
//
// After the body moves (post-simulation) the hubs are re-seated, a bottomed
// spring lifts the body out of the road, a hard landing damps pitch, roll and
// vertical speed for a moment, and a compressed grounded corner takes a
// partial bounce impulse.

import { add, cross, dot, length, scale, sub } from '../deformationSim/state';
import {
	addForceAt, addImpulseAt, dampPitchYawRoll, drain, GRAVITY, invEffectiveMass, toWorld, velocityAt,
} from './body';
import { UNSPRUNG_MASS, type VehicleState } from './vehicleState';

export function updateSuspension(v: VehicleState, dt: number): void {
	v.timeSinceHardLanding += dt;
	applyWheelWeight(v);
	updateSprings(v, dt);
	// The game measures load transfer from the change in body velocity, but it
	// snapshots the velocity just before measuring, so the transfer is always 0.
	for (let i = 0; i < 4; i++) {
		if (v.wheels[i].onGround) v.wheels[i].massOnWheel = v.params.mass * v.params.wheels[i].scaler;
	}
	applySuspensionForces(v, dt);
}

// Seat each grounded hub at one tyre radius above its road contact.
function applyWheelWeight(v: VehicleState): void {
	const up = v.body.axes[1];
	v.wheels.forEach((w, i) => {
		if (!w.onGround) return;
		const gap = dot(up, sub(toWorld(v.body, w.pos), w.contact.pos));
		w.pos[1] = Math.max(w.pos[1] + (v.params.wheels[i].radius - gap), v.params.wheels[i].yMin);
	});
}

function updateSprings(v: VehicleState, dt: number): void {
	const P = v.params, M = P.mass, rest = P.susp.restDisp;
	let groundedShare = 0, airborneMass = 0;
	v.wheels.forEach((w, i) => {
		if (w.detached || w.onGround) groundedShare += P.wheels[i].scaler;
		else airborneMass += M * P.wheels[i].scaler;
	});
	const invShare = 1 / groundedShare;
	v.wheels.forEach((w, i) => {
		if (w.detached) return;
		const s = w.spring, share = P.wheels[i].scaler;
		s.k = (M * share * GRAVITY) / rest;
		if (w.onGround) {
			// Airborne corners' weight is spread over the grounded ones.
			s.m = invShare * (airborneMass * share) + M * share;
			s.c = P.susp.dampening;
			const arm = sub(toWorld(v.body, w.pos), v.body.pos);
			s.vel = dot(add(v.body.v, cross(v.body.w, arm)), w.contact.normal);
			s.pos = -((w.pos[1] - P.wheels[i].streamed[1]) + rest);
		} else {
			s.m = UNSPRUNG_MASS;
			s.c = P.susp.inAirDamping;
		}
		const fd = -s.vel * s.c * s.m, fs = -s.k * s.pos;
		s.acc = (fd + fs + s.ext) / s.m;
		s.vel += s.acc * dt;
		s.pos += s.vel * dt;
		s.ext = 0;
	});
	v.wheels.forEach((w, i) => {
		if (w.detached || w.onGround) return;
		const p = P.wheels[i];
		const y = Math.min(Math.max(p.streamed[1] - rest + w.spring.pos, p.yMin), p.yMax);
		w.pos[1] = y;
		w.spring.pos = y + rest - p.streamed[1];
	});
}

function applySuspensionForces(v: VehicleState, dt: number): void {
	const up = v.body.axes[1];
	for (const w of v.wheels) {
		if (!w.hasTraction || w.detached) continue;
		const f = w.spring.m * w.spring.acc;
		if (f <= 0) continue;
		addForceAt(v.body, scale(up, f / length(up)), 'world', w.pos, 'body');
	}
	drain(v.body, dt);
}

// Ground distance under which a car counts as down: half a metre, plus the
// body's height when it is upside down.
export const groundDistanceCheck = (v: VehicleState) =>
	(0 > v.body.axes[1][1] ? v.params.halfExtent[1] * 2 : 0) + 0.5;

const LANDING_RESTITUTION = -0.7;

export function postSimSuspension(v: VehicleState, dt: number): void {
	if (v.frozen) return;
	const b = v.body, P = v.params, up = b.axes[1];
	// Re-seat hubs the body's motion pushed into the road.
	v.wheels.forEach((w, i) => {
		if (!w.onGround || w.detached) return;
		const p = P.wheels[i], n = w.contact.normal;
		const hub = toWorld(b, w.pos);
		const t = (dot(n, w.contact.pos) - dot(n, hub)) / dot(n, scale(n, -1));
		if ((w.pos[1] - p.yMin + p.radius) >= t && dot(up, n) > 0.5) {
			const d = dot(up, sub(sub(hub, scale(n, t)), sub(hub, scale(n, p.radius))));
			if (d > 0) w.pos[1] = Math.max(w.pos[1] + d, p.yMin);
		}
	});
	// Bump stop: a hub past full bump lifts the body (position only).
	const compressed = [false, false, false, false];
	let maxPen = 0, nMax = [0, 0, 0] as typeof up;
	v.wheels.forEach((w, i) => {
		if (!w.onGround || w.detached) return;
		const disp = w.pos[1] - P.wheels[i].streamed[1];
		if (disp >= P.susp.upward) {
			compressed[i] = true;
			if (disp - P.susp.upward > maxPen) { maxPen = disp - P.susp.upward; nMax = w.contact.normal; }
		}
	});
	if (maxPen > 0) {
		const s = dot(scale(up, maxPen), nMax);
		b.pos = add(b.pos, scale(nMax, s));
		v.wheels.forEach((w, i) => {
			if (w.onGround && !w.detached) w.pos[1] = Math.max(w.pos[1] - s, P.wheels[i].yMin);
		});
	}
	if (v.hasAir && v.timeWithoutTraction > 0.5 && !v.crashing) {
		let hard = v.wheels.some((w) => w.onGround);
		if (!hard && v.numWorldCollisions > 0 && v.aboveGround.valid) hard = v.aboveGround.verticalDistance < groundDistanceCheck(v);
		if (hard) v.timeSinceHardLanding = 0;
	}
	stabiliseAfterHardLanding(v, dt);
	drain(b, dt);
	if (v.numWorldCollisions === 0) {
		v.wheels.forEach((w, i) => {
			if (!w.hasTraction || w.detached || !compressed[i]) return;
			const local = P.wheels[i].streamed, p = toWorld(b, local), n = w.contact.normal;
			const pv = velocityAt(b, p);
			if (dot(pv, n) >= 0) return;
			const j = (-(1 + LANDING_RESTITUTION) * dot(pv, n)) / invEffectiveMass(b, p, n);
			addImpulseAt(b, scale(n, Math.abs(j)), 'world', local, 'body');
			drain(b, dt);
		});
	}
	// A fully drooped airborne wheel hangs its own weight on the body.
	v.wheels.forEach((w, i) => {
		if (w.hasTraction || w.pos[1] - P.wheels[i].yMin > 0.05 || w.detached) return;
		addForceAt(b, [0, -UNSPRUNG_MASS * GRAVITY, 0], 'world', w.pos, 'body');
	});
	drain(b, dt);
}

// For TimeToDampAfterLanding seconds after a hard landing, fade out pitch
// (unless the nose landed first with a wheel pair still up), roll and the
// velocity into the road.
export function stabiliseAfterHardLanding(v: VehicleState, dt: number): void {
	const b = v.body, S = v.params.susp;
	drain(b, dt);
	if (!(v.timeSinceHardLanding < S.timeToDampAfterLanding)) return;
	const f = 1 - v.timeSinceHardLanding / S.timeToDampAfterLanding;
	const [fl, fr, rl, rr] = v.wheels;
	const wheelsOn = (fl.onGround || fr.onGround) && (rl.onGround || rr.onGround);
	const frontFirst = v.aboveGround.valid && dot(b.axes[2], v.aboveGround.normal) < 0;
	const pitch = !frontFirst || wheelsOn ? Math.min(f, S.maxPitchDampingOnLanding) : 0;
	dampPitchYawRoll(b, pitch, 0, Math.min(f, S.maxRollDampingOnLanding), dt);
	if (v.aboveGround.valid) {
		const n = v.aboveGround.normal;
		const k = Math.pow(Math.min(f, S.maxVertVelocityDampingOnLanding), dt * 60);
		b.v = sub(b.v, scale(n, dot(b.v, n) * k));
	}
}
